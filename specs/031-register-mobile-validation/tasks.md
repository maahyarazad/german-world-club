---
description: "Tasks for 031: a mistyped mobile number must be caught on the client and answered with 422, not a 503"
---

# Tasks: Register — a mobile number typed with its country code

**Input**: the owner's report ("I put `971585831595` as the number in Register and the server answers 503 Service Unavailable; fix it and validate the input on the client, in the app and on the web"), plus a read of the code. No spec/plan exists; the diagnosis below is the spec.
**Branch**: `031-register-mobile-validation`, from `main`.
**Tests**: included. The Expo app has **no test runner**, so its shared rule is tested in `packages/contracts` (which has vitest) and the app screens are verified by `tsc` and the quickstart steps at the end.
**Safety**: server SQL suites only against a throwaway Postgres with an explicit `DATABASE_URL` (never the URL in `server/.env`, which is the production database); no real SMS is sent by any test.

## Diagnosis (read from the code, reproduced by reasoning, not yet by a run)

- `971585831595` is a valid UAE number **without its `+`**: calling code `971`, national number `585831595`.
- The register form is a country picker plus a number field (`client/src/components/ui/MobileField.tsx`, `expo-client/german-world-club/src/components/mobile-field.tsx`). The picker defaults to **Germany**. `toE164(country, typed)` in `packages/contracts/src/dial-codes.ts` turns what was typed into `+<dial code><digits>`, so `971585831595` becomes **`+49971585831595`** (or `+971971585831595` if UAE is picked). A number typed with its own `+` or `00` is the only case it treats as already international.
- The only check anywhere is the regex `E164 = /^\+[1-9][0-9]{6,14}$/` in `packages/contracts/src/onboarding.ts:74`, which says nothing about whether the number exists. Both clients (`client/src/onboarding/Register.tsx` ~l.85, `expo-client/.../(public)/register.tsx` ~l.67) use the same regex, so the bad number passes the form and the server's schema.
- The country policy then allows it (Germany and the UAE are both allowed), so `challengeAndSend` in `server/src/modules/onboarding/application/register.ts` calls `app.sendOtp`; SMSGlobal refuses the destination, and `server/src/decorators/send-otp.ts` turns **every** provider error into `smsUnavailable()` = **503 "Verification unavailable"**. The send is inside the registration transaction, so no member is left behind, but the applicant is told "try again in a few minutes" about a number that will never work, and the same happens at step-3 contact change and sign-in resend.
- So two defects: (1) nothing validates the number beyond its shape, on the client or the server; (2) a provider refusal **of the destination itself** is reported as an outage.

## Decisions to confirm before T003

1. **Library**: add `libphonenumber-js` (pure JavaScript, no native code, so no new EAS build; the `min` metadata is about 80 KB) to `packages/contracts` as the one rule set for the server and both clients (constitution I). Alternative if you do not want a dependency: a hand-written national-length table per country, which is smaller but wrong for many ranges (the German mobile prefixes, `15x/16x/17x`, are exactly what catches this bug).
2. **Auto-correct**: when the typed digits are not a valid number for the picked country but become a valid number when read as international (`971585831595` → `+971585831595`), the field **corrects it and says so** ("read as +971 58 583 1595") rather than silently or with an error. Say if you would rather always show an error.
3. **Mobile only**: a valid landline is refused ("not a mobile number"), because a code can only be texted to a mobile.

## Format: `[ID] [P?] [Story]` Description

- US1: the server refuses a bad number with a 422 the client can act on, and no longer calls it an outage (P1)
- US2: the web client validates the number as it is typed and on submit (P1)
- US3: the Expo app does the same (P1)

---

## Phase 1: Setup

- [X] T001 `git switch main && git pull && git switch -c 031-register-mobile-validation`. Confirm `.specify/feature.json` points at `specs/031-register-mobile-validation`.
- [X] T002 Start a throwaway Postgres (`docker run -d --name gwc-031-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=gwc_test -p 55434:5432 postgres:16-alpine`); in `server/` prefix every command with `DATABASE_URL=postgres://postgres:test@localhost:55434/gwc_test`; pre-mark the stray migration: `psql … -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()); INSERT INTO schema_migrations(filename) VALUES ('delete-member.sql') ON CONFLICT DO NOTHING"`. Record the baseline of `npx vitest run tests/onboarding tests/auth/sms-gateway.test.ts` here. Remove the container in T019.

## Phase 2: Foundational (blocks every story)

- [X] T003 Add the dependency: `npm install -w packages/contracts libphonenumber-js`. Confirm it resolves and builds in all three consumers: `npx tsc --noEmit` in `packages/contracts`, `client` and `expo-client/german-world-club`, a `vite build` of `client` (`npm run -w client build`) and that the app's Metro bundler does not need a native module (it is pure JS: check `expo-client/german-world-club` for an `expo doctor`/`npx expo export --platform android --dev` dry run if time allows, otherwise note it as unverified). If the owner declined the library, replace this task and T004 with a table-based rule and say so here.
- [X] T004 Create `packages/contracts/src/mobile.ts` (export `"./mobile": "./src/mobile.ts"` in `packages/contracts/package.json`): `checkMobile(country: string, typed: string): MobileCheck`, where `MobileCheck = { ok: true; e164: string; corrected: boolean } | { ok: false; reason: 'empty' | 'too-short' | 'too-long' | 'invalid' | 'not-mobile' }`, and `isValidMobileE164(e164: string): boolean`. Rules, in order: strip spaces, dashes, dots, brackets; empty → `empty`; a leading `+` or `00` means international: parse it with `parsePhoneNumberFromString('+…')`; otherwise parse the digits as a national number for `country` (ISO alpha-2); a valid result must be of type `MOBILE` or `FIXED_LINE_OR_MOBILE` (else `not-mobile`) and returns `{ ok: true, e164: number.number, corrected: false }`; when the national reading is **not** valid, try the typed digits as international (`'+' + digits`) and, only if that is valid and a mobile, return it with `corrected: true`; otherwise map the library's `isPossible` reasons to `too-short` / `too-long` and everything else to `invalid`. `toE164` in `dial-codes.ts` is left in place (the picker still uses it for display); the new function is what decides validity.
- [X] T005 Contracts tests in `packages/contracts/src/mobile.test.ts` (vitest, no DB): the reported case `checkMobile('DE', '971585831595')` → `{ ok: true, e164: '+971585831595', corrected: true }`; `checkMobile('AE', '971585831595')` → corrected to `+971585831595` (not `+971971585831595`); `checkMobile('AE', '0585831595')` and `('AE', '585831595')` → `+971585831595`, `corrected: false`; `('DE', '+971 58 583 1595')` and `('DE', '00971585831595')` → `+971585831595`; a real German mobile `('DE', '0151 1234 5678')` → `+4915112345678`, **not** corrected (counter-assertion: a valid national number is never "corrected"); `('DE', '12345')` → `too-short`; `('DE', 'abc')` → `invalid`; `('', '123')` → not ok; an empty string → `empty`; a UAE landline (`+97144123456`) → `not-mobile`; `isValidMobileE164('+49971585831595')` is `false` and `isValidMobileE164('+971585831595')` is `true`.
- [X] T006 Add the problem type: in `packages/contracts/src/errors.ts` near `SMS_DESTINATION_NOT_ALLOWED` add `INVALID_MOBILE: { type: \`${BASE}/invalid-mobile\`, title: 'Invalid mobile number', status: 422 }`, and register de/en descriptions in `client/src/lib/problems.ts` (German "Diese Mobilnummer ist nicht gültig. Bitte prüfen Sie Land und Nummer." / English "This mobile number is not valid. Please check the country and the number."; `retry: RETRY.NEVER`), next to the existing `sms-destination-not-allowed` entry.

**Checkpoint**: one rule, tested, available to the server and both clients; the problem type exists.

## Phase 3: User Story 1 — the server answers 422, not 503 (P1) 🎯 MVP

**Goal**: a number that is not valid, or that the SMS provider refuses as a destination, is a 422 `invalid-mobile`; only a provider or network fault is still 503; no member is left behind.
**Independent test**: `POST /onboarding/register` with `+49971585831595` → 422 `invalid-mobile`; with a valid-looking number whose send the provider refuses as a destination → 422 `invalid-mobile`; with the provider down → still 503.

- [X] T007 [US1] Write the failing tests first in `server/tests/onboarding/mobile-validation.test.ts` (use `buildOnboardingApp`, `register`, `applicant` from `tests/onboarding/helpers.ts`; `smsControl.failure` makes the stub reject like the SDK): (a) `register` with `mobile: '+49971585831595'` → 422, `type` = `PROBLEMS.INVALID_MOBILE.type`, **no row** in `members` for that email and no SMS sent; (b) with a number that passes validation but `smsControl.failure = { statusCode: 400, data: { errors: { destination: 'Invalid destination' } } }` → 422 `invalid-mobile`, no member row, and the same applicant can then register again with a good number (the rollback works); (c) counter-assertion: `smsControl.failure = { statusCode: 503, data: 'provider down' }` and a plain `new Error('ECONNREFUSED')` → still 503 `service-unavailable` (an outage is an outage); (d) a valid UAE number (`+971585831595`) → 202 with a challenge and exactly one SMS; (e) the same refusal at `POST /onboarding/contact` (step-3 change) with a bad number, and at sign-in resend if it takes a mobile. Run it now: (a) and (b) must FAIL before T008–T009 (record that here).
- [X] T008 [US1] Server schema: in `packages/contracts/src/onboarding.ts` make `registerRequestSchema.shape.mobile` (l.~93) `.regex(E164, …).refine(isValidMobileE164, { message: 'must be a valid mobile number' })`; `changeContactRequestSchema` (l.~225) inherits it through `registerRequestSchema.shape.mobile.optional()`. Check how the server turns a Zod refine failure into a response (look at how `E164`'s regex failure is answered today in `tests/onboarding`) so (a) in T007 comes out as `INVALID_MOBILE` and not a generic validation 400: if the platform answers schema failures with a generic `validation` problem, map a failure on the `mobile` path to `INVALID_MOBILE` in the error handler or validate in the controller before the schema, whichever is the smaller change, and say which in a comment.
- [X] T009 [US1] Provider destination refusals: in `server/src/integrations/sms.ts` add `smsDestinationInvalid()` (`decorateError('The mobile number cannot receive an SMS.', { problem: PROBLEMS.INVALID_MOBILE, statusCode: 422, safeDetail: 'This mobile number is not valid. Please check the country and the number.' })`); in `server/src/decorators/send-otp.ts` catch block, **before** `throw smsUnavailable()`: when `failure.statusCode === 400` and `failure.data?.errors?.destination` is set, log `SMS_PROVIDER_ERROR` at `warn` (masked, as today) and `throw smsDestinationInvalid()`. Every other failure stays 503. Update the header comment of `send-otp.ts` ("Any provider error … 503") to say a refused destination is the one exception and why (retrying the same number can never work; an outage can).
- [X] T010 [US1] Fix the fixtures the new validation rejects: `grep -rn "mobile" server/tests packages/contracts/src --include=*.ts | grep "+"` and replace any made-up number that `checkMobile` / `isValidMobileE164` rejects with a real valid one for the same country (the helpers use `+971501234567` and `+49151…`; the country-policy tests need numbers that are **valid** and then refused by the policy: `+8501912345678` (DPRK), `+14165550100` (Canada) may be invalid numbers, in which case use a valid Canadian mobile `+14165551234`-style number that libphonenumber accepts, or move the policy assertion to `app.assertSmsDestination` directly). Do not loosen the rule to fit a fixture. Run `DATABASE_URL=… npx vitest run tests/onboarding tests/auth` until green.

**Checkpoint**: the server tells a mistyped number from an outage and never leaves a half-made account.

## Phase 4: User Story 2 — the web client validates and helps (P1)

**Goal**: the number is checked as it is typed and on submit; the reported input is corrected with a notice instead of failing at the server.
**Independent test**: in Register type `971585831595` with Germany picked: the field shows "read as +971 58 583 1595" and the form continues with that number; type `12345`: an error under the field and no request is sent.

- [X] T011 [P] [US2] Strings in `client/src/i18n/en.ts` and `de.ts` under `onboarding.errors` (keep `mobile`, add): `mobileTooShort`, `mobileTooLong`, `mobileInvalid`, `mobileNotMobile`, and under `onboarding` a `mobileCorrected: 'Read as {number}'` / `'Gelesen als {number}'`; run `npm run -w client test:i18n`.
- [X] T012 [US2] `client/src/components/ui/MobileField.tsx`: keep the picker and the one string the parent holds, but compute `checkMobile(country, national)` on every change; when `ok` call `onChange(result.e164)` (the E.164 the server validates) and, if `result.corrected`, show the `mobileCorrected` notice under the field with the number formatted for reading (`formatInternational` from `libphonenumber-js`, or `+971 58 583 1595` by hand); when not ok call `onChange(typed-as-before)` so the parent sees an invalid value and show the matching error after the field is left (`onBlur`) or after submit, never while the person is still typing the first digits. Expose `error` from the parent as before. A correction also updates the picker to the detected country (`splitE164(e164).country`), so the field and the picker agree.
- [X] T013 [US2] `client/src/onboarding/Register.tsx` (~l.77–85) and the contact-change form in `client/src/onboarding/VerifyMobile.tsx`: replace `fields.mobile.safeParse(normalisedMobile)` with the field's own check (so the form and the field cannot disagree), map each `reason` to its string, and map a server 422 `INVALID_MOBILE` (`ApiError.problem.type === PROBLEMS.INVALID_MOBILE.type`) to the **same field error** — a documented "shown as well as logged" exception like `email-in-use` (add it to the list of exceptions in the CLAUDE.md paragraph, T018). No request is sent while the number is invalid.
- [X] T014 [US2] Web tests `client/tests/onboarding/register-mobile.test.tsx` (see `tests/onboarding/` and `tests/registration-entry.test.tsx` for the render and fetch-mock setup): typing `971585831595` with Germany selected shows the correction notice and submits `+971585831595` (assert the request body); typing `12345` shows the too-short error after blur and the form does **not** call `/onboarding/register`; a valid German mobile shows no notice (counter-assertion); a server 422 `invalid-mobile` puts the error under the mobile field and nothing else; German and English. Run `npm run -w client test` and `npx tsc --noEmit`.

## Phase 5: User Story 3 — the Expo app does the same (P1)

**Goal**: identical behaviour in the app's register and verify-mobile screens.
**Independent test**: quickstart steps 3–4 on a device or simulator.

- [X] T015 [P] [US3] Strings in `expo-client/german-world-club/src/i18n/en.ts` and `de.ts` (`validation.mobile` exists; add `validation.mobileTooShort`, `mobileTooLong`, `mobileInvalid`, `mobileNotMobile` and `register.mobileCorrected`), same wording as T011; keep the two catalogues' keys identical (diff them by hand: the app has no i18n check).
- [X] T016 [US3] `expo-client/german-world-club/src/components/mobile-field.tsx`: the same behaviour as T012 (check on change, correction notice, error after blur or submit, picker follows the detected country), built from `checkMobile` in `@gwc/contracts/mobile`; no new native dependency (the library is pure JS).
- [X] T017 [US3] `expo-client/german-world-club/src/app/(public)/register.tsx` (~l.61–67) and the contact change in `(public)/verify-mobile.tsx`: replace the regex check with the field's, map the reasons to strings, map a server 422 `INVALID_MOBILE` to the field error, and send nothing while invalid. Run `npx tsc --noEmit` in `expo-client/german-world-club`.

## Phase 6: Polish

- [X] T018 [P] Docs: add to `CLAUDE.md` (the "Every SMS goes through one gateway" paragraph) that a mobile number is validated by `checkMobile` in `@gwc/contracts/mobile` on the server and both clients; that a provider refusal **of the destination** is 422 `invalid-mobile` while every other provider fault is 503; and add `invalid-mobile` to the list of refusals shown on screen. Note the dependency in `packages/contracts/package.json`'s description if it lists any.
- [X] T019 Final run: `DATABASE_URL=… npx vitest run --exclude 'tests/seed/**'` in `server/` (record any new failures versus the 9 known unrelated ones in `profiling/*` and `resilience/*`), `npx vitest run` in `packages/contracts`, `npm test` and `npx tsc --noEmit` in `client/`, `npx tsc --noEmit` in `expo-client/german-world-club`, `npm run -w client test:i18n`; then quickstart steps below. Remove the throwaway container (`docker rm -f gwc-031-test`). Do not commit unless asked.

## Quickstart (manual, after T019)

1. Web Register, Germany picked: type `971585831595` → notice "read as +971 58 583 1595"; continue → the code screen (in development with `SMS_DEV_LOG` the code is in the server terminal).
2. Web Register: `12345` → error under the number, no request in the network tab.
3. App Register: both cases above on a device or simulator.
4. Force the server path: temporarily bypass the client check (curl `POST /onboarding/register` with `mobile: "+49971585831595"` and an otherwise valid body to a **local** server): 422 `invalid-mobile`, not 503.
5. Counter-check: stop SMSGlobal access (wrong key in a local `.env`) and register with a valid number: still 503.

---

## Dependencies & Execution Order

T001 → T002 → T003 → T004 → T005; T006 is independent of T003–T005 ([P] with them). US1: T007 (failing) → T008 → T009 → T010; T008 needs T004. US2 needs T004 and T006: T011 ∥ T012 → T013 → T014. US3 needs T004 and T006 and can run in parallel with US2: T015 ∥ T016 → T017. T018, T019 last.

## Parallel examples

- After T003: T004 and T006 together.
- After T004: US1 (server), US2 (web) and US3 (app) are independent and can all start.

## Implementation strategy

**MVP = Phases 1–3 (US1)**: the 422 plus the shared rule. It already stops the 503 for the reported input, but the applicant still sees an error only after the server round-trip, so US2 and US3 are the same release in practice (the user asked for client validation on both faces). Ship US1, US2 and US3 together; do US1 first because it defines the rule and the problem type the clients map.
