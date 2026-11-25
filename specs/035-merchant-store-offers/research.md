# Research: Merchant Stores, Categorised Offers and Redemption Reports

No `NEEDS CLARIFICATION` remains. The decisions below resolve the open design choices the spec delegated to planning.

## R1. Where the store lives

- **Decision**: A new `stores` table, one row per merchant organisation (`UNIQUE (organisation_id)`), with a composite FK onto `organisations (id, kind)` constrained to `kind = 'merchant'`, the same trick `offers` and `merchant_locations` use.
- **Rationale**: Columns on `organisations` would sit next to `fee_tier` and contract dates, which no member may see. `organisation_profiles` is already the only member-visible projection, so the store references it for name and logo rather than duplicating them. The store adds what a storefront needs: description, cover, opening hours, the `active` flag and its audit columns, and an offer display order.
- **Alternatives**: Extending `organisation_profiles` (mixes the partner profile, which has no store, with merchant-only fields). One store per organisation user (contradicts "each merchant has one store").

## R2. Deactivation

- **Decision**: `PUT /admin/stores/:id/active` with `{ "active": false }`. The contract accepts `false`/`0` and `true`/`1` (the request said "false or 0") and normalises to a boolean. Module `merchant_offers`, flag `status`. The change takes `deactivated_at`, `deactivated_by` and a required reason, writes an audit entry in the same transaction, and calls `app.permissions.invalidate`-style cache invalidation where visibility is cached (R9).
- **Rationale**: `PUT` on a sub-resource is idempotent, which matches "set the flag". Requiring a reason matches how other staff status changes work. A deactivated store is hidden everywhere through one predicate (R6), so there is no second place to forget.
- **Alternatives**: `PATCH /admin/stores/:id` (fine, but the request explicitly said PUT). Deleting the store (loses history, contradicts FR-005).

## R3. New offer types

- **Decision**: Add `freebie` and `bogo` to the `benefit_kind` enum, in their own migration file (`045`), before anything uses them. Percentage and fixed discounts already exist. `member_price` and `value_add` stay for existing rows.
- **Rationale**: PostgreSQL does not allow a newly added enum value to be used in the same transaction that adds it, so the `ALTER TYPE` needs its own migration. For `freebie` and `bogo`, `benefit_value` is NULL and the `offers_real_advantage` check still holds. `bogo` may carry a free-quantity in `benefit_value` later.
- **Alternatives**: A separate `offer_type` column (two overlapping vocabularies). A text column (loses the DB check).

## R4. Categories

- **Decision**: An `offer_categories` table: `id`, unique `slug`, `name_de`, `name_en`, `position`, `visible`. The starter set is inserted by the migration. `offers.category_id` is `NOT NULL`, backfilled to the `other` category for existing rows, with `ON DELETE RESTRICT`. Staff add, rename, reorder and hide; there is no delete route for a category that has offers (and none at all in this feature, because hiding is enough).
- **Rationale**: Categories are staff-owned content, like pages, so both names are data. This is not a violation of "the server emits no localised text": that rule is about problem `detail`. A hidden category stays on its existing offers (spec US4) and is only withheld from the choice list for new offers.
- **Starter set**: Cuisine and Restaurants, Health and Clinics, Beauty and Wellness, Shopping, Travel and Leisure, Services, Education, Other. Slugs: `restaurants`, `health`, `beauty`, `shopping`, `travel`, `services`, `education`, `other`.
- **Alternatives**: A fixed enum (staff cannot add; contradicts "admin sees all categories"). Free-text tags (no counts, no reports by category).

## R5. Media set of at most 10

- **Decision**: An `offer_media (offer_id, asset_id, position)` table with `PRIMARY KEY (offer_id, position)` and `CHECK (position BETWEEN 0 AND 9)`, copied from `marketplace_listing_media`. The set is replaced as a whole by `PUT /merchant/offers/:id/media { assetIds: [...] }` (1..10 ids; position is the order; the first is the lead). The server also checks each asset was uploaded by this organisation (`assets.uploader_kind`/`uploaded_by`), exists, and is not failed.
- **Rationale**: The position bound makes an 11th item unrepresentable in the database, and the request schema refuses it earlier with a clean 422. Replacing the set keeps ordering and removal simple and atomic. Thumbnails already come from the pipeline: images get `thumb`, videos get `poster`, and delivery never serves the original. The Expo app uses the `thumb`/`poster` variant in lists.
- **Deviation from 010**: Threads attach media only in the creating transaction because posts are immutable. Offers are editable by their owner, so a replace endpoint is correct here.
- **Alternatives**: One POST per item with a count check (races at the limit).

## R6. Visibility: one rule

- **Decision**: Extend the existing `VISIBLE_OFFER` predicate (`offers/application/offer.ts`) to also require: store `active`, organisation `status = 'active'`, and (for browse lists) at least one ready media item or none (a media-less offer is still visible). Browse, detail, redeem, the push dispatch re-check and the landing carousel all import it.
- **Rationale**: This is the same discipline as `VISIBLE_POST` and `ELIGIBLE_DEVICE`: a second copy of the rule is how a deactivated store's offer comes back through a side door. It also makes FR-004 (the effect on redemption) hold by construction.

## R7. Publishing flow and the one notification

- **Decision (confirmed by the repository owner, 2026-11-23)**: A merchant publishes directly: `draft → published`, `published → withdrawn`, with no staff approval step. When an offer is published, the members who receive offer notifications are notified, **once**. `pending` and `rejected` stay in the schema, unused by this feature.
- **How "once" is guaranteed**: the existing trigger `offers_queue_push` (`029_offer_push_trigger.sql`) inserts the notification on the transition to `published`, with `idempotency_key = 'offer:' || id` and `ON CONFLICT DO NOTHING`. A withdraw followed by a publish, a repeated request and two simultaneous publishes therefore insert one row. A future `valid_from` becomes `not_before`, so the notification is held until the offer starts. The dispatcher re-checks `VISIBLE_OFFER` and sends at most once per device (feature 011).
- **Rule for the code**: merchant publishing must **not** queue a notification itself. Application code that did would create a second path outside the idempotency key, and `push.deliver` would send both. `publish` only sets `state` and `published_at`; the trigger does the rest. The audience stays the existing `offers` audience (members who have offer notifications on, on eligible devices).
- **Consequence the owner accepted**: a merchant can announce to opted-in members by publishing. The bound is "once per offer", the member's own notification preference, and the club's ability to withdraw an offer or deactivate a store (the dispatcher cancels a notification whose offer is no longer visible).
- **Alternatives rejected**: an approval queue (not requested); a per-merchant cap on pushes (not requested; the owner chose "once per offer").

## R8. Redemption model for any account

- **Decision**: `redemptions` gains `redeemer_kind account_kind` and `redeemer_id uuid`, replacing `member_id` (backfilled with kind `member`). A `request_id uuid` (client-generated, sent in the request body) makes a retry return the original row, enforced by `UNIQUE (redeemer_kind, redeemer_id, request_id)`. `offers.per_person_limit` (NULL = unlimited, default 1) is checked in the same transaction as the `remaining` decrement, under `SELECT … FOR UPDATE` on the offer row. A trigger refuses UPDATE and DELETE (the referrals ledger pattern), and a second trigger checks the redeemer id exists in the table for its kind and is active. A merchant redeeming its own organisation's offer is refused in `application/`, because the rule needs the loaded offer.
- **Rationale**: Principle IV (exact under concurrency, retry-safe, append-only). Per-person counting uses `(offer_id, redeemer_kind, redeemer_id)`.
- **Alternatives**: Separate redemption tables per kind (four-way reports). A redemption row per unit with a counter table (no benefit here).

## R9. Landing carousel

- **Decision**: A new marker pair `<!--gwc:partners-->…<!--/gwc:partners-->` in `client/index.html` and `en.html`, filled by the server at request time with a list of active partners and merchants: logo derivative, display name, and a link only for partners that have a public page. The section is omitted when empty. The carousel is pure CSS: a horizontally scrolling row with `scroll-snap`, a slow animation that `prefers-reduced-motion` turns off, and no JavaScript.
- **Caching**: The anonymous page today is the shell byte for byte with public caching. It will now vary with data, so it keeps `public` caching with a short `max-age` of 300 s (SC-009's 5-minute bound) and **no** `Vary: Cookie`. A signed-in page stays `private, no-store` as before. `tests/seo/landing-viewer.test.ts` is extended to require the new marker pair in both shells.
- **Merchants carry no link** from the landing page, because their stores and offers are member-only content (Principle VI: nothing member-only is rendered to an unauthenticated requester). Only name and logo appear.
- **Alternatives**: A client-side carousel (violates "public pages need no JavaScript"). A static list baked into the HTML at build time (state would lag, contradicting Principle III).

## R10. Upload progress

- **Decision**: Web: reuse `upload(path, form, { onProgress })` in `client/src/lib/api.ts`, which already reports `uploading` then `processing`, and add one `UploadProgress` component used by the store, offer media and partner profile pages (`organisation/Profile.tsx` currently has none). Expo: React Native `fetch` has no upload progress, so add an `XMLHttpRequest`-based `uploadWithProgress` in `src/api/client.ts` (RN supports `xhr.upload.onprogress`), reusing the same auth, refresh-once-on-401 and request-logging behaviour. No new native module.
- **Rationale**: No new dependency means no new EAS build. Both platforms emit the same two phases, so the same strings serve both.
- **"Server upload progress"**: the request asked for the server to take part. The server cannot report bytes to the client beyond what the client's own socket sees, but it does expose the `processing → ready/failed` state through `GET /media/:id`, which the clients poll after the upload completes. That is the server's contribution, and it exists already.
- **Alternatives**: `expo-file-system` upload tasks (a native module, new build). Server-sent progress events (a new transport, out of scope).

## R11. Reports

- **Decision**: One application function `redemptionReport({ scope, filters, cursor })`. The merchant route sets `scope = { organisationId }` from the principal and ignores any id in the query. The admin route takes optional `organisationId`, `categoryId`, `from`, `to`, `offerId`. Totals (count and estimated saving where prices exist) are computed over the whole filtered set in a separate query. Rows page by keyset on `(redeemed_at, id)`. The redeemer is exposed as `displayName` + `redeemerKind` + `reference` only; a member shows by handle or "First L." (the `REFEREE_NAME` approach).
- **Platform report access**: module `merchant_offers`, flag `read`. Superadmin holds every grant, so it passes by the usual rule. A non-superadmin sees it only when granted explicitly (FR-022).
- **"Each individual dashboard"**: the same redemption query with a different scope: own redemptions (member/staff/partner/merchant as a redeemer), store scope (merchant), platform scope (admin).
- **Alternatives**: Separate reports per role (would drift, as the admin total must equal the sum of merchant totals — SC-007).

## R12. Reaching every account type

- **Decision**: Browse, detail, redeem and "my redemptions" are registered per audience with one controller: `/member/offers…`, `/admin/club-offers…`, `/merchant/club-offers…`, `/partner/club-offers…`. The merchant's own management routes are `/merchant/store`, `/merchant/offers…`, `/merchant/reports/redemptions`, which do not clash with the browse path.
- **Rationale**: A route has one audience by design (`10-auth`), and widening a route to several audiences would drag the organisation gates onto member traffic (the reason `/media/merchant` exists). A loop that registers the same handler under each audience keeps one rule.
- **Active**: member `status = active` and application approved or absent (existing gate); staff `active`; organisation users `status = active` with an `active` organisation.

## R13. Expo placement

- **Decision**: "Merchant offers" is not a sixth bottom tab. The Marketplace tab is the last slot and Android native tabs cap at five. It is reached from the Activity tab (which already hosts `activity/offer/[id]`) and from the Profile screen's list, with its own stack under `(member)/offers/`. Organisation users get Store, Offers and Report screens in the existing `(organisation)` group.
- **Alternatives**: Replace a tab (changes the shipped navigation). A top-level modal (loses the back stack).

## R14. Audit and seeding

- **Decision**: Audit entries (same transaction, allowlisted key `storeChange` / `categoryChange` / `offerChange`) for: store create, deactivate, reactivate; category add, rename, reorder, hide; offer publish and withdraw. Redemptions are a ledger and need no separate audit entry. The demo seed adds a store for each seeded merchant, offers in several categories, media via the existing asset seeder, and redemptions that follow the consistent-history rule: `remaining` equals the limit minus the seeded redemptions, computed in the insert. No redemption is invented beyond what a seeded fact implies. `seed/tables.ts` lists the new tables, and `redemptions` goes under the history group.

## R15. Store cover, store gallery and merchant file-size caps

- **Decision**: A store has (a) one **cover**, `stores.cover_asset_id`, which must be an **image** whose probed width and height are within 2% of 16:9 landscape, and (b) a **gallery** of at most 10 photos or videos in `store_media (store_id, asset_id, position)` with `CHECK (position BETWEEN 0 AND 9)`, the same shape as `offer_media`. The cover is not one of the 10. The ratio is the constant `STORE_COVER_ASPECT` in `@gwc/contracts/media`.
- **Ratio (confirmed 2026-11-23)**: 16:9 landscape. The request first said "9:16", which the owner corrected; a portrait image is refused as a cover.
- **Size caps**: for the **merchant** upload route only, a photo must be under 1 MiB (1,048,576 bytes) and a video under 5 MiB (5,242,880 bytes). The multipart stream is limited per call to the larger cap (`request.file({ limits: { fileSize } })`), so a 25 MB file is never buffered; after content inspection decides the kind, a photo at or above 1 MiB is refused with `media-too-large`. Member and partner uploads keep `MEDIA_MAX_BYTES` (25 MB). Constants `MERCHANT_IMAGE_MAX_BYTES` and `MERCHANT_VIDEO_MAX_BYTES` live in `@gwc/contracts/media` so the clients refuse early; the server stays the authority.
- **Clients**: web checks `File.size` and, for the cover, the decoded dimensions, before sending. The app checks the picker's `fileSize` and uses the picker's own `allowsEditing` with `aspect: [16, 9]` for the cover and a lower `quality`; **no new native module** (no `expo-image-manipulator`), so no new EAS build. A photo that is still too large after that is refused with the limit shown.
- **Alternatives**: server-side resize to fit 1 MiB (changes the "server stores what you sent, derivatives are separate" model and adds CPU on the upload path); a crop variant for the cover (new `asset_variant` value and pipeline work; a ratio check is enough for now, and the existing derivatives are served with `object-fit: cover`).

## R16. Merchant deletion of unused media (resolves analysis finding G1)

- **Decision**: add `DELETE /media/merchant/:id`, audience `merchant`, using the existing `deleteAsset` (it already checks `uploaded_by`/`uploader_kind` and calls `release` on the stored-bytes counter). The `RESTRICT` foreign keys on `offer_media`, `store_media`, `stores.cover_asset_id` and `organisation_profiles.logo_asset_id` make deleting a file in use a database error, which is mapped to 409 `media-in-use` rather than left as a 500.
- **Quota**: unchanged (per uploader, 1 GB default). Per-file caps (1 MiB / 5 MiB) bound growth to at least 200 videos per uploader, and deletion lets a merchant free space. A per-organisation quota is not introduced; revisit if several users of one organisation need a shared allowance.
- **Alternatives**: a job that removes unreferenced assets after N days (hides the cost from the merchant and races with an upload that has not been attached yet).

## R15-baseline. Baseline recorded for T001 (2026-11-23)

Run against a throwaway local PostgreSQL 16 (never the database `server/.env` points at, which is the same as `PRODUCTION_DATABASE_URL`).

- **Server**: `vitest run` — 173 files passed, 21 failed; 1,855 tests passed, 20 failed, 145 skipped. The run was slightly contaminated (a suite applies pending migrations mid-run, so 045-047 were in place for part of it). The failures sit in suites unrelated to this feature (for example `tests/resilience/timeouts.test.ts`, `tests/seed/safety.test.ts`, whose development gate in `seed-demo.ts` is commented out in the committed code).
- **Server `tsc --noEmit`**: 1,156 errors before this feature (the TypeScript migration of feature 007 is unfinished). The check for this feature is "no new errors in files it adds"; the only additions are 2 in `modules/media/routes.ts` of the same class as its 4 existing ones (bare Fastify types vs the http2 app).
- **Client**: `tsc --noEmit` clean; `test:i18n` green.
- **Migration runner**: `migrations/delete-member.sql` is a manual dev script that the runner treats as a migration and which always raises on any database other than `german_world_club`; on a fresh database it blocks `up()`. Worked around in the scratch database only (marked as applied, then moved out of the directory while testing). Not changed in the repository.

## R12-routes. Budgets and buckets chosen (T003)

Merchant reads `member-read` / `member-api`; merchant writes `member-write` / `write-heavy`; uploads and their status poll `media-upload` / `upload` and `member-read`; browse `marketplace`; redeem `member-write`; reports and admin lists `admin-read` / `admin-api`; admin writes `admin-write` / `admin-api`. No budget needed a new entry, so the "Σ outbound budgets < deadline" gate is unaffected.

## R10-note. T075 — the partner profile contract needs no change

The partner (and merchant) logo is linked by asset id through `PATCH /profile/{kind}/public`, which already exists; this feature only changes how the client sends the file and when it links it. Nothing on the server changed for it.

## R17. T083 and T088 outcomes

- **T083**: `server/ARCHITECTURE.md` and `server/README.md` do not enumerate modules or list env vars this feature touches, and the feature adds no environment variable or deployment precondition, so neither changed. The feature's rules are recorded in `CLAUDE.md`.
- **T088**: `bench:feed` measures the Threads hot paths; nothing this feature adds is on them. `VISIBLE_OFFER` gained a join, and its only other user, the push dispatcher, runs once per notification, not per request. Not affected; not run.
- **Landing cache (SC-009)**: the anonymous landing keeps the existing `PUBLIC_CACHE` (`max-age=300, stale-while-revalidate=86400`). A deactivated merchant is gone from the next page a fresh render produces, and a shared cache may serve one stale copy while it revalidates; the landing was already cached this way, and the strip adds no new policy.

