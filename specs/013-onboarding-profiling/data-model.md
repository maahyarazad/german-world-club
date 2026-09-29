# Data Model: Onboarding Phase 2 — Profiling Workflow

Migrations: `server/migrations/032_profiling.sql` (next after `031_members_mobile_unique.sql`), and
`server/migrations/033_profiling_future_work.sql` (added after the business description grew the
German Q5 branch into conditional follow-up questions — FR-009–FR-011, FR-022). `032` had already
been applied to working databases by the time the follow-up requirement landed, so the new columns
are a second migration rather than an edit to `032`'s `CREATE TABLE`, the same discipline the seed
data inside `032` was itself corrected to follow after drifting from a live database once already.

## `gwc_cities`

A designated club city, maintained independently of any member's submission (research R4).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | |
| `country` | `char(2) NOT NULL` | ISO 3166-1 alpha-2, `CHECK (country ~ '^[A-Z]{2}$')` — same shape as `members.country_of_residence`. |
| `city` | `text NOT NULL` | |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

**Constraint**: `UNIQUE (country, city)`.

Seeded with a small initial set of rows directly in the migration (Assumption in spec.md: a
dedicated management UI is out of scope for this feature's minimum scope).

## `member_profiling`

One row per member who has answered at least one profiling question. Absence of a row means "not
started" — same reasoning as `membership_applications`'s "absence is meaningful" (`020_onboarding.sql`):
a nullable `completed_at` alone could not distinguish "never started" from "started, not finished"
for resumability purposes as cleanly as row-presence can for the *branch* decision, since `branch`
must be frozen at first-answer time (research R3).

| Column | Type | Notes |
|---|---|---|
| `member_id` | `uuid PRIMARY KEY REFERENCES members (id) ON DELETE RESTRICT` | Members are never deleted (Constitution IV); matches every other member sidecar table. |
| `branch` | `text NOT NULL CHECK (branch IN ('germany', 'elsewhere'))` | Captured once, from `members.country_of_residence` at the first answer (`= 'DE'` → `germany`, else → `elsewhere`, including `NULL`/unrecognized — see spec Edge Cases). Never recomputed. |
| `settling_status` | `text CHECK (settling_status IN ('know_where', 'need_help'))` | Germany Q1. |
| `languages` | `text[]` | Germany Q2. Element values are language codes from `packages/contracts/src/profiling.ts`'s `LANGUAGES` list; validated at the application layer (an array `CHECK` against a mutable reference list is impractical in SQL, unlike the fixed enums below — same reasoning as `member_designations`' array-shaped columns, if any). |
| `qualification_level` | `text CHECK (qualification_level IN (...8 values...))` | Germany Q3. Values match `QUALIFICATION_LEVELS` in contracts. |
| `occupation` | `text CHECK (occupation IN (...17 values...))` | Germany Q4. Values match `OCCUPATIONS` in contracts. |
| `desired_work_type` | `text CHECK (desired_work_type IN (...4 values...))` | Germany Q5. Values match `DESIRED_WORK_TYPES` in contracts. |
| `future_work_sector` | `text` | Germany, `desired_work_type = 'employee'` only (FR-009): which business sector/industry. |
| `future_work_ready` | `boolean` | Germany, `desired_work_type = 'employee'` only (FR-009): ready to work in that field. |
| `future_work_offering` | `text` | Germany, `desired_work_type IN ('freelance', 'own_business')` only (FR-010): what they want to offer. |
| `future_work_idea` | `text` | Germany, `desired_work_type IN ('freelance', 'own_business')` only (FR-010): the product/service idea. |
| `future_work_priorities` | `text[]` | Germany, `desired_work_type = 'not_sure'` only (FR-011): one or more of `FUTURE_WORK_PRIORITIES`. Validated at the application layer, like `languages` above. |
| `primary_city_country` | `char(2) CHECK (primary_city_country ~ '^[A-Z]{2}$')` | Elsewhere branch. |
| `primary_city_name` | `text` | Elsewhere branch. |
| `secondary_city_1_country` | `char(2) CHECK (...)` | Elsewhere branch. |
| `secondary_city_1_name` | `text` | Elsewhere branch. |
| `secondary_city_2_country` | `char(2) CHECK (...)` | Elsewhere branch. |
| `secondary_city_2_name` | `text` | Elsewhere branch. |
| `matched_gwc_city_id` | `uuid REFERENCES gwc_cities (id) ON DELETE RESTRICT` | Elsewhere branch. `NULL` until resolved; set at the same time `outcome` is set. |
| `outcome` | `text CHECK (outcome IN ('in_person_meeting', 'gwc_city_match'))` | Elsewhere branch. Set only when `completed_at` is set. |
| `completed_at` | `timestamptz` | `NULL` until the branch's required answers are all present. Once set, immutable (see trigger below). |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Bumped by the same trigger that enforces immutability. |

**Constraints**:
- `member_profiling_germany_fields_only_in_germany_branch`: `CHECK (branch = 'germany' OR
  (settling_status IS NULL AND languages IS NULL AND qualification_level IS NULL AND occupation IS
  NULL AND desired_work_type IS NULL))` — a row cannot carry the other branch's answers.
- `member_profiling_elsewhere_fields_only_in_elsewhere_branch`: the symmetric `CHECK` for the six
  city columns, `matched_gwc_city_id` and `outcome`.
- `member_profiling_outcome_only_when_complete`: `CHECK (outcome IS NULL OR completed_at IS NOT
  NULL)`.
- `member_profiling_match_implies_gwc_outcome`: `CHECK ((matched_gwc_city_id IS NULL) = (outcome IS
  DISTINCT FROM 'gwc_city_match'))`.
- `member_profiling_future_work_matches_desired_work_type` (added in `033`): a row may only carry the
  follow-up columns for the `desired_work_type` it actually holds —
  `desired_work_type = 'employee'` is the only case where `future_work_sector`/`future_work_ready`
  may be non-null; `desired_work_type IN ('freelance', 'own_business')` the only case for
  `future_work_offering`/`future_work_idea`; `desired_work_type = 'not_sure'` the only case for
  `future_work_priorities`. All five are `NULL` when `desired_work_type` is itself `NULL`. This is
  the same mutual-exclusion pattern as the germany/elsewhere `CHECK`s above, one level deeper.

**FR-022** (switching the Q5 answer before completion discards its old follow-up) is enforced by the
application layer in `submit.ts`, not a trigger: the constraint above would refuse to persist stale
follow-up data alongside a new `desired_work_type` value in the same row, so `submitGermany` clears
whichever of the five follow-up columns don't belong to the incoming `desiredWorkType` whenever that
field is present in a `PATCH` body — the constraint is the backstop that makes skipping this step in
application code a write failure rather than a silent data-integrity gap.

**Trigger** `member_profiling_complete_is_final` (`BEFORE UPDATE`), mirroring
`membership_applications_decision_is_final` (`020_onboarding.sql:59-65`):

```sql
IF OLD.completed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'profiling for % is already complete', OLD.member_id;
END IF;
NEW.updated_at := now();
```

This is what enforces spec FR-017 (no member-facing edits after completion) at the database layer,
not the application layer (Constitution IV).

## Relationship to existing entities

```text
members (1) ──< membership_applications (0..1)   -- existing (020_onboarding.sql)
members (1) ──< member_profiling (0..1)           -- new
gwc_cities (1) ──< member_profiling (0..*)         -- via matched_gwc_city_id, new
```

`member_profiling` has no foreign key *from* `membership_applications` — the auth gate (research
R2) is the only place the two are joined, and only to decide whether the gate applies
(`application_state = 'approved'`), never to constrain what profiling data may exist.

## State transitions

```text
(no row)
   │ first PATCH /profiling answer
   ▼
in progress (completed_at IS NULL, branch fixed, some fields filled)
   │ last required answer for the branch arrives
   ▼
complete (completed_at set; for 'elsewhere', outcome + matched_gwc_city_id set atomically)
   │
   ▼
immutable (any further UPDATE attempt raises)
```

There is no path back to "in progress" or "no row" — consistent with `membership_applications`'
one-way decision and the spec's explicit non-goal of member-editable answers post-completion.
