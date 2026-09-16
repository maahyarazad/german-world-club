import fp from 'fastify-plugin'
import { MODULES, FLAGS, AUDIENCES } from '@gwc/contracts/permissions'

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
    if (!MODULES.includes(auth.module)) {
      problems.push(`staff routes must declare a known module, got ${JSON.stringify(auth.module)}`)
    }
    if (!FLAGS.includes(auth.flag)) {
      problems.push(`staff routes must declare one of ${FLAGS.join(' | ')}, got ${JSON.stringify(auth.flag)}`)
    }
  }
  if (auth.audience !== 'staff' && (auth.module || auth.flag)) {
    problems.push('module/flag are only meaningful on a staff route')
  }
  return problems
}

export default fp(
  async function rbac(app) {
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

    /** @returns {Array<{method: string, url: string, auth: object}>} */
    const registry = () =>
      routes
        .filter((r) => validateAuthConfig(r.config?.auth).length === 0)
        .map((r) => ({ method: r.method, url: r.url, auth: r.config.auth }))

    // The gate. Runs after every plugin has registered its routes.
    app.addHook('onReady', async () => {
      const offenders = routes
        .map((route) => ({ route, problems: validateAuthConfig(route.config?.auth) }))
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
        `FATAL: ${byUrl.size} route(s) registered without a valid access posture:\n` +
          `${lines.join('\n')}\n\n` +
          `Declare config.auth on each. Use { auth: { audience: 'public' } } for a\n` +
          `deliberately public route — making a route public is an affirmative act\n` +
          `that shows up in a diff (Constitution Principle II).`,
      )
    })

    // Exposed so the authorization-matrix test can enumerate the real route
    // table rather than a hand-maintained copy of it.
    app.decorate('routePostures', registry)
  },
  { name: 'rbac-registry' },
)
