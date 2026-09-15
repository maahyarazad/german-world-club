# Contract: HTTP Conventions

**Feature**: `002-server-platform` | **Applies to**: every route, every client

§12.15 makes "one rule set across three clients" a business rule, and §1.1 names re-implementing the same rule per client as the legacy system's most persistent defect. That applies to failures as much as to features: if the web client parses `{error}` and mobile parses `{message}`, error handling diverges on day one.

---

## 1. Error envelope — RFC 9457 problem+json (FR-049)

Every error, from every route:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/problem+json
X-Request-Id: 01JC2KQ8Z7F3N5R9T1V4W6X8Y0
```
```json
{ "type": "https://german-emirates-club.com/problems/insufficient-permission",
  "title": "Insufficient permission",
  "status": 403,
  "detail": "Requires 'edit' on module 'members'.",
  "instance": "/admin/members/42",
  "requestId": "01JC2KQ8Z7F3N5R9T1V4W6X8Y0" }
```

| Field | Rule |
|---|---|
| `type` | Stable URI, the machine-readable key. Clients branch on this, never on `detail` |
| `title` | Short, human-readable, stable per `type` |
| `status` | Matches the HTTP status |
| `detail` | Specific to this occurrence. **Never leaks internals** — a failed query is "An internal error occurred", with the cause in the logs only |
| `instance` | The path that failed |
| `requestId` | Echoes `X-Request-Id`, so a support report is traceable (FR-047) |

Validation failures add `errors`, derived from the Zod issue list:

```json
{ "type": ".../validation-failed", "status": 400,
  "errors": [ { "path": "email", "message": "Invalid email address" } ] }
```

Problem types are exported from `packages/contracts/src/errors.js`, so every client imports the same set and a typo in a client's comparison is a build error rather than a silent mis-branch.

**HTML-accepting requests** get a rendered, `noindex` error page at the same status — never a problem+json body in a browser address bar, and never a 200 (see [seo-delivery.md §3](./seo-delivery.md)).

---

## 2. Status codes

| Code | Used for | Not used for |
|---|---|---|
| 200 | Successful read, or a sign-in `outcome` that is a legitimate business state | **Never** an unknown URL (§12.13) |
| 201 | Resource created; `Location` set | |
| 202 | Accepted for later processing (queued mail, OTP resend) | |
| 204 | Success with no body (sign-out) | |
| 301 | Canonical origin, legacy redirect, changed slug | Temporary moves |
| 304 | Conditional request matched an etag | |
| 400 | Malformed or schema-invalid request | Business-rule rejection (use 409/422) |
| 401 | Absent, invalid, or expired credential | A valid credential lacking permission |
| 403 | Valid credential, insufficient permission; status gates | Absent credential |
| 404 | No such route, no such record | A record the caller may not see — also 404, so existence is not leaked |
| 409 | Conflict with current state (capacity full, already registered) | |
| 410 | Deliberately retired content | |
| 422 | Well-formed but business-rule-invalid (quota exceeded, window closed) | |
| 429 | Rate-limit bucket exceeded; `Retry-After` required | Business quota exceeded (use 422) |
| 500 | Unexpected server fault; `detail` is generic | Anything foreseeable |
| 503 | Handler deadline exceeded, load shed, breaker open; `Retry-After` where known | |

Two distinctions that matter:

- **401 vs 403**: absent or bad credential vs. valid credential without permission. Conflating them tells an unauthenticated caller which resources exist.
- **429 vs 422**: 429 is a transport limit — retry later and it will work. 422 is a business quota (§3.1's invitation quota, §4's capacity) — retrying changes nothing until state changes. A client shown 429 for an exhausted invitation quota will retry forever.

---

## 3. Headers

**Every response**: `X-Request-Id` (ULID, echoed if the client supplied one). Security headers via `@fastify/helmet` — HSTS, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, frame-ancestors, and a CSP whose nonce permits the public templates' inline critical CSS.

**Gated responses**: `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow` (FR-025).

**Public responses**: `Cache-Control` per surface, `ETag`, `Vary: Accept-Encoding, Accept-Language`, `Content-Language`.

`Vary: Accept-Language` is load-bearing with §10.7's multilingual pages: without it a shared cache can serve the German page to an English request, and vice versa.

**Rate-limited**: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After`.

**CORS**: an explicit origin allowlist for the mobile app and any separately-hosted client; `credentials: true` only for known web origins. Never `*` on a route that accepts credentials.

---

## 4. Request correlation

`genReqId` produces a ULID per request — sortable by time, unlike a UUID v4, which makes log scans over a window cheap. It is:

1. echoed as `X-Request-Id`,
2. attached to every `pino` line for the request,
3. included in every error envelope,
4. written to `audit_log.request_id`,
5. carried into non-request code via `@fastify/request-context`, so a log line from inside a dependency call is still attributable.

A client-supplied `X-Request-Id` is accepted and reused after format validation, so a mobile client's identifier and the server's agree. It is never trusted for anything but correlation.

---

## 5. Logging and redaction (FR-048)

`pino` via Fastify's `logController` — **not** the deprecated top-level `disableRequestLogging`, which Fastify 5.12 flags for removal in v6.

Redacted paths, configured at logger construction so they apply to code not yet written:

```
req.headers.authorization   req.headers.cookie   res.headers['set-cookie']
req.body.password           req.body.code        req.body.refreshToken
req.body.email              req.body.mobile      req.body.billing.*
*.accessToken               *.token              *.otp
```

Redaction is a data-protection control, not tidiness: the club holds member PII (§10.1). Configuring it as a path list at construction is what makes it hold for a route added next month; doing it per call site fails on the first forgotten one.

Levels: `error` for 5xx and breaker transitions; `warn` for 4xx on credential paths, rate-limit refusals, and deadline expiries; `info` for request completion; `debug` off in production.

**Audit records are separate** ([data-model.md §5](../data-model.md)). Application logs rotate and belong to operators; audit records are business evidence, are queryable by staff, and are append-only at the grant level.

---

## 6. Health endpoints (FR-050)

| Route | Posture | Reports |
|---|---|---|
| `GET /health/live` | public | Process is up. No dependency checks — a liveness probe that fails on a database blip causes a restart loop |
| `GET /health/ready` | public | Postgres reachable, Redis reachable, migrations current, `under-pressure` not shedding, shutdown not begun |

Both are exempt from rate limiting and from load shedding. Neither is indexable. `/health/ready` returns a dependency-by-dependency breakdown so a failure names its cause without a log dive.

---

## 7. Validation and serialization

Every route declares Zod schemas for params, query, body, and response, bridged by `fastify-type-provider-zod` (R19). One schema gives request validation, response serialization, and the OpenAPI document.

**Response schemas are a privacy control**, not just documentation: a route that serializes through an explicit schema cannot leak a column added to a table later. That matters directly for §10.1's member-PII boundary — an unschematised `SELECT *` is how a phone number reaches a public response two features from now.

Unknown request fields are stripped, not rejected, so a newer client sending an extra field is not broken by an older server.
