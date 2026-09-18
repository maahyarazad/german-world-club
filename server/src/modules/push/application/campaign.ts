import { query, withTransaction } from '../../../db/query.ts'
import { sendToDevices } from '../providers.ts'

export const toCampaign = (row, extra = {}) => ({
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

/**
 * Load the devices a campaign will reach.
 *
 * `enabled` is honoured on the device and the member must be active: a
 * suspended member should not receive club notifications, and that rule
 * belongs here rather than in whoever happens to compose the message.
 */
async function audience(app, { testOnly }) {
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

/**
 * Broadcasts sit on the `mass_messages` module of the five-flag matrix, which
 * is where §9's newsletter and mass-message capability already lives —
 * sending every member's phone a notification is the same privilege by
 * another transport, so it should not need a new one.
 */
export async function dispatchCampaign(app, { config, transport, isTest, principal, requestId, body }) {
  const { title, body: message, destinationType, destinationId, destinationLabel } = body
  const devices = await audience(app, { testOnly: isTest })

  const result = await sendToDevices({
    devices,
    title,
    body: message,
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
   * member's phone buzzes twice. So the write is attempted, and a failure is
   * reported as an incomplete *record* rather than an unsuccessful send.
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
          title, message,
          destinationType === 'none' ? null : destinationType,
          destinationId ?? null,
          destinationLabel ?? null,
          isTest,
          principal.id,
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
    app.log.error({ err }, 'push delivered but logging failed')
  }

  await app.audit({
    action: isTest ? 'push_preview_sent' : 'push_campaign_sent',
    outcome: 'allowed',
    requestId,
    actorId: principal.id,
    actorKind: principal.kind,
    targetType: 'push_campaign',
    targetId: campaignRow?.id ?? null,
    requiredPermission: 'mass_messages.write',
    detail: { success: result.successCount, failure: result.failureCount, devices: devices.length },
  })

  if (campaignRow) {
    return toCampaign(campaignRow, loggingIncomplete ? { loggingIncomplete } : {})
  }

  // The record could not be written, so the response is assembled from what
  // was actually sent. The send still succeeded.
  return {
    id: '00000000-0000-0000-0000-000000000000',
    sentAt: new Date().toISOString(),
    title, body: message, isTest,
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
}

export async function listCampaigns(app, { isTest, limit, signal }) {
  const { rows } = await query(
    app.pg,
    `SELECT * FROM push_campaigns
      WHERE ($1::boolean IS NULL OR is_test = $1)
      ORDER BY sent_at DESC
      LIMIT $2`,
    [isTest ?? null, limit],
    { signal },
  )
  return rows.map((row) => toCampaign(row))
}
