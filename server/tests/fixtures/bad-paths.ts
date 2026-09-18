/**
 * The soft-404 regression corpus (SC-004).
 *
 * §10.6 calls the soft-404 "a real, easily-introduced defect in single-page
 * application delivery — it must be explicitly prevented and regression-
 * tested." This list is that test. Before this feature, every one of these
 * returned `index.html` at HTTP 200.
 */
export const BAD_PATHS = Object.freeze([
  // Plain nonsense
  '/nonsense', '/does-not-exist', '/foo', '/foo/bar', '/foo/bar/baz',
  // Opportunistic scanner probes
  '/wp-login.php', '/wp-admin', '/wp-content/uploads/x.php', '/xmlrpc.php',
  '/.env', '/.env.local', '/.git/config', '/.aws/credentials', '/config.json',
  '/administrator', '/phpmyadmin', '/adminer.php', '/.well-known/nonsense',
  '/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php',
  // Framework-shaped paths that do not exist here
  '/index.php', '/index.jsp', '/default.asp', '/cgi-bin/test.cgi',
  '/api/v1/nonexistent', '/api/graphql', '/api/', '/api/users',
  // Casing and separator variants of real prefixes
  '/NONSENSE', '/Partners/nope', '/PARTNERS', '/Events/NOPE', '/MAGAZINE',
  // Trailing-slash and double-slash variants
  '/nonsense/', '//nonsense', '/partners//', '/events///',
  // Real prefixes with unknown slugs
  '/partners/deleted-partner', '/partners/does-not-exist',
  '/outlets/no-such-outlet', '/events/no-such-event',
  '/magazine/no-such-article', '/committees/no-such-committee',
  // Asset-shaped paths with no file behind them
  '/logo.png', '/favicon.ico.bak', '/styles.css', '/app.js', '/bundle.js.map',
  '/images/missing.jpg', '/media/deadbeef/medium.webp',
  // Query strings must not create a new indexable URL either
  '/nonsense?utm_source=x', '/?nonexistent=1&page=99',
  // Path traversal shapes
  '/../etc/passwd', '/%2e%2e/etc/passwd',
  // Long and odd
  `/${'a'.repeat(200)}`, '/%00', '/null', '/undefined', '/[object Object]',
])

if (BAD_PATHS.length < 50) {
  throw new Error(`The soft-404 corpus must hold at least 50 paths (SC-004); it has ${BAD_PATHS.length}`)
}
