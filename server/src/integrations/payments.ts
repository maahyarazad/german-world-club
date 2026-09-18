import { createHash } from 'node:crypto'
import { requestDependency } from './http-client.ts'
import { PROBLEMS } from '@gwc/contracts/errors'
import type { Problem } from '@gwc/contracts/errors'
import { decorateError } from '../types/errors.ts'
import type { DecoratedError } from '../types/errors.ts'

/**
 * Payments — the one dependency with **no safe fallback** (FR-037, FR-038).
 *
 * A breaker's usual kindness is to return something when the dependency is
 * down. There is nothing safe to return here: a fallback that lets checkout
 * proceed hands out membership cards and event seats for free, and the club
 * finds out at reconciliation. So the declared behaviour is an explicit, loud
 * failure, and `13-breakers.js` refuses a fallback at the call site so this
 * cannot be quietly undone later.
 *
 * The other half of the rule is FR-038: a retry through a breaker is only
 * applied to operations that are safe to repeat. A payment is not — unless it
 * carries the deterministic reference below, which is what makes the repeat
 * land on the same invoice instead of raising a second one.
 */

/** A declined card is a business outcome, not a dependency failure (FR-036). */
export class CardDeclinedError extends Error {
  readonly code: string
  readonly statusCode: number
  readonly problem: Problem
  readonly safeDetail: string

  constructor(detail = 'The card was declined.') {
    super(detail)
    this.name = 'CardDeclinedError'
    this.code = 'CARD_DECLINED'
    this.statusCode = 402
    this.problem = { ...PROBLEMS.CONFLICT, title: 'Payment declined', status: 402 }
    this.safeDetail = detail
  }
}

/**
 * The deterministic idempotency reference (§12.5).
 *
 * Derived from *what is being paid for*, never from a timestamp or a random
 * value. That is the whole point: after a timeout the client cannot tell
 * whether the charge happened, so it retries — and the retry must be
 * recognisable to the gateway as the same intent. A reference containing
 * `Date.now()` produces a second invoice and a second charge, which is the
 * failure this exists to prevent.
 *
 * Hashed rather than concatenated so the reference does not leak the member id
 * to the gateway or into its logs.
 */
export type ChargeInput = {
  accountId: string
  purpose: string
  targetId: string
  amountMinor: number
  currency?: string
}

export function idempotencyReference({ accountId, purpose, targetId, amountMinor, currency }: ChargeInput): string {
  const material = [accountId, purpose, targetId, amountMinor, currency].join(':')
  return `gwc_${createHash('sha256').update(material).digest('hex').slice(0, 32)}`
}

/**
 * The gateway stub.
 *
 * The real integration is a separate feature; what is fixed here is the shape
 * and the failure behaviour, which is what the resilience story needs to be
 * testable. `send` is injectable so a suite can drive each failure mode.
 */
export function createPaymentsClient({ baseUrl = 'https://payments.invalid', send = requestDependency } = {}) {
  return {
    name: 'payments',

    /**
     * Charge, carrying the idempotency reference so a retry after recovery is
     * harmless (FR-038).
     */
    async charge(
    { accountId, purpose, targetId, amountMinor, currency = 'AED' }: ChargeInput,
    { signal }: { signal?: AbortSignal } = {},
  ) {
      const reference = idempotencyReference({ accountId, purpose, targetId, amountMinor, currency })

      const response = await send('payments', `${baseUrl}/charges`, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          // The gateway keys on this; the same reference returns the original
          // charge rather than creating a second.
          'idempotency-key': reference,
        },
        body: JSON.stringify({ amountMinor, currency, reference }),
      })

      const result = (await response.body.json()) as {
        status?: string
        reason?: string
        invoiceId?: string
      }

      if (result.status === 'declined') {
        // Surfaced as a distinct error so `errorFilter` can keep it off the
        // breaker. Twenty declines on a busy evening must not take payments
        // down for everyone (SC-012).
        throw new CardDeclinedError(result.reason ?? 'The card was declined.')
      }

      return { status: 'paid', reference, invoiceId: result.invoiceId ?? reference }
    },
  }
}

/**
 * The declared unavailable behaviour: refuse.
 *
 * Exported as a named function rather than left implicit, so the intent is
 * greppable and a future change reads as a decision rather than an oversight.
 */
export function paymentsUnavailable(): DecoratedError {
  return decorateError('Payments are temporarily unavailable.', {
    problem: PROBLEMS.SERVICE_UNAVAILABLE,
    statusCode: 503,
    safeDetail:
      'Payments are temporarily unavailable. No charge was made. Please try again shortly.',
  })
}
