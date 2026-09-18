# Quickstart: Server Platform Foundation

**Feature**: `002-server-platform` | **Plan**: [plan.md](./plan.md)

A validation guide. Each scenario proves one success criterion end to end and states the expected outcome, so it can be run as an acceptance walkthrough or lifted into CI. It describes *how to verify*, not how to implement — see [contracts/](./contracts/) and [data-model.md](./data-model.md) for behaviour and shape.

Scenarios are grouped by the phase that delivers them; each group is runnable as soon as its phase lands.

---

## Prerequisites

| Requirement | Verified value | Notes |
|---|---|---|
| Node.js | v22.23.2 | Confirmed in this environment |
| npm | 10.9.8 | Workspaces required |
| PostgreSQL | 16+ | `citext` extension needed for case-insensitive email and slug columns |
| Redis | 7+ | Rate-limit buckets, session denylist |
| Docker | optional | For `testcontainers`; without it, point at local instances |
| `ffmpeg` | required for video | Pinned via `ffmpeg-static`; a system binary works for development (`which ffmpeg`) |
| Object storage | S3-compatible, or the local-disk driver | Deployed environments use object storage so derivatives are not tied to an app instance |

### Deployment preconditions that must be settled before production

These are the items where a server setting has to agree with something outside the server. Each one fails startup in production rather than degrading silently.

| Setting | Why it cannot default | Risk if wrong |
|---|---|---|
| `TRUST_PROXY` | Must equal the real proxy hop count | Too low: every client keys to the proxy address and per-address limits do nothing. `true`: a client forges `X-Forwarded-For` and bypasses every limit (Risk 4) |
| `CANONICAL_ORIGIN` | One host + scheme, used for 301s and absolute OG URLs | Relative or wrong-host `og:image` breaks every link preview |
| `KEEP_ALIVE_TIMEOUT` | Must exceed the proxy's idle timeout | Sporadic 502s as the proxy reuses a socket the server is closing |

---

## Setup

```bash
# from the repository root
npm install                                  # installs all workspaces
cp server/.env.example server/.env           # then fill DATABASE_URL, REDIS_URL, JWT keys

npm run -w server migrate                    # applies migrations 001–007
npm run -w server seed:dev                   # one superadmin, one department admin, one member
npm run -w server dev                        # http://localhost:3000
```

Generate the signing keypair once (EdDSA, per [auth-api.md](./contracts/auth-api.md)):

```bash
npm run -w server keys:generate              # writes JWT_PRIVATE_KEY / JWT_PUBLIC_KEY into .env
```

Confirm the server is up and reporting dependencies:

```bash
curl -s localhost:3000/health/live            # -> {"status":"ok"}
curl -s localhost:3000/health/ready | jq      # -> per-dependency breakdown, all "ok"
```

---

## Phase A — Startup gates

### A1 · An undeclared route fails startup  *(SC-001)*

```bash
npm run -w server test tests/authz/route-posture.test.js
```

**Expected**: the suite registers a route with no `config.auth`, asserts startup **throws**, and asserts the message names the offending method and path. A passing run means an unguarded route cannot reach `main`.

### A2 · The budget assertion holds  *(FR-033)*

```bash
npm run -w server test tests/resilience/budget-assertion.test.js
```

**Expected**: startup fails when a route's outbound budgets sum to ≥ its handler deadline. See [resilience.md §1](./contracts/resilience.md).

### A3 · Correlation and redaction  *(SC-016)*

```bash
curl -s -D- localhost:3000/health/live | grep -i x-request-id
npm run -w server test tests/ops/logging-redaction.test.js
```

**Expected**: a ULID in `X-Request-Id`; the suite drives a sign-in and asserts **zero** log lines match any credential, token, OTP, or contact-detail pattern.

### A4 · Request timeout is no longer disabled  *(Risk 2)*

```bash
node -e "console.log(require('fastify')().server.requestTimeout)"   # bare Fastify: 0
curl -s localhost:3000/health/ready -o /dev/null -w '%{http_code}\n'
npm run -w server test tests/resilience/timeouts.test.js
```

**Expected**: bare Fastify prints `0`, confirming the default this feature overrides. The built app reports a non-zero `requestTimeout`, asserted in the suite.

---

## Phase B — Public delivery and SEO

### B1 · The soft-404 is gone  *(SC-004)* — the headline check

```bash
for p in /nonsense /wp-login.php /.env /index.php /partners/deleted /NONSENSE/; do
  printf '%-24s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' localhost:3000$p)"
done
npm run -w server test tests/seo/soft-404.test.js
```

**Expected**: **404 for every path.** Before this feature, each returned `200` with `index.html` — the §10.6 / §12.13 defect. The suite runs the full ≥50-path corpus in `tests/fixtures/bad-paths.js`.

### B2 · Public content without JavaScript  *(SC-005)*

```bash
curl -s localhost:3000/ | grep -c "Experts Circle"
curl -s localhost:3000/partners/example-partner | grep -c "<h1"
npm run -w server test tests/seo/rendering.test.js
```

**Expected**: non-zero counts — real content in the raw bytes, with no JS executed. This is §10.2's requirement, and the reason preview bots work at all.

### B3 · OG tags and share previews  *(FR-018)*

```bash
curl -s localhost:3000/partners/example-partner \
  | grep -Eo '<meta (property|name)="(og|twitter):[^"]*" content="[^"]*"'
```

**Expected**: `og:title`, `og:description`, `og:url`, `og:image`, `og:image:width`, `og:image:height`, `og:image:alt`, `twitter:card`. Absolute URLs on the canonical origin. A missing dimension or alt is a **test failure**, not a silent omission — see [seo-delivery.md §1](./contracts/seo-delivery.md).

### B4 · Metadata uniqueness  *(SC-006)*

```bash
npm run -w server test tests/seo/uniqueness.test.js
```

**Expected**: zero duplicate titles, descriptions, or canonical URLs across every URL in the generated sitemap. §10.3: duplicated boilerplate across partner pages suppresses all of them.

### B5 · Crawl posture per surface  *(SC-008)*

```bash
npm run -w server test tests/seo/crawl-posture.test.js
curl -s localhost:3000/robots.txt
curl -s -D- localhost:3000/portal/profile -o /dev/null | grep -i x-robots-tag
```

**Expected**: every §10.1 surface asserted for status, `X-Robots-Tag`, and robots.txt entry. Gated paths return 401/403 **and** `noindex, nofollow` — §10.1 requires both, because URL shapes leak through referrers.

### B6 · Sitemap tracks live state  *(SC-008)*

```bash
curl -s localhost:3000/sitemap.xml | head -20
npm run -w server test tests/seo/sitemap.test.js
```

**Expected**: only published, indexable, in-contract records. The suite lapses a partner's contract past its grace period and asserts the entry **disappears** with no staff action, and that `lastmod` is the record's real `updated_at`.

### B7 · Structured data matches reality  *(SC-007)*

```bash
curl -s localhost:3000/events/example-event \
  | grep -A30 'application/ld+json'
npm run -w server test tests/seo/structured-data.test.js
```

**Expected**: valid `Event` JSON-LD whose `offers.availability` matches live registration state. The suite closes registration and asserts availability flips. §10.4 calls the alternative "a factual misstatement to members."

### B8 · Canonical origin and legacy redirects  *(FR-028, FR-029)*

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
     -H 'Host: www.example-nonCanonical.test' localhost:3000/
npm run -w server test tests/seo/canonical.test.js
```

**Expected**: `301` to the canonical origin. The legacy-redirect table ships **empty** (Risk 5) — the mechanism and its tests pass, but FR-029 cannot be declared complete until the club supplies the URL inventory.

---

## Phase M — Media ingest and delivery

> Governs Constitution Principle VI. Fixtures live in `/server/tests/fixtures/media/`.

### M1 · Content-inspected typing  *(SC-021)*

```bash
cp fixtures/media/photo.jpg /tmp/actually-a-jpeg.png
curl -s -o /dev/null -w '%{http_code}\n' -F file=@/tmp/actually-a-jpeg.png -F alt=test \
     -H "Authorization: Bearer $TOKEN" localhost:3000/media
npm run -w server test tests/media/validation.test.js
```

**Expected**: the upload is typed from its bytes, not its `.png` name. A file on no allowlist returns 400 `unsupported-media-type`. Zero uploads are accepted on a declared type alone.

### M2 · Decompression bomb refused before decode  *(FR-053)*

```bash
npm run -w server test tests/media/bomb.test.js
```

**Expected**: a small file declaring an extreme pixel count returns 400 `media-dimensions-exceeded` **before** decoding. A 10 KB PNG can declare 100,000 × 100,000 pixels and decode to tens of gigabytes, so the header bound is what makes this endpoint safe to expose.

### M3 · Derivatives generated at upload  *(FR-055, FR-056)*

```bash
curl -s -F file=@fixtures/media/photo-2mb.jpg -F alt='A test photograph' \
     -H "Authorization: Bearer $TOKEN" localhost:3000/media | jq '.state, .width, .height, .variants'
```

**Expected**: `201` with `state: "ready"` and a variant per breakpoint — `thumb` 160, `small` 400, `medium` 800, `large` 1600 px — each carrying its own `format`, `width`, `height`, `bytes`. Intrinsic dimensions are present in the same response, which is what §10.9's layout-shift requirement needs.

### M4 · Never upscaled, alpha preserved  *(FR-056, FR-057)*

```bash
npm run -w server test tests/media/derivatives.test.js tests/media/formats.test.js
```

**Expected**: a 300 px source yields `thumb` and `small` only — no 1600 px variant is invented from a 300 px original. WebP is primary; the fallback is PNG for sources with alpha and JPEG otherwise, because PNG for photographic content is typically 5–10× larger and would defeat the pipeline.

### M5 · Payload actually shrinks  *(SC-019)* — the point of the whole story

```bash
npm run -w server test tests/media/compression.test.js
```

**Expected**: a 2 MB source photograph yields `medium` ≤ 60 KB and `thumb` ≤ 8 KB. This is the measurable form of "the client does not render the full 2 MB file."

### M6 · Location metadata stripped  *(SC-020)*

```bash
exiftool fixtures/media/gps-photo.jpg | grep -i gps        # present in the source
npm run -w server test tests/media/metadata-strip.test.js
```

**Expected**: present in the fixture, absent from both the stored original and every derivative. GPS in a member's marketplace photo is a direct §10.1 PII concern, not a tidiness matter.

### M7 · Video is asynchronous and honest about it  *(FR-058, FR-059)*

```bash
curl -s -F file=@fixtures/media/clip.mp4 -F alt='A test clip' -F kind=video \
     -H "Authorization: Bearer $TOKEN" localhost:3000/media | jq '.state'
npm run -w server test tests/media/video-async.test.js
```

**Expected**: `202` with `state: "processing"`, then `ready` with a WebM derivative and a WebP poster once the queue drains. A failed job sets `failed` with a reason — never a row stuck in `processing`. This is the one place the "derive at upload time" intent cannot hold: a transcode takes minutes and fits no request budget, so it is queued rather than held open.

### M8 · No original is ever the rendering path  *(SC-018, FR-060, FR-062)*

```bash
npm run -w server test tests/media/no-original-served.test.js tests/media/immutability.test.js
curl -s -D- localhost:3000/media/<checksum>/medium.webp -o /dev/null | grep -iE 'cache-control|nosniff'
```

**Expected**: no public page or API response references a stored original's URL. Variant URLs are byte-identical across fetches and carry `immutable` plus `nosniff` — safe because the path is content-addressed, so a URL's bytes can never change.

---

## Phase C — RBAC with JWT

### C1 · The authorization matrix  *(SC-002)*

```bash
npm run -w server test tests/authz/matrix.test.js
```

**Expected**: every route class × every principal kind — anonymous, member, department admin, superadmin. Zero permitted combinations outside the declared matrix. The table *is* the test.

### C2 · Privilege escalation is closed  *(FR-009)* — the sharpest check

```bash
npm run -w server test tests/authz/object-guards.test.js
```

**Expected**: a department admin holding **all five flags** on the `admins` module is still refused when editing an admin or superadmin account. §11 forbids it, and no route-level declaration can express it — see [rbac-model.md §5](./contracts/rbac-model.md).

### C3 · Revocation takes effect on the next request  *(SC-003)*

```bash
npm run -w server test tests/authz/revocation.test.js
```

**Expected**: a superadmin revokes `members.edit`; the target's **very next** request is refused, with no re-login and no waiting for token expiry. This is why permissions are not token claims (research R3).

### C4 · Audience separation  *(FR-003)*

```bash
TOKEN=$(npm run -s -w server token:mint -- --kind member)
curl -s -o /dev/null -w '%{http_code}\n' \
     -H "Authorization: Bearer $TOKEN" localhost:3000/admin/members
```

**Expected**: `403`, failing at token verification rather than inside a handler, plus an audit record.

### C5 · Token claims carry no authorization  *(FR-006, FR-013)*

```bash
npm run -w server test tests/auth/claims.test.js
```

**Expected**: the claim key set is exactly `sub, sid, aud, typ, jti, iat, exp`. No permissions, no membership tier, no email. A well-meaning addition fails here rather than becoming something a client depends on.

### C6 · Single active session and refresh replay  *(FR-004, FR-005)*

```bash
npm run -w server test tests/auth/sessions.test.js tests/auth/refresh-rotation.test.js
```

**Expected**: a second sign-in revokes the first session (`superseded`) via the partial unique index; a replayed refresh token terminates the **whole lineage**, writes an audit record, and returns 401.

### C7 · Status gates  *(FR-010)*

```bash
npm run -w server test tests/auth/status-gates.test.js
```

**Expected**: Locked, Inactive, and Ex-member accounts are each refused with their §3.2 remedy, and **no token is issued** in any case.

### C8 · Credential stuffing, both directions  *(SC-013)*

```bash
npm run -w server test tests/resilience/rate-limit.test.js
```

**Expected**: many addresses against one account is refused (`sign-in-account`), and one address against many accounts is refused (`sign-in-ip`). Both with `Retry-After`. Either bucket alone leaves a real attack open.

---

## Phase D — Resilience

### D1 · Budgets hold under an induced hang  *(SC-009)*

```bash
npm run -w server test tests/resilience/timeouts.test.js
```

**Expected**: a stubbed dependency that never responds; the request completes within 110% of its declared budget, and the underlying query is **cancelled**, not merely abandoned.

### D2 · One hung dependency does not spread  *(SC-010)*

```bash
npm run -w server test tests/resilience/isolation.test.js
```

**Expected**: with the payment stub hung, p99 for routes that do not touch it stays within 20% of baseline.

### D3 · Breaker transitions and recovery  *(SC-011)*

```bash
npm run -w server test tests/resilience/breaker.test.js
```

**Expected**: closed → open at the threshold; **zero** calls reach the dependency while open; after the reset interval a single half-open probe closes the circuit on success. Automatic, no restart.

### D4 · A declined card does not trip the breaker  *(SC-012)* — the subtle one

```bash
npm run -w server test tests/resilience/breaker-errorfilter.test.js
```

**Expected**: 20 consecutive `CARD_DECLINED` responses leave the payment circuit **closed**. Without the `errorFilter`, a busy evening of legitimate declines takes payments down for everyone — an outage caused by the protection itself.

### D5 · Crawlers are not throttled  *(SC-014)*

```bash
npm run -w server test tests/resilience/crawler-budget.test.js
```

**Expected**: a normal-rate crawl over every public route returns **zero** 429s. This is the one place two of this feature's goals conflict, and SEO wins ([resilience.md §3](./contracts/resilience.md)).

### D6 · `trustProxy` keys on the real client  *(FR-040)*

```bash
npm run -w server test tests/resilience/trust-proxy.test.js
```

**Expected**: limits key on the forwarded address at the configured hop depth; a forged extra hop does not bypass the limit.

### D7 · Graceful shutdown  *(SC-015)*

```bash
npm run -w server test tests/resilience/shutdown.test.js
```

**Expected**: readiness fails **before** the drain begins; in-flight requests complete within 15 s; zero dropped.

### D8 · Media generation fails closed  *(FR-063)*

```bash
npm run -w server test tests/media/quota-and-breaker.test.js
```

**Expected**: with the generator failing, uploads return 503 and **zero** assets are recorded `ready`. An asset marked ready without its derivatives would be served as an original and violate Principle VI silently. The per-account stored-byte quota and the `upload` bucket both refuse independently.

### D9 · Client disconnect cancels work  *(FR-034)*

```bash
npm run -w server test tests/resilience/client-abort.test.js
```

**Expected**: an aborted request propagates cancellation into the query rather than leaving it running.

---

## Phase E — Operability

```bash
npm run -w server test tests/ops/
curl -s localhost:3000/health/ready | jq '.dependencies'
curl -s localhost:3000/docs/json | jq '.paths | keys | length'
```

**Expected**: a correlated, redacted trail for a failure at each layer; audit records queryable by principal, target, and required permission; job runs recording start, end, and outcome; OpenAPI generated from the shared Zod schemas with every route present.

---

## Phase F — Full verification

```bash
npm test                                   # all workspaces
npm run -w server test:coverage
npm run -w server verify:seo               # sitemap crawl: uniqueness, status codes, structured data
npm run -w client build && npm run -w server verify:cwv    # Core Web Vitals (SC-017)
```

### Success-criteria coverage

| Criterion | Scenario | Criterion | Scenario |
|---|---|---|---|
| SC-001 | A1 | SC-010 | D2 |
| SC-002 | C1 | SC-011 | D3 |
| SC-003 | C3 | SC-012 | D4 |
| SC-004 | B1 | SC-013 | C8 |
| SC-005 | B2 | SC-014 | D5 |
| SC-006 | B4 | SC-015 | D7 |
| SC-007 | B7 | SC-016 | A3 |
| SC-008 | B5, B6 | SC-017 | Phase F |
| SC-009 | D1 | SC-018 | M8 |
| | | SC-019 | M5 |
| | | SC-020 | M6 |
| | | SC-021 | M1 |

---

## Known-incomplete on delivery

Neither is a defect in this feature; both are inputs the club owns.

| Item | State | Needed before |
|---|---|---|
| `legacy_redirects` table | Mechanism and tests pass; table is **empty** (Risk 5) | Public cutover — FR-029 cannot be verified complete without the inventory |
| Provider breaker tuning | Thresholds and timeouts set against assumed latencies; stubs in place (Risk 6) | Production traffic; re-tune with real latency data |
| Vector partner logos | SVG is refused outright (it can carry script). A sanitised staff-only path is specified when the need is real rather than pre-built | Whenever a partner supplies logo artwork only as SVG |
