---
description: "Tasks for feature 023: SMSGlobal sends every verification SMS, and failures are never hidden"
---

# Tasks: SMSGlobal sends every verification SMS, and failures are never hidden

**Input**: `specs/023-smsglobal-sending/` (spec, plan with R1–R3, quickstart)
**Branch**: `023-smsglobal-sending`, from `main`

**Tests**: included (CLAUDE.md: behaviour tests with counter-assertions).

## Format: `[ID] [P?] [Story] Description`

- US1: a failed send is never reported as sent (P1)
- US2: the sender is `SMSGLOBAL_ORIGIN`, default `B P` (P1)

---

## Phase 1: Setup

- [X] T001 Confirm the branch is `023-smsglobal-sending`. Run
  `DATABASE_URL=postgres://postgres:postgres@localhost:5432/gwc_test npm run -w server test -- auth onboarding`
  and record the baseline.

---

## Phase 2: Foundational

- [X] T002 In `server/src/integrations/sms.ts`, give `createSmsClient` an optional
  `sdkFactory` parameter, defaulting to the real `smsglobal` export (plan R3), and use it in
  place of the module-level `sdk()` helper. Keep one instance per client, created on first use
  so a server without credentials still boots. `import smsglobal from "smsglobal"` stays in this
  file only.

---

## Phase 3: User Story 1 - A failed send is never reported as sent (Priority: P1) 🎯 MVP

**Independent test**: a fake SDK whose `sms.send` rejects makes `sendCode` reject. Through the
gateway, a code request answers 503, with one `SMS_PROVIDER_ERROR` log line.

- [X] T003 [P] [US1] Create `server/tests/auth/sms-client.test.ts` (no database) covering:
  - **rejection**: `createSmsClient({ apiKey: 'k', apiSecret: 's', origin: 'B P', sdkFactory })`
    with a fake whose `sms.send` rejects
    `{ statusCode: 400, data: { errors: { origin: ['Origin is invalid.'] } } }` → `sendCode`
    rejects with that same object;
  - **network failure**: a fake that rejects with `new Error('ECONNRESET')` → rejects;
  - **success**: a fake that resolves `{ statusCode: 200, data: { messages: [] } }` → resolves
    `{ delivered: true, response: { messages: [] } }` (the counter-assertion);
  - **no console output**: `console.error` is not called (spy) in any case. Failures are the
    gateway's to log.
- [X] T004 [P] [US1] Extend `server/tests/auth/sms-gateway.test.ts` with a database-backed case.
  Build the onboarding app (`buildOnboardingApp` in `tests/onboarding/helpers.ts`) with an
  `integrations.sms` override whose `sendCode` rejects
  `{ statusCode: 402, data: 'no credit' }`, and register an applicant with an approved number.
  Assert:
  - the response is 503 with the `service-unavailable` problem type;
  - exactly one log line has `msg === 'SMS_PROVIDER_ERROR'`, with `providerStatus: 402`,
    `route: 'onboarding.register'` and a masked `destination`;
  - the serialised log lines contain neither the full number nor the code.

  If `buildOnboardingApp` can't take an override, add an optional `smsSend` parameter to it.
- [X] T005 [US1] In `server/src/integrations/sms.ts` `sendCode`, remove the
  `try { … } catch (error) { console.error(error) }` and let the SDK's rejection propagate.
  Update the doc comment: `decorators/send-otp.ts` logs SMSGlobal's answer and replies 503, and
  a swallowed error here reported a code as sent when none was (spec FR-001).

**Checkpoint**: T003 and T004 pass.

---

## Phase 4: User Story 2 - The sender is configuration, `B P` (Priority: P1)

- [X] T006 [P] [US2] In `server/tests/auth/sms-client.test.ts`, assert the fake SDK received
  `origin: 'B P'` when configured so, and `origin: 'Club'` when `origin: 'Club'` is passed.
  That second case is the counter-assertion against a hard-coded sender. Also assert
  `destination` is digits only (from `+49 151 …` and from `0049…`).
- [X] T007 [US2] In `server/src/integrations/sms.ts`, send
  `origin: origin ?? DEFAULT_ORIGIN` instead of `"B P"`, with
  `export const DEFAULT_ORIGIN = 'B P'`.
- [X] T008 [P] [US2] Set the sender default to `B P` everywhere it appears:
  - `server/src/config/env.ts`: `SMSGLOBAL_ORIGIN: z.string().default('B P')`;
  - `server/.env.example`: `SMSGLOBAL_ORIGIN='B P'`;
  - `server/README.md` line 82: mention that the sender must be registered on the SMSGlobal
    account, and that the default is `B P`.
  - Don't touch `server/.env`; you already have `'B P'` there.

---

## Phase 5: Polish

- [X] T009 Run `npm run -w server test -- auth onboarding` and compare with the T001 baseline,
  then run the full `npm run -w server test` on `gwc_test` (the 7 known failures on `main`
  excepted).
- [ ] T010 Walk through `specs/023-smsglobal-sending/quickstart.md` steps 1–3 with real
  credentials, and record the result there. This needs a person with the SMSGlobal account and
  a phone.

---

## Dependencies

T001 → T002 → (T003 ∥ T004 ∥ T006) → T005 → T007 ∥ T008 → T009 → T010.
US1 and US2 touch the same `sendCode` but different lines; do T005 before T007.

## Implementation strategy

Both stories are P1 and tiny: ship them together. The MVP is US1, because a hidden failure locks
members out with no explanation. US2 is what makes `B P` actually configurable.
