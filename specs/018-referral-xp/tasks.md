---

description: "Task list for feature 018: Referral links and XP"
---

# Tasks: Referral links and XP

**Input**: Design documents from `specs/018-referral-xp/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R19), data-model.md, contracts/http-api.md,
contracts/ui-contract.md, quickstart.md

**Tests**: Included. The constitution's workflow section requires every principle to have an
automated check that fails the build, and plan.md / quickstart.md name the suites. Each test
carries a **counter-assertion** (CLAUDE.md conventions) so it cannot pass against a server that
did nothing. Write each story's tests first and confirm they fail before implementing.

**Organization**: Tasks are grouped by user story so each can be implemented, tested and shown
on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US4, from spec.md
- Paths are from the repository root. Workspaces: `server/`, `client/`, `packages/contracts/`,
  `expo-client/german-world-club/` (shortened to `expo/` **only in prose**, never in paths)

## House rules every task inherits

- Server code is TypeScript under `server/src/`. HTTP features live in
  `server/src/modules/<domain>/`, split into `routes.ts` (schema, posture, wiring),
  `controller.ts` (request/reply) and `application/` (framework-free rules).
- Every route declares `config.auth`, a `budget` and, where named, a `rateLimit` bucket. Errors
  are RFC 9457 problems from `PROBLEMS` in `@gwc/contracts/errors`. **No new problem types.**
- Queries on a response path **name their columns**. Never `SELECT *`.
- Comments explain *why*, especially where the obvious implementation is wrong.
- Clients: every string goes in both i18n catalogues. A caught error is
  `console.error('<Component>.<fn>', error instanceof ApiError ? error.problem : error)` and
  nothing of the refusal is kept in state.
- Shapes shared by the server and a client live in `packages/contracts`, never redeclared
  locally.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: contracts, constants and dependencies every later phase imports

- [X] T001 Create `packages/contracts/src/referrals.ts`:
  - `REFERRAL_CODE_ALPHABET` (Crockford base-32: `0123456789ABCDEFGHJKMNPQRSTVWXYZ`) and
    `REFERRAL_CODE_LENGTH = 8`.
  - `normaliseReferralCode(input): string | null`: upper-case, strip spaces and hyphens, map
    `I`/`L`→`1` and `O`→`0`. Return `null` unless the result is exactly 8 alphabet characters.
  - `formatReferralCode(code)`: `XXXX-XXXX`.
  - `REFERRAL_STAGES = ['registered','approved','joined','did_not_join']`.
  - Zod schemas and inferred types for `referralLink`, `referralSummary`, `referral`, `xpEntry`,
    a generic `page` (`{ items, nextCursor }`), `staffReferralOwner`, `disableLinkRequest`,
    `reverseXpRequest`, `xpRate` and `setXpRateRequest`, exactly as listed in
    `specs/018-referral-xp/data-model.md` § Contracts.
  - Reasons are 1–500 characters after trim. XP rate is an integer from 1 to 100000.
- [X] T002 [P] Add a unit test `packages/contracts/src/referrals.test.ts` for
  `normaliseReferralCode`: `abcd-efgh`, `ABCD EFGH` and `abcdefgh` all give `ABCDEFGH`; `ILO0`
  maps to `1100`; 7 or 9 characters and any `U` give `null`. Counter-assertion: a valid code
  survives a round trip through `formatReferralCode`.
- [X] T003 Export `"./referrals": "./src/referrals.ts"` in `packages/contracts/package.json`.
- [X] T004 [P] Add `'referrals'` to `MODULES` in `packages/contracts/src/permissions.ts`, with a
  comment: flags used are `read` (view), `status` (disable link, reverse award) and `edit` (XP
  rate); `write`/`delete` are unused because staff create nothing and nothing is deleted (R12).
- [X] T005 [P] Add `referralCode: z.string().trim().max(20).optional()` to
  `registerRequestSchema` in `packages/contracts/src/onboarding.ts`, with a comment that the
  server normalises it and silently ignores an invalid value (FR-006, R10).
- [X] T006 [P] Add `expo-clipboard` (SDK 57 compatible, via `npx expo install expo-clipboard`) to
  `expo-client/german-world-club/package.json`.
- [X] T007 [P] Add two optional settings to `server/src/config/env.ts`:
  - `ANDROID_APP_CERT_SHA256`: comma-separated SHA-256 fingerprints, parsed to an array, empty
    when unset.
  - `APPLE_APP_ID`: defaults to `YQFY6269ZL.com.buenapublica.germanworldclub`.

  Comment that neither is a boot precondition, because universal links enhance the landing page
  rather than replace it (R9). Document both in `server/README.md`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schema, read model and cross-cutting wiring that every story uses

**⚠️ CRITICAL**: no user story work can begin until this phase is complete

- [X] T008 Write `server/migrations/040_referrals.sql` exactly per
  `specs/018-referral-xp/data-model.md`:
  - `ALTER TYPE admin_module ADD VALUE IF NOT EXISTS 'referrals'` (not used later in the same
    file, as `030_server_faults.sql` explains).
  - Enums `referral_link_state` and `xp_entry_kind`.
  - Tables `referral_links`, `referrals`, `xp_entries` and `referral_xp_rates`, with every
    CHECK, unique and partial unique index listed there.
  - Column `membership_applications.pending_referral_link_id`.
  - Triggers:
    - link transitions (`active→retired|disabled` only, other columns frozen, no DELETE);
    - `referrals`, `xp_entries` and `referral_xp_rates` refuse UPDATE and DELETE;
    - BEFORE INSERT on `referrals`: the referrer equals the link owner;
    - BEFORE INSERT on `xp_entries`: an award's owner equals its referral's referrer; a
      reversal targets an `award` with the same owner and referral, and `amount = -target.amount`.
  - The initial rate row `(100, now(), NULL, 'initial rate')`.
  - A header comment explaining why (Principle IV, FR-014), and that `TRUNCATE` is used only by
    the test reset.
- [X] T009 Add `resetReferrals(pool)` to `server/tests/helpers/db.ts`. It truncates
  `xp_entries, referrals, referral_links` and resets the pending column. It keeps
  `referral_xp_rates`, deleting only rows other than the initial one, via `TRUNCATE` plus a
  re-insert of the initial row. Mirror `resetServerFaults` and say why `TRUNCATE` (row triggers
  don't fire).
- [X] T010 [P] Classify `referral_links`, `referrals`, `xp_entries` and `referral_xp_rates` under
  `SEEDED` in `server/src/seed/tables.ts`, with a comment that none holds a credential and all
  follow the consistent-history rule (R18). `tests/seed/table-manifest.test.ts` must stay green.
- [X] T011 [P] Add three rows to `SURFACES` in `server/src/modules/seo/surfaces.ts`:
  - `referral-landing` `['/r']`: public, `indexed: false`;
  - `app-links` `['/.well-known']`: public, `indexed: false`;
  - `referrals` `['/referrals']`: gated, `indexed: false`.

  Each gets a `why`, and the landing row's comment says why it is not under `/invite` (R8).
- [X] T012 [P] Add `'xp'` to `SAFE_DETAIL_KEYS` in `server/src/ops/audit.ts`. Add a comment there
  that referral codes are never audited, link ids are (R17).
- [X] T013 Create `server/src/modules/referrals/application/codes.ts`:
  - `generateCode()`: `crypto.randomInt` over the alphabet.
  - `insertLinkWithFreshCode(client, owner)`: retries on a `referral_links_code_key` unique
    violation, at most 5 times, then throws.
  - `resolveActiveLink(db, rawCode)`: normalises; returns `{ linkId, ownerKind, ownerId }` only
    when the link is `active` **and** the owner can sign in (member `status='active'`,
    `organisation_users.status='active'`, `admin_users.is_active`); otherwise `null`.

  Unknown, retired, disabled and inactive-owner codes must be indistinguishable to callers
  (FR-006).
- [X] T014 [P] Create `server/src/modules/referrals/application/owner-name.ts`:
  `ownerDisplayName(db, ownerKind, ownerId)`.
  - member → `members.display_name`;
  - merchant/partner → the `organisation_profiles` name of the user's organisation;
  - admin → `null`, which the template renders as "the German World Club team".

  Names columns explicitly (R8).
- [X] T015 Create `server/src/modules/referrals/application/read-model.ts`:
  - `REFEREE_COLUMNS`: `handle`, else the first word of `display_name` + ` ` + the initial of the
    last word + `.`, computed in SQL (R15).
  - `STAGE_SQL`: computes `stage`, `approved_at`, `joined_at` and `ended_at` from
    `membership_applications` and `member_profiling`, never selecting `denial_reason` (R14).
  - `balanceOf(db, owner)` → `COALESCE(SUM(amount),0)`.
  - `stageCounts(db, owner)` → `Record<Stage, number>`.
  - `summaryFor(db, owner, link)` → `ReferralSummary`, with `url` built from `CANONICAL_ORIGIN`
    + `/r/` + code.

  Comment: stages and balance are computed, never stored (FR-015, R14).

**Checkpoint**: `npm run -w server migrate` applies 040 cleanly. `npm run -w server test -- seed
authz seo` stays green.

---

## Phase 3: User Story 1 — Get and share my referral link (Priority: P1) 🎯 MVP

**Goal**: every signed-in member (approved and profiled), merchant user, partner user and staff
member sees one stable personal link and code on the web, and members and organisation users in
the app too. They can copy, share and replace it.

**Independent Test**: sign in as a member, open Refer & earn, and copy the link. Sign in on the
other client and see the same code. Replace it and see a new code. The old link is retired.

### Tests for User Story 1 ⚠️ (write first, see them fail)

- [X] T016 [P] [US1] `server/tests/referrals/links.test.ts`:
  - The first `GET /referrals` creates a link, and a second returns the same code.
  - 10 concurrent first calls produce exactly one active link.
  - `POST /referrals/link/replace` returns a new code and the old row is `retired`.
  - The merchant, partner and `/admin/referrals/me` mounts each return the caller's own link.

  Counter-assertion: two different members get different codes.
- [X] T017 [P] [US1] `server/tests/referrals/applicant-refused.test.ts`: an applicant who is
  pending, or approved but not profiled, is refused on `GET /referrals` with the same problem
  10-auth gives elsewhere. Counter-assertion: an approved and profiled member gets `200`.
- [X] T018 [P] [US1] `server/tests/referrals/link-transitions.test.ts` (raw SQL):
  - `retired→active` and changing `code` are refused, and `DELETE` is refused;
  - a second `active` link for the same owner violates the partial unique index.

  Counter-assertion: `active→retired` succeeds.

### Implementation for User Story 1

- [X] T019 [US1] Create `server/src/modules/referrals/application/links.ts`:
  - `getOrCreateLink(app, owner)`: select the active link; else `insertLinkWithFreshCode`. On a
    partial-unique conflict, re-read. Audit `referral_link_created`.
  - `replaceLink(app, owner)`: one transaction, retire the current link and insert a new one.
    Audit `referral_link_replaced` with both link ids.

  Owner is `{ kind: 'member'|'merchant'|'partner'|'admin', id }`.
- [X] T020 [US1] Create `server/src/modules/referrals/controller.ts`: `summary` and
  `replace`. Each derives the owner from `request.principal` and the mount's audience, never from
  the body or params, and returns `summaryFor`.
- [X] T021 [US1] Create `server/src/modules/referrals/routes.ts`. One loop mounts `GET {prefix}`
  and `POST {prefix}/link/replace` for `[['/referrals','member'], ['/referrals/merchant',
  'merchant'], ['/referrals/partner','partner'], ['/admin/referrals/me','staff']]`, following the
  `/media` mounts in `server/src/modules/media/routes.ts`.
  - Staff is `{ audience: 'staff', anyStaff: true }`.
  - Buckets: `member-api` / `admin-api` for GET, `write-heavy` for replace.
  - Budgets: `member-read` / `admin-read`.
  - `cache-control: private, no-store` on every response.
- [X] T022 [US1] Register the referrals route plugin in the route-plugin list (where
  `onboarding-routes` is registered, after `15-openapi`).
  `tests/authz/route-posture.test.ts` must pass.
- [X] T023 [P] [US1] Web: add a `referrals` namespace to `client/src/i18n/de.ts` and
  `client/src/i18n/en.ts`. Keys: title ("Empfehlen & verdienen" / "Refer & earn"), yourLink,
  yourCode, copyLink, copyCode, copied, replace, replaceConfirm (the old link stops working for
  new sign-ups and people already referred stay credited), xpBalance, the four stage labels,
  emptyReferrals, xpHistory, loadFailed and retry. `npm run -w client test:i18n` must pass.
- [X] T024 [US1] Create `client/src/member/Referrals.tsx`, used by all three web faces through a
  `basePath` prop (`/referrals`, `/referrals/merchant`, `/referrals/partner`,
  `/admin/referrals/me`). It shows:
  - the link and code (`formatReferralCode`) with Copy buttons (`navigator.clipboard`, a 2 s
    "copied" flag);
  - Replace behind the existing `Modal` confirm;
  - the XP balance (formatted by the active locale, **no currency**) and the stage counts.
- [X] T025 [US1] Wire the web routes and navigation:
  - `empfehlen` under `/konsole/mitglied`, `/konsole/{merchant,partner}` and `/konsole/admin`
    in `client/src/console/routes.tsx`;
  - nav items in `client/src/member/MemberLayout.tsx`,
    `client/src/organisation/OrganisationLayout.tsx` and
    `client/src/console/admin/AdminLayout.tsx` (all staff, with no `RequireGrant`).
- [X] T026 [P] [US1] `client/tests/member/referrals.test.tsx` (Testing Library, mocked API):
  - it renders the code formatted;
  - Copy writes the full URL;
  - Replace asks for confirmation before posting;
  - the balance renders with `de` and `en` number formatting and no `€`.

  Counter-assertion: with the API failing it shows the load-failed state and keeps no problem
  text.
- [X] T027 [P] [US1] App: add a `referrals` namespace to
  `expo-client/german-world-club/src/i18n/en.ts` and `de.ts` (same keys as T023, plus share and
  shareMessage), and `referralsApi.{summary, replace}` to
  `expo-client/german-world-club/src/api/endpoints.ts`, typed from `@gwc/contracts/referrals`.
  `summary`/`replace` take the audience prefix.
- [X] T028 [US1] Create `expo-client/german-world-club/src/components/referrals-view.tsx`: link,
  code, Copy link and Copy code (`expo-clipboard`), Share (React Native `Share.share` with
  `shareMessage` and the URL), Replace behind an `Alert` confirm, then balance and stage counts.
  It takes the audience prefix as a prop.
- [X] T029 [US1] Create the two app screens:
  - `expo-client/german-world-club/src/app/(member)/profile/referrals.tsx` (prefix `/referrals`)
    and its entry row in `expo-client/german-world-club/src/app/(member)/profile/index.tsx`;
  - `expo-client/german-world-club/src/app/(organisation)/referrals.tsx` (prefix from the
    session's kind) and its button in
    `expo-client/german-world-club/src/app/(organisation)/index.tsx`.

  Register both in their stack `_layout.tsx`. No sixth tab (R19).

**Checkpoint**: US1 works alone. Links exist, are stable, can be replaced and shared on both
faces. Nobody can sign up through them yet.

---

## Phase 4: User Story 2 — Sign up through someone's link (Priority: P1)

**Goal**: a tapped link opens the landing page or the app's registration with the code filled in.
When the new person verifies their mobile, the referral and its XP award are written once, in
one transaction (R1–R4).

**Independent Test**: open a member's link in a private window and register and verify an
applicant. The member has one referral and one 100 XP award. An applicant registered without a
code credits nobody.

### Tests for User Story 2 ⚠️ (write first, see them fail)

- [ ] T030 [P] [US2] `server/tests/referrals/attribution.test.ts`: register with a code, then
  verify-mobile, gives one `referrals` row and one `award` at the current rate, plus audits
  `referral_recorded` and `xp_awarded`. The web flow (no `deviceId`) and the app flow (with one)
  both work. Counter-assertion: the same flow without a code gives zero rows.
- [ ] T031 [P] [US2] `server/tests/referrals/unverified.test.ts`: register with a code and never
  verify gives no referral and no award. The resume path (register twice with the same password
  and a different code) credits only the second code's owner after verify. Counter-assertion:
  after verify a referral exists.
- [ ] T032 [P] [US2] `server/tests/referrals/exactly-once.test.ts`: 10 concurrent valid
  verify-mobile calls for one applicant give exactly 1 referral and exactly 1 award (assert `=
  1`, not `>= 1`). A raw `INSERT` of a second award for the same referral is refused.
- [ ] T033 [P] [US2] `server/tests/referrals/invalid-codes.test.ts`:
  - `GET /r/` with an unknown code, a retired code, a disabled code (set by SQL) and a
    locked-owner code gives byte-identical bodies, status `404` and identical headers apart from
    the request id;
  - the `register` responses for those four codes and for no code have identical shapes;
  - none of the four credits anybody after verify.

  Counter-assertion: an active code gives `200` containing the owner's display name.
- [ ] T034 [P] [US2] `server/tests/referrals/self-referral.test.ts`: an applicant registering
  with a staff owner's email, or an organisation user owner's email, gets no referral, and an
  audit `referral_refused` row with `reason: 'self-referral'` is written. The applicant's
  responses are identical to an ordinary registration. Counter-assertion: a different email is
  credited.
- [ ] T035 [P] [US2] `server/tests/seo/referral-landing.test.ts`:
  - `/r/:code` carries `X-Robots-Tag: noindex`, `cache-control: private, no-store` and
    `referrer-policy: no-referrer`;
  - it renders meaningful content with no `<script>`;
  - it has OG tags;
  - `?lang=en` renders English and the response does not vary with `Accept-Language`;
  - it is absent from `/sitemap.xml` and not disallowed in `/robots.txt`.

  Counter-assertion: `/konsole` is still disallowed.
- [ ] T036 [P] [US2] `server/tests/seo/app-links.test.ts`: `apple-app-site-association` is JSON
  with `APPLE_APP_ID` and only `/r/*` paths. `assetlinks.json` is `404` without
  `ANDROID_APP_CERT_SHA256` and JSON with the package and fingerprints when it is set.
- [ ] T037 [P] [US2] `server/tests/onboarding/flow.test.ts` and `web.test.ts`: run them
  **unchanged** and confirm they pass after T040. They are the regression guard for making
  verify-mobile transactional.

### Implementation for User Story 2

- [ ] T038 [US2] Create `server/src/modules/referrals/application/attribution.ts`:
  `recordReferral(app, client, memberId)`, called inside verify-mobile's transaction. It:
  1. reads `pending_referral_link_id`;
  2. re-checks the link and owner via `resolveActiveLink`-by-id (R2);
  3. checks self-referral against the owner's email (all kinds) and mobile (members) (R3);
  4. inserts into `referrals ... ON CONFLICT (referee_member_id) DO NOTHING RETURNING id`;
  5. only when a row was returned, inserts the award with the latest `referral_xp_rates` row's
     `xp` and `id` (R11), `ON CONFLICT DO NOTHING`.

  It returns what happened so the caller audits after commit (`referral_recorded` +
  `xp_awarded`, or `referral_refused` with reason `self-referral` / `link-inactive`).
  Comment: why here and not at register (R1).
- [ ] T039 [US2] In `server/src/modules/onboarding/application/register.ts`, resolve
  `input.referralCode` with `resolveActiveLink`. Write `pending_referral_link_id` (or NULL) in
  both the new-account insert and the resume `UPDATE`. Comment: the last code before
  verification wins, and an invalid code changes nothing visible (FR-006). The response must not
  change.
- [ ] T040 [US2] In `server/src/modules/onboarding/application/verify.ts` `verifyMobile`, wrap
  the `mobile_verified_at` update and `recordReferral` in one `withTransaction`. Only call
  `recordReferral` when the update actually set the column (`RETURNING`), so a second verify is
  a no-op. Write the audits after commit. Session issuing stays where it is.
- [ ] T041 [P] [US2] Create `server/src/modules/public/templates/referral.ts`:
  - `renderReferralLanding({ name, code, lang })`, in German/English by `lang`, with links to
    `/konsole/registrieren?ref=CODE` and `germanworldclub://r/CODE`, store links and OG tags;
  - `renderReferralNotFound({ lang })`, one page for all invalid cases, with a registration link
    and no code.

  Use `escape` and the layout from `templates/layout.ts`. No script.
- [ ] T042 [US2] Add the public routes in `server/src/modules/public/routes.ts` and
  `controller.ts`:
  - `GET /r/:code`: `publicConfig`; `resolveActiveLink` + `ownerDisplayName`; `200` landing or
    `404` not-found page; the three headers from T035.
  - `GET /.well-known/apple-app-site-association` and `GET /.well-known/assetlinks.json`: built
    from env (T007), `cache-control: public, max-age=3600`.
- [ ] T043 [US2] Web registration in `client/src/onboarding/Register.tsx`: read `ref` from
  `useSearchParams`, add an optional **Empfehlungscode / Referral code** field (prefilled,
  editable, displayed through `formatReferralCode`) and send `referralCode` with the request.
  No lookup and no message for an invalid code. Add the i18n keys `referralCode` and
  `referralCodeHint` to both web catalogues.
- [ ] T044 [P] [US2] `client/tests/onboarding/web-onboarding.test.tsx`: `?ref=abcd-efgh`
  prefills `ABCD-EFGH` and the submitted body carries the code. Counter-assertion: with no `?ref`
  the body has no `referralCode`.
- [ ] T045 [US2] App registration in `expo-client/german-world-club/src/app/(public)/register.tsx`:
  an optional referral code `TextField` bound to `draft.referralCode`, formatted for display and
  placed after the mobile field. Make sure the country step's submit passes the draft's
  `referralCode` through. Add i18n keys to both app catalogues.
- [ ] T046 [US2] Create `expo-client/german-world-club/src/app/r/[code].tsx`. Signed out:
  `update({ referralCode: code })`, then `router.replace('/(public)/register')`. Any session:
  `router.replace('/')`. Comment that the server decides validity (R10).
- [ ] T047 [US2] App config in `expo-client/german-world-club/app.config.js`:
  - `ios.associatedDomains: [`applinks:${process.env.EXPO_PUBLIC_LINK_HOST}`]`;
  - an Android `intentFilters` entry (`autoVerify: true`, `https`, host from
    `EXPO_PUBLIC_LINK_HOST`, `pathPrefix: '/r/'`);
  - the `expo-clipboard` plugin, if it needs one.

  Fail the config with a clear message when `EXPO_PUBLIC_LINK_HOST` is unset for a production
  profile. Comment that this needs a new EAS native build (R9).

**Checkpoint**: US1 + US2 are the MVP. People can refer and be referred, and XP is recorded
correctly even though there is no screen for it yet beyond the balance.

---

## Phase 5: User Story 3 — Track my referrals and earn XP (Priority: P2)

**Goal**: the referrer sees each referral's stage and dates, and the full XP history, on both
faces. The balance always equals the history.

**Independent Test**: take a referred applicant through approval and profiling. The stage goes
Registered → Approved → Joined and the balance is unchanged after registration. Deny another: it
shows Did not join with no reason.

### Tests for User Story 3 ⚠️ (write first, see them fail)

- [ ] T048 [P] [US3] `server/tests/referrals/stages.test.ts`: approval moves the stage to
  `approved` (with `approvedAt`), profiling completion to `joined`, and denial to `did_not_join`.
  No stage change adds an `xp_entries` row. Counter-assertion: a just-verified referral is
  `registered`.
- [ ] T049 [P] [US3] `server/tests/referrals/balance.test.ts`:
  - the balance equals Σ `amount` after an award, after a reversal inserted by SQL, and after a
    new rate row inserted by SQL followed by a new referral;
  - the earlier award keeps 100 while the new one is the new rate (FR-013).

  Counter-assertion: the balance is not 0 after the first award.
- [ ] T050 [P] [US3] `server/tests/referrals/ledger-immutable.test.ts` (raw SQL): `UPDATE` and
  `DELETE` on `xp_entries`, `referrals` and `referral_xp_rates` are each refused. A reversal with
  the wrong amount, or of a reversal, is refused. Counter-assertion: a valid `INSERT` succeeds.
- [ ] T051 [P] [US3] `server/tests/referrals/no-pii.test.ts`, and extend
  `server/tests/ops/no-pii-in-social.test.ts` to include `/referrals*`: no response from the
  owner list or XP routes contains the referee's email, mobile, birthday, country, denial reason
  or profiling fields. Counter-assertion: the referee's handle, or their first name and initial,
  *is* present.

### Implementation for User Story 3

- [ ] T052 [US3] Create `server/src/modules/referrals/application/lists.ts`:
  - `listReferrals(db, owner, cursor)`: `REFEREE_COLUMNS` + `STAGE_SQL` + the award amount, keyset
    on `(created_at, id)` descending, 50 per page;
  - `listXp(db, owner, cursor)`: entries, with the reason rendered as data (the client builds
    "Referral: *name*" / "Reversed: *reason*"), same paging.

  Opaque cursors as in existing paged routes.
- [ ] T053 [US3] Add `GET {prefix}/referrals` and `GET {prefix}/xp` to the four mounts in
  `server/src/modules/referrals/routes.ts` and `controller.ts` (`member-api` / `admin-api`).
- [ ] T054 [US3] Web: extend `client/src/member/Referrals.tsx` with the paged **Your referrals**
  list (name, stage badge, date of current stage) and the paged **XP history** (+/− amount, reason
  text, date). Add the empty states and i18n keys to both catalogues. Extend
  `client/tests/member/referrals.test.tsx` with list rendering and the `did_not_join` badge
  showing no reason.
- [ ] T055 [US3] App: add `referralsApi.{referrals, xp}` in
  `expo-client/german-world-club/src/api/endpoints.ts` and extend
  `expo-client/german-world-club/src/components/referrals-view.tsx` with both lists, using
  `usePaged` from `src/hooks/use-paged.ts`. Add the i18n keys to both app catalogues.

**Checkpoint**: US1–US3 work. Members can see what their referrals earned and how far each got.

---

## Phase 6: User Story 4 — Staff oversight of referrals and XP (Priority: P3)

**Goal**: staff with the `referrals` module can view anyone's referrals and XP, disable a link,
reverse an award and change the rate. Every action needs a reason and is audited. Staff can't
act on their own records.

**Independent Test**: as staff with `status`, reverse an award with a reason. The balance drops,
both entries show, the audit log names the actor and reason, and a second reversal is a 409.

### Tests for User Story 4 ⚠️ (write first, see them fail)

- [ ] T056 [P] [US4] `server/tests/referrals/staff.test.ts`:
  - reverse → `200` and a matching negative entry; reverse again → `409 conflict`; reverse a
    reversal → `409`;
  - reverse or disable one's **own** record → `403`;
  - no `referrals` grant → `403`; `read` only → `403` on reverse and disable;
  - disable → the link's `/r/` becomes the shared 404, and earlier referrals and XP stay;
  - `PUT xp-rate` without `edit` → `403`, and with `edit` it adds a row.

  Each write writes an audit row with `reason`. Counter-assertion: a superadmin on someone
  else's entry succeeds.
- [ ] T057 [P] [US4] Add every new `/admin/referrals/*` and owner route × each principal kind to
  `server/tests/authz/matrix.test.ts`.

### Implementation for User Story 4

- [ ] T058 [US4] Create `server/src/modules/referrals/application/ledger.ts` (staff actions):
  - `reverseAward(app, { entryId, adminId, reason })`: load the entry `FOR UPDATE`; it must be an
    award (else 409) and not the actor's own (`owner_kind='admin' AND owner_id=adminId` → 403);
    insert the reversal and map the `reverses_entry_id` unique violation to 409.
  - `disableLink(app, { linkId, adminId, reason })`: the same own-record rule; `active` →
    `disabled`, else 409.
  - `setRate(app, { xp, adminId, reason })`.

  Audit `xp_reversed` / `referral_link_disabled` / `xp_rate_changed` with `reason` (+ `xp`).
- [ ] T059 [US4] Create `server/src/modules/referrals/application/staff-queries.ts`:
  - `listOwners(db, { kind, q, cursor })`: owners with a link or entries, name via the per-kind
    columns, balance, stage counts, ordered by referral count;
  - `ownerDetail(db, kind, id)` → `404` when unknown;
  - `rateWithHistory(db)`.

  Named columns only, and the same referee restrictions as owners (FR-018).
- [ ] T060 [US4] Create `server/src/modules/referrals/staff-routes.ts` and `staff-controller.ts`
  with the six routes in `specs/018-referral-xp/contracts/http-api.md` §3, each
  `{ audience: 'staff', module: 'referrals', flag }`, budget `admin-read`, bucket `admin-api`,
  bodies from `@gwc/contracts/referrals`. Register them next to the owner routes (T022).
- [ ] T061 [P] [US4] Web: add an `adminReferrals` i18n namespace to `client/src/i18n/{de,en}.ts`
  (owners, owner detail, disable, reverse, rate, reason prompt, "applies to new referrals only").
- [ ] T062 [US4] Create `client/src/console/admin/Referrals.tsx`:
  - an owners table with search and kind filter;
  - owner detail, reusing the list components from T054;
  - **Disable link** and **Reverse** dialogs with a required reason, shown only with `status` and
    hidden on the viewer's own record;
  - XP rate with history and **Change rate** (`edit`).

  Route `empfehlungen` under `/konsole/admin` in `client/src/console/routes.tsx`, behind
  `RequireGrant module="referrals" flag="read"`, and add a nav item in `AdminLayout.tsx`.
- [ ] T063 [P] [US4] `client/tests/console/admin-referrals.test.tsx`: reason required before
  submit; dialogs hidden without `status`; Reverse hidden on one's own row. Counter-assertion:
  with `status` on another's row the button is present.

**Checkpoint**: all four stories work independently and together.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T064 [P] Create `server/src/seed/referrals.ts`, called from `server/src/scripts/seed-demo.ts`
  after members and organisations, following R18 and the consistent-history rule:
  - links for a sample of members, two organisation users and one staff member, each
    `created_at` before its referees;
  - referrals only for seeded members whose `mobile_verified_at` falls after that, stamped at
    `mobile_verified_at`;
  - one award per referral at the same timestamp, using the initial rate row;
  - no reversals and no disabled links;
  - idempotent (skip existing links by owner).

  `tests/seed/coverage.test.ts`, `determinism.test.ts` and `no-live-credentials.test.ts` must
  stay green.
- [ ] T065 [P] Add `server/tests/seed/referrals-history.test.ts`: after `seed:demo`, every
  referral has exactly one award, and every award's `created_at` equals its referral's and its
  `amount` equals the rate in force then. Counter-assertion: at least one referral was seeded.
- [ ] T066 [P] Add a **Referrals and XP** section to `CLAUDE.md` under "Things that will bite
  you", with the rules a future change could break:
  - a referral is recorded at mobile verification, never at `register`;
  - the ledger is append-only by trigger and the balance is never stored;
  - stages are computed on read;
  - invalid codes are one indistinguishable 404;
  - staff can't act on their own records;
  - the app link needs a native build.
- [ ] T067 [P] Document `ANDROID_APP_CERT_SHA256`, `APPLE_APP_ID` and `EXPO_PUBLIC_LINK_HOST`
  (must equal the `CANONICAL_ORIGIN` host) and the EAS build step in `server/README.md` and
  `expo-client/german-world-club/README.md`.
- [ ] T068 Run the full gate: `npm test`, `npm run -w client test:i18n`,
  `npx -w expo-client/german-world-club tsc --noEmit` and
  `npm run -w expo-client/german-world-club lint`. Fix anything red.
- [ ] T069 Walk `specs/018-referral-xp/quickstart.md` steps 1–9 on the web and a development
  build on one iOS and one Android device. Record the outcome per step in that file.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none. T003 depends on T001.
- **Foundational (Phase 2)**: depends on Setup. T013–T015 depend on T008. **Blocks every
  story.**
- **US1 (Phase 3)**: depends on Foundational only.
- **US2 (Phase 4)**: depends on Foundational. Its tests use links, so either run after T019 or
  create links by SQL in the tests. The web and app registration tasks (T043–T047) don't depend
  on US1.
- **US3 (Phase 5)**: depends on Foundational, and on US2 for real referrals to list (tests can
  insert rows by SQL instead).
- **US4 (Phase 6)**: depends on Foundational. Reversal tests need an award (US2's
  `recordReferral`, or SQL).
- **Polish (Phase 7)**: after the stories it documents or seeds. T064 needs US2's tables in use.

### Within each story

Tests first, and confirm they fail. Then `application/` → controller → routes → clients. The
server before the clients that call it.

### Parallel opportunities

- Setup: T002, T004, T005, T006 and T007 together after T001.
- Foundational: T010, T011, T012 and T014 together, once T008 is written.
- US1: T016–T018 together; T023 and T027 (i18n and API on both faces) alongside the server work;
  T026 once T024 lands.
- US2: T030–T036 together; T041 (template) alongside T038–T040; web T043/T044 and app T045–T047
  alongside the server.
- US3: T048–T051 together; T054 (web) and T055 (app) together after T053.
- US4: T056/T057 together; T061 alongside T058–T060.
- Polish: T064–T067 together.
- With two developers, after Foundational, one can take US1 and the other US2. They share only
  the route plugin file (T021/T053) and the i18n catalogues.

## Parallel Example: User Story 2

```bash
# All US2 server tests at once (different files):
T030 tests/referrals/attribution.test.ts
T031 tests/referrals/unverified.test.ts
T032 tests/referrals/exactly-once.test.ts
T033 tests/referrals/invalid-codes.test.ts
T034 tests/referrals/self-referral.test.ts
T035 tests/seo/referral-landing.test.ts
T036 tests/seo/app-links.test.ts

# Then, side by side:
T038–T040 server attribution path   |  T041 landing template  |  T043–T044 web register  |  T045–T047 app
```

## Implementation Strategy

### MVP first (US1 + US2)

The spec rates both P1, and US1 alone is a link nobody can use. The MVP is:

1. Phases 1 and 2.
2. US1: links on every face. Stop and run its independent test.
3. US2: sign-ups through links are recorded and awarded once. Stop and run its independent test.
4. Ship the server and web. **Start the EAS native build at the same time** (T047). It is the
   long pole for opening links in the app, and typed codes plus the landing page work without it.

### Incremental delivery

- **+ US3**: referrers can see progress and history. This is the gamification payoff.
- **+ US4**: the fraud control. Per the spec's accepted risk, **US4 must ship before any feature
  that converts XP into money**, even if it lands after US3.

### Notes

- [P] means different files with no dependency on an incomplete task.
- Commit after each task or each logical group. Stop at any checkpoint to validate a story on its
  own.
- If any task finds the design wrong (for example verify-mobile can't take a transaction cleanly),
  stop and amend research.md / plan.md first. Don't fix the design quietly in code.
