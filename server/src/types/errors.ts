import type { Problem } from '@gwc/contracts/errors'

/**
 * An Error carrying what the RFC 9457 handler needs to shape a response.
 *
 * Several integrations raise a plain Error and attach these before throwing;
 * `plugins/08-error-handler` reads them. Declaring the shape here means the
 * handler and the raisers agree, rather than each assuming.
 */
export type DecoratedError = Error & {
  /** The problem type, title and status the client will see. */
  problem?: Problem & { title?: string }
  statusCode?: number
  /** Safe to show a member; `detail` may not be. */
  safeDetail?: string
}

/** Build one in a single expression, so the fields cannot drift apart. */
export function decorateError(
  message: string,
  fields: Omit<DecoratedError, keyof Error>,
): DecoratedError {
  return Object.assign(new Error(message), fields)
}
