# Research: Every member can post on the Marketplace, except job offers

## R1. Posting stops requiring `marketplace_post`

**Decision**: remove `requires: 'marketplace_post'` from the three routes that declare it in
`server/src/modules/marketplace/routes.ts`:
- `POST /marketplace/listings`
- `POST /marketplace/listings/:id/media`
- `DELETE /marketplace/listings/:id/media/:assetId`

They keep `audience: 'member'`. `10-auth` already refuses applicants in onboarding or profiling,
and locked or ended members, on every member route (spec FR-001). Terms acceptance stays in
`application/create.ts` (FR-002), and the per-member live-listing quota stays as it is.

**Rationale**:
- The clarification (FR-003) rules out a per-member posting ban, so there's nothing left for a
  flag to say.
- Removing the declaration keeps the change in the diff (Principle II): posting being open is
  visible exactly where it used to be gated.
- The `requires` mechanism in `plugins/10-auth.ts` stays. It's generic, cheap, and the obvious
  tool for the next flag-gated route.

**Alternatives considered**:
- *Default the flag to true for every member*: keeps a dead control, and needs every member row
  rewritten, plus new members defaulted.
- *Keep the flag as a ban (inverted)*: rejected by the clarification.

## R2. Retire the `marketplace_post` key

**Decision**:
- Remove `marketplace_post` from `MEMBER_PERMISSIONS` in `packages/contracts/src/permissions.ts`.
  `thread_moderate` stays.
- Migration `042_member_marketplace_posting.sql` strips the key from stored member permissions:
  `UPDATE members SET permissions = permissions - 'marketplace_post' WHERE permissions ? 'marketplace_post'`.
- Clients stop reading it. "New listing" shows for every signed-in member (R5).

**Rationale**: `/auth/me` reports every `true` key in `members.permissions`. Leaving the key
would keep reporting a permission that grants nothing, and the next reader would assume it
matters. This is a retirement of a concept, not a decision about any one member, so it writes no
audit row. Members are updated, never deleted (Principle IV is untouched).

**Alternatives considered**: *leave the stored keys*: harmless at runtime, but misleading in
`/auth/me` and in the database.

## R3. "Which modes a category allows" is part of the category definition

**Decision**:
- `CategoryDef` in `@gwc/contracts/marketplace` gains `modes: readonly MarketplaceMode[]`:
  - vehicle, property and general: `['offer', 'request']`;
  - job: `['request']`.
- `modesFor(category)` is exported next to `requiredFieldsFor`.
- `GET /marketplace/categories` already returns `Object.values(CATEGORY_DEFS)`, so both clients
  receive `modes` with no route change.

**Rationale**: Principle I. The server enforces the rule from this definition, and the clients
use the same server-supplied data only to decide what to *display*. One definition, so the form
and the server can't disagree about which combinations exist.

**Alternatives considered**: *hard-code "no job offer" in each compose form*: three copies of
one rule, which is the defect Principle I names.

## R4. Enforcement: application check plus a database trigger

**Decision**:
- **Application**, giving a clean refusal:
  - `createListing` checks `modesFor(category).includes(mode)` before reserving quota.
  - `editListing` checks the final `(category, row.mode)` when the category changes (mode isn't
    editable).
  - Both throw `ListingModeNotAllowedError`, answered as the new problem (R6).
- **Database**, the guarantee (Principle IV): migration 042 adds the trigger
  `marketplace_listings_no_new_job_offer`, `BEFORE INSERT OR UPDATE OF category, mode, state`.
  It raises `check_violation` (constraint name `marketplace_no_new_job_offer`) when
  `NEW.category = 'job' AND NEW.mode = 'offer'` and any of these holds:
  - `TG_OP = 'INSERT'`;
  - `OLD.category <> 'job' OR OLD.mode <> 'offer'`, so the row is *becoming* a job offer;
  - `OLD.state = 'draft' AND NEW.state = 'active'`, so a legacy draft is being published
    (FR-009).
- The controller maps that constraint violation to the same problem, should a path ever skip
  the application check.

**Rationale**:
- A `CHECK (NOT (category = 'job' AND mode = 'offer'))` would be the obvious constraint, and it's
  wrong. Postgres re-checks a CHECK on *every* update of the row, so marking a legacy job offer
  `filled` or `withdrawn`, or expiring it, would fail, which breaks FR-008. Even `NOT VALID` only
  skips the initial scan.
- The trigger refuses only the *creation* of a job offer: insert, change into one, or publish a
  draft. Updating an existing one passes.
- Expiry (`marketplace-expiry`), moderation (hide, restore, remove) and owner terminal states
  change `state` from `active` only, so they pass.

## R5. Clients

**Decision**:
- **Who sees New listing**: every member (`snapshot.kind === 'member'` on the web,
  `me.kind === 'member'` in the app). The permission check is removed in
  `client/src/member/Marketplace.tsx` and `expo-client/.../(member)/marketplace/index.tsx`.
- **Mode control** (web `ComposeListing` in `Marketplace.tsx`, app `marketplace/new.tsx`):
  - show only `activeDef.modes`;
  - when the category changes and the current mode isn't allowed, switch to the first allowed
    mode;
  - when a category allows only one mode, show a short note (job:
    `memberMarketplace.jobOfferNote` / `marketplace.jobOfferNote`, "Members can look for work
    here. Job offers aren't available to members.").
- **The refusal problem**: logged per CLAUDE.md, and shown as the same note, because the member
  can't proceed without knowing why. It's only reachable with a stale categories response.
- **Browse filters**: unchanged. "Job" and both modes stay filterable, because legacy job offers
  are still visible (FR-012).

## R6. A problem type of its own

**Decision**: add `MARKETPLACE_MODE_NOT_ALLOWED` to `PROBLEMS`:
`{ type: …/marketplace/mode-not-allowed, title: 'Mode not allowed for this category', status: 422 }`.

**Rationale**:
- FR-005 requires the refusal to be distinct from `permission-required` (403) and from
  `validation-failed` (400, field errors).
- 422: the request is well formed, but the platform's rules refuse the combination. That's the
  same reasoning as `quota-exceeded`.
- It's named after the general rule (a category's allowed modes), not "job", so a future
  restriction reuses it.

## R7. Demo seed and tests

**Decision**:
- **Seed**:
  - `seed/members.ts` stops setting `marketplace_post`.
  - `seed/marketplace.ts` picks owners from active demo members with completed profiling, not
    flagged ones.
  - The four job-**offer** slots leave `PLAN`. The plan builds from `modesFor(category)`.
  - The seed never disables the trigger (CLAUDE.md: a seeder that disables a trigger is one
    tab-completion from the wrong database).
- **Tests**:
  - `tests/marketplace/posting.test.ts`: a member with **no** permissions can post (the old
    refusal case is turned into the admit case), and a job offer is refused with the new problem
    and stores nothing. Counter-assertion: a job request from the same member succeeds.
  - `tests/marketplace/job-offer.test.ts` (new):
    - creating or editing into a job offer is refused;
    - the database trigger refuses a direct insert and a draft publish;
    - a legacy job offer can still be edited, marked filled or withdrawn, and expired by the job.
    - Legacy rows are created the way pre-migration rows came to exist: inserted inside a
      transaction with `SET LOCAL session_replication_role = replica`, test database only.
  - `tests/marketplace/audience.test.ts`: posting's posture is `audience: 'member'` with no
    `requires`. A merchant, a partner and staff are still refused.
  - `tests/authz/matrix.test.ts`:
    - the three rows lose `requires`;
    - the two flag sweeps are replaced by one that asserts a member with no flags is not 403 on
      the posting routes;
    - a pin that no member route declares `requires` today, so adding one is a visible change to
      that test.
  - `tests/marketplace/definitions.test.ts`: every category's `modes` is non-empty and a subset
    of `MARKETPLACE_MODES`.
  - Web: `tests/member/marketplace-compose.test.tsx` and `marketplace.test.tsx`:
    - a member with no flags sees New listing;
    - choosing Job leaves only Request and shows the note.
  - App: `tsc` plus lint.
