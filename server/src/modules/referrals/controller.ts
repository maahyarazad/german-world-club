import { PROBLEMS } from '@gwc/contracts/errors'
import { REFERRAL_OWNER_KINDS } from '@gwc/contracts/referrals'
import { forbidden } from '../../authz/require-permission.ts'
import { getOrCreateLink, replaceLink } from './application/links.ts'
import { summaryFor } from './application/read-model.ts'
import type { Owner } from './application/codes.ts'
import type { ReferralOwnerKind } from '@gwc/contracts/referrals'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Request and reply shaping for a person's own referrals. The rules live in
 * `application/`.
 *
 * The owner is ALWAYS the authenticated principal — never a body field, never a
 * path parameter. There is no "whose referrals" input on these routes, so there
 * is nothing to tamper with: the mount's audience guarantees the principal's
 * kind, and the token its id.
 */
export function ownerOf(request: GwcRequest): Owner {
  const principal = request.principal
  const kind = principal?.kind as ReferralOwnerKind | undefined
  if (!principal?.id || !kind || !REFERRAL_OWNER_KINDS.includes(kind)) {
    // Unreachable behind the guard; refusing beats guessing an owner.
    throw forbidden(PROBLEMS.UNAUTHENTICATED, 'Sign in to see your referrals.')
  }
  return { kind, id: String(principal.id) }
}

export function createReferralsController(app: GwcApp) {
  const origin = app.env.canonicalOrigin

  return {
    summary: async (request: GwcRequest, reply: GwcReply) => {
      const owner = ownerOf(request)
      const link = await getOrCreateLink(app, owner, { requestId: request.id })
      reply.header('cache-control', 'private, no-store')
      return reply.send(await summaryFor(app.pg, origin, owner, link))
    },

    replace: async (request: GwcRequest, reply: GwcReply) => {
      const owner = ownerOf(request)
      const link = await replaceLink(app, owner, { requestId: request.id })
      reply.header('cache-control', 'private, no-store')
      return reply.send(await summaryFor(app.pg, origin, owner, link))
    },
  }
}
