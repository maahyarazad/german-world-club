import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { buildMediaApp, uploader, resetMedia, upload, photograph } from '../helpers/media.ts'
import { hasDatabase } from '../helpers/db.ts'
import { withTransaction } from '../../src/db/query.ts'
import { reserve, release, configure, read, SCOPE, QuotaExceededError } from '../../src/db/counters.ts'
import { BUCKETS } from '../../src/config/rate-limits.ts'
import { BREAKERS, FAIL_CLOSED, errorFilter } from '../../src/config/breakers.ts'

/**
 * FR-063 — the two independent ceilings on media, and the fail-closed rule.
 *
 * There are three distinct mechanisms here and they are easy to conflate:
 *
 *  - the `upload` **rate-limit bucket** answers "how often may this account
 *    ask?" It is a transport limit; retrying later works.
 *  - the per-account **stored-byte quota** answers "how much may this account
 *    keep?" It is a business quota: retrying changes nothing until the account
 *    deletes something. It lives in PostgreSQL under a row lock, because it
 *    must be exact under concurrency and must survive a Redis flush.
 *  - the **circuit breaker** answers "is the generator healthy?" When it is
 *    not, the rule is absolute: **zero assets recorded `ready`**.
 *
 * That last one is what the second half of this file is about. A `ready` asset
 * with no derivatives behind it is worse than a refused upload — every page
 * referencing it then has nothing to serve and no error to explain why.
 */
let app
beforeAll(async () => { app = await buildMediaApp() })
afterAll(async () => { await app.close() })

describe('the three mechanisms are kept apart', () => {
  it('makes the upload bucket fail closed — an unmeasurable limit is no limit', () => {
    expect(BUCKETS.upload.skipOnError).toBe(false)
    expect(BUCKETS.upload.dimension).toBe('account')
  })

  it('declares media generation fail-closed, with no fallback value (FR-037)', () => {
    expect(BREAKERS.mediaImage.fallback).toBe(FAIL_CLOSED)
    expect(BREAKERS.mediaVideo.fallback).toBe(FAIL_CLOSED)
  })

  it('refuses a fallback at the call site, so FR-063 cannot be undone locally', async () => {
    await expect(
      app.breakers.mediaImage.run(async () => { throw new Error('boom') }, { fallback: 'pretend it worked' }),
    ).rejects.toThrow(/fail-closed/)
  })

  it('does not count a business rejection against the circuit (FR-036)', () => {
    expect(errorFilter({ statusCode: 422 })).toBe(true)
    expect(errorFilter({ code: 'CARD_DECLINED' })).toBe(true)
    // A timeout or a crash is a real dependency failure and must count.
    expect(errorFilter({ code: 'ETIMEDOUT' })).toBe(false)
    expect(errorFilter({ statusCode: 500 })).toBe(false)
  })
})

describe.skipIf(!hasDatabase)('the transactional counter (FR-043)', () => {
  const SUBJECT = 'counter-test-subject'

  beforeEach(async () => {
    await app.pg.query('DELETE FROM counters WHERE subject = $1', [SUBJECT])
  })

  it('reserves up to the ceiling and refuses the next request', async () => {
    await withTransaction(app.pg, async (client) => {
      await configure(client, SCOPE.STORED_BYTES, SUBJECT, { limit: 100 })
      const after = await reserve(client, SCOPE.STORED_BYTES, SUBJECT, 60)
      expect(after).toMatchObject({ used: 60, limit: 100, remaining: 40 })
    })

    await expect(
      withTransaction(app.pg, (client) => reserve(client, SCOPE.STORED_BYTES, SUBJECT, 50)),
    ).rejects.toThrow(QuotaExceededError)
  })

  it('reports how much room is left, so a client can be told something useful', async () => {
    await withTransaction(app.pg, async (client) => {
      await configure(client, SCOPE.STORED_BYTES, SUBJECT, { limit: 100 })
      await reserve(client, SCOPE.STORED_BYTES, SUBJECT, 90)
    })

    const error = await withTransaction(app.pg, (client) =>
      reserve(client, SCOPE.STORED_BYTES, SUBJECT, 20),
    ).catch((err) => err)

    expect(error).toBeInstanceOf(QuotaExceededError)
    expect(error).toMatchObject({ used: 90, limit: 100, requested: 20, remaining: 10 })
  })

  /**
   * The reason this is a row lock and not a read-then-write. Two concurrent
   * reservations that each read "60 used of 100" would both decide they may
   * take 30 more, and the counter would land at 120.
   */
  it('serialises concurrent reservations rather than letting both read the same value', async () => {
    await withTransaction(app.pg, (client) =>
      configure(client, SCOPE.STORED_BYTES, SUBJECT, { limit: 100 }),
    )

    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        withTransaction(app.pg, (client) => reserve(client, SCOPE.STORED_BYTES, SUBJECT, 30)),
      ),
    )

    const granted = attempts.filter((a) => a.status === 'fulfilled').length
    expect(granted, 'exactly three reservations of 30 fit under 100').toBe(3)

    const state = await read(app.pg, SCOPE.STORED_BYTES, SUBJECT)
    expect(state.used).toBe(90)
    expect(state.used).toBeLessThanOrEqual(state.limit)
  })

  it('rolls the reservation back when the caller’s transaction fails', async () => {
    await withTransaction(app.pg, (client) =>
      configure(client, SCOPE.STORED_BYTES, SUBJECT, { limit: 100 }),
    )

    await expect(
      withTransaction(app.pg, async (client) => {
        await reserve(client, SCOPE.STORED_BYTES, SUBJECT, 50)
        // The work the reservation was for fails after the counter moved.
        throw new Error('the actual work failed')
      }),
    ).rejects.toThrow('the actual work failed')

    // Had the reservation committed separately, the account would have lost
    // 50 bytes of quota to an action that never happened.
    expect((await read(app.pg, SCOPE.STORED_BYTES, SUBJECT)).used).toBe(0)
  })

  it('releases back, clamped at zero so a double release cannot mint capacity', async () => {
    await withTransaction(app.pg, async (client) => {
      await configure(client, SCOPE.STORED_BYTES, SUBJECT, { limit: 100 })
      await reserve(client, SCOPE.STORED_BYTES, SUBJECT, 40)
      await release(client, SCOPE.STORED_BYTES, SUBJECT, 40)
      await release(client, SCOPE.STORED_BYTES, SUBJECT, 40)
    })
    expect((await read(app.pg, SCOPE.STORED_BYTES, SUBJECT)).used).toBe(0)
  })

  it('treats an unset limit as unbounded, which is not the same as zero', async () => {
    await withTransaction(app.pg, async (client) => {
      const after = await reserve(client, SCOPE.STORED_BYTES, SUBJECT, 10_000_000)
      expect(after.limit).toBeNull()
      expect(after.remaining).toBeNull()
    })
  })
})

describe.skipIf(!hasDatabase)('the stored-byte quota refuses an upload (FR-063)', () => {
  let app2
  let headers
  let member

  beforeAll(async () => {
    // A deliberately tiny ceiling, so one ordinary photograph crosses it.
    app2 = await buildMediaApp()
    const u = await uploader(app2)
    headers = u.headers
    member = u.member
  })

  afterAll(async () => { await app2.close() })

  beforeEach(async () => { await resetMedia(app2.pg) })

  it('answers 409 media-quota-exceeded once the ceiling is reached', async () => {
    await withTransaction(app2.pg, (client) =>
      configure(client, SCOPE.STORED_BYTES, member.id, { limit: 1024 }),
    )

    const response = await upload(app2, headers, {
      file: await photograph({ width: 2400, height: 1600 }), filename: 'p.jpg', alt: 'Too big to keep',
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().type).toMatch(/media-quota-exceeded/)
  })

  it('records no asset when the quota refuses', async () => {
    await withTransaction(app2.pg, (client) =>
      configure(client, SCOPE.STORED_BYTES, member.id, { limit: 1024 }),
    )

    await upload(app2, headers, {
      file: await photograph({ width: 2400, height: 1600 }), filename: 'p.jpg', alt: 'Too big',
    })

    const { rows } = await app2.pg.query('SELECT count(*)::int AS n FROM assets')
    expect(rows[0].n).toBe(0)
  })

  it('admits the same upload once the ceiling is raised', async () => {
    await withTransaction(app2.pg, (client) =>
      configure(client, SCOPE.STORED_BYTES, member.id, { limit: 50_000_000 }),
    )

    const response = await upload(app2, headers, {
      file: await photograph({ width: 2400, height: 1600 }), filename: 'p.jpg', alt: 'Now it fits',
    })
    expect(response.statusCode).toBe(201)
  })
})

describe.skipIf(!hasDatabase)('with the generator failing, ZERO assets are ready (FR-063)', () => {
  let app3
  let headers

  beforeAll(async () => {
    app3 = await buildMediaApp()
    headers = (await uploader(app3)).headers
  })

  afterAll(async () => { await app3.close() })

  beforeEach(async () => { await resetMedia(app3.pg) })

  it('answers 503 rather than storing an asset with no derivatives', async () => {
    // The generator itself is made to fail, which is what the fail-closed
    // policy is written for — not a network error the breaker would see anyway.
    const broken = vi.spyOn(app3.breakers.mediaImage, 'run').mockRejectedValue(
      Object.assign(new Error('derivative generation unavailable'), { statusCode: 503 }),
    )

    try {
      const response = await upload(app3, headers, {
        file: await photograph({ width: 1200, height: 800 }), filename: 'p.jpg', alt: 'A photograph',
      })
      expect(response.statusCode).toBe(503)
    } finally {
      broken.mockRestore()
    }
  })

  it('leaves the assets table completely empty, not merely without variants', async () => {
    const broken = vi.spyOn(app3.breakers.mediaImage, 'run').mockRejectedValue(
      Object.assign(new Error('derivative generation unavailable'), { statusCode: 503 }),
    )

    try {
      for (let i = 0; i < 3; i += 1) {
        await upload(app3, headers, {
          file: await photograph({ width: 1200, height: 800 + i }), filename: 'p.jpg', alt: 'A photograph',
        })
      }
    } finally {
      broken.mockRestore()
    }

    const { rows } = await app3.pg.query(`SELECT count(*)::int AS n FROM assets`)
    expect(rows[0].n, 'no asset may be recorded at all').toBe(0)

    const { rows: ready } = await app3.pg.query(`SELECT count(*)::int AS n FROM assets WHERE state = 'ready'`)
    expect(ready[0].n).toBe(0)
  })

  it('recovers on the next upload once the generator works again', async () => {
    const response = await upload(app3, headers, {
      file: await photograph({ width: 1200, height: 800 }), filename: 'p.jpg', alt: 'A photograph',
    })
    expect(response.statusCode).toBe(201)
    expect(response.json().state).toBe('ready')
  })
})
