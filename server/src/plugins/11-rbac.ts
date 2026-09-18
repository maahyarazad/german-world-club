import fp from 'fastify-plugin'
import { MODULES, FLAGS, AUDIENCES } from '@gwc/contracts/permissions'
import type { GwcApp } from '../app.ts'

/**
 * The deny-by-default route registry (FR-001, SC-001).
 *
 * Constitution Principle II: "Every route MUST declare an access posture... An
 * undeclared posture MUST fail startup or fail the build — never default to
 * permissive or restrictive."
 *
 * §10.1's own words about crawl posture — "silence is not an acceptable default
 * in either direction" — applied to authorization. This converts the most
 * common authorization defect (a route added under time pressure that nobody
 * guarded) from a review-checklist item into an un-mergeable startup failure.
 *
 * A route is made public by an affirmative declaration that appears in a diff,
 * never by omission.
 *
 * NOTE: this plugin is the *registry and gate only*. Permission enforcement
 * (requirePermission, object guards) is US1 and plugs into `config.auth`.
 */

/**
 * Routes the framework creates itself, which carry no application posture.
 *
 * `OPTIONS *` is @fastify/cors's preflight responder: a protocol handshake that
 * reveals nothing and reaches no handler. Exempting it is not a hole in the
 * gate — a preflight has no body, no credential and no effect.
 */
const INTERNAL = new Set(['/*', '', '*'])

/** @returns {string[]} problems, empty when the declaration is valid */
export function validateAuthConfig(auth) {
  if (auth === undefined || auth === null) return ['no config.auth declared']
  if (typeof auth !== 'object') return ['config.auth must be an object']

  const problems = []
  if (!AUDIENCES.includes(auth.audience)) {
    problems.push(`audience must be one of ${AUDIENCES.join(' | ')}, got ${JSON.stringify(auth.audience)}`)
  }
  if (auth.audience === 'staff') {
    /**
     * The one staff route that has no module: the capability endpoint.
     *
     * Knowing what you may do is not a privilege on the settings module —
     * reading how the system is configured is, and those are different things.
     * Gating the capability snapshot on `settings.read` meant a staff member
     * holding `seo.read` and nothing else could not fetch their own grants, so
     * the console could render no navigation for them at all.
     *
     * The exemption is affirmative and must appear in a diff, exactly as
     * `{ audience: 'public' }` does. Silence still fails: omitting module and
     * flag *without* saying `anyStaff: true` is the same declaration error it
     * has always been. That is the whole distinction — this widens what a route
     * may say, never what it may leave unsaid.
     */
    if (auth.anyStaff === true) {
      if (auth.module !== undefined || auth.flag !== undefined) {
        // Two postures on one route and no way to tell which governs.
        problems.push('anyStaff routes must not also declare a module or flag')
      }
    } else {
      if (auth.anyStaff !== undefined) {
        // `anyStaff: false` is not a declaration, it is an omission spelled out.
        problems.push('anyStaff must be true when present, or absent entirely')
      }
      if (!MODULES.includes(auth.module)) {
        problems.push(`staff routes must declare a known module, got ${JSON.stringify(auth.module)}`)
      }
      if (!FLAGS.includes(auth.flag)) {
        problems.push(`staff routes must declare one of ${FLAGS.join(' | ')}, got ${JSON.stringify(auth.flag)}`)
      }
    }
  }
  if (auth.audience !== 'staff' && (auth.module || auth.flag)) {
    problems.push('module/flag are only meaningful on a staff route')
  }
  if (auth.audience !== 'staff' && auth.anyStaff !== undefined) {
    // A public route reachable by "any staff" is a contradiction; a member
    // route carrying it would read as staff-gated to anyone skimming.
    problems.push('anyStaff is only meaningful on a staff route')
  }
  return problems
}

export default fp(
  async function rbac(app: GwcApp) {
    /**
     * Routes are *recorded* here and *judged* at onReady.
     *
     * Deferring the judgement is what makes the gate order-independent: an
     * encapsulated scope may declare a posture for routes a third-party plugin
     * registers on its behalf (@fastify/static's per-file routes, say) through
     * its own `onRoute` hook, which Fastify runs after this one. Judging here
     * would read the config before that hook had written it and reject a route
     * that is, in fact, declared.
     *
     * @type {object[]}
     */
    const routes = []

    app.addHook('onRoute', (route) => {
      if (INTERNAL.has(route.url)) return
      routes.push(route)
    })

    /**
     * Does this route declare what it sends back? (FR-049, T197.)
     *
     * Constitution Principle VI: nothing leaves the server in a shape the
     * server did not choose. A route with no response schema serializes
     * whatever the handler happens to return, which is how an internal column
     * — a password hash, a token, an internal id — reaches a client because
     * someone added `SELECT *`. The schema is also what generates the OpenAPI
     * document, so a route without one is invisible to every consumer.
     *
     * HEAD is exempt: Fastify derives it from the GET, and it sends no body.
     * `schema.hide` marks a route whose own shape is defined elsewhere — the
     * OpenAPI document itself is the only such case.
     */
    const declaresResponse = (route) => {
      const methods = [].concat(route.method)
      if (methods.every((m) => m === 'HEAD' || m === 'OPTIONS')) return true
      if (route.schema?.hide) return true
      if (route.config?.file) return true // a static asset is bytes, not a document
      /**
       * A route that does not send JSON declares what it does send.
       *
       * robots.txt is text, the sitemap is XML, a media variant is bytes — a
       * Zod response schema describes none of them. `config.produces` is the
       * affirmative declaration that replaces one, so the exemption appears in
       * a diff exactly like `{ audience: 'public' }` does, rather than being a
       * silent hole in the gate.
       */
      if (route.config?.produces) return true
      const response = route.schema?.response
      return Boolean(response && Object.keys(response).length > 0)
    }

    /**
     * `staticFile` carries @fastify/static's own marker for the per-file routes
     * it generates from the static root. The posture of those is declared once,
     * for the whole scope, in app.js; surfacing the marker lets the matrix test
     * separate them from routes a developer hand-wrote without guessing from
     * the file extension, which changes with every client build.
     *
     * @returns {Array<{method: string, url: string, auth: object, staticFile: boolean}>}
     */
    const registry = () =>
      routes
        .filter((r) => validateAuthConfig(r.config?.auth).length === 0)
        .map((r) => ({
          method: r.method,
          url: r.url,
          auth: r.config.auth,
          staticFile: typeof r.config?.file === 'string',
        }))

    // The gate. Runs after every plugin has registered its routes.
    app.addHook('onReady', async () => {
      const offenders = routes
        .map((route) => ({
          route,
          problems: [
            ...validateAuthConfig(route.config?.auth),
            ...(declaresResponse(route) ? [] : ['no explicit response schema declared']),
          ],
        }))
        .filter(({ problems }) => problems.length > 0)

      if (offenders.length === 0) return
      // Fastify registers HEAD alongside every GET, so group by URL: a
      // developer should see one line per route they actually wrote.
      const byUrl = new Map()
      for (const { route, problems } of offenders) {
        const entry = byUrl.get(route.url) ?? { methods: new Set(), problems }
        for (const m of [].concat(route.method)) entry.methods.add(m)
        byUrl.set(route.url, entry)
      }
      const lines = [...byUrl.entries()].map(
        ([url, { methods, problems }]) =>
          `  ${[...methods].join(',').padEnd(10)} ${url}\n      ${problems.join('\n      ')}`,
      )
      throw new Error(
        `FATAL: ${byUrl.size} route(s) have an incomplete declaration:\n` +
          `${lines.join('\n')}\n\n` +
          `Every route declares two things, and both are affirmative acts that show\n` +
          `up in a diff rather than defaults nobody chose:\n` +
          `  • config.auth — use { audience: 'public' } to make a route public\n` +
          `    (Constitution Principle II)\n` +
          `  • schema.response — what the route sends back. For a route that does\n` +
          `    not send JSON, declare config.produces ('text/plain', 'application/xml',\n` +
          `    'binary') instead (Constitution Principle VI).`,
      )
    })

    // Exposed so the authorization-matrix test can enumerate the real route
    // table rather than a hand-maintained copy of it.
    app.decorate('routePostures', registry)

    /**
     * Which permission modules the server can actually serve.
     *
     * The matrix declares nineteen; the API serves a handful. The console has
     * to tell those apart — SC-001 requires a module to be either working or
     * visibly marked "noch nicht verfügbar", never a dead sidebar link.
     *
     * Derived from the routes that actually registered, so it cannot drift: a
     * module appears here the moment its first route declares it, and
     * disappears if that route is removed. A hard-coded list in the client
     * would have been correct on the day it was written and wrong thereafter.
     */
    app.decorate('availableModules', () => {
      const modules = new Set()
      for (const route of routes) {
        const module = route.config?.auth?.module
        if (module && MODULES.includes(module)) modules.add(module)
      }
      return [...modules].sort()
    })
  },
  { name: 'rbac-registry' },
)
