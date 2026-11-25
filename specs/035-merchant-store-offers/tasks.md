---

description: "Task list for 035: merchant stores, categorised offers, redemption for any account, reports, upload progress and the landing carousel"
---

# Tasks: Merchant Stores, Categorised Offers and Redemption Reports

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md) (R1-R14), [data-model.md](./data-model.md), [contracts/api.md](./contracts/api.md), [quickstart.md](./quickstart.md)

**Tests**: Included. The spec does not ask for TDD, but the constitution's workflow section requires every principle a change touches to have an automated check, and `CLAUDE.md` requires behaviour tests with a counter-assertion. Test tasks come first inside each story and must fail before the implementation task that satisfies them. SQL suites skip without `DATABASE_URL`; run them against a development database only.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: `US1`..`US6`, matching the user stories in spec.md
- Paths are relative to the repository root. Server code is TypeScript under `server/src`, tests under `server/tests`, web under `client/src` and `client/tests`, the app under `expo-client/german-world-club/src`.
- Run npm commands from the repository root (`npm run -w server …`, `npm run -w client …`, `npm run -w german-world-club …`).

**Task IDs T089-T098** were added after `/speckit-analyze`, when the owner decided direct publishing with one notification, the store cover and gallery, and the merchant file-size caps (research R7, R15, R16). They keep their IDs so existing references stay valid; they sit in the phase where they run, and the dependencies section says what each waits for.

## Conventions every task must respect (from CLAUDE.md)

- Queries in `application/` **name their columns**; never `SELECT *` on a path that reaches a response.
- Every route declares `config.auth` (one audience per route) and a `budget`/`rateLimit` bucket. Making anything public is an affirmative act.
- Ownership refusals are **404**, identical to "unknown id" in status, body and headers.
- The server emits **no localised text**; clients translate on problem `type`. Both catalogues (web `client/src/i18n/{de,en}.ts`, app `src/i18n/{de,en}.ts`) change in the same task.
- Clients log failures with `console.error('<Component>.<function>', error instanceof ApiError ? error.problem : error)` and keep no error state. Pages that wait for data show `PageLoader`/`ScreenLoader`, never nothing and never a false empty message.
- Comments explain **why**, especially where the obvious implementation is wrong.

---

## Phase 1: Setup

- [X] T001 Record the baseline so regressions are attributable: run `npm test`, `npm run -w client test:i18n` and `npx tsc --noEmit` in `server`, `client`, `packages/contracts` and `expo-client/german-world-club`; write pass/fail and known warnings under a new "R15 Baseline" heading in `specs/035-merchant-store-offers/research.md`.
- [X] T002 [P] Read `server/src/modules/seo/surfaces.ts` and confirm every new path prefix (`/admin/stores`, `/admin/offer-categories`, `/admin/club-offers`, `/admin/reports`, `/merchant/store`, `/merchant/offers`, `/merchant/club-offers`, `/merchant/categories`, `/merchant/reports`, `/partner/club-offers`) falls under an existing gated, never-indexed row; add a row only for a prefix that does not, with a `why`. Note the finding in research.md R12.
- [X] T003 [P] Read the budget and rate-limit bucket declarations (`server/src/plugins/`, search `app.bucket(` and `budget:`) and write the chosen `budget`/`rateLimit` pair for each new route class (browse, redeem, merchant write, media status, report, admin write) in research.md R12, so no task invents a bucket name. The boot gate "Σ outbound budgets < deadline" must still hold.

---

## Phase 2: Foundational (blocks every user story)

**Purpose**: schema, shared contracts, the visibility rule, permissions and the fixtures every story uses.

**⚠️ CRITICAL**: No user story starts until T004-T016 and T089 are done and `npm run -w server migrate` plus `tsc --noEmit` are clean.

- [X] T004 Create `server/migrations/045_offer_benefit_kinds.sql`: `ALTER TYPE benefit_kind ADD VALUE IF NOT EXISTS 'freebie'` and `'bogo'`, idempotent, in a file of its own with a comment saying why (a new enum value cannot be used in the transaction that adds it; data-model.md 045).
- [X] T005 Create `server/migrations/046_merchant_stores.sql` per data-model.md 046: `stores` (UNIQUE `organisation_id`, composite FK onto `organisations (id, kind)` with `kind = 'merchant'`, `cover_asset_id`, `active` + deactivation columns with the CHECK, refuse-DELETE trigger), `store_media` (`PRIMARY KEY (store_id, position)`, `CHECK (position BETWEEN 0 AND 9)`, `asset_id` `ON DELETE RESTRICT`; the cover is not part of it), `offer_categories` (+ the eight starter rows with `name_de`/`name_en`, refuse-DELETE-while-referenced trigger), `offer_media` (`PRIMARY KEY (offer_id, position)`, `CHECK (position BETWEEN 0 AND 9)`, `asset_id` `ON DELETE RESTRICT`), and the `offers` changes (`store_id`, `category_id` backfilled to `other`, `per_person_limit` default 1, `sort_position`, the freebie/bogo value check, a trigger proving `store_id` belongs to the offer's organisation). Backfill a store for every organisation that already has offers. Idempotent like 015.
- [X] T006 Create `server/migrations/047_redemptions_any_account.sql` per data-model.md 047: replace `member_id` with `redeemer_kind account_kind` + `redeemer_id` (backfill `member`), add `request_id` (backfill `gen_random_uuid()`), `organisation_id` and `category_id` (backfilled from the offer), the `UNIQUE (redeemer_kind, redeemer_id, request_id)`, the four indexes, an insert trigger that proves the redeemer exists in the table for its kind and is active, and the UPDATE/DELETE-refusing trigger (same shape as `040_referrals.sql`). Drop the old `member_id` index and FK last.
- [X] T007 [P] In `packages/contracts/src/permissions.ts` add the `merchant_offers` module to `MODULES` with a comment on which flags are used (`read` stores/categories/report, `write` add category, `edit` rename/reorder/hide, `status` deactivate a store; `delete` unused on purpose). Update the pinned lists in `server/tests/authz/matrix.test.ts` and the permission-editor labels in `client/src/i18n/de.ts` and `client/src/i18n/en.ts` (the editor itself renders from `MODULES`).
- [X] T008 [P] In `packages/contracts/src/errors.ts` add the problem types from contracts/api.md: `STORE_EXISTS` 409, `STORE_NOT_FOUND` 404, `STORE_INACTIVE` 409, `OFFER_CATEGORY_REQUIRED` 422, `OFFER_MEDIA_LIMIT` 422, `OFFER_SOLD_OUT` 409, `PER_PERSON_LIMIT_REACHED` 409, `OWN_OFFER` 422, `ACCOUNT_NOT_ACTIVE` 403. `offer-not-available` reuses `NOT_FOUND` semantics (indistinguishable from unknown).
- [X] T009 [P] In `packages/contracts/src/offers.ts` extend `BENEFIT_KINDS` with `freebie` and `bogo`; add `MAX_OFFER_MEDIA = 10`, `offerCategorySchema` (id, slug, nameDe, nameEn, position, visible, offerCount), `merchantOfferSchema`, `createOfferRequestSchema`/`updateOfferRequestSchema`, `setOfferMediaRequestSchema` (1..`MAX_OFFER_MEDIA` ids), `offerListSchema`; make `memberOfferSchema` additively carry `category`, `media[]` (`mediaItemSchema`, derivatives only) and `perPersonLimit`. Types only that both server and clients need live here (Principle I).
- [X] T010 [P] Create `packages/contracts/src/stores.ts`: `storeSchema` (name and logo from the organisation profile, description, cover, gallery `media[]`, opening hours, `active`, `deactivationNotice` as a code or null, `version`), `createStoreRequestSchema`, `updateStoreRequestSchema` (with `version`), `adminStoreSchema`, `setStoreCoverRequestSchema` (`assetId`), `setStoreMediaRequestSchema` (0..`MAX_STORE_MEDIA` ids), and `setStoreActiveRequestSchema` accepting `active: boolean | 0 | 1` plus `reason`, normalised to boolean. Add the export to the package's `exports` map the way the other modules are exported.
- [X] T011 [P] Create `packages/contracts/src/redemptions.ts`: `redeemRequestSchema` (`requestId` uuid), `redemptionSchema`, `redemptionListSchema`, `redemptionReportQuerySchema`, `redemptionReportSchema` exactly as in contracts/api.md ("Report shape"), `REDEEMER_KINDS`. Export from the package's `exports` map.
- [X] T012 Extend `VISIBLE_OFFER` and `OFFER_JOINS` in `server/src/modules/offers/application/offer.ts` with `JOIN stores st ON st.id = o.store_id` and `AND st.active` (data-model.md "Visibility predicate"), keeping the single-copy rule and updating the scope-contract comment. Confirm `server/src/modules/push/application/dispatch.ts` and `getMemberOffer` still compile against it. Extend `server/tests/offers/visibility.test.ts` with a deactivated-store case plus a counter-assertion that an active store's offer still shows.
- [X] T013 Keep the existing inserts compiling against the new NOT NULL columns: update `server/src/seed/offers.ts` (offers get `store_id`/`category_id`; redemptions use `redeemer_kind`/`redeemer_id`/`request_id`/`organisation_id`/`category_id`), `server/tests/push/helpers.ts` (insert at line ~174) and `server/tests/seed/content.test.ts` (insert at line ~76). Update `server/src/seed/tables.ts` (`stores`, `offer_categories`, `offer_media` under `SEEDED`; redemptions stay under `HISTORY`) and `server/tests/seed/table-manifest.test.ts`/`coverage.test.ts` accordingly.
- [X] T014 [P] Create `server/tests/offers/helpers.ts`: `merchantWithStore(app)` (organisation, owner user, store, bearer), `partnerUser(app)`, `staffWith(app, grants)`, `seedOffer(pool, {...})` (any state, category, limits, optional media; inserts by SQL like `tests/marketplace/helpers.ts` so tests can reach states the API will not produce), `redeemerFor(app, kind)` for member/staff/merchant/partner, `resetRedemptions(pool)` (TRUNCATE; row triggers do not fire on it), and `seedReadyAsset(...)` using `tests/helpers/media.ts`.
- [X] T015 [P] Add `merchant_offers` to the audit allowlist keys in `server/src/ops/audit.ts` as `storeChange`, `categoryChange` and `offerChange` (each with a comment naming what it may contain: ids and before/after of non-sensitive fields only), and extend the audit-allowlist test if one exists (`grep -rn "adminChange" server/tests`).
- [X] T089 [P] In `packages/contracts/src/media.ts` add `MERCHANT_IMAGE_MAX_BYTES = 1_048_576`, `MERCHANT_VIDEO_MAX_BYTES = 5_242_880` (a file at or above its limit is refused), `MAX_STORE_MEDIA = 10` and `STORE_COVER_ASPECT = { width: 16, height: 9, tolerance: 0.02 }`, each with a comment saying why it is a shared constant (clients check early, the server decides). In `packages/contracts/src/errors.ts` add `COVER_ASPECT_RATIO` 422 and `MEDIA_IN_USE` 409. Re-use `MEDIA_TOO_LARGE` for the size caps. Add the web and app catalogue strings in T033/T034's passes.
- [X] T016 Run `npm run -w server migrate` on a development database, then `npx tsc --noEmit` in `packages/contracts`, `server`, `client` and `expo-client/german-world-club`; run `npm run -w server test` and compare with the T001 baseline. Fix regressions before any story starts.

**Checkpoint**: Foundation ready. US1, US2 and US4 can start; US3 needs US2's redemptions; US5 and US6 are independent of them.

---

## Phase 3: User Story 1 - A merchant sets up their store and publishes categorised offers (Priority: P1) 🎯 MVP

**Goal**: one store per merchant organisation, categorised offers of three types with up to 10 media items, publish and withdraw, on web and in the app.

**Independent Test**: quickstart scenario 1 plus 7's merchant-form half.

### Tests for US1 (write first; they must fail)

- [X] T017 [P] [US1] `server/tests/stores/one-per-org.test.ts`: two concurrent `POST /merchant/store` for one organisation yield one 201 and one 409 `store-exists`; a direct SQL second insert fails on the unique constraint (the database, not the application, holds the rule); a partner organisation cannot get a store; a user of another organisation cannot read or change this store (identical 404 incl. headers).
- [X] T018 [P] [US1] `server/tests/offers/media-limit.test.ts`: 10 items accepted in order with the first as lead; an 11th in the request is 422 `offer-media-limit` and the set is unchanged; a direct SQL insert at position 10 fails the CHECK; an asset uploaded by another organisation, a `failed` asset and an unknown id are refused; the list payload carries `thumb`/`poster` derivatives and no response contains an original's storage key (counter-assertion: an offer with no media is still valid).
- [X] T019 [P] [US1] `server/tests/offers/merchant-offers.test.ts`: category required (422 `offer-category-required`); `freebie` and `bogo` accepted without a price; `offers_real_advantage` still refuses a price that is not lower; publish moves `draft → published` and sets `published_at`; withdraw hides it from browse; publish on an inactive store is 409 `store-inactive`; a hidden category is refused for a new offer but an existing offer under it stays editable.
- [X] T020 [P] [US1] `server/tests/offers/ownership.test.ts`: merchant B reading, editing, publishing, withdrawing or setting media on merchant A's offer gets a response identical in status, body and headers to an unknown id (mirror `tests/marketplace/ownership.test.ts`).
- [X] T021 [P] [US1] `server/tests/offers/no-select-star.test.ts`: scan `server/src/modules/{stores,offers,offer-categories,redemptions}/application/` for `SELECT *`/`RETURNING *` (mirror `tests/marketplace/no-select-star.test.ts`); add a counter-assertion that the scanner finds a planted fixture string.

- [X] T091 [P] [US1] `server/tests/media/merchant-limits.test.ts`: at `/media/merchant`, a photo of 1 MiB - 1 byte is accepted and one of exactly 1 MiB is refused with 413 `media-too-large`; a video of 5 MiB - 1 byte is accepted and one of exactly 5 MiB is refused; a 6 MB file is refused without being fully buffered (the stream is cut); nothing is stored or charged to the quota on a refusal; counter-assertion: the same 2 MB photo is still accepted at `/media` for a member and at `/media/partner` (the caps are merchant-only).
- [X] T093 [P] [US1] `server/tests/stores/store-media.test.ts`: `PUT /merchant/store/cover` accepts a 1600x900 image, accepts 1280x720, refuses 800x800 and a portrait 900x1600 with 422 `cover-aspect-ratio`, refuses a video, and keeps the previous cover after a refusal; `PUT /merchant/store/media` accepts 10, refuses an 11th with the previous gallery unchanged, and a direct SQL insert at position 10 fails the CHECK; another organisation's asset is refused; the cover does not count toward the 10 (counter-assertion: 10 gallery items plus a cover is valid).
- [X] T095 [P] [US1] `server/tests/media/merchant-delete.test.ts`: `DELETE /media/merchant/:id` removes the merchant's own unused asset and lowers the stored-bytes counter; an asset used by an offer, the store gallery, the cover or the logo answers 409 `media-in-use` and stays; another organisation's asset and an unknown id answer an identical 404; a member token is refused; no storage key appears in any response.
- [X] T098 [P] [US1] `server/tests/offers/push-once.test.ts`: publishing a draft through the merchant route inserts exactly one `push_notifications` row with `idempotency_key = 'offer:<id>'`; withdraw then publish again leaves still one; two simultaneous publish requests leave one; a future `valid_from` sets `not_before` to it; a seeded publish under `gwc.suppress_offer_push` inserts none; two different offers insert two (counter-assertion: the key is per offer, not global); a draft that is deleted or withdrawn before publishing inserts none; the application code path queues nothing itself (scan `server/src/modules/offers/` for `INSERT INTO push_notifications` and assert there is none). Reference the existing `tests/push/offer-trigger.test.ts` and `offer-dispatch.test.ts` rather than duplicating their dispatch assertions.

### Implementation for US1

- [X] T022 [US1] `server/src/modules/stores/application/store.ts`: `getOwnStore`, `createStore` (idempotent under the unique constraint, mapping the violation to `STORE_EXISTS`), `updateStore` (version compared on the microsecond-formatted `updated_at`, stale → 409, as `admins/application/update.ts` does), explicit column lists, audit `storeChange` in the same transaction via `auditInTransaction`.
- [X] T023 [US1] `server/src/modules/offers/application/merchant-offers.ts`: list own offers (any state), create (draft), update, `setOrder`, `publish`, `withdraw`. Enforce store active on publish, category visible on create or category change, type rules, window. Scope every statement by the principal's organisation id; use `guardOrganisationScope` for id-taking routes so refusals are 404. Audit `offerChange` on publish and withdraw. **`publish` only sets `state = 'published'` and `published_at`; it must not queue a notification** (the trigger `offers_queue_push` does, once per offer, keyed `offer:<id>`; a second path would send twice). Add a comment saying why.
- [X] T024 [US1] `server/src/modules/offers/application/offer-media.ts`: `setOfferMedia(app, { offerId, organisationId, assetIds })` replaces the set in one transaction (delete links, insert positions 0..n-1), after checking each asset exists, is not `failed`, and was uploaded by this organisation (`assets.uploaded_by`/`uploader_kind`); the 10 limit is checked before touching rows and the CHECK is the backstop. Attaching an asset still `processing` is allowed; delivery already hides non-ready derivatives.
- [X] T025 [US1] `server/src/modules/offer-categories/application/categories.ts` (list visible for merchants and members with counts) and `server/src/modules/offer-categories/routes.ts` + `controller.ts` for `GET /merchant/categories`; register in `server/src/app.ts`.
- [X] T026 [US1] `server/src/modules/stores/routes.ts` + `controller.ts`: `GET/POST/PATCH /merchant/store` with the postures and buckets decided in T003, request/response schemas from `@gwc/contracts/stores`; register in `server/src/app.ts`.
- [X] T027 [US1] `server/src/modules/offers/merchant-routes.ts` + `merchant-controller.ts`: `GET/POST /merchant/offers`, `PATCH /merchant/offers/:id`, `PUT /merchant/offers/:id/media`, `PUT /merchant/offers/order`, `POST /merchant/offers/:id/publish|withdraw`. Register in `server/src/app.ts` next to `offerRoutes`. Keep `modules/offers/routes.ts` for the member detail route.
- [X] T028 [US1] Extend `getMemberOffer` in `server/src/modules/offers/application/offer.ts` to return `category`, `media[]` (via `loadMediaItems`, derivatives only) and `perPersonLimit`, additively; update `tests/offers/visibility.test.ts` expectations only where the shape grew.
- [X] T090 [US1] Merchant size caps in `server/src/modules/media/controller.ts`: for the `merchant` audience only, call `request.file({ limits: { fileSize: MERCHANT_VIDEO_MAX_BYTES } })` so the stream is cut at the larger cap, and after `validateUpload` decides the kind, refuse an image at or above `MERCHANT_IMAGE_MAX_BYTES` and a video at or above `MERCHANT_VIDEO_MAX_BYTES` with `PROBLEMS.MEDIA_TOO_LARGE` and a detail naming the limit. Other audiences keep `maxBytes`. Comment why the kind-specific check cannot run before content inspection (the declared type is not trusted).
- [X] T092 [US1] `server/src/modules/stores/application/store-media.ts` and routes: `setStoreCover(assetId)` (asset exists, uploaded by this organisation, kind image, `|width/height - 16/9| <= tolerance * 16/9`, else `COVER_ASPECT_RATIO`; a refusal leaves the old cover) and `setStoreMedia(assetIds)` (0..`MAX_STORE_MEDIA`, replace in one transaction, same ownership and not-failed checks as T024); `PUT /merchant/store/cover` and `PUT /merchant/store/media` in `server/src/modules/stores/routes.ts`; include `cover` and `media[]` (derivatives only) in the store response; audit `storeChange`.
- [X] T094 [US1] `DELETE /media/merchant/:id` in `server/src/modules/media/routes.ts` using the existing `deleteAsset` (it already checks ownership by `uploaded_by`/`uploader_kind` and releases the quota); map the foreign-key violation from the `RESTRICT` references (`offer_media`, `store_media`, `stores.cover_asset_id`, `organisation_profiles.logo_asset_id`) to 409 `media-in-use` instead of a 500. Add the route to the authz matrix and the `/media` surface check.
- [X] T029 [P] [US1] Web API wrappers: `client/src/organisation/api.ts` with typed calls for store, offers, media set and categories using `@gwc/contracts` types (no local shapes).
- [X] T030 [P] [US1] `client/src/organisation/Store.tsx`: create or edit the store (description, cover, opening hours), show the deactivation notice when `active` is false, `PageLoader` while loading, console-only error logging. Cover upload uses the existing `upload()` helper (progress arrives in US5, T073).
- [X] T031 [P] [US1] `client/src/organisation/Offers.tsx` (list, reorder, publish, withdraw) and `client/src/organisation/OfferEditor.tsx` (type, value, window, conditions, limits, a category select showing only the categories returned by the server, and a media list reusing `client/src/member/MediaPicker.tsx` with the limit taken from `MAX_OFFER_MEDIA`, never a literal).
- [X] T032 [US1] Wire the merchant pages: add routes in `client/src/console/routes.tsx` under the merchant portal only (a partner navigating to them gets the existing refusal), add sidebar items in `client/src/organisation/OrganisationLayout.tsx` for `kind === 'merchant'` only.
- [X] T033 [P] [US1] Web i18n for US1 in `client/src/i18n/de.ts` and `client/src/i18n/en.ts` (store, offer editor, types, categories by slug fallback to `nameDe`/`nameEn`, the new problem types in `client/src/lib/problems.ts` `describeProblem` map). `npm run -w client test:i18n` must pass in both directions.
- [X] T034 [P] [US1] App: `expo-client/german-world-club/src/api/endpoints.ts` (store, offers, media set, categories), screens `src/app/(organisation)/store.tsx`, `offers/index.tsx`, `offers/[id].tsx`, register them in `src/app/(organisation)/_layout.tsx` and show them only when the signed-in organisation is a merchant, plus `src/i18n/{de,en}.ts`. Lists use the offer's `thumb`/`poster` derivative; no `react-native-svg`, no new native module.
- [X] T035 [P] [US1] `client/tests/console/merchant-store.test.tsx` (create store, second attempt shows the refusal as a logged error and not as stored state, 11th media blocked, category list comes from the server) and add the new pages to the allow-list review in `client/tests/loading-states.test.tsx` only if one genuinely renders nothing while loading (each entry needs a reason).
- [X] T096 [P] [US1] Web store cover and gallery in `client/src/organisation/Store.tsx` (after T030): a wide cover at the top, a gallery editor of up to `MAX_STORE_MEDIA` items, and `client/src/lib/media-limits.ts` that checks `File.size` against the merchant caps and the cover's decoded dimensions against `STORE_COVER_ASPECT` before sending, showing the limit and ratio in both languages; a delete control for the merchant's unused files (409 `media-in-use` is logged and shown as the problem's own translated line, because the person cannot proceed without knowing why). Add `client/tests/organisation/store-media-limits.test.tsx` (an oversized photo and a portrait cover are refused before any request; the server's refusal still leaves the old cover).
- [X] T097 [P] [US1] App store cover and gallery in `expo-client/german-world-club/src/app/(organisation)/store.tsx` (after T034): the cover picker uses `allowsEditing` with `aspect: [16, 9]` and a reduced `quality`; both pickers check the asset's `fileSize` against the merchant caps and refuse early with the limit shown; no new native module and no `expo-image-manipulator`, so `app.config.js` and `package.json` stay unchanged; strings in `src/i18n/{de,en}.ts`.
- [X] T036 [US1] Demo seed: extend `server/src/seed/offers.ts` so each seeded merchant gets one store with a 16:9 cover and a small gallery, its offers spread across categories and the three types, and media via the existing asset seeding (≤ 10 per offer, in the same insert as the offer's lifecycle fact); follow the consistent-history rule (no invented history) and keep `SET LOCAL gwc.suppress_offer_push = 'on'`. Update `server/tests/seed/` suites for the new tables and determinism.

**Checkpoint**: A merchant can run a store on web and in the app. MVP scope.

---

## Phase 4: User Story 2 - A user browses and redeems merchant offers (Priority: P1)

**Goal**: any active account (member, staff, merchant user, partner user) browses by category and redeems exactly once per rules, on web and in the app.

**Independent Test**: quickstart scenarios 2-4.

### Tests for US2

- [X] T037 [P] [US2] `server/tests/redemptions/redeem.test.ts`: 201 with a reference and `remaining` decremented by one; same `requestId` replayed returns the original (200) and the count is unchanged; expired, withdrawn, not-yet-valid, sold-out and deactivated-store offers are refused with the right problem and record nothing; `per_person_limit = 1` refuses a second redemption by the same account (`per-person-limit-reached`) but not by another; unlimited (`remaining` NULL, limit NULL) redeems repeatedly (counter-assertion that the `NULL` path is not treated as zero).
- [X] T038 [P] [US2] `server/tests/redemptions/concurrency.test.ts`: one remaining unit, 100 concurrent redemptions from 100 distinct accounts → exactly one 201, 99 `offer-sold-out`, `remaining = 0`, one row; separately, two concurrent identical `requestId`s → one row.
- [X] T039 [P] [US2] `server/tests/redemptions/any-account.test.ts`: member, staff, partner user and a merchant user (another organisation's offer) can redeem; a merchant user on their own organisation's offer gets 422 `own-offer`; a locked, inactive, ended member, an unapproved applicant and an inactive organisation user are refused (`account-not-active`/403) and record nothing; the recorded `redeemer_kind` is correct for each.
- [X] T040 [P] [US2] `server/tests/redemptions/ledger.test.ts`: UPDATE and DELETE on `redemptions` are refused by trigger (even an ad-hoc statement); inserting a `redeemer_id` that does not exist for its kind is refused; `resetRedemptions` (TRUNCATE) works so other suites can clean up.
- [X] T041 [P] [US2] `server/tests/offers/browse.test.ts`: category filter and counts; keyset paging is stable; payloads carry thumbnails only and no original; a deactivated store, a suspended organisation and a hidden-state offer are absent from list and detail (identical 404 on detail); an offer under a hidden category is still listed.
- [X] T042 [P] [US2] Extend `server/tests/authz/matrix.test.ts` (and `route-posture.test.ts` if it enumerates routes) with every route added in this story for each of its four audiences, asserting a token of the wrong audience is refused before the handler runs.

### Implementation for US2

- [X] T043 [US2] `server/src/modules/offers/application/browse.ts`: `listVisibleOffers(app, { categoryId, cursor, signal })` and `listCategoriesWithCounts` using `VISIBLE_OFFER`, explicit columns, keyset on `(sort_position, id)` or `(published_at, id)`, media via `loadMediaItems` (lead derivative only for lists).
- [X] T044 [US2] `server/src/modules/redemptions/application/redeem.ts`: in one transaction, `SELECT … FOR UPDATE` the offer row (pattern of `db/counters.ts`), re-check `VISIBLE_OFFER` and remaining, per-person limit by `(offer_id, redeemer_kind, redeemer_id)`, refuse the merchant's own organisation (`OWN_OFFER`), look up an existing `(redeemer, request_id)` first and return it, decrement `remaining` when not NULL, insert the redemption with the denormalised `organisation_id`/`category_id` and a server-generated unique `reference`, compute `estimated_saving_cents` only when both prices exist. No notification or email inside the transaction.
- [X] T045 [US2] `server/src/modules/redemptions/application/mine.ts`: the caller's own redemptions (paged, explicit columns, offer title, merchant display name, thumbnail).
- [X] T046 [US2] `server/src/modules/redemptions/routes.ts` + `controller.ts`: register the browse/detail/redeem/mine handler set once per audience in a loop over `[member → /member/offers, staff → /admin/club-offers, merchant → /merchant/club-offers, partner → /partner/club-offers]` (comment why: one audience per route, so widening a route would put the organisation gates on member traffic). Keep the existing `GET /member/offers/:id`; add the same detail handler for the other three prefixes. Derive `redeemerKind`/`redeemerId` from `request.principal`, never from the body. Register in `server/src/app.ts`.
- [X] T047 [P] [US2] Web offers API module `client/src/lib/offers-api.ts`: picks the URL prefix from the signed-in kind (`useCapabilities`), exposes `list`, `categories`, `detail`, `redeem(requestId)`, `mine`; the `requestId` is generated once per tap and reused on retry.
- [X] T048 [P] [US2] Web pages `client/src/member/Offers.tsx` (category chips, cards with thumbnail), `client/src/member/OfferDetail.tsx` (media carousel, terms, store, Redeem button using `AsyncButton`/`useAction`, shows the reference after success) and `client/src/member/Redemptions.tsx`; routes in `client/src/console/routes.tsx` for the member area and the staff/merchant/partner shells (same components, other prefix); a nav entry in `client/src/member/MemberLayout.tsx` and the other shells' sidebars.
- [X] T049 [P] [US2] App screens `expo-client/german-world-club/src/app/(member)/offers/index.tsx`, `[id].tsx`, `redemptions.tsx` with their own stack (`_layout.tsx` for the folder), reached from the Activity tab header and the Profile list (research R13: no sixth tab); `src/api/endpoints.ts`; `src/i18n/{de,en}.ts`; reuse `components/media-carousel.tsx` and `components/spinner.tsx`; show the thumbnail in lists. Confirm `app.config.js` and native config are unchanged.
- [X] T050 [P] [US2] Web i18n keys and problem-type strings for browse and redeem in `client/src/i18n/{de,en}.ts`; `client/tests/member/offers.test.tsx` (browse by category, redeem shows the reference, a refusal is logged not stored, a double tap sends one request).

**Checkpoint**: Offers are browsable and redeemable by every active account kind.

---

## Phase 5: User Story 3 - Merchants and the super admin see redemption reports (Priority: P2)

**Goal**: scoped, paged, totalled redemption report for a merchant and for the platform; each dashboard lists its redeemed items.

**Independent Test**: quickstart scenario 5.

### Tests for US3

- [X] T051 [P] [US3] `server/tests/redemptions/report-scope.test.ts`: merchant A sees only A's redemptions, never B's, even with `organisationId=B` in the query (the param is ignored); admin sees both and filters by merchant, category and date range; totals cover the whole filtered set, not the page; admin total for a period equals the sum of the merchants' totals (SC-007); a category change after redemption does not rewrite history.
- [X] T052 [P] [US3] `server/tests/redemptions/report-no-pii.test.ts`: scan every report body for emails, mobile numbers, `legal_name`, `fee_tier` and account ids; rows contain only display name/handle, kind, reference, offer (counter-assertion: the scanner flags a planted email).
- [X] T053 [P] [US3] `server/tests/redemptions/report-authz.test.ts`: staff without the `merchant_offers.read` grant get 403 on `/admin/reports/redemptions`; with the grant (and as superadmin) 200; a merchant token on the admin route and an admin token on the merchant route are refused by audience; a revoked grant bites on the next request.

### Implementation for US3

- [X] T054 [US3] `server/src/modules/redemptions/application/report.ts`: `redemptionReport(app, { scope: { organisationId } | 'platform', filters, cursor, signal })` with explicit columns, a separate totals query over the filtered set, `byOffer` grouping, keyset on `(redeemed_at, id)`, and `redeemerName` resolution (member: handle or "First L." like `REFEREE_NAME`; staff and organisation users: display name; never email). The merchant route builds `scope` from the principal only.
- [X] T055 [US3] Add `GET /merchant/reports/redemptions` and `GET /admin/reports/redemptions` (module `merchant_offers`, flag `read`) to `server/src/modules/redemptions/routes.ts` + controller; add the superadmin-implied-grant check to the existing permission resolver only if superadmin does not already satisfy module checks (verify in `server/src/authz/require-permission.ts` first and record the finding in research.md R11).
- [X] T056 [P] [US3] Web `client/src/organisation/Report.tsx` (filters, totals, by-offer table, paged rows) and a "recent redemptions" card in `client/src/organisation/OrganisationHome.tsx` for merchants; route and sidebar entry (merchant only).
- [X] T057 [P] [US3] Web `client/src/console/admin/RedemptionReport.tsx` (adds the merchant filter), route in `client/src/console/routes.tsx` under `RequireGrant` for `merchant_offers`/`read`, sidebar item, and a "recent redemptions" card in `client/src/console/AdminDashboard.tsx` shown only with the grant.
- [X] T058 [P] [US3] App `expo-client/german-world-club/src/app/(organisation)/report.tsx` for merchants (totals and recent rows), layout entry, endpoints, i18n.
- [X] T059 [P] [US3] Web and app i18n for the report; `client/tests/console/redemption-report.test.tsx` (merchant sees own totals, admin sees the merchant filter, empty state is a real empty set and not shown while loading).

**Checkpoint**: Reports agree and are scoped.

---

## Phase 6: User Story 4 - The admin manages categories and can deactivate any store (Priority: P2)

**Goal**: staff see and manage all categories; staff switch any store off or on with a `PUT`.

**Independent Test**: quickstart scenarios 6 and 7.

### Tests for US4

- [X] T060 [P] [US4] `server/tests/stores/deactivate.test.ts`: `PUT /admin/stores/:id/active` with `{active:false,reason}` and with `{active:0,reason}` both deactivate; a missing reason is 422; the second identical call is a no-op 200 (idempotent); the offer vanishes from browse and detail on the next request and redemption is refused `offer-not-available`; the merchant still reads their store with a notice and cannot publish (`store-inactive`); `{active:true}` restores everything; an audit entry with actor, before and after exists in the same transaction; without `merchant_offers.status` the call is 403; a suspended or ended organisation behaves as deactivated.
- [X] T061 [P] [US4] `server/tests/offer-categories/manage.test.ts`: staff list includes hidden categories and offer counts; add (slug unique), rename, reorder, hide and show; hiding keeps the category on its offers (still visible and redeemable) and removes it from `GET /merchant/categories`; there is no delete route (404) and a direct `DELETE` of a referenced category is refused by trigger; merchants and members are refused on every admin route; every change writes an audit entry.

### Implementation for US4

- [X] T062 [US4] `server/src/modules/stores/application/admin.ts`: `listStores` (organisation display name, active, offer counts, explicit columns) and `setStoreActive` (reason required when deactivating, sets `deactivated_at/by/reason`, clears them on reactivation, `auditInTransaction` key `storeChange`, idempotent when already in the requested state); routes in `server/src/modules/stores/staff-routes.ts` + `staff-controller.ts`: `GET /admin/stores` (read) and `PUT /admin/stores/:id/active` (status). Use `setStoreActiveRequestSchema` from contracts so `0`/`1` normalise to a boolean in one place.
- [X] T063 [US4] `server/src/modules/offer-categories/application/admin.ts` and `staff-routes.ts` + controller: `GET/POST /admin/offer-categories`, `PATCH /admin/offer-categories/:id` (flags `read`/`write`/`edit`); no delete route. Register both staff route files in `server/src/app.ts`.
- [X] T064 [US4] Expose the deactivation as a code on `GET /merchant/store` (`deactivationNotice`: `'deactivated'` or null, never the staff reason) and render it in `client/src/organisation/Store.tsx` and the app `(organisation)/store.tsx` with translated copy.
- [X] T065 [P] [US4] Web `client/src/console/admin/Stores.tsx` (list, active switch with a required reason dialog, confirm before deactivating) and `client/src/console/admin/OfferCategories.tsx` (list with counts, add, rename, reorder, hide); routes under `RequireGrant`, sidebar items, i18n in both catalogues.
- [X] T066 [P] [US4] `client/tests/console/stores-admin.test.tsx` and `client/tests/console/offer-categories.test.tsx` (controls absent without the grant; reason required; a failed `PUT` is logged and leaves the switch where it was).

**Checkpoint**: The club can control quality and safety.

---

## Phase 7: User Story 5 - Uploads show progress, including the partner profile (Priority: P3)

**Goal**: send progress then a processing state on web and in the app, for store, offer media and the partner profile; failed or cancelled uploads leave content untouched.

**Independent Test**: quickstart scenario 8.

### Tests for US5

- [X] T067 [P] [US5] `server/tests/media/status-by-audience.test.ts`: `GET /media/merchant/:id` and `GET /media/partner/:id` return the asset's state for the uploader's own organisation and an identical 404 for another's or an unknown id; a member token is refused on both; the response carries no storage key.
- [X] T068 [P] [US5] `client/tests/components/upload-progress.test.tsx`: the component shows a moving bar from `uploading` fractions, an indeterminate state when `fraction` is null, then "processing", then done; a failure shows the failed state, offers retry and the previous content is unchanged.
- [X] T069 [P] [US5] `client/tests/organisation/partner-profile-upload.test.tsx`: updating the partner profile with a new logo shows progress then processing, and a rejected upload leaves the existing logo (counter-assertion: a successful upload replaces it).

### Implementation for US5

- [X] T070 [US5] Server: `GET /media/merchant/:id` and `GET /media/partner/:id` in `server/src/modules/media/routes.ts` using the same handler as `GET /media/:id`, restricted to assets uploaded by the caller's organisation (`assets.uploader_kind`/`uploaded_by`); the existing member route stays member-only. Why: `GET /media/:id` is audience `member`, so an organisation client cannot poll the `processing → ready/failed` state that is the server's part of the progress (research R10).
- [X] T071 [P] [US5] Web `client/src/components/ui/UploadProgress.tsx` (accessible `progress` semantics, uses `Spinner` for processing, text from i18n) and `client/src/lib/use-media-upload.ts`: calls the existing `upload(path, form, { onProgress })`, then polls `GET /media/{kind}/:id` until `ready` or `failed` with a bounded interval and abort on unmount; returns `{ phase, fraction, asset, retry, cancel }`.
- [X] T072 [US5] Apply it: partner profile logo in `client/src/organisation/Profile.tsx`, store cover and logo in `client/src/organisation/Store.tsx`, offer media in `client/src/organisation/OfferEditor.tsx`. A failed or cancelled upload must not change the form's saved value.
- [X] T073 [US5] App: add `uploadWithProgress(path, form, { onProgress, signal })` to `expo-client/german-world-club/src/api/client.ts` using `XMLHttpRequest` (`xhr.upload.onprogress`), with the same bearer, single refresh-on-401 retry and one-line request logging (method, path, status, timing, request id; never headers or bodies) as `api()`. No new dependency and no native module (research R10).
- [X] T074 [P] [US5] App `src/components/upload-progress.tsx` and `src/hooks/use-media-upload.ts` (same phases and polling as web); `mediaApi.upload` in `src/api/endpoints.ts` takes `onProgress`; apply to `src/app/(organisation)/public-profile.tsx` (partner and merchant logo), `store.tsx` and the offer editor; i18n in both catalogues.
- [X] T075 [P] [US5] Update the partner profile server contract only if the logo flow needs it (check `server/src/modules/profile` first; the logo is set by asset id, so likely no change) and record "no change needed" in research.md R10 if so.

**Checkpoint**: Large uploads give feedback; nothing half-attached.

---

## Phase 8: User Story 6 - The landing page shows a carousel of partners and merchants (Priority: P3)

**Goal**: a script-free carousel on `/` and `/en` only, from live public data.

**Independent Test**: quickstart scenario 9.

### Tests for US6

- [X] T076 [P] [US6] `server/tests/seo/landing-carousel.test.ts`: active partners and merchants with a public profile appear on `/` and `/en`; a merchant entry has no link and a partner entry links to its existing public partner page; a deactivated store, a suspended organisation and a profile with no display name are absent; no eligible organisations → the section is omitted (no empty heading); only derivative URLs (`/media/<checksum>/<variant>.<ext>`) with width and height, never an original, `legal_name` or `fee_tier`; anonymous response is `public` with `max-age=300` and has **no** `Vary: Cookie`; a signed-in response is still `private, no-store` with `Vary: Cookie`; the response contains no `<script>` from this feature.
- [X] T077 [P] [US6] Extend `server/tests/seo/landing-viewer.test.ts` and `client/tests/landing.test.ts`, `landing-en.test.ts`, `landing-pair.test.ts` to require the `<!--gwc:partners-->` marker pair in both shells, and the hreflang pair to be unchanged.

### Implementation for US6

- [X] T078 [US6] `server/src/modules/public/application/partners-carousel.ts`: one query for active organisations (partners, and merchants whose store is active) that have a profile display name, logo asset ready, explicit columns, bounded `LIMIT` (e.g. 24), deterministic order; render escaped HTML (use the existing `escape` from `templates/layout.ts`) with `<img>` carrying width/height and `alt` from the display name; returns `''` when empty.
- [X] T079 [US6] Wire it into the landing handlers in `server/src/modules/public/controller.ts` (and `application/landing.ts` where the shell is filled): replace the content between `<!--gwc:partners-->` and `<!--/gwc:partners-->` on `/` and `/en`; keep `app.peekViewer` handling and `private, no-store`/`Vary: Cookie` only for signed-in visitors; set `Cache-Control: public, max-age=300` for the anonymous page (research R9). Never add `Vary: Cookie` to the anonymous response.
- [X] T080 [US6] `client/index.html` and `client/en.html` (the English shell's real filename is in `server/src/modules/public/routes.ts`; check `loadLandingShell(…, 'en.html')`): add the marker pair and a section with a heading, plus CSS in the shell's single inline `<style>` (so the CSP nonce covers it): horizontal `overflow-x: auto; scroll-snap-type: x mandatory`, a slow CSS animation switched off by `@media (prefers-reduced-motion: reduce)`, no JavaScript. Keep copy in both languages.
- [X] T081 [US6] Run `npm run -w server verify:seo` against a seeded database and fix anything it reports (sitemap and canonical rules must be unchanged; the carousel adds no URL to the sitemap).

**Checkpoint**: Public visibility for partners and merchants.

---

## Phase 9: Polish and cross-cutting

- [X] T082 [P] Add a "Merchant stores and offers (feature 035, `specs/035-merchant-store-offers/`)" paragraph to `CLAUDE.md` in the style of the existing feature notes: the five rules that look optional (one store per organisation by constraint; `VISIBLE_OFFER` includes the store and is the one copy; the 10-item bound lives in the database; redemptions are append-only, idempotent and polymorphic, with a merchant barred from its own offers; deactivation is staff-only and audited), plus the landing carousel's cache rule, and update the Layout section if it lists modules.
- [X] T083 [P] Update `server/ARCHITECTURE.md` and `server/README.md` only where they enumerate modules or env/deployment preconditions (no new env var is expected; say so if true).
- [X] T084 Constitution evidence: confirm each of Principles I-VI has a passing automated check from this feature (I: contracts types and `tsc`; II: matrix and posture suites; III: visibility, landing and `verify:seo`; IV: one-per-org, media bound, concurrency, ledger; V: budget gate at boot; VI: no-original, no-PII, no-select-star) and tick them off in plan.md under the Constitution Check.
- [X] T085 Full verification from the repo root: `npm test`, `npm run -w client test:i18n`, `npx tsc --noEmit` in each workspace, `npm run -w german-world-club lint`, `npx expo-doctor` in `expo-client/german-world-club`, `npm run -w server verify:seo`. Compare with the T001 baseline; nothing may be newly red.
- [X] T086 Confirm this feature needs no new EAS build: `git diff main -- expo-client/german-world-club/app.config.js expo-client/german-world-club/package.json` shows no native change, no new dependency. If one slipped in, remove it or record the build requirement in the PR.
- [ ] T087 Run quickstart.md scenarios 1-9 by hand against a seeded development database, including the app on an Android device or emulator in dark mode (Merchant offers screens and the upload progress bar) and iOS, and record the outcome in `specs/035-merchant-store-offers/quickstart.md` under a "Results" heading with anything not verified stated plainly.
- [X] T088 `npm run -w server bench:feed` is unaffected; run it only if `VISIBLE_OFFER` joins show up in the push dispatch path timing, and record the p95 in research.md. Otherwise note "not affected".

---

## Dependencies and execution order

- **Phase 1** → **Phase 2** → user stories. Phase 2 blocks all stories.
- **US1** (P1) and **US2** (P1) both need only Phase 2. US2's tests use `seedOffer` from T014, so it does not wait for US1's routes; the web and app offer screens (T047-T050) are simpler to build after US1's offer data exists in the seed (T036).
- **T089-T098** (added after analysis): T089 is foundational (contracts constants). T090 and T094 touch only the media module and need T089. T092 needs T005 (the `store_media` table), T010 and T089. T096 waits for T030 and T092; T097 waits for T034 and T092. T098 waits for T023. Tests T091, T093, T095 and T098 are written before their implementation tasks (T090, T092, T094, T023).
- **US3** needs US2's redemption table writes (T044) for real data; its tests can insert rows through the helper.
- **US4**: categories (T063) are independent; the deactivation tests T060 need US2's redeem path for the "redemption refused" assertion.
- **US5**: server task T070 is independent; T072/T074 apply the component to pages that US1 creates, so run them after T030, T031 and T034.
- **US6** is independent of US1-US5 apart from the foundational tables.
- **Polish** last.

### Parallel opportunities

- Phase 2: T007-T011 and T014-T015 are different files (after T004-T006 land).
- US1: T017-T021 together; T029-T031, T033-T035 together once T022-T028 exist.
- US2: T037-T042 together; T047-T050 together.
- US3: T051-T053 together; T056-T059 together.
- US4: T060, T061 together; T065, T066 together.
- US5: T067-T069 together; T071, T074, T075 together.
- US6: T076, T077 together.
- US3, US4, US5, US6 can be taken by different people after US2's checkpoint.

## Implementation strategy

1. **MVP**: Phases 1-2 then US1 (a merchant can run a store). That alone is demonstrable on web and in the app.
2. **Increment 2**: US2, which makes the offers useful (redeemable) and completes the core loop.
3. **Increment 3**: US3 and US4 together (reports plus the club's controls); ship US4 before opening merchant sign-ups widely, because deactivation is the safety valve for R7's direct publishing.
4. **Increment 4**: US5 and US6.

Because the migrations (T004-T006) change shared tables (`offers`, `redemptions`), land Phase 2 on its own and run the full baseline comparison (T016) before stacking story work on it.
