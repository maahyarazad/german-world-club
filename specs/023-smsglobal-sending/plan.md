# Implementation Plan: SMSGlobal sends every verification SMS, and failures are never hidden

**Branch**: `023-smsglobal-sending` | **Date**: 2026-11-13 | **Spec**: [spec.md](./spec.md)

## Summary

Fix `server/src/integrations/sms.ts`:
- `sendCode` rethrows the SDK's rejection, so `decorators/send-otp.ts` logs `SMS_PROVIDER_ERROR`
  and answers 503, as it was written to;
- the payload's `origin` is the configured `SMSGLOBAL_ORIGIN`, defaulting to `B P` in `env.ts`,
  `.env.example` and the README.

No new route, table or dependency. The `smsglobal` SDK is already in `server/package.json`.

## Technical Context

**Language/Version**: TypeScript on Node 22 (server)

**Primary Dependencies**: `smsglobal` ^1.2.5 (already installed), Fastify 5

**Storage**: none

**Testing**: vitest. A unit test of `createSmsClient`, with the SDK's `sms.send` replaced, and
the existing `tests/auth/sms-gateway.test.ts`.

**Project Type**: web service

**Constraints**:
- It must never report a failed send as sent (second factor).
- Logs never hold the code or the full number.

**Scale/Scope**: 1 integration file, 1 config default, 2 docs, 1 test file.

## Constitution Check

| Principle | Assessment |
|---|---|
| I. One rule set | Pass. Codes stay server-side, and the gateway stays the one path. |
| II. Postures | n/a. No route changes. |
| III. Published state = real state | Pass. That's the fix itself: "sent" only when SMSGlobal accepted the message. |
| IV. Integrity in the database | n/a |
| V. Failure explicit and bounded | Pass. That's the fix itself: a provider failure becomes the explicit 503, never a silent success. |
| VI. Server shapes output | n/a |

## Project Structure

```text
server/src/integrations/sms.ts        # rethrow; origin from config
server/src/config/env.ts              # SMSGLOBAL_ORIGIN default 'B P'
server/.env.example, server/README.md # B P
server/tests/auth/sms-client.test.ts  # new
```

## Research (decisions)

- **R1, rethrow rather than return `{ delivered: false }`**: the gateway's `try/catch` already
  turns a rejection into the logged 503 (`send-otp.ts`). Returning a value would need every
  caller to check it, and the swallowed error is the defect.
- **R2, keep the SDK singleton keyed to the first credentials**: unchanged. The process has one
  account.
- **R3, the SDK's injection point for tests**: `createSmsClient` gets an optional `sdkFactory`
  parameter (default: the real `smsglobal`), so the unit test can pass a fake and needs no
  network. The scan in `sms-gateway.test.ts` still finds `from 'smsglobal'` only in `sms.ts`.

## Complexity Tracking

None.
