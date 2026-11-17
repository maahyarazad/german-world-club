# Quickstart: validating device sessions

Prerequisites: local Postgres with `gwc_dev` and `gwc_test`; `npm run -w server migrate`; `npm run -w server seed:demo`
(development only; never against production). Demo member: `demo.active@demo.invalid`, password in the seed's credentials table.

1. **Both faces at once**: sign in on the web (cookie jar A), then `POST /auth/sign-in` with `deviceId=phone-1` and verify the SMS code (dev logs it). Call an authenticated route with both: both 200. (US1, SC-001/002)
2. **Known phone**: sign out of phone-1, sign in again with the password only: `authenticated`, no SMS. (US1 1a)
3. **New phone**: `deviceId=phone-2`: `otp_required`. (FR-004)
4. **List**: `GET /member/devices` on either face: web + phone-1 + phone-2, `current` marked, no IP/UA/token fields. (US2)
5. **End**: `DELETE /member/devices/{phone-2 id}` from the web: phone-2's next request is 401/refused; its next sign-in needs the SMS again. (US3, SC-004)
6. **Isolation**: as another member, `DELETE` the same id: 404 identical to a random uuid. (SC-006)
7. **Idle expiry**: set a session's `last_seen_at` 31 days back in `gwc_test`, run `sessions.expire`: it is revoked `expired`, the phone stays known. (SC-007)
8. **Regression**: applicant and locked/ended members are refused exactly as before; staff sign-in still replaces its previous session. (SC-005)
9. `npm run -w server test`, `tsc --noEmit` in contracts, client, expo; `npm run -w client test:i18n`.
