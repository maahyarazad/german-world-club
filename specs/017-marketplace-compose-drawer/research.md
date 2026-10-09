# Research: Marketplace "New listing" panel, web and mobile

Each decision below is recorded as Decision, Rationale and Alternatives considered.

## R1 — Web panel primitive: native `<dialog>` as a right-edge drawer

**Decision**: add `client/src/components/ui/Drawer.tsx`, built on `<dialog>` + `showModal()`
like `member/threads/Modal.tsx`. It is pinned to the right edge (`ml-auto h-dvh
w-[min(560px,100vw)] max-h-none`) and slides on `translate-x`.

**Rationale**: `showModal()` gives the top layer, an inert background, focus containment and
Escape from the browser. FR-003 asks for exactly those, and `Modal.tsx` already relies on
them, with a jsdom fallback the tests depend on. A drawer is the same dialog in a different
position.

**Alternatives**: a positioned `<div>` with a hand-written focus trap reimplements what the
browser gives (rejected). A headless UI library adds a dependency to a client that has none
beyond React, the router and Tailwind (rejected). Extending `Modal.tsx` with a `side` prop
would put a page-level UI primitive inside `member/threads/` (rejected). The drawer goes in
`components/ui/` beside `Card` and `PageHeader`.

## R2 — Slide animation without inline styles

**Decision**: Tailwind v4 classes only: `translate-x-full` → `open:translate-x-0`, with a
`starting:open:translate-x-full` entry state (`@starting-style`), `transition-[translate,
overlay,display] transition-discrete` so the exit animates too, and
`motion-reduce:transition-none` (FR-010). The backdrop fades with `backdrop:`.

**Rationale**: the CSP allows styles only by nonce (`02-security-headers.ts`). Utility classes
compile into the nonce'd stylesheet, so nothing new needs a nonce. `@starting-style` and
`allow-discrete` are supported in current Chrome, Safari and Firefox. Where they are not
supported, the panel simply appears, which is acceptable degradation.

**Alternatives**: JS-driven animation state (an `opening`/`closing` flag plus `setTimeout`)
adds timing code and a second source of truth for "is it open" (rejected).

## R3 — Keep the form mounted while the panel is closed

**Decision**: `Drawer` always renders its `<dialog>`. Unlike `Modal`, it never returns `null`
when closed. `ComposeListing` therefore stays mounted and keeps its state across close and
reopen (FR-004).

**Rationale**: a closed `<dialog>` is `display:none` and outside the accessibility tree, so
keeping it mounted costs nothing visible. Unmounting would silently drop a half-written
listing and its chosen photos, including their object URLs.

**Consequence for tests**: the compose controls exist in the DOM while closed. Tests must
assert visibility and the `open` state (`toBeVisible`, `dialog.open`), not presence. The
existing "has NO compose control without `marketplace_post`" test must check that the
**button** is absent. Without the flag, the drawer is not rendered at all, so that assertion
stays strict.

## R4 — Where publish success is reported, and when the panel closes

**Decision**: `ComposeListing` reports `onPosted({ complete })`. The page closes the drawer
and shows the "Listing published." callout above the list when `complete` is true. When some
media failed, the drawer stays open with the failed items and the retry button (spec US1-7).
The form-level `posted` callout moves out of the form.

**Rationale**: once the panel has closed, a confirmation inside it is invisible. A partial
success needs the retry control, which only exists inside the form.

## R5 — Header button placement

**Decision (web)**: pass the button to `PageHeader`'s existing `actions` slot, which already
renders at the top right (`justify-between`). Use `Button variant="accent"` with the label
`memberMarketplace.newListing`, `aria-haspopup="dialog"` and `aria-expanded`.

**Decision (mobile)**: a `headerRight` text button on the Marketplace stack's index screen,
the pattern `threads/index.tsx` already uses for Compose. `Stack.Toolbar` (Expo Router v57)
was considered and not used: one header-button pattern in the app is better than two.

## R6 — Mobile "slides in from the right": a pushed card with an explicit animation

**Decision**: `marketplace/new` is a stack screen with `presentation: 'card'` and
`animation: 'slide_from_right'`. The header back control (`headerBackButtonDisplayMode:
'minimal'`), the iOS edge swipe and Android's hardware back all close it.

**Rationale**: React Navigation native-stack (which Expo Router v57's `Stack` uses) documents
`slide_from_right` as sliding in from the right on Android. On iOS the value falls back to
the default push, which already slides from the right. Both platforms therefore get the
requested motion with no custom animation code. Back-handling, keyboard avoidance and safe
areas also come from the navigator.

**Alternatives**: `presentation: 'modal'` slides up from the bottom, which is not what was
asked (rejected). A Reanimated overlay drawer on the Marketplace screen would need its own
back handling, keyboard avoidance and focus management, and a phone-width form leaves it no
room to be partial (rejected). A Drawer navigator is navigation chrome for switching
sections, not a form host (rejected).

## R7 — A fifth tab

**Decision**: add `marketplace` to `(member)/_layout.tsx` as the second tab: Threads,
**Marketplace**, Activity, Events, Profile. The icon is `sf: bag / bag.fill`,
`md: storefront`.

**Rationale**: 008 US6 says "finds the marketplace in the tab bar". The web places
Marketplace beside Threads. Five is the most a Material bottom bar holds, so this is the
last tab the app can add. A sixth function will need a different home, and this plan records
that so it is not discovered later.

## R8 — Listing detail shared by two stacks

**Decision**: move the body of `(member)/activity/listing/[id].tsx` into
`src/components/listing-detail.tsx`. Both `activity/listing/[id].tsx` (notification landing,
feature 011) and the new `marketplace/listing/[id].tsx` render it.

**Rationale**: native tabs cannot share a screen across stacks, and a second copy of the
detail would drift. The existing `as unknown as readonly MediaItem[]` cast and its comment
move with the component unchanged. Fixing that contract drift is out of scope.

## R9 — Capabilities on mobile

**Decision**: add `authApi.me()` → `MeResponse` (`@gwc/contracts/auth`) and read
`permissions` in a `useFocusEffect` on the Marketplace screen. The button shows when
`marketplace_post` is present.

**Rationale**: `GET /auth/me` is documented as "the ONLY place capabilities … cross the wire"
and is a member route, so bearer tokens reach it. Re-reading it on focus means a revoked flag
hides the button on the next visit (spec edge case), matching the server's next-request
revocation. This is display only. `POST /marketplace/listings` still declares
`requires: 'marketplace_post'` (Principle I).

## R10 — One media cap, in contracts

**Decision**: move `MAX_MEDIA_PER_LISTING = 20` into `@gwc/contracts/marketplace` as
`LISTING_MEDIA_MAX`, named like `THREAD_MEDIA_MAX`. Import it from
`server/src/modules/marketplace/application/media.ts`, `client/src/member/MediaPicker.tsx`
and the app.

**Rationale**: it is declared twice today, once on the server and once on the web. The app
would make a third copy. CLAUDE.md is explicit that a shape both sides need goes in contracts.
The `marketplace_listing_media` CHECK constraint remains the real limit (Principle IV), and the
constant is early feedback.

**Not moved**: `MEDIA_TYPES` in `MediaPicker.tsx` is a filter for the browser's file input. The
app picks from the photo library through `pickMedia`, which threads already uses against the
same `/media` pipeline, so the app needs no type list.

## R11 — Mobile upload order: create, then attach

**Decision**: create the listing first, then for each item in order call
`uploadReady(item, alt)` and `POST /marketplace/listings/:id/media`. Items that fail are kept
with the listing id so "Retry" attaches to the same listing.

**Rationale**: this is the web flow. The marketplace attaches media to an existing listing,
the opposite of threads, where media must exist before the post (feature 010). The first item
attached represents the listing in the index, so order is preserved.

## R12 — Mobile field rendering and dates

**Decision**: `FieldDef.kind` renders as follows. `text` uses `TextField`. `integer`,
`decimal` and `money` use `TextField` with a numeric keyboard and send the typed string, as
the web does; the server coerces with `Number()` (`marketplace/categories.ts`). `enum` uses
`Chip`s, `boolean` uses `Switch`, and `date` uses a new `DatePartsField` (day / month / year
numeric inputs, like Register's birthday). Expiry uses `DatePartsField` too.

**Rationale**: the app has no date-picker dependency. Adding a native module needs a new EAS
build for every installed client, which is a poor trade for two optional date fields. Register
already uses split numeric fields, so members have seen the pattern. Register's inline fields
are **not** refactored into the new component: 016 just changed them.

## R13 — Errors and logging follow the project rule

**Decision**: on both faces, catches log
`console.error('<Component>.<function>', error instanceof ApiError ? error.problem : error)`.
Only local checks (missing alt text, photo permission, too many media), the load-failed flag
and the media-failed/retry state are shown. No server refusal is stored in state.

**Rationale**: this is CLAUDE.md's "Clients report failures to the console" convention.
`ComposeListing`'s existing `error` state holds only local messages (`mediaAltMissing`,
`mediaFailed`, the picker's checks), and that stays true.
