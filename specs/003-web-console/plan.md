# Implementation Plan: GWC Web Console

**Branch**: `003-web-console` | **Date**: 2026-09-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-web-console/spec.md`

## Summary

Build the browser-based console for the GWC platform: a member logged-in web experience and three
organisational portals (Admin Panel, Club Merchant Portal, Corporate Club Partner Portal), styled
from the design system extracted from `German_World_Club_Digital_Plattform.docx`, serving all four
principal kinds under the existing five-flag permission matrix. Registration is excluded by
instruction.

The design system is recoverable and clean. The functionality is not there yet. Feature 002's API
exposes routes for **three of nineteen** permission modules; there is no merchant principal, no
partner principal, and no table for offers, entitlements, events, submissions or approvals. So
this plan covers the client **and** the server surface it needs, sliced module by module, each
slice shipping its endpoints, its shared schemas and its screen together. A screen without an API
is not a deliverable.

Two findings shape the work. First, a staff member holding any grant other than `settings.read`
cannot currently fetch their own capability set at all, so the console can render nothing for them.
Fixing it needs a module-less staff route, which the startup gate refuses today — so the gate gains
one explicit, affirmative exemption rather than being loosened (research R3). Second,
`@fastify/static` is registered `wildcard: false` precisely so that unmatched paths produce real 404s, which means a
client-routed console needs a narrow, posture-declared SPA fallback or every deep link breaks
(research R9).

## Technical Context

**Language/Version**: Node 22, ES modules, no TypeScript in the server. React 19.2 in the client.

**Primary Dependencies**: Server — Fastify 5, `@fastify/*`, Zod via `fastify-type-provider-zod`,
`pg`, `undici`. Client — Vite 8.3, Tailwind 4.3, React Router (data router, **to be added** —
nothing routing-related is installed today). Shared — `packages/contracts`.

**Storage**: PostgreSQL, single relational store. Redis for rate limiting and the session denylist
only; quotas live in Postgres under a row lock via `db/counters.js`.

**Testing**: Vitest across workspaces. Client adds Testing Library and `axe-core` (both already
installed by feature 001). Server extends the existing authz matrix and posture suites.

**Target Platform**: Evergreen browsers, 320px and up. Gated surfaces may be client-rendered.

**Project Type**: Web application — existing `server/` + `client/` + `packages/contracts/`
workspaces.

**Performance Goals**: Console surfaces are gated and never indexed, so Core Web Vitals are a
usability concern rather than a ranking one. Every image carries explicit dimensions and is served
as a derivative; no layout shift from media.

**Constraints**: Every request bounded by its route-class deadline, with Σ(outbound budgets) <
the route's own deadline, asserted at startup. Interface language German. WCAG 2.2 AA against both
the light surfaces and the `#171B20` portal chrome. No registration surface anywhere.

**Scale/Scope**: Four principal kinds. Nineteen permission modules, of which three are servable
today. Roughly 40 screens across four portals. Nine new tables.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Initial check — before Phase 0

| Principle | Assessment |
|---|---|
| **I. One Rule Set, Three Clients** | **At risk.** A console is exactly where business rules get reimplemented — a price check in a form, a capability treated as permission, a quota counted client-side. Mitigation is structural: capability data is display-only by contract, and every schema lives in `packages/contracts`. |
| **II. Declare Every Posture** | **At risk.** The four startup gates already refuse to boot an undeclared route, and new endpoints inherit that. But two routes this feature needs have no expressible posture today — a module-less staff route and an SPA fallback — and the temptation in both cases is to loosen the gate rather than extend it. |
| **III. Published State Must Match Real State** | **At risk.** An SPA fallback is the classic way to destroy 404 correctness. Confined to `/konsole/*`. Offer expiry must be a query predicate, not a cached flag. |
| **IV. Integrity Lives In The Database** | **At risk.** Entitlement counts against contract, offer price relationships, one-open-submission-per-subject, last-owner guards — all concurrency-sensitive and all specified as constraints in `data-model.md`. |
| **V. Failure Is Explicit And Bounded** | **Pass.** New routes declare a budget like every other. The console must distinguish a retryable 429 from a non-retryable quota — an interface obligation, recorded as FR-019. |
| **VI. The Server Shapes What Leaves It** | **At risk, twice.** Field-level profile visibility must omit from the response, not hide in markup. Merchant and partner analytics must never carry identifiable member data. Both are response-shape problems, not UI problems. |

**Outcome**: PASS with five principles carrying identified risk. None is a violation; each is a
design constraint carried forward into Phase 1. No entry in Complexity Tracking.

### Re-check — after Phase 1 design

| Principle | How the design satisfies it | Verified by |
|---|---|---|
| **I** | Capability response schema lives in `packages/contracts` and is imported by both sides; a renamed module is a type error, not an empty sidebar. `contracts/capability-api.md` states display-only as a rule with the re-check obligation on the server. Offer price relationship is a database constraint, so the form cannot be the rule. | SC-002, SC-003 |
| **II** | `GET /auth/session` declared `{ audience: 'staff', anyStaff: true }`. The gate currently refuses a module-less staff route, so it gains one branch that accepts the omission **only** against that affirmative flag — silence still fails the build, and `anyStaff` alongside a module is itself a declaration error. SPA fallback declared `{ audience: 'public' }` serving shell only, with `noindex` via `seo/surfaces.js`. Merchant/partner scoping is an object guard inside the transaction, because route-level audience cannot express "your organisation". | SC-010, SC-012 |
| **III** | Fallback confined to `/konsole/*`; every other path keeps its real 404. Offer visibility is a predicate over `published_at`, organisation status and the validity window — expiry needs no job and no staff action. No stored aggregate for anything a query computes. | SC-001 |
| **IV** | `member_price < regular_price`; composite FK `(id, kind)` so an entitlement cannot attach to a merchant; unique open submission per subject; decision FK onto `(submission_id, version)`; last-active-owner trigger; append-only enforced by revoked grants; entitlement count under a row lock via `counters.js`; `organisations` refuses delete like `members`. | SC-009 |
| **V** | Every new route declares `config.budget`; the startup gate already asserts Σ(outbound) < deadline. FR-019 splits 429 from quota in the UI. | existing gate |
| **VI** | `member_field_visibility` drives omission in the response serializer, so a private field is absent from the JSON — the quickstart checks this over the API rather than in the browser, which is the only way to tell the two apart. Merchant/partner analytics are aggregate by schema. Logo served as a derivative with explicit dimensions. | SC-008, FR-034 |

**Outcome**: PASS. Every risk identified in the initial check has a named structural mechanism and
at least one automated check. No principle is violated; Complexity Tracking remains empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-web-console/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output — 11 decisions, 4 open questions
├── data-model.md        # Phase 1 output — 9 new tables
├── quickstart.md        # Phase 1 output — 7 runnable scenarios
├── contracts/
│   ├── design-tokens.md      # Palette, type, components, the gold rule
│   ├── capability-api.md     # GET /auth/session and the display-only rule
│   └── console-surfaces.md   # Every screen, its grant, its server readiness
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source code (repository root)

```text
packages/contracts/src/
├── permissions.js       # + merchant/partner in AUDIENCES and TOKEN_AUDIENCES
├── capabilities.js      # NEW — capability response schema, shared both ways
├── organisations.js     # NEW — organisation, org user, entitlement schemas
├── offers.js            # NEW — offer, redemption, feedback schemas
└── submissions.js       # NEW — submission, version, decision schemas

server/
├── migrations/
│   ├── 013_organisations.sql          # organisations, organisation_users
│   ├── 014_submissions.sql            # submissions, versions, decisions
│   ├── 015_merchant_domain.sql        # locations, offers, redemptions, feedback
│   ├── 016_partner_domain.sql         # entitlements, vacancies, articles
│   └── 017_member_profiles.sql        # profiles, field visibility, connections, ledger
├── src/
│   ├── plugins/10-auth.js             # + merchant/partner in TOKEN_AUDIENCE
│   ├── plugins/11-rbac.js             # + anyStaff exemption in validateAuthConfig
│   ├── auth/routes.js                 # + GET /auth/session
│   ├── authz/object-guards.js         # + organisation scoping guard
│   ├── organisations/routes.js        # NEW
│   ├── merchant/routes.js             # NEW
│   ├── partner/routes.js              # NEW
│   ├── submissions/routes.js          # NEW — the shared approval mechanism
│   ├── members/routes.js              # NEW — profile, visibility, connections
│   ├── app.js                         # + SPA fallback scope for /konsole/*
│   └── seo/surfaces.js                # + /konsole/* posture: gated, noindex
└── tests/
    ├── authz/matrix.test.js           # new routes join automatically
    ├── authz/any-staff-posture.test.js # NEW — silence still fails; anyStaff+module fails too
    ├── console/spa-fallback.test.js   # NEW — fallback does not break 404s
    └── privacy/no-member-leakage.test.js  # NEW — SC-008

client/src/
├── styles/theme.css     # @theme tokens from contracts/design-tokens.md
├── lib/
│   ├── api.js           # fetch wrapper: cookies, problem+json, refresh
│   ├── problems.js      # branch on type, never on detail
│   └── capabilities.js  # fetch, derive navigation, re-fetch on 403
├── console/
│   ├── ConsoleShell.jsx     # sidebar + header + KPI row + cards
│   ├── Sidebar.jsx          # derived from capabilities, never stored
│   ├── RequireGrant.jsx     # display gate — NOT an authorization gate
│   ├── admin/               # Admin Panel screens
│   ├── merchant/            # Club Merchant Portal screens
│   ├── partner/             # Corporate Club Partner Portal screens
│   └── member/              # Member logged-in web screens
├── components/ui/       # Card, KpiTile, StatusPill, Callout, Button, Table
└── auth/                # SignIn, PasswordReset — NO registration

client/tests/
├── capability-matrix.test.jsx   # SC-002, with its counter-assertion
├── refusals.test.jsx            # SC-003
├── no-registration.test.jsx     # SC-004
├── tokens.test.js               # SC-005
└── a11y/                        # SC-006, both backgrounds
```

**Structure Decision**: The existing three-workspace layout is kept unchanged. The console is built
inside `client/` because the Vite, Tailwind, Vitest and `axe-core` harness already exists there and
a second frontend workspace would split the design tokens. Everything both sides need — capability
shape, organisation schemas, offer schemas — goes in `packages/contracts`, per `CLAUDE.md`: a shape
both the server and a client need belongs there, not in either of them.

## Delivery order

Sliced so each increment is independently shippable and testable. The ordering is derived from what
unblocks what, not from what is easiest.

| # | Slice | Delivers | Blocked on |
|---|---|---|---|
| 1 | **Foundations** | `GET /auth/session`, SPA fallback, design tokens, console shell, sign-in, capability-derived navigation | — |
| 2 | **First live modules** | SEO editor, push campaigns, staff profile — the three modules with a working API | 1 |
| 3 | **Members & admins** | Member administration, roles & permissions editor; `members` and `admin_users` tables already exist | 1 |
| 4 | **Submissions** | The shared approval mechanism: submissions, versions, decisions, staff queues, audit | 1 |
| 5 | **Organisations** | Merchant and partner principals, organisation tables, object-level scoping, both portal shells | 1 |
| 6 | **Merchant domain** | Locations, products, offers, redemptions, feedback, aggregate analytics | 4, 5 |
| 7 | **Partner domain** | Entitlements, vacancies, articles, aggregate analytics | 4, 5 |
| 8 | **Member web** | Profile, field visibility, connections, benefits, value ledger | 1 |
| 9 | **Remaining modules** | Events, registrations, committees, complaints, billing views, jobs, audit queries | 4 |

Slice 1 alone delivers a correctly scoped console that renders honest empty states. Slice 2 makes
it genuinely useful to staff. Slices 6 and 7 are where the design document's portals become real.

## Risks

| Risk | Consequence | Mitigation |
|---|---|---|
| Capability data used as an authorization decision | The console becomes the only barrier to an action | `RequireGrant` is named a display gate in code and comment; every server operation re-checks; SC-003 drives the UI with under-privileged principals |
| SPA fallback widened during debugging | 404 correctness lost across the whole origin, silently | A dedicated test asserts unmatched non-console paths still 404 |
| A field marked private hidden rather than omitted | Member PII in a response that was never meant to carry it | The quickstart checks the API response, not the rendered page |
| Merchant analytics leaking member identity | Contractual and trust breach the design document names explicitly | A response-scanning test across every merchant/partner route (SC-008) |
| Sixteen modules land as dead sidebar entries | A console that lies about what it can do | `available` comes from the server, so the client cannot drift |
| Brand font arrives late | A styling sweep across every component | One `--font-sans` token; the swap is one line |
| Scope | Nine slices is a large feature | Each slice independently shippable; 1–2 alone is a useful deliverable |

## Open questions

Carried from research, none blocking Phase 2:

1. **Brand typeface** — not named anywhere in the source document. System grotesk stack assumed
   behind one token.
2. **Console route prefix** — `/konsole` assumed, German to match the interface.
3. **Merchant/partner sign-in entry** — one shared sign-in screen assumed; the server answers with
   the principal kind, so the user is never asked to pick a portal. Asking would leak which kinds
   of account exist for an address.
4. **The coming-soon page at `/`** — unaffected; the console mounts under its own prefix.

## Complexity Tracking

No Constitution violations. Table intentionally empty.
