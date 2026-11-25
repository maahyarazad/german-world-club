# Implementation Plan: Merchant Stores, Categorised Offers and Redemption Reports

**Branch**: `035-merchant-store-offers` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/035-merchant-store-offers/spec.md`

## Summary

Merchants get one store per organisation, categorised offers with up to 10 ordered media items, and a redemption report. Active accounts of any kind can browse and redeem offers on web and in the Expo app. The super admin sees a platform-wide report, staff manage categories, and staff can deactivate any store with a `PUT`. Uploads show progress (including the partner profile), and the web landing pages gain a script-free carousel of partners and merchants.

Most of the foundation exists: `offers`, `redemptions`, `merchant_locations`, the media pipeline with `thumb`/`poster` derivatives, `organisation_profiles`, `/media/merchant`, and a web `upload()` helper that reports progress. The approach is to extend these rather than add parallel structures:

1. **Schema (migrations 045–047):** `stores`, `offer_categories`, `offer_media`, new benefit kinds, `offers.store_id/category_id`, and a polymorphic redeemer on `redemptions` (append-only, idempotent, limit-checked under a row lock).
2. **Server:** modules `stores/`, `offer-categories/`, extend `offers/` and add `redemptions/`. Browse and redeem routes are registered once per audience, because a route has exactly one audience.
3. **Reports:** one report query with a scope argument (one organisation, or all). The merchant route fixes the scope from the principal and the admin route takes filters.
4. **Clients:** web (console pages for merchant, member and admin), Expo (Merchant offers section plus organisation screens), and a progress-reporting upload on both.
5. **Landing carousel:** a new server-filled `<!--gwc:partners-->` marker pair in the two landing shells.
6. **Merchant media rules (decided 2026-11-23):** a wide 16:9 store cover, a store gallery of at most 10, offer media of at most 10, photos under 1 MiB and videos under 5 MiB for merchant uploads, merchant deletion of unused files, and direct publishing with one push per offer (the existing trigger, reused).

## Technical Context

**Language/Version**: TypeScript on Node 22 (server, contracts, clients); Expo SDK 58 / React Native 0.88 (app); React + Vite (web)

**Primary Dependencies**: Fastify 5, `pg`, pg-boss (existing jobs), `@fastify/multipart` (existing media routes), `@gwc/contracts`. **No new dependency**, in particular nothing native, so no new EAS build is caused by this feature.

**Storage**: PostgreSQL. New tables `stores`, `offer_categories`, `offer_media`; altered `offers`, `redemptions`. Media bytes stay in the existing media store.

**Testing**: vitest (server and client suites, SQL suites skip without a DB); `tsc --noEmit` across workspaces; `verify:seo`

**Target Platform**: Linux API server; modern browsers; iOS and Android via Expo

**Project Type**: Web service + web client + mobile app, in the existing monorepo

**Performance Goals**: Category browse and detail within the existing `member-read` budget. The report answers within the same budget at 100k redemptions. The landing carousel adds one indexed query and stays under the current landing budget.

**Constraints**: At most 10 media per offer and per store gallery, enforced by schema and by a DB bound. Merchant uploads: photo < 1 MiB, video < 5 MiB, store cover 16:9 within tolerance. One push per offer, ever. Exact redemption counts under concurrency. No original upload in any response. No contact data in any report. The landing page stays script-free. Anonymous landing stays publicly cacheable and gets no `Vary: Cookie`.

**Scale/Scope**: Hundreds of merchants, thousands of offers, up to hundreds of thousands of redemptions. Roughly 20 routes, 9 web pages, 8 app screens.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Verdict | How |
|---|---|---|
| I. One rule set, three clients | PASS | Limits (10 media, per-person limit, who may redeem, own-offer refusal, visibility) are decided in `application/`. Types and the problem codes live in `@gwc/contracts`. Clients only render server `constraints`/reasons. |
| II. Declare every posture | PASS | Every new route declares `config.auth` (audience per route). Admin routes declare module and flag. Store deactivation is `merchant_offers` + `status`. The carousel adds no route. |
| III. Published state matches real state | PASS | The carousel and offer lists are read live from state. A deactivated store disappears on the next request. Landing freshness is bounded (see R9). |
| IV. Integrity lives in the database | PASS | `UNIQUE (organisation_id)` on stores. Media position bound `0..9`. Category FK `NOT NULL`. Redemption limits under the offer row lock via the `db/counters.ts` pattern. Redemptions append-only by trigger. Idempotency by unique request id. |
| V. Failure explicit and bounded | PASS | No new outbound dependency. Thumbnail work stays in the existing queue and breakers. Routes take existing budgets. |
| VI. Server shapes what leaves it | PASS | Media goes only through the existing pipeline. Offer and carousel payloads carry derivatives only. Columns are named explicitly. Reports expose display name, account kind and reference only. |

**Automated evidence per principle (T084, recorded when the feature was implemented):**

| Principle | Check that fails the build when it is violated |
|---|---|
| I. One rule set | Shapes in `@gwc/contracts` (`stores`, `redemptions`, `offers`, `media`), `tsc --noEmit` in `client` and `expo-client`; the web and the app import `MAX_STORE_MEDIA`, `MAX_OFFER_MEDIA`, the merchant byte limits and `isWideCover` rather than restating them |
| II. Declare every posture | `tests/authz/matrix.test.ts` (every new route has a row, wrong audiences refused, the `anyStaff` exemption list grown on purpose), `tests/redemptions/report-authz.test.ts`, the boot gate on `config.auth`, new `merchant-api` and `partner-api` surfaces |
| III. Published state matches real state | `tests/offers/visibility.test.ts`, `tests/offers/browse.test.ts`, `tests/stores/deactivate.test.ts`, `tests/seo/landing-carousel.test.ts` (live read, omitted when empty) |
| IV. Integrity in the database | `tests/stores/one-per-org.test.ts` (UNIQUE), `tests/offers/media-limit.test.ts` and `tests/stores/store-media.test.ts` (position bound), `tests/redemptions/concurrency.test.ts` (row lock, 100 at once), `tests/redemptions/ledger.test.ts` (append-only, redeemer trigger, request id), `tests/offers/push-once.test.ts` (idempotency key) |
| V. Failure explicit and bounded | No new outbound dependency; existing budgets reused (research R12-routes); the carousel failing serves the page without it (`landing-carousel.test.ts`) |
| VI. Server shapes what leaves it | `tests/offers/no-select-star.test.ts`, `tests/redemptions/report-no-pii.test.ts`, `tests/media/merchant-limits.test.ts`, derivatives-only assertions in `media-limit`, `store-media`, `browse` and `landing-carousel` |

**Re-check after Phase 1 design (2026-11-23):** unchanged. The design adds no route without a posture, no unbounded set, and no member-only content on a public surface (merchants are unlinked on the landing page, R9). The one departure below is justified, and every other principle keeps an automated check (see quickstart).

**Departure to justify (Complexity Tracking):** `redemptions.member_id` cannot stay a foreign key to `members`, because any account kind may now redeem.

## Project Structure

### Documentation (this feature)

```text
specs/035-merchant-store-offers/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── api.md
└── tasks.md             # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
packages/contracts/src/
├── offers.ts            # extended: freebie/bogo kinds, categories, media, merchant offer shapes
├── stores.ts            # new: store profile, active flag, admin list
├── redemptions.ts       # new: redeem request/response, redemption list, report shapes
├── errors.ts            # new problem types
└── permissions.ts       # new module `merchant_offers`

server/migrations/
├── 045_offer_benefit_kinds.sql      # ALTER TYPE ... ADD VALUE (own file: not usable in same txn)
├── 046_merchant_stores.sql          # stores, store_media, offer_categories (+ starter rows), offer_media, offers columns
└── 047_redemptions_any_account.sql  # polymorphic redeemer, request id, append-only trigger

server/src/modules/
├── stores/              # routes.ts, controller.ts, application/ (merchant store, admin list + active)
├── offer-categories/    # routes.ts (admin CRUD + member/merchant read), application/
├── offers/              # extended: merchant CRUD + media set + publish/withdraw; browse per audience; VISIBLE_OFFER
├── media/               # extended: merchant size caps in the upload controller; DELETE /media/merchant/:id
├── redemptions/         # routes.ts, controller.ts, application/ (redeem, mine, report)
└── public/application/  # landing.ts + a partners-carousel fill (new file)

client/src/
├── organisation/        # Store.tsx, Offers.tsx, OfferEditor.tsx, Report.tsx, Profile.tsx (progress)
├── member/              # Offers.tsx, OfferDetail.tsx, Redemptions.tsx
├── console/admin/       # OfferCategories.tsx, Stores.tsx, RedemptionReport.tsx
├── components/ui/       # UploadProgress.tsx
├── i18n/                # de + en keys, one module per locale
└── index.html, en.html  # <!--gwc:partners--> marker pair

expo-client/german-world-club/src/
├── api/                 # client.ts (XHR upload with progress), endpoints.ts
├── app/(member)/offers/ # list, category, detail, redemptions (reached from Activity; not a sixth tab)
├── app/(organisation)/  # store.tsx, offers/, report.tsx, public-profile.tsx (progress)
├── components/          # upload-progress.tsx
└── i18n/                # de, en

server/src/seed/         # categories are migration data; demo stores, offers, redemptions (history rule)
server/tests/            # stores, offers, redemptions, reports, categories, landing, media-limit
```

**Structure Decision**: Follow the existing module layout (`routes.ts` + `controller.ts` + `application/`). The offer, store, category and redemption concerns are separate modules because their audiences and permissions differ. Browse and redeem share one application function and are registered per audience.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Principle IV: `redemptions.member_id` loses its FK to `members` (becomes `redeemer_kind` + `redeemer_id`) | "Any type of user can redeem" (clarified 2026-11-23) means a redeemer can be a member, staff, merchant user or partner user, which live in four tables | One nullable FK column per kind with a CHECK that exactly one is set would keep referential integrity, but redemptions are a ledger and the four-column shape makes every report join and index four-way. Instead a trigger validates that the id exists in the table for its kind at insert time, and rows are append-only afterwards, so a later dangling reference cannot arise from edits. No account row is ever deleted (members and organisations refuse DELETE by trigger). |
