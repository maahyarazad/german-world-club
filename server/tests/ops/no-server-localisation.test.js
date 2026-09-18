import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../../src/app.js'
import { createFixtureContentSource } from '../../src/modules/public/content.js'

/**
 * SC-010 — the server emits the same bytes whatever language the client wants.
 *
 * Feature 004 translates the *interface*. It deliberately does not translate
 * anything the server says: problem `detail` stays English and the console
 * renders it from a copy table keyed on `type`, which is the whole payoff of
 * "clients branch on `type`, never on `detail`".
 *
 * This file exists because "while we're at it, localise the API too" is the
 * obvious next step and it is the wrong one. It would add an `Accept-Language`
 * dependency to every route, make responses vary by header — which caches badly
 * and makes Principle VI's "the server shapes what leaves it" a per-request
 * negotiation — and duplicate translation the console already does.
 *
 * If a future change starts localising responses, this suite fails, and that
 * failure is the conversation rather than a surprise in production.
 */
let app

beforeAll(async () => {
  app = await buildApp({ contentSource: createFixtureContentSource([]) })
  await app.ready()
})

afterAll(async () => { await app.close() })

/** The same request twice, asking for a different language each time. */
const bothWays = async (options) => {
  const german = await app.inject({
    ...options,
    headers: { ...options.headers, 'accept-language': 'de-DE,de;q=0.9' },
  })
  const english = await app.inject({
    ...options,
    headers: { ...options.headers, 'accept-language': 'en-GB,en;q=0.9' },
  })
  return { german, english }
}

/** Fields that legitimately differ between two identical requests. */
const stable = (response) => {
  const body = response.body
  try {
    const { requestId, instance, ...rest } = JSON.parse(body)
    return JSON.stringify(rest)
  } catch {
    return body
  }
}

describe('no API response varies with Accept-Language', () => {
  it.each([
    ['a sign-in refusal', { method: 'POST', url: '/auth/sign-in', payload: { email: 'nobody@test.invalid', password: 'long-enough-to-validate' } }],
    ['an unauthenticated capability request', { method: 'GET', url: '/auth/session' }],
    ['an unauthenticated member profile', { method: 'GET', url: '/auth/me' }],
    ['a staff-gated route', { method: 'GET', url: '/admin/openapi.json' }],
    ['a not-found', { method: 'GET', url: '/gibt-es-nicht', headers: { accept: 'application/json' } }],
    ['a validation failure', { method: 'POST', url: '/auth/password-reset/confirm', payload: { token: 'x', password: 'short' } }],
  ])('%s is byte-identical', async (_name, options) => {
    const { german, english } = await bothWays(options)

    expect(english.statusCode).toBe(german.statusCode)
    expect(stable(english)).toBe(stable(german))
  })

  it('never sets Vary: Accept-Language on an API response', async () => {
    // A `Vary` on this header would be the first sign the server had started
    // negotiating, and would fragment every cache by language.
    const { german } = await bothWays({ method: 'GET', url: '/auth/session' })
    expect(german.headers.vary ?? '').not.toMatch(/accept-language/i)
  })

  it('keeps problem detail in English', async () => {
    // Stated as an assertion rather than left implicit: the console translates
    // by `type` and never renders `detail`, so this string is for developers
    // and logs. If it ever becomes German, something is localising the server.
    const response = await app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email: 'nobody@test.invalid', password: 'long-enough-to-validate' },
      headers: { 'accept-language': 'de-DE' },
    })
    expect(response.json().detail).toMatch(/[A-Za-z]/)
    expect(response.json().detail).not.toMatch(/[äöüß]/)
  })

  /**
   * The counter-assertion for this whole file.
   *
   * Every test above compares two responses, and two *empty* responses are
   * identical. This proves the requests are really being served.
   */
  it('BUT the responses are real — the comparison is not of two blanks', async () => {
    const { german } = await bothWays({ method: 'GET', url: '/auth/session' })
    expect(german.statusCode).toBeGreaterThanOrEqual(400)
    expect(german.body.length).toBeGreaterThan(20)
    expect(german.json().type).toBeTruthy()
  })
})

/**
 * The public pages are the deliberate exception, and they do not negotiate
 * either: the URL decides.
 */
describe('the public pages vary by URL, never by header', () => {
  it.each([
    ['/', 'de'],
    ['/en', 'en'],
  ])('%s answers lang="%s" whichever language the header asks for', async (url, language) => {
    for (const header of ['de-DE,de;q=0.9', 'en-GB,en;q=0.9', 'fr-FR', '']) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { accept: 'text/html', 'accept-language': header },
      })
      expect(response.body, `${url} with ${header || 'no header'}`).toContain(`<html lang="${language}">`)
    }
  })
})
