import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import pg from 'pg'
import { createServerFaultRecorder } from '../../src/decorators/server-faults.ts'
import { createMetrics } from '../../src/ops/metrics.ts'
import { hasDatabase, resetServerFaults } from '../helpers/db.ts'

/**
 * FR-006 (feature 012, research R3): a fault storm cannot become database load.
 * Beyond the per-minute cap, and beyond two inserts in flight, faults are
 * counted — and the count is written once per minute, additively.
 */
const fault = (n: number) => ({
  requestId: `01J8Z3K2QX${String(n).padStart(16, '0')}`,
  clientRequestId: null, method: 'GET', route: '/probe', status: 500,
  errorName: 'Error', errorCode: null, message: 'boom', stack: null,
  principalKind: null, principalId: null,
})
const silent = { warn() {} }

describe('the recorder caps a burst', () => {
  it('stores up to the cap in a minute and counts the rest', async () => {
    let now = Date.UTC(2026, 8, 24, 10, 0, 5)
    const inserted: unknown[] = []
    const flushed: Array<[Date, number]> = []
    const metrics = createMetrics()
    const record = createServerFaultRecorder({
      perMinute: 5, clock: () => now, metrics, log: silent, instanceId: 'test:1',
      insert: async (row) => { inserted.push(row) },
      insertSuppressions: async (minute, count) => { flushed.push([minute, count]) },
    })

    for (let i = 0; i < 20; i++) { record(fault(i)); await record.drain() }
    expect(inserted).toHaveLength(5)
    expect(metrics.snapshot().serverFaults).toMatchObject({ stored: 5, suppressed: 15 })
    expect(flushed).toHaveLength(0)

    now += 60_000 // next minute: the first fault in it flushes the last minute's count
    record(fault(99))
    await record.drain()
    expect(flushed).toEqual([[new Date(Date.UTC(2026, 8, 24, 10, 0)), 15]])
    expect(inserted).toHaveLength(6)
  })

  it('suppresses rather than queues a third concurrent insert', async () => {
    const release: Array<() => void> = []
    const inserted: unknown[] = []
    const metrics = createMetrics()
    const record = createServerFaultRecorder({
      perMinute: 100, metrics, log: silent, instanceId: 'test:1',
      insert: (row) => new Promise<void>((resolve) => { inserted.push(row); release.push(resolve) }),
      insertSuppressions: async () => {},
    })
    record(fault(1)); record(fault(2)); record(fault(3))
    expect(inserted).toHaveLength(2)
    expect(metrics.snapshot().serverFaults.suppressed).toBe(1)
    release.forEach((r) => r()); await record.drain()
    // Counter-assertion: once the pool is free, the next one is stored again.
    record(fault(4)); release.at(-1)?.(); await record.drain()
    expect(inserted).toHaveLength(3)
  })
})

describe.skipIf(!hasDatabase)('the suppression flush against Postgres', () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  beforeAll(async () => { await resetServerFaults(pool) })
  beforeEach(async () => { await resetServerFaults(pool) })
  afterAll(async () => { await resetServerFaults(pool); await pool.end() })

  it('adds a retried flush of the same minute instead of inserting it twice', async () => {
    const now = Date.UTC(2026, 8, 24, 10, 0, 5)
    const record = createServerFaultRecorder({
      pool, perMinute: 1, clock: () => now, metrics: createMetrics(), log: silent, instanceId: 'test:1',
    })
    record(fault(1)); record(fault(2)); record(fault(3))
    await record.drain()
    await record.flushSuppressions()
    record(fault(4)); record(fault(5)) // same minute: 4 is suppressed (cap 1 already used), 5 too
    await record.drain()
    await record.flushSuppressions()

    const { rows } = await pool.query('SELECT minute, instance_id, suppressed FROM server_fault_suppressions')
    expect(rows).toEqual([{ minute: new Date(Date.UTC(2026, 8, 24, 10, 0)), instance_id: 'test:1', suppressed: 4 }])
    const faults = await pool.query('SELECT count(*)::int AS n FROM server_faults')
    expect(faults.rows[0].n).toBe(1)
  })
})
