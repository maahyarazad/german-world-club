import fp from 'fastify-plugin'
import { z } from 'zod'
import {
  deviceRegistrationSchema, deviceSchema, deviceListSchema,
  campaignRequestSchema, campaignResultSchema, campaignHistorySchema, campaignQuerySchema,
  testRecipientSchema, testRecipientListSchema, deletedSchema,
} from '@gwc/contracts/push'
import { createPushController } from './controller.js'

/**
 * Push notification endpoints: schema, access posture, and wiring to
 * `controller.js` only. See `application/` for the device, campaign and
 * test-recipient rules.
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
 */
export default fp(
  async function pushRoutes(app, opts = {}) {
    const config = opts.pushConfig ?? {
      expoAccessToken: app.env.EXPO_ACCESS_TOKEN,
      fcmProjectId: app.env.FCM_PROJECT_ID,
      fcmClientEmail: app.env.FCM_CLIENT_EMAIL,
      fcmPrivateKey: app.env.FCM_PRIVATE_KEY,
    }
    /** Injectable so the transport can be driven without a network. */
    const controller = createPushController(app, { config, transport: opts.send })

    const idParam = z.object({ id: z.string().uuid() })

    // ---- Devices (member) ---------------------------------------------------

    app.post(
      '/push/devices',
      {
        config: { auth: { audience: 'member' }, budget: 'member-write', rateLimit: app.bucket('write-heavy') },
        onRequest: app.guard,
        schema: { body: deviceRegistrationSchema, response: { 200: deviceSchema } },
      },
      controller.registerDevice,
    )

    app.get(
      '/push/devices',
      {
        config: { auth: { audience: 'member' }, budget: 'member-read', rateLimit: app.bucket('member-api') },
        onRequest: app.guard,
        schema: { response: { 200: deviceListSchema } },
      },
      controller.listDevices,
    )

    app.delete(
      '/push/devices/:id',
      {
        config: { auth: { audience: 'member' }, budget: 'member-write', rateLimit: app.bucket('write-heavy') },
        onRequest: app.guard,
        schema: { params: idParam, response: { 200: deletedSchema } },
      },
      controller.deregisterDevice,
    )

    // ---- Sending ------------------------------------------------------------

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
      controller.sendCampaign,
    )

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
      controller.previewCampaign,
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
      controller.listCampaigns,
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
      controller.listTestRecipients,
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
      controller.addTestRecipient,
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
      controller.removeTestRecipient,
    )
  },
  { name: 'push-routes', dependencies: ['auth', 'rate-limit'] },
)
