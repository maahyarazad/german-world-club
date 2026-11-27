---

description: "Task list for feature 042: offer media gallery, fallback image and search"
---

# Tasks: Offer Media Gallery, Fallback Image and Search

**Input**: Design documents from `/specs/042-offer-media-and-search/`

**Prerequisites**: plan.md, spec.md, research.md (R1 to R20), data-model.md, contracts/ (`search-api.md`, `main-media-api.md`, `offer-media-ui.md`), quickstart.md

**Tests**: **Included.** The spec does not ask for TDD, but the constitution requires every principle a change touches to have an automated check that fails the build, CLAUDE.md requires every test to carry a counter-assertion (an assertion that would fail against a server that did nothing), and plan.md and quickstart section 9 list the suites. Write each test first and watch it fail. The Expo app has **no test runner** (only `lint` and `typecheck`), so Expo tasks end in those two commands and a device check.

**Organization**: grouped by user story (spec US1 to US4) so each can be built, tested and shipped alone.

## Format: `- [ ] T### [P?] [Story?] Description with file path`

- **[P]**: can run in parallel with the other [P] tasks of the same phase or group: different files, and every task it depends on is earlier in the list
- **[Story]**: US1 gallery fits and swipes, US2 fallback image, US3 main media, US4 search
- All paths are relative to the repository root `/Users/germanworldclub/Documents/sample-app`

## Conventions every task follows (from CLAUDE.md)

- Queries in `server/src/**/application/` **name their columns**; never `SELECT *`.
- A route declares `config.auth`; an undeclared posture refuses to boot.
- The server emits no localised text; problems are branched on `type`, never `detail`.
- Interface strings live in the i18n catalogues, German and English both; never hard-coded.
- A client failure is `console.error('<Component>.<function>', error instanceof ApiError ? error.problem : error)` and is held in **no** state; only a busy flag may be.
- Expo: no inline style objects (`StyleSheet.create`; theme colours through `useThemedStyles`; a value from props through `useMemo(() => makeSized(x), [x])`). Read the v57 docs before app code (T003).
- A page that has not received its data shows the loader (`PageLoader` web / `Loading` app), never nothing and never a false "empty".
- Server tests: `describe.skipIf(!hasDatabase)`, `buildAuthApp`, `resetAuthTables`, helpers in `server/tests/offers/helpers.ts` and `server/tests/marketplace/helpers.ts`.
- Run one server test file: `npm run -w server test -- tests/offers/search.test.ts`. Client: `npm run -w client test -- tests/offers/gallery.test.tsx`. Whole gate: `npm run typecheck && npm run lint`.

---

## Phase 1: Setup

**Purpose**: a branch, a go/no-go on the database extension, and the Expo docs the repo requires.

- [X] T001 Create and switch to the feature branch: `git checkout -b 042-offer-media-and-search` from `main` (no branch hook is registered). `git status` must then show only `eo_fallback.webp` and `specs/042-offer-media-and-search/` as untracked.
- [X] T002 [P] Go/no-go for search (quickstart section 1): run `psql "$DATABASE_URL" -c "SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name = 'pg_trgm';"` against the development database in `server/.env`. Expect one row. If there is none, **stop US4** and report it: the migration is meant to fail rather than ship a slow search (research R11). `DATABASE_URL` must not be the production database.
- [X] T003 [P] Read the Expo v57 pages `https://docs.expo.dev/versions/v57.0.0/sdk/image/` and `https://docs.expo.dev/versions/v57.0.0/sdk/video/` before any app task (required by `expo-client/german-world-club/AGENTS.md`). research.md R2, R4b and R19 already record what they say: `expo-image` takes `require()`d WebP on iOS and Android, `contentFit` default `cover`, `placeholder`, `recyclingKey`, `onError`, `accessibilityLabel`; `expo-video` needs one player per `VideoView`. Re-confirm those and note any difference at the top of the first app PR.

---

## Phase 2: Foundational (blocks every user story)

**Purpose**: the shared pieces more than one story uses: the 16:9 constant, the fallback artwork in both clients, the strings, the server's single "lead media" rule, and the `OfferPicture` component that draws "the picture or the fallback".

**CRITICAL**: no user story starts until this phase is done.

- [X] T004 [P] In `packages/contracts/src/offers.ts` add `export const OFFER_MEDIA_ASPECT = { width: 16, height: 9 } as const` and a doc comment on `offerListItemSchema.thumbnail` and `memberOfferSchema.media` stating that `null` / `[]` mean "no usable media; the client shows the club's fallback" (research R1, R3). Used by every picture frame in both clients, so it is defined once (FR-030).
- [X] T005 Move the fallback artwork **without recompressing it**: `mkdir -p client/src/assets && mv eo_fallback.webp client/src/assets/offer-fallback.webp`, then `cp client/src/assets/offer-fallback.webp expo-client/german-world-club/assets/offer-fallback.webp`. The repo root must no longer contain `eo_fallback.webp`. Metro already bundles `.webp` (installed `metro-config` defaults include it) and the project has no `metro.config.js`, so add no config. The web build emits it same-origin, which the CSP (`img-src 'self' data:`) allows.
- [X] T006 [P] Create `client/tests/assets/fallback-parity.test.ts`: read `client/src/assets/offer-fallback.webp` and `expo-client/german-world-club/assets/offer-fallback.webp` with `node:fs`, assert their SHA-256 digests are equal, and assert a non-empty file. Counter-assertion: the test names the two paths in its failure message so a drifted copy is obvious. Depends on T005.
- [X] T007 [P] Add the new web strings to **both** `client/src/i18n/de.ts` and `client/src/i18n/en.ts`, using the key list in `contracts/offer-media-ui.md` section 7: `clubOffers.fallbackAlt`, `clubOffers.gallery.{region,previous,next,slide,play}` (`slide` is a template with `{n}` and `{total}`), `clubOffers.search.{label,placeholder,clear,noResults}`, `clubOffers.makeMain`, `merchantOffers.{mainBadge,makeMain,mediaNone}`, `memberMarketplace.search.{label,placeholder,clear,noResults}`, `memberMarketplace.loadMore`. Run `npm run -w client test:i18n`; it must pass (it fails on a key missing in either direction).
- [X] T008 [P] Add the new app strings to **both** `expo-client/german-world-club/src/i18n/de.ts` and `en.ts`: `clubOffers.fallbackAlt`, `clubOffers.gallery.{position,play}`, `clubOffers.search.{label,placeholder,clear,noResults}`, `marketplace.search.{label,placeholder,clear,noResults}`. Match the existing `clubOffers` (line ~641 of `en.ts`) and `marketplace` blocks. Run `npm run -w expo-client/german-world-club typecheck`; `en` is typed against `de`, so a missing key fails.
- [X] T009 [P] Write `server/tests/offers/lead-media.test.ts` first (it must fail before T010). Use `merchantWithStore`, `seedOffer`, `seedReadyAsset` (its `state` option makes a `processing` asset), `redeemerFor(app, 'member')` and `CLUB_OFFERS` from `server/tests/offers/helpers.ts`; insert `offer_media (offer_id, asset_id, position)` rows directly. Cases: (a) two ready items: `GET ${CLUB_OFFERS.member}` item `thumbnail.assetId` equals `GET ${CLUB_OFFERS.member}/${id}` `media[0].assetId`; (b) **first item still `processing`**: both list and detail skip it and agree on the second item (counter-assertion: the old query took `position 0` regardless of state, so the list returned `thumbnail: null` here while the detail returned the second item); (c) the processing asset then becomes `ready` (UPDATE `assets` and insert its `thumb`/`poster` variant) and now leads both; (d) no media: `thumbnail === null` and `media` equals `[]`; (e) the redemption response's `thumbnailUrl` for case (b) is the second item's thumb, not null.
- [X] T010 Make the lead rule one definition. In `server/src/modules/offers/application/offer.ts`, beside `VISIBLE_OFFER`, export `LEAD_OFFER_ASSET`, the SQL fragment `(SELECT m.asset_id FROM offer_media m JOIN assets a ON a.id = m.asset_id AND a.state = 'ready' WHERE m.offer_id = o.id ORDER BY m.position LIMIT 1)` (research R7; scope contract in its comment: refers to alias `o`). Replace the three copies of the shorter subquery with `${LEAD_OFFER_ASSET} AS lead_asset_id` in `server/src/modules/offers/application/browse.ts` (line ~43), `server/src/modules/redemptions/application/mine.ts` (line ~40) and `server/src/modules/redemptions/application/redeem.ts` (line ~51). Run `server/tests/offers/` and `server/tests/redemptions/`; T009 now passes and nothing else changes.
- [X] T011 [P] Write `client/tests/offers/picture.test.tsx` first. Render `OfferPicture` (T012): (a) `item={null}` renders the fallback `<img>` with `width="1672"` and `height="941"` and the German `t.clubOffers.fallbackAlt` as `alt`; (b) a `MediaItem` renders its own smallest-adequate variant URL with the item's own `width`/`height` and `alt`, and **not** the fallback (counter-assertion); (c) `fireEvent.error` on that image switches it to the fallback; (d) a video item uses `posterUrl`; (e) the frame's inline `aspect-ratio` equals `16 / 9`. Use `render` inside the i18n provider the way `client/tests/components/*` do.
- [X] T012 [P] Create `client/src/offers/OfferPicture.tsx` (after T004, T005, T007): props `{ item: MediaItem | null | undefined; maxWidth?: number; className?: string; eager?: boolean }`. A wrapper `<div>` with `style={{ aspectRatio: OFFER_MEDIA_ASPECT.width / OFFER_MEDIA_ASPECT.height }}`, `overflow-hidden rounded-card`, containing one `<img className="h-full w-full object-cover">`: `src = smallestUrl(item, maxWidth ?? 640) || item.posterUrl` (reuse `smallestUrl` from `client/src/member/threads/MediaGrid.tsx`) with the item's `width`/`height`/`alt`; if `item` is null/undefined or the image fires `onError`, render `import fallbackUrl from '../assets/offer-fallback.webp'` with `width={1672} height={941}` and `alt={t.clubOffers.fallbackAlt}`. `loading="lazy"` unless `eager`. Reset the "failed" flag when `item.assetId` changes. No colour literal (`npm run -w client test:tokens`).
- [X] T013 [P] Create `expo-client/german-world-club/src/components/offer-picture.tsx` (after T004, T005, T008): props `{ item: MediaItem | null | undefined; width?: number; recyclingKey?: string }`. An `expo-image` `Image` with `contentFit="cover"` in a style from `StyleSheet.create` with `width: '100%'`, `aspectRatio: OFFER_MEDIA_ASPECT.width / OFFER_MEDIA_ASPECT.height` and the card radius. `source = { uri: imageUrl(item, width) }` (import `imageUrl` from `@/components/media-carousel`; it falls back to `posterUrl` for a video) when `item` is present and has not failed, else `require('../../assets/offer-fallback.webp')`. `accessibilityLabel` is `item.alt` or `t.clubOffers.fallbackAlt`. `onError` records the failed `assetId` in state (a flag that changes behaviour, allowed) and shows the fallback; pass `recyclingKey` through. Run `npm run -w expo-client/german-world-club typecheck` and `lint`.

**Checkpoint**: `npm run typecheck`, `npm run -w client test`, `npm run -w server test -- tests/offers tests/redemptions` pass. Any story can start.

---

## Phase 3: User Story 1 - Offer media fits the page and can be swiped (Priority: P1) 🎯 MVP

**Goal**: on an offer's detail page the media is exactly as wide as the content below it, in a 16:9 frame, paged one item at a time, on the phone first and then the web (spec US1, FR-001 to FR-007).

**Independent Test**: quickstart section 5. Open an offer with four pictures and a video: on a phone, a tablet and a narrow browser window the media's edges equal the card below; swipe/arrows/dots reach every item; one picture shows no controls; Threads, quote embeds, marketplace listing detail and the store gallery look exactly as before.

### Tests for User Story 1 (write first, watch them fail)

- [X] T014 [P] [US1] Write `client/tests/offers/gallery.test.tsx` for `OfferGallery` (T015). Cases: (a) three images render three slides, three dot buttons with `aria-current` on the first, a region with `aria-roledescription="carousel"`, previous and next buttons; (b) the next button moves the current dot to the second (stub `Element.prototype.scrollTo`, which jsdom lacks, and set `clientWidth`; CLAUDE.md feature 041 notes jsdom has no `scrollIntoView` or `matchMedia`, so the component must call them defensively); (c) ArrowRight/ArrowLeft on the focused track change the current dot; (d) **one** item renders no dots and no buttons (counter-assertion to (a)); (e) zero items renders the fallback image and no region controls; (f) a video item renders its poster and a play button, and pressing it renders a `<video>` with `muted`; moving to another slide removes the `<video>`; (g) `matchMedia('(prefers-reduced-motion: reduce)')` true makes the scroll call use `behavior: 'auto'`; (h) `renderAction` is called with the current item and its result is rendered.

### Implementation for User Story 1

- [X] T015 [US1] Create `client/src/offers/OfferGallery.tsx` (after T012, T014): props `{ media: readonly MediaItem[]; renderAction?: (item: MediaItem, index: number) => ReactNode }`. Zero items: render `<OfferPicture item={null} />` and nothing else. Otherwise a `role="region"` `aria-roledescription="carousel"` `aria-label={t.clubOffers.gallery.region}` wrapper containing a track `<div ref tabIndex={0} className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth motion-reduce:scroll-auto">` whose slides are `role="group"` `aria-label` = `fill(t.clubOffers.gallery.slide, { n, total })`, `shrink-0 w-full snap-center`, each with the 16:9 inline `aspectRatio` from `OFFER_MEDIA_ASPECT`. The current index comes from a requestAnimationFrame-throttled `onScroll` (`Math.round(scrollLeft / clientWidth)`). With two or more items show previous/next buttons (`t.clubOffers.gallery.previous/next`, disabled at the ends) and one dot `<button>` per item (`aria-label` as above, `aria-current` on the current). Left/Right keys on the track page. Programmatic paging calls `track.scrollTo?.({ left, behavior })` with `behavior: 'auto'` when reduced motion is on. Image slides use `OfferPicture`'s image path (reuse `smallestUrl`, width 1200); a video slide shows its `posterUrl` with a play `<button>` (`t.clubOffers.gallery.play`) that swaps in `<video src controls muted autoPlay playsInline poster>` and reverts when the current slide changes (mirror `VideoItem` in `client/src/member/threads/MediaGrid.tsx`). Render `renderAction?.(current, index)` below the track. No colour literal.
- [X] T016 [US1] In `client/src/offers/OfferDetail.tsx` replace `<MediaGrid media={offer.media} />` (line ~96) and its import with `<OfferGallery media={offer.media} />` (always rendered; the fallback is inside for an empty offer). Run `client/tests/member/offers.test.tsx` and fix any assertion that expected the old grid or no image for `media: []`.
- [X] T017 [P] [US1] In `expo-client/german-world-club/src/components/media-carousel.tsx` export the per-item renderer, renaming `Item` to exported `MediaSlide`, and add an optional `active?: boolean` prop (default `true`) passed to `VideoItem`, which calls `setPlaying(false)` when `active` turns false. `MediaCarousel`, `Strip`, `WideImage`, `imageUrl` and `mediaUrl` keep their behaviour and signatures: it has five callers (`post-card.tsx`, `quote-embed.tsx`, `listing-detail.tsx`, `club-offers.tsx`, and the store gallery) and Threads deliberately keeps each file's own aspect ratio (research R4b). `typecheck` must pass.
- [X] T018 [US1] Create `expo-client/german-world-club/src/components/offer-gallery.tsx` (after T013, T017): props `{ media: readonly MediaItem[] }`. Zero items: `<OfferPicture item={null} />`. Otherwise a container `View` whose width is measured with `onLayout` (never `useWindowDimensions` minus an inset: that is the root-cause bug, research R4a); `height = Math.round(width * OFFER_MEDIA_ASPECT.height / OFFER_MEDIA_ASPECT.width)`; a horizontal `ScrollView` with `pagingEnabled`, `showsHorizontalScrollIndicator={false}` and `onMomentumScrollEnd` setting the page from `contentOffset.x / width`; each page is a `View` of `width` containing `<MediaSlide item width height active={index === page} />`. With two or more items, a row of dots (the current one marked, `accessibilityLabel` from `t.clubOffers.gallery.position` with `{n}`/`{total}`). Until `width` is measured render an empty box with the 16:9 `aspectRatio` so layout does not jump. Styles in `StyleSheet.create`, sized sheets from `useMemo(() => makeSized(width), [width])`, theme colours via `useThemedStyles`. Do **not** use FlashList (its `pagingEnabled` is undocumented, research R4b).
- [X] T019 [US1] In `expo-client/german-world-club/src/components/club-offers.tsx`, in `ClubOfferDetail` replace `{offer.media.length > 0 ? <MediaCarousel media={offer.media} /> : null}` (line ~157) with `<OfferGallery media={offer.media} />`. Leave the `MediaCarousel` in `ClubStoreProfile` (store gallery) unchanged. Run `typecheck` and `lint` in the Expo workspace.
- [ ] T020 [US1] Device check, section 5 of `specs/042-offer-media-and-search/quickstart.md`, on a real iPhone, a real Android phone and a tablet or the largest simulator: edges equal the benefit card's, one item per swipe, dots, video plays muted and stops on swipe, one-picture offers show no dots, **and** Threads posts, quote embeds, marketplace listing detail and the store gallery look unchanged. Also verify `useVideoPlayer(null)` and a video inside the paged `ScrollView` on Android (research R19.1). Record results in the PR.

**Checkpoint**: US1 is shippable alone (empty offers already draw the fallback through `OfferPicture`).

---

## Phase 4: User Story 2 - The fallback image everywhere an offer's picture belongs (Priority: P1)

**Goal**: every list card and every editor tile for an offer is 16:9 and shows the fallback when there is no usable picture, on both clients, for member, merchant, partner and staff (spec US2, FR-001, FR-007, FR-008).

**Independent Test**: quickstart section 4. An offer with no media shows the fallback on its list card and detail on web and app; adding a picture replaces it; a blocked image URL shows the fallback; the merchant editor still says "no media yet".

### Tests for User Story 2

- [X] T021 [P] [US2] Write `client/tests/offers/list-picture.test.tsx` first. Reuse the fixtures and `renderConsole`/`mockCapabilityFetch`/`memberSnapshot` approach of `client/tests/member/offers.test.tsx`. Cases: (a) the offers list with `thumbnail: null` renders an `<img>` whose `src` is the fallback and whose 16:9 frame is present; (b) the same list with a thumbnail renders that thumbnail and **not** the fallback (counter-assertion); (c) a thumbnail `<img>` firing `error` swaps to the fallback; (d) the card has no `aspect-[4/3]` class any more. Run it for `kind="staff"` too (route `/konsole/admin/angebote-entdecken` exists only after T028, so use the member route here and cover staff in T027).

### Implementation for User Story 2

- [X] T022 [US2] In `client/src/offers/Offers.tsx` replace the conditional `<img … className="aspect-[4/3] …">` block (lines ~92-101) with `<OfferPicture item={offer.thumbnail} maxWidth={400} />` rendered unconditionally; drop the now-unused `smallestUrl` import. (After T012, T021.)
- [X] T023 [US2] In `client/src/organisation/OfferEditor.tsx` change the media tiles (lines ~249-255) to `<OfferPicture item={item} maxWidth={160} />` (16:9, replacing `aspect-[4/3]`) and, when `offer.media.length === 0`, show `t.merchantOffers.mediaNone` instead of the empty list; the fallback is **not** shown here as if it were a file (FR-010). The "Remove" button stays. (After T012, T007.)
- [X] T024 [US2] In `expo-client/german-world-club/src/components/club-offers.tsx`, in `ClubOffersList`'s `renderItem` replace the conditional `{item.thumbnail ? <WideImage item={item.thumbnail} /> : null}` (lines ~85-87) with `<OfferPicture item={item.thumbnail} recyclingKey={item.id} />`. Same file as T019, so do this after T019. `typecheck` and `lint`.
- [X] T025 [P] [US2] In `expo-client/german-world-club/src/app/(organisation)/my-offer/[id].tsx` replace `<WideImage item={item} />` (line ~185) in the media list with `<OfferPicture item={item} />` so each of the merchant's files is a 16:9 tile; keep the existing "no media" text and the Remove button. Do **not** add a main-media control here (spec Decision 6). Remove the `WideImage` import if it becomes unused; `WideImage` itself stays exported for `(organisation)/store.tsx`.
- [ ] T026 [US2] Device check, section 4 of `specs/042-offer-media-and-search/quickstart.md`: fallback on list card and detail for an offer with no media; airplane-mode launch still shows it; language switch changes its accessible description; web dev-tools-blocked image falls back. Record in the PR.

**Checkpoint**: US1 and US2 both work; together they satisfy the two P1 stories.

---

## Phase 5: User Story 3 - Merchant or super admin chooses the main media (Priority: P2)

**Goal**: a merchant (own offers) and a super admin (any offer) pick which existing image or video is the main one, on the web; members then see it first (spec US3, FR-012 to FR-018, FR-031).

**Independent Test**: quickstart section 6. Merchant marks the third of four pictures as main; the member list card and the first gallery slide show it. A super admin does the same from the staff "Merchant offers" tab. Plain staff gets 403, another merchant's offer 404 identical to an unknown id, a foreign asset 422.

### Make the staff offers list reachable (research R20)

- [X] T027 [P] [US3] Write `client/tests/console/staff-offers-route.test.tsx` first. With `mockCapabilityFetch(staffSnapshot({ isSuperadmin: true }), { extraRoutes })` and `renderConsole(<ConsoleRoutes />, { route })` (see `client/tests/console/admin-dashboard.test.tsx`): (a) `/konsole/admin/angebote-entdecken` renders the merchant offers list (stub `GET /admin/club-offers` and `/admin/club-offers/categories`); (b) `/konsole/admin/angebote` still renders marketplace moderation (**the counter-assertion**: it fails today in the other direction, because both share the path); (c) `/konsole/admin/angebote-entdecken/<uuid>` renders the offer detail; (d) `/konsole/admin/angebote/<uuid>` redirects to it; (e) the sidebar's "Merchant offers" link points at `/konsole/admin/angebote-entdecken` and the "Marketplace" link at `/konsole/admin/angebote`.
- [X] T028 [US3] Fix the clash. In `client/src/console/routes.tsx` (staff group, lines ~208-209) change `<Route path="angebote" element={<ClubOffers kind="staff" />} />` to `path="angebote-entdecken"` and `angebote/:id` to `angebote-entdecken/:id`, and add `<Route path="angebote/:id" element={<Navigate to="../angebote-entdecken/:id" … />} />` implemented with a small component that reads `useParams().id` so a pasted detail link survives. In `client/src/console/admin/AdminLayout.tsx` point the entry at line ~41 (`t.clubOffers.tabLabel`) to `/konsole/admin/angebote-entdecken`. In `client/src/offers/api.ts` set `OFFERS_LIST_SEGMENT.staff` to `'angebote-entdecken'` (this also corrects the "back" link in `client/src/offers/Redemptions.tsx`). Leave `/konsole/admin/angebote` as marketplace moderation. T027 passes; run `client/tests/console/marketplace-moderation.test.tsx` and `marketplace-listings.test.tsx` unchanged.

### Contracts, server tests, server

- [X] T029 [P] [US3] In `packages/contracts/src/offers.ts` add `setMainMediaRequestSchema = z.object({ assetId: z.string().uuid() })`, `offerMediaSchema = z.object({ media: z.array(mediaItemSchema) })` and their inferred types. In `packages/contracts/src/errors.ts`, next to `OFFER_MEDIA_LIMIT`, add `OFFER_MEDIA_NOT_ATTACHED: { type: \`${BASE}/offers/media-not-attached\`, title: 'That file is not part of this offer', status: 422 }`. After T004 (same file as T004).
- [X] T030 [P] [US3] Write `server/tests/offers/main-media.test.ts` first. Use `merchantWithStore`, `seedOffer`, `seedReadyAsset`, `staffWith(app, { merchant_offers: { edit: true } }, { superadmin })`, `redeemerFor`. Cases: (a) merchant `PUT /merchant/offers/:id/main-media {assetId}` for the third of three assets: 200, response `media[0].assetId` is that asset, the other two keep their relative order, `offer_media.position` is dense 0..2; (b) the member list's `thumbnail.assetId` and the detail's `media[0].assetId` are now that asset; (c) choosing the video makes the card's thumbnail that video's poster; (d) repeating the call: 200, no second `audit_log` row (idempotent); (e) one `audit_log` row per real change with `action 'offer_updated'`, `actor_kind 'merchant'` (or `'admin'` for staff), `target_id` the offer and `detail->'offerChange'->'changed'` equal to `["mainMedia"]`; (f) **another merchant's offer and an unknown uuid return byte-identical 404 status, body and headers** (compare them, as `server/tests/marketplace/ownership.test.ts` does); (g) an asset that is not on the offer: 422 `.../offers/media-not-attached` and `offer_media` unchanged; (h) super admin `PUT /admin/offers/:id/main-media`: 200 `{ media }` for an offer of any organisation; (i) **counter-assertions**: staff with `merchant_offers.edit` who is **not** a super admin gets 403 `insufficient-permission` and `offer_media` is unchanged, and a `denied` audit row exists; staff with no grant 403; a member, a partner and a merchant calling the admin route are refused; an unauthenticated call 401; (j) two concurrent calls with different assets on one offer both succeed and the final set has the same assets, none missing or duplicated; (k) a concurrent `PUT /merchant/offers/:id/media` and a main-media call do not interleave (both take the row lock). Verify it fails before T032.
- [X] T031 [P] [US3] In `server/tests/authz/matrix.test.ts` add two rows in the block that lists the merchant and staff offer routes (near lines ~295-319): `{ name: 'main media (merchant)', url: '/merchant/offers/:id/main-media', probe: \`/merchant/offers/${randomUUID()}/main-media\`, method: 'PUT', audience: 'merchant' }` and `{ name: 'main media (staff)', url: '/admin/offers/:id/main-media', probe: \`/admin/offers/${randomUUID()}/main-media\`, method: 'PUT', audience: 'staff', module: 'merchant_offers', flag: 'edit' }`. No `anyStaff` exemption.
- [X] T032 [US3] In `server/src/modules/offers/application/offer-media.ts` add `setMainMedia(app, { scope, actor, offerId, assetId })`, where `scope` is `{ organisationId: string } | { anyOrganisation: true }` and `Actor.kind` widens to `'merchant' | 'admin'`. In one `withTransaction`: `SELECT id FROM offers WHERE id = $1 [AND organisation_id = $2] FOR UPDATE` (no row: `throw forbidden(PROBLEMS.NOT_FOUND, 'No such offer.')`, exactly as `setOfferMedia`); read `SELECT asset_id FROM offer_media WHERE offer_id = $1 ORDER BY position`; not found in the list: `throw forbidden(PROBLEMS.OFFER_MEDIA_NOT_ATTACHED, …)`; already first: return the current media without writing or auditing; else `DELETE FROM offer_media WHERE offer_id = $1` and re-insert `[assetId, …the rest in order]` at positions 0..n-1 (the primary key is `(offer_id, position)`); `auditInTransaction(client, { action: 'offer_updated', outcome: 'allowed', requestId: actor.requestId, actorId: actor.id, actorKind: actor.kind, targetType: 'offer', targetId: offerId, detail: { offerChange: { changed: ['mainMedia'], assetId } } })`. Return `{ media }` built with `loadMediaItems(client, ids)` in the stored order (only ready items appear). Do not touch `offers.updated_at`. T030 turns green for cases (a) to (g), (j), (k).
- [X] T033 [US3] Merchant door: in `server/src/modules/offers/merchant-routes.ts` add `app.put('/merchant/offers/:id/main-media', { config: write, onRequest: app.guard, schema: { params: idParam, body: setMainMediaRequestSchema, response: { 200: offerMediaSchema } } }, controller.setMainMedia)` and update the file's header route list; in `server/src/modules/offers/merchant-controller.ts` add `setMainMedia` calling `setMainMedia(app, { scope: { organisationId: org(request) }, actor: actor(request), offerId: offerId(request), assetId: (request.body as { assetId: string }).assetId })`. Widen the controller's `actor` helper only if the type requires it.
- [X] T034 [US3] Staff door: create `server/src/modules/offers/staff-routes.ts` (a `fastify-plugin`, name `offer-staff-routes`, `dependencies: ['auth', 'rate-limit']`, modelled on `server/src/modules/stores/staff-routes.ts`) registering `app.put('/admin/offers/:id/main-media', { config: { auth: { audience: 'staff', module: 'merchant_offers', flag: 'edit' }, budget: 'admin-write', rateLimit: app.bucket('admin-api') }, onRequest: app.guard, schema: { params: offerIdParamSchema, body: setMainMediaRequestSchema, response: { 200: offerMediaSchema } } }, controller.setMainMedia)`. Create `server/src/modules/offers/staff-controller.ts` whose handler first does `if (!request.permissions?.isSuperadmin) { await app.auditDenial(request, { requiredPermission: 'superadmin', targetType: 'offer', targetId: id }); throw forbidden(PROBLEMS.INSUFFICIENT_PERMISSION, 'Only a super admin may choose an offer’s main media.') }` (the `admin-dashboard/controller.ts` precedent), then calls `setMainMedia` with `scope: { anyOrganisation: true }` and `actor: { id: String(request.principal!.id), kind: 'admin', requestId: request.id }`. In `server/src/app.ts` add `import offerStaffRoutes from './modules/offers/staff-routes.ts'` (beside line ~81) and `await app.register(offerStaffRoutes)` (beside line ~388). Boot must still pass; T030 (h), (i) and T031 turn green. Run `npm run -w server test -- tests/offers tests/authz`.

### Web controls

- [X] T035 [US3] In `client/src/organisation/api.ts` add to `merchantApi`, beside `setOfferMedia`: `setMainMedia: (id: string, assetId: string) => put(\`/merchant/offers/${id}/main-media\`, { assetId }) as Promise<{ media: MediaItem[] }>`. In `client/src/offers/api.ts` add a **standalone** export `setOfferMainMediaAsStaff(id, assetId)` calling `put('/admin/offers/${id}/main-media', { assetId })` (not a member of `clubOffersApi(kind)`, which would put it on the member, merchant and partner objects). Same file as T028; do it after T028.
- [X] T036 [P] [US3] Write `client/tests/organisation/main-media.test.tsx` first (model on `client/tests/organisation/store.test.tsx`): the merchant editor for an offer with three media shows one "Main" badge on the first tile and a "Make main" button on the other two; pressing it on the third sends `PUT /merchant/offers/:id/main-media` with `{ assetId }`, then the badge is on that tile and it is first; the button is disabled while the request runs; a failed request logs with `console.error` and leaves the tiles unchanged (counter-assertion); an offer with one media shows the badge and no "Make main" button.
- [X] T037 [US3] In `client/src/organisation/OfferEditor.tsx` (after T023, T035, T036): on each media tile show `t.merchantOffers.mainBadge` on the first and a `Button variant="quiet"` `t.merchantOffers.makeMain` on the others; the handler calls `merchantApi.setMainMedia(offer.id, item.assetId)`, then `setOffer({ ...offer, media: result.media })` inside a `busy` flag; catch with `console.error('OfferEditor.makeMain', err instanceof ApiError ? err.problem : err)`. No new message state.
- [X] T038 [P] [US3] Write `client/tests/offers/staff-main-media.test.tsx` first: staff detail at `/konsole/admin/angebote-entdecken/:id` with `staffSnapshot({ isSuperadmin: true })` shows `t.clubOffers.makeMain` on the current slide and pressing it sends `PUT /admin/offers/:id/main-media`; with `staffSnapshot({ grants: { merchant_offers: true } })` (not a super admin) the control is **absent** (counter-assertion; display only, the server re-checks); a member detail never shows it.
- [X] T039 [US3] In `client/src/offers/OfferDetail.tsx` (after T016, T035, T038) pass `renderAction` to `OfferGallery` only when `kind === 'staff'` and `useCapabilities().snapshot?.isSuperadmin` is true (hook from `client/src/lib/capabilities.tsx`, called above any early `return`): render a `Button variant="quiet"` `t.clubOffers.makeMain`, disabled for the item that is already first, calling `setOfferMainMediaAsStaff(offer.id, item.assetId)` and then `setOffer({ ...offer, media: result.media })`; log failures with `console.error('OfferDetail.makeMain', …)`.
- [ ] T040 [US3] Verify section 6 of `specs/042-offer-media-and-search/quickstart.md` end to end (merchant, super admin, the three `curl` counter-checks, the processing-first offer, the audit log).

**Checkpoint**: US3 works alone for merchants (T033, T035 to T037) and for super admins once T028 and T039 are in.

---

## Phase 6: User Story 4 - Search the marketplace and the merchant offers (Priority: P2)

**Goal**: an optional `q` on the four offers mounts and on `GET /marketplace/listings`, evaluated on the server over everything the requester may see, with a search box on each of the two lists on the web and in the app (spec US4, FR-019 to FR-028).

**Independent Test**: quickstart section 7. With 60 listings, a word only in the 45th's description finds it on web and app; drafts, withdrawn, expired, switched-off-store and hidden records that contain the word never appear; one-character, 81-character and seven-word searches are 400; the typed text is not in the logs.

**Prerequisite**: T002 returned a `pg_trgm` row.

### Contracts and tests (write first)

- [X] T041 [P] [US4] Create `packages/contracts/src/search.ts`: `SEARCH_MIN_LENGTH = 2`, `SEARCH_MAX_LENGTH = 80`, `SEARCH_MAX_TERMS = 6`, and `searchQuerySchema` as written in `contracts/search-api.md` (trimmed string; empty allowed and meaning "no search"; otherwise 2 to 80 characters and at most 6 whitespace-separated terms; `.optional()`). Add `"./search": "./src/search.ts"` to `exports` in `packages/contracts/package.json` (the exports are enumerated; without it `@gwc/contracts/search` does not resolve). Write `packages/contracts/tests/search.test.ts` alongside: `''` ok, `'ab'` ok, `'a'` fails, 80 chars ok, 81 fails, six terms ok, seven fail, `'  ab  '` trims to `'ab'`, `undefined` ok.
- [X] T042 [US4] In `packages/contracts/src/offers.ts` give `offerListQuerySchema` a `q: searchQuerySchema` field (import from `./search.ts`); in `packages/contracts/src/marketplace.ts` add `q?: string` (with a comment: "2 to 80 characters, at most 6 terms; searched in title and description") to `ListingQuery`. Same files as T004/T029, so after them. `npm run typecheck` passes.
- [X] T043 [P] [US4] Write `server/tests/search/text-search.test.ts` (no database needed) for the helper T048 will create: terms are split on whitespace, de-duplicated case-insensitively and capped at six; `%`, `_` and `\` are escaped; empty/whitespace input yields no predicate; the returned predicate text never contains the user's input (only `$n` placeholders), and column names come from the caller. Counter-assertion: a term like `50%` becomes the literal `%50\%%` parameter.
- [X] T044 [P] [US4] Write `server/tests/search/indexes.test.ts` (`describe.skipIf(!hasDatabase)`): query `pg_indexes` and assert the four indexes `offers_title_trgm_idx`, `offers_description_trgm_idx`, `listings_title_trgm_idx`, `listings_body_trgm_idx` exist, use `gin` with `gin_trgm_ops`, and are **partial** (`indexdef` contains `WHERE (state = 'published'` for the offers pair and `WHERE (state = 'active'` for the listings pair). It is the guard that a missing index cannot ship silently, in the spirit of `tests/marketplace/definitions.test.ts`.
- [X] T045 [P] [US4] Write `server/tests/offers/search.test.ts` first, in the style of `server/tests/offers/browse.test.ts`. Cases, each for `member` plus a `it.each` over `admin`, `merchant`, `partner` mounts (`CLUB_OFFERS`): match in title; match in description only; case-insensitive (`RAD` finds `Fahrrad`); part of a word; two words need both (an offer with only one is absent); a word split across title and description matches; combined with `?categoryId=`; `%` and `_` literal (`50%` finds `50% Rabatt` and does **not** find `500 Rabatt`); `q=` empty returns the unfiltered list; cursor paging with `q` returns a stable second page; **visibility counter-assertions**: a draft, a withdrawn, an expired, a not-yet-started offer and one in a switched-off store (`stores.active = false`) whose title contains the term are **absent** while a visible one is present; validation: `q=a`, 81 characters and seven words each answer 400 `validation-failed`. Also assert the response body of a search is shaped exactly like the unfiltered one (no new fields).
- [X] T046 [P] [US4] Write `server/tests/marketplace/search.test.ts` first, using `poster`, `seedListing`, `resetMarketplace` from `server/tests/marketplace/helpers.ts`: title match; **body-only** match; case and part-of-word; two words; combined with `category` and `mode`; `GET /marketplace/listings?q=rad` is 200 and **not** 400 "'q' is not a filter" (the regression for the `RESERVED` set); keyset cursor still pages under `q`; counter-assertions: a `draft`, a `hidden`, a `withdrawn` listing, and an `active` listing owned by a `locked` member, each containing the term, are absent; the unauthenticated request is 401; `q=a` is 400. Also assert `/marktplatz` output is unchanged by the term (aggregate counts only).
- [X] T047 [P] [US4] In `server/tests/ops/logging-redaction.test.ts` add a case following that file's existing capture approach: a request logged as `/member/offers?q=zzprivate&categoryId=abc` produces a log line whose `req.url` is `/member/offers?q=[redacted]&categoryId=abc`, and the string `zzprivate` appears nowhere in the captured output (counter-assertion: `categoryId=abc` is **still** logged). Add a second case for `/marketplace/listings?q=x%20y&mode=offer`.

### Server implementation

- [X] T048 [US4] Create `server/src/db/text-search.ts` (T043 turns green): export `searchTerms(q?: string): string[]` (trim, split on whitespace, de-duplicate case-insensitively, cap at `SEARCH_MAX_TERMS` from `@gwc/contracts/search`), `escapeLike(term)` (escape `\`, `%`, `_`; the existing precedent is `server/src/modules/marketplace/application/moderate.ts` line ~329) and `searchPredicates(q, columns, params)` which pushes one `%escaped%` value per term onto `params` and returns an array of predicates `(col1 ILIKE $n ESCAPE '\' OR col2 ILIKE $n ESCAPE '\')`, one per term, to be joined with `AND`. `columns` are SQL fragments written in code (e.g. `'o.title'`, `'o.description'`), never taken from the request; only values are parameters. Empty `q` returns `[]`.
- [X] T049 [US4] Migration `server/migrations/049_offer_marketplace_search.sql`: `CREATE EXTENSION IF NOT EXISTS pg_trgm;` then four `CREATE INDEX IF NOT EXISTS … USING gin (<col> gin_trgm_ops) WHERE state = '<live>'`: `offers_title_trgm_idx` on `offers (title)` and `offers_description_trgm_idx` on `offers (description)` with `WHERE state = 'published'`; `listings_title_trgm_idx` on `marketplace_listings (title)` and `listings_body_trgm_idx` on `marketplace_listings (body)` with `WHERE state = 'active'`. No `CONCURRENTLY` (the runner wraps each file in one transaction). Add a header comment pointing at research R11 and a note that the extension line deliberately has no fallback. Run `npm run -w server migrate`; T044 turns green.
- [X] T050 [US4] Offers: in `server/src/modules/offers/application/browse.ts` change `listVisibleOffers` to accept `q?: string`, build its parameter array incrementally (it currently passes a fixed `[categoryId, after.at, after.id]`), and `AND` the predicates from `searchPredicates(q, ['o.title', 'o.description'], params)` **after** `${VISIBLE_OFFER}` (never as an `OR` branch); ordering, `LIMIT` and the cursor stay as they are. In `server/src/modules/redemptions/controller.ts` `list`, read `q` from `request.query` and pass it. The four mounts share the handler, so no route changes are needed (the querystring schema is `offerListQuerySchema`, extended in T042). T045 turns green.
- [X] T051 [US4] Marketplace: in `server/src/modules/marketplace/controller.ts` add `'q'` to the `RESERVED` set (line ~449), read `q` in `browse`, and pass it as a new `q?: string` field of `BrowseFilters`; in `server/src/modules/marketplace/routes.ts` add `q: searchQuerySchema` to the `.loose()` querystring object of `GET /marketplace/listings` (line ~145); in `server/src/modules/marketplace/application/browse.ts` `browseListings` add `where.push(...searchPredicates(q, ['l.title', 'l.body'], params))` before `limit` is pushed to `params`. Keep `no-select-star` happy (named columns only). T046 turns green.
- [X] T052 [US4] Mask the search text in logs: in `server/src/plugins/01-logging.ts` add an exported `maskSearchQuery(url: string): string` that replaces the value of the `q` query parameter with `[redacted]` and leaves every other parameter and the path untouched, and use it in the `req` serializer (`url: maskSearchQuery(req.url)`). T047 turns green. Add a one-line comment saying why (research R15) so nobody "simplifies" it away.
- [X] T053 [US4] Run `npm run -w server test` (SQL suites need a DB) and `npm run -w server verify:seo`; both must pass, and `/marktplatz` must still be aggregate-only.

### Web

- [X] T054 [P] [US4] Create `client/src/lib/useDebouncedValue.ts` (`useDebouncedValue<T>(value: T, ms = 300): T`) and `client/src/components/ui/SearchField.tsx` (a labelled `<input type="search">` using `Field`'s styling conventions, props `{ value, onChange, label, placeholder, clearLabel }`, a clear button that appears when there is text and calls `onChange('')`). Both strings come from props, never hard-coded.
- [X] T055 [P] [US4] Write `client/tests/offers/search.test.tsx` first (style of `tests/member/offers.test.tsx`; use `vi.useFakeTimers()`): typing `pizza` sends **one** `GET /member/offers?q=pizza` after 300 ms and none before; typing one character sends nothing; clearing the box sends the unfiltered request; two overlapping searches where the first answer arrives last: the screen shows the **second** answer (counter-assertion, the stale-answer guard); an empty result shows `t.clubOffers.search.noResults` and **not** `t.clubOffers.empty`; an empty catalogue with no search shows `t.clubOffers.empty` and **not** the no-results message; a category chip click keeps the search text and re-sends both `categoryId` and `q`; the loader shows until the first answer.
- [X] T056 [P] [US4] Write `client/tests/member/marketplace-search.test.tsx` first: typing sends `GET /marketplace/listings?q=…` with the existing `category`/`mode` still applied; no-results versus empty-collection messages differ; a stale answer is ignored; with `nextCursor` set in the first page a **Load more** button (`t.memberMarketplace.loadMore`) sends `cursor` (and `q`) and appends the next page; without `nextCursor` it is absent.
- [X] T057 [US4] In `client/src/offers/api.ts` extend `clubOffersApi(kind).list` to `list(categoryId?, cursor?, q?, signal?)`, adding `q` to the existing `q()` query builder (rename that local helper to avoid confusion) and forwarding `signal` to `get`. After T028 and T035 (same file).
- [X] T058 [US4] In `client/src/offers/Offers.tsx` (after T022, T054, T055, T057): add `const [text, setText] = useState('')`, `const q = useDebouncedValue(text.trim().length >= SEARCH_MIN_LENGTH ? text.trim() : '')`, render `<SearchField>` above the category chips (always mounted, outside the `items === null` ternary), pass `q` into `load`/`loadMore` and into the `useEffect` deps, and give `load` an `AbortController` (abort the previous request and ignore its answer; `get` already takes `{ signal }`). Show `t.clubOffers.search.noResults` when `items.length === 0 && q`, else `t.clubOffers.empty`. Imports `SEARCH_MIN_LENGTH` from `@gwc/contracts/search`. The category counts stay unscoped (spec edge case).
- [X] T059 [US4] In `client/src/member/Marketplace.tsx` (after T054, T056): add the same `text`/`q` state and `<SearchField>` above the category/mode selects inside the browse `Card`; add `q` to `loadListings` params and deps (it already uses an `AbortController`); and **add paging**: keep `nextCursor` in state (it is ignored today: `setListings([...page.items])`), render a `Button` `t.memberMarketplace.loadMore` when it is set which fetches with `cursor` and appends. After `onPosted`, `loadListings()` still reloads page one. Show `t.memberMarketplace.search.noResults` when a search returns nothing, else `t.memberMarketplace.empty`. Run `client/tests/member/marketplace-search.test.tsx` and the existing marketplace suites.

### App

- [X] T060 [P] [US4] Create `expo-client/german-world-club/src/hooks/use-debounced-value.ts` (same contract as the web hook, 300 ms) and `expo-client/german-world-club/src/components/search-field.tsx`: a `TextInput` built like `TextField` in `src/components/ui.tsx` (line ~133) with `returnKeyType="search"`, `autoCapitalize="none"`, `autoCorrect={false}`, an accessibility label, a clear button when there is text, styles in `StyleSheet.create` and theme colours via `useThemedStyles`. Strings from props.
- [X] T061 [US4] In `expo-client/german-world-club/src/api/endpoints.ts` add `q` to `clubOffersApi(kind).list` (`list(categoryId?, cursor?, q?)`, through the existing `q()` helper that already drops empty values) and to `marketplaceApi.list` (add `q?: string` to its parameter object and the `q()` call; `ListingQuery.q` exists after T042).
- [X] T062 [US4] In `expo-client/german-world-club/src/api/client.ts` add a small `redactQuery(path: string)` that replaces the value of a `q=` parameter with `[redacted]`, and apply it at **every** log site that prints a path: the `console.log(\`path: ${path}\`)` line (~109), the per-request line `console.log(\`api ${method} ${path}\`, …)` (~131) and any other that interpolates `path`. Do not log `q` anywhere else (research R15, FR-025).
- [X] T063 [US4] In `expo-client/german-world-club/src/components/club-offers.tsx` `ClubOffersList` (after T024, T060, T061): add `text`/`q` state (`q` debounced, empty unless at least `SEARCH_MIN_LENGTH`), put `<SearchField>` in `ListHeaderComponent` as a **stable element** (not a function component created inline, or the input loses focus), add `keyboardShouldPersistTaps="handled"` to the `FlashList`, call `api.list(categoryId, cursor, q)` and add `q` to `usePaged`'s deps (`[categoryId, q]`; its `generation` guard already discards a superseded answer). `ListEmptyComponent`: loader while `list.loading`, then `t.clubOffers.search.noResults` if `q` else `t.clubOffers.empty`.
- [X] T064 [US4] In `expo-client/german-world-club/src/app/(member)/marketplace/index.tsx` (after T060, T061): add `text`/`q` state and render `<SearchField>` **outside and above** the `listings.loading ? <Loading /> : <FlashList …/>` ternary (inside it the input would unmount on every reload and lose focus); pass `q` to `marketplaceApi.list` and into `usePaged`'s deps; add a no-results message distinct from `t.marketplace.empty`. Run `typecheck` and `lint` in the Expo workspace.
- [X] T065 [P] [US4] Add `bench:search` beside `bench:feed` in `server/package.json` with a script modelled on the existing bench (`server/src/scripts/`): in a **scratch** database it inserts about 50,000 active listings and 5,000 published offers (development-only, refuse under `NODE_ENV=production`/`test` like `seed:perf`), then measures first-page p95 over repeated requests for a three-letter term (`rad`) and a two-letter term (`tv`) on both lists, and prints `EXPLAIN (ANALYZE, BUFFERS)` for the three-letter case. Budget: p95 under 300 ms for both (SC-006); a two-letter term cannot use the trigram index, so it is the hard case. If it misses, record the numbers in research.md R11 and raise it before shipping.
- [ ] T066 [US4] Device and browser check, section 7 of `specs/042-offer-media-and-search/quickstart.md` on web and on iOS and Android: the distinctive word found; the non-visible records never appear; partial word and case; two words; filters kept; `50%`; no-results versus empty messages; at most two requests while typing a ten-letter word; web Marketplace **Load more**; the `curl` refusals; and the privacy check (`grep -c zzprivate-needle` of the server log is 0 and the Metro console shows `q=[redacted]`).

**Checkpoint**: US4 works alone; it shares no code with US1 to US3 except the i18n keys from Phase 2.

---

## Phase 7: Polish and cross-cutting

- [X] T067 [P] Add a feature-042 paragraph to the "Things that will bite you" part of `CLAUDE.md`, in the form of the feature 037 paragraph: the **lead media rule** (`LEAD_OFFER_ASSET`, first *ready* item, one definition), the **fallback is the clients' job and the API stays truthful** (`thumbnail: null` / `media: []`), `OfferGallery` measures its container and `MediaCarousel` is Threads-only, the **`q` rules** (`RESERVED`, partial `pg_trgm` indexes, AND after visibility, terms bounds, masked in both logs, no accent folding, recency order), `PUT …/main-media` (two doors, row lock, super-admin handler check, `actor_kind` is `'admin'`), and the staff `angebote-entdecken` route. Keep it to the non-obvious rules.
- [X] T068 Run the whole automated gate and fix what fails: `npm run typecheck`, `npm run lint`, `npm run -w @gwc/contracts test`, `npm run -w server test`, `npm run -w client test`, `npm run -w client test:i18n`, `npm run -w client test:tokens`, `npm run -w server verify:seo`.
- [ ] T069 Re-run sections 4 to 7 of `specs/042-offer-media-and-search/quickstart.md` on a real iPhone and a real Android phone against a development build (no new native module was added, so no new EAS build is needed) and the web console in a desktop browser and a phone-width window; tick every row of the quickstart tables.
- [X] T070 Run quickstart section 8 (`npm run -w server bench:search` from T065 on a scratch database) and paste the p95 numbers and the `Bitmap Index Scan` line into the PR description.
- [X] T071 Final privacy and posture sweep: `grep -rn "SELECT \*" server/src/modules/offers server/src/modules/marketplace` finds nothing new; no route was added without `config.auth` (the server boots); `/marktplatz` and `verify:seo` unchanged; the Expo and server logs contain no search text; `eo_fallback.webp` is gone from the repo root and the two bundled copies are byte-identical (T006).

---

## Dependencies and execution order

### Phase dependencies

- **Setup (Phase 1)**: none; T002 gates US4, T003 gates every app task.
- **Foundational (Phase 2)**: needs Setup; **blocks all stories**.
- **US1 (Phase 3)** and **US2 (Phase 4)**: both need only Foundational. They touch different lines but **share two files**: `club-offers.tsx` (T019 then T024 then T063) and, for US3, `OfferDetail.tsx` (T016 then T039). Do those in the stated order.
- **US3 (Phase 5)**: needs Foundational (the lead rule T010). The merchant half (T029 to T037) needs nothing from US1/US2 except T023 (same file as T037). The super-admin half (T039) needs US1's `OfferGallery` (T015) and `OfferDetail` (T016), and T028 for reachability.
- **US4 (Phase 6)**: needs Foundational (strings T007/T008) and a green T002. No dependency on US1 to US3 except same-file ordering: `offers/api.ts` (T028, T035, T057), `Offers.tsx` (T022 then T058), `club-offers.tsx` (T019, T024, T063), `contracts/offers.ts` (T004, T029, T042).
- **Polish (Phase 7)**: after the stories you ship.

### Within a story

Tests first and failing, then contracts, then server, then clients; a server test file must go red before its implementation task and green after.

### Same-file ordering to respect

| File | Order |
|---|---|
| `packages/contracts/src/offers.ts` | T004, T029, T042 |
| `client/src/offers/api.ts` | T028, T035, T057 |
| `client/src/offers/OfferDetail.tsx` | T016, T039 |
| `client/src/offers/Offers.tsx` | T022, T058 |
| `client/src/organisation/OfferEditor.tsx` | T023, T037 |
| `expo-client/german-world-club/src/components/club-offers.tsx` | T019, T024, T063 |
| `server/src/modules/offers/application/offer-media.ts` | T032 only |

---

## Parallel opportunities

```text
Phase 2, after T004 and T005:
  T006 parity test       T007 web i18n        T008 app i18n
  T009 lead-media test   T011 picture test    (then T012 web OfferPicture, T013 app OfferPicture, T010 server)

US1:   T014 gallery test  ||  T017 export MediaSlide        (then T015 web gallery || T018 app gallery)

US3:   T027 route test || T029 contracts || T030 main-media server test || T031 matrix rows || T036 editor test || T038 staff-control test

US4:   T041 contracts search || T043 helper unit test || T044 index test || T045 offers search test
       || T046 marketplace search test || T047 logging test || T054 web hook+field || T055/T056 web tests
       || T060 app hook+field || T065 bench script
```

Different developers can take US1+US2 (display), US3 (main media) and US4 (search) at the same time once Phase 2 is merged.

---

## Implementation strategy

### MVP first (the requested "first issue")

1. Phase 1 (T001 to T003) and Phase 2 (T004 to T013).
2. Phase 3 (US1, T014 to T020): the phone's detail media now matches the width below it and swipes; the web follows. Empty offers already show the fallback through `OfferPicture`.
3. **Stop and validate** with quickstart section 5 on a device. Ship if ready.

### Incremental delivery

1. US1 then US2: the two P1 stories, display only, no server behaviour change except the unified lead rule.
2. US3: main media (a small server change, two routes, one audited operation, and the staff-route fix).
3. US4: search (the only story with a migration; needs the `pg_trgm` check T002).
4. Polish.

Each story leaves the previous ones working; none needs a new EAS build.

---

## Notes

- Never mark a task done on "it compiles". The server tasks end on their named test going green; the web tasks on their named test; the app tasks on `typecheck`, `lint` and the device check.
- Do not change `MediaCarousel`'s behaviour or aspect ratio: Threads, quote embeds, listing detail and the store gallery depend on it (T017 only exports and adds an optional prop).
- Do not add a main-media control, or any other change, to the phone's merchant editor beyond 16:9 tiles (T025); that is spec Decision 6.
- The staff marketplace page keeps its title-only filter; public pages get no search.
- Commit after each task or logical group; end commit messages with the attribution line the harness supplies.
