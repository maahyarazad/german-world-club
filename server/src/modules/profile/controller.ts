import {
  loadOwnProfile, updateOwnProfile, loadMemberProfile, setAvatar, setLinks,
} from './application/profile.ts'
import { setHandle, isHandleAvailable } from './application/handle.ts'
import {
  loadOwnOrganisationProfile, loadOrganisationPublicProfile, updateOrganisationPublicProfile,
} from './application/organisation.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'
import type {
  ProfileLink, UpdateOrganisationProfileRequest, UpdateProfileRequest,
} from '@gwc/contracts/profile'

/** Request and reply shaping for profiles. The rules live in `application/`. */
export function createProfileController(app: GwcApp) {
  const me = (request: GwcRequest) => String(request.principal!.id)
  const orgKind = (request: GwcRequest) => request.principal!.kind as 'merchant' | 'partner'

  return {
    me: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await loadOwnProfile(app, { memberId: me(request), signal: request.deadlineSignal })),

    update: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await updateOwnProfile(app, {
        memberId: me(request),
        changes: request.body as UpdateProfileRequest,
        signal: request.deadlineSignal,
      })),

    setHandle: async (request: GwcRequest, reply: GwcReply) => {
      await setHandle(app, { memberId: me(request), handle: (request.body as { handle: string }).handle, signal: request.deadlineSignal })
      return reply.send(await loadOwnProfile(app, { memberId: me(request), signal: request.deadlineSignal }))
    },

    handleAvailable: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await isHandleAvailable(app, {
        memberId: me(request), handle: (request.params as { handle: string }).handle, signal: request.deadlineSignal,
      })),

    setAvatar: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await setAvatar(app, {
        memberId: me(request), assetId: (request.body as { assetId: string | null }).assetId, signal: request.deadlineSignal,
      })),

    setLinks: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await setLinks(app, {
        memberId: me(request), links: (request.body as { links: ProfileLink[] }).links, signal: request.deadlineSignal,
      })),

    member: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await loadMemberProfile(app, {
        viewerId: me(request), memberId: (request.params as { id: string }).id, signal: request.deadlineSignal,
      })),

    memberByHandle: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await loadMemberProfile(app, {
        viewerId: me(request), handle: (request.params as { handle: string }).handle.toLowerCase(), signal: request.deadlineSignal,
      })),

    organisationPublic: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await loadOrganisationPublicProfile(app, {
        slug: (request.params as { slug: string }).slug, signal: request.deadlineSignal,
      })),

    organisation: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await loadOwnOrganisationProfile(app, {
        principalId: me(request), kind: orgKind(request), signal: request.deadlineSignal,
      })),

    updateOrganisation: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await updateOrganisationPublicProfile(app, {
        principalId: me(request), kind: orgKind(request),
        changes: request.body as UpdateOrganisationProfileRequest, signal: request.deadlineSignal,
      })),
  }
}
