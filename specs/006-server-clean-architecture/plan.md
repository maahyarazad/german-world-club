# Implementation Plan: Server Clean Architecture Reorganization

**Branch**: `006-server-clean-architecture` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-server-clean-architecture/spec.md`

## Summary

`server/src` today is organized by domain folder (`auth/`, `media/`, `seo/`, `organisations/`,
`push/`, `public/`, `ops/`), but within each folder `routes.js` mixes three concerns in one file:
Fastify schema/wiring, request/response translation, and the actual business rule (e.g.
`auth/routes.js` is 750 lines covering sign-in, OTP, refresh, and session revocation logic inline
with its route declarations). Separately, `server/src/plugins/00`–`15` are genuine Fastify
plugins already well-isolated, but `app.js` itself contains a large number of ad-hoc
`app.decorate(...)` calls and two hand-written hooks (`onRequest` CSRF check, `onClose` dispatcher
shutdown, `onReady` budget assertion) that are neither plugins nor part of any domain — they are
cross-cutting infrastructure wiring with no home of their own.

This plan splits each domain's `routes.js` into **route** (schema + `config.auth`/`config.produces`
+ wiring), **controller** (request → application call → reply), and **application** (framework-free
business logic) files; extracts the ad-hoc decorators and hooks in `app.js` into their own
`decorators/` and `hooks/` folders so they are discoverable as their own Fastify category; and
leaves the already-correct `plugins/00`–`15` bootstrap untouched in location, order, and numbering.
Migration proceeds one domain at a time (`auth` → `media` → `seo`+`organisations`+`push`+`public` →
`ops`) so each step is independently testable against the existing suite, per FR-007.

## Technical Context

**Language/Version**: Node.js 22, ES modules, no TypeScript (per `CLAUDE.md`)

**Primary Dependencies**: Fastify 5, `fastify-plugin`, `fastify-type-provider-zod`, `zod`,
`@gwc/contracts` (workspace package)

**Storage**: PostgreSQL (via `src/db/`), Redis (via `src/plugins/06-redis.js`) — unchanged by this
feature; no schema or query changes

**Testing**: Vitest (`npm run -w server test`); existing suites under `server/tests/` (or colocated,
per current convention — confirmed in Phase 0) assert against `fastify.inject()`, not file layout

**Target Platform**: Linux server (Fastify HTTP API), same as today

**Project Type**: web-service (existing monorepo workspace `server/`, unchanged workspace boundary)

**Performance Goals**: N/A — this is a structural refactor; no behavior or performance target
changes. The plugin boot order that produces today's latency/rejection characteristics (rate limit
before auth, deadlines before handlers) MUST be bit-for-bit preserved.

**Constraints**: Zero observable behavior change (FR-005); numbered plugin bootstrap order
untouched (FR-003); full test suite green at every domain-sized step (FR-006, FR-007)

**Scale/Scope**: ~40 files across 7 domain folders (`auth`, `media`, `seo`, `organisations`, `push`,
`public`, `ops`) plus `app.js` and `src/plugins/`; `packages/contracts`, `client/`, `specs/` other
than this one, and the database schema are explicitly out of scope (per spec Assumptions)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

This feature changes file layout and import paths only — no route's access posture, response
schema, budget, or database interaction changes. Each principle is therefore a **preservation**
requirement, not a new design decision:

- **I. One Rule Set, Three Clients** — PASS. No shared-contract package changes; `@gwc/contracts`
  imports move with the files that use them, unchanged in content.
- **II. Declare Every Posture; Silence Fails The Build** — PASS, contingent on FR-005/FR-006. Every
  route's `config.auth` and `schema.response`/`config.produces` must be carried over verbatim to
  its new route file; the startup gate that fails the build on an undeclared posture is the
  regression detector for this principle during migration.
- **III. Published State Must Match Real State** — PASS (not touched; no URL, redirect, or
  canonical-origin logic changes).
- **IV. Integrity Lives In The Database** — PASS (not touched; no query or transaction logic
  changes, only which file each query lives in).
- **V. Failure Is Explicit And Bounded** — PASS, contingent on FR-003. The deadline/breaker plugin
  order and budget declarations are the mechanism; this plan does not renumber or reorder them.
- **VI. The Server Shapes What Leaves It** — PASS (not touched; response serialization schemas move
  with their routes unchanged).

No violations. Nothing in Complexity Tracking is needed.

## Project Structure

### Documentation (this feature)

```text
specs/006-server-clean-architecture/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── quickstart.md         # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

No `data-model.md` — this feature introduces no new entities or persisted state. No `contracts/`
— it changes no external HTTP/CLI contract; the existing OpenAPI document (generated from route
schemas, per `15-openapi.js`) is the contract, and this feature asserts it is byte-for-byte
unchanged in shape (only route registration order in the *generated document* may reorder, which
`verify:seo`/OpenAPI snapshot tests will catch — see quickstart.md).

### Source Code (repository root)

```text
server/src/
├── app.js                       # unchanged role: builds the Fastify instance, calls register()
├── server.js                    # unchanged: listen() only
├── config/                      # unchanged (env.js, budgets.js)
├── plugins/                     # UNCHANGED location, numbering, and order (00-15)
│   ├── 00-request-context.js
│   ├── ...
│   └── 15-openapi.js
├── decorators/                  # NEW — extracted from app.js's inline app.decorate() calls
│   ├── content-source.js        #   app.decorate('contentSource', ...)
│   ├── audit.js                 #   app.decorate('audit'|'auditLog', ...)
│   ├── media.js                 #   app.decorate('mediaStorage'|'jobQueue', ...)
│   ├── integrations.js          #   app.decorate('integrations', ...)
│   └── send-otp.js              #   app.decorate('sendOtp', ...) — the one decorator with real
│                                 #   logic (breaker call + fallback), kept here rather than in
│                                 #   auth/ because it is registered before any domain plugin runs
├── hooks/                       # NEW — extracted from app.js's inline addHook() calls
│   ├── csrf-on-request.js       #   the onRequest double-submit check
│   ├── shutdown.js              #   the onClose dispatcher-close hook
│   └── budget-on-ready.js       #   the onReady assertBudgets() hook
├── db/                          # unchanged (already framework-agnostic: pool, query, counters, migrate)
├── authz/                       # unchanged (already framework-agnostic: guards, permissions)
├── integrations/                # unchanged (already framework-agnostic: mail, sms, payments, geocoding, http-client) — this IS the shared "lib" layer for outbound infra
├── modules/                     # NEW parent — one folder per HTTP-facing domain, replacing the
│   │                             # bare top-level auth/, media/, seo/, organisations/, push/, public/
│   ├── auth/
│   │   ├── routes.js             # schema + config.auth/config.produces + wiring to controller only
│   │   ├── controller.js         # request→application call→reply mapping, no business rules
│   │   ├── application/          # framework-free business logic, one file per use case
│   │   │   ├── sign-in.js
│   │   │   ├── verify-otp.js
│   │   │   ├── resend-otp.js
│   │   │   ├── refresh.js
│   │   │   ├── sign-out.js
│   │   │   ├── request-password-reset.js
│   │   │   └── confirm-password-reset.js
│   │   ├── passwords.js          # kept: already framework-free (hash/verify), used by application/
│   │   ├── tokens.js             # kept: already framework-free
│   │   ├── sessions.js           # kept: already framework-free
│   │   └── otp.js                # kept: already framework-free
│   ├── media/
│   │   ├── routes.js
│   │   ├── controller.js
│   │   ├── application/          # upload, derive, deliver use cases
│   │   ├── worker.js              # kept: queue consumer, not an HTTP route
│   │   ├── storage.js             # kept: framework-free infra
│   │   ├── derive-image.js / derive-video.js / strip-metadata.js / validate.js  # kept: framework-free
│   │   └── queue.js
│   ├── seo/
│   │   ├── public-routes.js       # renamed from robots.js/sitemap.js registration entry points
│   │   ├── staff-routes.js
│   │   ├── staff-controller.js
│   │   ├── application/
│   │   └── build-page-meta.js / structured-data.js / surfaces.js  # kept: framework-free
│   ├── organisations/
│   │   ├── routes.js
│   │   ├── controller.js
│   │   └── application/
│   ├── push/
│   │   ├── routes.js
│   │   ├── controller.js
│   │   ├── application/
│   │   └── providers.js           # kept: framework-free infra
│   ├── public/
│   │   ├── routes.js
│   │   ├── controller.js
│   │   ├── application/
│   │   └── content.js             # kept: framework-free content resolver
│   └── ops/
│       ├── health.js              # kept as-is: trivial, no split needed (single liveness check)
│       ├── jobs.js                # kept as-is: scheduler registration + hook, not a domain use case
│       ├── metrics.js             # kept as-is
│       └── audit.js               # kept as-is: framework-free reader/writer, used by decorators/audit.js
├── seed/                         # unchanged — CLI-invoked, not HTTP; already correctly separate (FR-009)
└── scripts/                      # unchanged — CLI-invoked (migrate, seed, keys, token, verify-seo)
```

**Structure Decision**: Single project (existing `server/` workspace, unchanged workspace
boundary). The reorg introduces `decorators/`, `hooks/`, and `modules/` as new top-level categories
inside `server/src`, leaves `plugins/`, `db/`, `authz/`, `integrations/`, `config/`, `seed/`, and
`scripts/` where they are (they already match one clean-architecture layer each: plugin
bootstrap, and framework-free infrastructure/lib respectively), and splits every domain's
`routes.js` into `routes.js` + `controller.js` + `application/*.js` inside `modules/<domain>/`.
`ops/` is kept flat: `health.js`, `jobs.js`, `metrics.js`, `audit.js` are each already a single
narrow concern with no business logic worth extracting into a separate application layer, and
forcing a controller/application split on a one-line liveness check would add indirection with no
navigability benefit (the spec's own success criteria are about *finding things faster*, not about
uniform ceremony).

## Complexity Tracking

*No constitution violations — table not needed.*
