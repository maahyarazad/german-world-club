import { describe, it, expect } from 'vitest'
import { buildApp } from '../../src/app.js'
import { validateAuthConfig } from '../../src/plugins/11-rbac.js'

/**
 * SC-001 / FR-001: every route declares an access posture, or the server
 * refuses to start.
 *
 * Constitution Principle II: "An undeclared posture MUST fail startup or fail
 * the build — never default to permissive or restrictive."
 */
describe('route posture gate (SC-001)', () => {
  it('starts when every route declares a posture', async () => {
    const app = await buildApp()
    app.get('/declared', { config: { auth: { audience: 'public' } } }, async () => ({ ok: true }))
    await expect(app.ready()).resolves.toBeTruthy()
    await app.close()
  })

  it('FAILS STARTUP on a route with no config.auth', async () => {
    const app = await buildApp()
    app.get('/undeclared', async () => ({ ok: true }))
    await expect(app.ready()).rejects.toThrow(/without a valid access posture/)
    await app.close().catch(() => {})
  })

  it('names the offending method and path in the failure', async () => {
    const app = await buildApp()
    app.post('/admin/partners/:id/contract', async () => ({ ok: true }))
    await expect(app.ready()).rejects.toThrow(/POST\s+\/admin\/partners\/:id\/contract/)
    await app.close().catch(() => {})
  })

  it('reports every offender, not just the first', async () => {
    const app = await buildApp()
    app.get('/one', async () => ({}))
    app.get('/two', async () => ({}))
    await expect(app.ready()).rejects.toThrow(/2 route\(s\) registered without/)
    await app.close().catch(() => {})
  })

  it('rejects a staff route that names an unknown module', async () => {
    const app = await buildApp()
    app.get('/admin/x', { config: { auth: { audience: 'staff', module: 'nonsense', flag: 'read' } } }, async () => ({}))
    await expect(app.ready()).rejects.toThrow(/known module/)
    await app.close().catch(() => {})
  })

  it('exposes the real route table for the authorization matrix test', async () => {
    const app = await buildApp()
    app.get('/declared', { config: { auth: { audience: 'public' } } }, async () => ({}))
    await app.ready()
    const postures = app.routePostures()
    expect(postures.some((r) => r.url === '/declared')).toBe(true)
    // Foundational's own routes must be declared too.
    expect(postures.some((r) => r.url === '/health/live')).toBe(true)
    await app.close()
  })

  describe('validateAuthConfig', () => {
    it('requires a known audience', () => {
      expect(validateAuthConfig({ audience: 'everyone' })).toContainEqual(expect.stringMatching(/audience must be/))
    })
    it('requires module and flag on staff routes', () => {
      expect(validateAuthConfig({ audience: 'staff' })).toHaveLength(2)
    })
    it('rejects module/flag on a non-staff route', () => {
      expect(validateAuthConfig({ audience: 'member', module: 'members' }))
        .toContainEqual(expect.stringMatching(/only meaningful on a staff route/))
    })
    it('accepts a valid public declaration', () => {
      expect(validateAuthConfig({ audience: 'public' })).toHaveLength(0)
    })
    it('accepts a valid staff declaration', () => {
      expect(validateAuthConfig({ audience: 'staff', module: 'members', flag: 'edit' })).toHaveLength(0)
    })
  })
})
