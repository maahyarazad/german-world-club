# Implementation Plan: Member Marketplace (Classifieds)

**Branch**: `008-marketplace` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-marketplace/spec.md`

## Summary

Implement BUSINESS_DESCRIPTION.md §7's member classifieds: three structured
categories (vehicle, real estate, job), offer-or-request, multiple photos, a
configurable contact method, gated behind the per-member `marketplace_post` flag
and terms acceptance, with staff moderation through the existing
`marketplace_moderation` module.

The platform is already scaffolded for this. The permission flags, the
never-indexed crawl posture, the ownership guard, the media pipeline, the quota
counters and the audit log all exist and are used as they are. What is missing is
schema, routes, contracts and screens.

The central design decisions are a common listings table with one detail table
per category (research.md R2), the ~40 vehicle checkboxes as a catalogue plus
join table rather than 40 columns (R3), and a contact *preference* rather than a
copied contact *value* (R9).

The contact method is **in-platform messaging**, and this feature builds its
persistence and the inquiry flow; real-time transport comes later, in the order
the Technology Baseline states (R13). The marketplace ships to **three surfaces**
— staff console, member web tab, member mobile tab — over one API.

**This feature lands mid-migration and that is its biggest risk** — see R1 and
Complexity Tracking.

## Technical Context

**Language/Version**: TypeScript on Node 22 via native type stripping, no build
step. `strict`, `erasableSyntaxOnly`.

**Primary Dependencies**: Fastify 5, PostgreSQL via `pg`, sharp (already, through
the media pipeline), React 19 + Vite 8 for the console. **Zod**, while feature
007 Phase 6 has not run — see Complexity Tracking.

**Storage**: PostgreSQL. Two migrations, separate because they are separate
domains that happen to arrive together:

- `018_messaging.sql` — `conversations`, `conversation_participants`, `messages`.
  First, because the marketplace references it.
- `019_marketplace.sql` — `marketplace_listings`, three detail tables,
  `vehicle_features` + `marketplace_vehicle_features`,
  `marketplace_listing_photos`, `marketplace_reports`,
  `marketplace_terms_acceptances`.

**Testing**: Vitest. SQL-backed suites skip loudly without a database, which
means the concurrency assertion in SC-005 must be written so that skipping is
visible rather than passing.

**Target Platform**: Gated member surface (web + mobile), staff console, and
**one public discovery page** that shows aggregate counts and no listings (US7).
Two surfaces with two postures, declared separately.

**Project Type**: Feature module inside the existing workspace monorepo —
`server/src/modules/marketplace/` split `routes.ts` / `controller.ts` /
`application/`, per feature 006.

**Performance Goals**: The index query is the hot path. Keyset pagination with a
partial index on the active set (R8), and it carries a join to the owner's status
(R7) which the index must account for.

**Constraints**:
- Every route declares `config.auth` or the server does not boot.
- Page size is coerced and bounded **in the handler**, not only in a schema that
  Phase 6 deletes (R8).
- Quotas in PostgreSQL under a row lock — 422, never 429.
- Photos never serve the original.

**Scale/Scope**: ~11 tables across two migrations, ~16 endpoints, **3** surfaces,
3 category field sets, ~40 vehicle features as data, plus the mobile
prerequisites in R14.

**Resolved (2026-09-22)** — all three former unknowns:

1. **Three surfaces, one API.** Staff moderation at `/konsole/admin/angebote`
   (replacing `NotBuilt`), a member tab in the web application, and a member tab
   in the Expo app. All call one member-or-staff API; cookies for the browser,
   bearer tokens for mobile, which Principle I permits while requiring the
   authorization outcome to be identical. **Still gated and never-indexed** —
   "one shared API" is not "an unauthenticated one".
2. **The contact method is in-platform messaging, built here** — persistence and
   the inquiry flow. Real-time transport is a later feature, in the order the
   Technology Baseline states (R13).
3. **Expiry is optional and may be unlimited**; `expires_at IS NULL` means never
   expires and is a first-class choice. The quota default remains configuration.

**Remaining risk, newly sized**: `expo-client/german-world-club` is a scaffold —
outside the npm workspaces, no `@gwc/contracts`, no API client, no auth (R14).
Mobile parity has prerequisites the web face does not.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against constitution **2.0.0**.

### Pre-Phase 0

**Result: PASS**, with one item to hold onto (VI).

| Principle | Verdict | Detail |
|---|---|---|
| I. One Rule Set, Three Clients | **PASS, conditional on R14** | All types in `@gwc/contracts` (FR-022). Category validation is server-side; a client may shape its form from the same definition but is never the enforcement point (FR-009). Entitlement is resolved server-side per request. Web and mobile share one API with differing auth *mechanism* and identical *outcome* (FR-031) — which the principle explicitly permits. **The condition**: the Expo app cannot import the shared package until it joins the workspace (FR-032). Until then it would have to redeclare shapes, which is the divergence this principle exists to prevent. |
| II. Declare Every Posture | **PASS** | Every route declares `config.auth`, enforced by the surviving boot gate (FR-019). `/marketplace` keeps its existing gated, never-indexed declaration (FR-020, FR-037); the US7 discovery page is a **separate surface with its own public-and-indexed declaration** (FR-034). Two postures, stated independently, rather than one relaxed. Ownership is enforced against the loaded row inside the transaction (FR-003), which is exactly what the principle says route-level declarations cannot express. |
| III. Published State Must Match Real State | **PASS** | Withdrawn, sold, expired and hidden listings return not-found or gone, never a success carrying fallback content (FR-012). Owner visibility is joined live rather than denormalised (R7) — a cached copy is what this principle forbids. |
| IV. Integrity Lives In The Database | **PASS** | Listing quota under a row lock via `db/counters.ts` (FR-021). Vehicle features are a foreign key, so an unknown feature is impossible rather than unlikely (R3). Members never hard-delete (FR-005). Audit is append-only by revoked grant (FR-018). |
| V. Failure Is Explicit And Bounded | **PASS** | No new outbound dependency. Media work already runs under the `mediaImage` breaker with its declared fail-closed policy. Route deadline budgets apply as for any route class; the index query's budget must be declared. |
| VI. The Server Shapes What Leaves It | **CONDITIONAL PASS** | Uploads reuse the pipeline, so content inspection, metadata stripping, bounded decoded size and derivative-only delivery are inherited (FR-013, FR-014). **The clause that no longer protects this feature** is the amended one: responses are no longer serialized through an explicit schema. A marketplace listing joins member and contact data, so a `SELECT *` here leaks further than most. See Complexity Tracking. **On the US7 public page**: no member content leaves the server at all — aggregate counts are club facts, not member data — so the "even partially" clause is not engaged. |
| Tech Baseline — public rendering | **PASS** | The US7 discovery page delivers meaningful content in the initial response with no JavaScript, like the other public landing pages. It is the only public surface this feature adds. |
| Tech Baseline — real-time transport | **PASS** | The Baseline requires a message to be persisted before it is delivered, so a dropped connection never loses data. This feature builds persistence and delivers on read (FR-025); real-time is additive and later (R13). SC-011 asserts the ordering by failing the notification path and confirming the message survives. |
| Tech Baseline — credentials | **PASS** | Untouched. Mobile bearer tokens and `deviceId` device-approval already exist; R14 wires an existing server capability to a client that has not used it. |
| Workflow — every principle verifiable | **PASS** | SC-001 to SC-009 each name an automated check. SC-008 covers the boot gate explicitly so it is tested rather than assumed. |
| Workflow — staff-editable where the business owns it | **PASS** | The vehicle-feature catalogue is a table under the permission system, not a column list requiring engineering (R3). |

### Post-Phase 1 re-check

Design did not change the verdict. Three things sharpen it:

1. **Principle VI's gap is this feature's sharpest edge.** Constitution 2.0.0
   removed response-shape enforcement and named no replacement. A listing
   response joins listing, owner and contact-preference data, so the surviving
   discipline — `application/` queries name their columns explicitly, never
   `SELECT *` — is doing real work here. `specs/007-typescript-migration/contracts/http-boundary-contract.md`
   already asserts no `SELECT *` on a response path; this feature must be covered
   by that assertion, not exempt from it.
2. **R9 is a Principle III finding in disguise.** Storing a contact *value* on a
   listing would be a cached copy of personal data that a later privacy change
   could not reach. Resolving the *preference* at render time keeps the settings
   authoritative.
3. **R7 costs a join on the hot path.** Correct per Principle III, and it means
   the partial index in R8 must cover the owner-status join or the index query
   degrades as the corpus grows. Measure it against the route's declared budget.
4. **Messaging makes Principle VI's gap wider, not narrower.** A conversation
   response carries two members' display identities and their message bodies.
   With response schemas gone (constitution 2.0.0), the explicit-columns rule is
   the only thing preventing a `members` column from reaching a chat transcript.
   FR-026 adds a specific assertion — no email or phone in any messaging
   response — because "name your columns" is a convention and this is the payload
   where forgetting it is worst.
5. **Principle I is now conditional on a build-system change.** That is unusual
   and worth flagging: the mobile face cannot satisfy the shared-package rule
   until `expo-client/german-world-club` is in `workspaces`. It is a one-line
   change to the root package.json, and until it is made, FR-032 is unachievable
   rather than merely unimplemented.

## Project Structure

### Documentation (this feature)

```text
specs/008-marketplace/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — 12 findings
├── data-model.md        # Phase 1 — entities, schema, state machine
├── quickstart.md        # Phase 1 — validation guide
├── contracts/           # Phase 1
│   ├── marketplace-api.md
│   ├── listing-categories.md
│   └── moderation-api.md
└── tasks.md             # Phase 2 — NOT created by /speckit-plan
```

### Source Code (repository root)

```text
server/
├── migrations/
│   ├── 018_messaging.sql            # NEW — conversations, participants, messages
│   └── 019_marketplace.sql          # NEW — 8 tables, 4 enums, partial indexes
└── src/
    ├── db/counters.ts               # + SCOPE.MARKETPLACE_LISTINGS
    ├── modules/messaging/           # NEW — persistence + inquiry, no transport
    │   ├── routes.ts
    │   ├── controller.ts
    │   └── application/
    │       ├── converse.ts          # start, reply, read
    │       └── inquire.ts           # the marketplace entry point
    └── modules/marketplace/         # NEW, per feature 006's split
        ├── routes.ts                # schema + posture + wiring
        ├── controller.ts            # request/reply shaping, bounded paging
        ├── categories.ts            # the three field sets, one definition
        └── application/
            ├── create.ts            # flag, terms, quota, detail row
            ├── browse.ts            # keyset paging, owner-status join
            ├── manage.ts            # edit, sold/filled, withdraw
            └── moderate.ts          # report, hide, remove

packages/contracts/src/
└── marketplace.ts                   # NEW — types + category definitions

client/
├── marktplatz.html                  # NEW — the US7 public discovery page, a
│                                    #   fourth Vite entry beside index/en/konsole
└── src/
    └── (no bundle — content and styles inline, like the other landing pages)

client/src/
├── console/admin/
│   └── Marketplace.tsx              # NEW — replaces NotBuilt at /konsole/admin/angebote
├── member/                          # NEW — the member area HOME_FOR_KIND points at
│   ├── MemberLayout.tsx             # the tab bar
│   └── Marketplace.tsx              # the member tab
└── i18n/{de,en}.ts                  # + marketplace and messaging strings, BOTH catalogues

expo-client/german-world-club/
├── package.json                     # + @gwc/contracts  (needs workspace membership)
├── src/lib/api.ts                   # NEW — bearer-token client (R14)
├── src/app/marketplace.tsx          # NEW — the mobile tab
└── src/components/app-tabs.tsx      # + a third NativeTabs.Trigger

package.json                         # workspaces += expo-client/german-world-club
```

**Structure Decision**: Follows feature 006 exactly — `routes.ts` declares schema
and posture, `controller.ts` shapes request and reply, `application/` holds the
rules and takes plain arguments. The category field sets live in
`packages/contracts` because the console's compose form and the server's
validation must be the same definition (Principle I); `categories.ts` on the
server is the enforcement that reads it.

**The public page carries no bundle.** `marktplatz.html` is a fourth Vite entry
alongside `index.html`, `en.html` and `konsole.html`, with its content and styles
inline. The two existing landing pages already work this way, and the reason
holds here: link-preview and most non-Google crawlers execute no JavaScript, and
a discovery page that needs a bundle to say what the marketplace is would be
invisible to exactly the clients it exists for.

**Two migrations, not one.** `018_messaging.sql` and `019_marketplace.sql` are
separate because they are separate domains: messaging outlives this feature and
will carry threads, contacts and system notifications later. Within each, the
tables are one migration because they are meaningless apart — a detail table
without its listing table is not a state the database should ever be in.

**The root `package.json` change is listed deliberately.** Adding the Expo app to
`workspaces` is the one line that makes Principle I satisfiable on the mobile
face, and burying it inside a client task is how it gets skipped.

## Complexity Tracking

> Filled only where the Constitution Check needs justification, plus one
> sequencing risk that is not a violation but will cost more than it looks.

| Item | Why | Simpler alternative rejected because |
|---|---|---|
| **Principle VI: responses unshaped** | Not a choice this feature makes — constitution 2.0.0 already removed the clause, for feature 007. Recorded because a listing response joins member and contact data, so the consequence is larger here than on the routes that were live when the amendment was written. | Re-introducing response schemas for this module alone would be the only module with them after Phase 6, and would be removed again days later. The mitigation is the explicit-columns rule and the existing no-`SELECT *` assertion. |
| **Building mid-migration** (R1) | Schedule. Waiting for 007 means 1225 type errors plus all of Phase 6 first. | *Wait for 007.* Genuinely cleaner and worth reconsidering if the marketplace is not urgent: every Zod schema this feature adds is work Phase 6 must then undo, and every business rule expressed inside one joins the 21 in 007's data-model.md §4 that must survive removal. This feature adds many — category-required fields, price bounds, photo counts. **That list must be updated by this feature, not left for Phase 6 to rediscover.** |
| **Three detail tables rather than one wide table** (R2) | The index filters on category-specific fields, and the database should be able to say `rooms` is meaningless on a job. | *One wide table with nullable columns* — ~60 mostly-null columns and a migration per field. *JSONB* — filtering on ranges needs an expression index per field, so the migration returns, and Principle IV wants invariants the database can read. |
| **Feature catalogue + join table** (R3) | §7 says "~40" and the tilde is the point: the set will change. A foreign key makes an unknown feature impossible, and a catalogue table is staff-editable as the Workflow section asks. | *40 boolean columns* — a migration per checkbox. *`text[]`* — good for the query, cannot answer "what features exist?" without scanning every listing, which the compose form needs. |

| **Messaging enters a marketplace feature** (R13) | §7's contact method has to be something, and the alternatives all store personal data on the listing (R9). Scoped to persistence and the inquiry flow only. | *Full §7 messaging here* — doubles the feature and ties the marketplace's release to the real-time stack. *A placeholder contact method* — makes the listing a second, stale home for an email address that a later privacy change cannot reach. *Messaging as its own feature first* — cleanest ordering, and the marketplace would wait on a feature it needs a corner of. Worth revisiting if threads or contacts are scheduled soon, since both need the same substrate. |
| **A second public surface** (US7) | Growth. Something has to be visible to a visitor, and the alternative reading — blurred real listings — is the case Principle VI names explicitly. | *Blur real listings.* Needs a constitution amendment to 3.0.0, and CSS blur is worse than it looks: the bytes reach the browser to be blurred, so view-source discloses them in full. A control that only appears to be one. *Nothing public at all.* Safe, and leaves the marketplace undiscoverable to anyone not already inside. |
| **Members only sell** (FR-038) | §5 is emphatic that a merchant is not a member, and organisations already sell through `offers` — benefit, validity window, remaining count, redemption code, terminal PIN. | *Audience-agnostic listings.* Would give one merchant two selling channels with different semantics (an offer is redeemed with a code; a listing is answered with a message), split `owner_id` into two nullable FKs with a CHECK, and require `config.auth.audience` to accept a list — which `plugins/10-auth.ts` does not support today, being a single `TOKEN_AUDIENCE` lookup. That is surgery on the most sensitive plugin in the server for a boundary §5 wants kept. If a unified *browse* is the real goal, a read view merging both tables is far cheaper. |
| **Mobile prerequisites** (R14) | "It goes to mobile as well" requires the Expo app to join the workspace, gain `@gwc/contracts` and gain bearer-token auth. None of it exists today. | *Copy the types into the Expo app* — precisely the second home for a rule Principle I forbids, and after 007 Phase 6 nothing would catch the drift at runtime either. *Defer mobile* — reasonable, and why US6 is P2; the work is real either way, deferring only moves when it is paid. |

**Not justified because not violated**: Principles II, III, IV, V hold outright.
Principle I holds **conditionally** — see the Constitution Check; the condition is
a one-line workspaces change, not a design compromise. The two boot gates that survive — `config.auth` and budget summation —
apply to this feature unchanged and for free.
