# Research: Reset a forgotten password in the app, by SMS code

**Feature**: 043-expo-password-reset | **Date**: 2026-11-27

No `NEEDS CLARIFICATION` remains. Each entry is *Decision / Rationale / Alternatives*. Facts checked in the repository carry a file reference. R1 is the one that needs the requester's agreement.

---

## R1. The database: one widened rule, and why nothing smaller is safe

**The obstacle (checked).** `otp_challenges.purpose` carries a CHECK constraint, `otp_challenges_purpose_check`, allowing exactly `login`, `device_approval`, `mobile_verification`, `email_verification` (`server/migrations/008_otp_and_device_approvals.sql`, widened once before by `020_onboarding.sql` for the two onboarding purposes). `issueChallenge` inserts the purpose it is given, so a `password_reset` challenge is refused by the database today.

**Decision.** One tiny additive migration, `050_otp_password_reset_purpose.sql`, drops and re-adds that CHECK with a fifth value, `password_reset`, exactly as `020` did. It adds no table, column, index or row, touches no data, takes no meaningful lock on a small table, and rolls back by re-adding the four-value rule. This is the whole database change.

**Why not zero changes.** I looked for a way to reuse what exists and found each one unsafe. Every item below was checked in the code, not assumed.

| Option | Verdict | Why |
|---|---|---|
| Reuse purpose **`mobile_verification`** | Rejected | `POST /onboarding/verify-mobile` (public) calls `verifyChallenge(... purposes: ['mobile_verification'])` and then `startSession(...)` for the challenge's account, returning tokens (`modules/onboarding/application/verify.ts`). A reset code stored under that purpose would **sign the holder in without a password**, and would fire the referral and application side effects. |
| Reuse **`login`** or **`device_approval`** | Rejected | `POST /auth/verify-otp` redeems exactly these and opens a session. Same bypass. |
| Reuse **`email_verification`** | Rejected | Redeemed by onboarding email confirmation, which marks the email confirmed and starts the auto-approval timers. Wrong meaning, wrong side effects. |
| Store the code in **`password_reset_tokens`**, count tries in `counters` | Rejected | (1) Reset tokens and OTP digests are both plain `sha256(utf8 text)` (`tokens.ts: hashRefreshToken`, `otp.ts: hashCode`). A code row would be redeemable at the *token* endpoint by presenting the string `"<id>:<code>"` as a token, which **bypasses the five-try ceiling** (only a request rate limit would remain). Closing it needs a keyed hash (a new secret in configuration) or tighter token validation on a second endpoint. (2) The ceiling must be exact and database-enforced (Principle IV); `counters` is a windowed quota store whose rows are never cleaned up. (3) It is more new security machinery than one line of SQL. |
| A **stateless** code (HMAC of the account and a time window) | Rejected | No attempt ceiling and no single-use without new state; needs a new secret; novel cryptography for a credential-recovery path. |

**Rationale.** A widened CHECK is the smallest possible schema change, has direct precedent in this repository, and lets the reset reuse the code that already enforces the properties that matter: salted digest, expiry, an exact five-try ceiling, device binding, single use, and purpose isolation (a code for one purpose is refused, like a wrong code, at every other endpoint).

**If the requester refuses any migration.** The fallback is the `password_reset_tokens` design with a keyed hash and a counter, with the costs in the table above. I would not recommend it; it is stated so the choice is informed.

---

## R2. One step to finish, not a token handed to the app

**Decision.** Two server steps. `POST /auth/password-reset/code` (ask) and `POST /auth/password-reset/code/confirm` (code + device + new password in one request). There is no intermediate "reset token" for the app to hold. The password change itself is the existing logic, lifted out of `confirmPasswordReset` into a shared `finishPasswordReset` (update the password, clear `password_reset_required`, reactivate an inactive member, revoke every session, denylist them, audit), so the emailed-link flow and the code flow cannot drift.

**Rationale.** The web has two steps because the middle one, the token, travels by email. In the app the code *is* the token, and splitting "verify" from "set password" would force a short-lived secret into navigation state or a global. Submitting the code with the password keeps the secret in one request. The password is validated **before** the code is checked (the route's schema runs first), so a typo does not spend one of the five guesses.

**Alternatives rejected.** *Verify then confirm with a minted reset token*: a secret in route params, a second request, and one more row in `password_reset_tokens` per reset. *Reuse `POST /auth/password-reset/confirm` with the code as the token*: it is the collision in R1.

---

## R3. Six digits, one live code, resend keeps the length

**Decision.** `issueChallenge({ purpose: 'password_reset', digits: 6 })`, TTL `OTP_TTL_SECONDS` (300 s), `OTP_MAX_ATTEMPTS` (5), resend cooldown `OTP_RESEND_COOLDOWN_SECONDS` (60 s). Asking again consumes the member's earlier unspent reset challenge, so there is only ever one live code.

**Rationale.** A four-digit sign-in code is safe because the password stands in front of it. Here the code stands alone in front of an account, so it follows the email code's six digits (`contracts/onboarding.ts`). With one live code, five tries and three codes an hour, an attacker gets at most 15 guesses an hour against 10^6, so 15 in a million per number per hour. Without consuming the older code the tries would stack across outstanding challenges.

**A bug waiting in the existing resend.** `modules/auth/application/resend-otp.ts` re-issues with the old challenge's purpose but **not** its length, so a resent reset code would be four digits and the confirm step would reject it. Resend must carry the length by purpose (six for `password_reset`). The generic `POST /auth/otp/resend` and its client are otherwise reused as they are: they already mint a fresh challenge for the same account and device and return its id.

**Alternatives rejected.** *Four digits*: a thousand times easier to guess for a credential-recovery code. *Eight digits*: harder to type from an SMS for little gain at this attempt ceiling.

---

## R4. Who can receive a code

**Decision.** Members only. Eligibility is `members.mobile IS NOT NULL AND mobile_verified_at IS NOT NULL AND status IN ('active','inactive')`. The lookup is by `email = $1` or by `mobile = $1` (E.164, exact). Locked and ended members, unverified numbers, and every staff, merchant and partner account get no code and the same answer.

**Rationale.** Only `members` has a mobile column (`admin_users` and `organisation_users` have none; checked in migrations 006 and 013). `members.mobile` is unique (`031_members_mobile_unique.sql`), so a number names at most one member, which is what makes "search by phone" well-defined before anyone is authenticated. The email reset also reactivates an inactive member (§3.2), so inactive is eligible; a locked or ended member must not be texted (each text costs money and they cannot sign in anyway). Eligibility is **re-checked when the code is redeemed**: a member locked between asking and saving is refused like a wrong code.

**Alternative rejected.** *Also send the existing reset email to non-member accounts that match an email*: it is not "OTP to phone", it changes what the identical answer means, and it is a separate decision for the requester.

---

## R5. The answer is uniform, and the text is sent after the reply

**Decision.** Asking answers `202 { requested: true, challengeId, cooldownSeconds }` for every input. For a non-match or an ineligible member the `challengeId` is a random UUID of the same shape (as `resendOtp` already does for a missing challenge). The SMS for an eligible member is sent **after the response is decided**, not awaited; a refusal by the country policy, an invalid number, or a provider failure is logged (masked) and never changes the answer.

**Rationale.**
- *Status and body:* the club is invite-only, so "is this email, or this number, a member?" is the information worth protecting (`non-enumeration.test.ts` states the rule for sign-in). A different answer for a refused country, an unverified number or an outage would each be an oracle.
- *Timing:* an awaited SMS call takes hundreds of milliseconds and happens only for real members, which would be a timing oracle. The email flow avoids the same problem by queueing mail in an outbox (`sendResetMail`); SMS has no outbox and none may be added (no database change), so the send is detached. The precedent for "do the side effect after the answer, never awaited, never throwing" is the server-fault recorder (feature 012).
- *Honesty:* this trades the "failures are never hidden" stance of the SMS gateway (`sendOtp` raises on a provider failure) for non-enumeration on one route. The failure is not hidden from operators: `sendOtp` already logs `SMS_PROVIDER_ERROR` with the provider's answer, and the member can ask again after 60 seconds. The trade-off is stated here and in the spec (US3 scenario 7), and is the requester's to overrule.

**Checked, and not a risk.** A provider rejection is not swallowed on `main`: `integrations/sms.ts` `sendCode` re-throws it (feature 023's fix; its tests `sms-client.test.ts` and `sms-gateway.test.ts` are identical on the `023-smsglobal-sending` branch), and `sendOtp` logs `SMS_PROVIDER_ERROR` with the provider's answer, masked. So a text that was refused is visible to operators even though the member's screen stays uniform. (An earlier draft of this note said that fix was unmerged; it is in `main`.)

**Alternatives rejected.** *Throw 503 on a provider failure*: an existence oracle during an outage. *Await the send and pad the non-match path with a sleep*: fragile and wasteful. *An SMS outbox table*: a database change.

---


**Measured (2026-11-27, T046; a throwaway script, not committed).** 200 asks each of three kinds, interleaved so drift affects all alike, in-process through `app.inject` against a scratch database, after 20 warm-up asks; once with an instant SMS stub and once with one that takes 300 ms:

| Kind of identifier | median | p95 | (300 ms stub) median | p95 |
|---|---|---|---|---|
| a member who really gets a code | 1.83 ms | 3.28 ms | 1.69 ms | 3.49 ms |
| a member whose number is not verified | 0.47 ms | 0.88 ms | 0.41 ms | 0.68 ms |
| an identifier that matches nobody | 0.47 ms | 0.79 ms | 0.42 ms | 0.82 ms |

What it shows. **The send is genuinely detached:** a 300 ms provider changes nothing (1.69 against 1.83 ms), so the hundreds of milliseconds a text takes cannot be seen from outside. **The two non-sending cases are indistinguishable** (0.47 against 0.47 ms), so "exists but ineligible" does not leak either. **A real ask still costs about 1.3 ms more** (about four times a non-match, in-process): the row lock, the retirement of the old code and two inserts that a non-match never makes.

Why this is not shipped as a hole, and what would change it. Over a real network the jitter is tens of milliseconds, so a 1.3 ms signal needs many thousands of samples to see, and the per-identifier limit allows **three an hour**: it is keyed on the number for a member and on the identifier itself for a non-match, so rotating addresses does not buy more samples for one target (the per-address limit is a second ceiling, not the one that matters here). That is why the limit being identical for real and made-up identifiers (FR-005) is load-bearing for this property as well as the oracle one. **If this ever needs closing,** pad the non-match path with the same statements run in a transaction that is rolled back; it was not done because it would add database load per unauthenticated request to remove a signal the limit already makes unusable. Recorded so the decision is visible, not silent.

## R6. Rate limits: keyed on the phone, not the address

**Decision.** A new bucket `password-reset-sms`, dimension `phone`, 3 per hour, fail-closed, plus a per-IP bucket (about 20 per hour) so one address cannot spray many numbers. The request route runs in the `otp-send` route class (the SMS budget class `register`, `contact` and `resend` already use) and, like `POST /auth/otp/resend`, resolves the member in a `preHandler` **before** its limiter runs so the limiter can key on the resolved phone. For an identifier that matches nothing the key is the identifier itself, so an unknown identifier is refused after three tries exactly like a real one. The confirm step reuses `otp-verify` (dimension `challenge`, keyed on `body.challengeId`).

**Rationale.** `keyForBucket` keys `phone` on `body.mobile` and `account` on `body.email` (`plugins/07-rate-limit.ts`), which is why the request body keeps the field names `email` and `mobile`. A person asking by email never types the number, so the key has to be resolved from the database, which is the pattern `loadOtpResendContext` already uses. Keying on the address would let an attacker with many addresses text one victim's phone without limit. The limits and the response are uniform across existing and non-existing accounts (FR-005).

**Redaction.** `email` and `mobile` in a request body are already redacted by `REDACT_PATHS` (`req.body.email`, `req.body.mobile`, `*.mobile`), and `req.url` carries no identifier because both are in the body, not the query.

---

## R7. The identifier on the wire, and the phone input in the app

**Decision.** The request body is exactly one of `{ email }` or `{ mobile }` (plus `deviceId`), a Zod union that refuses both and neither. `mobile` is validated with the shared `isValidMobileE164` (`@gwc/contracts/mobile`), the rule registration uses; `email` with the existing email schema, lower-cased by the client as sign-in does. In the app the mobile case uses the existing `MobileField` (country picker plus number, emits E.164), so a person never has to know to type `+49`.

**Rationale.** One rule for what a mobile number is, shared by the form, the server and registration (feature 031's whole point). A free-text "email or phone" field would need to guess a country; an explicit Email / Mobile choice does not.

**Alternative rejected.** *One text field that accepts either*: the country is unknowable from a bare national number.

---

## R8. The code is bound to the device; the app already has one

**Decision.** `deviceId` is required in both steps and bound to the challenge (`otp_challenges.device_id` is NOT NULL on purpose). The app sends the id it already uses for sign-in (`useSession().deviceId`, stored securely). A browser would send none and be bound to `WEB_DEVICE`, which is how a future web client could use the same steps.

**Rationale.** A code asked for on one phone cannot be redeemed on another, answered like a wrong code (`verifyChallenge` already does this), so it cannot be probed across devices.

---

## R9. Audit

**Decision.** Use existing actions. Sending is not audited per message (the SMS gateway logs it, masked). A completed reset writes the existing `session_revoked` entry with `reason: 'password_reset'` (already allowlisted in `SAFE_DETAIL_KEYS`) and one `password_reset` entry whose detail is `{ reason: 'sms' }`. `audit_log.action` is free text, so no schema change; the code, password and number never enter `detail`.

---

## R10. The app

**Decision.** Two new screens under `app/(public)/`, `forgot-password.tsx` (ask) and `reset-password.tsx` (code and new password), registered in `(public)/_layout.tsx`. The sign-in screen gets a "Forgot password?" link, and its existing "password reset required" notice points to the same screen. They use `FormScreen`, `TextField`, `CodeField` (length 6), `AsyncButton`, `Button`, `Message` and `MobileField`. Strings go in `src/i18n/{de,en}.ts` in the formal "Sie".

**Rules from CLAUDE.md that bind it.** A catch logs `console.error('<Component>.<function>', error instanceof ApiError ? error.problem : error)` and keeps no refusal in state; state survives only where it changes behaviour (the busy flag, the resent challenge id, the cooldown). The refusals the person cannot proceed without understanding are shown as well as logged: wrong code, expired code, too many attempts, offline. The `console.log` of the request path already redacts nothing sensitive here (no identifier is in the URL). The app has **no test runner**, so its behaviour is covered by `typecheck`, `lint` and the quickstart's device scenarios.

---

## R11. Residual risks, and a recommendation

1. **SMS as the only factor for a reset means whoever holds the SIM can take the account.** This is inherent in what was asked. The mitigations are a six-digit code, one live code, five tries, three codes an hour, all sessions ended, and the phone being the same number the club already trusts for sign-in. **Recommended follow-up (not in this feature):** email the member "your password was changed" after a reset, through the existing mail outbox, so a takeover is noticed.
2. **A send failure the member cannot see** (R5). Mitigated by the operator log (`SMS_PROVIDER_ERROR`) and by the resend path; an operator who is told "the code never came" can find the refusal.
3. **A member whose number was never verified cannot use this** and gets no hint why. They use the web link. The copy on the ask screen says so in general terms without revealing anything about accounts.
4. **A member changes number** while a code is outstanding: the code is sent to the number on record when asked and redeemed against the member, so the new number does not inherit it, and the next ask goes to the new number.

---

## R12. The themed backdrop: two phone-sized copies, chosen by the device's scheme

**Decision.** From the two supplied images (`assets/main-bg-light-01.png`, `assets/main-bg-dark-01.png`, each 4875 x 10550, about 2.1 MB) make two 1170-px-wide copies, `assets/main-bg-light-phone.png` and `assets/main-bg-dark-phone.png`, with `sips --resampleWidth 1170` (the existing `main-bg-phone.png` is 1170 x 2532, the same 0.24 scale of the same size original). `components/app-background.tsx` requires **both** copies at module scope and draws the one for the current scheme, taken from `useColorScheme()` (the app's own re-export, `hooks/use-color-scheme`, which `useTheme()` also uses, so the backdrop and the colours can never disagree). The component re-renders when the scheme changes, so the switch is live (spec US4 scenario 3).

**Rationale.**
- The component's own comment records why it never uses the original: decoding a 4875 x 10550 bitmap costs hundreds of megabytes (about 205 MB of pixels at 4 bytes each) for no visible gain on a phone. The new originals are the same size, so the same rule applies.
- Metro bundles an asset only when it is `require`d, so the originals in `assets/` are not shipped; they stay in the repository as source art exactly as `main_bg.png` does. Both copies are `require`d, but `expo-image` decodes only the one it is asked to show.
- Both the app's `useTheme` and `userInterfaceStyle: "automatic"` (`app.config.js`) are driven by the device; there is no in-app switch (checked: `hooks/use-theme.ts`).

**Alternatives rejected.** *Use the 4875 px originals*: the memory cost above. *One image with a colour overlay*: the supplied art is deliberately different per theme (cream and gold; slate and yellow). *Resize at runtime*: wasted work on every launch for a fixed result.

**Guard.** A vitest file in the web client's `tests/assets/` (the precedent is `fallback-parity.test.ts`, which also reads files across workspaces) asserts both copies exist, are no wider than 1242 px and no larger than 1.5 MB, and that `app-background.tsx` requires them and **not** an original, so a later edit cannot quietly put a 2 MB, 4875 px image back.

---

## R13. The wash: measured, not guessed

**What was there.** `constants/theme.ts` `BackdropScrim` was `light: 'rgba(255, 255, 255, 0.72)'`, `dark: 'rgba(0, 0, 0, 0.5)'`, written for art that was "one mid-grey in both colour schemes". The requester has already changed `light` to `''` (an empty string), which is not a colour (React Native may ignore it or warn depending on the platform) and has no comment saying why.

**Measured** (contrast of the theme's text colours against the most common colour of each supplied image, downscaled to 390 px; text `#11181C` / secondary `#60646C` in light, `#ECEDEE` / `#A0A5AB` in dark; WCAG ratios):

| Mode | Art background | Wash | Body text | Secondary text |
|---|---|---|---|---|
| Light | `#FFF5E6` | none | **16.6:1** | **5.5:1** |
| Light | `#FFF5E6` | white 0.72 (the old one) | 17.5:1 | 5.8:1 (and it would bleach the gold lines to near nothing) |
| Dark | `#60646C` | none | 5.1:1 | **2.4:1, fails** |
| Dark | `#60646C` | black 0.20 | 6.9:1 | 3.3:1, fails |
| Dark | `#60646C` | black 0.35 | 8.7:1 | 4.1:1, fails |
| Dark | `#60646C` | black 0.50 (the current one) | 11.0:1 | **5.2:1** |

**Decision.** Light: no wash, written as `'transparent'` so it is a valid value that a reader can see is deliberate. Dark: keep `rgba(0, 0, 0, 0.5)`. The threshold for secondary text is a black wash of about 0.45; below it secondary text falls under 4.5:1. Rewrite the doc comment so it states the measurement and the rule "do not lower the dark wash below 0.45 without recolouring `textSecondary`".

**Rationale.** The wash was never about taste: it is what keeps secondary text legible on a mid-grey, and the new dark art is the same mid-grey. The light art is pale enough that text is already readable on it, which is why the requester's removal is right.

**Alternatives rejected.** *No wash in dark too*: secondary text at 2.4:1 is unreadable. *Recolour `textSecondary` for the dark theme instead*: it would change every screen's text, a larger change than asked for. *A gradient wash*: more machinery for no measured benefit.

**Caveat.** Text drawn exactly over one of the thin gold lines is lower still (for example 3.9:1 for secondary text in light). The lines are one pixel wide and sparse; this is the same trade-off every textured backdrop makes and is not worth a heavier wash.

**Guard.** The same vitest file asserts each `BackdropScrim` value is `'transparent'` or a valid `rgba(...)`/hex colour (never empty), and that the dark alpha is at least 0.45, with a comment pointing here.

---

## R14. The logo: the welcome screen's emblem, in the welcome screen's card

**Decision (the requester's, 2026-11-27).** The three screens draw `splash-icon.png`, the same transparent emblem the welcome screen draws, in a card with exactly the welcome screen's `logoCard` and `logo` styles (`backgroundColor: 'transparent'`, `borderRadius: 16`, `padding: Spacing.three`; `height: 220`, `aspectRatio: 844 / 578`). The requester edited `components/auth-screen.tsx` to this themselves.

**What it replaced, and why that was the wrong default.** The first design used `gwc-logo.png` on a small white card, because the request named `gwc-logo` and that file **has no alpha channel** (an opaque white background), so on the cream and slate backdrops it needed a card to look intended. `splash-icon.png` is the same emblem with a transparent background, so it needs no card, sits directly on the artwork, and is identical to the first screen of the app, which is what "the same look" asks for. The cost is the one the welcome screen already has: the emblem sits in a square 1024 px canvas, so with `resizeMode="contain"` and that aspect ratio it is letterboxed a little. Not changed, here or there.

**Accessibility.** One element: the image carries the club's name (`t.welcome.title`); the card is a plain `View`, which is not an accessibility element, so the logo is announced once.

**Guard.** `client/tests/assets/expo-auth-screens.test.ts` asserts `AuthScreen` draws the same file as the welcome screen and that its `logoCard` and `logo` styles equal the welcome screen's value for value, with a counter-assertion that a drifted size or card is noticed.

---

## R15. One layout, so "the exact same buttons" cannot drift

**What "the exact same buttons" can mean here.** The welcome screen's two buttons and the sign-in screen's button are already the same `Button` component. What is not the same is how they are *placed*: the welcome screen stacks them in an `actions` block (`gap: Spacing.three`, `width: '100%'`, `maxWidth: MaxContentWidth`, centred), while a form screen puts its button inline in the form's scroll content. And the two new screens would otherwise each make their own choices. The most plausible reading is the same component, the same variants, and the same placement.

**Decision.** One new component, `src/components/auth-screen.tsx`, exporting `AuthScreen({ title?, subtitle?, children, actions })`. It mirrors `FormScreen`'s structure (safe area, keyboard avoidance, scroll view with `keyboardShouldPersistTaps="handled"`, centred when there is room) and adds: the logo card at the top (R14), then the optional title and subtitle, then `children` (fields and messages), then `actions` in a block whose style has the **same values** as the welcome screen's `actions`. The three screens pass their buttons only as `actions`, only as `Button`/`AsyncButton`, primary for the main action and `variant="secondary"` for any other. It is built **before** the two new screens, so they use it from the start and are not built twice and restyled.

**Rationale.** A shared layout is how the repo already keeps screens consistent (`FormScreen`, "the one layout every form screen shares"); the new screens would otherwise be the exact kind of drift the requester is asking to remove. The welcome screen is not converted (it has a different structure: hero and bottom-pinned actions) and stays as it is.

**Guard.** A vitest file asserts the three screens import `AuthScreen` and not `FormScreen`, import no `Pressable` or `TouchableOpacity` of their own, and that `auth-screen.tsx` references `gwc-logo.png` and its `actions` style carries the same four values as the welcome screen's.

**Alternatives rejected.** *Restyle `FormScreen` for every form in the app*: it would change registration, profile and many screens nobody asked about. *Copy the welcome screen's styles into each of the three screens*: three copies to keep in step.

---

## R16. The requester's in-progress work (checked against the working tree on 2026-11-27, and again after implementing)

At the start of this feature the working tree held one modified file, `expo-client/german-world-club/src/constants/theme.ts` (`BackdropScrim.light` changed to `''`), and two untracked images, `assets/main-bg-dark-01.png` and `assets/main-bg-light-01.png`. The `''` edit is no longer on disk (the file was back at `HEAD`'s white veil when T038 began), so T038 set the value from the measurements (R13) rather than building on it: `light: 'transparent'`, `dark` unchanged. The images are the source art (R12). Later the requester edited `components/auth-screen.tsx` themselves to use the welcome screen's emblem (R14). Those are the requester's decisions, built on and never reverted.

**Correction.** An earlier note in this feature said `sign-in.tsx` also carried an uncommitted `variant='primary'` on its button. It did not: `git status` showed the file unmodified and it had no `variant` on disk (the edit was seen in the editor, not saved). Nothing was lost, because `primary` is `Button`'s default; the restyle writes it out (`variant="primary"`) so the intent is visible, and `expo-auth-screens.test.ts` guards the variants.
