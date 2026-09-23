import {
  loadOwnProfile, updateOwnProfile, loadMemberProfile, loadOrganisationProfile,
} from './application/profile.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'
import type { UpdateProfileRequest } from '@gwc/contracts/profile'

/** Request and reply shaping for profiles. The rules live in `application/`. */
export function createProfileController(app: GwcApp) {
  return {
    me: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await loadOwnProfile(app, { memberId: String(request.principal!.id), signal: request.deadlineSignal })),

    update: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await updateOwnProfile(app, {
        memberId: String(request.principal!.id),
        changes: request.body as UpdateProfileRequest,
        signal: request.deadlineSignal,
      })),

    member: async (request: GwcRequest, reply: GwcReply) => {
      const { id } = request.params as { id: string }
      return reply.send(await loadMemberProfile(app, {
        viewerId: String(request.principal!.id), memberId: id, signal: request.deadlineSignal,
      }))
    },

    organisation: async (request: GwcRequest, reply: GwcReply) => {
      const principal = request.principal!
      return reply.send(await loadOrganisationProfile(app, {
        principalId: String(principal.id),
        kind: principal.kind as 'merchant' | 'partner',
        signal: request.deadlineSignal,
      }))
    },
  }
}
