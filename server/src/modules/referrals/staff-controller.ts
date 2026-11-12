import { PROBLEMS } from '@gwc/contracts/errors'
import { forbidden } from '../../authz/require-permission.ts'
import { listReferrals, listXp } from './application/lists.ts'
import { listOwners, ownerDetail, rateWithHistory } from './application/staff-queries.ts'
import { disableLink, reverseAward, setRate } from './application/ledger.ts'
import type { ReferralOwnerKind } from '@gwc/contracts/referrals'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'

/** Request and reply shaping for staff oversight of referrals. The rules live in `application/`. */
export function createReferralsStaffController(app: GwcApp) {
  const adminId = (request: GwcRequest) => {
    const id = request.principal?.id
    if (!id) throw forbidden(PROBLEMS.UNAUTHENTICATED, 'Sign in to continue.')
    return String(id)
  }
  const ownerParam = (request: GwcRequest) => {
    const { kind, id } = request.params as { kind: ReferralOwnerKind; id: string }
    return { kind, id }
  }
  const noStore = (reply: GwcReply) => reply.header('cache-control', 'private, no-store')

  return {
    owners: async (request: GwcRequest, reply: GwcReply) => {
      const { kind, q, cursor } = request.query as { kind?: ReferralOwnerKind; q?: string; cursor?: string }
      return noStore(reply).send(await listOwners(app.pg, { kind, q, cursor }))
    },
    owner: async (request: GwcRequest, reply: GwcReply) =>
      noStore(reply).send(await ownerDetail(app.pg, ownerParam(request))),
    ownerReferrals: async (request: GwcRequest, reply: GwcReply) => {
      const owner = ownerParam(request)
      await ownerDetail(app.pg, owner) // 404 for an account that does not exist
      return noStore(reply).send(await listReferrals(app.pg, owner, (request.query as { cursor?: string }).cursor))
    },
    ownerXp: async (request: GwcRequest, reply: GwcReply) => {
      const owner = ownerParam(request)
      await ownerDetail(app.pg, owner)
      return noStore(reply).send(await listXp(app.pg, owner, (request.query as { cursor?: string }).cursor))
    },
    disable: async (request: GwcRequest, reply: GwcReply) => {
      const { linkId } = request.params as { linkId: string }
      const { reason } = request.body as { reason: string }
      return reply.send(await disableLink(app, { linkId, adminId: adminId(request), reason, requestId: request.id }))
    },
    reverse: async (request: GwcRequest, reply: GwcReply) => {
      const { entryId } = request.params as { entryId: string }
      const { reason } = request.body as { reason: string }
      return reply.send(await reverseAward(app, { entryId, adminId: adminId(request), reason, requestId: request.id }))
    },
    rate: async (_request: GwcRequest, reply: GwcReply) => noStore(reply).send(await rateWithHistory(app.pg)),
    setRate: async (request: GwcRequest, reply: GwcReply) => {
      const { xp, reason } = request.body as { xp: number; reason: string }
      return reply.send(await setRate(app, { xp, adminId: adminId(request), reason, requestId: request.id }))
    },
  }
}
