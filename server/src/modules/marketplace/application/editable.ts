import { PROBLEMS } from '@gwc/contracts/errors'
import { EDITABLE_STATES } from '@gwc/contracts/marketplace'
import { forbidden } from '../../../authz/require-permission.ts'
import type { OwnerFlags } from '@gwc/contracts/marketplace'

/**
 * What the owner's screen may offer, decided here and nowhere else (Principle
 * I). A client only draws what these say; the write paths below re-check the
 * state themselves, so a stale or forged flag grants nothing.
 */
export function ownerFlags(state: string): OwnerFlags {
  return {
    canEdit: (EDITABLE_STATES as readonly string[]).includes(state),
    // An active listing is already published; it can only be unpublished.
    canPublish: state === 'draft' || state === 'expired',
    moderated: state === 'hidden',
  }
}

const notEditable = (state: string) =>
  forbidden(PROBLEMS.MARKETPLACE_NOT_EDITABLE,
    state === 'hidden'
      ? 'This listing was disabled by staff and cannot be changed.'
      : `A ${state} listing can no longer be edited.`)


/** Throws unless the owner may still change a listing in this state. */
export function assertEditable(state: string): void {
  if (!ownerFlags(state).canEdit) throw notEditable(state)
}
