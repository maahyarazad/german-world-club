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


---

# Revision 2 (2026-09-29): what changes

Everything above stands except the following. Both routes and the new one keep
`config.auth = { audience: 'member', profiling: true }` and `onRequest: app.guard`.

## Shared types (additions to `@gwc/contracts/profiling`)

```ts
export const YEARLY_INCOME_RANGES = Object.freeze(['up_to_50k', '50k_to_100k', 'over_100k'] as const)
export const RELATIONSHIP_TAGS = Object.freeze(['single', 'partner', 'family', 'kids'] as const)
export const KID_AGE_RANGES = Object.freeze(['age_0_6', 'age_6_14', 'age_14_18', 'age_18_plus'] as const)
// DESIRED_WORK_TYPES: 'employee' | 'freelance' | 'business_owner' | 'own_business' | 'not_sure'

export type PartnerAnswers = {
  settlingStatus: SettlingStatus | null; languages: string[] | null
  yearlyIncomeRange: YearlyIncomeRange | null
  qualificationLevel: QualificationLevel | null; occupation: Occupation | null
}
// ProfilingStatus.answers gains:
//   yearlyIncomeRange: YearlyIncomeRange | null
//   relationshipStatus: RelationshipTag[] | null
//   kids: KidAgeRange[]                    // one entry per kid; [] when none
//   partner: PartnerAnswers | null         // null until any partner answer exists

export type ProfilingStepId =
  | 'settling' | 'languages' | 'income' | 'qualification' | 'occupation' // German Q1-Q5
  | 'cities'                                                             // elsewhere
  | 'relationship' | 'kids'                                              // Q6 (+ kids sub-flow)
  | 'partner-settling' | 'partner-languages' | 'partner-income'
  | 'partner-qualification' | 'partner-occupation'
  | 'work-type' | 'work-offering' | 'work-industry' | 'work-idea'        // Q7 and follow-ups
  | 'work-ready' | 'work-priorities'
  | 'review'

/** Ordered steps that apply to these answers (Germany: Q1-Q5, Q6, [kids], [partner x5], Q7 + path, review). */
export function profilingSteps(branch: ProfilingBranch, answers: ProfilingAnswers): ProfilingStepId[]
/** The subset of `profilingSteps` (excluding 'review') that has no valid answer yet. */
export function profilingMissing(branch: ProfilingBranch, answers: ProfilingAnswers): ProfilingStepId[]
```

Step order after Q7 per path: `employee` → industry, ready; `freelance`/`own_business` → offering,
industry, idea; `business_owner` → industry, idea (labelled "product or service" in the UI);
`not_sure` → priorities, industry. Elsewhere: `cities`, `relationship`, `kids`?, partner x5?, `review`.

## `GET /profiling/status`

Same route; the response carries the new `answers` fields. `completed` becomes true only after
`POST /profiling/submit`. Clients derive the step list, resume point and review from
`profilingSteps`/`profilingMissing` — no separate server field.

## `PATCH /profiling` (amended)

Never sets `completed_at`. Both branch shapes become "any non-empty subset", `.strict()`:

```ts
// germany (adds to the existing fields)
{ yearlyIncomeRange?, relationshipStatus?: RelationshipTag[],   // non-empty; 'single' alone
  kids?: KidAgeRange[],                                         // 1-20 entries, replaces the whole list
  partner?: Partial<PartnerAnswers> }                           // merges given partner fields

// elsewhere (was: all-or-nothing cities)
{ primaryCity?: CitySlot, secondaryCities?: CitySlot[],         // secondaryCities only with primaryCity; distinct
  relationshipStatus?, kids?, partner? }                        // same as above
```

Behaviour additions, in the same transaction as the write (research R14):
1. `relationshipStatus` with `single` plus any other tag -> 400 `VALIDATION_FAILED` (also a DB CHECK).
2. Saving tags without `kids` deletes kid rows; without both `partner` and `family` deletes the
   partner row; `single` deletes both.
3. `kids` with a non-empty list while the effective tags lack `kids` -> 400 `VALIDATION_FAILED`;
   same for `partner` without `partner`/`family`.
4. A changed `desiredWorkType` clears follow-ups it does not use (FR-022, new mapping).
5. Re-sending an already-answered field replaces it — this is the go-back path (FR-031).
6. Still 409 `CONFLICT` once complete.

## `POST /profiling/submit` (new)

`config.budget: 'member-write'`. No body.

Recomputes `profilingMissing` from the stored row. If anything is missing -> **409
`PROFILING_ANSWERS_MISSING`** (new problem type in `errors.ts`, next to `PROFILING_INCOMPLETE`;
the English `detail` names the missing step ids for people reading logs — clients branch on `type` and
recompute the missing steps themselves with `profilingMissing`, never by parsing `detail`). Otherwise in one transaction: elsewhere branch — checks the stored cities against `gwc_cities`
(primary first) and sets `outcome` + `matched_gwc_city_id`; then sets `completed_at`. Returns
`ProfilingStatus` (`completed: true`, `outcome`, `matchedCity`). A second call after completion ->
409 `CONFLICT`.

| Problem | When |
|---|---|
| `PROFILING_ANSWERS_MISSING` (409) | An applicable step has no answer. |
| `CONFLICT` (409) | Already complete. |

## Gate interaction

Unchanged. `POST /profiling/submit` carries `profiling: true` like the other two; it is refused once
`completed_at` is set only by the conflict above, not by the gate.

---

# Revision 3 (2026-09-29): what changes

- `partner` (status and PATCH) has no `settlingStatus`; the step `partner-settling` no longer exists in `ProfilingStepId`.
- `futureWorkSector` is one of `INDUSTRIES` (21 codes) — a free-text value is `400 VALIDATION_FAILED`.
- `futureWorkPriorities: string[]` is replaced by `futureWorkPriority: 'family_time' | 'balance_lifestyle' | 'wealth_reputation'` (status and PATCH). The `not_sure` path still asks priority, then industry.


---

# Revision 4 (2026-09-30): what changes

- **Answers** gain `settlingCountry`, `settlingCity`, `settlingWorkDuration`, `futureWorkBusinessActivities`, `futureWorkPriorities` (array again; `futureWorkPriority` is gone) and the derived `gwcMatch`. `partner` regains `settlingStatus` and the three settling fields. `yearlyIncomeRange` accepts `over_500k` and `over_1m`. `futureWorkSector` is not accepted for `not_sure`; `futureWorkIdea` is not accepted for `business_owner`.
- **Step engine** (`profilingSteps`): German `settling` (+ `settling-info` | `settling-place` [+ `settling-work` for Dubai]), `languages`, `qualification`, `occupation`, `income`, `relationship`, `kids`?, partner block (its own settling steps, then `partner-languages`, `-qualification`, `-occupation`, `-income`), `work-type`, then the path (`business_owner` → `work-industry`, `work-activities`; `not_sure` → `work-priorities`). Elsewhere: `cities`, and only when `gwcMatch`, Q6 and its sub-flows; then `review`.
- **`PATCH /profiling`** refuses place fields unless the settling answer is "yes" (member and partner), the duration unless the place is Dubai, and any Q6 field for a non-German member without a GWC match.
- **`GET /profiling/cities?country=XX&q=`** (`profiling: true`, `member-read`) returns `{ listed, cities }`: the InterNations list merged with the club's designated cities, capitals first, prefix-filtered, at most 50. `listed: false` means "type the city".
- **Auth/onboarding**: `POST /onboarding/register` requires `ageConfirmed: true` and `primaryLanguage`; the staff application carries `primaryLanguage` and `decidedBy: 'staff' | 'automatic' | null`.


---

# Revision 6 (2026-10-05)

- `PartnerAnswers` (status response) loses `settlingStatus`, `settlingCountry`, `settlingCity`, `settlingWorkDuration`: `{ languages, yearlyIncomeRange, qualificationLevel, occupation }`.
- `PATCH /profiling` `partner` accepts only those four keys (`.strict()`); any settling key → `422` validation problem.
- `ProfilingStepId` loses `partner-settling`, `partner-settling-info`, `partner-settling-place`, `partner-settling-work`. Partner steps, in order: `partner-languages`, `partner-qualification`, `partner-occupation`, `partner-income`. Applies to Germany/Austria/Switzerland and to a non-German member with a GWC city.
- `POST /profiling/submit` requires the four partner answers; missing ones appear in `PROFILING_ANSWERS_MISSING` by those ids only.
