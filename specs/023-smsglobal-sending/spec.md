# Feature Specification: SMSGlobal sends every verification SMS, and failures are never hidden

**Feature Branch**: `023-smsglobal-sending`
**Created**: 2026-11-13
**Status**: Draft
**Input**: "INTEGRATE `const smsglobal = require("smsglobal")(process.env.SMSGLOBAL_KEY, process.env.SMSGLOBAL_SECRET)` for SMS AND OTP"

## Clarifications

### Session 2026-11-13

- Q: What does "SMSGlobal for OTP" mean? → A: The server keeps generating, hashing, limiting and
  verifying its own one-time codes. SMSGlobal delivers the SMS that carries them. Its own OTP
  API is not used.
- Q: Environment variable names? → A: Keep `SMSGLOBAL_API_KEY`, `SMSGLOBAL_API_SECRET` and
  `SMSGLOBAL_ORIGIN`, as they are in `server/.env`. The snippet's `SMSGLOBAL_KEY`/`_SECRET` are
  not added.
- Q: Sender? → A: `B P` (`SMSGLOBAL_ORIGIN='B P'`).

## Context

SMSGlobal is already the provider. `server/src/integrations/sms.ts` wraps the same
`require("smsglobal")(key, secret)` SDK, behind the one gateway `app.sendOtp`. Two defects make
it unreliable:

1. **A failed send is reported as sent.** `sendCode` catches the SDK's rejection, writes it to
   the console and returns normally. The member is told "code sent" when none was. The
   gateway's own failure handling, which logs SMSGlobal's answer and replies 503 "try again
   later", never runs.
2. **The sender setting is ignored.** `origin: "B P"` is written into the code, so
   `SMSGLOBAL_ORIGIN` has no effect, and the default (`GWC`) and `.env.example` disagree with
   what is actually sent.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A code that could not be sent is never reported as sent (Priority: P1)

A member signing in, approving a device or verifying their mobile asks for a code. If SMSGlobal
refuses or can't be reached, they're told right away to try again in a few minutes, instead of
waiting for an SMS that will never come.

**Independent Test**: with the SDK made to reject, request a code. The answer is 503 "try again
later", and the server log has one `SMS_PROVIDER_ERROR` line with SMSGlobal's status and
response and a masked number.

**Acceptance Scenarios**:

1. **Given** SMSGlobal rejects a send (bad sender, no credit, wrong credentials, network
   failure), **When** a code is requested on any route, **Then** the request fails with the
   existing "verification unavailable" 503, and no success is reported.
2. **Given** that failure, **When** the logs are read, **Then** there's one `SMS_PROVIDER_ERROR`
   line with SMSGlobal's status and response body, the route, and the number masked. It
   contains no code and no full number.
3. **Given** SMSGlobal accepts the send, **When** a code is requested, **Then** it succeeds as
   today (counter-assertion).

### User Story 2 - The sender is configuration, and it is "B P" (Priority: P1)

Every SMS shows the sender configured in `SMSGLOBAL_ORIGIN`, which is `B P`.

**Independent Test**: with `SMSGLOBAL_ORIGIN='B P'`, the payload passed to the SDK has
`origin: 'B P'`. With another value, that value is used.

**Acceptance Scenarios**:

1. **Given** `SMSGLOBAL_ORIGIN='B P'`, **When** a code is sent, **Then** SMSGlobal is asked to
   send from `B P`.
2. **Given** `SMSGLOBAL_ORIGIN` is unset, **When** a code is sent, **Then** the default `B P` is
   used. The default, `.env.example` and the README agree.
3. **Given** a different configured sender, **When** a code is sent, **Then** that sender is
   used, not a value written into the code.

### Edge Cases

- **Credentials missing**: unchanged. Sends are refused loudly (503), and the server still
  boots.
- **The country policy** still runs first, so a refused number never reaches SMSGlobal.
- **Verification is unchanged**: codes are checked by the server, and a code sent earlier still
  redeems.
- **Dev without credentials**: as today, there's no SMS. Sign-in with a second factor needs
  SMSGlobal configured or the existing development path.

## Requirements *(mandatory)*

- **FR-001**: Any SMSGlobal rejection or transport failure MUST reach the gateway as a failure,
  and be answered with the existing 503 "verification unavailable". It MUST NOT be reported as
  sent.
- **FR-002**: The failure MUST be logged once, with SMSGlobal's status and response, the route
  and the masked number. Never the code, and never the full number.
- **FR-003**: The SMS sender MUST be `SMSGLOBAL_ORIGIN`, defaulting to `B P`. No sender may be
  written into the code.
- **FR-004**: The variable names stay `SMSGLOBAL_API_KEY`, `SMSGLOBAL_API_SECRET` and
  `SMSGLOBAL_ORIGIN`.
- **FR-005**: Code generation, storage, purposes, attempt limits, expiry and verification are
  unchanged. SMSGlobal's own OTP API is not used.
- **FR-006**: `app.sendOtp` stays the only caller of the provider, and `integrations/sms.ts` the
  only importer of the SDK (`tests/auth/sms-gateway.test.ts`).

## Success Criteria *(mandatory)*

- **SC-001**: 0 requests report "code sent" when SMSGlobal did not accept the message.
- **SC-002**: 100% of SMS go out from the configured sender.
- **SC-003**: Every failed send leaves exactly one diagnosable log line, with no code and no
  full number in it.

## Assumptions

- `B P` is a sender ID registered on the SMSGlobal account. SMSGlobal refuses unregistered ones
  ("Origin is invalid"), and with this fix that refusal now shows up as a 503 and a log line
  instead of silence.
