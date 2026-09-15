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

/** Routes Fastify creates itself, which carry no application posture. */
const INTERNAL = new Set(['/*', ''])

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
    /** @type {Array<{route: object, problems: string[]}>} */
    const offenders = []
    /** @type {Array<{method: string, url: string, auth: object}>} */
    const registry = []

    app.addHook('onRoute', (route) => {
      if (INTERNAL.has(route.url)) return
      const auth = route.config?.auth
      const problems = validateAuthConfig(auth)
      if (problems.length > 0) {
        offenders.push({ route, problems })
        return
      }
      registry.push({ method: route.method, url: route.url, auth })
    })

    // The gate. Runs after every plugin has registered its routes.
    app.addHook('onReady', async () => {
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
    app.decorate('routePostures', () => [...registry])
  },
  { name: 'rbac-registry' },
)
