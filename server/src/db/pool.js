import pg from 'pg'
import { tightestDeadlineMs } from '../config/budgets.js'

/**
 * PostgreSQL pool.
 *
 * `statement_timeout` sits just *inside* the tightest handler deadline (timeout
 * layer 4), so a runaway query is killed by the database before the handler
 * deadline fires. Otherwise the request is answered while the query keeps
 * running and the connection stays busy.
 */
export function createPool(env) {
  const statementTimeout = Math.max(250, tightestDeadlineMs() - 100)
  return new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: env.isTest ? 4 : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: statementTimeout,
    application_name: 'gwc-server',
  })
}
