# Quickstart: SMSGlobal sending

```bash
DATABASE_URL=postgres://…/gwc_test npm run -w server test -- auth/sms
```

By hand, with real credentials in `server/.env` (`SMSGLOBAL_API_KEY`, `SMSGLOBAL_API_SECRET`,
`SMSGLOBAL_ORIGIN='B P'`):

1. Sign in with an account that needs an SMS code. The SMS arrives from **B P**.
2. Set a wrong `SMSGLOBAL_API_SECRET`, restart, and request a code. The app shows "try again in a
   few minutes" (503), and the server log has `SMS_PROVIDER_ERROR` with SMSGlobal's status, a
   masked number and no code.
3. Put the secret back. Codes arrive again.

## Record (2026-11-13)

Automated:
- `tests/auth/sms-client.test.ts`: 9 tests with a fake SDK. They cover:
  - refusal and transport failure reject, and success resolves;
  - no console output;
  - the SDK is created once;
  - the sender comes from configuration, `B P` by default;
  - numbers are digits only.
- `tests/auth/sms-gateway.test.ts`: a provider refusal → 503 and one masked
  `SMS_PROVIDER_ERROR` line.
- Full server suite: only the 7 known failures on `main`.

Not yet walked with a real phone (T010).
