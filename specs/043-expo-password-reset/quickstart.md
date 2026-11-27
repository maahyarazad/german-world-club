# Quickstart: proving the SMS password reset end to end

**Feature**: 043-expo-password-reset | Contracts: [API](./contracts/password-reset-code-api.md), [app screens](./contracts/expo-reset-ui.md) | Data: [data-model.md](./data-model.md)

This is a validation guide: what to run and what you should see. Implementation belongs in `tasks.md`.

## 0. Prerequisites

- Node 22, PostgreSQL 17 through `DATABASE_URL` in `server/.env`. **That must not be the production database**: development sign-in and this reset **send real SMS** through the real provider, and the demo seed publishes passwords (CLAUDE.md).
- To avoid texting anyone, use the demo seed's fake numbers. In development the server also **prints the code in the terminal** (`SMS_DEV_LOG`, on by default when `NODE_ENV=development`), and a provider refusal of a fake number is printed rather than failing, so the code is always readable there.
- The Expo development client you already have. **No native module is added, so no new EAS build.**
- `npm install` once at the repository root.

## 1. Apply the one migration and check it

```bash
npm run -w server migrate        # applies 050_otp_password_reset_purpose.sql; the old delete-member.sql step may still refuse a database not named german_world_club, which is not new
```

Check the rule now allows the new purpose, and nothing else changed:

```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'otp_challenges_purpose_check';
-- the list now ends with 'password_reset'
```

## 2. Data to look at

```bash
npm run -w server seed:demo      # prints a credentials table with a working password for each persona
npm run -w server dev
npm run -w expo-client/german-world-club start
```

The demo population has a persona for every eligibility case. Use the printed table to find one of each:

| Persona | Mobile | Expect |
|---|---|---|
| active, verified mobile | verified | **gets a code** |
| unconfirmed email, unverified mobile | unverified | no code, same answer |
| active, no mobile | none | no code, same answer |
| locked, verified mobile | verified | no code, same answer |
| ended | none | no code, same answer |
| a merchant or partner email | none | no code, same answer |

## 3. The happy path (spec US1 and US2)

On a phone or simulator, signed out:

1. Sign-in screen, tap **Forgot password?**. The reset screen opens (no sign-in).
2. Choose **Email**, type the verified persona's email, tap **Code anfordern**. The screen moves on. In the server terminal: `SMS (development) code 123456 for ****…1234` (six digits).
3. Enter the code, a new password (8+), the same again, **Passwort speichern**. You land on sign-in with "Passwort geändert …".
4. Sign in with the **new** password: works. With the **old**: refused. A session the persona had on the web or another phone is **ended** on its next request.
5. Repeat steps 1 to 4 choosing **Mobile number** (country picker, number typed several ways).

## 4. Uniform answer (spec FR-004, SC-002)

For each persona in the table, and for an address and a number that exist nowhere, ask for a code and compare:

- the **screen** is identical in every case (same next step, same wording, no number shown);
- in the **terminal**, a code is printed only for the first persona;
- from a shell, the responses are byte-identical apart from the per-request id and the challenge id value:

```bash
for who in active-email nonexistent-email active-mobile nonexistent-mobile locked-email; do
  curl -si -X POST "$API/auth/password-reset/code" -H 'content-type: application/json' \
       -d "{\"email\":\"$EMAIL\",\"deviceId\":\"qs-device\"}" | sed '/^date:/d;/^x-request-id:/d'
done            # (build each body for the case; all answer 202 {"requested":true,"challengeId":"…","cooldownSeconds":60})
```

## 5. Mistakes and limits (spec US3)

| Do this | Expect |
|---|---|
| enter a wrong code | "Der Code ist ungültig oder abgelaufen."; password fields stay filled |
| enter a wrong code five times | the same message each time (deliberately: the server does not say "too many tries"); the real code no longer works either |
| leave the code screen open six minutes, then save | the same message |
| from a shell: ask for a real member and for a made-up email, resend each returned challenge id at `/auth/otp/resend`, and send six wrong codes to each at `/code/confirm` | every answer is identical between the two (status, headers, body); no `429` or `410` appears for the real one |
| enter a password of 7 characters | "mindestens 8 Zeichen", **nothing sent** (watch the server log: no request), and a real code is not yet spent |
| two different passwords | "stimmen nicht überein", nothing sent |
| look at **Neuen Code senden** within 60 s | disabled with a countdown |
| after 60 s, tap it | a new six-digit code (the app asked again with the same email or number); the previous one is refused |
| ask four times in an hour for one number (email, mobile, a mix) | the fourth is refused with "zu viele Anfragen", no text; the same for an identifier that matches nothing |
| airplane mode, then ask or save | an offline message; retry works after reconnecting |

## 6. A reset code opens nothing else (spec FR-011, SC-003)

From a shell, using the `challengeId` and code from a fresh ask (do **not** complete the reset), try the code at the other endpoints. Each must answer as a wrong code and open no session:

```bash
curl -si -X POST "$API/auth/verify-otp"              -H 'content-type: application/json' -d '{"challengeId":"…","code":"1234","deviceId":"qs-device"}'
curl -si -X POST "$API/onboarding/verify-mobile"     -H 'content-type: application/json' -d '{"challengeId":"…","code":"123456","deviceId":"qs-device"}'
# both: 401 invalid-otp, no accessToken in the body
```

(`/auth/verify-otp` also rejects a six-digit code on shape; the `onboarding` one is the meaningful check.) The reverse is covered by tests: a sign-in or mobile-verification code is refused by `/auth/password-reset/code/confirm`.

## 7. The web is unchanged

On `/konsole/passwort`, request a link with an email, open it, set a password: still works exactly as before.

## 8. Logs and privacy (spec FR-015, SC-006)

With the server running, ask and complete a reset. In the server log and the Metro console: **no** email, number, code or password (the code appears only on the development terminal line, which is the documented exception); the request lines show method, path, status.

## 9. Automated checks

```bash
npm run typecheck                      # a renamed field is a type error in every workspace
npm run lint
npm run -w @gwc/contracts test         # the new request schemas
npm run -w server test                 # SQL suites need a DB and skip loudly without one; use a scratch database, never dev or production
npm run -w server verify:seo           # nothing public changed
npm run -w client test -- tests/assets # the two look-and-feel guards (section 11)
```

Tests that must exist (the counter-assertion is the half that proves the test is not vacuous):

| Suite | Asserts | Counter-assertion |
|---|---|---|
| `auth/password-reset-code.test.ts` | an eligible member gets a six-digit code by email and by number; completing changes the password, clears the flag, reactivates an inactive member, ends every session, audits | the old password is refused; a second use of the code is refused |
| same | the answer is byte-identical for match, non-match, ineligible, refused country, provider failure | an eligible member **did** get a code; the others did not |
| same | one live code; five tries then dead; expiry; device binding; a short password spends no try | the real code works until the fifth wrong try |
| `auth/password-reset-purpose.test.ts` | a reset code is refused at `/auth/verify-otp`, `/onboarding/verify-mobile`, `/onboarding/email/verify` and opens no session | a sign-in, mobile and email code are each refused at `/code/confirm` |
| same | the resend of a reset challenge is six digits, supersedes the old code, and counts against the hourly limit | an ordinary sign-in resend is still four digits |
| `auth/password-reset-limits.test.ts` | the fourth ask in an hour is `429`, by email, by number and mixed | a non-matching identifier is limited identically |
| `authz/matrix.test.ts` | two new public rows | (existing posture gate) |
| `auth/password-reset-link.test.ts` and the existing `auth/console-sign-in.test.ts` | the emailed-link flow is unchanged by the refactor into the shared finish logic | (both must stay green) |
| `auth/password-reset-chain.test.ts` | the challenge id an ask returns, resent and tried six times, answers identically for a real member and for an identifier that matches nobody | the right code for a separate real ask does change the password |
| `client/tests/assets/expo-backdrop.test.ts` | both phone-sized backdrops exist, are no wider than 1242 px and no larger than 1.5 MB; `app-background.tsx` requires them and no original; each wash is a valid colour and the dark one is at least 0.45 | the guard names an original (`-01.png`) or an empty wash as a failure, so it is not vacuous |
| `client/tests/assets/expo-auth-screens.test.ts` | sign-in, forgot-password and reset-password use `AuthScreen`, no `FormScreen`, no `Pressable`/`TouchableOpacity`; `auth-screen.tsx` draws `gwc-logo.png` and its `actions` style has the welcome screen's four values | `index.tsx` (welcome) is **not** required to use `AuthScreen` |

The Expo app has no test runner; Sections 3 to 5 and 11 on a real iPhone and a real Android phone are its test (the two `client/tests/assets` files read the app's source and cannot see a screen).

## 10. Rolling back

- Code: revert the change; the emailed-link reset never depended on it.
- Look and feel (US4, US5): revert the app files. The two supplied originals stay in `assets/` either way, and nothing on the server or in the database depends on them.
- Database: re-add the four-value `otp_challenges_purpose_check` (valid once no `password_reset` row remains; they expire in five minutes). No data was changed by this feature apart from the ordinary effects of a completed reset.

## 11. Backdrop, logo and buttons (spec US4 and US5; contract `contracts/public-screens-style.md`)

On a real iPhone and a real Android phone, against any server (this section does not depend on the database). Work with the phone's appearance switch within reach: iOS Control Center, Android quick settings.

| # | Do | Expect |
|---|---|---|
| 11.1 | Phone in **light** mode, open the app on the welcome screen | the light backdrop: cream with gold lines, no grey haze over it |
| 11.2 | Same screen, switch the phone to **dark** and come back **without** closing the app | the dark backdrop at once: slate grey with yellow lines, darkened a little; no restart, no navigation (spec US4 scenario 3) |
| 11.3 | In each mode open a screen with a long list (Marketplace or Threads) and scroll hard | as smooth as before this change; no stutter, no blank frames |
| 11.4 | In each mode read the grey secondary text on sign-in (the field labels, any hint) and the Message boxes | legible everywhere; if any text is hard to read over a line of the art, note the screen and mode (research R13's caveat) |
| 11.5 | Sign-in, then "Forgot password?", then ask for a code, so all three screens are open in turn | the same logo, same size and same place on all three (flip between them: it must not move or resize); undistorted; no card behind it, in light **and** dark |
| 11.6 | Compare the buttons on those three with the welcome screen's | the same standard primary and secondary buttons: same height, corner, width and gap; the main action first and primary, any other secondary; no text link anywhere |
| 11.7 | Smallest phone you have (or the iPhone SE simulator), German, focus the password field | the logo, fields and buttons are all reachable by scrolling; nothing is hidden behind the keyboard; no label is cut off |
| 11.8 | VoiceOver (iOS) or TalkBack (Android) on sign-in, swipe to the logo | read once as "German World Club"; the card is not a second stop |
| 11.9 | Sign in with a wrong password; then with airplane mode on; then as a member with an approval pending | each notice and failure shows as before the restyle |
| 11.10 | Open the welcome screen and the sign-in **code** screen | unchanged apart from the new backdrop (spec FR-024) |
| 11.11 | Landscape on a tablet or a large phone | the content stays centred at its maximum width; the logo does not grow past its size |

If 11.4 shows a real legibility problem on the dark art, **raise the dark wash** (`BackdropScrim.dark`), never lower it; the contrast numbers are in research R13.

