/**
 * An edit-conflict version: a row's `updated_at`, formatted by the database to
 * the microsecond.
 *
 * A JavaScript Date keeps milliseconds only, so a token built from one would
 * equal the next change's token whenever two edits land in the same
 * millisecond, and a stale edit would pass. The database stamps `updated_at` on
 * every UPDATE (a trigger), so no code path can forget to move it.
 */
export const versionSql = (alias: string) =>
  `to_char(${alias}.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
