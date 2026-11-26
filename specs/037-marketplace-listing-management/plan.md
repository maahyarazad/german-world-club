# Implementation Plan: Marketplace Listing Management

**Branch**: `037-marketplace-listing-management` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/037-marketplace-listing-management/spec.md`

## Summary

Members get an edit flow and a Publish checkbox for their own marketplace listings on the web console and in the Expo app, and staff get a page listing every member listing with a Disable / Enable action.

Most of the machinery exists already. The server has `PATCH /marketplace/listings/:id` (`application/manage.ts`), the `draft` state exists in the database but is never used, and staff can `hide`/`restore`. This feature does **not** add a lifecycle state. It makes four changes:

1. **Create takes `publish`** (default `true`, so every existing client behaves as before). `false` stores a `draft`.
2. **The edit endpoint gains `published` and `version`.** Publishing, unpublishing and the field edits commit in one transaction, guarded by an optimistic version (the pattern from feature 028). It also learns which states are editable, which it never checked.
3. **Hide works from `draft` too and remembers where it came from** (`hidden_from_state`), so Enable returns a listing to the state its owner left it in. Today restore always goes to `active`.
4. **Two new read routes**: a staff listing browser (`GET /admin/marketplace/listings`) and an owner read (`GET /marketplace/mine/:id`) that returns a full listing in any state, which the edit form needs for prefill.

Neither client has an own-listings screen today (`/marketplace/mine` is not called by either), so both get a "My listings" view and an edit screen that reuses the compose form.

**Added later (bugs B1 to B3, spec addendum US4 to US6).** Three Expo flows did not save media and showed no progress: a new listing's photos, the profile avatar and Threads media. Confirmed cause (research R11): the server's `media-upload` request budget was 8 s and counts the time a phone takes to send the file, so slower uploads were answered 503. Fixed by raising it to 25 s (under the 30 s `requestTimeout`), pinned by a real-socket test. The app now uploads members' files through `useMediaUpload('member')` with the club loader and a percentage (`UploadProgress variant="spinner"`), and the listing form is one component, `components/listing-form.tsx`, serving both new and edit. Constitution Check: Principle V holds (Σ outbound 6 250 ms < 25 000 ms < 30 000 ms, asserted at boot); no native module was added.

## Technical Context

**Language/Version**: TypeScript (strict) on Node 22; server is Fastify 5 with Zod route schemas; web is React + Vite; app is Expo SDK 57 / React Native

**Primary Dependencies**: existing only: `@gwc/contracts` (shared types), `pg`, Fastify. No new packages. No new native module, so **no new EAS build** for the app.

**Storage**: PostgreSQL. One migration, `048_marketplace_listing_management.sql`: add `marketplace_listings.hidden_from_state`, plus one index for the staff listing page.

**Testing**: vitest (`npm run -w server test`, SQL suites need a DB), client `vitest` (`client/tests`); the Expo app has **no test runner** (only `lint` and `typecheck`), so app work is checked by those and by the quickstart scenarios; `tsc --noEmit` across workspaces. New server tests go in `server/tests/marketplace/`.

**Target Platform**: Linux server; modern browsers; iOS and Android via Expo.

**Project Type**: web service + web client + mobile app, all sharing `packages/contracts`.

**Performance Goals**: staff list p95 under 300 ms at 50k listings (keyset paging, no OFFSET). A state change is visible on the next request, with no cache to invalidate. Browse already filters `state = 'active'`.

**Constraints**: a route must declare its posture or the server will not boot. Queries in `application/` name their columns. Server emits no localised text. No inline style objects in the app. Every list shows a loader, never a false empty state.

**Scale/Scope**: about 5k members and 50k posts in the perf seed; each member capped at 20 listings by the existing quota. Four new or changed endpoints, one migration, about 6 web screens or components, about 4 app screens.

No `NEEDS CLARIFICATION` remain. See [research.md](./research.md).

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 (below).*

| Principle | Verdict | How this feature meets it |
|---|---|---|
| **I. One rule set, three clients** | Pass | "Editable", "publishable" and "staff-disabled" are decided server-side. The own-listing response carries `canEdit` and `canPublish` flags; the clients only use them to decide what to *display*, and the server re-checks every write. All new request/response types go in `@gwc/contracts/marketplace`, not in either client. |
| **II. Declare every posture** | Pass | Both new routes declare `config.auth` (member; staff `marketplace_moderation.read`). Ownership is enforced against the loaded row inside the transaction and answers 404, never 403. The authz matrix test's route list is extended. |
| **III. Published state matches real state** | Pass | A draft or staff-disabled listing is absent from browse, detail, search, the public `/marktplatz` counts and notifications, because every read already filters `state = 'active'` (no cache). Tests assert it for the new `draft`-at-create path. |
| **IV. Integrity lives in the database** | Pass | `hidden_from_state` has a CHECK tying it to `state = 'hidden'`. State changes use `FOR UPDATE`. The job-offer trigger still refuses publishing a draft job offer. Audit is written after commit, as `manage.ts` and `moderate.ts` already do. No hard delete by members. |
| **V. Failure explicit and bounded** | Pass | No outbound dependency is added. Routes use the existing `marketplace` / `admin-read` budgets. |
| **VI. The server shapes what leaves it** | Pass | Queries name their columns (covered by `no-select-star.test.ts`). The staff list returns owner display name only, never contact details (new PII scan test). Media derivatives are unchanged; the original is still never served. |

**Constraints from CLAUDE.md that this plan honours**: ownership refusals are 404 and indistinguishable from an absent id; staff moderate but do not rewrite (`write`/`edit` stay unused on `marketplace_moderation`); `/marktplatz` remains aggregate-only; `expires_at IS NULL` means unlimited; the job-offer rule applies to publishing; no `SELECT *`; every client failure goes to `console.error`, not state; styles in `StyleSheet.create`; strings in both catalogues.

**Post-design re-check**: still passes. One tension is recorded under Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/037-marketplace-listing-management/
├── plan.md                    # This file
├── research.md                # Phase 0: decisions and rejected alternatives
├── data-model.md              # Phase 1: columns, state machine, version token
├── quickstart.md              # Phase 1: how to prove it end to end
├── contracts/
│   ├── member-listings.md     # create/edit/own-read changes
│   └── staff-listings.md      # staff list + disable/enable
├── checklists/requirements.md
└── tasks.md                   # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
packages/contracts/src/
├── marketplace.ts             # + publish on CreateListingRequest, UpdateListingRequest,
│                              #   OwnListing (version, canEdit, canPublish, moderated),
│                              #   StaffListingRow/Page/Query, EDITABLE_STATES
└── errors.ts                  # + MARKETPLACE_NOT_EDITABLE (409)

server/
├── migrations/048_marketplace_listing_management.sql
└── src/modules/marketplace/
    ├── routes.ts              # PATCH gains published+version; + GET /marketplace/mine/:id
    ├── controller.ts          # map new errors; own-listing shaping
    ├── staff-routes.ts        # + GET /admin/marketplace/listings
    ├── staff-controller.ts
    └── application/
        ├── create.ts          # `publish` flag -> draft or active
        ├── manage.ts          # editable-state check, version, publish/unpublish, ownListing()
        ├── moderate.ts        # hide from draft|active, remember origin; restore to origin;
        │                      # + browseForModeration()
        └── browse.ts          # unchanged (state = 'active' is the visibility rule)
server/tests/marketplace/
    edit.test.ts, publish.test.ts, concurrency.test.ts,
    staff-listings.test.ts, moderation-origin.test.ts, staff-no-pii.test.ts

client/src/
├── member/Marketplace.tsx     # compose form gains Publish checkbox + edit mode; "My listings" tab
├── member/MyListings.tsx      # new: own listings with state, Edit, publish toggle
├── console/admin/Marketplace.tsx   # + "All listings" tab beside the report queue
├── i18n/de.ts, en.ts          # new keys, both locales
└── tests/                     # edit/publish/staff list; i18n parity

expo-client/german-world-club/src/
├── app/(member)/marketplace/mine.tsx          # new: own listings
├── app/(member)/marketplace/edit/[id].tsx     # new: edit (reuses compose fields)
├── app/(member)/marketplace/new.tsx           # + Publish switch
├── api/endpoints.ts           # mine(), mineOne(), update()
└── i18n/de.ts, en.ts
```

**Structure Decision**: extend the existing `modules/marketplace` (routes / controller / application) and the existing screens. The compose form on each client gains an *edit mode* instead of being duplicated, so the field list, validation and layout stay one definition per client. Staff UI is web-only; the app has no staff console.

## Complexity Tracking

| Tension | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| The header comment of `client/src/console/admin/Marketplace.tsx` says "there is no separate listing browser here" and frames moderation as complaint-driven only. This feature adds one. | The request is explicitly for staff to find a bad record on their own initiative. | Leaving moderation report-only cannot satisfy it. The comment is rewritten to say why the browser exists. The decision it protected survives: the browser calls only `read`, `status` and `delete` routes, so staff still cannot edit what a member wrote. |
| Staff UI says "Disable"/"Enable" but the endpoints stay `hide`/`restore`. | Spec uses the staff-facing word; existing audit actions, tests and the member-facing `hidden` state already use hide/restore. | Renaming endpoints and audit actions would break existing audit queries and tests for a wording change; the label is an i18n string only. |

No constitution violation requires justification.
