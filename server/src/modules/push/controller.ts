import { registerDevice, listDevices, deregisterDevice, toDevice } from './application/devices.ts'
import { dispatchCampaign, listCampaigns } from './application/campaign.ts'
import { listTestRecipients, addTestRecipient, removeTestRecipient } from './application/test-recipients.ts'

export function createPushController(app, { config, transport }) {
  return {
    registerDevice: async (request, reply) => {
      const { token, provider, platform, enabled } = request.body
      const row = await registerDevice(app, {
        memberId: request.principal.id, token, provider, platform, enabled,
        signal: request.deadlineSignal,
      })
      return reply.send(toDevice(row))
    },

    listDevices: async (request, reply) => {
      const rows = await listDevices(app, { memberId: request.principal.id, signal: request.deadlineSignal })
      return reply.send({ devices: rows.map(toDevice) })
    },

    deregisterDevice: async (request, reply) => {
      const id = await deregisterDevice(app, {
        id: request.params.id, memberId: request.principal.id, signal: request.deadlineSignal,
      })
      return reply.send({ id, deleted: true })
    },

    sendCampaign: async (request, reply) => {
      const payload = await dispatchCampaign(app, {
        config, transport, isTest: false,
        principal: request.principal, requestId: request.id, body: request.body,
      })
      return reply.code(201).send(payload)
    },

    /**
     * The rehearsal. Same body, same pipeline, a handful of real devices.
     *
     * A broadcast to the whole club cannot be recalled, so having a way to see
     * exactly what it will look like — on a real lock screen, with the deep
     * link live — is the difference between a typo and a typo everyone reads.
     */
    previewCampaign: async (request, reply) => {
      const payload = await dispatchCampaign(app, {
        config, transport, isTest: true,
        principal: request.principal, requestId: request.id, body: request.body,
      })
      return reply.code(201).send(payload)
    },

    listCampaigns: async (request, reply) => {
      const { isTest, limit } = request.query
      const campaigns = await listCampaigns(app, { isTest, limit, signal: request.deadlineSignal })
      return reply.send({ campaigns })
    },

    listTestRecipients: async (request, reply) => {
      const recipients = await listTestRecipients(app, { signal: request.deadlineSignal })
      return reply.send({ recipients })
    },

    addTestRecipient: async (request, reply) => {
      const memberId = await addTestRecipient(app, {
        memberId: request.body.memberId, addedBy: request.principal.id, signal: request.deadlineSignal,
      })
      return reply.send({ memberId })
    },

    removeTestRecipient: async (request, reply) => {
      const id = await removeTestRecipient(app, { memberId: request.params.id, signal: request.deadlineSignal })
      return reply.send({ id, deleted: true })
    },
  }
}
