import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { resetAuthTables, createAdmin } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildReferralApp, memberOwner, linkOf, registerAndVerify, counts } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * FR-006 / SC-006: nobody can tell from outside whether a code ever existed.
 * Unknown, replaced, disabled and locked-owner codes produce one identical
 * result — on the landing page and through registration — and none credits
 * anybody.
 */
describe.skipIf(!hasDatabase)('codes that do not credit anybody', () => {
  let app: GwcApp
  let sms: { mobile: string; code: string }[]

  beforeAll(async () => { ({ app, sms } = await buildReferralApp()) })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    sms.length = 0
  })

  /** One of each kind of dead code, made the way it happens in real life. */
  async function deadCodes() {
    const replacedOwner = await memberOwner(app)
    const replaced = (await linkOf(app, replacedOwner)).link.code
    await app.inject({ method: 'POST', url: `${replacedOwner.prefix}/link/replace`, headers: replacedOwner.headers })

    const disabledOwner = await memberOwner(app)
    const disabled = (await linkOf(app, disabledOwner)).link.code
    const admin = await createAdmin(app.pg)
    await app.pg.query(
      `UPDATE referral_links SET state = 'disabled', state_changed_at = now(), disabled_by = $2, disabled_reason = 'test'
        WHERE code = $1`,
      [disabled, admin.id],
    )

    const lockedOwner = await memberOwner(app)
    const locked = (await linkOf(app, lockedOwner)).link.code
    await app.pg.query(`UPDATE members SET status = 'locked' WHERE id = $1`, [lockedOwner.id])

    return { unknown: 'ZZZZ9999', replaced, disabled, locked }
  }

  // What legitimately differs between ANY two responses: per-response ids and
  // nonces, the rate-limit counter, and the etag (a hash of a body that
  // contains the nonce). Everything else must match exactly.
  const VOLATILE = new Set([
    'date', 'x-request-id', 'content-length', 'etag', 'keep-alive', 'connection', 'content-security-policy',
    'ratelimit-remaining', 'ratelimit-reset', 'x-ratelimit-remaining', 'x-ratelimit-reset',
  ])
  const stable = (headers: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(headers).filter(([k]) => !VOLATILE.has(k.toLowerCase())))

  it('answers one identical 404 page for every dead code', async () => {
    const codes = await deadCodes()
    const pages = await Promise.all(Object.values(codes).map((code) => app.inject({ method: 'GET', url: `/r/${code.toLowerCase()}` })))

    for (const page of pages) expect(page.statusCode).toBe(404)
    // CSP carries a per-response nonce, so the body is compared with it masked.
    const bodies = pages.map((p) => p.body.replace(/nonce="[^"]*"/g, 'nonce=""'))
    expect(new Set(bodies).size).toBe(1)
    expect(new Set(pages.map((p) => JSON.stringify(stable(p.headers)))).size).toBe(1)
    for (const code of Object.values(codes)) expect(bodies[0]!.toLowerCase()).not.toContain(code.toLowerCase())
  })

  it('answers 200 with the owner\'s name for a live code', async () => {
    // Counter-assertion: the 404 above is about the codes, not the route.
    const owner = await memberOwner(app, { displayName: 'Rita Referrer' })
    const { link } = await linkOf(app, owner)
    const page = await app.inject({ method: 'GET', url: new URL(link.url).pathname })
    expect(page.statusCode).toBe(200)
    expect(page.body).toContain('Rita Referrer')
  })

  it('lets registration continue with every dead code, the same as with none, and credits nobody', async () => {
    const codes = await deadCodes()
    const responses = []
    for (const code of [...Object.values(codes), undefined]) {
      const { registered, memberId } = await registerAndVerify(app, sms, { referralCode: code })
      responses.push(registered)
      expect(await counts(app, memberId!)).toEqual({ referrals: 0, awards: 0 })
    }
    expect(new Set(responses.map((r) => r.statusCode))).toEqual(new Set([202]))
    expect(new Set(responses.map((r) => Object.keys(r.json()).sort().join()))).toEqual(new Set(['challengeId,expiresIn,sentTo']))
  })

  it('stops crediting a link whose owner is locked between registration and verification', async () => {
    const owner = await memberOwner(app)
    const { link } = await linkOf(app, owner)
    const { challengeId, details } = await registerAndVerify(app, sms, { referralCode: link.code, verify: false })
    await app.pg.query(`UPDATE members SET status = 'locked' WHERE id = $1`, [owner.id])

    const code = sms.filter((s) => s.mobile === details.mobile).at(-1)!.code
    await app.inject({ method: 'POST', url: '/onboarding/verify-mobile', payload: { challengeId, code, deviceId: details.deviceId } })
    expect(await counts(app)).toEqual({ referrals: 0, awards: 0 })
    const { rows } = await app.pg.query(
      `SELECT detail->>'reason' AS reason FROM audit_log WHERE action = 'referral_refused'`,
    )
    expect(rows).toEqual([{ reason: 'link-inactive' }])
  })
})
