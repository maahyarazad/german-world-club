import { describe, it, expect, afterEach } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { createFixtureContentSource } from '../../src/modules/public/content.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * What makes a tapped https://<host>/r/CODE open the app (research R9). Both
 * files cover /r/* and nothing else: claiming the whole domain would send every
 * public page — the landing page, partner pages, the magazine — into the app.
 */
describe.skipIf(!hasDatabase)('/.well-known app-link files', () => {
  let app: GwcApp | undefined
  const FINGERPRINT = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase()).join(':')

  afterEach(async () => {
    await app?.close()
    app = undefined
    delete process.env.ANDROID_APP_CERT_SHA256
  })

  async function boot(env: Record<string, string> = {}) {
    Object.assign(process.env, env)
    app = await buildApp({ contentSource: createFixtureContentSource([]) })
    await app.ready()
    return app
  }

  it('serves apple-app-site-association for /r/* only', async () => {
    const a = await boot()
    const response = await a.inject({ method: 'GET', url: '/.well-known/apple-app-site-association' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/application\/json/)
    expect(response.headers['x-robots-tag']).toMatch(/noindex/)
    const body = response.json()
    expect(body.applinks.details).toEqual([
      { appIDs: ['YQFY6269ZL.com.buenapublica.germanworldclub'], components: [{ '/': '/r/*' }] },
      { appID: 'YQFY6269ZL.com.buenapublica.germanworldclub', paths: ['/r/*'] },
    ])
  })

  it('answers 404 for assetlinks.json while no signing fingerprint is configured', async () => {
    const a = await boot()
    expect((await a.inject({ method: 'GET', url: '/.well-known/assetlinks.json' })).statusCode).toBe(404)
  })

  it('serves assetlinks.json once a fingerprint is configured', async () => {
    // Counter-assertion: the 404 above is about the missing fingerprint, not a missing route.
    const a = await boot({ ANDROID_APP_CERT_SHA256: FINGERPRINT.toLowerCase() })
    const response = await a.inject({ method: 'GET', url: '/.well-known/assetlinks.json' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'com.buenapublica.germanworldclub', sha256_cert_fingerprints: [FINGERPRINT] },
    }])
  })
})
