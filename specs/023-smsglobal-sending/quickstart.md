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
