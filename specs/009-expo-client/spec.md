# Feature Specification: Expo Mobile App, Onboarding Phase 1, Profile, Threads, Events

**Feature Branch**: `009-expo-client`

**Created**: 2026-09-23

**Status**: Implemented (first cut)

**Input**: User description: "start to build the skeleton of expo mobile application and follow the business process to implement the onboarding process — from the Core Server Functions and Identities add the first three ones in the phase one — must use the latest expo sdk and latest react-native version — start implementing in different branch 009-expo-client"

## Context

`german-world-club-business-description.md` defines:

- **Onboarding Phase 1** — register (full name, mobile, birthday, gender) → primary country of residence → verify mobile → verify email → "waiting for approval" → staff approve or deny, with an email either way and a reason on denial.
- **Core server functions, Phase 1** — Profile (Member, Partner, Merchant, Influencer), Threads, Events. (Influencer Affiliate is the fourth Phase 1 item and is *not* in this feature.)

## Clarifications

### Session 2026-09-23

- Q: How far should 009 go — the app only, or server too? → A: **All four full-stack**: onboarding, Profile, Threads and Events, each with server endpoints and app screens.
- Q: BUSINESS_DESCRIPTION.md §3.1 says joining is invite-only; the new onboarding flow lets any app user register and then wait for approval. Which wins? → A: **Staff approval replaces the invitation** for mobile onboarding. Registration is open; approval is the gate.

## Decisions

| Decision | Why |
|---|---|
| Expo SDK 57.0.24 (npm `latest`), React Native 0.86.3 | SDK 57 is the newest stable SDK (58 is `next`/preview). npm has RN 0.87.1, but SDK 57 pins RN 0.86.x, and running RN ahead of the SDK breaks its native modules. "Latest" therefore means the newest RN that the latest SDK supports. |
| Approval lives in `membership_applications`, one row per applicant | A missing row means "never applied" (invited, legacy), which gates nothing. A nullable column would make "never applied" and "forgot to set it" the same value. |
| The auth gate refuses any member whose application is not `approved`, **on every face** | Device approval alone is mobile-only. Without this, an applicant with a confirmed email could sign in on the web, which has no device, and bypass review. |
| `config.auth.onboarding: true` lets an unapproved applicant reach `/onboarding/*` only | Those routes exist to *finish* the steps the gates check. 11-rbac refuses the flag on anything but a member route. |
| Mobile verification issues a real, device-bound session | The app can resume onboarding after a restart without a password. The gates keep that session inside `/onboarding/*` until approval. |
| Registration sends the SMS **inside** its transaction | This is the reverse of messaging's persist-then-notify rule, on purpose: an application whose code never arrived is worthless, and committing it would lock the address out of registering again. |
| Registration for an address that is already in use returns the same response shape, sends no SMS, and mails the owner | The response itself is not a membership oracle. This is **not** full non-enumeration (no SMS arrives), and the code says so. |
| Email codes are 6 digits and live 30 minutes; SMS codes stay at 4 digits and 5 minutes | The applicant holds a session, so the attempt ceiling is the only barrier between them and a verified address belonging to someone else. Mail is queued, not sent inline. |
| Mail goes through a real outbox (`mail_outbox`, `mail.deliver` job) | `integrations/mail.ts` always described "enqueue for later", but nothing enqueued anything, and `sendResetMail` was optional-chained against nothing. Password-reset mail now goes through the outbox too. |
| Member events live under `/member/events`, not `/events` | `/events` is the public, *indexed* event-page surface. |
| Event cancellation is a timestamp, and re-registration reuses the row | Keeps `UNIQUE (event_id, member_id)` true. Capacity is still enforced only by the trigger, which now ignores cancelled rows and raises a named constraint. |
| The mobile face offers `door` / `invoice` only | `online` needs the hosted payment page and callback, which the app does not have. |
| Thread counts are computed, not stored | A stored counter is one more thing moderation has to fix. |
| Posts are never edited, by anyone; `removed` and `deleted` are final (trigger) | §8: staff moderate, they do not rewrite. |
| `/auth/otp/resend` now returns the new `challengeId` | This was a pre-existing bug: a resend mints a new challenge, but the client never learned its id, so every resent code was refused. |

## Onboarding on the web (second session)

**Input**: "implement the same onboarding process … for the web-application, what it does is exactly same as the mobile application".

The same five steps in the web console, at `/konsole/registrieren` (steps 1–2), `/konsole/registrieren/mobil` (3) and `/konsole/bewerbung` (4–5). The server endpoints are shared with the app. What differs is only what a browser does not have:

| Decision | Why |
|---|---|
| The web sends no `deviceId`; `membership_applications.device_id` is NULL for a web application (025) | Web sessions are never device-bound on this platform. Approving a web application approves the member, and no `device_approvals` row is written. A phone they later use still needs its own approval. |
| verify-mobile answers the web with **httpOnly cookies** and no tokens in the body | Exactly what sign-in does per face. A token a page script can read is one an injected script can read too. |
| Web challenges are bound to `WEB_DEVICE` (`'web'`) | `otp_challenges.device_id` stays NOT NULL, so every mobile challenge still names its phone. |
| A web applicant resumes on the web **by password**; a mobile applicant only on their phone, by SMS | Each face resumes the way that face signs in. Either way the session reaches `/onboarding/*` only. |
| `/auth/sign-out` declares `onboarding: true` | An applicant must be able to sign out. Otherwise the approval gate refused the sign-out itself. |
| The console gains a capability state `applicant` | Before, an applicant's `/auth/me` refusal rendered "permissions could not be loaded". |
| `tests/no-registration.test.tsx` is replaced by `tests/registration-entry.test.tsx` | The old suite enforced 003's "no registration in the console". This feature reverses that on purpose. The new suite keeps the reset-flow guarantees and pins one registration endpoint with one caller. |
| The country list moved to `@gwc/contracts/countries` | Both clients offer it for the same field. |

## Out of scope — and why

- **Influencer identity / affiliate link**: the 4th Phase 1 item. No column is added for it, because nothing could set one yet ("no columns nothing writes").
- **Thread @mentions and media**: need a member handle and an attachment table respectively.
- **Privacy settings (§7)**: until they exist, other members never see email, mobile or birthday.
- **Name-change requests (§3.2)**, **Phase 2 profiling**, **online event payment**, **membership-card discounts**: `amountFor` takes the discount as a parameter; `resolveEntitlement()` still returns `null`.
- **Demo seed rows for the new tables**: listed in `seed/tables.ts` but not yet written by `seed:demo`.
- **Console (web) screens for application review and thread moderation**: the staff API exists (`/admin/onboarding/*`, `/admin/threads/*`), but the web UI does not.
