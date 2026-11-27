# Implementation Plan: Reset a forgotten password in the app, by SMS code

**Branch**: `043-expo-password-reset` (not created: no branch hook is registered; create it from `main` before implementing) | **Date**: 2026-11-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/043-expo-password-reset/spec.md`

## Summary

The Expo sign-in screen gets a "Forgot password?" journey that mirrors the web's two steps: **ask** (by email or by mobile number) and **choose a new password** (with the code texted to the member's number). The server gains two public routes and reuses what already exists: the one-time-code machinery (`otp_challenges`, `issueChallenge`, `verifyChallenge`), the one SMS gateway (`app.sendOtp`, with its country policy), the shared password-change-and-revoke-everything logic of the emailed-link reset, and the generic resend route.

**On the database.** The requester would ideally change nothing. Almost nothing changes: `otp_challenges.purpose` has a CHECK that allows four named values, so a fifth, `password_reset`, needs **one widened rule** (migration `050`, a copy of what `020` did). No table, column, index or row. Every design that avoids even that is unsafe: reusing `mobile_verification` or `login` would let a reset code **sign someone in without a password** at `/onboarding/verify-mobile` or `/auth/verify-otp` (checked in the code), and storing the code in `password_reset_tokens` makes it redeemable at the token endpoint by presenting `"<id>:<code>"`, bypassing the five-try ceiling. See research R1. The requester's decision on this is the first open item below.

Four things the design takes care over (research R2 to R6): the code is **six digits** (it stands alone in front of an account), there is **one live code** per member, the answer to asking is **identical** whatever the identifier matches (the club is invite-only), and the **text is sent after the reply** so existence does not leak through timing either.

No native module is added, so **no new EAS build**.

**Added on 2026-11-27: the look of the public auth screens** (spec US4 and US5; research R12 to R16; [contracts/public-screens-style.md](./contracts/public-screens-style.md)). The requester supplied a light and a dark backdrop and asked for the sign-in screen to carry the club's logo and the same buttons as elsewhere, and for the forgot-password and reset-password screens to match. So:
- the app's backdrop follows the phone's light or dark setting, using two **phone-sized copies** (1170 px wide) made from the supplied 4875 x 10550 originals, which are never bundled;
- the light backdrop loses its wash (measured: text is already 16.6:1 on it) and the dark one **keeps** it (measured: without it secondary text is 2.4:1, below the 4.5:1 minimum), and the requester's empty-string wash value becomes a valid `'transparent'`;
- one shared `AuthScreen` layout (logo card, content, stacked standard buttons laid out like the welcome screen's) is built first and used by the sign-in screen and by both new screens, so the two new screens are never built twice and the three cannot drift.

## Technical Context

**Language/Version**: TypeScript (strict) on Node 22; Fastify 5 with Zod route schemas; app is Expo SDK 57 / React Native 0.86 / expo-router

**Primary Dependencies**: existing only. `@gwc/contracts` (new exports in `auth.ts`), `pg`, Fastify, Zod, the SMSGlobal gateway behind `app.sendOtp`. **No new package, no new native module.**

**Storage**: PostgreSQL. One migration, `050_otp_password_reset_purpose.sql`, widening one CHECK. Nothing else.

**Testing**: vitest for the server (`describe.skipIf(!hasDatabase)`, `buildOnboardingApp()` which returns the app and an `sms` capture array) and contracts. The **Expo app has no test runner** (only `lint` and `typecheck`), so the app is covered by those and by quickstart Sections 3 to 5 on a real device. Server tests must run against a **scratch** database (they truncate tables).

**Target Platform**: Linux server; iOS and Android via Expo.

**Project Type**: web service + mobile app sharing `packages/contracts`.

**Performance Goals**: none beyond the existing: asking is one indexed read, one small transaction and a detached send; confirming is one transaction and one argon2id hash, performed **after** the code is verified so a wrong code costs no hash.

**Constraints**: a route must declare its posture or the server will not boot; queries in `application/` name their columns; the server emits no localised text; the app has no inline style objects and keeps no refusal in state except where it changes behaviour or the person cannot proceed without it; every list/screen shows a loader rather than a false empty state; request and log scrubbing is central (`REDACT_PATHS`); `expo-client/german-world-club/AGENTS.md` requires reading the Expo 57 docs before writing app code (the screens use only components already in the app, so no new Expo API is introduced).

**Scale/Scope**: 2 new routes, 1 changed route (resend), 2 new rate-limit buckets, 1 migration, 3 new and 2 changed server application files, 2 new app screens plus edits to 4 app files and both catalogues, and for the look (US4, US5): 1 new shared layout component, 2 new image copies, 3 changed app files (`app-background.tsx`, `theme.ts`, `sign-in.tsx`) and 2 small guard tests.

No `NEEDS CLARIFICATION` remains. Four decisions need the requester's confirmation (Open items below); none blocks the design.

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 (below).* Against constitution **4.0.0**.

| Principle | Verdict | How this feature meets it | Automated check |
|---|---|---|---|
| **I. One rule set, three clients** | Pass | Eligibility, the code length, the limits, and the one-use and expiry rules are decided on the server. The request/response shapes, `PASSWORD_RESET_CODE_LENGTH` and the mobile-number rule (`isValidMobileE164`) are in `@gwc/contracts`; the app only decides what to *display* and validates for convenience, and the server re-checks everything. The password change is one shared function used by both reset flows, so they cannot drift. | contracts tests; `tsc --noEmit`; the flow tests |
| **II. Declare every posture** | Pass | Both new routes declare `audience: 'public'` affirmatively (it appears in the diff) and get rows in the authz matrix. Their rate-limit buckets are declared in `config/rate-limits.ts`, whose startup check refuses a bucket with no dimension. No crawl surface is added (`/auth/*` is API, `no-store`). | `authz/matrix.test.ts`, route-posture gate |
| **III. Published state matches real state** | Pass, with one recorded tension | No public page or sitemap changes. The "ask" answer is `202 requested` even when nothing was sent. That is the non-enumeration rule (§3.1) and has direct precedent (the emailed-link `requested: true`, and `resendOtp`'s random challenge id); the body claims only "requested", and the on-screen words are conditional ("if an account matches"). Recorded under Complexity Tracking. | `password-reset-code.test.ts` (uniformity) |
| **IV. Integrity lives in the database** | Pass | The five-try ceiling, expiry, single use, device binding and purpose isolation are enforced inside `verifyChallenge`'s `FOR UPDATE` transaction, unchanged. The password change, session revocation and audit follow the existing code. The "one live code per member" rule is kept by consuming the earlier challenge inside the issuing transaction **under a row lock on the member**, so two simultaneous asks cannot leave two live codes; a partial unique index would be the stronger form but is a database change the requester asked to avoid (research R1, R3). Audit stays append-only. | `password-reset-code.test.ts` (concurrency, attempts) |
| **V. Failure explicit and bounded** | Pass | The send is behind the SMS gateway's failure handling, and its refusal is **declared**: for this route a refusal or failure is logged (masked) and the answer stays uniform. The route runs in the existing `otp-send` budget class, so the boot gate (outbound budgets below the deadline) is unchanged. All limiters fail closed. A detached send can be lost if the process stops mid-send; the member asks again after 60 seconds. | boot gates; limits tests |
| **VI. The server shapes what leaves it** | Pass | The answer carries no number, masked or otherwise, no name, no hint of an account. Queries name their columns. `email`, `mobile`, `code` and `password` are redacted by the existing central paths and are never in a URL. The code appears only on the documented development terminal line (the 4.0.0 exception). | `ops/logging-redaction.test.ts` (extended), `no-select-star` |

**Constraints from CLAUDE.md this plan honours**: "one-time codes carry a purpose and endpoints redeem only their own" (strengthened: tested in both directions); "every SMS goes through one gateway" (`sms-gateway.test.ts` scans `src/` for any other caller, so the new code must use `app.sendOtp`); "a new revocation reason must be added to `sessions_revoked_reason_check`" (none is new); the app logs failures with `console.error('<Component>.<function>', …)`; styles in `StyleSheet.create`; strings in both catalogues; the server emits no localised text.

**Post-design re-check**: still passes. Four departures are recorded under Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/043-expo-password-reset/
├── plan.md                              # This file
├── spec.md                              # 5 user stories, FR-001..024, SC-001..010, decisions taken on the requester's behalf
├── research.md                          # R1..R16: decisions and rejected alternatives (R1 is the database; R12 to R16 the look)
├── data-model.md                        # One widened CHECK; the challenge lifecycle; eligibility
├── quickstart.md                        # How to prove it end to end, with a persona table
├── checklists/requirements.md           # Spec quality checklist
├── contracts/
│   ├── password-reset-code-api.md       # POST /auth/password-reset/code, /code/confirm, resend, where a reset code is refused
│   ├── expo-reset-ui.md                 # The two screens, the states, the refusals, the strings
│   └── public-screens-style.md          # Backdrop, wash, logo, shared layout and buttons (US4, US5)
└── tasks.md                             # NOT created here (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/contracts/
├── src/auth.ts                                       # + PASSWORD_RESET_CODE_LENGTH, passwordResetCodeRequestSchema
│                                                     #   (union: email | mobile + deviceId), passwordResetCodeAcceptedSchema,
│                                                     #   passwordResetCodeConfirmSchema, types
└── tests/password-reset.test.ts                      # NEW  exactly-one-identifier, six digits, password bounds, E.164

server/
├── migrations/050_otp_password_reset_purpose.sql     # NEW  widen otp_challenges_purpose_check
├── src/config/rate-limits.ts                         # + 'password-reset-sms' (phone, 3/h), 'password-reset-ip' (ip, ~20/h)
├── src/modules/auth/
│   ├── otp.ts                                        # purpose union gains 'password_reset'; digits-by-purpose
│   ├── routes.ts, controller.ts                      # + POST /auth/password-reset/code, /code/confirm;
│   │                                                 #   resend route gains a purpose-conditional second limiter
│   └── application/
│       ├── request-password-reset-code.ts            # NEW  resolve member, supersede, issue, detached send, uniform answer
│       ├── confirm-password-reset-code.ts            # NEW  verify code (purpose 'password_reset'), re-check, finish
│       ├── finish-password-reset.ts                  # NEW  shared: hash, update member, revoke all sessions, denylist, audit
│       ├── confirm-password-reset.ts                 # refactor onto finish-password-reset (behaviour unchanged)
│       └── resend-otp.ts                             # six digits for 'password_reset'; supersede; count against the reset bucket
└── tests/
    ├── auth/password-reset-code.test.ts              # NEW  flow, uniformity, concurrency, attempts, expiry, device binding
    ├── auth/password-reset-purpose.test.ts           # NEW  a reset code opens nothing else; other codes cannot reset (both ways)
    ├── auth/password-reset-limits.test.ts            # NEW  3 per hour by email, by number, mixed; non-match identical
    ├── authz/matrix.test.ts                          # + 2 public rows
    └── ops/logging-redaction.test.ts                 # + the identifier, code and password never reach a log line

expo-client/german-world-club/
├── src/api/endpoints.ts                              # + authApi.requestPasswordResetCode, confirmPasswordResetCode
├── src/app/(public)/
│   ├── forgot-password.tsx                           # NEW  ask: Email | Mobile chips, MobileField, uniform next step
│   ├── reset-password.tsx                            # NEW  CodeField(6), new password + repeat, resend with cooldown
│   ├── _layout.tsx                                   # + two Stack.Screen entries
│   └── sign-in.tsx                                   # + "Forgot password?" action; reads a `notice` param for the success message;
│                                                     #   (US5) moves onto AuthScreen: logo, primary Sign in, secondary Forgot password
├── src/components/auth-screen.tsx                    # NEW  shared layout: logo card, title, children, stacked standard buttons
├── src/components/app-background.tsx                 # (US4) light/dark art by the device's scheme, from the phone-sized copies
├── src/constants/theme.ts                            # (US4) BackdropScrim.light = 'transparent' (was ''), dark kept; measured comment
├── src/i18n/de.ts, en.ts                             # + passwordReset block (formal "Sie")
└── assets/
    ├── main-bg-light-phone.png, main-bg-dark-phone.png   # NEW  1170 px wide copies, made with sips from the supplied originals
    └── main-bg-light-01.png, main-bg-dark-01.png         # the supplied 4875 x 10550 originals: source art, never `require`d

client/tests/assets/
├── expo-backdrop.test.ts                             # NEW  copies exist and are small; app-background requires them and no original;
│                                                     #      wash values are valid and the dark one stays at or above 0.45
└── expo-auth-screens.test.ts                         # NEW  the three screens use AuthScreen and only standard buttons;
                                                      #      auth-screen.tsx draws the welcome screen's emblem with its logo and actions style
```

**Structure Decision**: the existing monorepo layout; server logic follows `routes.ts` / `controller.ts` / `application/`; the app follows its existing public-screen pattern. No new workspace.

## Delivery order

1. **Database and contracts** (small, unblocks everything): migration `050`, the shared schemas and constant, the purpose union.
2. **Server: ask and confirm** (spec US1 and US2, the MVP): `finish-password-reset` refactor first (the emailed-link tests must stay green), then request, confirm, routes, buckets.
3. **Server: resend and limits** (spec US3): resend digits and supersede, the purpose-conditional limiter.
4. **App foundations**: strings, the two API calls, and the shared `AuthScreen` layout, **before** the screens, so the new screens are built on it once.
5. **App: the two screens and the sign-in link** (spec US1 to US3), on `AuthScreen`.
6. **The look** (spec US4 backdrop, US5 sign-in restyle): independent of the server work and of each other, and the last thing built because they are checked by eye on a device. US5 needs the screens from step 5.

The server steps are independently testable with `curl` and the vitest suites before the app exists.

## Complexity Tracking

> No principle is violated. Four departures from established stances are recorded because a simpler alternative was rejected on purpose.

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| **A migration, when the requester asked for none.** One widened CHECK. | A reset code needs its own purpose, and the database refuses an unknown one. | Reusing `mobile_verification`, `login`, `device_approval` or `email_verification` lets a reset code sign someone in or confirm an email; storing the code in `password_reset_tokens` bypasses the attempt ceiling (research R1). The smallest safe change is one line of SQL with precedent (`020`). |
| **A uniform `202` for a request that sent nothing** (Principle III tension). | Whether an email or a number belongs to a member must not be public. | An honest "no such account" is a membership oracle. Precedent: the emailed-link `requested: true`; `resendOtp`'s random challenge id. |
| **The SMS send is detached and its failure is not shown** (departs from "SMS failures are never hidden", feature 023, for this one route). | An awaited send is a timing oracle, and a 503 on a provider failure is an existence oracle. | Awaiting and throwing reveals which identifiers match. The failure is logged by the gateway and the member can ask again; the requester can overrule (spec US3, research R5). |
| **The app has no automated tests for these screens.** | The Expo workspace has no test runner (also true of features 037 and 042). | Adding a runner is a separate, larger decision. Mitigated by `typecheck`, `lint`, shared schemas tested in contracts, and the quickstart on a device. |

## Open items for the requester

Defaults chosen; say if any is wrong. The first is the only one that touches your stated preference.

1. **The one-line migration** (above). If you want **no** migration at all, the fallback is a `password_reset_tokens` design with a keyed hash and a counter; I recommend against it (research R1), but it is possible.
2. **Members only.** Merchants, partners and staff have no mobile number, so they get no code and keep the web link. Making them reachable from the app would need an email fallback, which is a separate decision.
3. **Six-digit code** (sign-in codes are four), **three codes an hour per number**.
4. **A failed text is not shown to the member**; they see the same screen and can ask again. The failure is logged for operators.

5. **The logo is the welcome screen's emblem** (decided by the requester, research R14): `splash-icon.png` in the welcome screen's own card, so there is no white card and the three screens match the first screen. (Open question closed.)
6. **The dark backdrop keeps its darkening wash** (about 50% black), because on the new mid-grey art secondary text would otherwise be unreadable (2.4:1 against a 4.5:1 minimum, research R13). The light backdrop has no wash, as you started. A lighter dark wash would need `textSecondary` recoloured for dark mode, which changes every screen.
7. **The two source images are 2 MB each** and will add about 4 MB to the repository, as the old `main_bg.png` did. The app ships only the 1170 px copies. Say if you would rather keep the originals out of git.
8. **"The exact same buttons"** is read as the app's standard `Button` (primary for the main action, secondary for the others), stacked full width like the welcome screen's two buttons, on all three screens. If you meant a different look from what the welcome screen has today, that is a change to `Button` itself and affects every screen.

Recommended follow-up, not included: email the member "your password was changed" after a reset (through the mail outbox), so a takeover through a stolen SIM is noticed (research R11).
