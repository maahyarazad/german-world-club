# Quickstart: Onboarding Phase 2 — Profiling Workflow

Validates the scenarios in `spec.md`'s User Stories against a running server. Assumes migrations
are applied (`npm run -w server migrate`) and the dev seed has run (`npm run -w server seed:dev`).

## Prerequisites

```bash
npm run -w server dev
```

A member needs a `membership_applications` row in state `approved` to exercise these scenarios.
Either use `seed:demo` (development-only; prints working credentials) and approve one of its
pending applicants via `POST /admin/onboarding/applications/:memberId/approve`, or drive the full
Phase 1 flow (`POST /onboarding/register` → verify mobile → verify email → staff approve) against a
fresh member.

## Scenario 1 — German-resident member completes the five-question flow (Story 1)

1. Sign in as the approved, `country_of_residence = 'DE'` member.
2. `GET /profiling/status` → expect `{ branch: 'germany', completed: false, answers: { ...all null... } }`.
3. Confirm every ordinary member route (e.g. `GET /member/events`) answers `403
   profiling-incomplete` (the new problem type), while `GET /profiling/status` and `PATCH
   /profiling` still succeed.
4. `PATCH /profiling` with `{ settlingStatus: 'know_where' }` → `GET /profiling/status` shows it
   filled, `completed: false`.
5. Sign out and back in (or otherwise start a fresh session) → `GET /profiling/status` still shows
   Q1 answered — validates SC-005 (resumability survives a new session, not just in-memory state).
6. `PATCH /profiling` with `{ languages: ['en', 'de'] }`, then qualification, occupation, and
   desired work type in turn (or all remaining fields in one call).
7. After the fifth answer, the response's `completed` is `true`.
8. `GET /member/events` now succeeds — the gate is lifted.
9. `PATCH /profiling` again with any field → expect `409 conflict` (immutability).

## Scenario 2 — Non-German member with no city match (Story 2)

1. Sign in as an approved member with `country_of_residence != 'DE'` (or `NULL`).
2. `GET /profiling/status` → `{ branch: 'elsewhere', completed: false }`.
3. `PATCH /profiling` with a `primaryCity` and two `secondaryCities`, none present in `gwc_cities`.
4. Response: `completed: true`, `outcome: 'in_person_meeting'`, `matchedCity: null`.
5. Confirm the record is visible via the staff/admin surface that already lists onboarding
   applications (or an equivalent staff query), so a human can act on the outcome (SC-006).
6. `GET /member/events` now succeeds.

## Scenario 3 — Non-German member matches a GWC city (Story 3)

1. Seed one row in `gwc_cities` (or use one from the migration's seed set) — note its `country` and
   `city`.
2. Sign in as an approved, non-German member.
3. `PATCH /profiling` with a `primaryCity` matching that row.
4. Response: `completed: true`, `outcome: 'gwc_city_match'`, `matchedCity` set to the matched row —
   and, critically, no error and no "in person meeting" wording in the response.
5. Confirm the match (submitted city + matched `gwc_cities.id`) is queryable by staff.

## Scenario 4 — Invited/legacy member is unaffected (Edge Case)

1. Using a member with no `membership_applications` row at all (e.g. from `seed:dev`'s fixed
   `@test.invalid` accounts, or an invited member), confirm `GET /member/events` succeeds
   immediately with no profiling prompt and `GET /profiling/status` is either not reachable or
   reports a state that does not block them (implementation detail — the auth-gate behaviour is
   what matters: no `PROFILING_INCOMPLETE` refusal for this member).

## Scenario 5 — Client UX on both faces (Story 1 & 2, client-side)

1. Web console: sign in as a freshly approved member at `/konsole/anmelden`; confirm the console
   shows the profiling screen (not the ordinary member console) immediately after
   `Application.tsx` observes `step === 'approved'`.
2. Expo app: sign in as the same kind of member; confirm the app shows the new profiling screen
   group rather than the member tabs, and that completing the flow transitions to the member tabs
   without a manual sign-out/sign-in.

## Automated coverage (for `/speckit-tasks`)

- `server/tests/profiling/gate.test.ts` — access-control matrix: approved+incomplete refused on
  every non-profiling member route, both profiling routes reachable, invited/legacy members
  untouched, denied/pending applicants still get their existing refusals (gate ordering).
- `server/tests/profiling/germany-flow.test.ts` — sequential answers, resumability across a new
  session, completion exactly at the fifth answer, immutability after completion.
- `server/tests/profiling/elsewhere-flow.test.ts` — both outcomes, distinctness validation for the
  three cities, `matched_gwc_city_id` set only on a real match.
- `server/tests/profiling/branch-freeze.test.ts` — changing `country_of_residence` after profiling
  starts does not change an in-progress or completed row's `branch`.
- `client/tests/onboarding/profiling.test.tsx` — console renders the profiling screen instead of
  entering the console when `step === 'approved'` and profiling is incomplete.
- `tests/seed/no-live-credentials.test.js` — unaffected (no session/token tables touched), rerun
  as a regression check since `member_profiling` sits near onboarding tables.

---

# Revision 2 scenarios (relationship, partner, go-back, submit)

Prerequisite: `npm run -w server migrate` applies `034`. Use an approved member per scenario.

## Scenario 6 — Go back and change (Story 5)

1. German member answers settling=`know_where`, languages=`['en']`, income=`50k_to_100k`.
2. `PATCH /profiling { languages: ['en','de'] }` (what the Back button does) → `GET /profiling/status`
   shows both languages, income still set, `completed: false`.
3. In the web console and Expo app: on the income step press Back → languages step shows the saved
   bubbles; change one; Continue returns to income with the saved value preselected.

## Scenario 7 — Relationship, kids, partner (Story 4)

1. `PATCH { relationshipStatus: ['single','kids'] }` → 400 `validation-failed`. `['single']` → 200.
2. `PATCH { relationshipStatus: ['kids','partner'], kids: ['age_0_6','age_14_18'] }` → status shows
   two kids; `PATCH { partner: { settlingStatus: 'need_help' } }` creates the partner set.
3. Change tags to `['partner']` → `kids: []` (cascade); to `['kids']` → `partner: null`; to
   `['single']` → both gone. Confirm no orphan rows in `member_profiling_kids`/`_partner`.
4. Non-German member: after cities and Q6 the step list ends at `review` — no Q7 steps.

## Scenario 8 — Q7 paths

For each of `employee`, `freelance`, `business_owner`, `own_business`, `not_sure`: answer the path's
follow-ups (industry on every path), switch to another path and confirm the previous follow-ups are
gone, then finish. `POST /profiling/submit` is refused (409 `profiling-answers-missing`) until every
step for the final path is answered.

## Scenario 9 — Submit is the only completion

1. Answer the last question via PATCH → `completed: false`, ordinary routes still `403 profiling-incomplete`.
2. Change any earlier answer → still editable.
3. `POST /profiling/submit` → `completed: true`; ordinary routes now succeed.
4. `PATCH /profiling` or a second submit → 409; direct SQL `UPDATE member_profiling_kids …` for that
   member raises (trigger).
5. Elsewhere: `outcome`/`matchedCity` are `null` before submit and set after.

## Additional automated coverage

`server/tests/profiling/{relationship-flow,go-back,submit}.test.ts`,
`packages/contracts/tests/profiling-steps.test.ts`, extended `client/tests/onboarding/profiling.test.tsx`,
the access-control matrix (`POST /profiling/submit`), and the seed manifest test (new tables listed).


---

# Revision 4 scenarios

Prerequisite: `NODE_ENV=development npm run -w server migrate:down && npm run -w server migrate && npm run -w server seed:dev` (loads the cities too).

## Scenario 10 — Phase 1 rules
1. Register with `primaryLanguage: 'non_german'`, verify mobile and email → status `denied`; the denial mail is queued; `GET /admin/onboarding/applications?state=pending` does not list them; the application row has `decided_automatically = true`.
2. Register with `'german'` → `awaiting_approval`, one `onboarding.thank-you` mail queued, listed for staff with the language.
3. `UPDATE membership_applications SET submitted_at = now() - interval '25 hours' WHERE member_id = …`, then run the job (it ticks every 15 minutes; `app.runJob('onboarding.auto-approve')`) → approved, approval mail queued, second run does nothing.

## Scenario 11 — Settling
*Please help* → information screen, then languages. *Yes* → country + city from the dropdown; Dubai → five duration bands; a partner (Q6 Partner/Family) is asked the same.

## Scenario 12 — Order, income, Q7
Order settling, languages, qualification, occupation, income (five bands), Q6, Q7. Business Owner: industry then Produce/Distribute/Sales/Other. "Not sure": statements only, no industry.

## Scenario 13 — Non-German
Cities from the dropdown (`GET /profiling/cities?country=DE` → Berlin first). No GWC city → review → Submit → in-person-meeting. A GWC city (e.g. Dubai) → Q6, kids, partner → review → Submit → `gwc_city_match`. Change the cities back to a non-match → the Q6/kids/partner answers are gone.


## Scenario 14 — Partner questionnaire without settling (Revision 6)
1. German member: tags Partner + Kids → kids, then partner **languages → qualification → occupation → income**, then Q7. No settling screen for the partner, on web and in the Expo app.
2. Non-German member with a GWC city (Dubai): Partner → the same four partner steps → review. Submit succeeds.
3. `PATCH /profiling` with `partner: { settlingStatus: 'need_help' }` → 422; `partner` with only the four answers → 200.
4. `GET /profiling/status` for a partner-bearing member lists no `partner-settling*` step, and `missing` never names one.
5. Counter-check: the member's own Q1 is still asked on the German path.
Tests: `packages/contracts/tests/profiling-steps.test.ts`, `server/tests/profiling/{relationship-flow,settling,submit}.test.ts`, `client/tests/onboarding/profiling.test.tsx`.
