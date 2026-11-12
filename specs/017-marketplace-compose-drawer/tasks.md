---

description: "Task list for feature 017 — Marketplace New listing panel, web and mobile"
---

# Tasks: Marketplace "New listing" panel, web and mobile

**Input**: Design documents from `specs/017-marketplace-compose-drawer/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R13), data-model.md, contracts/ui-contract.md, quickstart.md

**Tests**: Included for the web. The plan lists them, and the constitution requires an
automated check per principle touched. CLAUDE.md asks for a counter-assertion wherever a test
could pass against a client that did nothing. The app has no unit runner, so its checks are
`tsc --noEmit`, `expo lint` and the manual scenarios in quickstart.md.

**Organization**: one phase per user story. US1 is web only; US2 and US3 are app only. They
share only Phase 2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 (web panel), US2 (mobile browse), US3 (mobile compose)

## Path conventions

- Contracts: `packages/contracts/src/`
- Server: `server/src/`
- Web client: `client/src/`, tests in `client/tests/`
- App: `expo-client/german-world-club/src/` (written `app/…` below for brevity, meaning
  `expo-client/german-world-club/src/app/…`)

---

## Phase 1: Setup

**Purpose**: record a green baseline so a later red test is attributable to this feature.

- [X] T001 Run `npm run -w client test`, `npm run -w client test:i18n` and `npm run typecheck` from the repo root on branch `017-marketplace-compose-drawer` before any change, and note any test that is already failing in the PR description, so it isn't blamed on this feature.

---

## Phase 2: Foundational (blocking)

**Purpose**: one media cap in contracts (R10), which every face reads.

**⚠️ CRITICAL**: US1 (MediaPicker) and US3 (app compose) both import the constant from here.

- [X] T002 Add `export const LISTING_MEDIA_MAX = 20` to `packages/contracts/src/marketplace.ts`, beside `VISIBLE_STATES`. Add a comment that it mirrors the `marketplace_listing_media` CHECK constraint, which stays the authority (Principle IV), and that clients use it only as early feedback. Name it like `THREAD_MEDIA_MAX` in `packages/contracts/src/threads.ts`.
- [X] T003 [P] In `server/src/modules/marketplace/application/media.ts`, replace the local `export const MAX_MEDIA_PER_LISTING = 20` with an import of `LISTING_MEDIA_MAX` from `@gwc/contracts/marketplace`. Update every use, and `grep -rn MAX_MEDIA_PER_LISTING server/` for other importers, including tests.
- [X] T004 [P] In `client/src/member/MediaPicker.tsx`, delete the local `MAX_MEDIA_PER_LISTING` export and import `LISTING_MEDIA_MAX` from `@gwc/contracts/marketplace`. Update its uses, and `grep -rn MAX_MEDIA_PER_LISTING client/` for other importers. Leave `MEDIA_TYPES` where it is: it is a browser file-input filter (R10, "Not moved").
- [X] T005 Run `npm run typecheck` and `npm run -w server test -- marketplace`. They must pass with the media-cap behaviour unchanged.

**Checkpoint**: one constant, three readers, nothing else changed.

---

## Phase 3: User Story 1 — Browse first, compose on demand (web) (P1) 🎯 MVP

**Goal**: `/konsole/mitglied` shows header, filters and listings. A **New listing** button at
the top right opens the compose form in a panel that slides in from the right (spec US1,
contracts/ui-contract.md "Web").

**Independent test**: as a member with `marketplace_post`, the first listing is visible
without scrolling past a form. New listing → publish → the drawer closes and the listing
appears. As a member without the flag, there is no button.

### Tests for User Story 1 (write first; they must fail before T011–T013)

- [X] T006 [P] [US1] Create `client/tests/components/drawer.test.tsx` for `client/src/components/ui/Drawer.tsx` (props: `open`, `onClose`, `title`, `children`, optional `returnFocusTo` ref). Assert:
  - (a) with `open={false}` the `<dialog>` is in the DOM **without** the `open` attribute, and its children are mounted. Counter-assertion: rerendering with `open={true}` sets `open`.
  - (b) a `cancel` event (Escape) calls `onClose` and is `preventDefault`ed.
  - (c) a click whose target is the `<dialog>` element itself (the backdrop) calls `onClose`, and a click on a child does **not**.
  - (d) the close button, labelled `t.memberMarketplace.close`, calls `onClose`.
  - (e) after `open` goes true → false, `document.activeElement` is the element passed as `returnFocusTo`.
  - (f) a controlled `<input>` inside keeps its typed value across open → closed → open.

  jsdom lacks `showModal()`: rely on the same `setAttribute('open', '')` fallback `client/src/member/threads/Modal.tsx` uses.
- [X] T007 [P] [US1] Update `client/tests/member/marketplace.test.tsx`:
  - (a) "has NO compose control without marketplace_post": additionally assert `screen.queryByRole('button', { name: t.memberMarketplace.newListing })` is null **and** `document.querySelector('dialog')` is null (the drawer is not rendered at all).
  - (b) rename "HAS the compose control with marketplace_post" so it asserts the **button** `t.memberMarketplace.newListing` is present inside the page `<header>`, and that `document.querySelector('dialog')` exists **without** `open`. The form is not shown until asked for.
  - (c) add "opens the panel from the header button": click it, then assert the dialog has `open`, the button has `aria-expanded="true"`, and `getByRole('heading', { name: t.memberMarketplace.composeTitle })` is inside the dialog.
- [X] T008 [P] [US1] Update `client/tests/member/marketplace-compose.test.tsx`:
  - (a) add a helper `openCompose()` that awaits the `t.memberMarketplace.newListing` button, clicks it, and asserts `document.querySelector('dialog')!.hasAttribute('open')`. Call it at the start of **every** existing test, before touching a field. Without it the tests would pass against a closed drawer (plan.md "Risks").
  - (b) in "starts on the first category … and posts it", additionally assert that after publish the dialog **no longer** has `open`, and that `t.memberMarketplace.posted` is rendered **outside** the dialog (`within(document.querySelector('main') ?? document.body)`, excluding the dialog).
  - (c) in "keeps a failed file and retries it against the same listing", assert that the dialog **still** has `open` after the partial failure and that `t.memberMarketplace.mediaRetry` is inside it (R4).

### Implementation for User Story 1

- [X] T009 [P] [US1] Add `newListing` and `close` to `memberMarketplace` in **both** `client/src/i18n/de.ts` (`newListing: 'Neue Anzeige'`, `close: 'Schließen'`) and `client/src/i18n/en.ts` (`newListing: 'New listing'`, `close: 'Close'`). Then run `npm run -w client test:i18n`.
- [X] T010 [US1] Create `client/src/components/ui/Drawer.tsx` (R1–R3), exporting `Drawer` and a default export like the other `ui/` files:
  - It always renders a `<dialog>`. Unlike `Modal.tsx` it **never returns null** when closed; add a comment that the form must outlive a close (FR-004, R3).
  - A `useEffect` on `open` calls `showModal?.() ?? setAttribute('open','')` and `close?.() ?? removeAttribute('open')`, as in `Modal.tsx`. On closing, focus `returnFocusTo?.current`.
  - `onCancel`: `preventDefault` and call `onClose()`. `onClick`: call `onClose()` when `e.target === e.currentTarget` (backdrop).
  - `aria-labelledby` points to an `<h2 id>` (use `useId`) holding `title`. A header row has the title plus a close `<Button variant="secondary">` labelled from a `closeLabel` prop. The caller passes `t.memberMarketplace.close`, so `components/ui` stays catalogue-free like `PageHeader`.
  - Classes only, no `style` attribute and no `<style>`, because of the nonce-only CSP (R2): `fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[min(560px,100vw)] max-w-none overflow-y-auto border-l border-hairline bg-surface p-0 text-text shadow-xl translate-x-full open:translate-x-0 starting:open:translate-x-full transition-[translate,overlay,display] transition-discrete duration-300 ease-out motion-reduce:transition-none backdrop:bg-ink/40`.
  - The body is a `flex flex-col gap-4 p-5` wrapper around `children`.
  - Add a one-line comment that the closed dialog is `display:none`, which is why mounting it costs nothing.
- [X] T011 [US1] In `client/src/member/Marketplace.tsx`, change `ComposeListing`:
  - Change its `onPosted: () => void` prop to `onPosted: (result: { complete: boolean }) => void`.
  - Delete its `posted` state and the `{posted && <Callout … posted/>}` line. The notice moves to the page (R4).
  - Remove the outer `<Card title={composeTitle}>` wrapper, so the drawer provides the heading, and keep the inner `flex flex-col gap-4` div.
  - In `submit`, call `onPosted({ complete: failed.length === 0 })`. In `retryMedia`, call `onPosted({ complete: true })` on full success. Keep every other behaviour (FR-005).
- [X] T012 [US1] In `Marketplace()` in `client/src/member/Marketplace.tsx`:
  - Add `const [composeOpen, setComposeOpen] = useState(false)`, `const [posted, setPosted] = useState(false)` and `const newListingButton = useRef<HTMLButtonElement>(null)`.
  - Pass `PageHeader` `actions={canPost ? <Button ref={newListingButton} variant="accent" aria-haspopup="dialog" aria-expanded={composeOpen} onClick={() => { setPosted(false); setComposeOpen(true) }}>{t.memberMarketplace.newListing}</Button> : undefined}`. Check that `Button` forwards `ref`. If it doesn't, add `ref` to `ButtonProps` in `client/src/components/ui/Button.tsx`, which is React 19 ref-as-prop, so no `forwardRef`.
  - Replace the inline `{canPost && <ComposeListing …/>}` with `{canPost && <Drawer open={composeOpen} onClose={() => setComposeOpen(false)} title={t.memberMarketplace.composeTitle} closeLabel={t.memberMarketplace.close} returnFocusTo={newListingButton}><ComposeListing … onPosted={({ complete }) => { void loadListings(); if (complete) { setComposeOpen(false); setPosted(true) } }} /></Drawer>}`.
  - Render `{posted && <Callout variant="info" title={t.memberMarketplace.posted} />}` between the header and the browse card.
  - Update the file's header comment: compose lives in a drawer opened from the header, and is absent (not disabled) without the flag.
- [X] T013 [US1] Run `npm run -w client test` (T006–T008 must now pass) and `npm run -w client lint`. Confirm `client/tests/no-hardcoded-strings.test.ts` and `client/tests/responsive.test.tsx` still pass. If `responsive.test.tsx` enumerates member pages at phone width, extend it to open the drawer and assert no horizontal overflow (spec US1-8).

**Checkpoint**: US1 is shippable on its own. The web is done.

---

## Phase 4: User Story 2 — The marketplace on mobile (P1)

**Goal**: a Marketplace tab with filtered, paged, refreshable browsing and a read-only detail
(spec US2, 008 US6).

**Independent test**: the same member and filters on app and web return the same listings in
the same order (quickstart "App scenarios" 1, 2, 7).

### Implementation for User Story 2

- [X] T014 [P] [US2] In `expo-client/german-world-club/src/api/endpoints.ts`:
  - Add `import type { CategoriesResponse, ListingPage, ListingQuery } from '@gwc/contracts/marketplace'` (extend the existing `Listing` import) and `import type { MeResponse } from '@gwc/contracts/auth'` (extend the existing import).
  - Add `me: () => api<MeResponse>('/auth/me')` to `authApi`, with a comment that it is used only to decide what to *display* (R9).
  - Extend `marketplaceApi` with `categories: () => api<CategoriesResponse>('/marketplace/categories')` and `list: (params: Pick<ListingQuery, 'category' | 'mode'> & { cursor?: string | null }) => api<ListingPage>(\`/marketplace/listings${q({ category: params.category, mode: params.mode, cursor: params.cursor })}\`)`.
  - Declare no local shapes (the file's header rule).
- [X] T015 [P] [US2] Add strings to **both** `expo-client/german-world-club/src/i18n/en.ts` and `de.ts` (`de` is typed against `en`):
  - `tabs.marketplace` ('Marketplace' / 'Marktplatz').
  - A new `marketplace` namespace after `listing`, with `title`, `allCategories`, `allModes`, `empty`, `loadFailed`, `categories` (same keys as `MARKETPLACE_CATEGORIES`) and `modes` (`offer`, `request`).
  - Copy the German and English wording from `client/src/i18n/{de,en}.ts` `memberMarketplace`, so both faces say the same thing.
- [X] T016 [P] [US2] Create `expo-client/german-world-club/src/components/listing-detail.tsx` by moving the body of `app/(member)/activity/listing/[id].tsx` into `export function ListingDetail({ id }: { id: string })`:
  - Keep the load, `Loading`, `MediaCarousel`, price via `formatMoney`, body and "Posted by".
  - Keep the `as unknown as readonly MediaItem[]` cast **and its comment** verbatim (R8).
  - Keep `console.error('ListingDetail.load', …)` per R13.
- [X] T017 [US2] Reduce `app/(member)/activity/listing/[id].tsx` to reading `id` with `useLocalSearchParams`, rendering `<Stack.Screen options={{ title: '' }} />` and `<ListingDetail id={id} />`. Update its comment: the marketplace tab now exists, and the same component serves both stacks (R8).
- [X] T018 [P] [US2] Create `app/(member)/marketplace/listing/[id].tsx`, identical in shape to T017, rendering `ListingDetail`.
- [X] T019 [US2] Create `app/(member)/marketplace/index.tsx`:
  - Filter state `category: MarketplaceCategory | ''` and `mode: MarketplaceMode | ''`.
  - Two `View accessibilityRole="radiogroup"` rows of `Chip`s: "all" plus each of `MARKETPLACE_CATEGORIES`, and "all" plus `MARKETPLACE_MODES`, from `@gwc/contracts/marketplace`. Labels come from `t.marketplace.*`. Each row is a horizontal `ScrollView`, because six category chips overflow a phone.
  - `usePaged((cursor) => marketplaceApi.list({ category, mode, cursor }), [category, mode])` in a `FlatList` with `RefreshControl` and `onEndReached` load-more, following `app/(member)/threads/index.tsx`. Empty state is `t.marketplace.empty`.
  - Each row is a `Card` with `onPress={() => router.push(\`/marketplace/listing/${item.id}\`)}`, showing title, a two-line body, category · `formatDate(createdAt)` · owner display name, as the web list does.
  - Reload on focus after the first, with the `focusedOnce` ref pattern from threads, so a listing posted in US3 appears on return.
- [X] T020 [US2] Create `app/(member)/marketplace/_layout.tsx`: `<Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>` with `index` (`title: t.marketplace.title`) and `listing/[id]` (`title: ''`). The `new` screen is added in T027.
- [X] T021 [US2] In `app/(member)/_layout.tsx`, add `<NativeTabs.Trigger name="marketplace">` **second**, after `threads`, with label `t.tabs.marketplace` and `<NativeTabs.Trigger.Icon sf={{ default: 'bag', selected: 'bag.fill' }} md="storefront" />`. Extend the file comment: Marketplace is 008 US6, and five tabs is the Material bottom-bar maximum, so the next top-level function needs another home (R7).
- [ ] T022 [US2] Run `npm run typecheck` and `npm run -w expo-client/german-world-club lint`. Then run quickstart "App scenarios" 1, 2 and 7 on a device or simulator.

**Checkpoint**: browsing works on mobile without US3.

---

## Phase 5: User Story 3 — New listing on mobile (P2)

**Goal**: a flagged member taps **New listing** (top right) and the compose screen slides in
from the right. They publish with photos and land back on the list (spec US3,
contracts/ui-contract.md "Mobile").

**Independent test**: post with one photo from the app and see the listing on both faces.
After the flag is revoked, the button is gone on the next visit (quickstart "App scenarios"
3–6).

### Implementation for User Story 3

- [X] T023 [P] [US3] Extend `marketplaceApi` in `expo-client/german-world-club/src/api/endpoints.ts` with these, importing `CreateListingRequest` and `TermsResponse` types from `@gwc/contracts/marketplace`:
  - `terms: () => api<TermsResponse>('/marketplace/terms')`
  - `acceptTerms: () => api<TermsResponse>('/marketplace/terms/accept', { method: 'POST' })`
  - `create: (body: CreateListingRequest) => api<{ id: string }>('/marketplace/listings', { method: 'POST', body })`
  - `attachMedia: (listingId: string, assetId: string) => api<unknown>(\`/marketplace/listings/${listingId}/media\`, { method: 'POST', body: { assetId } })`

  Check that `CreateListingRequest` matches what the web posts in `client/src/member/Marketplace.tsx` `submit`. If it differs, fix the **contract**, not the app (CLAUDE.md).
- [X] T024 [P] [US3] Add the compose strings to the `marketplace` namespace in **both** app catalogues, copying wording from the web `memberMarketplace`:
  - Labels: `newListing`, `composeTitle`, `category`, `mode`, `titleField`, `body`, `features`, `contactMethod`, `contactMethods` (keys of `CONTACT_METHODS`), `expiresAt`, `expiresAtHint`.
  - Terms: `termsRequired`, `acceptTerms`.
  - Actions: `submit`, `publishing`.
  - Media: `media`, `mediaAdd`, `mediaAlt`, `mediaRemove`, `mediaAltMissing`, `mediaTooMany` (with a `{max}` placeholder for `format`), `mediaRetry`, `mediaFailed`, `photoPermission`, and `mediaStatus` (`pending`, `uploading`, `processing`, `attached`, `failed`).
  - Date parts: `day`, `month`, `year`.
- [X] T025 [P] [US3] Create `expo-client/german-world-club/src/components/date-parts-field.tsx` (R12): `DatePartsField({ label, value, onChange, hint })`, where `value`/`onChange` use an ISO `YYYY-MM-DD` string or `''`.
  - Three `TextField`s (day, month, year) with `keyboardType="number-pad"` and `maxLength` 2/2/4. Day and month auto-advance focus when full, on typed changes only, as Register does after feature 016. The year field closes the keyboard.
  - Emit an ISO string only when all three parts are present, and `''` otherwise. Leave range validation to the server.
  - Comment why there is no date-picker dependency (a native module means a new EAS build) and that Register's inline fields were deliberately not refactored into this component.
- [X] T026 [P] [US3] Create `expo-client/german-world-club/src/components/listing-field.tsx` (R12): `ListingField({ def, value, onChange }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void })`. The label is `def.key` plus ` *` when required, matching the web's `DetailField`.
  - `boolean` → `Switch` in a labelled row.
  - `enum` → a radiogroup of `Chip`s over `def.options`. Tapping the selected chip again clears it (`undefined`).
  - `date` → `DatePartsField`.
  - `integer` / `decimal` / `money` → `TextField` with `keyboardType="decimal-pad"` (`number-pad` for integer). Send the typed **string**, or `undefined` when empty, as the web does; the server coerces with `Number()` in `server/src/modules/marketplace/categories.ts`.
  - Everything else → `TextField`.
- [X] T027 [US3] In `app/(member)/marketplace/_layout.tsx`, add `<Stack.Screen name="new" options={{ title: t.marketplace.composeTitle, presentation: 'card', animation: 'slide_from_right' }} />`. Add a comment that on iOS `slide_from_right` falls back to the default push, which already enters from the right, and that the value is there for Android (R6).
- [X] T028 [US3] Create `app/(member)/marketplace/new.tsx` inside `FormScreen`, porting `ComposeListing` from `client/src/member/Marketplace.tsx` with app components. Keep the web's rules exactly:
  - **Load**: `categories` and `terms` on mount. On failure: `console.error('MarketplaceCompose.load…', e instanceof ApiError ? e.problem : e)`, `loadFailed=true` and `<Message tone="info" text={t.marketplace.loadFailed} />`.
  - **Category and mode**: category chips default to the first category once loaded, the same fix the web carries. Changing category clears `details` and `features`. Mode chips come from `MARKETPLACE_MODES`.
  - **Fields**: `TextField` title, multiline `TextField` body, `activeDef.fields.map(ListingField)`, and vehicle feature `Chip`s from `vehicleFeatures`. Contact method chips come from `CONTACT_METHODS`, default `platform_message`. Expiry is `DatePartsField` with `expiresAtHint`.
  - **Media**:
    - An "add" `Button` uses `pickMedia({ limit: LISTING_MEDIA_MAX - media.length })`. When there's no room, show `format(t.marketplace.mediaTooMany, { max: LISTING_MEDIA_MAX })`. `denied` shows `photoPermission`.
    - Each item shows a thumbnail (`expo-image`), an alt `TextField`, a remove action and its `mediaStatus` label.
  - **Terms**: when `terms.acceptedVersion !== terms.version`, show `termsRequired` with an `acceptTerms` button calling `marketplaceApi.acceptTerms()`.
  - **Publish**: enabled iff not busy, categories loaded, terms loaded **and** accepted, `title.trim().length >= 3` and `body.trim().length >= 10`. Before anything is sent, a missing alt shows `t.marketplace.mediaAltMissing`.
  - **Publish order (R11)**: `create` with `{ category, mode, title, body, details, ...(category === 'vehicle' ? { features: [...features] } : {}), contactMethod, expiresAt: expiresAt === '' ? null : new Date(expiresAt).toISOString(), termsVersion: terms.version }` → `setAttachingTo(id)`. Then, in order, `uploadReady(item, item.alt.trim())` → `marketplaceApi.attachMedia(id, assetId)`, setting each item's status.
  - **Result**: on full success, `router.back()`. On partial failure, keep only the failed items, show `mediaFailed` and a `mediaRetry` button that re-runs attach against `attachingTo`.
  - **Errors (R13)**: log every catch as `console.error('MarketplaceCompose.<fn>', …)`, and store no server refusal in state.
  - Add a file comment stating the order difference from threads (create first, then attach) and why.
- [X] T029 [US3] In `app/(member)/marketplace/index.tsx`:
  - Add `const [canPost, setCanPost] = useState(false)`. In a `useFocusEffect(useCallback(…))`, call `authApi.me()` and set `canPost` to `me.kind === 'member' && me.permissions.includes('marketplace_post')`. On error, log `console.error('Marketplace.loadMe', …)` and leave the button hidden.
  - Add `<Stack.Screen options={{ headerRight: canPost ? () => (<ThemedText accessibilityRole="button" style={{ color: theme.tint, fontWeight: '600' }} onPress={() => router.push('/marketplace/new')}>{t.marketplace.newListing}</ThemedText>) : undefined }} />`, the same pattern as `app/(member)/threads/index.tsx`.
  - Add a comment that this is display only, that the server refuses a post without the flag (Principle I), and that re-reading on focus is how a revoked flag hides the button on the next visit (R9).
- [ ] T030 [US3] Run `npm run typecheck` and `npm run -w expo-client/german-world-club lint`. Then run quickstart "App scenarios" 3–6 on **both** an Android device or emulator (it must visibly slide from the right) and iOS.

**Checkpoint**: all three stories work independently.

---

## Phase 6: Polish & cross-cutting

- [X] T031 [P] Update the marketplace paragraph in `CLAUDE.md` ("The marketplace is two modules…") with one sentence: the member web compose form lives in a right-edge `Drawer` opened from the header, and the app's Marketplace tab is the fifth and last bottom-bar slot. Keep it short; the rule-bearing paragraphs stay as they are.
- [X] T032 [P] Run `npm test` (every workspace) and `npm run typecheck` from the repo root. Everything must pass, apart from failures already recorded in T001.
- [ ] T033 Walk through every scenario in `specs/017-marketplace-compose-drawer/quickstart.md`, web 1–7 and app 1–7, including reduced motion and the 375 px width check. Record anything that deviates in the PR description.

---

## Dependencies & execution order

### Phase dependencies

- **Phase 1 (T001)**: no dependencies.
- **Phase 2 (T002–T005)**: after T001. T003 and T004 depend on T002. **Blocks US1 (T004 → MediaPicker) and US3 (T028 uses `LISTING_MEDIA_MAX`).**
- **US1 (T006–T013)**: after Phase 2. Independent of US2 and US3.
- **US2 (T014–T022)**: needs only T002 to have landed. Can run in parallel with US1.
- **US3 (T023–T030)**: after US2. It adds a screen to US2's stack, and its button sits on US2's index screen.
- **Polish (T031–T033)**: after the stories you intend to ship.

### Within stories

- US1: T006–T008 (tests, failing) → T009 → T010 → T011 → T012 → T013.
- US2: T014, T015, T016 in parallel → T017, T018 → T019 → T020 → T021 → T022.
- US3: T023–T026 in parallel → T027 → T028 → T029 → T030.

## Parallel examples

```text
# US1 — tests first, in parallel:
T006 drawer.test.tsx   T007 marketplace.test.tsx   T008 marketplace-compose.test.tsx
# then strings alongside the component:
T009 i18n keys         T010 Drawer.tsx

# US1 and US2 side by side (web vs app, no shared files after Phase 2):
Developer A: T006–T013    Developer B: T014–T022

# US3 building blocks:
T023 endpoints   T024 strings   T025 date-parts-field.tsx   T026 listing-field.tsx
```

## Implementation strategy

1. **MVP = Phase 2 + US1.** This delivers exactly what was asked for on the web, is fully
   tested, and is independently shippable.
2. **US2** next. Mobile browsing is valuable alone and is the base for US3.
3. **US3** completes mobile parity. A member can still post on the web until it lands.
4. Each checkpoint is a sensible PR boundary: one PR for Phase 2 + US1, one for US2 + US3.
