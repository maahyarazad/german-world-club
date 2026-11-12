# Implementation Plan: Referral links and XP

**Branch**: `018-referral-xp` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/018-referral-xp/spec.md`

## Summary

Every person who can sign in (members, merchant and partner users, staff) gets one personal
referral link, `https://<canonical>/r/<CODE>`, and a short code to read out loud. The link opens
a no-JavaScript landing page, or the app directly through universal links and App Links. Either
way it leads to the existing registration with the code filled in. The referral, and an XP award
at the rate staff set, are written **in the same transaction as the new person's mobile
verification** (R1). That is the first point where an account is proven to hold a real phone,
so typed-in numbers earn nothing.

Integrity is in the database (Principle IV):
- one referrer per person, one award per referral and one reversal per award, all by unique
  constraints;
- referrals, XP entries and rate changes are append-only by trigger, even against hand-written
  SQL;
- the balance is always the sum of the entries and is never stored.

Referral progress (Registered, Approved, Joined, Did not join) is computed on read from
onboarding's own rows (R14). Staff get a new `referrals` module to view, disable links, reverse
awards with a reason and change the rate. They can't act on their own records (R12).

## Technical Context

**Language/Version**: TypeScript throughout. Node 22 + Fastify 5 (server). React 19 + Vite
(web). React Native / Expo SDK 57 + Expo Router (app).

**Primary Dependencies**: `@gwc/contracts` (new `./referrals` export, `registerRequestSchema`
gains a field). Server: none new. Web: none new. App: **`expo-clipboard`** (new native module)
plus `Share` from React Native core. A **new EAS native build** is required for it and for
`associatedDomains` / `intentFilters` (R9).

**Storage**: PostgreSQL. Migration `040_referrals.sql`: four tables, one column on
`membership_applications`, one `admin_module` value, and triggers (data-model.md).

**Testing**: Vitest on the server against a real PostgreSQL (the SQL suites skip loudly
without one). Ten new suites are listed in quickstart.md, each with a counter-assertion. The
existing posture matrix, surface and PII suites are extended. Web: Vitest + Testing Library,
`test:i18n`, `no-hardcoded-strings`. App: `tsc --noEmit` + `expo lint`, plus the manual steps in
quickstart.md.

**Target Platform**: Linux server; evergreen browsers; iOS and Android.

**Project Type**: One API with two clients (web console, Expo app), plus one public
server-rendered page.

**Performance Goals**: The landing page renders in the `public-page` budget, with one
indexed lookup by code. Refer & earn loads in one request, and the balance is a `SUM` over an
indexed owner (tens of rows per person). The extra work in verify-mobile is at most three
indexed lookups and two inserts inside a transaction that already exists.

**Constraints**:
- No new problem types. No server-side localisation.
- The landing page needs no JavaScript and answers 404 for anything invalid (Principle III).
- Codes are never written to the audit log (R17).
- The registration response is byte-identical with or without a code.
- No referee PII reaches a referrer (FR-018).

**Scale/Scope**: About 4 new server modules' worth of files (application, two route sets, one
template), 1 migration, 1 contracts file. Web: 3 pages and 2 changed (Register, sidebars). App: 3
new routes and 2 changed (register, profile), plus config. 10 new server test suites.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Engaged? | Verdict |
|---|---|---|
| I. One rule set, three clients | Yes: who may refer, attribution, the XP amount and stages | **PASS.** Every rule is on the server: attribution happens in verify-mobile, the amount comes from the rate table, stages are computed in SQL. Clients only *format* codes, using the shared `normaliseReferralCode` / `formatReferralCode`. Neither client looks a code up or decides validity (R10). All shapes come from `@gwc/contracts/referrals`. |
| II. Declare every posture | Yes: about 16 new routes and 3 new surfaces | **PASS.** Each route declares `config.auth`, one mount per audience (R13). The staff routes name `module: 'referrals'` and a flag. New surfaces `referral-landing` and `app-links` (public, noindex) and `referrals` (gated) are declared in `surfaces.ts`. Authorization is resolved per request, so disabling a link or revoking the grant takes effect on the next request. Self-action is refused against the loaded target inside the transaction (R12). |
| III. Published state = real state | Yes: `/r/:code` | **PASS.** An invalid code gets `404`, never `200` with fallback content. The page and its OG tags are rendered from live link and owner state on every request (`no-store`). It is never in the sitemap. |
| IV. Integrity in the database | Yes, central | **PASS.** Unique constraints make double attribution, double award and double reversal impossible (R4). Triggers make the ledger, referrals and rates append-only and limit link transitions (R5). The referee's member id is the deterministic retry reference. Members are still never deleted, and referrals point at them by FK. |
| V. Failure explicit and bounded | Slightly: verify-mobile does more work | **PASS.** No new outbound dependency, no new breaker, no new budget. The extra statements run inside verify-mobile's existing `auth` budget. `/r` reuses `public-read` (fail-open, R16). The `.well-known` routes read config only. |
| VI. Server shapes what leaves it | Yes: referee data, landing page | **PASS.** `REFEREE_COLUMNS` is the only selection of referee fields, and it names its columns (no `SELECT *`). A PII scan test covers every new response (R15). The landing page shows a display name only. The audit detail allowlist grows by `xp` only. |

Project conventions checked against CLAUDE.md:
- **Rate limits are not quotas**: no business quota is introduced. If one is ever wanted (for
  example "at most N awards a month"), it goes in `db/counters.ts`, not in the rate limiter.
- **The server emits no localised text**: that rule is about API JSON. The landing page is
  public HTML, like `/` and `/en`, and follows the public pages' rule: language switches by
  **link**, never by `Accept-Language`. `/r/:code` renders German with a link to
  `/r/:code?lang=en`, and the response does not vary with the request headers.
  `no-server-localisation.test.ts` stays green.
- **Seed rules**: the new tables are `SEEDED` under the consistent-history rule (R18). None of
  them holds a credential.
- **Clients report failures to the console**: no refusal text is kept in state (ui-contract.md).

**Post-design re-check**: unchanged, all PASS. No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/018-referral-xp/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R19
├── data-model.md        # migration 040, contracts shapes, seed classification
├── quickstart.md        # automated suites + manual walkthrough
├── contracts/
│   ├── http-api.md      # public page, .well-known, owner and staff routes
│   └── ui-contract.md   # screens on both faces, registration field, deep link
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code

```text
packages/contracts/
├── src/referrals.ts                       NEW  code alphabet/normalise/format, stages, schemas (data-model)
├── src/onboarding.ts                      registerRequestSchema + referralCode?
├── src/permissions.ts                     MODULES + 'referrals' (R12)
└── package.json                           exports "./referrals"

server/
├── migrations/040_referrals.sql           NEW  tables, column, enum value, triggers, initial rate (data-model)
├── src/modules/referrals/
│   ├── routes.ts                          NEW  owner mounts ×4 (R13)
│   ├── staff-routes.ts                    NEW  /admin/referrals/* on module 'referrals'
│   ├── controller.ts / staff-controller.ts NEW
│   └── application/
│       ├── codes.ts                       NEW  generate (crypto, retry on collision), resolve (R7)
│       ├── links.ts                       NEW  get-or-create, replace, disable
│       ├── attribution.ts                 NEW  recordReferral(client, memberId): R1–R4, called by verify-mobile
│       ├── ledger.ts                      NEW  award, reverse, balance, rate (R5, R11)
│       ├── lists.ts                       NEW  referrals with computed stage, REFEREE_COLUMNS (R14, R15)
│       └── owner-name.ts                  NEW  display name per owner kind (R8)
├── src/modules/onboarding/application/register.ts     resolve code → pending_referral_link_id
├── src/modules/onboarding/application/verify.ts       wrap the update in a transaction; call recordReferral
├── src/modules/public/routes.ts            GET /r/:code, /.well-known/* (R8, R9)
├── src/modules/public/templates/referral.ts NEW  landing page and the shared 404 page
├── src/modules/seo/surfaces.ts             + referral-landing, app-links, referrals
├── src/ops/audit.ts                        SAFE_DETAIL_KEYS + 'xp'
├── src/config/env.ts                       ANDROID_APP_CERT_SHA256 (optional), APPLE_APP_ID
├── src/seed/tables.ts                      four tables → SEEDED
├── src/seed/referrals.ts                   NEW  consistent-history seeding (R18)
└── tests/referrals/*.test.ts               NEW  10 suites (quickstart.md)
    tests/ops/no-pii-in-social.test.ts      + referral routes

client/src/
├── member/Referrals.tsx                    NEW  Refer & earn (shared by member, organisation, staff-own)
├── console/admin/Referrals.tsx             NEW  owners, owner detail, XP rate
├── onboarding/Register.tsx                 ?ref= → optional referral code field
├── console/routes.tsx, Sidebar.tsx, organisation/OrganisationLayout.tsx   routes and nav
└── i18n/{de,en}.ts                         referrals namespace

expo-client/german-world-club/
├── app.config.js                           ios.associatedDomains, android.intentFilters, expo-clipboard (R9)
├── src/app/r/[code].tsx                    NEW  deep link → draft → register
├── src/app/(member)/profile/referrals.tsx  NEW
├── src/app/(organisation)/referrals.tsx    NEW
├── src/components/referrals-view.tsx       NEW  shared body of both screens
├── src/app/(public)/register.tsx           optional referral code field
├── src/app/(member)/profile/index.tsx, (organisation)/index.tsx   entry points
├── src/api/endpoints.ts                    referralsApi
└── src/i18n/{de,en}.ts
```

**Structure Decision**: a new server domain module `modules/referrals/`, split the usual way
(routes, controller, framework-free `application/`). The only coupling to onboarding is one
call, `recordReferral(client, memberId)`, inside verify-mobile's transaction. Onboarding owns
*when* it happens and referrals owns *what* happens. The landing page lives in the `public`
module with the other no-JS templates, because that's where the public layout, escaping and
crawl headers already are.

## Risks

- **Fraud is accepted, not prevented** (spec Clarifications). Requiring a verified mobile (R1)
  raises the cost of a fake referral to one SMS-capable number in an allowed country. It does
  not remove the risk. US4 (staff reversal) must ship before any payout feature, and the payout
  feature should decide whether XP from **Did not join** referrals is paid at all. That history
  is recorded.
- **A native build is on the critical path for FR-004 in the app.** Until the build with
  `associatedDomains` / `intentFilters` ships, a tapped link opens the landing page in the
  browser rather than the app. The **Open in the app** button and typed codes still work.
  Android also needs the signing fingerprint in `ANDROID_APP_CERT_SHA256`. Without it,
  `assetlinks.json` is `404` and Android shows a chooser or the browser.
- **verify-mobile becomes transactional.** Today it updates `mobile_verified_at` outside a
  transaction. Wrapping it changes nothing visible, but `tests/onboarding/flow.test.ts` and
  `web.test.ts` must stay green unchanged. They are the regression guard.
- **Staff earn XP (Q2).** Staff can't reverse or disable their own records (R12), but nothing
  stops a staff member deciding an application they referred. The audit log links both actions.
  A rule against it would be a separate feature, as the spec records.
- **The code appears in request logs** (`/r/ABCDEFGH`). It is a shareable identifier, not a
  credential, so it is not redacted. It is kept out of the audit log because the audit log is
  business evidence (R17).

## Complexity Tracking

None. No principle is violated.
