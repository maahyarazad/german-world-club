# Contract: The reset screens in the Expo app

**Feature**: 043-expo-password-reset | This is the behaviour the app must have. It restates no server rule; where a rule is the server's it says so. The structure follows the web (`client/src/auth/PasswordReset.tsx`): **ask**, then **choose a new password**.

## 1. Where it lives

| Piece | File | Notes |
|---|---|---|
| "Forgot password?" action | `app/(public)/sign-in.tsx` | a secondary `Button` under the sign-in button, `router.push('/forgot-password')` |
| Ask screen | `app/(public)/forgot-password.tsx` (new) | title `t.passwordReset.title` |
| Code + new password screen | `app/(public)/reset-password.tsx` (new) | receives `challengeId` (not a secret) and the identifier the person asked with (`email` or `mobile`, so it can ask again) as route params; the identifier is never logged |
| Registration | `app/(public)/_layout.tsx` | two `Stack.Screen` entries, titles from the catalogue, back button as the other public screens |
| API calls | `src/api/endpoints.ts`, on `authApi` | `requestPasswordResetCode`, `confirmPasswordResetCode`; `resendOtp` already exists; all `anonymous: true` |
| Strings | `src/i18n/de.ts` and `en.ts` | block `passwordReset`; German in the formal "Sie" like the rest of the app |

The existing sign-in notice `t.signIn.passwordResetRequired` ("you must reset your password") also offers the same action, so the person who is told to reset can do it.

Reused as they are: `TextField`, `CodeField` (length 6), `Button`, `AsyncButton`, `Message`, `Chip`, `MobileField`, `useSession().deviceId`. Both new screens are built on the shared `AuthScreen` layout ([public-screens-style.md](./public-screens-style.md)): the club's logo at the top, fields and messages as its children, **every button in its `actions` block** as the standard `Button` (the main action primary, any other secondary). That is what makes them look like the sign-in and welcome screens, and it is built before these screens so they are not built twice.

## 2. Ask screen

| Element | Behaviour |
|---|---|
| Choice | two chips, "E-Mail" and "Mobilnummer" (English: "Email", "Mobile number"); email is selected first. Switching keeps what was typed in each. |
| Email | `TextField`, `keyboardType="email-address"`, `autoCapitalize="none"`, `autoComplete="email"`; lower-cased and trimmed on send, as sign-in does |
| Mobile | `MobileField` (country picker + number; emits E.164; reads a number typed with its country code but no `+`; shows "Read as …") |
| Check before sending | empty email, or not an email, or a number `checkMobile` rejects: the field's own message (`t.passwordReset.emailInvalid` / `mobileErrorText`), **nothing is sent** |
| Hint under the field | `t.passwordReset.requestHint`: a code goes to the member's mobile number if an account matches; merchant, partner and staff accounts use the link on the website. It says nothing that depends on whether *this* identifier matched. |
| Submit | the primary `Button` in `actions`: "Code anfordern"; busy while sending |
| On `202` | `router.push({ pathname: '/reset-password', params: { challengeId, email | mobile } })`. The same for **every** identifier. |
| On `429 rate-limited` | `t.passwordReset.tooManyRequests`, shown and logged |
| On no connection | `t.signIn.networkError`-style offline message, shown and logged; may retry |
| Anything else | logged; the screen stays; no refusal is kept in state |

The answer screen never says "we sent a code to …" with a number, and never says "no account found".

## 3. Code and new password screen

| Element | Behaviour |
|---|---|
| Subtitle | `t.passwordReset.codeSubtitle`: "If an account matches, a six-digit code is on its way by text message. It is valid for five minutes." Unconditional wording, like the web's `requestDone`. |
| Code | `CodeField` length 6, `textContentType="oneTimeCode"`, `autoComplete="sms-otp"` for the OS to offer the code from the message |
| New password, repeat | two `TextField`s, `secureTextEntry`, `textContentType="newPassword"`, `autoComplete="new-password"`; the "at least 8 characters" hint |
| Check before sending | `< 8` characters: `t.passwordReset.tooShort`; the two differ: `t.passwordReset.mismatch`; code not six digits: save disabled. Nothing is sent, **no guess is spent**. |
| Save | the primary `Button` in `actions`: "Passwort speichern"; busy while sending |
| Ask again | `AsyncButton` with `variant="secondary"` in `actions`, under Save: "Neuen Code senden"; disabled with "in 45 s" for `cooldownSeconds` (60) after each ask. It **asks again at `/auth/password-reset/code` with the same identifier** (the `email` or `mobile` route param the ask screen passed along); there is no resend-by-challenge for this purpose (research R17). The new `challengeId` **replaces** the old one in state, and the code field is cleared. |
| Success (`200`) | `router.replace({ pathname: '/sign-in', params: { notice: 'password-reset' } })`; sign-in shows `t.passwordReset.done` ("Passwort geändert. Alle Sitzungen wurden beendet. Bitte melden Sie sich an.") as an info message. **Not signed in automatically.** |

State kept (it changes behaviour): `busy`, the current `challengeId`, and the cooldown seconds left. **Not** kept: any refusal as a state object.

### Refusals shown as well as logged (the person cannot proceed without knowing why)

| Answer | Shown (`Message`) | What the person can do |
|---|---|---|
| `401 invalid-otp` | `t.passwordReset.invalidCode` "Der Code ist ungültig oder abgelaufen." | retype, or ask again after the wait; passwords stay filled; the code field is cleared. **One message for every kind of bad code**: the server answers a wrong, expired, spent, exhausted and unknown code identically on purpose (research R17), and the app must not re-introduce the difference. |
| `429 rate-limited` | `t.passwordReset.tooManyRequests` | wait, then try |
| no connection | offline message | retry (nothing was spent) |

Every refusal is also logged `console.error('ResetPassword.submit', error instanceof ApiError ? error.problem : error)` (and `ForgotPassword.submit`, `ResetPassword.resend`). The body of the request is never logged; the client's request line prints only method, path, status and timing, and the path carries no identifier.

## 4. Strings (German, formal "Sie"; English alongside)

New keys, names indicative (the implementation picks final names; the app's `en` is typed against `de`, so a missing key is a compile error):

```text
passwordReset.{ forgotLink, title, requestHint, byEmail, byMobile, emailInvalid, submitRequest,
                codeTitle, codeSubtitle, codeLabel, newPassword, repeatPassword, passwordHint,
                tooShort, mismatch, submitConfirm, resend, resendIn,
                invalidCode, tooManyRequests, offline, done }
```

Reused from the existing catalogue where the wording matches: `t.signIn.email`, `t.signIn.networkError`, `t.common.continue`, and the web's `passwordReset.newPassword` / `repeatPassword` / `tooShort` / `mismatch` copy (re-stated in the app's catalogue, in the formal form).

## 5. What is deliberately not here

No countdown that survives leaving the screen, no "open the messages app" shortcut, no auto-fill of the code beyond the OS's own one-time-code suggestion, no automatic sign-in after a reset, no email fallback, and no change to the web client.
