import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from 'vite'
import {
  consoleEntryFor,
  isApiPath,
  apiProxy,
  CONSOLE_ENTRY,
  API_PREFIXES,
} from '../dev-server'

/**
 * The dev server.
 *
 * `npm run dev` is how this console is actually worked on, and it was broken in
 * a way no component test could see: Vite's default `appType: 'spa'` rewrites
 * every unmatched path to `/index.html`, so `/konsole/anmelden` answered 200
 * with the *landing page*. Clicking "Anmelden" reloaded the page you were
 * already on. `/auth/csrf` fell through the same way and answered HTML, which a
 * JSON client reads as a parse failure rather than as "there is no API here".
 *
 * The second describe below boots a real Vite server, because the defect was
 * middleware *ordering* — the rewrite existed but ran after Vite's fallback —
 * and no amount of unit-testing the path logic would have caught that.
 */

describe('which requests belong to the console', () => {
  it.each([
    ['/konsole'],
    ['/konsole/anmelden'],
    ['/konsole/passwort'],
    ['/konsole/admin'],
    ['/konsole/admin/seo/irgendwas'],
    ['/konsole/anmelden?weiter=/konsole/admin'],
  ])('%s resolves to the console entry', (url) => {
    expect(consoleEntryFor(url)).toBe(CONSOLE_ENTRY)
  })

  it.each([
    ['the landing page', '/'],
    ['a near miss on the prefix', '/konsolen'],
    ['a near miss the other way', '/konsol'],
    ['the console entry itself', CONSOLE_ENTRY],
    ['a Vite internal', '/@vite/client'],
    ['a source module', '/src/konsole.jsx'],
    ['a public asset', '/gwc-logo.png'],
  ])('leaves %s alone', (_name, url) => {
    // Counter-assertion: rewriting the entry to itself loops, and rewriting
    // Vite's internals breaks HMR.
    expect(consoleEntryFor(url)).toBeNull()
  })

  it.each(API_PREFIXES.map((p) => [p]))('%s belongs to the API', (prefix) => {
    expect(isApiPath(prefix)).toBe(true)
    expect(isApiPath(`${prefix}/etwas`)).toBe(true)
  })

  it('does not hand the console or the landing page to the API', () => {
    for (const url of ['/', '/konsole/anmelden', '/gwc-logo.png', '/authentisch']) {
      expect(isApiPath(url), url).toBe(false)
    }
  })

  it('proxies every API prefix and nothing else', () => {
    const proxy = apiProxy('http://localhost:3000')
    expect(Object.keys(proxy).sort()).toEqual([...API_PREFIXES].sort())
    // changeOrigin stays false: the session cookie is set for the dev-server
    // origin, and rewriting the Host would set it for :3000 instead — where the
    // browser would never send it back.
    expect(proxy['/auth'].changeOrigin).toBe(false)
  })
})

/**
 * The real thing.
 *
 * Boots Vite exactly as `npm run dev` does and asks it for the URLs the landing
 * page links to. This is the test that fails if the rewrite is registered in
 * the wrong place.
 */
describe('a real dev server serves the console, not the landing page', () => {
  let server
  let origin

  beforeAll(async () => {
    server = await createServer({
      root: process.cwd(),
      // Port 0, so a stray dev server from an earlier session cannot make this
      // suite pass or fail for reasons that have nothing to do with it.
      // The host is pinned because Vite defaults to `localhost`, which on macOS
      // resolves to ::1 while `address()` reports the IPv4 port — so the URL
      // built from it connects to nothing.
      server: { port: 0, strictPort: false, host: '127.0.0.1' },
      logLevel: 'error',
    })
    await server.listen()
    const { port } = server.httpServer.address()
    origin = `http://127.0.0.1:${port}`
  }, 60_000)

  afterAll(async () => {
    // `fetch` keeps its sockets alive, and Vite's close() waits for the HTTP
    // server to drain — so without this the teardown hangs until the hook
    // times out and vitest reports a failure on a suite that fully passed.
    server?.httpServer?.closeAllConnections?.()
    await server?.close()
  }, 60_000)

  const titleOf = async (path) => {
    const html = await (await fetch(`${origin}${path}`)).text()
    return html.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
  }

  it.each([
    ['the sign-in route', '/konsole/anmelden'],
    ['the password-reset route', '/konsole/passwort'],
    ['a deep link', '/konsole/admin/seo/irgendwas'],
    ['the bare prefix', '/konsole'],
  ])('serves the console entry for %s', async (_name, path) => {
    expect(await titleOf(path)).toMatch(/Konsole/)
  })

  it('still serves the landing page at /', async () => {
    // Counter-assertion. Without it the suite above would pass just as well
    // against a dev server that served the console for everything.
    expect(await titleOf('/')).toMatch(/German World Club/)
  })

  it('serves the landing page for a path that only looks like the console', async () => {
    expect(await titleOf('/konsolen')).toMatch(/German World Club/)
  })

  /**
   * The landing page's own links, followed.
   *
   * This is the user's report stated as an assertion: every `/konsole` link on
   * the landing page must reach the console. Reading them out of the file
   * rather than hard-coding them means a renamed route is caught here too.
   */
  it('reaches the console from every console link the landing page offers', async () => {
    const landing = await (await fetch(`${origin}/`)).text()
    const links = [...landing.matchAll(/href="(\/konsole[^"]*)"/g)].map((m) => m[1])

    expect(links.length, 'the landing page offers no console links at all').toBeGreaterThan(0)

    for (const link of new Set(links)) {
      expect(await titleOf(link), `${link} did not reach the console`).toMatch(/Konsole/)
    }
  })
})
