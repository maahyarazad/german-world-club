import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { PLATFORM_JOBS } from '../../src/ops/jobs.ts'
import { buildAuthApp } from '../helpers/auth.ts'
import { hasDatabase, resetServerFaults } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * SC-006 / FR-007 (feature 012): records live 30 days, then the retention job
 * removes them — and only it, and only while it is enabled.
 */
const JOB = 'server-faults.prune'

describe('the retention job is declared', () => {
  it('is a platform job, daily, individually switchable like every job', () => {
    expect(PLATFORM_JOBS.find((job) => job.name === JOB)).toMatchObject({ schedule: '30 3 * * *' })
  })
})

describe.skipIf(!hasDatabase)('server-faults.prune', () => {
  let app: GwcApp
  let n = 0
  const insert = (age: string) =>
    app.pg.query(
      `INSERT INTO server_faults (occurred_at, request_id, method, status, error_name, message, fingerprint, instance_id)
       VALUES (now() - $1::interval, $2, 'GET', 500, 'Error', 'boom', repeat('c', 64), 'test:1')`,
      [age, `01J8Z3K2QY${String(++n).padStart(16, '0')}`],
    )
  const count = async (table: string) =>
    (await app.pg.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n

  beforeAll(async () => { app = await buildAuthApp() })
  beforeEach(async () => {
    await resetServerFaults(app.pg)
    await app.pg.query('UPDATE job_definitions SET enabled = true WHERE name = $1', [JOB])
    await insert('31 days')
    await insert('1 day')
    await app.pg.query(
      `INSERT INTO server_fault_suppressions (minute, instance_id, suppressed)
       VALUES (date_trunc('minute', now() - interval '31 days'), 'test:1', 4),
              (date_trunc('minute', now() - interval '1 day'), 'test:1', 2)`,
    )
  })
  afterAll(async () => {
    await app.pg.query('UPDATE job_definitions SET enabled = true WHERE name = $1', [JOB])
    await resetServerFaults(app.pg)
    await app.close()
  })

  it('removes expired rows from both tables and keeps fresh ones', async () => {
    const result = await app.runJob(JOB)
    expect(result).toMatchObject({ outcome: 'success', itemsProcessed: 2 })
    expect(await count('server_faults')).toBe(1)
    expect(await count('server_fault_suppressions')).toBe(1)
  })

  it('does nothing while disabled', async () => {
    // Counter-assertion: a job that ignored its flag would pass the test above.
    await app.pg.query('UPDATE job_definitions SET enabled = false WHERE name = $1', [JOB])
    expect(await app.runJob(JOB)).toMatchObject({ outcome: 'skipped' })
    expect(await count('server_faults')).toBe(2)
  })
})
