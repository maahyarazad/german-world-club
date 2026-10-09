import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { withCspNonces } from '../../src/plugins/02-security-headers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The console shell must be allowed to run under its own CSP. The policy
 * permits scripts and styles only by per-request nonce, so a shell served
 * without the nonce on its tags is a blank "Konsole wird geladen …" forever.
 */
describe('withCspNonces', () => {
  const shell = [
    '<link rel="icon" href="/favicon.png">',
    '<style>body{}</style>',
    '<script type="module" crossorigin src="/assets/konsole.js"></script>',
    '<link rel="stylesheet" crossorigin href="/assets/konsole.css">',
  ].join('')
  const out = withCspNonces(shell, { script: 'S1', style: 'T1' })

  it('stamps the script, the inline style and the stylesheet', () => {
    expect(out).toContain('<script nonce="S1" type="module"')
    expect(out).toContain('<style nonce="T1">')
    expect(out).toContain('<link nonce="T1" rel="stylesheet"')
  })

  it('leaves other links alone and never stamps twice', () => {
    // Counter-assertion: a blanket replace would also pass the test above.
    expect(out).toContain('<link rel="icon" href="/favicon.png">')
    expect(withCspNonces(out, { script: 'S2', style: 'T2' })).toBe(out)
  })
})

const built = existsSync(join(import.meta.dirname, '../../../client/dist/konsole.html'))

describe.skipIf(!built)('the served console shell', () => {
  let app: GwcApp
  beforeAll(async () => { app = await buildApp(); await app.ready() })
  afterAll(async () => { await app.close() })

  it('carries the same nonce its CSP header allows, fresh on every request', async () => {
    const first = await app.inject({ method: 'GET', url: '/konsole/passwort?token=abc' })
    const csp = String(first.headers['content-security-policy'])
    const scriptNonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1]
    expect(scriptNonce).toBeTruthy()
    expect(first.body).toContain(`<script nonce="${scriptNonce}"`)

    const second = await app.inject({ method: 'GET', url: '/konsole/passwort?token=abc' })
    expect(second.body).not.toContain(`nonce="${scriptNonce}"`)
  })
})

/**
 * The landing pages are pre-rendered shells too, and their entire stylesheet
 * is one inline <style>. Served byte for byte, the CSP refuses it and `/`
 * renders unstyled. No build is needed: without `client/dist` the source
 * `client/index.html` is served, with the same inline block.
 */
describe('the served landing shells', () => {
  let app: GwcApp
  beforeAll(async () => { app = await buildApp(); await app.ready() })
  afterAll(async () => { await app.close() })

  it.each(['/', '/en'])('%s styles carry the nonce its CSP header allows', async (url) => {
    const response = await app.inject({ method: 'GET', url, headers: { accept: 'text/html' } })
    expect(response.statusCode).toBe(200)
    const csp = String(response.headers['content-security-policy'])
    const styleNonce = /style-src 'nonce-([^']+)'/.exec(csp)?.[1]
    expect(styleNonce).toBeTruthy()
    expect(response.body).toContain(`<style nonce="${styleNonce}">`)
    // Counter-assertion: one stamped block would pass the line above while a
    // second, unstamped one is still refused.
    expect(response.body).not.toMatch(/<style(?![^>]*\bnonce=)/)
  })
})
