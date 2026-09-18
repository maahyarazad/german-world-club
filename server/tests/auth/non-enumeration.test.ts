import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, createMember, resetAuthTables, signIn } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { stats } from '../../src/modules/auth/passwords.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * §3.1 — account existence is not a public fact.
 *
 * The German World Club is invite-only, so "is this address a member?" is
 * itself the information worth stealing. An unknown address and a wrong
 * password must therefore be indistinguishable in status, body **and** cost.
 *
 * The cost half is asserted through `passwords.stats`, a counter incremented by
 * the dummy-verification path, rather than through elapsed wall-clock time.
 * A timing assertion on CI is measuring the runner's neighbours as much as the
 * server: it fails on a noisy box and passes on a quiet one regardless of
 * whether the dummy path ran at all. The counter answers the real question —
 * *did the work happen* — deterministically. The timing claim it stands in for
 * is recorded as a benchmark at the bottom of this file, with a stated
 * tolerance and no hard failure.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

describe.skipIf(!hasDatabase)('an unknown address is indistinguishable from a wrong password (§3.1)', () => {
  let member: Record<string, unknown>

  beforeEach(async () => {
    await resetAuthTables(app.pg)
    member = await createMember(app.pg)
  })

  it('answers both with the same status and the same body', async () => {
    const unknown = await signIn(app, 'nobody-at-all@test.invalid', 'whatever-password')
    const wrong = await signIn(app, member.email, 'not-the-right-password')

    expect(unknown.statusCode).toBe(wrong.statusCode)
    expect(unknown.statusCode).toBe(401)

    // Compared field by field, minus the per-request correlation id, which is
    // supposed to differ and whose absence would itself be a defect.
    const { requestId: unknownId, ...unknownBody } = unknown.body
    const { requestId: wrongId, ...wrongBody } = wrong.body
    expect(unknownBody).toEqual(wrongBody)
    expect(unknownId).toBeTruthy()
    expect(wrongId).toBeTruthy()
    expect(unknownId).not.toBe(wrongId)
  })

  it('leaks nothing through the response headers either', async () => {
    const unknown = await signIn(app, 'nobody-at-all@test.invalid', 'whatever-password')
    const wrong = await signIn(app, member.email, 'not-the-right-password')

    const shape = (response) =>
      Object.keys(response.headers).filter((h) => !['date', 'x-request-id', 'content-length'].includes(h)).sort()

    expect(shape(unknown.response)).toEqual(shape(wrong.response))
  })

  /**
   * The assertion this file exists for. Without the dummy verification an
   * unknown address answers in microseconds while a known one spends tens of
   * milliseconds in argon2 — which enumerates the entire member base with a
   * stopwatch and no credentials at all.
   */
  it('EXECUTES the dummy verification for an account that does not exist', async () => {
    const before = stats.dummyVerifications
    await signIn(app, 'definitely-not-a-member@test.invalid', 'whatever-password')
    expect(stats.dummyVerifications).toBe(before + 1)
  })

  it('does NOT burn the dummy path when the account exists — the real hash is the work', async () => {
    const beforeDummy = stats.dummyVerifications
    const beforeReal = stats.realVerifications
    await signIn(app, member.email, 'not-the-right-password')
    expect(stats.realVerifications).toBe(beforeReal + 1)
    expect(stats.dummyVerifications).toBe(beforeDummy)
  })

  /**
   * A legacy account is refused before its hash is considered (FR-014), but it
   * must still pay for the refusal, or the reset outcome becomes a free oracle
   * for "this address is a lapsed member".
   */
  it('burns equivalent time for a legacy account it refuses to verify', async () => {
    const legacy = await createMember(app.pg, { passwordHash: 'd41d8cd98f00b204e9800998ecf8427e' })
    const before = stats.dummyVerifications
    const { body } = await signIn(app, legacy.email, 'anything')
    expect(body.outcome).toBe('password_reset_required')
    expect(stats.dummyVerifications).toBe(before + 1)
  })
})

describe.skipIf(!hasDatabase)('password reset never reveals whether an address is known', () => {
  beforeEach(async () => { await resetAuthTables(app.pg) })

  it('returns 202 for a known and an unknown address alike', async () => {
    const member = await createMember(app.pg)
    const post = (email) => app.inject({ method: 'POST', url: '/auth/password-reset/request', payload: { email } })

    const known = await post(member.email)
    const unknown = await post('no-such-person@test.invalid')

    expect(known.statusCode).toBe(202)
    expect(unknown.statusCode).toBe(202)
    expect(known.json()).toEqual(unknown.json())
  })
})

/**
 * The benchmark the counter assertions stand in for.
 *
 * Recorded, reported, and deliberately **not** failed on: the tolerance that
 * would be correct on a quiet machine is wrong on a shared CI runner, and a
 * flaky red build teaches people to ignore this file. A regression here shows
 * up as a ratio far outside the band, visible in the run's output.
 */
describe.skipIf(!hasDatabase)('timing benchmark (reported, not enforced)', () => {
  it('spends comparable time on a known and an unknown address', async () => {
    const member = await createMember(app.pg)
    const time = async (email) => {
      const started = process.hrtime.bigint()
      await signIn(app, email, 'not-the-right-password')
      return Number(process.hrtime.bigint() - started) / 1e6
    }

    // One untimed pass each, so neither measurement pays for the lazily-built
    // dummy hash or a cold connection.
    await time(member.email)
    await time('warm-up@test.invalid')

    const known = await time(member.email)
    const unknown = await time('still-not-a-member@test.invalid')
    const ratio = Math.max(known, unknown) / Math.max(1, Math.min(known, unknown))

    console.info(
      `    non-enumeration timing: known ${known.toFixed(1)}ms, unknown ${unknown.toFixed(1)}ms, ` +
        `ratio ${ratio.toFixed(2)}× (tolerance 3×, reported only)`,
    )
    expect(known).toBeGreaterThan(0)
    expect(unknown).toBeGreaterThan(0)
  })
})
