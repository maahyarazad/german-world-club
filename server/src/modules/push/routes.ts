import fp from 'fastify-plugin'
import { z } from 'zod'
import {
  deviceRegistrationSchema, devicePatchSchema, deviceSchema, deviceListSchema, preferencesSchema,
  campaignRequestSchema, notificationSchema, notificationListSchema, notificationQuerySchema,
  audienceQuerySchema, audienceSchema,
  testRecipientSchema, testRecipientAddSchema, testRecipientListSchema, deletedSchema,
} from '@gwc/contracts/push'
import { createPushController } from './controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Push notification endpoints: schema, access posture, and wiring to
 * `controller.ts` only. See `application/` for the rules, and
 * specs/011-push-notifications/ for the design.
 *
 * **No route here calls a push provider.** Sending is the `push.deliver` job's
 * work (application/dispatch.ts); a staff send only queues a row and returns
 * 202. That is why the send routes are `admin-read`, not `admin-report`, and
 * why neither provider appears in any route budget.
 *
 * Every route declares an access posture, because the startup gate in
 * 11-rbac refuses to boot otherwise (Constitution Principle II). The member
 * routes deliberately do NOT declare `onboarding: true`: an applicant whose
 * application is not approved must not be able to register a phone, and 10-auth
 * refuses them on every route without that flag (research R4).
 *
 *   POST   /push/devices              register or refresh this device   (member)
 *   GET    /push/devices              the member's own devices          (member)
 *   PATCH  /push/devices/:id          switch on/off, change language    (member)
 *   DELETE /push/devices/:id          deregister, e.g. on sign-out      (member)
 *   GET    /push/preferences          offers / club news switches       (member)
 *   PUT    /push/preferences          set them                          (member)
 *   GET    /push/audience             members + devices a send reaches  (staff, read)
 *   POST   /push/campaigns            queue a broadcast                 (staff, write)
 *   POST   /push/campaigns/preview    queue a rehearsal to the test list (staff, write)
 *   GET    /push/campaigns            history                           (staff, read)
 *   GET    /push/campaigns/:id        one entry, for polling            (staff, read)
 *   GET    /push/test-recipients      the rehearsal list                (staff, read)
 *   POST   /push/test-recipients      add to it by id or handle, audited (staff, edit)
 *   DELETE /push/test-recipients/:id  remove from it, audited           (staff, edit)
 */
export default fp(
  async function pushRoutes(app: GwcApp) {
    const controller = createPushController(app)

    const idParam = z.object({ id: z.string().uuid() })
    const memberRead = { auth: { audience: 'member' }, budget: 'member-read', rateLimit: app.bucket('member-api') } as const
    const memberWrite = { auth: { audience: 'member' }, budget: 'member-write', rateLimit: app.bucket('write-heavy') } as const
    const staff = (flag: 'read' | 'write' | 'edit') => ({
      auth: { audience: 'staff', module: 'mass_messages', flag },
      budget: 'admin-read',
      rateLimit: app.bucket('admin-api'),
    }) as const

    // ---- Devices and preferences (member) ------------------------------------

    app.post(
      '/push/devices',
      { config: memberWrite, onRequest: app.guard, schema: { body: deviceRegistrationSchema, response: { 200: deviceSchema } } },
      controller.registerDevice,
    )

    app.get(
      '/push/devices',
      { config: memberRead, onRequest: app.guard, schema: { response: { 200: deviceListSchema } } },
      controller.listDevices,
    )

    app.patch(
      '/push/devices/:id',
      {
        config: memberWrite,
        onRequest: app.guard,
        schema: { params: idParam, body: devicePatchSchema, response: { 200: deviceSchema } },
      },
      controller.updateDevice,
    )

    app.delete(
      '/push/devices/:id',
      { config: memberWrite, onRequest: app.guard, schema: { params: idParam, response: { 200: deletedSchema } } },
      controller.deregisterDevice,
    )

    app.get(
      '/push/preferences',
      { config: memberRead, onRequest: app.guard, schema: { response: { 200: preferencesSchema } } },
      controller.getPreferences,
    )

    app.put(
      '/push/preferences',
      { config: memberWrite, onRequest: app.guard, schema: { body: preferencesSchema, response: { 200: preferencesSchema } } },
      controller.putPreferences,
    )

    // ---- Sending (staff) -------------------------------------------------------

    app.get(
      '/push/audience',
      { config: staff('read'), onRequest: app.guard, schema: { querystring: audienceQuerySchema, response: { 200: audienceSchema } } },
      controller.audience,
    )

    app.post(
      '/push/campaigns',
      {
        config: staff('write'),
        onRequest: app.guard,
        schema: { body: campaignRequestSchema, response: { 200: notificationSchema, 202: notificationSchema } },
      },
      controller.sendCampaign,
    )

    app.post(
      '/push/campaigns/preview',
      {
        config: staff('write'),
        onRequest: app.guard,
        schema: { body: campaignRequestSchema, response: { 200: notificationSchema, 202: notificationSchema } },
      },
      controller.previewCampaign,
    )

    app.get(
      '/push/campaigns',
      {
        config: staff('read'),
        onRequest: app.guard,
        schema: { querystring: notificationQuerySchema, response: { 200: notificationListSchema } },
      },
      controller.listCampaigns,
    )

    app.get(
      '/push/campaigns/:id',
      { config: staff('read'), onRequest: app.guard, schema: { params: idParam, response: { 200: notificationSchema } } },
      controller.getCampaign,
    )

    // ---- The rehearsal list (staff) --------------------------------------------

    app.get(
      '/push/test-recipients',
      { config: staff('read'), onRequest: app.guard, schema: { response: { 200: testRecipientListSchema } } },
      controller.listTestRecipients,
    )

    app.post(
      '/push/test-recipients',
      {
        config: staff('edit'),
        onRequest: app.guard,
        schema: { body: testRecipientAddSchema, response: { 200: testRecipientSchema } },
      },
      controller.addTestRecipient,
    )

    app.delete(
      '/push/test-recipients/:id',
      { config: staff('edit'), onRequest: app.guard, schema: { params: idParam, response: { 200: deletedSchema } } },
      controller.removeTestRecipient,
    )
  },
  { name: 'push-routes', dependencies: ['auth', 'rate-limit'] },
)
