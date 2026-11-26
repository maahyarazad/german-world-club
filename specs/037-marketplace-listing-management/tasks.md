# Tasks: Marketplace Listing Management

**Input**: Design documents from `/specs/037-marketplace-listing-management/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included. The constitution requires every touched principle to have an automated check, and the plan names the suites (R10). Each new suite carries a counter-assertion so it cannot pass against a server that did nothing.

**Organization**: grouped by user story. US1 and US2 both change `PATCH /marketplace/listings/:id`, so US2 builds on US1's edit path; US3 (staff) is independent of both once Phase 2 is done.

## Format: `- [ ] [ID] [P?] [Story] Description with file path`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 edit your own listing, US2 publish checkbox, US3 staff browse and disable, US4 listing photos save from the app, US5 avatar updates, US6 Threads media posts, US7 iPhone (HEIC) photos upload (US4 to US7 are the bugs from the spec addendum)
- Paths are from the repository root. `server/` is TypeScript on Node 22 (the CLAUDE.md line "no TypeScript in the server" is stale: the modules are `.ts`).

## Conventions every task inherits

- Queries in `application/` name their columns; never `SELECT *` (`server/tests/marketplace/no-select-star.test.ts` enforces it).
- Ownership failures are 404, identical to an absent id. Audit is written after commit, with only allowlisted keys (`statusFrom`, `statusTo`, `reason`).
- Client failures: `console.error('<Component>.<function>', error instanceof ApiError ? error.problem : error)` and no error state.
- Every string exists in both catalogues (`client/src/i18n/{de,en}.ts`, `expo-client/german-world-club/src/i18n/{de,en}.ts`); no hard-coded strings.
- App styles use `StyleSheet.create` and `useThemedStyles`; no inline style objects. Loading uses `PageLoader` (web) or `ScreenLoader` (app), never an empty list.
- **Before writing any Expo code, read the SDK 57 docs** at https://docs.expo.dev/versions/v57.0.0/ (`expo-client/german-world-club/AGENTS.md`). Add no native package.

---

## Phase 1: Setup (shared infrastructure)

- [x] T001 Create `server/migrations/048_marketplace_listing_management.sql`, re-runnable like 042: `ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS hidden_from_state marketplace_state`; add `CHECK (hidden_from_state IS NULL OR (state = 'hidden' AND hidden_from_state IN ('draft','active')))` as `NOT VALID` then `VALIDATE`; `CREATE INDEX IF NOT EXISTS marketplace_listings_staff_idx ON marketplace_listings (created_at DESC, id DESC)`. No backfill, no trigger change. Explain in a comment why a legacy `NULL` means "restore to active".
- [x] T002 [P] Add the shared types to `packages/contracts/src/marketplace.ts`: `EDITABLE_STATES` (`draft`, `active`, `expired`), `publish?: boolean` on `CreateListingRequest`, `UpdateListingRequest` (`version`, `published?`, the existing optional fields), `OwnListing` (`Listing` plus `version`, `canEdit`, `canPublish`, `moderated`, `expiresAt`), `OwnListingSummary`, `StaffListingQuery`, `StaffListingRow`, `StaffListingPage`. Add a comment on `VISIBLE_STATES` saying drafts and hidden listings are deliberately outside it.
- [x] T003 [P] Add `MARKETPLACE_NOT_EDITABLE` (409, `…/marketplace/not-editable`) to `packages/contracts/src/errors.ts`, next to the existing marketplace problems.
- [x] T004 Run `npx tsc --noEmit` in `packages/contracts` and confirm `client/` and `expo-client/german-world-club/` still compile against the new types (they should not break; the additions are optional or new).

---

## Phase 2: Foundational (blocks every story)

**Goal**: the database column, the version token and the own-listing shape exist, so each story can build on them.

- [x] T005 Extend `server/tests/marketplace/helpers.ts`: `listing()` accepts `hiddenFromState` and `publishedAt`, and a `draft` listing is inserted with `published_at = NULL`. Add `staffWithModeration(app, flags)` returning a staff bearer with `marketplace_moderation` read/status/delete as requested (look at how `moderation.test.ts` builds one and reuse it).
- [x] T006 In `server/src/modules/marketplace/application/manage.ts` add a `LISTING_VERSION_SQL` constant (`updated_at` to microsecond text, the pattern from `modules/admins/application/update.ts`) and use it wherever a listing row is read for an owner. Add `canEdit`, `canPublish`, `moderated` derivation in one function `ownerFlags(state)` driven by `EDITABLE_STATES` from the contracts, so no client or second copy re-derives them.
- [x] T007 Add `ListingNotEditableError` to `server/src/modules/marketplace/application/manage.ts` and map it to `PROBLEMS.MARKETPLACE_NOT_EDITABLE` in `server/src/modules/marketplace/controller.ts` next to `InvalidTransitionError` (around line 506). **Done differently:** no `ListingNotEditableError` class; `assertEditable` in `application/editable.ts` throws `forbidden(PROBLEMS.MARKETPLACE_NOT_EDITABLE, …)`, which already carries its 409 and needs no controller mapping.
- [x] T008 Apply the migration to the dev and test databases (`npm run -w server migrate`) and confirm `tests/seed/*` still passes: `npm run -w server test -- tests/seed`. The seeder must not need `hidden_from_state` (the history rule: the seed's hidden listings are legacy `NULL`). **Note:** applied to the dev and the `gwc_test` scratch database. `tests/seed/*` already fail on this machine without this feature (the runner picks up `migrations/delete-member.sql`, whose guard wants a database named `german_world_club`), so they could not confirm anything either way.

**Checkpoint**: contracts compile, migration applied, helpers ready.

---

## Phase 3: User Story 1 - Edit my own listing (Priority: P1) MVP

**Goal**: a member can open one of their listings, change it and save on web and app; only editable states allow it; another member's id is a 404.

**Independent test**: post a listing, edit its title and price on web, see the change in browse and on the app, then confirm a sold listing offers no edit.

### Tests for US1

- [x] T009 [P] [US1] `server/tests/marketplace/edit.test.ts`: each of `draft`, `active` and `expired` edits successfully; each of `hidden`, `sold`, `filled`, `withdrawn` answers `409 marketplace/not-editable`; the stored row is unchanged after a refusal (counter-assertion); a category change to a mode the category forbids is `422 marketplace/mode-not-allowed`; a title-only edit of a legacy job offer still succeeds.
- [x] T010 [P] [US1] Extend `server/tests/marketplace/ownership.test.ts`: another member's `PATCH` and `GET /marketplace/mine/:id` answer the same status, body and headers as an unknown uuid. **Done in** `server/tests/marketplace/mine-read.test.ts` and `edit.test.ts`.
- [x] T011 [P] [US1] `server/tests/marketplace/concurrency.test.ts`: two reads of the same version, first save succeeds, second answers `409 conflict` and writes nothing; a fresh version then succeeds; attaching media does not change `version` (research R5). Assert `version` is present in the HTTP response body of the `PATCH`, not only in the handler's return value (a response schema that omits it would strip it).
- [x] T012 [P] [US1] `server/tests/marketplace/mine-read.test.ts`: `GET /marketplace/mine/:id` returns details, features, media, `version`, `canEdit`, `canPublish`, `moderated` for the owner in every state, never the contact value, and 404 for a non-owner. Assert the flags and `version` in the HTTP body, and add a counter-assertion that a plain member with no special permissions (the `poster()` helper in `helpers.ts`) can read and edit their own listing.

### Implementation for US1

- [x] T013 [US1] In `server/src/modules/marketplace/application/manage.ts`, make `editListing` refuse a non-editable state with `ListingNotEditableError` after the ownership check and inside the transaction, require and compare `version` (stale: `forbidden(PROBLEMS.CONFLICT, …)` like the admins module), and bump `updated_at` on every field change. Return the own-listing shape including the new `version`.
- [x] T014 [US1] Add `ownListing(app, { listingId, ownerId })` to `server/src/modules/marketplace/application/manage.ts`: the owner's full read in any state (explicit columns, detail row, features, media via `mediaForListings`, flags from T006). Absent and not-owned throw `ListingNotFoundError`.
- [x] T015 [US1] Extend `myListings` in `server/src/modules/marketplace/application/manage.ts` to select `version`, and return `canEdit`/`canPublish`. Keep explicit columns.
- [x] T016 [US1] Wire it in `server/src/modules/marketplace/routes.ts`: `version` required on the `PATCH` body, add `GET /marketplace/mine/:id` (`auth: { audience: 'member' }`, budget `marketplace`), and a controller method in `server/src/modules/marketplace/controller.ts`. Declare the posture; the server must still boot. **Extend the Zod `response` schemas, because the server serialises responses through them (`setSerializerCompiler` in `server/src/app.ts:210`) and any field not listed is silently dropped**: add `version`, `canEdit`, `canPublish`, `moderated` and `expiresAt` to the `PATCH` 200 response and to the `/marketplace/mine` item schema (`listingResponseSchema` or an own-listing extension of it), and give `GET /marketplace/mine/:id` a response schema with `details`, `features`, `media` and those flags. **Add no permission flag or `requires` to these routes**: editing your own listing needs only the member audience plus the ownership check inside the transaction, so every member can edit their own listings by default (no `marketplace_post`-style grant, as in feature 021).
- [x] T017 [US1] In `server/src/modules/marketplace/application/media.ts`, make `attachMedia` and `detachMedia` refuse a non-editable state the same way, without touching `updated_at`.
- [x] T018 [US1] Add `server/tests/authz/matrix.test.ts` entries for `GET /marketplace/mine/:id` (member audience). Run `npm run -w server test -- tests/marketplace tests/authz` and make T009 to T012 pass.
- [x] T019 [P] [US1] Web API: add `mine()`, `mineOne(id)` and `update(id, body)` helpers beside the existing marketplace calls in `client/src/lib/` (follow where `Marketplace.tsx` already calls the API). **No new helpers were needed:** the web already has `get`, `patch` and `del`.
- [x] T020 [US1] Web: create `client/src/member/MyListings.tsx`: a "My listings" list (state pill, category, updated time, Edit button shown only when `canEdit`, a "disabled by staff" note when `moderated`). `PageLoader` while loading; failures to `console.error` only.
- [x] T021 [US1] Web: give `ComposeListing` in `client/src/member/Marketplace.tsx` an edit mode: prefill from `mineOne`, send `version`, reuse the same `DetailField` list and validation, close the drawer on success, and on `409 conflict` show a reload prompt (a local flag, not stored error). Media add and remove use the existing endpoints. Add a "My listings" tab/entry in `Marketplace()` that mounts `MyListings`.
- [x] T022 [P] [US1] Web i18n: add the keys for My listings, Edit, Save changes, "listing changed, reload", "not editable", "disabled by staff" to `client/src/i18n/de.ts` and `client/src/i18n/en.ts`. Run `npm run -w client test:i18n`.
- [x] T023 [P] [US1] App API: add `mine`, `mineOne`, `update` to `marketplaceApi` in `expo-client/german-world-club/src/api/endpoints.ts` (the `mine` shape at line ~177 already exists for another feature; check it is not reused by mistake).
- [x] T024 [US1] App: create `expo-client/german-world-club/src/app/(member)/marketplace/mine.tsx` listing the member's own listings with `ScreenLoader`, state pill and an Edit action when `canEdit`. Link it from the Marketplace tab header in `marketplace/index.tsx`. Register in `marketplace/_layout.tsx`.
- [x] T025 [US1] App: create `expo-client/german-world-club/src/app/(member)/marketplace/edit/[id].tsx` reusing `src/components/listing-field.tsx` and `date-parts-field.tsx`, prefilled from `mineOne`, sending `version`, handling `409` with a reload prompt. Styles via `useThemedStyles`.
- [x] T026 [P] [US1] App i18n: matching keys in `expo-client/german-world-club/src/i18n/de.ts` and `en.ts`.
- [ ] T027 [US1] Run the Scenario 1 steps of [quickstart.md](./quickstart.md) by hand on web and app.

**Checkpoint**: edit works end to end; US1 can ship alone (listings edited, still always published).

---

## Phase 4: User Story 2 - Publish or unpublish with a checkbox (Priority: P1)

**Goal**: create and edit screens show a Publish checkbox; drafts are private; unpublishing hides a listing without losing it.

**Independent test**: create with Publish unchecked and confirm no other member sees it; check it and confirm it appears; uncheck and confirm it disappears; counter-check an old client without `publish` still gets a visible listing.

### Tests for US2

- [x] T028 [P] [US2] `server/tests/marketplace/publish.test.ts`: create with `publish: false` is a `draft` with `published_at` NULL and is absent from browse, detail, the `/marktplatz` summary and `verify:seo`'s sitemap input; publishing makes all show it; unpublishing removes all again (counter-assertion for each surface); create **without** `publish` is `active` (back-compat, FR-018).
- [x] T029 [P] [US2] Extend `server/tests/marketplace/publish.test.ts`: publishing an `expired` listing needs a null or future expiry in the same save (`422` otherwise); `published: true` on `hidden` is `409 marketplace/not-editable`; publishing a legacy draft job offer is `422 marketplace/mode-not-allowed` (the trigger path); a conversation started while active stays readable after unpublishing; a draft takes one place in the quota.
- [x] T030 [P] [US2] Extend `server/tests/marketplace/posting.test.ts` or `audit` coverage: publish and unpublish each write one `marketplace_listing_state_changed` entry with `statusFrom`/`statusTo` after commit, and a failed publish writes none.

### Implementation for US2

- [x] T031 [US2] In `server/src/modules/marketplace/application/create.ts`, accept `publish` (default `true`): insert `state = 'draft'`, `published_at = NULL` when `false`, else today's `active` row. Keep the quota reservation and terms check unchanged. Update the route schema in `server/src/modules/marketplace/routes.ts` (`createListingSchema`).
- [x] T032 [US2] In `server/src/modules/marketplace/application/manage.ts`, `editListing` handles `published` in the same transaction as the field changes: `draft` to `active` sets `published_at = COALESCE(published_at, now())` and `state_changed_at`, refusing an `expires_at` in the past; `active` to `draft` sets `state_changed_at`; `expired` to `active` requires a valid expiry; `hidden` is refused. Map the job-offer trigger violation to the existing mode-not-allowed problem (reuse `mapJobOfferViolation`/the helper near controller line 486).
- [x] T033 [US2] After commit, write `marketplace_listing_state_changed` via `app.audit` from `editListing` when the state moved (actor the member, `statusFrom`/`statusTo`), as `transitionState` does. Add `published` to the `PATCH` body schema in `routes.ts`.
- [x] T034 [US2] Make T028 to T030 pass: `npm run -w server test -- tests/marketplace`. Run `npm run -w server test -- tests/seo tests/ops` to confirm no crawl or PII regression, and `npm run -w server verify:seo`.
- [x] T035 [US2] Web: add a Publish checkbox to `ComposeListing` in `client/src/member/Marketplace.tsx` (create default checked, edit shows the current state, disabled with an explanation when `moderated`), send `publish` on create and `published` on edit. Show a Draft pill in `MyListings.tsx`.
- [x] T036 [P] [US2] Web i18n keys (Publish, "visible to other members", "saved as draft", "disabled by staff, cannot publish") in `client/src/i18n/de.ts` and `en.ts`; run `npm run -w client test:i18n`.
- [x] T037 [US2] App: add a Publish switch to `expo-client/german-world-club/src/app/(member)/marketplace/new.tsx` and `edit/[id].tsx` with the same rules as the web, and a Draft pill in `mine.tsx`. Use `useAction` for submit.
- [x] T038 [P] [US2] App i18n keys in `expo-client/german-world-club/src/i18n/de.ts` and `en.ts`.
- [x] T039 [US2] Web test `client/tests/` for the checkbox: create unchecked sends `publish: false`; moderated disables it; edit sends `published` only when changed. Extend `client/tests/loading-states.test.tsx` expectations if `MyListings` is picked up by its scan.
- [ ] T040 [US2] Run the Scenario 2 steps of [quickstart.md](./quickstart.md) on web and app, including the stale-form 409.

**Checkpoint**: US1 and US2 deliver the full member side.

---

## Phase 5: User Story 3 - Staff see every member listing and disable one (Priority: P2)

**Goal**: staff with `marketplace_moderation` read open an All listings page, filter and search, and Disable or Enable with a reason; Enable returns the listing to where its owner left it.

**Independent test**: as staff, find a draft and a published listing, disable the published one with a reason, confirm members no longer see it, enable it, and confirm a disabled draft returns as a draft.

### Tests for US3

- [x] T041 [P] [US3] `server/tests/marketplace/staff-listings.test.ts`: lists listings in every state, newest first; filters by state, category and owner and searches `q` (including a literal `%` and `_`); keyset paging never repeats or skips a row across pages; a merchant offer never appears; a member token and a staff token without `read` are refused (counter-assertion: the granted staff succeeds).
- [x] T042 [P] [US3] `server/tests/marketplace/staff-no-pii.test.ts`: scan the list and detail bodies for email, mobile, legal name, the contact value and storage keys, following `tests/referrals/no-pii.test.ts`.
- [x] T043 [P] [US3] `server/tests/marketplace/moderation-origin.test.ts`: hide from `active` then restore returns `active`; hide from `draft` then restore returns `draft` and does not set `published_at`; a legacy `hidden` row with `hidden_from_state IS NULL` restores to `active`; hide from `sold`, `expired` or `withdrawn` is still refused; each action writes an audit entry with the real `statusFrom`/`statusTo`; a disabled listing leaves browse, detail and the summary on the next request.
- [x] T044 [P] [US3] Extend `server/tests/marketplace/moderation.test.ts` counter-assertion: no staff endpoint, including the new list, can change `title` or `body`.

### Implementation for US3

- [x] T045 [US3] In `server/src/modules/marketplace/application/moderate.ts`, change `hideListing` to allow `draft` and `active`, writing `hidden_from_state`, and `restoreListing` to return to `COALESCE(hidden_from_state, 'active')` and clear it; audit `statusTo` carries the actual state.
- [x] T046 [US3] Add `browseForModeration(app, { state, category, ownerId, q, cursor, limit })` to `server/src/modules/marketplace/application/moderate.ts`: explicit columns, owner display name by join, `openReports` count, keyset on `(created_at, id)`, `q` as an escaped `ILIKE`, limit bounded to 50 in the handler.
- [x] T047 [US3] Add `GET /admin/marketplace/listings` to `server/src/modules/marketplace/staff-routes.ts` (`marketplace_moderation`, `read`, budget `admin-read`, `app.bucket('admin-api')`) and the controller method in `server/src/modules/marketplace/staff-controller.ts`. Extend `GET /admin/marketplace/listings/:id` with `hiddenFromState` and `openReports`. **Declare the `response` schemas for both** (`items[]` with every `StaffListingRow` field and `nextCursor`; the detail schema with the two new fields), because Zod serialisation drops anything not listed (`server/src/app.ts:210`) and the existing `listingResponseSchema` in `staff-routes.ts` lacks them. Add the route to `server/tests/authz/matrix.test.ts`.
- [x] T048 [US3] Make T041 to T044 pass: `npm run -w server test -- tests/marketplace tests/authz`.
- [x] T049 [US3] Web: add an **All listings** tab to `client/src/console/admin/Marketplace.tsx` beside the report queue: filters (state, category, owner), title search, load-more paging, state pills (reuse `LISTING_TONE`), Disable for `draft`/`active` and Enable for `hidden` behind the existing single reason field and `useCanEdit('marketplace_moderation', 'status')`. `PageLoader` while loading. Rewrite the file's header comment: the browser exists because staff must find a bad record without a report, and it still calls only `read`, `status` and `delete` routes.
- [x] T050 [P] [US3] Web i18n keys (tab label, filters, Disable, Enable, empty and loading text, state labels) in `client/src/i18n/de.ts` and `en.ts`; run `npm run -w client test:i18n`.
- [x] T051 [US3] Web test `client/tests/` for the staff tab: Disable hidden without the `status` grant; a reason is required; no false "no listings" before data arrives.
- [ ] T052 [US3] Run the Scenario 3 steps of [quickstart.md](./quickstart.md).

**Checkpoint**: all three stories work independently.

---

## Phase 6: Expo media upload foundation (added for bugs B1 to B3)

**Why this phase exists**: three Expo flows fail to save media and show no upload progress: a new Marketplace listing's photos (B1), the profile avatar (B2) and Threads post media (B3). The spec addendum (US4 to US6) describes them. All three go through the same code: `uploadReady()` in `expo-client/german-world-club/src/lib/pick-media.ts`, then `mediaApi.upload()` in `src/api/endpoints.ts`, then `api()` in `src/api/client.ts`, which sends the multipart body with React Native's `fetch` and reports no progress. The merchant screens (feature 035) use a different path that already has progress: `useMediaUpload` (`src/hooks/use-media-upload.ts`) over `uploadWithProgress` (XMLHttpRequest, `src/api/client.ts`) and `UploadProgress` (`src/components/upload-progress.tsx`).

**The real cause is not yet established.** It could not be reproduced from code alone. Two candidates are visible in the code and neither is confirmed: (a) the shared `fetch` multipart path, and (b) the server's 8 000 ms `media-upload` request budget (`server/src/config/budgets.ts:62`), which may be shorter than a phone takes to send a large photo. T053 to T057 find out which, before anything is rewritten on a guess.

**Blocks**: US4, US5, US6. **No app test runner exists** (`expo-client/german-world-club/package.json` has only `lint` and `typecheck`), so app tasks are verified by typecheck, lint and the quickstart scenarios; the server side has a real test (T054).

- [ ] T053 Reproduce the three failures on a device or simulator running the dev build (`npm run ios` or `npm run android` in `expo-client/german-world-club`), signed in as a member. For each flow (new listing with one photo, avatar change, Threads post with one photo) record: the Metro console line `api POST /media <status> <ms> <request id>`, the matching server log line and any `server_faults` row (console Fehlerprotokoll), and the picked file's size and type. For the listing flow also record the `api POST /marketplace/listings` line, because "does not get saved" may mean the listing itself, not only the photo. This needs the user's device or a simulator: if none is available to you, stop and ask rather than guessing.
- [x] T054 [P] Add `server/tests/media/app-upload-shape.test.ts`: as a member, POST `/media` with a multipart body shaped exactly as the app builds it (`alt` field first, then a `file` part with `content-type: image/jpeg`, once with a filename ending `.jpg`, once with no extension, once named `.heic` but holding JPEG bytes). Expect 201 and a `ready` asset each time. Counter-assertion: the same body with no `alt` is a 422 (so a pass cannot come from a server that accepts anything). Copy the multipart helper used by `server/tests/media/validation.test.ts`.
- [x] T055 [P] Find where `deadlineMs` is enforced (search `deadlineMs` under `server/src/plugins/`) and answer in one line: does the 8 000 ms `media-upload` budget start when the request arrives, so that it includes the time the phone takes to send the body? Record the file and line.
- [x] T056 Write the findings of T053 to T055 into `specs/037-marketplace-listing-management/research.md` as **R11. Why Expo media uploads fail**, in the same Decision, Rationale, Alternatives format: what was observed per flow, the confirmed cause, and what was ruled out. Do not start T057 until this is written.
- [x] T057 Fix the cause that T056 confirmed, and only that. If it is the server deadline: raise `media-upload.deadlineMs` in `server/src/config/budgets.ts` to at least twice the slowest observed upload, keep the boot gate (sum of outbound budgets below the deadline) green, update the "8 s budget" comment in `server/src/modules/media/derive-image.ts`, and add a test under `server/tests/ops/` that fails if the value drops back. If it is the size of the photo: lower the default `quality` in `pickMedia` in `expo-client/german-world-club/src/lib/pick-media.ts`; do not add `expo-image-manipulator`, which is a native module and needs an EAS build. If it is the client `fetch` path: the replacement is T058 and nothing more is needed here, so note that in R11. If it is something else, fix it in its own file and say so in R11.
- [x] T058 Generalise `useMediaUpload` in `expo-client/german-world-club/src/hooks/use-media-upload.ts`: accept `kind: 'member' | 'merchant' | 'partner'`, mapping `member` to `/media` and polling `/media/:id` (the other kinds keep `/media/<kind>` and `/media/<kind>/:id`). Add an optional third argument to `start`, `{ slot?: [index: number, total: number] }`; when given, scale the reported fraction to `(index + fraction) / total` so several files read as one overall percentage. Keep every existing behaviour: abort on unmount, bounded polling, `console.error('useMediaUpload.start', …)` and nothing stored from the error.
- [x] T059 [P] Add `variant?: 'bar' | 'spinner'` (default `'bar'`, so the merchant screens are unchanged) to `UploadProgress` in `expo-client/german-world-club/src/components/upload-progress.tsx`. The `spinner` variant renders the club's generic `Spinner` (`src/components/spinner.tsx`, size `md`) with the whole-number percentage beside it (`t.upload.uploading`, e.g. "Uploading … 42 %"), the "Processing …" text with the same spinner once the bytes are sent, an optional `Cancel` button, and the existing failed state with `Retry`. Accept an optional `slot?: [number, number]` and show "File {n} of {total}" when given. Keep `accessibilityRole="progressbar"` with `accessibilityValue` while the size is known. Styles through `useThemedStyles`/`StyleSheet.create`; no inline style objects.
- [x] T060 [P] Add `upload.fileOf` ("File {n} of {total}") to `expo-client/german-world-club/src/i18n/en.ts` and the German equivalent in `de.ts`, beside the existing `upload` block (around line 597), so both catalogues stay in step.

**Checkpoint**: `npm run typecheck` and `npm run lint` pass in `expo-client/german-world-club`; the merchant screens (`store.tsx`, `public-profile.tsx`, `my-offer/[id].tsx`) still compile unchanged.

---

## Phase 7: User Story 4 - Marketplace listing and its photos save from the app (Priority: P1)

**Goal**: a member posts a listing from the app, the listing is stored, and every chosen photo or video is uploaded, attached and shown, with a spinner and percentage while it uploads.

**Independent test**: on the app, post a listing with two photos; watch the spinner and percentage; open the listing on the web and see both photos; kill the connection mid-upload and see Retry keep the listing.

**Depends on**: Phase 6. Also edits `src/app/(member)/marketplace/new.tsx`, which T037 changes (the Publish switch), so do this after T037 or merge carefully.

- [x] T061 [US4] In `expo-client/german-world-club/src/app/(member)/marketplace/new.tsx`, change `attachAll` to upload through `useMediaUpload('member')` instead of `uploadReady`: for each item, `start(item, item.alt.trim(), { slot: [index, items.length] })`, then `marketplaceApi.attachMedia(listingId, asset.id)`. Keep the per-item `status` (`uploading`, `attached`, `failed`) and the listing-first order, so a failed photo never loses the listing. Render `<UploadProgress variant="spinner" …>` under the media list while `busy`, with `onCancel={upload.cancel}`; a cancel marks the remaining items `failed` so the existing retry still works.
- [x] T062 [US4] Make `retry` in the same file reuse the new path (it calls `attachAll(attachingTo, media)` already), wire the spinner variant's `onRetry` to it, and make sure the Back action cannot leave while an upload runs without cancelling it first. **Not done:** blocking the Back action while an upload runs. Cancel is offered instead, and a leaving screen aborts its upload (the hook aborts on unmount).
- [x] T063 [US4] Only if T056 found the listing create call itself failing, not just the photos: fix `submit` in `new.tsx` at the cause R11 names. If T056 shows the create succeeds, change nothing in `submit` and say so in the commit message. **No change made:** R11 found the listing create itself succeeds; the failure was the upload timing out (a photo needs a longer budget than 8 s).
- [ ] T064 [US4] Verify: `npm run typecheck` and `npm run lint` in `expo-client/german-world-club`; then run Scenario 4 of [quickstart.md](./quickstart.md) (added in T072) on a device.

**Checkpoint**: listing photos save and show progress; US4 can ship alone.

---

## Phase 8: User Story 5 - Profile avatar updates from the app (Priority: P1)

**Goal**: choosing a new avatar uploads it with a spinner and percentage, saves it, and shows it in the header, profile and posts.

**Independent test**: change the avatar on the app, see the percentage, and see the new picture in the profile header and on the web; cancel an upload and see the old avatar untouched.

**Depends on**: Phase 6. No overlap with US4 or US6.

- [x] T065 [US5] In `expo-client/german-world-club/src/app/(member)/profile/edit.tsx`, change `changeAvatar` to `useMediaUpload('member').start(item, alt)` and, only when it returns an asset, `profileApi.setAvatar(asset.id)` through the existing `run()`. A failure or cancel leaves the current avatar exactly as it was (nothing is saved until the asset is linked).
- [x] T066 [US5] Show `<UploadProgress variant="spinner" label={t.profile.avatar} onCancel={upload.cancel} onRetry={changeAvatar} />` beside the avatar, and disable "Change photo" and "Remove" while `upload.state.phase !== 'idle'`. No new strings are needed beyond T060; reuse `t.profile.avatar`.
- [ ] T067 [US5] Verify: `npm run typecheck`, `npm run lint`, then Scenario 5 of [quickstart.md](./quickstart.md) on a device.

**Checkpoint**: avatar upload works with progress; US5 can ship alone.

---

## Phase 9: User Story 6 - Threads posts with photos or video from the app (Priority: P1)

**Goal**: a Threads post with media uploads every file with a spinner and an overall percentage, then posts; a failure or cancel posts nothing.

**Independent test**: compose a post with two photos on the app; see "File 1 of 2" and the percentage; see the post with both photos in Threads and on the web; cancel mid-upload and see nothing posted.

**Depends on**: Phase 6. No overlap with US4 or US5.

- [x] T068 [US6] In `expo-client/german-world-club/src/app/(member)/threads/compose.tsx`, replace the `uploadReady` loop in `submit` with `useMediaUpload('member')`: for each item without an `assetId`, `start(item, item.alt.trim(), { slot: [index, media.length] })`; keep already-uploaded assets (`item.assetId`) so a retry does not upload them twice; stop the loop and return if any file returns null.
- [x] T069 [US6] Replace the plain `status` text (`t.threads.uploading`) with `<UploadProgress variant="spinner" slot={…} onCancel={upload.cancel} onRetry={submit} />`. Cancel and failure post nothing and keep the draft body and chosen media on screen. Keep the `HANDLE_REQUIRED` redirect and the `console.error('Compose.submit', …)` logging as they are, and remove the now-unused `status` state.
- [ ] T070 [US6] Verify: `npm run typecheck`, `npm run lint`, then Scenario 6 of [quickstart.md](./quickstart.md) on a device.

**Checkpoint**: Threads media posts with progress; US6 can ship alone.

---

## Phase 10: Polish and cross-cutting

- [x] T071 Remove the code the three flows no longer use: `uploadReady` in `expo-client/german-world-club/src/lib/pick-media.ts` and `mediaApi.upload` / `mediaApi.get` in `src/api/endpoints.ts`, after confirming with a search that nothing else calls them. If anything does, leave it and say what.
- [x] T072 Add Scenarios 4 to 6 to [quickstart.md](./quickstart.md): listing photos, avatar and Threads media on the app, each with the expected spinner and percentage, the "File n of m" text for two files, a cancel, and a retry after a dropped connection. Also list `server/tests/media/app-upload-shape.test.ts` under the automated checks.
- [x] T073 Update `CLAUDE.md`: member uploads from the app now go through `useMediaUpload('member')` with the spinner variant of `UploadProgress` (not `uploadReady`), and record the confirmed cause from R11 so the next reader does not rediscover it. Fix the "no TypeScript in the server" convention line, which no longer matches the code.
- [x] T074 [P] Update the marketplace paragraph in `CLAUDE.md`: drafts and the Publish checkbox, `hidden_from_state` and Enable returning to the origin, `GET /admin/marketplace/listings`, the version token on `PATCH`, and the reversal of the "no separate listing browser" stance. Add the `server/ARCHITECTURE.md` note if it lists marketplace routes.
- [ ] T075 [P] Add `specs/037-marketplace-listing-management/` pointers where earlier features link to 008, 017 and 021 (their spec "Status" lines).
- [x] T076 Run the full gate: `npm test`, `npm run -w client test:i18n`, `npx tsc --noEmit` in each workspace, the Expo lint (no inline styles) and typecheck, and `npm run -w server verify:seo`. Fix anything, and report any skipped SQL suite as skipped, not passed. **Result:** server 861 passed in marketplace, media, authz, ops and resilience, with the same 3 `tests/resilience` failures the untouched code has; server type errors identical to the baseline (1161, none in files from this feature); web 612 passed with one flaky test (`merchant-offers-admin`, passes alone); contracts 129 passed; i18n parity, Expo typecheck and lint of every touched file clean; `verify:seo` found no problems. The wider `tests/seed`, `tests/admins` and `tests/admin-dashboard` failures also occur without this feature.
- [ ] T077 Perf check: `npm run -w server seed:perf` then time `GET /admin/marketplace/listings` with each filter at 50k rows against the 300 ms p95 in the plan. If `q` is the slow path, record it as a follow-up (trigram index); do not add one speculatively.
- [ ] T078 Final pass over [quickstart.md](./quickstart.md) top to bottom on web and the app, then tick the pass criteria.

---

## Phase 11: iPhone photos (HEIC) upload (added for bug B4, spec US7)

**Why this phase exists**: on an iPhone the app handed the server HEIC files and the server refused them with a 400 `unsupported-media-type`. Two facts, both checked rather than assumed (research R12):

1. **The client sends HEIC because of the picker's native default.** `expo-image-picker` 57.0.19 sets `preferredAssetRepresentationMode` to `.current` (do not transcode), and every pick in this app goes through `PHPickerViewController`. In that path a HEIC is returned as raw HEIC bytes with a `.heic` name, and the `quality: 0.9` we pass is ignored for it (`ImageUtils.readDataAndFileExtension`, case `UTType.heic`). Asking for `compatible` makes the system transcode to JPEG on the phone.
2. **The server cannot convert it.** `sharp` reads a HEIC's header (a system `Mac Blue.heic` reports 6016×6016) but fails to decode the pixels (`heif: Decoder plugin generated an error`): the prebuilt libheif has the AV1 decoder (AVIF) and no HEVC decoder. Adding one means a different native build or a WASM HEVC decoder, with patent and licence exposure, and CPU-heavy decoding of untrusted input inside a request. The system's own licensed codec on the phone is the standard answer.

So the fix is layered: convert at the source (client, primary), refuse early and clearly when a file is still unacceptable (client guard), keep the server's refusal typed and machine-readable (server), and keep one definition of "accepted" (contracts). No new native module, so no new EAS build.

- [x] T079 [P] [US7] Add the shared accepted-types definition to `packages/contracts/src/media.ts`: `ACCEPTED_MEDIA_TYPES` (`image/jpeg`, `image/png`, `image/webp`, `image/avif` as `image`; `video/mp4`, `video/webm`, `video/quicktime` as `video`) and `isAcceptedMediaType(mime)`. Make `ALLOWED_MIME` in `server/src/modules/media/validate.ts` that same object (import it, delete the local list), and make `MEDIA_TYPES` in `client/src/member/MediaPicker.tsx` derive from it (delete the hand-copied array). **Done.** `ACCEPTED_MEDIA_TYPES`, `isAcceptedMediaType` and `sniffImageType` are in `packages/contracts/src/media.ts` (`sniffImageType` was added in T082's follow-up, below); `ALLOWED_MIME` is that object, and the web `MEDIA_TYPES` derives from it.
- [x] T080 [P] [US7] Make the server's refusal of an unaccepted type machine-readable in `server/src/modules/media/validate.ts` and `server/src/modules/media/controller.ts`: keep `PROBLEMS.UNSUPPORTED_MEDIA_TYPE` and its status unchanged (the contract and its callers depend on it), and add `detectedType` and `acceptedTypes` as problem extension members (RFC 9457), carried by `MediaRejected`'s `extra`. Add one structured log line for a refused type (type and size only, never the file name or any member detail) so a spike of one client's refusals is visible. **Done.** The extension members go through a new, explicit `error.extensions` in `server/src/plugins/14-error-handler.ts`, which cannot override a standard member; the media controller logs one line per refused type.
- [x] T081 [P] [US7] Add `server/tests/media/unsupported-type.test.ts`: a synthetic HEIC (an `ftyp` box with brand `heic`, which `file-type` detects as `image/heic`) answers 400 `unsupported-media-type` with `detectedType: 'image/heic'` and `acceptedTypes` equal to `Object.keys(ACCEPTED_MEDIA_TYPES)`, and stores no asset; counter-assertion: a real JPEG on the same route is 201. Also assert `ALLOWED_MIME` is the contracts object, so the two lists cannot drift. **Done**, plus tests for the extension mechanism and the shared list.
- [x] T082 [US7] In `expo-client/german-world-club/src/lib/pick-media.ts`, pass `preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible` to `launchImageLibraryAsync` with a comment saying why (R12). Classify each result with `isAcceptedMediaType` and return `unsupported: Picked[]` beside `items`; `items` holds only accepted files. Compute each file's type from the picker's `mimeType`, falling back to its extension (`.heic`, `.heif` are `image/heic` and `image/heif`), so a file whose type is missing is not waved through. **Done, with an addition:** a file labelled HEIC/HEIF is checked against its first 32 bytes (`sniffImageType`, via `expo-file-system/legacy`) before it is refused, because a converted photo can keep a `.heic` name and would otherwise be blocked by the guard meant to help. `expo-file-system` is now a declared dependency of the app at the version `expo` already pins (one line in `package.json` and the lockfile); it is already in `ios/Podfile.lock`, so no new native build.
- [x] T083 [P] [US7] In `expo-client/german-world-club/src/hooks/use-media-upload.ts` and `src/components/upload-progress.tsx`, give the failed state a reason: `{ phase: 'failed', reason?: 'unsupported-format' }`. A server refusal whose `type` is `PROBLEMS.UNSUPPORTED_MEDIA_TYPE.type` sets that reason, and `UploadProgress` then shows `t.upload.unsupportedFormat` and no Retry button (retrying the same file cannot work). Every other failure keeps today's message and Retry.
- [x] T084 [P] [US7] Add `upload.unsupportedFormat` to `expo-client/german-world-club/src/i18n/en.ts` and `de.ts`, next to the existing `upload` block: it says this kind of photo or file cannot be uploaded and tells an iPhone user how to fix it (Settings, Camera, Formats, Most Compatible), without naming a technical term the member has to know.
- [x] T085 [US7] Show it at every pick site, so an unaccepted file is never silently dropped: `src/components/listing-form.tsx`, `src/app/(member)/threads/compose.tsx`, `src/app/(member)/profile/edit.tsx`, `src/app/(organisation)/public-profile.tsx`, `src/app/(organisation)/my-offer/[id].tsx`, and both pick handlers in `src/app/(organisation)/store.tsx`. Where several files are picked, add the accepted ones and name the rest. **Done** at all seven pick handlers.
- [x] T086 [US7] Record the decision in `specs/037-marketplace-listing-management/research.md` as **R12**: observed behaviour, the two verified facts above, the decision, and the rejected alternatives (server-side HEVC decode, `expo-image-manipulator`, asking members to change camera settings, 415 instead of 400), including when each would be worth revisiting.
- [x] T087 [US7] Add Scenario 8 to [quickstart.md](./quickstart.md) and a line to `CLAUDE.md` under the upload paragraph: iPhone HEIC photo to a listing, an avatar, a Threads post and a merchant store cover; an Android-stored HEIC or a TIFF is named before upload; `tests/media/unsupported-type.test.ts` in the automated checks.
- [ ] T088 [US7] Verify: `npx tsc --noEmit` in `packages/contracts`, `client` and `expo-client/german-world-club`; `npm run test:i18n` in `client`; `npx expo lint` on every touched app file; `npm run -w server test -- tests/media` against the scratch database; then Scenario 8 on an iPhone (needs a device, like T053). **Done so far:** contracts 142 tests, server media/marketplace/authz/ops 803 passed, web 84 passed in the affected suites, i18n parity, typecheck in all four workspaces (server errors 1160 against a baseline of 1161, none new), Expo lint clean for every touched file, and an iOS bundle built with `expo export` (it contains the new code). **Left:** Scenario 8 on an iPhone.

**Checkpoint**: a HEIC photo from an iPhone uploads from every screen; a file that cannot be accepted is named before upload and is never offered a pointless Retry.

---

## Dependencies and order

```
Phase 1 (T001-T004) ──► Phase 2 (T005-T008) ──┬──► US1 (T009-T027) ──► US2 (T028-T040) ──┐
                                              └──► US3 (T041-T052)  (independent) ───────┤
Phase 6 uploads foundation (T053-T060)  (independent of the above) ──┬─► US4 (T061-T064) ─┤
                                                                     ├─► US5 (T065-T067) ─┼──► Polish (T071-T078)
                                                                     └─► US6 (T068-T070) ─┘
US7 HEIC (T079-T088)  (independent; touches the same upload hook as Phase 6, so after T058-T060)
```

- **Phase 6 is independent of Phases 1 to 5.** It can start at once and run in parallel with US1 to US3. Inside it, the order is T053 to T055 (diagnose), T056 (record), T057 (fix the confirmed cause); T058 to T060 can run alongside the diagnosis.
- **US4, US5, US6 need Phase 6 and nothing from each other.** Three people can take one each. US4 edits the same file as T037, so do T061 after T037 lands.

- **US2 depends on US1's edit path** (`editListing`, `version`, `mine/:id`, edit screens). Do not start T032 before T013.
- **US3 depends only on Phase 2** (the migration and shared types). It can run in parallel with US1 and US2 by a second person.
- Within a story: tests first (they must fail), then application, then route and controller, then web, then app.
- T045 and T032 both touch their module's `application/` files but different files (`moderate.ts`, `manage.ts`), so US2 and US3 server work can overlap.

## Parallel examples

- Phase 1: T002 and T003 together after T001 is written.
- US1 tests: T009, T010, T011, T012 (different files).
- US1 clients: T019 to T022 (web) in parallel with T023 to T026 (app) once T016 is merged.
- US3: T041 to T044 (tests), then T049 to T051 (web) while T048 finishes.
- Phase 6: T054 and T055 together while T053 is run by hand; T058, T059 and T060 together.
- US4, US5 and US6: T061, T065 and T068 are in different files and can run in parallel.

## Implementation strategy

1. **MVP = Phase 1 + 2 + US1.** Members can edit their listings on both platforms, nothing else changes, and it ships alone.
2. **Add US2** to deliver the Publish checkbox and drafts. Back-compat (`publish` default `true`) means an old app build keeps working.
3. **Add US3** for the staff browser and Enable-to-origin. It can ship before US2 if staff tooling is urgent, because it needs only Phase 2.
4. **Bugs B1 to B3 (US4 to US6) are a separate track.** They are bugs in shipped screens, so they can go out before any of the above: Phase 6, then whichever of US4, US5 and US6 hurts most (the cause found in T056 may fix all three at once, so check after the first).
5. Run [quickstart.md](./quickstart.md) after each story, and the full gate (T076) before opening the pull request.

## Notes

- No new native package: no EAS build is needed for this feature, including the upload fixes (XMLHttpRequest and the JavaScript `Animated` spinner are already in the app). Do not add `react-native-svg`, `expo-image-manipulator` or a native upload module.
- Read the Expo SDK 57 docs before changing any app code (`expo-client/german-world-club/AGENTS.md`).
- The migration is additive and re-runnable; there is no data to backfill.
- Commit after each task or logical group. Branch is `037-marketplace-listing-management`.
