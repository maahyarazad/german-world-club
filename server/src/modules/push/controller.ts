import { registerDevice, listDevices, updateDevice, deregisterDevice, toDevice } from './application/devices.ts'
import { getPreferences, putPreferences } from './application/preferences.ts'
import { enqueueNotification } from './application/enqueue.ts'
import { listNotifications, getNotification } from './application/history.ts'
import { countAudience, AUDIENCE_FOR_KIND } from './application/audience.ts'
import { listTestRecipients, addTestRecipient, removeTestRecipient } from './application/test-recipients.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'
import type {
  CampaignRequest, DeviceRegistration, DevicePatch, Preferences, NotificationQuery, AudienceQuery,
} from '@gwc/contracts/push'

type Req = GwcRequest
type FastifyReply = GwcReply
/** Every route here declares a params schema of exactly this shape. */
const idOf = (request: Req) => (request.params as { id: string }).id

export function createPushController(app: GwcApp) {
  const principalOf = (request: Req) => request.principal as unknown as { id: string; kind?: string; sid?: string }

  /**
   * Both staff sends. 202 when this request queued the notification, 200 when
   * it is a repeat of one already queued under the same `clientRef` — the
   * console treats both as accepted and makes a new ref (research R2).
   */
  const send = (kind: 'rehearsal' | 'broadcast') => async (request: Req, reply: FastifyReply) => {
    const { clientRef, de, en, destination } = request.body as CampaignRequest
    const { notification, created } = await enqueueNotification(app, {
      kind, clientRef, de, en, destination,
      principal: principalOf(request), requestId: request.id, signal: request.deadlineSignal,
    })
    return reply.code(created ? 202 : 200).send(notification)
  }

  return {
    registerDevice: async (request: Req, reply: FastifyReply) => {
      const { token, provider, platform, locale, enabled } = request.body as DeviceRegistration
      const principal = principalOf(request)
      const row = await registerDevice(app, {
        memberId: principal.id, sessionId: principal.sid ?? null,
        token, provider, platform, locale, enabled,
        signal: request.deadlineSignal,
      })
      return reply.send(toDevice(row!))
    },

    listDevices: async (request: Req, reply: FastifyReply) => {
      const rows = await listDevices(app, { memberId: principalOf(request).id, signal: request.deadlineSignal })
      return reply.send({ devices: rows.map(toDevice) })
    },

    updateDevice: async (request: Req, reply: FastifyReply) => {
      const { enabled, locale } = request.body as DevicePatch
      const row = await updateDevice(app, {
        id: idOf(request), memberId: principalOf(request).id, enabled, locale,
        signal: request.deadlineSignal,
      })
      return reply.send(toDevice(row!))
    },

    deregisterDevice: async (request: Req, reply: FastifyReply) => {
      const id = await deregisterDevice(app, {
        id: idOf(request), memberId: principalOf(request).id, signal: request.deadlineSignal,
      })
      return reply.send({ id, deleted: true })
    },

    getPreferences: async (request: Req, reply: FastifyReply) =>
      reply.send(await getPreferences(app, { memberId: principalOf(request).id, signal: request.deadlineSignal })),

    putPreferences: async (request: Req, reply: FastifyReply) =>
      reply.send(await putPreferences(app, {
        memberId: principalOf(request).id, ...(request.body as Preferences), signal: request.deadlineSignal,
      })),

    audience: async (request: Req, reply: FastifyReply) =>
      reply.send(await countAudience(app, {
        audience: AUDIENCE_FOR_KIND[(request.query as AudienceQuery).kind],
        signal: request.deadlineSignal,
      })),

    sendCampaign: send('broadcast'),

    /**
     * The rehearsal. Same body, same pipeline, a handful of real devices.
     *
     * A broadcast to the whole club cannot be recalled, so having a way to see
     * exactly what it will look like — on a real lock screen, with the deep
     * link live — is the difference between a typo and a typo everyone reads.
     */
    previewCampaign: send('rehearsal'),

    listCampaigns: async (request: Req, reply: FastifyReply) => {
      const { kind, isTest, limit } = request.query as NotificationQuery
      // `isTest` is the pre-011 filter, kept for one release.
      const resolved = kind ?? (isTest === undefined ? undefined : isTest ? 'rehearsal' : 'broadcast')
      const notifications = await listNotifications(app, { kind: resolved, limit, signal: request.deadlineSignal })
      return reply.send({ notifications })
    },

    getCampaign: async (request: Req, reply: FastifyReply) =>
      reply.send(await getNotification(app, { id: idOf(request), signal: request.deadlineSignal })),

    listTestRecipients: async (request: Req, reply: FastifyReply) => {
      const recipients = await listTestRecipients(app, { signal: request.deadlineSignal })
      return reply.send({ recipients })
    },

    addTestRecipient: async (request: Req, reply: FastifyReply) => {
      const memberId = await addTestRecipient(app, {
        ...(request.body as { memberId?: string; handle?: string }), principal: principalOf(request),
        requestId: request.id, signal: request.deadlineSignal,
      })
      return reply.send({ memberId })
    },

    removeTestRecipient: async (request: Req, reply: FastifyReply) => {
      const id = await removeTestRecipient(app, {
        memberId: idOf(request), principal: principalOf(request),
        requestId: request.id, signal: request.deadlineSignal,
      })
      return reply.send({ id, deleted: true })
    },
  }
}
