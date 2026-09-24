import type { Plugin, ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
/**
 * Dev-server wiring for the two-entry build.
 *
 * In production the Fastify server does two jobs for the console that Vite does
 * not do on its own:
 *
 *   1. It serves the console shell for every `/konsole/*` path, so a deep link
 *      and a refresh both work (`server/src/app.js`, research R9).
 *   2. It serves the API on the same origin, so a cookie set by `/auth/sign-in`
 *      is sent back on `/auth/session`.
 *
 * Vite's dev server does neither by default, and the default it *does* apply is
 * actively misleading: `appType: 'spa'` rewrites every unmatched path to
 * `/index.html`. So `/konsole/anmelden` answered 200 with the landing page —
 * clicking "Anmelden" reloaded the page you were already on — and `/auth/csrf`
 * answered 200 with HTML, which a JSON client reads as a parse failure rather
 * than as "there is no API here".
 *
 * Both halves are exported so they can be asserted on without booting a server.
 */

/** Everything under here is the console's own client-side routing. */
export const CONSOLE_PREFIX = '/konsole'

/** The console's HTML entry, distinct from the landing page's. */
export const CONSOLE_ENTRY = '/konsole.html'

/**
 * Prefixes the API owns.
 *
 * Deliberately a list rather than a catch-all: anything not named here stays
 * with Vite, so a typo in a fetch path fails as a 404 from the dev server
 * rather than being silently forwarded to the API and 404ing there, which is a
 * much harder trail to follow.
 *
 * The cost of a list is that a new module must be added to it, and feature
 * 008 was not: `/marketplace` and `/messages` fell through to Vite, so the
 * member marketplace answered 404 on every call in development while working
 * everywhere else. `tests/dev-server.test.ts` now scans the client's own
 * fetch calls and fails when one names a prefix this list does not.
 */
export const API_PREFIXES = ['/auth', '/admin', '/media', '/push', '/health', '/marketplace', '/messages', '/onboarding', '/threads', '/profile']

/**
 * Static pages Vite serves from a file whose name is not the URL.
 *
 * `/en` must resolve to `en.html`. Without this Vite's SPA fallback answers it
 * with `index.html` — the German page at the English URL, which is the same
 * class of silent wrong answer the console fallback exists to prevent.
 */
export const STATIC_PAGES: Readonly<Record<string, string>> = Object.freeze({ '/en': '/en.html' })

const startsWithSegment = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`)

/**
 * The path Vite should serve for a request, or null to leave it alone.
 *
 * `/konsole` and everything below it resolves to the console entry; the query
 * string is dropped because it is the router's business, not the file's.
 */
export function consoleEntryFor(url: string | undefined | null): string | null {
  if (!url) return null
  const path = url.split('?')[0]!.split('#')[0]!

  // A named static page wins over everything: /en is a document, not a console
  // route and not the SPA fallback's business.
  const staticPage = STATIC_PAGES[path]
  if (staticPage) return staticPage

  // The entry itself, and Vite's own internals, must pass through untouched —
  // rewriting /konsole.html to /konsole.html would loop, and rewriting
  // /@vite/client would break HMR.
  if (path === CONSOLE_ENTRY) return null

  return startsWithSegment(path, CONSOLE_PREFIX) ? CONSOLE_ENTRY : null
}

/** True when the API, not Vite, should answer. */
export function isApiPath(url: string | undefined | null): boolean {
  if (!url) return false
  const path = url.split('?')[0]!
  return API_PREFIXES.some((prefix) => startsWithSegment(path, prefix))
}

/**
 * Serve the right document in development: `/konsole/*` gets the console
 * entry, `/en` gets the English landing page.
 *
 * The middleware is added in `configureServer`'s body, NOT in a returned
 * function. That distinction is the whole fix: Vite calls this hook before it
 * installs its own middlewares, so a middleware added here runs first, while
 * returning a function defers registration until *after* them — by which point
 * the SPA fallback has already rewritten the URL to `/index.html` and the
 * console is unreachable.
 */
export function consoleFallback(): Plugin {
  return {
    name: 'gwc-dev-routing',
    apply: 'serve',
    enforce: 'pre',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req: IncomingMessage, _res: ServerResponse, next: () => void) => {
        const entry = consoleEntryFor(req.url)
        if (entry) req.url = entry
        next()
      })
    },
  }
}

/**
 * Proxy the API to the Fastify server.
 *
 * Same-origin in the browser's eyes, which is what makes the session cookie
 * work: it is set on the dev-server origin and sent back on every later
 * request. Pointing the console straight at :3000 instead would make every call
 * cross-origin, and a cookie that never comes back is a console that can never
 * stay signed in.
 */
export function apiProxy(target = process.env.VITE_API_ORIGIN ?? 'http://localhost:3000') {
  return Object.fromEntries(
    API_PREFIXES.map((prefix) => [
      prefix,
      { target, changeOrigin: false, secure: false },
    ]),
  )
}
