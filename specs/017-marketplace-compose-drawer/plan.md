# Implementation Plan: Marketplace "New listing" panel, web and mobile

**Branch**: `017-marketplace-compose-drawer` | **Date**: 2026-10-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/017-marketplace-compose-drawer/spec.md`

## Summary

This is two pieces of work of very different size:

1. **Web (small)**: `client/src/member/Marketplace.tsx` stops rendering `ComposeListing`
   inline. A **New listing** button goes into `PageHeader`'s existing `actions` slot (top
   right), and opens a new `components/ui/Drawer.tsx`. The drawer is a `<dialog>`
   (`showModal()`) pinned to the right edge that slides in with CSS only (R1, R2). It keeps
   the form mounted while closed, so a draft survives (R3), closes itself on a complete
   publish, and stays open for media retry (R4).
2. **Mobile (large)**: the app has no marketplace, so this delivers feature 008's unbuilt
   User Story 6 plus compose. It adds a fifth tab, `(member)/marketplace`, with a filtered,
   paged browse list, a shared read-only `ListingDetail` (R8), and a `new` screen pushed with
   `animation: 'slide_from_right'` (R6). The New listing `headerRight` button shows from
   `GET /auth/me` permissions (R9).

One shared change: the listing media cap moves into `@gwc/contracts/marketplace` as
`LISTING_MEDIA_MAX`, so the app does not become its third copy (R10). The server's behaviour
does not change.

## Technical Context

**Language/Version**: TypeScript. React 19.2 + Vite 8 + Tailwind 4.3 (web). React Native 0.86 / Expo SDK 57 / Expo Router v57 (app). Node 22 (server, import change only).

**Primary Dependencies**: `@gwc/contracts` (marketplace, auth, media types). Web: native `<dialog>` and no new package. App: `expo-router` (`Stack`, `NativeTabs`), `expo-image-picker` through `src/lib/pick-media.ts`, `usePaged`, and the existing `ui.tsx` kit. No new dependency on either face, and no new native module, so no new EAS build is needed for the dependency set.

**Storage**: N/A (see data-model.md).

**Testing**: Web: Vitest + Testing Library + jsdom (`client/tests/member/`), plus `test:i18n`. Server: the existing marketplace media suite guards the cap. App: `tsc --noEmit` + `expo lint` (there is no unit runner), plus the manual scenarios in quickstart.md.

**Target Platform**: Web console in evergreen browsers. iOS and Android (Expo app).

**Project Type**: Two clients over one API. Client-only behaviour change.

**Performance Goals**: The panel opens without perceptible delay (animation ≤ 300 ms). The first listing is in the initial viewport on the web (SC-001).

**Constraints**: CSP is nonce-only for styles, so classes only and no inline `<style>` (R2). Respects reduced motion. Five tabs is the Material bottom-bar maximum (R7). Every string is in both languages. No server-refusal text is held in client state (R13).

**Scale/Scope**: Web: 3 changed files and 1 new (`Drawer.tsx`), plus i18n and 2 test files updated and 1 added. App: about 8 new files (marketplace stack, index, new, listing/[id], `listing-detail.tsx`, `date-parts-field.tsx`, compose field components) and about 5 changed (`(member)/_layout.tsx`, `activity/listing/[id].tsx`, `endpoints.ts`, both catalogues). Contracts: 1 constant. Server: 1 import.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Engaged? | Verdict |
|---|---|---|
| I. One rule set, three clients | Yes. Who may post, the field set per category and the media cap are all rules. | **PASS.** Posting stays `requires: 'marketplace_post'` on the route. Both clients use `/auth/me` only to *display* the button (R9). Category fields come from `GET /marketplace/categories` on both faces. The media cap moves **into** contracts instead of gaining a third copy (R10). Every app shape is imported from `@gwc/contracts` (FR-007), which `tsc` checks. |
| II. Declare every posture | No route or surface added. | **PASS.** The server routes are untouched, and the boot gate is unchanged. `/marketplace` stays gated and unindexed. The app screens are not web surfaces. |
| III. Published state = real state | No public surface touched. | **PASS.** `/marktplatz` (public) is not touched. |
| IV. Integrity in the database | Media cap. | **PASS.** The `marketplace_listing_media` CHECK stays the authority. The constant is feedback only. No write path changes. |
| V. Failure explicit and bounded | Client calls to existing routes. | **PASS.** No server budgets change. Video processing waits stay bounded at 120 s, reusing `uploadReady` and the web's loop. |
| VI. Server shapes what leaves it | Media display; logging. | **PASS.** The app renders delivered derivatives through the existing `MediaCarousel`, never an original. The Expo request log stays method/path/status/timing/request-id, with no bodies. |

Project conventions checked: strings live in the i18n catalogues on both faces
(`no-hardcoded-strings.test.ts` on the web). Catches log `console.error('<Component>.<fn>', …)`
and store no refusal (R13). Comments explain *why*: why the drawer never unmounts, why the
iOS animation value falls back, and why there is no date-picker dependency.

**Post-design re-check**: unchanged. All PASS. No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/017-marketplace-compose-drawer/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R13
├── data-model.md        # no persisted change; one shared constant; client state
├── quickstart.md        # how to validate on both faces
├── contracts/
│   └── ui-contract.md   # routes consumed + the UI behaviour pinned by tests/review
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code

```text
packages/contracts/src/marketplace.ts       + LISTING_MEDIA_MAX (R10)

server/src/modules/marketplace/application/media.ts
                                            MAX_MEDIA_PER_LISTING → import LISTING_MEDIA_MAX

client/src/
├── components/ui/Drawer.tsx                NEW  right-edge <dialog>, CSS slide, stays mounted (R1–R3)
├── member/Marketplace.tsx                  header button → Drawer(ComposeListing); posted notice lifted (R4, R5)
├── member/MediaPicker.tsx                  import LISTING_MEDIA_MAX
└── i18n/{de,en}.ts                         memberMarketplace.newListing, .close
client/tests/
├── member/marketplace.test.tsx             button present/absent (counter-assertion), no inline form
├── member/marketplace-compose.test.tsx     open drawer first; close-on-complete; open-on-media-failure
└── components/drawer.test.tsx              NEW  Escape/backdrop/close button, focus return, draft kept

expo-client/german-world-club/src/
├── app/(member)/_layout.tsx                + NativeTabs.Trigger "marketplace" (2nd) (R7)
├── app/(member)/marketplace/
│   ├── _layout.tsx                         NEW  Stack: index, new (card + slide_from_right), listing/[id]
│   ├── index.tsx                           NEW  filters (Chips), usePaged list, headerRight button (R5, R9)
│   ├── new.tsx                             NEW  compose: create → upload+attach in order → retry (R11)
│   └── listing/[id].tsx                    NEW  renders ListingDetail
├── app/(member)/activity/listing/[id].tsx  renders ListingDetail (body moved out) (R8)
├── components/listing-detail.tsx           NEW  moved from activity/listing/[id].tsx
├── components/listing-field.tsx            NEW  FieldDef kind → TextField / Chips / Switch / DatePartsField (R12)
├── components/date-parts-field.tsx         NEW  day/month/year numeric inputs (R12)
├── api/endpoints.ts                        authApi.me; marketplaceApi.{categories,list,terms,acceptTerms,create,attachMedia}
└── i18n/{en,de}.ts                         tabs.marketplace + marketplace namespace
```

**Structure Decision**: the existing three-workspace layout (contracts, server, client, and
the Expo app as a workspace) is unchanged. The web drawer is a generic `components/ui`
primitive because nothing about it is marketplace-specific. The app's marketplace is its own
tab stack, mirroring `threads/` and `activity/`.

## Risks

- **jsdom and `<dialog>`**: jsdom lacks `showModal()`. `Modal.tsx`'s fallback (`setAttribute('open')`)
  is reused. Because the drawer stays mounted (R3), tests must assert visibility rather than
  presence. Without that, the existing "HAS the compose control" test passes against a closed
  drawer.
- **Fifth tab**: this fills the Android bottom bar. The next top-level function needs another
  home (R7).
- **iOS animation value**: `slide_from_right` falls back to the default push on iOS. That is the
  requested motion, but a reviewer reading the option may expect a custom animation. The
  comment at the option says so.
- **Seeded posters are random**: the local demo seed gives `marketplace_post` to about 15% of
  members, chosen at random. quickstart.md gives the query instead of trusting a fixed address.

## Complexity Tracking

None. No principle is violated.
