import { PROBLEMS } from '@gwc/contracts/errors'
import { query } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { FAULT_COLUMNS, toServerFault } from './lookup.ts'
import type { FaultRow } from './lookup.ts'
import type { ServerFaultListResponse, ServerFaultSummary } from '@gwc/contracts/server-faults'
import type { GwcApp } from '../../../app.ts'

/**
 * Recent server faults, newest first (feature 012, Story 3).
 *
 * Keyset pagination on (occurred_at, id) rather than OFFSET: faults keep
 * arriving while someone pages, and an offset would shift under them — the
 * same fault shown twice, or one skipped. The cursor is opaque to the client.
 */

type ListInput = {
  before?: string
  fingerprint?: string
  clientRequestId?: string
  limit: number
  signal?: AbortSignal
}

const encodeCursor = (row: FaultRow) =>
  Buffer.from(`${row.occurred_at.toISOString()}|${row.id}`).toString('base64url')

function decodeCursor(cursor: string): [Date, string] {
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
  const date = new Date(at ?? '')
  if (!id || Number.isNaN(date.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw forbidden(PROBLEMS.VALIDATION_FAILED, 'The cursor is not one this server issued.')
  }
  return [date, id]
}

export async function listServerFaults(
  app: GwcApp,
  { before, fingerprint, clientRequestId, limit, signal }: ListInput,
): Promise<ServerFaultListResponse> {
  const [beforeAt, beforeId] = before ? decodeCursor(before) : [null, null]

  // One more than asked for: whether it exists is whether there is a next page.
  const { rows } = await query<FaultRow>(
    app.pg,
    `SELECT ${FAULT_COLUMNS}
       FROM server_faults
      WHERE ($1::timestamptz IS NULL OR (occurred_at, id) < ($1::timestamptz, $2::uuid))
        AND ($3::text IS NULL OR fingerprint = $3)
        AND ($4::text IS NULL OR client_request_id = $4)
      ORDER BY occurred_at DESC, id DESC
      LIMIT $5`,
    [beforeAt, beforeId, fingerprint ?? null, clientRequestId ?? null, limit + 1],
    { signal },
  )
  const page = rows.slice(0, limit)

  const suppressed = await query<{ n: number }>(
    app.pg,
    `SELECT coalesce(sum(suppressed), 0)::int AS n
       FROM server_fault_suppressions
      WHERE minute > now() - interval '24 hours'`,
    [],
    { signal },
  )

  return {
    items: page.map((row) => toServerFault(row) as ServerFaultSummary),
    nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]!) : null,
    suppressedLast24h: suppressed.rows[0]?.n ?? 0,
  }
}
