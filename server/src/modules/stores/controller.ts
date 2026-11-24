import { getOwnStore, createStore, updateStore } from './application/store.ts'
import { setStoreCover, setStoreMedia } from './application/store-media.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'
import type { CreateStoreRequest, UpdateStoreRequest } from '@gwc/contracts/stores'

/** Request and reply shaping for a merchant's own store. The rules live in `application/`. */
export function createStoreController(app: GwcApp) {
  // The organisation comes from the database on this request (10-auth), never
  // from the token or the URL, so there is no id to point at someone else's store.
  const org = (request: GwcRequest) => String(request.principal!.organisationId)
  const actor = (request: GwcRequest) => ({ id: String(request.principal!.id), kind: 'merchant' as const, requestId: request.id })

  return {
    get: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await getOwnStore(app, { organisationId: org(request), signal: request.deadlineSignal })),

    create: async (request: GwcRequest, reply: GwcReply) =>
      reply.code(201).send(await createStore(app, {
        organisationId: org(request), actor: actor(request), body: request.body as CreateStoreRequest,
      })),

    update: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await updateStore(app, {
        organisationId: org(request), actor: actor(request), body: request.body as UpdateStoreRequest,
      })),

    setCover: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await setStoreCover(app, {
        organisationId: org(request), actor: actor(request), assetId: (request.body as { assetId: string | null }).assetId,
      })),

    setMedia: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await setStoreMedia(app, {
        organisationId: org(request), actor: actor(request), assetIds: (request.body as { assetIds: string[] }).assetIds,
      })),
  }
}
