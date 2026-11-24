# Quickstart: validating merchant stores, offers and reports

Prerequisites: a development database (never the production one, per `CLAUDE.md`), `npm install`, and `NODE_ENV=development`.

```bash
npm run -w server migrate
npm run -w server seed:demo        # demo merchants, stores, offers and redemptions
npm run -w server test             # SQL suites need DATABASE_URL
npm run -w client test && npm run -w client test:i18n
npx tsc --noEmit                   # in each workspace; contracts divergence shows up here
npm run -w server verify:seo       # landing pages with the carousel
```

Sign in with the credentials table that `seed:demo` prints. Contracts are in [contracts/api.md](./contracts/api.md); tables are in [data-model.md](./data-model.md).

## Scenarios

1. **Store and offer (US1).** As a merchant user, create the store, then a second store for the same organisation. *Expect* 409 `store-exists`. Create an offer without a category. *Expect* 422. Create one with a category, upload 10 images and videos, replace the set with 11. *Expect* 422, and no change. *Expect* thumbnails in the list payload and no original anywhere.
2. **Redeem (US2).** As an active member, open Merchant offers (web, then the app), filter by category, redeem. *Expect* a reference and a lower remaining count. Resend the same `requestId`. *Expect* the same redemption, count unchanged. Redeem again on a one-per-person offer. *Expect* `per-person-limit-reached`.
3. **Any account.** Redeem as staff, a partner user and a merchant user (another merchant's offer). *Expect* success. As that merchant, redeem their own organisation's offer. *Expect* `own-offer`. As a locked member. *Expect* refusal.
4. **Concurrency.** With one unit remaining, fire 100 simultaneous redemptions from distinct accounts. *Expect* exactly one 201 and 99 `offer-sold-out`.
5. **Reports (US3).** Make redemptions on two merchants. *Expect* each merchant's report to show only its own, the admin report to show both, and the admin total to equal the merchants' sum. A non-superadmin staff member without the grant. *Expect* 403.
6. **Deactivate (US4).** `PUT /admin/stores/:id/active` with `{ "active": false, "reason": "…" }`, then `0`. *Expect* the store and its offers gone from browse and the landing page on the next request, redemption refused, and the merchant still seeing their data with a notice. Reactivate. *Expect* everything back. Check the audit entry.
7. **Categories (US4).** As staff, add, rename, reorder and hide a category. *Expect* offers under a hidden category to remain visible and the merchant form to stop offering it.
8. **Progress (US5).** Throttle the network in the browser and upload a large video on the offer page and on the partner profile page. *Expect* a moving bar, then "processing", then the thumbnail. Do the same in the Expo app on a device. Kill the connection mid-upload. *Expect* a failure state and unchanged content.
9. **Landing (US6).** Fetch `/` and `/en` with scripts disabled. *Expect* the carousel with active partners and merchants, merchants unlinked, and no `Vary: Cookie`. Deactivate a store and re-fetch after the cache lifetime. *Expect* it gone. With no eligible organisations. *Expect* no section.

10. **Publish once (US1).** Publish a draft offer. *Expect* exactly one `push_notifications` row for it (`idempotency_key = 'offer:<id>'`). Withdraw it and publish again, and send two publish requests at once on another offer. *Expect* still one row each, and members with offer notifications get one push per device. Publish an offer whose start date is tomorrow. *Expect* the notification held until then.
11. **Store cover and gallery (US1).** Set a 1600x900 cover. *Expect* success. Try an 800x800 image or a portrait one. *Expect* 422 `cover-aspect-ratio` and the old cover kept. Add 10 gallery items, then an 11th. *Expect* a refusal and no change.
12. **Size caps (US1).** As a merchant, upload a 900 KB photo, then a 1.2 MB photo, a 4 MB video and a 6 MB video. *Expect* the first and third accepted, the second and fourth refused with the limit named, and nothing stored for the refused ones. Repeat the 1.2 MB photo as a member. *Expect* it accepted. Check on the web and in the app that the limit is shown before the upload starts.
13. **Free storage (US1).** Replace an offer's media, then delete a leftover file. *Expect* the stored-bytes counter to drop. Try to delete a file that an offer still uses. *Expect* 409 `media-in-use`.

## Automated checks this feature adds

Store uniqueness under concurrency; the media bound at the database (offer and store gallery); merchant size caps and the 16:9 cover rule; one notification per published offer; merchant deletion of unused media; the visibility predicate used by browse, detail, redeem, push and the carousel; redemption exactness and idempotency; own-offer refusal; scope isolation of reports (404-like for another organisation); report totals agreement; no-PII scan of report bodies; audit entries; the authz matrix for every new route; both landing shells keep the new marker pair; i18n catalogues agree in both directions; the loading-states scan for the new pages.

## Results (recorded at implementation, 2026-11-23)

Verified automatically, against a throwaway local PostgreSQL 16 (never the database `server/.env` points at):

- **Scenarios 1, 3, 4, 5, 6, 7, 10, 11, 12, 13** (store and offers, any account, concurrency, reports, deactivation, categories, publish-once, cover and gallery, size caps, freeing storage) by the suites listed under "Automated checks": `tests/stores`, `tests/offers`, `tests/offer-categories`, `tests/redemptions`, `tests/media/merchant-*.test.ts`, `tests/authz/matrix.test.ts`.
- **Scenario 2** (browse by category, redeem, retry, per-person limit) on the server and, for the web page, in `client/tests/member/offers.test.tsx`.
- **Scenario 8** (progress) for the web console in `client/tests/components/upload-progress.test.tsx` and `client/tests/organisation/partner-profile-upload.test.tsx`.
- **Scenario 9** (landing strip) in `server/tests/seo/landing-carousel.test.ts`, against the built shells.
- A real `seed:demo` run against the scratch database fills the new tables (11 stores, one switched off, covers, galleries, offer media, redemptions whose counts add up).

**Not verified, and why:**

- **Nothing was run in the Expo app on a device or emulator**, in either theme or on either platform: it typechecks and its new files lint clean, but the screens, the 16:9 crop in the picker, the size checks against real picker output, and upload progress on `XMLHttpRequest` in React Native were not exercised. Scenarios 8, 11 and 12 need that before this ships.
- **No browser was driven** by hand: the web pages are covered by component tests with a mocked network, not by a real upload against the server.
- **`verify:seo`** was run against the seeded scratch database. It reported two problems (`/` and `/en` missing from a sitemap that lists no URLs) that come from the content the sitemap is built from in that setup, not from this feature; it was not compared against a run without the feature.
- **Server suite**: 7 files fail, none from this feature. Three (`tests/resilience/*`) and four (`tests/seed/safety.test.ts`, which also runs a real seed against whatever `DATABASE_URL` is set) are failures in code this feature did not touch. `tests/admins`, `tests/admin-dashboard` also failed in the full run only because the safety suite had just seeded the shared database; they pass on a clean one.

