import fp from 'fastify-plugin'
import { z } from 'zod'
import { PROBLEMS } from '@gwc/contracts/errors'
import {
  deviceRegistrationSchema, deviceSchema, deviceListSchema,
  campaignRequestSchema, campaignResultSchema, campaignHistorySchema, campaignQuerySchema,
  testRecipientSchema, testRecipientListSchema, deletedSchema,
} from '@gwc/contracts/push'

import { query, withTransaction } from '../db/query.js'
import { sendToDevices } from './providers.js'
import { forbidden } from '../authz/require-permission.js'

/**
 * Push notification endpoints.
 *
 * **Routing note.** The blueprint's server exposes verb-shaped paths under
 * `/notification` — `save-push-token`, `send-notification`, `sent-notifications`
 * — and states plainly that "this router has no auth middleware today", with
 * `/send-notification` broadcasting to every user holding a token. Neither
 * carries over. The routes here are resource-shaped, and every one of them
 * declares an access posture because the startup gate in 11-rbac.js refuses to
 * boot otherwise (Constitution Principle II):
 *
 *   POST   /push/devices              register or refresh this device  (member)
 *   GET    /push/devices              the member's own devices         (member)
 *   DELETE /push/devices/:id          deregister, e.g. on sign-out     (member)
 *   POST   /push/campaigns            broadcast                        (staff)
 *   POST   /push/campaigns/preview    send only to the test list       (staff)
 *   GET    /push/campaigns            history                          (staff)
 *   GET    /push/test-recipients      the rehearsal list               (staff)
 *   POST   /push/test-recipients      add to it                        (staff)
 *   DELETE /push/test-recipients/:id  remove from it                   (staff)
 *
 * Broadcasts sit on the `mass_messages` module of the five-flag matrix, which
 * is where §9's newsletter and mass-message capability already lives — sending
 * every member's phone a notification is the same privilege by another
 * transport, so it should not need a new one.
 */

/** A token is a credential for addressing someone's phone; never echo it whole. */
const preview = (token) => `${String(token).slice(0, 12)}…${String(token).slice(-4)}`

const toDevice = (row) => ({
  id: row.id,
  provider: row.provider,
  platform: row.platform ?? null,
  enabled: row.enabled,
  tokenPreview: preview(row.token),
  lastSeenAt: new Date(row.last_seen_at).toISOString(),
  createdAt: new Date(row.created_at).toISOString(),
})

const toCampaign = (row, extra = {}) => ({
  id: row.id,
  sentAt: new Date(row.sent_at).toISOString(),
  title: row.title,
  body: row.body,
  isTest: row.is_test,
  destinationType: row.destination_type ?? null,
  destinationId: row.destination_id ?? null,
  destinationLabel: row.destination_label ?? null,
  totals: {
    success: row.total_success,
    failure: row.total_failure,
    expoSuccess: row.expo_success,
    expoFailure: row.expo_failure,
    fcmSuccess: row.fcm_success,
    fcmFailure: row.fcm_failure,
  },
  ...extra,
})

export default fp(
  async function pushRoutes(app, opts = {}) {
    const config = opts.pushConfig ?? {
      expoAccessToken: app.env.EXPO_ACCESS_TOKEN,
      fcmProjectId: app.env.FCM_PROJECT_ID,
      fcmClientEmail: app.env.FCM_CLIENT_EMAIL,
      fcmPrivateKey: app.env.FCM_PRIVATE_KEY,
    }
    /** Injectable so the transport can be driven without a network. */
    const transport = opts.send

    const idParam = z.object({ id: z.string().uuid() })

    // ---- Devices (member) ---------------------------------------------------

    app.post(
      '/push/devices',
      {
        config: { auth: { audience: 'member' }, budget: 'member-write', rateLimit: app.bucket('write-heavy') },
        onRequest: app.guard,
        schema: { body: deviceRegistrationSchema, response: { 200: deviceSchema } },
      },
      async (request, reply) => {
        const { token, provider, platform, enabled } = request.body

        /**
         * An upsert on (member_id, token), which is what makes re-registration
         * safe. Tokens rotate on reinstall and OS restore, and the blueprint
         * warns that a token registered once at signup goes stale and the
         * member silently stops receiving anything — so the client is expected
         * to call this on every cold start, and calling it must be cheap and
         * idempotent.
         */
        const { rows } = await query(
          app.pg,
          `INSERT INTO push_devices (member_id, token, provider, platform, enabled)
           VALUES ($1, $2, $3, $4, COALESCE($5, true))
           ON CONFLICT (member_id, token) DO UPDATE
             SET provider = EXCLUDED.provider,
                 platform = EXCLUDED.platform,
                 enabled  = COALESCE($5, push_devices.enabled),
                 last_seen_at = now(),
                 updated_at = now()
           RETURNING *`,
          [request.principal.id, token, provider, platform ?? null, enabled ?? null],
          { signal: request.deadlineSignal },
        )

        return reply.send(toDevice(rows[0]))
      },
    )

    app.get(
      '/push/devices',
      {
        config: { auth: { audience: 'member' }, budget: 'member-read', rateLimit: app.bucket('member-api') },
        onRequest: app.guard,
        schema: { response: { 200: deviceListSchema } },
      },
      async (request, reply) => {
        const { rows } = await query(
          app.pg,
          'SELECT * FROM push_devices WHERE member_id = $1 ORDER BY last_seen_at DESC',
          [request.principal.id],
          { signal: request.deadlineSignal },
        )
        return reply.send({ devices: rows.map(toDevice) })
      },
    )

    /**
     * Deregistration, by device id.
     *
     * The blueprint clears a token by re-posting an empty string, and then
     * notes its own server rejects that. A DELETE on the device says what is
     * meant, and scoping it to the caller's own member id means one member
     * cannot silence another's phone.
     */
    app.delete(
      '/push/devices/:id',
      {
        config: { auth: { audience: 'member' }, budget: 'member-write', rateLimit: app.bucket('write-heavy') },
        onRequest: app.guard,
        schema: { params: idParam, response: { 200: deletedSchema } },
      },
      async (request, reply) => {
        const { rows } = await query(
          app.pg,
          'DELETE FROM push_devices WHERE id = $1 AND member_id = $2 RETURNING id',
          [request.params.id, request.principal.id],
          { signal: request.deadlineSignal },
        )
        if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such device.')
        return reply.send({ id: rows[0].id, deleted: true })
      },
    )

    // ---- Sending ------------------------------------------------------------

    /**
     * Load the devices a campaign will reach.
     *
     * `enabled` is honoured on the device and the member must be active: a
     * suspended member should not receive club notifications, and that rule
     * belongs here rather than in whoever happens to compose the message.
     */
    async function audience({ testOnly }) {
      const { rows } = await query(
        app.pg,
        `SELECT d.*
           FROM push_devices d
           JOIN members m ON m.id = d.member_id
          ${testOnly ? 'JOIN push_test_recipients t ON t.member_id = d.member_id' : ''}
          WHERE d.enabled
            AND m.status = 'active'
            AND length(btrim(d.token)) > 0`,
      )
      return rows
    }

    async function dispatch(request, reply, { isTest }) {
      const { title, body, destinationType, destinationId, destinationLabel } = request.body
      const devices = await audience({ testOnly: isTest })

      const result = await sendToDevices({
        devices,
        title,
        body,
        // §5: the client routes on these, and both are always strings.
        data: { path: destinationType === 'none' ? '' : destinationType, id: destinationId ?? '' },
        config,
        send: transport,
      })

      /**
       * From here the push has ALREADY been delivered.
       *
       * The blueprint's §8 names the failure this guards: a logging error
       * reported as a send failure invites the admin to re-send, and every
       * member's phone buzzes twice. So the write is attempted, and a failure
       * is reported as an incomplete *record* rather than an unsuccessful send.
       */
      let campaignRow = null
      let loggingIncomplete = false

      try {
        campaignRow = await withTransaction(app.pg, async (client) => {
          const { rows } = await client.query(
            `INSERT INTO push_campaigns
               (title, body, destination_type, destination_id, destination_label, is_test, sent_by,
                total_success, total_failure, expo_success, expo_failure, fcm_success, fcm_failure)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING *`,
            [
              title, body,
              destinationType === 'none' ? null : destinationType,
              destinationId ?? null,
              destinationLabel ?? null,
              isTest,
              request.principal.id,
              result.successCount, result.failureCount,
              result.expo.successCount, result.expo.failureCount,
              result.fcm.successCount, result.fcm.failureCount,
            ],
          )
          const campaign = rows[0]

          for (const outcome of result.perDevice) {
            await client.query(
              `INSERT INTO push_campaign_recipients
                 (campaign_id, device_id, member_id, token, provider, platform, status, error_message)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (campaign_id, token) DO NOTHING`,
              [
                campaign.id, outcome.device.id, outcome.device.member_id, outcome.device.token,
                outcome.device.provider, outcome.device.platform ?? null,
                outcome.status, outcome.error ? String(outcome.error).slice(0, 500) : null,
              ],
            )
          }

          return campaign
        })
      } catch (err) {
        loggingIncomplete = true
        request.log.error({ err }, 'push delivered but logging failed')
      }

      await app.audit({
        action: isTest ? 'push_preview_sent' : 'push_campaign_sent',
        outcome: 'allowed',
        requestId: request.id,
        actorId: request.principal.id,
        actorKind: request.principal.kind,
        targetType: 'push_campaign',
        targetId: campaignRow?.id ?? null,
        requiredPermission: 'mass_messages.write',
        detail: { success: result.successCount, failure: result.failureCount, devices: devices.length },
      })

      const payload = campaignRow
        ? toCampaign(campaignRow, loggingIncomplete ? { loggingIncomplete } : {})
        : {
            // The record could not be written, so the response is assembled from
            // what was actually sent. The send still succeeded.
            id: '00000000-0000-0000-0000-000000000000',
            sentAt: new Date().toISOString(),
            title, body, isTest,
            destinationType: destinationType === 'none' ? null : destinationType,
            destinationId: destinationId ?? null,
            destinationLabel: destinationLabel ?? null,
            totals: {
              success: result.successCount, failure: result.failureCount,
              expoSuccess: result.expo.successCount, expoFailure: result.expo.failureCount,
              fcmSuccess: result.fcm.successCount, fcmFailure: result.fcm.failureCount,
            },
            loggingIncomplete: true,
          }

      return reply.code(201).send(payload)
    }

    app.post(
      '/push/campaigns',
      {
        config: {
          auth: { audience: 'staff', module: 'mass_messages', flag: 'write' },
          budget: 'admin-report',
          rateLimit: app.bucket('admin-api'),
        },
        onRequest: app.guard,
        schema: { body: campaignRequestSchema, response: { 201: campaignResultSchema } },
      },
      (request, reply) => dispatch(request, reply, { isTest: false }),
    )

    /**
     * The rehearsal. Same body, same pipeline, a handful of real devices.
     *
     * A broadcast to the whole club cannot be recalled, so having a way to see
     * exactly what it will look like — on a real lock screen, with the deep link
     * live — is the difference between a typo and a typo everyone reads.
     */
    app.post(
      '/push/campaigns/preview',
      {
        config: {
          auth: { audience: 'staff', module: 'mass_messages', flag: 'write' },
          budget: 'admin-read',
          rateLimit: app.bucket('admin-api'),
        },
        onRequest: app.guard,
        schema: { body: campaignRequestSchema, response: { 201: campaignResultSchema } },
      },
      (request, reply) => dispatch(request, reply, { isTest: true }),
    )

    app.get(
      '/push/campaigns',
      {
        config: {
          auth: { audience: 'staff', module: 'mass_messages', flag: 'read' },
          budget: 'admin-read',
          rateLimit: app.bucket('admin-api'),
        },
        onRequest: app.guard,
        schema: { querystring: campaignQuerySchema, response: { 200: campaignHistorySchema } },
      },
      async (request, reply) => {
        const { isTest, limit } = request.query
        const { rows } = await query(
          app.pg,
          `SELECT * FROM push_campaigns
            WHERE ($1::boolean IS NULL OR is_test = $1)
            ORDER BY sent_at DESC
            LIMIT $2`,
          [isTest ?? null, limit],
          { signal: request.deadlineSignal },
        )
        return reply.send({ campaigns: rows.map((row) => toCampaign(row)) })
      },
    )

    // ---- The rehearsal list -------------------------------------------------

    app.get(
      '/push/test-recipients',
      {
        config: {
          auth: { audience: 'staff', module: 'mass_messages', flag: 'read' },
          budget: 'admin-read',
          rateLimit: app.bucket('admin-api'),
        },
        onRequest: app.guard,
        schema: { response: { 200: testRecipientListSchema } },
      },
      async (request, reply) => {
        const { rows } = await query(
          app.pg,
          `SELECT t.member_id, m.display_name, m.email,
                  (SELECT count(*)::int FROM push_devices d WHERE d.member_id = t.member_id AND d.enabled) AS device_count
             FROM push_test_recipients t
             JOIN members m ON m.id = t.member_id
            ORDER BY m.email`,
          [],
          { signal: request.deadlineSignal },
        )
        return reply.send({
          recipients: rows.map((r) => ({
            memberId: r.member_id,
            displayName: r.display_name ?? null,
            email: r.email,
            deviceCount: r.device_count,
          })),
        })
      },
    )

    app.post(
      '/push/test-recipients',
      {
        config: {
          auth: { audience: 'staff', module: 'mass_messages', flag: 'edit' },
          budget: 'admin-read',
          rateLimit: app.bucket('admin-api'),
        },
        onRequest: app.guard,
        schema: { body: testRecipientSchema, response: { 200: testRecipientSchema } },
      },
      async (request, reply) => {
        const { rows } = await query(
          app.pg,
          `INSERT INTO push_test_recipients (member_id, added_by) VALUES ($1, $2)
           ON CONFLICT (member_id) DO UPDATE SET added_by = EXCLUDED.added_by
           RETURNING member_id`,
          [request.body.memberId, request.principal.id],
          { signal: request.deadlineSignal },
        )
        return reply.send({ memberId: rows[0].member_id })
      },
    )

    app.delete(
      '/push/test-recipients/:id',
      {
        config: {
          auth: { audience: 'staff', module: 'mass_messages', flag: 'edit' },
          budget: 'admin-read',
          rateLimit: app.bucket('admin-api'),
        },
        onRequest: app.guard,
        schema: { params: idParam, response: { 200: deletedSchema } },
      },
      async (request, reply) => {
        const { rows } = await query(
          app.pg,
          'DELETE FROM push_test_recipients WHERE member_id = $1 RETURNING member_id',
          [request.params.id],
          { signal: request.deadlineSignal },
        )
        if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'Not on the test list.')
        return reply.send({ id: rows[0].member_id, deleted: true })
      },
    )
  },
  { name: 'push-routes', dependencies: ['auth', 'rate-limit'] },
)
