# Quickstart: validating member posting without job offers

Contracts: [contracts/http-and-ui.md](./contracts/http-and-ui.md). Trigger and seed:
[data-model.md](./data-model.md).

## Setup

```bash
npm run -w server migrate          # applies 042_member_marketplace_posting.sql
npm run -w server seed:demo
npm run -w server dev
npm run -w client dev
```

## Automated

```bash
DATABASE_URL=postgres://…/gwc_test npm run -w server test -- marketplace authz
npm run -w packages/contracts test
npm run -w client test && npm run -w client test:i18n
npx tsc --noEmit -p client && npx tsc --noEmit -p expo-client/german-world-club
```

## By hand

1. **Anyone can post.** Sign in as a demo member who never had `marketplace_post`. Marketplace
   shows **New listing**. Post a general offer. It appears for a second member.
2. **Terms still apply.** As a member who hasn't accepted the current terms, New listing asks
   for them first.
3. **No job offer in the form.** In the compose drawer, pick Job. Only Request is offered, and
   the note explains why. With Offer selected first, switching to Job moves the mode to Request.
4. **Job request works.** Publish a job request. It's listed under Job, Request.
5. **Refused directly.** `POST /marketplace/listings` with `category: job, mode: offer` →
   `422 …/marketplace/mode-not-allowed`, and no new row. Editing a general offer into Job →
   the same 422, and the listing is unchanged.
6. **Legacy job offers wind down.** For an existing job offer (from an earlier seed run, or a
   test fixture), its owner can mark it filled or withdraw it, and moderation can hide and
   restore it.
7. **Not members.** A merchant or partner login still can't post a member listing.
8. **App.** Repeat 1, 3 and 4 in the app.
9. **`/auth/me`** no longer lists `marketplace_post`.

## Web dialogs (Story 5, web only)

10. **Centered.** Open Send request on a listing at 1440 px and at 375 px. It's centered both
    ways. Repeat for the Threads compose dialog and the handle dialog.
11. **Animated.** Open and close it: it fades and scales in and out, and the backdrop fades.
    With macOS "Reduce motion" on, it appears with no animation.
12. **Unchanged.** Escape and Cancel close it. Reopening shows an empty message. New listing
    still slides in from the right. The app is unchanged.

## Profile picture progress (Story 6, web only)

13. **Progress.** Edit profile, with DevTools network set to "Slow 4G". Choose an image of about
    5 MB. The bar and percentage rise to 100%, then "Processing…", then "Saved." and the new
    picture.
14. **Refusal.** Choose a file the server refuses (for example, rename a `.txt` to `.jpg`). The
    bar disappears, the console shows the problem, and Change is usable again.

## Walkthrough record (2026-11-13)

Not walked by hand yet (T034, T040 and T045 open). What the automated suites prove, per step:

| Step | Covered by |
|---|---|
| 1 A member with no flags posts | `server/tests/marketplace/posting.test.ts`, `audience.test.ts`, `authz/matrix.test.ts`; web `client/tests/member/marketplace.test.tsx` |
| 2 Terms still apply | `posting.test.ts` (terms cases unchanged) |
| 3 No job offer in the form; Offer → Request | `client/tests/member/marketplace-compose.test.tsx` ("the mode follows the category") |
| 4 A job request works | `server/tests/marketplace/job-offer.test.ts`, `posting.test.ts` |
| 5 Refused directly, and by an edit into Job | `job-offer.test.ts` (API and trigger), `parity.test.ts` (both faces) |
| 6 Legacy job offers wind down | `job-offer.test.ts` ("job offers that predate the rule") |
| 7 Not members | `audience.test.ts` (staff, unauthenticated); the matrix (merchant and partner audiences) |
| 8 App | `tsc` and lint only. Needs a device. |
| 9 `/auth/me` | The migration strips the key, and `/auth/me` reports only `true` keys |
| 13–14 Profile picture progress | `client/tests/lib/upload.test.ts` (progress, processing, CSRF retry once, refusal as ApiError, abort, network failure), `client/tests/member/edit-profile-upload.test.tsx` (bar, percentage, processing, Saved, refusal). A real slow upload needs a browser. |
| 10–12 Web dialogs | `client/tests/components/modal.test.tsx` (classes, deferred unmount, reset, Escape). The variants were checked in the built CSS (T032). Actual centering and motion need a browser. |

Still needs a person: the dialogs in a real browser (desktop, 375 px, Reduce motion), and the app
on a device.
