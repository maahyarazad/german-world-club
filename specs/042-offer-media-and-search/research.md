# Research: Offer Media Gallery, Fallback Image and Search

**Feature**: 042-offer-media-and-search | **Date**: 2026-11-27

No `NEEDS CLARIFICATION` remains. Each entry is *Decision / Rationale / Alternatives*. Facts that were checked in the repository carry a file reference; facts about Expo 57 were checked against the v57 docs, as `expo-client/german-world-club/AGENTS.md` requires, and where the docs did not settle a point it is marked **verify on device**.

---

## A. Fallback image

### R1. The fallback is applied by the clients; the API stays truthful

**Decision.** The server keeps reporting `thumbnail: null` and `media: []` for an offer with no usable media. Both clients render the bundled fallback when they receive that.

**Rationale.**
- Principle III forbids "a success response carrying fallback content", and Principle I says the server decides business rules. "Does this offer have a usable picture?" is a server fact (a media item counts only once its asset is `ready`, `loadMediaItems`); "what do we draw when it does not?" is presentation.
- The merchant editor reads `merchantOfferSchema.media` to show what the merchant has uploaded. A synthetic item there would make an offer with no photo look like it has one, and the merchant could never tell they need to add one.
- A synthetic `MediaItem` would need an `assetId` that points at no asset, breaking "every image reference is an asset with recorded dimensions".

**Alternatives rejected.**
- *Server substitutes a fake media item*: the three problems above.
- *Server hosts the fallback at a public URL and clients fetch it*: adds a public route (a posture declaration, a crawl directive and a cache policy) and makes the placeholder depend on the network, which is exactly when pictures are missing (slow connection). A bundled file appears instantly and offline.

### R2. Placement, delivery and drift protection

**Decision.** The file at the repository root (`eo_fallback.webp`, 1672 x 941, 48 KB, untracked) is moved, not recompressed:
- web: `client/src/assets/offer-fallback.webp`, imported so Vite hashes and emits it (same origin, so the CSP `img-src 'self' data:` in `plugins/02-security-headers.ts` already allows it);
- app: `expo-client/german-world-club/assets/offer-fallback.webp`, loaded with `require('../../assets/offer-fallback.webp')`, the way `main-bg-phone.png` is.

A client test compares the two files' SHA-256 so they cannot drift. Every `<img>` carries `width="1672" height="941"`, and the frame is 16:9, so there is no layout shift (Principle VI's "explicit dimensions").

**Rationale.**
- Verified: the installed Metro's default asset extensions include `webp` (`node_modules/metro-config/src/defaults/defaults.js`, line 36) and the project has no custom `metro.config.js`, so no config change is needed.
- Verified (v57 docs): `expo-image` accepts a `require()`d number as `source`, and WebP is supported on iOS, Android and web.
- 1672 x 941 is 1.7768:1 against 16:9 = 1.7778:1, a 0.1% difference, invisible under `cover` cropping.
- Principle VI's "do not serve an unoptimised original" is about *uploads*. This is an already-optimised repository asset of 48 KB, decoded once and cached (`expo-image` default `cachePolicy: 'disk'`; the browser caches a hashed file).

**Alternatives rejected.**
- *One shared file with a copy step in each build*: more moving parts than two committed copies plus a one-line test.
- *Generate a 640 px list derivative*: adds a build script and a second asset to keep in sync for a saving of a few tens of KB on a file that is fetched once. Revisit only if the memory profile on low-end Android shows the 1672 px bitmap in long lists (see R19).

### R3. Shared constants: the 16:9 ratio lives in contracts

**Decision.** `@gwc/contracts/offers` exports `OFFER_MEDIA_ASPECT = { width: 16, height: 9 } as const`. Both clients derive their frame from it (CSS `aspect-ratio`, RN `aspectRatio`). "No usable media" is not a function: it is the contract's own nullability (`thumbnail: null`, `media: []`), documented on the schemas, because the server is the single decider (R1).

**Rationale.** Principle I: a value both clients need goes in the shared package, "not in either of them". A pure helper would restate `array.length === 0`.

**Alternative rejected.** *A `fallbackOrLead()` helper in contracts*: indirection around a one-line check, and the part that matters (which items are usable) is server-side already.

---

## B. Offer media on the detail page

### R4a. Root cause of the phone's width mismatch

`MediaCarousel` (`expo-client/.../components/media-carousel.tsx`) sizes from the **window** width minus a hard-coded `inset = Spacing.three * 2`, but `FormScreen` pads its content by `Spacing.four` and caps it at `MaxContentWidth`. The two numbers cannot agree, and on a tablet the window is wider than the content column. Two further things make it look wrong: a single item takes the file's own aspect ratio (capped at 480 px high), and several items render as a `Strip` of cells at 72% of the content width with a 4:5 portrait height.

### R4b. Decision: a new `OfferGallery`, sized from its own container, built on the existing slide renderer

**Decision.** Add `components/offer-gallery.tsx` (app) and `offers/OfferGallery.tsx` (web). The app version measures **its own container** with `onLayout` and sets the frame to `width x width * 9/16`, so it equals whatever column it is placed in, with no inset to guess. It pages with a horizontal `ScrollView` with `pagingEnabled`, tracks the current page from `onMomentumScrollEnd`, and draws position dots. The existing `Item`/`VideoItem` in `media-carousel.tsx` are exported and reused, so poster-until-tapped, muted playback and the "recycled cell must not keep playing" key have one implementation.

**Rationale.**
- `MediaCarousel` has five callers (Threads posts, quote embeds, marketplace listing detail, store gallery, offer detail). Threads deliberately keeps each file's native ratio ("the list does not jump as images decode"). Changing it globally would alter four screens nobody asked about.
- At most ten items (`MAX_OFFER_MEDIA`), so list virtualisation buys nothing, and the FlashList v2 docs do not list `pagingEnabled` or `onMomentumScrollEnd` as supported props (**verify on device** if FlashList were chosen). `ScrollView` is core React Native.
- v57 `expo-video` docs: each `VideoView` needs its own player on Android (the existing `VideoItem` creates one per item, and only when playing); `useVideoPlayer(null)` is documented as a valid source (**verify on device**; the existing code already relies on it).

**Alternatives rejected.**
- *Fix only the `inset`*: the several-item strip would still be 72% wide and portrait.
- *Add a `variant="hero"` prop to `MediaCarousel`*: couples the Threads feed to the offers page and doubles its branches.
- *FlashList with `pagingEnabled`*: unverified prop, no benefit at <= 10 items.

### R5. Web gallery: zero-dependency CSS scroll-snap

**Decision.** `OfferGallery` is a `snap-x snap-mandatory` horizontally scrolling track of `aspect-video` slides. Touch and trackpad swipe come from the browser; buttons for previous/next, clickable dots and arrow-key handling cover mouse and keyboard; `motion-reduce:scroll-auto` removes the smooth scrolling. The current slide is derived from `scrollLeft / clientWidth` in a throttled scroll handler. ARIA: `role="region"`, `aria-roledescription="carousel"`, each slide `role="group"` with "n of N", dots as buttons with `aria-current`. An optional `renderAction(item, index)` slot lets the super-admin control (R12) sit on a slide without the gallery knowing about roles.

**Rationale.** `client/package.json` has no carousel or gesture library and Tailwind v4 provides `aspect-video` (16:9) and the snap utilities. CSS gives native momentum and accessibility for free.

**Alternatives rejected.** *Embla or Swiper*: a new dependency and bundle weight for a ten-item gallery. *A transform-based JS carousel*: hand-written gesture handling, the least accessible option.

### R6. A picture that fails to load shows the fallback

**Decision.** `<img onError>` on the web and `expo-image`'s `onError` in the app switch that picture to the fallback. In lists the image gets `recyclingKey={item.id}` so a recycled FlashList cell never flashes the previous offer's picture (`recyclingKey` documented for exactly this).

**Rationale.** FR-008. A 404 on a derivative (a purged variant, a lost connection) should look intentional, not broken.

---

## C. Main media

### R7. "Main" is defined once, on the server, as the first *ready* item

**Decision.** `offer_media.position = 0` already means "leads", but the list query takes the first row *regardless of the asset's state*, while the detail drops assets that are not `ready`. A merchant whose main item is a video still processing would see the fallback on the card and a *different* picture first on the detail. Define one SQL fragment, `LEAD_OFFER_ASSET`, next to `VISIBLE_OFFER` in `modules/offers/application/offer.ts`:

```sql
(SELECT m.asset_id FROM offer_media m
   JOIN assets a ON a.id = m.asset_id AND a.state = 'ready'
  WHERE m.offer_id = o.id ORDER BY m.position LIMIT 1)
```

and use it in the three places that currently repeat the shorter form: `offers/application/browse.ts`, `redemptions/application/mine.ts`, `redemptions/application/redeem.ts`.

**Rationale.** CLAUDE.md's rule for `VISIBLE_OFFER`, `ELIGIBLE_DEVICE` and `VISIBLE_POST`: a second copy is how two surfaces disagree. Three copies already exist and this feature changes the rule. Redemption lists do not render a picture in either client today (`thumbnailUrl` is unused), so for them the change is behaviour-neutral; they are unified so the rule has one home.

### R8. A dedicated atomic `main-media` operation, not "replace the whole set"

**Decision.** `PUT /merchant/offers/:id/main-media` and `PUT /admin/offers/:id/main-media`, body `{ assetId }`, one application function `setMainMedia`. In one transaction it locks the offer row (`FOR UPDATE`), reads the current ordered asset ids, refuses with `422 offers/media-not-attached` if `assetId` is not among them, and rewrites positions with that asset at 0 and the others in their existing relative order (delete and re-insert, as `setOfferMedia` already does, because the primary key is `(offer_id, position)`). Already first is a no-op that still answers 200. It writes one audit entry (`action: 'offer_updated'`, detail key `offerChange: { changed: ['mainMedia'], assetId }`, both already allowlisted). It does not touch `offers.updated_at`, matching `setOfferMedia`, so a merchant's open edit form is not made stale (FR-018). Response: `{ media: MediaItem[] }` in the new order.

**Rationale.** The existing `PUT /merchant/offers/:id/media` replaces the whole set from the client's copy. Using it for "make this one main" has a lost-update race: a stale tab would silently drop media added elsewhere. Moving one id server-side under a row lock cannot lose anything (Principle IV).

**Alternatives rejected.** *Reuse `PUT …/media` with a reordered list*: the race above. *Let staff call `PUT …/media`*: that is full rewrite power, which is exactly what is not being granted (Decision 5).

### R9. The super admin door: module posture plus a handler check

**Decision.** `PUT /admin/offers/:id/main-media` declares `auth: { audience: 'staff', module: 'merchant_offers', flag: 'edit' }`, and the handler refuses anyone whose resolved permissions are not `isSuperadmin`, calling `app.auditDenial` first and answering 403 `INSUFFICIENT_PERMISSION`. The merchant door scopes the lock query to `organisation_id = principal.organisationId`, so another merchant's offer answers the standard 404.

**Rationale.** The posture vocabulary has no "superadmin only"; the dashboard figures (feature 028, `admin-dashboard/controller.ts`) solved the same problem this way, and the resolver already bypasses module checks for a super admin (`authz/permissions.ts`). Declaring a real module and flag keeps the route inside the authz matrix (Principle II) instead of needing a new exemption. `merchant_offers.edit` is already used by `PATCH /admin/offer-categories/:id`, so no new grant vocabulary appears.

**Alternatives rejected.** *Module grant only*: any staff account that already holds `merchant_offers.edit` for categories would silently gain this power, wider than requested. *A new `superadminOnly` posture*: a platform-wide vocabulary change for one route. *Acting "as" the merchant*: impersonation, which the platform has no concept of.

### R10. Web controls

**Decision.** In `organisation/OfferEditor.tsx`, each media tile is 16:9, the leading one shows a "Main" badge, and every other tile has a "Make main" button; removing the main item leaves the next one marked (the server's order does this by itself). In `offers/OfferDetail.tsx` for `kind="staff"`, a super admin sees "Make main" on the current slide through the gallery's `renderAction` slot. Whether to *show* it follows `isSuperadmin` from the capability snapshot (`client/src/lib/capabilities.tsx`), display only; the server re-checks (Principle I). The staff detail page is only reachable once R20 is fixed.

---

## D. Search

### R11. Mechanism: `pg_trgm` GIN indexes and `ILIKE`

**Decision.** Migration `049_offer_marketplace_search.sql` runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` and creates four partial GIN indexes with `gin_trgm_ops`: `offers (title)` and `offers (description)` `WHERE state = 'published'`; `marketplace_listings (title)` and `marketplace_listings (body)` `WHERE state = 'active'`. Each partial predicate equals a literal conjunct the queries already contain (`VISIBLE_OFFER` has `o.state = 'published'`; browse has `l.state = 'active'`), so the planner can use them. A match is `col ILIKE '%term%' ESCAPE '\'`.

**Rationale.**
- The target users search a German and English corpus. German forms compounds ("Fahrradhelm"); users expect "helm" to find it. Trigram matching is language-independent and finds any substring; stemming search does not.
- Checked: the database is PostgreSQL 17 (`pg17-ai` in `docker-compose.yml`). `pg_trgm` ships with PostgreSQL and is a *trusted* extension, so a database owner can create it, as the existing migrations already do for `citext`. Quickstart step 1 checks `pg_available_extensions` before migrating.
- Migrations run one transaction per file (`db/migrate.ts`), so `CREATE INDEX CONCURRENTLY` is not available; the tables are small (tens of thousands of rows at most) and a plain `CREATE INDEX` locks writes for well under a second.
- A missing index is a silent slowdown that "looks fine until the corpus grows" (the marketplace filter code says the same and has a test, `definitions.test.ts`, asserting every filterable column has an index). So the extension is *required*, the migration fails loudly without it, and a test asserts the four indexes exist.

**Alternatives rejected.**
- *PostgreSQL full-text search (`german` config)*: stems words but does not match inside compounds, and ranks by language rules for text that is partly English. The `simple` config supports prefix but not infix matching.
- *`ILIKE` with no index*: correct, and fine at hundreds of rows, but a sequential scan of `body` (up to 8,000 characters) at 50,000 listings would breach SC-006.
- *`pg_trgm` similarity ranking / typo tolerance*: surprising results for exact-word users, and out of scope.
- *An external search engine*: a new dependency, a new outbound budget and a new failure mode (Principle V) for a corpus of this size.

**Known limit.** A trigram index cannot answer a term of fewer than three characters. A two-character term is evaluated against the partial index's rows only (live records), still bounded by the request deadline. SC-006 is measured with two-character terms too (quickstart step 6).

**Measured** (`npm run -w server bench:search -- --seed`, 2026-11-27, PostgreSQL 17.11 on a development laptop, a scratch database with 50,000 active listings and 5,000 published offers, 40 runs each; the terms are chosen to reach different plans because one easy case proves little):

| Term | Listings p95 | Offers p95 | Plan |
|---|---|---|---|
| common, 3 letters (`rad`, matches ~80% of rows) | 0.9 ms | 4.6 ms | walks the date-ordered index and stops after 21 hits; the trigram index is not needed |
| rare, about 11 rows (`bench-4242`) | 1.5 ms | 1.0 ms | `BitmapOr` of **both** trigram indexes (`listings_title_trgm_idx`, `listings_body_trgm_idx`), 0.9 ms |
| matches nothing, 4 letters (`zzzq`) | 0.5 ms | 0.7 ms | trigram index |
| **matches nothing, 2 letters (`zq`): the worst case** | **71.1 ms** | 4.5 ms | **sequential scan** of every live listing, 49 ms of execution |
| two words, common | 0.7 ms | 4.4 ms | as common |

Everything is inside the 300 ms budget. The honest reading: the trigram indexes are used and effective for any term of three or more characters, and the worst case is a two-character term that matches almost nothing, which has to examine every live row. That cost is **linear in the number of live listings**: about 71 ms at 50,000 would be roughly 280 ms at 200,000, so a marketplace growing past the low hundreds of thousands should revisit it (raise the minimum length to 3, or index a two-character prefix). Offers are cheap because there are 10x fewer of them. This is also why the measurement includes a no-match two-letter term: the first version of the benchmark used only common terms and reported 1 to 6 ms for everything, which said nothing about this.

### R12. Match rules and bounds

**Decision.** Shared constants in a new `@gwc/contracts/search` module: `SEARCH_MIN_LENGTH = 2`, `SEARCH_MAX_LENGTH = 80`, `SEARCH_MAX_TERMS = 6`, and `searchQuerySchema` (trimmed string, empty allowed and meaning "no search", otherwise 2 to 80 characters). The server splits on whitespace, de-duplicates case-insensitively, refuses more than six terms, escapes `\`, `%` and `_` in each term, and builds `(title ILIKE $a OR description ILIKE $a) AND (title ILIKE $b OR …)`. Column names come from code, never from the request; only values are parameters. The predicate is appended with `AND` **after** the visibility predicate and is never an `OR` branch of it, so a search cannot widen visibility (FR-022). One helper, `server/src/db/text-search.ts`, serves both modules.

**Rationale.** The escaping rule is not new: `marketplace/application/moderate.ts` already escapes `%` and `_` for the staff title filter; this generalises it. Bounding terms and length bounds the cost of a request (Principle V). `pg` runs the unnamed extended-protocol statement per call, so the planner sees the bound pattern and can pick the trigram index.

**Alternatives rejected.** *Accent folding with `unaccent`*: it is `STABLE`, not `IMMUTABLE`, so it cannot back an index without a wrapper function, and it maps ü to u where a German reader expects ue, so it would please neither. *"Any word" instead of "every word"*: returns more as people type more, the opposite of narrowing.

### R13. Order and paging are unchanged

**Decision.** Search adds a predicate and nothing else. Offers stay `published_at DESC, id DESC`; listings stay `created_at DESC, id DESC`; the keyset cursors are untouched.

**Rationale.** Relevance ordering needs a cursor that carries a score and a second sort key, a new cursor format on two endpoints, for a corpus where recency is what the lists already mean. A cursor from an earlier search continues the same ordering and the predicate is re-applied, so a stale cursor is harmless. *Revisit* with a two-bucket rank (title match first, then recency) if people report poor ordering.

### R14. Wiring gotchas found in the code

1. `marketplace/controller.ts` treats every query key outside `RESERVED` as a **category-specific filter**, and an unknown filter is a 400. `q` must be added to `RESERVED`, or `?q=pizza` fails with "'q' is not a filter".
2. The marketplace route's querystring schema is `.loose()` and is deliberately permissive (a comment explains why). `q` is added to it as a typed field.
3. Offers browse has four mounts (`/member/offers`, `/admin/club-offers`, `/merchant/club-offers`, `/partner/club-offers`) sharing one handler set in `redemptions/routes.ts`, so one change to `offerListQuerySchema` and the controller serves all four.
4. The authz matrix, the public-surface crawl declarations and `/marktplatz` need no change: `q` exists only on gated routes, and `/marktplatz` still shows aggregate counts only.

### R15. The typed text is private and is masked where it would be logged

**Decision.**
- Server: `plugins/01-logging.ts`'s `req` serializer emits `url: req.url`, which includes the query string, so a person searching for a name, email address or phone number would have it written to every request log line. The serializer masks the value of `q` (`?q=[redacted]`), keeping the other parameters. A case is added to `tests/ops/logging-redaction.test.ts`.
- App: `src/api/client.ts` logs `path` (query string included) on every request, in two lines plus two older debug lines (`console.log(\`path: ${path}\`)`). A small `redactQuery(path)` is applied at each log site.

**Rationale.** Principle VI: redaction is configured centrally so it applies to code not yet written, and member contact details must not appear in logs. A search box is where such text gets typed.

**Residual risk (recorded, not solved here).** A reverse proxy's own access log, outside this repository, will still record the URL. If that matters, switch the search to a `POST` or move the proxy's log format; neither is in scope.

### R16. Client search plumbing

**Decision.** Both clients wait 300 ms after the last keystroke, send only when the trimmed text is empty (no search) or at least two characters, and discard superseded answers (web: an `AbortController` per request, as `Marketplace.tsx`'s `loadListings` already does, added to `Offers.tsx`; app: `usePaged`'s `generation` guard already ignores superseded reloads). The app's search box lives **outside** the `listings.loading ? <Loading/> : <FlashList/>` ternary on the Marketplace screen, because that ternary unmounts the list on every reload and a box inside it would lose focus on every keystroke. On the offers screen it goes in `ListHeaderComponent` as a stable element, with `keyboardShouldPersistTaps="handled"` so a category chip responds to the first tap while the keyboard is up. The web Marketplace gains "load more" (it ignores `nextCursor` today), because search cannot be complete if page two is unreachable. The category counts are left as the whole visible catalogue (a documented edge case).

**Alternatives rejected.** *Search on every keystroke*: a request per character, more than SC-009 allows. *Scoping the chip counts to the search*: a second request per search and a second query shape, for a number people read as "how many exist".

---

## E. Cross-cutting

### R17. Strings

All new text goes through the catalogues in both languages: web `client/src/i18n/{de,en}.ts` (parity enforced by `i18n-parity.test.ts`, hard-coded strings refused by `no-hardcoded-strings.test.ts`) and app `src/i18n/{de,en}.ts`. The server emits none (it localises nothing; problems are branched on `type`).

### R18. Tests, and what cannot be automated

Server and web are covered by vitest. **The Expo app has no test runner** (only `lint` and `typecheck`, as feature 037's plan also records), so its behaviour is covered by `typecheck`, `lint`, a parity test on the shared asset, and the quickstart's device scenarios. Pure logic that both platforms need (limits, ratio) is in contracts and tested there.

### R19. Residual risks and things to confirm on a device

1. `useVideoPlayer(null)` and several `VideoView`s inside a paged `ScrollView`: documented as valid, performance not documented. **Verify on device**, especially Android.
2. The 1672 x 941 fallback decoded in a long list: one shared cache entry, roughly 6 MB bitmap. If a low-end Android profile shows pressure, add a 640 px list derivative (R2).
3. iOS menu/overlay behaviour is unrelated, but any new control placed in the header must follow the existing `HeaderMenu`/`HeaderIconButton` rule in CLAUDE.md.
4. Proxy access logs keep the search text (R15).
5. `pg_trgm` availability on the production database (quickstart step 1).

### R20. The staff merchant-offers list is unreachable today (a prerequisite fix)

**Finding.** In `client/src/console/routes.tsx` the `/konsole/admin` group declares `path="angebote"` twice as siblings: line 197 renders the marketplace moderation page, line 208 renders `<ClubOffers kind="staff" />`. React Router ranks equal-scoring siblings by declaration order (`compareIndexes` in the installed `react-router`), so the first wins and the club-offers list can never render at that address. `console/admin/AdminLayout.tsx` makes it visible: line 16 (`marketplace_moderation`) and line 41 (`t.clubOffers.tabLabel`) both link to `/konsole/admin/angebote`. Existing tests render that URL and expect moderation (`tests/console/marketplace-moderation.test.tsx`, `marketplace-listings.test.tsx`). `OFFERS_LIST_SEGMENT.staff = 'angebote'` in `offers/api.ts` has the same wrong target, used by the "back" link in `offers/Redemptions.tsx`. Merchants and partners hit the same clash with their own offers page and already resolved it with `angebote-entdecken`.

**Decision.** Give the staff list the same segment: `OFFERS_LIST_SEGMENT.staff = 'angebote-entdecken'`; routes `angebote-entdecken` and `angebote-entdecken/:id`; the sidebar entry at `AdminLayout.tsx:41` points there; keep `angebote/:id` as a redirect to the new detail path so a pasted link survives. Marketplace moderation keeps `/konsole/admin/angebote`, so its tests are untouched.

**Rationale.** It is the established convention for this exact clash, it is a four-line change, and without it a super admin cannot reach an offer to use the control this feature adds (spec US3, FR-031).

**Alternative rejected.** *Move marketplace moderation instead*: it would break its existing tests, its sidebar `module` entry and any bookmarks of the more-used page.

**Test.** A console test renders `/konsole/admin/angebote-entdecken` as staff and expects the offers list, and `/konsole/admin/angebote` and expects moderation (the counter-assertion that proves the two no longer collide).
