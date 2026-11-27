import { PROBLEMS } from '@gwc/contracts/errors'
import { forbidden } from '../../authz/require-permission.ts'
import { setMainMedia } from './application/offer-media.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'

/** Request and reply shaping for staff acting on a merchant offer. The rule lives in `application/`. */
export function createOfferStaffController(app: GwcApp) {
  return {
    setMainMedia: async (request: GwcRequest, reply: GwcReply) => {
      const { id } = request.params as { id: string }
      // The posture vocabulary has no "superadmin only", so the route declares the module
      // and this refuses everyone else, as the dashboard figures do. A plain staff member
      // holding `merchant_offers.edit` gets past the gate and stops here, and it is audited.
      if (!request.permissions?.isSuperadmin) {
        await app.auditDenial(request, { requiredPermission: 'superadmin', targetType: 'offer', targetId: id })
        throw forbidden(PROBLEMS.INSUFFICIENT_PERMISSION, 'Only a super admin may choose an offer’s main media.')
      }
      return reply.send(await setMainMedia(app, {
        scope: { anyOrganisation: true },
        // `admin` is the account kind a staff principal carries (and what `audit_log.actor_kind` accepts).
        actor: { id: String(request.principal!.id), kind: 'admin', requestId: request.id },
        offerId: id,
        assetId: (request.body as { assetId: string }).assetId,
      }))
    },
  }
}
