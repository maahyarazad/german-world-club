# Implementation Plan: Every member can post on the Marketplace, except job offers

**Branch**: `021-member-marketplace-posting` | **Date**: 2026-11-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/021-member-marketplace-posting/spec.md`

## Summary

Posting a listing no longer needs the per-member `marketplace_post` permission. Every onboarded,
active member can post after accepting the terms, and the key is retired.

A member may not create a **job offer**. Which modes a category allows becomes part of the shared
category definition in `@gwc/contracts/marketplace` (job: `request` only):
- The server refuses other combinations with a new `422 marketplace/mode-not-allowed`.
- A database trigger refuses the creation of a job offer: insert, change into one, or publish a
  draft. Updates to existing job offers still pass, so they wind down as before.
- Both compose forms show only the allowed modes, read from `GET /marketplace/categories`.

The business description was updated during `/speckit-specify` (local file, gitignored).

## Technical Context

**Language/Version**: TypeScript on Node 22 (server, run with type stripping), React 19 + Vite
(web), Expo SDK 57 / React Native (app)

**Primary Dependencies**: Fastify 5, zod, pg; `@gwc/contracts` shared package

**Storage**: PostgreSQL. A new migration `042_member_marketplace_posting.sql` adds a trigger and
strips the retired key. No new table or column.

**Testing**: vitest (server against `gwc_test`, web with Testing Library), `tsc --noEmit`, expo
lint

**Target Platform**: Linux server; modern browsers; iOS and Android

**Project Type**: web service + web client + mobile app (monorepo with npm workspaces)

**Performance Goals**: unchanged. The trigger is a few comparisons per write to
`marketplace_listings`.

**Constraints**:
- Legacy job offers must stay updatable (filled, withdrawn, expiry, moderation), so a CHECK
  constraint is ruled out (research R4).
- Authorization stays resolved per request.

**Scale/Scope**: 3 route declarations, 1 contract change, 1 problem type, 1 migration, 2
application functions, seed, 2 compose forms plus 2 "New listing" gates, about 6 test files.

## Constitution Check

*GATE: must pass before Phase 0 research, and is re-checked after Phase 1 design.*

| Principle | Assessment |
|---|---|
| **I. One rule set, three clients** | Pass. The allowed modes live once, in `CATEGORY_DEFS`. The server enforces them, and the clients use the server-supplied definition for display only. The new problem type is in `@gwc/contracts/errors`. |
| **II. Declare every posture** | Pass. Removing `requires` is an explicit change in `routes.ts`, and every route keeps `config.auth` with `audience: 'member'`. The authz matrix rows change with it, and a new pin makes any future member flag gate visible. Authorization is still resolved per request. |
| **III. Published state matches real state** | Pass. No public surface changes. `/marktplatz` still shows aggregate counts only. |
| **IV. Integrity lives in the database** | Pass. "No new job offer" is enforced by a trigger, not only by the application. A CHECK constraint was considered and rejected because it would block legitimate updates to legacy rows (R4). Members are updated (key stripped), never deleted. No audit row is written for the retirement: it's a schema-level change, not a decision about a member. |
| **V. Failure is explicit and bounded** | Pass. The refusal is its own 422 problem. No new dependencies or budgets. |
| **VI. The server shapes what leaves it** | Pass. `GET /marketplace/categories` gains a `modes` array from the shared definition. No new fields reach other responses. |

Post-design re-check: unchanged, all pass. Nothing goes in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/021-member-marketplace-posting/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R7
├── data-model.md
├── quickstart.md
├── contracts/
│   └── http-and-ui.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source code (repository root)

```text
packages/contracts/src/
├── marketplace.ts        # CategoryDef.modes, modesFor()
├── permissions.ts        # MEMBER_PERMISSIONS loses 'marketplace_post'
└── errors.ts             # PROBLEMS.MARKETPLACE_MODE_NOT_ALLOWED

server/
├── migrations/042_member_marketplace_posting.sql   # trigger + strip retired key
├── src/modules/marketplace/
│   ├── routes.ts                 # three `requires` removed; comments updated
│   ├── controller.ts             # map ListingModeNotAllowedError + constraint → 422
│   └── application/
│       ├── create.ts             # modesFor check before quota
│       └── manage.ts             # editListing: check on category change
├── src/seed/members.ts           # no marketplace_post
├── src/seed/marketplace.ts       # owners = active profiled members; no job-offer slots
└── tests/
    ├── marketplace/posting.test.ts, audience.test.ts, definitions.test.ts, helpers.ts, quota.test.ts
    ├── marketplace/job-offer.test.ts   # new
    └── authz/matrix.test.ts

client/
├── src/member/Marketplace.tsx    # New listing for every member; modes from the definition; note
├── src/i18n/de.ts, en.ts         # memberMarketplace.jobOfferNote
└── tests/member/marketplace-compose.test.tsx, marketplace.test.tsx

expo-client/german-world-club/src/
├── app/(member)/marketplace/index.tsx   # canPost = member
├── app/(member)/marketplace/new.tsx     # modes from the definition; note
├── api/endpoints.ts                     # comment only
└── i18n/de.ts, en.ts                    # marketplace.jobOfferNote

CLAUDE.md                                 # marketplace paragraph: posting is open, no job offers
```

**Structure decision**: the existing monorepo layout. All changes extend feature 008/017 files,
and no module is added.

## Complexity Tracking

None.
