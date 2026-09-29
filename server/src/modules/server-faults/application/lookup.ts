import { query } from '../../../db/query.ts'
import type { ServerFault } from '@gwc/contracts/server-faults'
import type { GwcApp } from '../../../app.ts'

/**
 * Reading server fault records (feature 012, contracts/server-faults-api.md).
 *
 * Columns are named, never `*`: a column added to server_faults later must not
 * reach the staff console until someone decides it should.
 */

export const FAULT_COLUMNS = `
  id, occurred_at, request_id, client_request_id, method, route, status,
  error_name, error_code, message, principal_kind, principal_id, fingerprint`

export type FaultRow = {
  id: string
  occurred_at: Date
  request_id: string
  client_request_id: string | null
  method: string
  route: string | null
  status: number
  error_name: string
  error_code: string | null
  message: string
  stack?: string | null
  principal_kind: ServerFault['principalKind']
  principal_id: string | null
  fingerprint: string
}

export function toServerFault(row: FaultRow): Omit<ServerFault, 'stack'> & { stack?: string | null } {
  return {
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    requestId: row.request_id,
    clientRequestId: row.client_request_id,
    method: row.method,
    route: row.route,
    status: row.status,
    errorName: row.error_name,
    errorCode: row.error_code,
    message: row.message,
    ...(row.stack !== undefined ? { stack: row.stack } : {}),
    principalKind: row.principal_kind,
    principalId: row.principal_id,
    fingerprint: row.fingerprint,
  }
}

/** The one fault a request id names, or null. Request ids are unique (research R10). */
export async function lookupByRequestId(
  app: GwcApp,
  { requestId, signal }: { requestId: string; signal?: AbortSignal },
): Promise<ServerFault | null> {
  const { rows } = await query<FaultRow>(
    app.pg,
    `SELECT ${FAULT_COLUMNS}, stack FROM server_faults WHERE request_id = $1`,
    [requestId],
    { signal },
  )
  return rows[0] ? (toServerFault(rows[0]) as ServerFault) : null
}
