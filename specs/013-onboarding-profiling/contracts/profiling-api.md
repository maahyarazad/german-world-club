# Contract: Profiling API

**Feature**: 013-onboarding-profiling | Module: `server/src/modules/profiling/` | Types:
`packages/contracts/src/profiling.ts` (exported as `@gwc/contracts/profiling`)

Both routes are member-only and reachable specifically *because* profiling is incomplete — the same
`onboarding: true`-style escape hatch Phase 1 uses, applied to a new `profiling: true` flag
(research R2). Every other member route is refused while `member_profiling.completed_at IS NULL`
for an approved applicant.

| Posture | Value |
|---|---|
| `config.auth` | `{ audience: 'member', profiling: true }` |
| `onRequest` | `app.guard` |

---

## Shared types

```ts
export const GENDERS_UNRELATED_NOTE = undefined // n/a — listed for contrast only, not exported

export const SETTLING_STATUSES = Object.freeze(['know_where', 'need_help'] as const)
export const QUALIFICATION_LEVELS = Object.freeze([
  'no_formal_qualification', 'secondary_school', 'diploma_certificate', 'associate_degree',
  'bachelors_degree', 'masters_degree', 'doctorate', 'professional_qualification',
] as const)
export const OCCUPATIONS = Object.freeze([
  'student', 'unemployed', 'self_employed_business_owner', 'government_employee',
  'private_sector_employee', 'teacher_educator', 'healthcare_professional', 'engineer',
  'it_software_professional', 'accountant_finance_professional', 'lawyer_legal_professional',
  'sales_marketing_professional', 'consultant', 'homemaker', 'retired', 'freelancer', 'other',
] as const)
export const DESIRED_WORK_TYPES = Object.freeze([
  'employee', 'freelance', 'own_business', 'not_sure',
] as const)
/** Q5 follow-up for `desired_work_type = 'not_sure'` (FR-011). */
export const FUTURE_WORK_PRIORITIES = Object.freeze([
  'family_time', 'balance_lifestyle', 'wealth_reputation',
] as const)
export const LANGUAGES: readonly { code: string; en: string; de: string }[] = [ /* ISO 639-1 */ ]

export type ProfilingBranch = 'germany' | 'elsewhere'
export type ProfilingOutcome = 'in_person_meeting' | 'gwc_city_match'

export type CitySlot = { country: string; city: string } // country: ISO 3166-1 alpha-2

export type ProfilingStatus = {
  branch: ProfilingBranch
  completed: boolean
  outcome: ProfilingOutcome | null
  matchedCity: { country: string; city: string } | null   // only when outcome = 'gwc_city_match'
  answers: {
    settlingStatus: 'know_where' | 'need_help' | null
    languages: string[] | null
    qualificationLevel: (typeof QUALIFICATION_LEVELS)[number] | null
    occupation: (typeof OCCUPATIONS)[number] | null
    desiredWorkType: (typeof DESIRED_WORK_TYPES)[number] | null
    // Q5 follow-up, present only for the branch desiredWorkType selects (FR-009–FR-011):
    futureWorkSector: string | null                              // 'employee' only
    futureWorkReady: boolean | null                              // 'employee' only
    futureWorkOffering: string | null                            // 'freelance' | 'own_business' only
    futureWorkIdea: string | null                                // 'freelance' | 'own_business' only
    futureWorkPriorities: (typeof FUTURE_WORK_PRIORITIES)[number][] | null  // 'not_sure' only
    primaryCity: CitySlot | null
    secondaryCities: CitySlot[]   // 0, 1, or 2 entries
  }
}
```

`branch` is derived once from `members.country_of_residence` the first time either route is called
for a member with no `member_profiling` row yet (`= GERMANY` from `@gwc/contracts/onboarding` →
`'germany'`, anything else, including `null` → `'elsewhere'`), and is thereafter read from the row,
never recomputed (research R3, data-model.md).

---

## `GET /profiling/status`

`config.budget: 'member-read'`.

Returns `ProfilingStatus` for the calling member. If no `member_profiling` row exists yet, the
response still reports the correct `branch` (computed on the fly from `country_of_residence`) with
every answer `null`/empty and `completed: false` — the client does not need a separate "not started"
representation.

**Response `200`**: `ProfilingStatus`.

---

## `PATCH /profiling`

`config.budget: 'member-write'`.

**Request** (`profilingPatchRequestSchema`, one of two shapes depending on the caller's branch —
the server rejects a body whose fields belong to the *other* branch, `VALIDATION_FAILED`):

```ts
// branch = 'germany' — any subset of these fields, one call per question in the UI,
// but the server accepts more than one field per call too.
{
  settlingStatus?: 'know_where' | 'need_help'
  languages?: string[]            // non-empty when present; replaces the whole set
  qualificationLevel?: (typeof QUALIFICATION_LEVELS)[number]
  occupation?: (typeof OCCUPATIONS)[number]
  desiredWorkType?: (typeof DESIRED_WORK_TYPES)[number]
  // Q5 follow-up — send only the field(s) matching the CURRENT desiredWorkType
  // (the one already on the row, or the one given in this same call):
  futureWorkSector?: string        // desiredWorkType = 'employee'
  futureWorkReady?: boolean        // desiredWorkType = 'employee'
  futureWorkOffering?: string      // desiredWorkType = 'freelance' | 'own_business'
  futureWorkIdea?: string          // desiredWorkType = 'freelance' | 'own_business'
  futureWorkPriorities?: (typeof FUTURE_WORK_PRIORITIES)[number][]  // desiredWorkType = 'not_sure'; non-empty
}

// branch = 'elsewhere' — submitted together, since the three cities form one screen
{
  primaryCity: CitySlot
  secondaryCities: CitySlot[]     // 0–2 entries; validated distinct from each other and from primaryCity
}
```

**Behaviour**:
1. Resolves (or creates) the member's `member_profiling` row and its frozen `branch`.
2. Refuses (`CONFLICT`, `409`) if the row's `completed_at` is already set — matches the immutability
   trigger in data-model.md; the client should not be able to reach this in normal use since
   `GET /profiling/status` already reports `completed: true`.
3. Merges the given fields into the row. `germany` only: if this call's `desiredWorkType` differs
   from the row's existing value, every follow-up column belonging to the *previous* value is
   cleared first (FR-022) — a member who backs up and picks a different Q5 answer never leaves a
   stale `futureWorkOffering` sitting next to a freshly chosen `employee`.
4. If, after merging, every field the branch requires is present:
   - `germany`: all five base answers present, **and** the follow-up(s) FR-009/FR-010/FR-011
     require for the current `desiredWorkType` are present → sets `completed_at`.
   - `elsewhere`: `primaryCity` present (secondary cities optional individually, but the two
     slots — when given — must be distinct from each other and from the primary) → checks
     `primaryCity` and each given secondary city against `gwc_cities`; sets `outcome` and
     `matched_gwc_city_id` (first match found, primary checked first) and `completed_at` together.
5. Returns the resulting `ProfilingStatus` (same shape as `GET`), so the client never needs a
   second round-trip to learn whether that call finished the flow.

**Response `200`**: `ProfilingStatus`.

**Errors**:
| Problem | When |
|---|---|
| `VALIDATION_FAILED` (400) | A field outside the caller's branch shape is present, an enum value is unrecognized, `languages`/`futureWorkPriorities` is empty when present, or the three cities are not pairwise distinct. |
| `CONFLICT` (409) | Profiling is already complete for this member. |

---

## `GET /profiling/gwc-cities`

`config.budget: 'member-read'`. Added alongside the elsewhere-branch nearest-city UI so a client can
offer a dropdown instead of free text once the designated-city list has entries for the country the
member picked (currently the UAE emirates only) — added after the initial release, once
`gwc_cities` was pared down from a broad world-cities seed to just those emirates.

Returns every `gwc_cities` row as a flat list, `(typeof citySlotSchema)[]` — i.e. `{ country, city
}[]`, the same shape a client submits, not the internal `id`/`created_at`. The client filters by the
country it already picked; the list is small enough that a server-side query-string filter would add
a parameter for no real benefit.

**Response `200`**: `CitySlot[]`.

---

## Interaction with the member auth gate

`server/src/plugins/10-auth.ts`'s `applyMemberGates` gains one check (research R2), placed after the
existing device-approval check:

```ts
if (auth.profiling === true) {
  request.permissions = { kind: 'member', flags: {}, displayName: member.display_name }
  return
}
if (member.application_state === 'approved' && member.profiling_completed_at === null) {
  throw forbidden(PROBLEMS.PROFILING_INCOMPLETE, 'Complete your profile to continue.')
}
```

A member with no `membership_applications` row (`application_state IS NULL` — invited or legacy) is
never subject to this check, exactly like the existing pending/denied checks.
