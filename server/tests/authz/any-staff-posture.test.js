import { describe, it, expect } from 'vitest'
import { validateAuthConfig } from '../../src/plugins/11-rbac.js'
import { buildApp } from '../../src/app.js'
import { createFixtureContentSource } from '../../src/public/content.js'

/**
 * The `anyStaff` posture (T027, research R3).
 *
 * A staff route must normally declare a module and a flag. That rule is what
 * makes an under-declared route un-mergeable, and it is not being relaxed here.
 *
 * But one route genuinely has no module: the capability endpoint. Knowing what
 * you may do is not a privilege on the settings module — reading how the system
 * is configured is, and those are different things. Without this exemption a
 * staff member holding `seo.read` and nothing else cannot fetch their own
 * capability set, so the console can render nothing for them at all.
 *
 * The exemption is therefore *affirmative*: the route must say `anyStaff: true`.
 * Every assertion below exists to prove that silence still fails — an exemption
 * that could be taken by omission would be the defect the gate was written
 * against, wearing a new name.
 */

describe('a staff route may omit module and flag only by declaring anyStaff', () => {
  it('accepts an affirmative anyStaff declaration', () => {
    expect(validateAuthConfig({ audience: 'staff', anyStaff: true })).toEqual([])
  })

  /**
   * The counter-assertion, and the reason this suite exists. If this ever
   * passes, the gate has been loosened rather than extended and every future
   * staff route can be added with no posture at all.
   */
  it('STILL REFUSES a staff route that simply omits them', () => {
    const problems = validateAuthConfig({ audience: 'staff' })
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join(' ')).toMatch(/must declare a known module/)
  })

  it('STILL REFUSES a staff route with an unknown module', () => {
    expect(validateAuthConfig({ audience: 'staff', module: 'nope', flag: 'read' })).not.toEqual([])
  })

  it('STILL REFUSES a staff route with an unknown flag', () => {
    expect(validateAuthConfig({ audience: 'staff', module: 'seo', flag: 'nope' })).not.toEqual([])
  })

  /**
   * Two postures on one route and no way to tell which governs. Rejecting this
   * is what stops `anyStaff` becoming a quiet override bolted onto a route that
   * already declared a real module.
   */
  it('REFUSES anyStaff alongside a module or a flag', () => {
    expect(validateAuthConfig({ audience: 'staff', anyStaff: true, module: 'seo', flag: 'read' }))
      .not.toEqual([])
    expect(validateAuthConfig({ audience: 'staff', anyStaff: true, module: 'seo' })).not.toEqual([])
    expect(validateAuthConfig({ audience: 'staff', anyStaff: true, flag: 'read' })).not.toEqual([])
  })

  it('REFUSES anyStaff on a non-staff audience', () => {
    // A public route reachable by "any staff" is a contradiction, and a member
    // route with it would silently read as staff-gated to anyone skimming.
    expect(validateAuthConfig({ audience: 'public', anyStaff: true })).not.toEqual([])
    expect(validateAuthConfig({ audience: 'member', anyStaff: true })).not.toEqual([])
  })

  it('REFUSES anyStaff: false as a way of saying nothing', () => {
    // `false` is not a declaration, it is the absence of one spelled out.
    expect(validateAuthConfig({ audience: 'staff', anyStaff: false })).not.toEqual([])
  })
})

describe('the startup gate still refuses an undeclared route alongside it', () => {
  it('boots with the anyStaff route registered', async () => {
    const app = await buildApp({ contentSource: createFixtureContentSource([]) })
    await expect(app.ready()).resolves.toBeTruthy()

    const session = app.routePostures().find((r) => r.url === '/auth/session' && r.method === 'GET')
    expect(session).toBeDefined()
    expect(session.auth).toEqual({ audience: 'staff', anyStaff: true })
    await app.close()
  })

  /**
   * Counter-assertion for the test above: the cheapest way to make `anyStaff`
   * "work" would be to stop the gate throwing at all. This proves it still
   * throws for an ordinary route that declared nothing.
   */
  it('STILL FAILS STARTUP on a route with no config.auth', async () => {
    const app = await buildApp({ contentSource: createFixtureContentSource([]) })
    app.get('/undeclared-alongside-session', async () => ({ ok: true }))
    await expect(app.ready()).rejects.toThrow(/no config\.auth declared/)
    await app.close().catch(() => {})
  })
})
