/**
 * Thin query helper.
 *
 * Accepts an AbortSignal so a handler deadline cancels the underlying query
 * rather than merely abandoning the caller. `pg` has no native signal support,
 * so cancellation is done by closing the client the query is running on, which
 * is what actually frees the server-side work.
 */
export async function query(pool, sql, params = [], { signal } = {}) {
  if (!signal) return pool.query(sql, params)
  if (signal.aborted) throw signal.reason ?? new Error('aborted')

  const client = await pool.connect()
  let onAbort
  try {
    const result = await new Promise((resolve, reject) => {
      onAbort = () => {
        // Destroying the connection is what cancels the in-flight statement.
        client.release(new Error('query aborted'))
        reject(signal.reason ?? new Error('aborted'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      client.query(sql, params).then(resolve, reject)
    })
    return result
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
    if (!signal.aborted) client.release()
  }
}

/** Run `fn` inside a transaction, rolling back on any throw. */
export async function withTransaction(pool, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // The connection is already unusable; the original error is what matters.
    }
    throw err
  } finally {
    client.release()
  }
}
