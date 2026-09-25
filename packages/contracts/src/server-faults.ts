/**
 * Server fault records (feature 012, specs/012-error-persistence/contracts/
 * server-faults-api.md).
 *
 * One unexpected fault that ended a request, as the staff console reads it.
 * `message` and `stack` are server English, scrubbed and truncated at write
 * time; the console shows them verbatim and never translates them.
 */

export type ServerFaultPrincipalKind = 'member' | 'admin' | 'merchant' | 'partner'

export type ServerFault = {
  id: string
  /** ISO 8601. */
  occurredAt: string
  /** Server-generated ULID — the id the member was shown. Unique. */
  requestId: string
  /** The client's own correlation id, when it sent a well-formed one. */
  clientRequestId: string | null
  method: string
  /** The route pattern (`/member/events/:id`), never a URL. `null` when no route matched. */
  route: string | null
  status: number
  errorName: string
  errorCode: string | null
  message: string
  stack: string | null
  /** `null` for an anonymous request. */
  principalKind: ServerFaultPrincipalKind | null
  principalId: string | null
  /** Hex SHA-256; the same error at the same place shares one. */
  fingerprint: string
}

/** A list row: everything but the stack, which only the lookup returns. */
export type ServerFaultSummary = Omit<ServerFault, 'stack'>

export type ServerFaultListQuery = {
  before?: string
  fingerprint?: string
  clientRequestId?: string
  limit?: number
}

export type ServerFaultListResponse = {
  items: ServerFaultSummary[]
  /** `null` when there are no older rows. */
  nextCursor: string | null
  /** Faults counted but not stored in full during the last 24 hours. */
  suppressedLast24h: number
}

export type ServerFaultLookupResponse = {
  item: ServerFault
}

export const FINGERPRINT = /^[0-9a-f]{64}$/
