/**
 * The two kinds of request id (feature 012, research R10).
 *
 * One definition each, imported by the server and every client, so the shape
 * the server generates and the shape a lookup accepts cannot drift apart
 * (Constitution Principle I). The migration's CHECK constraints restate both;
 * a database constraint repeating a rule is enforcement, not a second rule.
 */

/**
 * A request's own id: a ULID the server generates for every request.
 *
 * Never chosen by a client. It keys the logs, `audit_log` and `server_faults`,
 * and it sorts by creation time — which is why a client-supplied value may
 * never become it: a client could repeat one, collide with another request's,
 * or pick one that sorts anywhere.
 */
export const REQUEST_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/

/**
 * A client's own correlation id, as sent in `x-request-id`.
 *
 * Kept for support correlation only: echoed on `x-client-request-id`, logged
 * as `clientRequestId`, stored on a fault record. Never used as a key, never
 * trusted for anything but finding the request again.
 */
export const CLIENT_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/

export const isRequestId = (value: unknown): value is string =>
  typeof value === 'string' && REQUEST_ID.test(value)

export const isClientRequestId = (value: unknown): value is string =>
  typeof value === 'string' && CLIENT_REQUEST_ID.test(value)
