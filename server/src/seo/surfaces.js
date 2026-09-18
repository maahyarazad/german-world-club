/**
 * The §10.1 crawl-posture table — the single source driving three things:
 * route postures, the generated robots.txt, and the X-Robots-Tag header.
 *
 * Held in code rather than in the database because it is a design decision
 * reviewed in a pull request, not an operational setting, and because a startup
 * gate depends on it.
 *
 * §10.1: "Every surface declares its crawl posture. Nothing is left
 * undeclared." Adding a gated surface here disallows it in robots.txt by
 * construction, rather than by remembering to edit a static file.
 */

/**
 * `shell` marks a gated surface whose *prefix* serves an empty client
 * application shell rather than refusing.
 *
 * Every other gated surface answers 401/403/404 at every path under it, and the
 * crawl-posture suite asserts exactly that. A client-routed console cannot: the
 * browser must receive a document before any JavaScript can ask who the visitor
 * is. The document it receives contains no member content, no capability data
 * and no principal — everything real arrives later, over authenticated requests
 * the server re-checks.
 *
 * So this is not an exemption from the gated rule; it is the one shape the rule
 * did not previously have a word for. Marking it here, rather than special-
 * casing it in a test, keeps the table the single source it claims to be — and
 * a surface that sets `shell` is held to a *stricter* assertion in
 * tests/seo/crawl-posture-gated.test.js: its shell must be provably empty.
 */
/** @typedef {{ name: string, prefixes: string[], public: boolean, indexed: boolean, why: string, shell?: boolean }} Surface */

/** @type {Surface[]} */
export const SURFACES = Object.freeze([
  // --- Public and indexed ---------------------------------------------------
  { name: 'landing', prefixes: ['/'], public: true, indexed: true, why: 'First point of contact for all audiences' },
  // The English landing page. Declared separately because the table is matched
  // by prefix and '/' matches only the root exactly — without this row, /en
  // would fall through to the gated default and be marked noindex, which would
  // delist the very page it exists to publish.
  { name: 'landing-en', prefixes: ['/en'], public: true, indexed: true, why: 'English half of the landing translation pair' },
  { name: 'magazine', prefixes: ['/magazine', '/news'], public: true, indexed: true, why: 'Primary organic-traffic driver' },
  { name: 'partners', prefixes: ['/partners'], public: true, indexed: true, why: 'Monetized — sponsors pay for this visibility' },
  { name: 'outlets', prefixes: ['/outlets'], public: true, indexed: true, why: 'Monetized — local-business presence per branch' },
  { name: 'events-public', prefixes: ['/events'], public: true, indexed: true, why: 'Drives awareness and partner/press interest' },
  { name: 'recaps', prefixes: ['/recaps'], public: true, indexed: true, why: 'Credibility content; galleries need alt text' },
  { name: 'institutional', prefixes: ['/committees', '/about', '/legal', '/imprint'], public: true, indexed: true, why: 'Institutional credibility' },
  { name: 'crawl-control', prefixes: ['/robots.txt', '/sitemap.xml'], public: true, indexed: false, why: 'Directives themselves are not content' },
  { name: 'media-delivery', prefixes: ['/media'], public: true, indexed: false, why: 'Derivatives are referenced by pages, not indexed as pages' },
  { name: 'health', prefixes: ['/health'], public: true, indexed: false, why: 'Operational endpoint' },
  // Registered only when NODE_ENV=development, so on a deployed origin this row
  // describes a surface that does not exist. It is declared anyway: §10.1 asks
  // for a posture per surface, not per surface that happens to be mounted, and
  // a developer reading the table should find the answer rather than the gap.
  { name: 'dev-docs', prefixes: ['/swagger-ui'], public: true, indexed: false, why: 'Development-only API explorer; never mounted outside development' },

  // --- Gated, never indexed ------------------------------------------------
  { name: 'portal', prefixes: ['/portal'], public: false, indexed: false, why: 'Member PII — gated' },
  { name: 'threads', prefixes: ['/threads'], public: false, indexed: false, why: 'Member-only discussion; invite-only club' },
  { name: 'messages', prefixes: ['/messages'], public: false, indexed: false, why: 'Private correspondence' },
  { name: 'marketplace', prefixes: ['/marketplace'], public: false, indexed: false, why: 'Member-only classifieds' },
  { name: 'checkout', prefixes: ['/checkout', '/register'], public: false, indexed: false, why: 'Transactional, member-only' },
  { name: 'invitations', prefixes: ['/invite'], public: false, indexed: false, why: 'One-time tokens; must never be crawled' },
  { name: 'admin', prefixes: ['/admin'], public: false, indexed: false, why: 'Back-office' },
  // The web console (feature 003). Its shell is served by a public route —
  // an empty application shell carrying no member content — but the surface
  // itself is gated, so it is declared gated here. That is what puts it in
  // robots.txt's Disallow list and what makes postureFor answer `indexed:
  // false`, which is what stamps X-Robots-Tag on every console response.
  { name: 'console', prefixes: ['/konsole'], public: false, indexed: false, shell: true, why: 'Gated console for members, staff, merchants and partners' },
  { name: 'auth', prefixes: ['/auth'], public: false, indexed: false, why: 'Credential endpoints' },
  { name: 'api', prefixes: ['/api'], public: false, indexed: false, why: 'Machine interface' },
])

const GATED_DEFAULT = Object.freeze({
  name: 'unknown',
  public: false,
  indexed: false,
  why: 'Undeclared surfaces are treated as gated — silence must never widen exposure',
})

/**
 * Every prefix a crawler must be told to stay out of (FR-024).
 *
 * Only *gated* surfaces are disallowed. `Disallow` and `noindex` do different
 * jobs: Disallow stops the fetch, noindex stops the listing. Public-but-not-
 * indexed surfaces (robots.txt, the sitemap, media derivatives) must stay
 * fetchable — disallowing `/media` would stop a crawler retrieving the images
 * public pages reference, which would harm the very partner visibility §10
 * exists to protect. Those surfaces carry `X-Robots-Tag: noindex` instead.
 */
export const disallowedPrefixes = () =>
  SURFACES.filter((s) => !s.public && s.prefixes[0] !== '/').flatMap((s) => s.prefixes)

/**
 * Resolve the posture for a request.
 *
 * The route's own declaration wins when it is explicit, because that is what
 * the startup gate verifies. The URL table is the fallback, and an unmatched
 * URL resolves to *gated* — erring toward less exposure, never more.
 */
export function postureFor(authConfig, url = '/') {
  // Case-folded, because a surface's posture cannot depend on how a crawler or
  // an attacker happened to spell the path: `/ADMIN` is the admin surface.
  const path = String(url).split('?')[0].toLowerCase()

  const matched = SURFACES
    .filter((s) => s.prefixes.some((p) => (p === '/' ? path === '/' : path === p || path.startsWith(`${p}/`))))
    // Longest prefix wins, so '/events/x/register' does not match '/events'.
    .sort((a, b) => Math.max(...b.prefixes.map((p) => p.length)) - Math.max(...a.prefixes.map((p) => p.length)))[0]

  if (authConfig?.audience === 'public') {
    return { ...(matched ?? { ...GATED_DEFAULT, public: true }), public: true, indexed: matched ? matched.indexed : false }
  }
  if (authConfig?.audience === 'member' || authConfig?.audience === 'staff') {
    return { ...(matched ?? GATED_DEFAULT), public: false, indexed: false }
  }
  return matched ?? GATED_DEFAULT
}

export const surfaceByName = (name) => SURFACES.find((s) => s.name === name)
