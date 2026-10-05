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

---

# Revision 2 (2026-09-29): `034_profiling_relationship.sql`

Additive; applies after `033`. Constraint names below are new unless marked *replaced*.

## Changes to `member_profiling`

| Column | Type | Notes |
|---|---|---|
| `yearly_income_range` | `text CHECK (yearly_income_range IS NULL OR yearly_income_range IN ('up_to_50k','50k_to_100k','over_100k'))` | Germany Q3. Added to `member_profiling_germany_fields_only_in_germany_branch` (*replaced*: drop + recreate with the extra column). |
| `relationship_tags` | `text[]` | **Both branches** (Q6). Not part of either branch-exclusive CHECK. |
| `desired_work_type` | CHECK *replaced* to allow `'business_owner'` | Values: `employee`, `freelance`, `business_owner`, `own_business`, `not_sure`. |

**Constraints**
- `member_profiling_relationship_tags_valid`: `relationship_tags IS NULL OR (cardinality(relationship_tags) >= 1 AND relationship_tags <@ ARRAY['single','partner','family','kids'] AND NOT ('single' = ANY(relationship_tags) AND cardinality(relationship_tags) > 1))`.
- `member_profiling_future_work_matches_desired_work_type` (*replaced*, from 033):
  `future_work_sector` only when `desired_work_type IS NOT NULL`; `future_work_ready` only `employee`;
  `future_work_offering` only `freelance`/`own_business`; `future_work_idea` only
  `freelance`/`own_business`/`business_owner`; `future_work_priorities` only `not_sure`.
- `member_profiling_outcome_only_when_complete` and `member_profiling_match_implies_gwc_outcome`
  unchanged. The elsewhere `outcome`/`matched_gwc_city_id` are now written by `POST /profiling/submit`,
  not by the city save.

## `member_profiling_kids`

| Column | Type | Notes |
|---|---|---|
| `member_id` | `uuid NOT NULL REFERENCES member_profiling (member_id) ON DELETE RESTRICT` | |
| `position` | `smallint NOT NULL CHECK (position BETWEEN 1 AND 20)` | 1-based; the kid count is the row count. |
| `age_range` | `text NOT NULL CHECK (age_range IN ('age_0_6','age_6_14','age_14_18','age_18_plus'))` | |
| | `PRIMARY KEY (member_id, position)` | |

## `member_profiling_partner`

| Column | Type | Notes |
|---|---|---|
| `member_id` | `uuid PRIMARY KEY REFERENCES member_profiling (member_id) ON DELETE RESTRICT` | |
| `settling_status` | same CHECK as the member's own | Partner Q1 |
| `languages` | `text[]` | Partner Q2 (validated in app, as the member's own) |
| `yearly_income_range` | same CHECK | Partner Q3 |
| `qualification_level` | same CHECK as `member_profiling` | Partner Q4 |
| `occupation` | same CHECK | Partner Q5 |
| `created_at`, `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

No name or contact detail is stored for the partner (spec Assumptions).

## Triggers

`member_profiling_children_are_final` (`BEFORE INSERT OR UPDATE OR DELETE` on both new tables):
`IF EXISTS (SELECT 1 FROM member_profiling WHERE member_id = COALESCE(NEW.member_id, OLD.member_id)
AND completed_at IS NOT NULL) THEN RAISE EXCEPTION`. Before completion, deletes are allowed (they
are how the cascade in research R14 removes stale kids/partner rows); after, none. A row for the
parent must exist first, so the first kids/partner/tags write creates the `member_profiling` row
(branch frozen, exactly as today).

## State transitions (revised)

```text
(no row) ── first PATCH ──▶ in progress (answers freely re-written, children added/removed)
in progress ── POST /profiling/submit (all applicable steps answered) ──▶ complete
complete ──▶ immutable (parent + kids + partner, all by trigger)
```

Only `POST /profiling/submit` moves in-progress → complete; a PATCH never does.
Completed rows from before this revision are unchanged (research R15).

## Entities

```text
members (1) ──< member_profiling (0..1) ──< member_profiling_kids (0..20)
                                       └──< member_profiling_partner (0..1)
```

---

# Revision 3 (2026-09-29): `035_profiling_industry_single_priority.sql`

- `member_profiling_partner.settling_status` is dropped (the partner is not asked where they will settle). Data in it is discarded; it was never shown to staff.
- `future_work_sector` holds one of 21 industry codes (`INDUSTRIES` in contracts) — `member_profiling_future_work_sector_is_listed`, **`NOT VALID`** so already-complete rows (immutable by trigger) with earlier free text are never re-checked. Unfinished profiles have their sector cleared so the question is asked again.
- The "not sure" statement is a single choice: the column stays `future_work_priorities text[]` (older complete rows may hold several) and `member_profiling_future_work_priority_single` (`cardinality = 1`, also `NOT VALID`) binds every new write. The API exposes it as `futureWorkPriority` (the first element). Unfinished multi-selections keep their first element.


---

# Revision 4 (2026-09-30): `036_onboarding_rules.sql`, `037_world_cities.sql`

**members**: `primary_language text` (`german` | `non_german`, nullable — members who never apply have none), `age_confirmed_at timestamptz`.
**membership_applications**: `decided_automatically boolean NOT NULL DEFAULT false` (`reviewed_by` stays NULL for both automatic decisions).
**member_profiling**: `settling_country`, `settling_city`, `settling_work_duration` (`under_1|1_3|3_5|5_10|over_10`), `future_work_business_activities text[]`; income CHECK gains `over_500k`, `over_1m`; the future-work CHECK is replaced (industry for employee/freelance/own_business/business_owner and never for `not_sure`; ready employee-only; offering and idea freelance/own_business; activities business_owner-only; priorities not_sure-only; `NOT VALID`); the single-priority CHECK from `035` is dropped and replaced by a multi-value one; `member_profiling_match_implies_gwc_outcome` is replaced by `member_profiling_outcome_agrees_with_match` (a match may exist before an outcome; an outcome must agree with it).
**member_profiling_partner**: `settling_status`, `settling_country`, `settling_city`, `settling_work_duration` restored; income CHECK widened.
**world_cities** (`037`): `country char(2)`, `city`, `region`, `is_capital`; unique on `(country, lower(city))` because Tripoli exists in two countries. Loaded idempotently from `server/data/internations-cities.json` (converted from the workbook by `server/src/scripts/convert-cities.py`) by `npm run -w server load:cities`, which `seed:dev` and `seed:demo` also run. It holds 400 cities in 160 countries and omits three of the seven emirates the club designates as GWC cities, so every read merges it with `gwc_cities`.
