import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'
/**
 * Thin query helper.
 *
 * Accepts an AbortSignal so a handler deadline cancels the underlying query
 * rather than merely abandoning the caller. `pg` has no native signal support,
 * so cancellation is done by closing the client the query is running on, which
 * is what actually frees the server-side work.
 */
export async function query<Row extends QueryResultRow = QueryResultRow>(
  pool: Pool,
  sql: string,
  params: readonly unknown[] = [],
  { signal }: { signal?: AbortSignal } = {},
): Promise<QueryResult<Row>> {
  if (!signal) return pool.query<Row>(sql, params as unknown[])
  if (signal.aborted) throw signal.reason ?? new Error('aborted')

  const client = await pool.connect()
  let onAbort: (() => void) | undefined
  try {
    const result = await new Promise<QueryResult<Row>>((resolve, reject) => {
      onAbort = () => {
        // Destroying the connection is what cancels the in-flight statement.
        client.release(new Error('query aborted'))
        reject(signal.reason ?? new Error('aborted'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      client.query<Row>(sql, params as unknown[]).then(resolve, reject)
    })
    return result
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
    if (!signal.aborted) client.release()
  }
}

/**
 * Run `fn` inside a transaction, rolling back on any throw.
 *
 * `signal` is the caller's deadline (FR-034). When it aborts, the connection is
 * destroyed, which is what actually cancels the statement PostgreSQL is running
 * — rolling back afterwards would first have to wait for that statement to
 * finish, which is precisely the thing that has gone wrong.
 *
 * The transaction is checked once before it opens and again on abort, rather
 * than around every statement inside `fn`: a handler that has already run out
 * of time should not start a transaction, and one that runs out mid-way is
 * interrupted rather than politely asked to stop.
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
  { signal }: { signal?: AbortSignal } = {},
): Promise<T> {
  if (signal?.aborted) throw signal.reason ?? new Error('aborted')

  const client = await pool.connect()
  let aborted = false
  const onAbort = () => {
    aborted = true
    // Destroying the connection cancels the in-flight statement. The server
    // rolls the transaction back when the connection drops, so no explicit
    // ROLLBACK is possible or needed.
    client.release(new Error('transaction aborted by deadline'))
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    if (!aborted) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // The connection is already unusable; the original error is what matters.
      }
    }
    throw err
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (!aborted) client.release()
  }
}
