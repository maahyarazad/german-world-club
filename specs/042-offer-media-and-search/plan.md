# Implementation Plan: Offer Media Gallery, Fallback Image and Search

**Branch**: `042-offer-media-and-search` (not created: no branch hook is registered; create it before implementing) | **Date**: 2026-11-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/042-offer-media-and-search/spec.md`

## Summary

Four changes, delivered as four independent slices (spec US1 to US4):

1. **A gallery that fits and swipes (US1).** On the phone, `ClubOfferDetail`'s media is the wrong width because `MediaCarousel` sizes from the *window* minus a guessed inset while `FormScreen` pads by a different amount, and several items render as a 72%-wide portrait strip. A new `OfferGallery` measures **its own container**, frames 16:9 and pages one item at a time; the shared `MediaCarousel` is left alone (Threads and three other screens use it). The web gets a zero-dependency CSS scroll-snap gallery in place of the static `MediaGrid`.
2. **A fallback image (US2).** `eo_fallback.webp` is bundled with each client and shown wherever an offer's picture belongs and there is none (or it fails to load). The API stays truthful: no usable media is still `thumbnail: null` / `media: []`.
3. **Choosing the main media (US3).** "Main" already exists as `offer_media.position = 0` but nobody can see or set it, and the list and detail disagree when the first item is still processing. The lead rule becomes one SQL fragment (first *ready* item) used in the three places that copy it today. A new atomic `PUT …/main-media` serves the merchant (own offers) and a super admin (any offer), audited; the web editor and staff detail page get the control. The staff detail page is first made reachable: the staff sidebar's "Merchant offers" tab and the marketplace-moderation tab share `/konsole/admin/angebote` and the first route wins, so the staff offers list moves to `angebote-entdecken`, the segment merchants and partners already use (research R20).
4. **Server-side search (US4).** An optional `q` on the four offers mounts and on `GET /marketplace/listings`, matching title and description case-insensitively on part of a word, every word required, `AND`ed after visibility, backed by `pg_trgm` partial GIN indexes. Order and cursors are unchanged. The logger and the app's request log mask `q`. The web Marketplace gains paging, which it never had.

No table, column or native module is added, so **no new EAS build** is needed for the app. One migration (indexes only), two new routes, one new query parameter, one new shared contracts module.

## Technical Context

**Language/Version**: TypeScript (strict) on Node 22; Fastify 5 with Zod route schemas; web is React 19 + Vite 8 + Tailwind 4; app is Expo SDK 57 (`expo ~57.0.24`, React Native 0.86, `expo-image ~57.0.5`, `expo-video ~57.0.4`, `@shopify/flash-list 2.0.2`).

**Primary Dependencies**: existing only: `@gwc/contracts`, `pg`, Fastify, Zod. **No new npm package.** One new PostgreSQL extension, `pg_trgm`, which ships with PostgreSQL 17 (the platform's database is `pg17-ai`).

**Storage**: PostgreSQL. Migration `049_offer_marketplace_search.sql`: `CREATE EXTENSION IF NOT EXISTS pg_trgm` and four partial GIN trigram indexes. No schema change to any table.

**Testing**: vitest for the server (`npm run -w server test`; SQL suites are `describe.skipIf(!hasDatabase)` and skip loudly without a DB), the client (`npm run -w client test`) and contracts. The **Expo app has no test runner** (only `lint` and `typecheck`), so app behaviour is covered by `typecheck`, `lint`, shared-logic tests in contracts, the fallback parity test and the quickstart's device scenarios. `tsc --noEmit` across workspaces.

**Target Platform**: Linux server; modern browsers; iOS and Android via Expo.

**Project Type**: web service + web client + mobile app, sharing `packages/contracts`.

**Performance Goals**: search first page p95 under 300 ms at 50,000 listings and 5,000 offers, with two-character and three-or-more-character terms. Detail gallery paging at the device's frame rate (native paging / CSS snap, no JS animation).

**Constraints**: a route must declare its posture or the server will not boot; queries in `application/` name their columns; the server emits no localised text; no inline style objects in the app; every list shows a loader, never a false "empty"; a client failure is logged with `console.error('<Component>.<function>', …)` and held in no state; styles in `StyleSheet.create`; strings in both catalogues; no colour literal in new CSS (`check-tokens`); `useReveal` applies to any new web success message. `expo-client/german-world-club/AGENTS.md` requires reading the v57 docs before writing app code (done for the APIs used; see research R2, R4b, R19).

**Scale/Scope**: about 5k members and 50k posts in the perf seed; each member capped at 20 listings; an offer holds at most 10 media. Changes: 2 new routes, 1 new query parameter on 5 routes, 1 migration, about 7 web files and 8 app files touched or added, 1 new contracts module.

No `NEEDS CLARIFICATION` remains. Three scope defaults need the requester's confirmation (spec, Decisions 1, 5, 6); none blocks the design.

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 (below).* Against constitution **4.0.0**.

| Principle | Verdict | How this feature meets it | Automated check |
|---|---|---|---|
| **I. One rule set, three clients** | Pass | "Usable media" and "lead media" are decided on the server (`LEAD_OFFER_ASSET`, `ready` assets only); clients render `null` as the fallback. The 16:9 ratio (`OFFER_MEDIA_ASPECT`) and the search limits (`SEARCH_*`) are in `@gwc/contracts`, not restated per client. The super-admin control is shown from the capability snapshot (display only); the server re-checks. Debounce timing is UI behaviour, not a rule. | contracts tests; `tsc --noEmit`; `main-media.test.ts` (client may not bypass) |
| **II. Declare every posture** | Pass | Both new routes declare `config.auth` (merchant; staff `merchant_offers.edit` plus a handler narrowing to super admin, the dashboard precedent). Ownership is enforced against the locked row inside the transaction and answers 404, identical to an unknown id. `q` exists only on gated routes; `/marktplatz` stays aggregate-only. Two authz-matrix rows are added. | `authz/matrix.test.ts`, `marketplace/audience.test.ts`, `offers/ownership.test.ts`, existing `verify:seo` |
| **III. Published state matches real state** | Pass | The search predicate is an `AND` after `VISIBLE_OFFER` / `state = 'active'`, and the indexes are partial on the live state, so a draft, withdrawn, expired or switched-off record cannot appear. The fallback is client rendering of the server's `null`; the API never answers with substitute content, and no URL's behaviour changes. | `offers/visibility.test.ts` and `marketplace/visibility.test.ts` extended with `q`; new counter-assertions |
| **IV. Integrity lives in the database** | Pass | The main-media change runs in one transaction under `FOR UPDATE`, the same lock the whole-set replace takes; positions stay within the table's `0..9` CHECK; the audit row is written in the same transaction; the operation is idempotent. Indexes are database objects, asserted to exist. | `main-media.test.ts` (concurrency), `search/indexes.test.ts` |
| **V. Failure explicit and bounded** | Pass | No outbound dependency; the deadline signal is passed to every query; `q` is bounded to 80 characters and 6 terms, which bounds the work a request can ask for. Existing `marketplace` / `member-read` / `admin-write` budgets are unchanged; the three boot gates (no `config.auth`; Σ outbound budgets below the deadline; a fallback for every dependency) are unaffected. | boot gates; `resilience/` suites unchanged and green |
| **VI. The server shapes what leaves it** | Pass, with one action | Queries name their columns. No contact detail enters any response. Delivery URLs are still derivatives only. The fallback is a repository asset (already WebP, 48 KB), not an upload, and every `<img>` carries explicit dimensions. **Action:** the request serializer logs `req.url` with its query string, which would write search text (possibly a name, email or number) to logs; it is masked centrally in `plugins/01-logging.ts` (and in the app's request log). | `ops/logging-redaction.test.ts` (new case); `marketplace/no-select-star.test.ts`, `offers/no-select-star.test.ts` |

**Constraints from CLAUDE.md this plan honours**: ownership refusals are 404 and indistinguishable; staff do not rewrite what a merchant or member wrote (the super admin moves an existing file to the front and nothing else); `/marktplatz` is aggregate-only; the three boot gates; `VISIBLE_OFFER` is the one visibility rule and the new `LEAD_OFFER_ASSET` is the one lead rule; server emits no localised text; every client failure goes to `console.error`; styles in `StyleSheet.create`; `useReveal` is not needed (no new success banner); the app's header actions are not touched.

**Post-design re-check**: still passes. Two tensions are recorded under Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/042-offer-media-and-search/
├── plan.md                       # This file
├── spec.md                       # User stories, FR-001..030, SC-001..009, decisions taken on the requester's behalf
├── research.md                   # R1..R19: decisions and rejected alternatives
├── data-model.md                 # No new tables; indexes, the lead rule, the main-media operation
├── quickstart.md                 # How to prove it end to end
├── checklists/requirements.md    # Spec quality checklist (all pass)
├── contracts/
│   ├── search-api.md             # `q` on five routes
│   ├── main-media-api.md         # PUT …/main-media, two doors
│   └── offer-media-ui.md         # Frame, gallery, fallback, controls, search box on both clients
└── tasks.md                      # NOT created here (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/contracts/
├── package.json                                  # + "./search" in exports
├── src/search.ts                                 # NEW  SEARCH_MIN/MAX/TERMS, searchQuerySchema
├── src/offers.ts                                 # + OFFER_MEDIA_ASPECT, q on offerListQuerySchema,
│                                                 #   setMainMediaRequestSchema, offerMediaSchema
├── src/marketplace.ts                            # + q on ListingQuery
├── src/errors.ts                                 # + OFFER_MEDIA_NOT_ATTACHED (422)
└── tests/search.test.ts                          # NEW  bounds, empty, terms

server/
├── migrations/049_offer_marketplace_search.sql   # NEW  pg_trgm + 4 partial GIN indexes
├── src/app.ts                                    # register modules/offers/staff-routes.ts
├── src/db/text-search.ts                         # NEW  terms, escaping, predicate (columns from code only)
├── src/plugins/01-logging.ts                     # mask `q` in the req serializer
├── src/modules/offers/
│   ├── application/offer.ts                      # + LEAD_OFFER_ASSET beside VISIBLE_OFFER
│   ├── application/browse.ts                     # q predicate; lead via LEAD_OFFER_ASSET
│   ├── application/offer-media.ts                # + setMainMedia (merchant and staff scopes)
│   ├── merchant-routes.ts, merchant-controller.ts# + PUT /merchant/offers/:id/main-media
│   ├── staff-routes.ts, staff-controller.ts      # NEW  PUT /admin/offers/:id/main-media (superadmin)
├── src/modules/redemptions/
│   ├── controller.ts, routes.ts                  # pass q; querystring schema from contracts
│   └── application/mine.ts, redeem.ts            # lead via LEAD_OFFER_ASSET (behaviour-neutral)
├── src/modules/marketplace/
│   ├── controller.ts                             # q into BrowseFilters; 'q' added to RESERVED
│   ├── routes.ts                                 # q on the loose querystring schema
│   └── application/browse.ts                     # q predicate
└── tests/
    ├── offers/search.test.ts                     # NEW  4 mounts, matching rules, visibility counter-assertions
    ├── offers/lead-media.test.ts                 # NEW  first ready; list == detail
    ├── offers/main-media.test.ts                 # NEW  both doors, 404/422/403, audit, concurrency
    ├── marketplace/search.test.ts                # NEW  incl. "q is not a detail filter" regression
    ├── search/indexes.test.ts                    # NEW  the four partial indexes exist
    ├── authz/matrix.test.ts                      # + 2 rows
    └── ops/logging-redaction.test.ts             # + q masked, other params kept

client/
├── src/assets/offer-fallback.webp                # MOVED from repo root, not recompressed
├── src/components/ui/SearchField.tsx             # NEW  labelled search input with clear
├── src/lib/useDebouncedValue.ts                  # NEW
├── src/offers/
│   ├── OfferGallery.tsx                          # NEW  scroll-snap, a11y, video, renderAction slot
│   ├── OfferPicture.tsx                          # NEW  16:9 frame: thumbnail or fallback; onError -> fallback
│   ├── Offers.tsx                                # search, abortable load, OfferPicture
│   ├── OfferDetail.tsx                           # OfferGallery; staff "Make main" for super admin
│   ├── Redemptions.tsx                           # (reads OFFERS_LIST_SEGMENT: staff "back" now correct)
│   └── api.ts                                    # q param; setOfferMainMediaAsStaff;
│                                                 #   OFFERS_LIST_SEGMENT.staff -> 'angebote-entdecken'
├── src/console/routes.tsx                        # staff: angebote-entdecken (+ /:id); angebote/:id redirects
├── src/console/admin/AdminLayout.tsx             # club-offers sidebar entry -> /konsole/admin/angebote-entdecken
├── src/organisation/OfferEditor.tsx, api.ts      # 16:9 tiles, Main badge, Make main; merchantApi.setMainMedia
├── src/member/Marketplace.tsx                    # search; load more (nextCursor was ignored)
├── src/i18n/de.ts, en.ts                         # new keys, both languages
└── tests/
    ├── offers/gallery.test.tsx, picture.test.tsx # NEW
    ├── offers/search.test.tsx                    # NEW  debounce, stale answer, empty vs no-results
    ├── member/marketplace-search.test.tsx        # NEW  incl. load more
    ├── organisation/main-media.test.tsx          # NEW
    ├── console/staff-offers-route.test.tsx       # NEW  /angebote-entdecken shows offers, /angebote still
    │                                             #      shows moderation (the counter-assertion)
    └── assets/fallback-parity.test.ts            # NEW  web and app files are byte-identical

expo-client/german-world-club/
├── assets/offer-fallback.webp                    # NEW  byte-identical copy
├── src/components/
│   ├── offer-gallery.tsx                         # NEW  container-measured, paged, dots
│   ├── offer-picture.tsx                         # NEW  16:9 frame: thumbnail or fallback; onError
│   ├── search-field.tsx                          # NEW
│   ├── media-carousel.tsx                        # export Item (slide renderer); behaviour unchanged
│   └── club-offers.tsx                           # search; OfferPicture; OfferGallery
├── src/hooks/use-debounced-value.ts              # NEW
├── src/app/(member)/marketplace/index.tsx        # search box outside the loading ternary
├── src/app/(organisation)/my-offer/[id].tsx      # 16:9 thumbnails (no main control)
├── src/api/endpoints.ts                          # q on clubOffersApi.list and marketplaceApi.list
├── src/api/client.ts                             # redactQuery() at each log site
└── src/i18n/de.ts, en.ts                         # new keys, both languages
```

**Structure Decision**: the existing monorepo layout, no new workspace. Server logic follows `routes.ts` / `controller.ts` / `application/`. One new shared contracts module because the search limits are needed by the server and both clients; everything else extends existing modules.

## Delivery order

The four slices share no code except the fallback asset and `OfferPicture`, so they can ship separately:

1. **US1 + US2 together** (display): the two are one component family (`OfferPicture`, `OfferGallery`) and the fallback is what an empty gallery draws. App first (the requester's "first issue"), then web.
2. **US3** (main media): the staff route fix (R20) and `LEAD_OFFER_ASSET` first, then the operation and routes, then the two web controls.
3. **US4** (search): migration and server, then contracts, then web, then app. Independent of 1 to 3.

## Complexity Tracking

> No principle is violated. Two departures from established stances are recorded because the simpler alternative was rejected on purpose.

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| A **staff write path on merchant-owned content** (`PUT /admin/offers/:id/main-media`), where staff on `merchant_offers` are otherwise read and status only (`stores/staff-routes.ts`) and marketplace moderation is "staff moderate, they do not rewrite". | The requester asked that a super admin choose the main media. | A module grant alone would extend the power to every staff account that already holds `merchant_offers.edit` for categories. The route is therefore narrowed to super admin by a handler check, limited to moving one **existing** file to the front, and audited. Full media replace for staff was rejected as the rewrite power that is not being granted. |
| A new PostgreSQL extension, `pg_trgm`. | Substring matching inside German compounds at 50,000 listings within 300 ms. | `ILIKE` without an index breaches SC-006; full-text search does not match inside compounds. Both rejected in research R11. The extension ships with PostgreSQL, is trusted, and the migration fails loudly if absent rather than degrading silently. |

## Open items for the requester

Defaults chosen; say if any is wrong:

1. **"Global search" = complete across all pages, one box per surface**, not one box over marketplace and offers together (spec Decision 1).
2. **Super admin chooses among the offer's existing media** and cannot upload or remove on a merchant's behalf (Decision 5).
3. **The main-media control is web-only**; the phone's merchant editor only gets 16:9 thumbnails (Decision 6). The server route is shared, so adding it later is small.

Not requested but folded in because the requested behaviour cannot work without them: paging on the web Marketplace (FR-027), the single lead-media rule (FR-012), masking the search text in logs (FR-025), and the staff route clash that hides the staff merchant-offers list (FR-031, R20).
