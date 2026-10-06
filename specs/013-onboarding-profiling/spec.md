# Feature Specification: Onboarding Phase 2 — Profiling Workflow

**Feature Branch**: `013-onboarding-profiling`

**Created**: 2026-09-29

**Status**: Draft

**Input**: User description: "plan to implement the second phase of onboarding after super admin approves the use request" — a country-branching profiling questionnaire that begins once a membership application is approved.

**Revision 3 (2026-09-29)**: the partner is not asked the settling question (their questionnaire is languages, income, qualification, occupation); the industry is a dropdown of a fixed list of 21 (FR-009–FR-011, FR-029); the "I am not sure yet" statement is a single choice, not several (FR-011). Amended in place below.

**Revision 2 (2026-09-29)**: the business description's Profiling Workflow grew (yearly income question; relationship & family status with kids and partner sub-flows on **both** branches; five desired-work paths, each ending in an industry selection), and members must be able to **go back and change any answer before finishing**. Stories 4 and 5 and FR-023–FR-034 are new; FR-008–FR-014, FR-016–FR-017, FR-020 and FR-022 are amended in place. Everything already built for Stories 1–3 stays unless an amended requirement says otherwise.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - German-resident applicant completes profiling (Priority: P1)

A member whose `country_of_residence` is Germany has just had their membership application approved. On their next sign-in (web or app), instead of reaching ordinary member features, they are presented with a sequential profiling flow: settling status, languages spoken, yearly income range, highest qualification, current occupation, relationship & family status (Story 4), and desired future work type with its follow-ups. When they confirm their answers on the final review step (Story 5), profiling is complete and they gain full member access.

**Why this priority**: This is the majority path (Germany-resident applicants) and delivers the core value of the feature end to end — it alone makes the gate meaningful and unblocks real members.

**Independent Test**: Approve a `country_of_residence = 'DE'` applicant, sign in, answer every question in order and submit the review, and confirm the member reaches ordinary member routes afterward and the answers are persisted.

**Acceptance Scenarios**:

1. **Given** an approved member with `country_of_residence = 'DE'` who has not started profiling, **When** they sign in, **Then** they are shown Question 1 (settling status) and no other member route succeeds until profiling is complete.
2. **Given** a member mid-flow who has answered Q1 and Q2, **When** they sign in again later, **Then** they resume at Q3 rather than restarting or losing prior answers.
3. **Given** a member who has answered every required question, **When** they confirm on the review step, **Then** profiling is marked complete and every ordinary member route becomes reachable — answering the last question alone does not complete it.
4. **Given** Q2 (languages), **When** the member selects multiple languages from the dropdown, **Then** each selection appears as its own removable bubble and at least one language is required to proceed.
5. **Given** a member who answered "Employee" to Q7, **When** they proceed, **Then** they are asked the industry/business and whether they are ready to work in that field.
6. **Given** a member who answered "Freelancer" or "Build My Own Business" to Q7, **When** they proceed, **Then** they are asked what they want to offer, the industry/business, and what product or service idea they have.
7. **Given** a member who answered "Business Owner" to Q7, **When** they proceed, **Then** they are asked the industry/business and what their product or service is.
8. **Given** a member who answered "I am not sure yet" to Q7, **When** they proceed, **Then** they select which of three statements apply (family time, balance/lifestyle, wealth/reputation — at least one), then the industry/business.
9. **Given** any Q7 path, **When** a follow-up is unanswered, **Then** the review step cannot be submitted.

---

### User Story 2 - Non-German-resident applicant is routed to an in-person meeting (Priority: P2)

A member whose `country_of_residence` is anything other than Germany has just been approved. Instead of the five-question flow, they are asked for their nearest city (one primary, two secondary, each with country + city). None of the three matches a designated GWC city, so the system records that outcome and tells the member a club representative will arrange an in-person meeting.

**Why this priority**: This is the second branch of the same gate and is required for every non-German approved applicant to reach the club at all; it depends on the branching logic but not on Story 3's undefined downstream flow.

**Independent Test**: Approve a `country_of_residence != 'DE'` applicant, submit three cities none of which are in the GWC city list, and confirm the member sees the "in-person meeting" outcome and profiling is marked complete, and that staff can see the submission to act on it.

**Acceptance Scenarios**:

1. **Given** an approved member with `country_of_residence != 'DE'`, **When** they sign in, **Then** they are asked for one primary and two secondary nearest cities (country + city each) instead of the five-question flow.
2. **Given** three submitted cities, none of which match a GWC city, **When** the submission is processed, **Then** the member is told a representative will arrange an in-person meeting, profiling is marked complete, and the submission is visible to staff.
3. **Given** the primary city field, **When** the member submits without a primary city, **Then** the submission is rejected and the two secondary cities remain optional-but-capped-at-two.

---

### User Story 3 - Non-German-resident applicant matches a GWC city (Priority: P3)

Among the same non-German flow, one of the three submitted cities matches a city on the designated GWC city list. The downstream experience for this case is intentionally not yet designed, so the member sees a clear "we'll be in touch" placeholder rather than an error, dead end, or the in-person-meeting message that belongs to the no-match case.

**Why this priority**: Real member traffic will hit this branch, so the system must not error or silently fall through even though the eventual flow is out of scope — but it delivers no new business value beyond "does not break," which is why it is lower priority than Stories 1 and 2.

**Independent Test**: Submit three cities where at least one matches a seeded GWC city and confirm the member sees a distinct, non-error placeholder outcome (not the in-person-meeting message) and the match is recorded and visible to staff.

**Acceptance Scenarios**:

1. **Given** a submitted city matching a GWC city, **When** the submission is processed, **Then** the member sees a placeholder "you'll hear from us" outcome distinct from the in-person-meeting outcome, and no error occurs.
2. **Given** the same submission, **When** staff later review it, **Then** the record shows which submitted city matched and which GWC city it matched against.

---

### User Story 4 - Member describes relationship, kids and partner (Priority: P2)

On **both** branches, after the branch's own questions, the member is asked their relationship & family status as multi-select tags: Single, Partner, Family, Kids. *Single* is exclusive. If *Kids* is selected they say how many kids and pick an age range (0–6, 6–14, 14–18, 18+) for each. If *Partner* or *Family* is selected they answer a **partner questionnaire** — the German Q1–Q5 (settling, languages, income, qualification, occupation), without Q6. Kids and Partner/Family can both apply, and both sub-flows then run. A German-resident member then continues to Q7; a non-German member goes to the review step (Q7 is German-only).

**Why this priority**: Required by the updated business description for every member, but Stories 1–2 still deliver a working gate without it, so it ranks below them.

**Independent Test**: As a German member, pick Kids + Partner, give 2 kids with age ranges, answer the partner Q1–Q5, then Q7; repeat as a non-German member and confirm the flow ends at review after the partner section.

**Acceptance Scenarios**:

1. **Given** Q6, **When** the member selects *Single*, **Then** every other tag is deselected/disabled, and selecting any other tag deselects *Single*.
2. **Given** *Kids* is selected, **When** the member enters a count of N, **Then** exactly N age-range pickers appear and profiling cannot proceed until each has a value.
3. **Given** *Partner* or *Family* is selected, **When** the member proceeds, **Then** they answer the five partner questions in order, and Q6 is not asked again.
4. **Given** a German member finishing Q6 (and its sub-flows), **Then** the next question is Q7; **Given** a non-German member, **Then** the next step is the review.
5. **Given** *Single* only, **Then** no kids or partner questions appear.

---

### User Story 5 - Member goes back and changes an answer (Priority: P1)

At any point before the final submit, the member can go back to any earlier question, see the answer they gave, change it, and continue. The last step is a **review** listing every answer with a "Change" action on each, and a single "Submit" that completes profiling. Because the answers are only final on Submit, a mistake on the very last question is as fixable as one on the first.

**Why this priority**: Explicitly requested, and it changes when completion happens, so Stories 1, 2 and 4 depend on it.

**Independent Test**: Answer Q1–Q3, press Back twice, change Q2, continue to the end, and confirm on review that the changed answer — and no stale one — is what gets submitted.

**Acceptance Scenarios**:

1. **Given** the member is on any question after the first, **When** they press Back, **Then** the previous question is shown with their saved answer preselected, and nothing is lost.
2. **Given** a changed earlier answer changes which questions apply (Q6 tags, kid count, Q7 path), **When** they continue, **Then** questions that no longer apply are dropped along with their answers, and newly applicable ones are asked.
3. **Given** the review step, **When** the member taps "Change" on an answer, **Then** they go to that question and, after saving, return to the review.
4. **Given** the member has pressed Submit and profiling is complete, **Then** no answer can be changed through member routes (FR-020).
5. **Given** the member closes the app on any step, **When** they return, **Then** they resume at the first unanswered question (or the review if everything is answered) with Back still available.

---

### Edge Cases

- What happens when a member's `country_of_residence` is missing or not a recognized value? → Treated as non-German (routed to the nearest-city flow), since the German flow requires a confirmed `DE` value.
- What happens if a member abandons the flow partway (closes the app mid-questionnaire)? → Answers already submitted are persisted; the member resumes at the next unanswered question on their next visit (see Story 1, Scenario 2).
- What happens if the same city name exists in two countries (e.g., a city name shared by Germany and Austria)? → GWC-city matching is on the (country, city) pair, not city name alone.
- What happens if a member tries to submit the same primary city as one of their secondary cities? → Rejected; the three submitted locations must be distinct (country, city) pairs.
- What happens if an application is later un-approved? → Not applicable: application decisions are final once made (existing Phase 1 rule), so a completed or in-progress profiling record is never invalidated by a status change.
- What happens on a route that is not part of profiling while profiling is incomplete? → Refused, the same way an unapproved applicant is currently refused on non-onboarding member routes, until profiling is complete.
- What happens if a member changes their Q7 (desired future work type) answer after already answering that choice's follow-up question(s), but before profiling is complete? → The previously captured follow-up answer(s) are discarded, since they belonged to the choice being replaced; the member then answers the new choice's own follow-up(s) instead of carrying stale data forward.

## Requirements *(mandatory)*

> **Numbering note**: FR-004–FR-012 keep their original numbers, but the business description renumbered the questions: income is now Q3, qualification Q4, occupation Q5, relationship Q6, desired work Q7. "Q5" in FR-008–FR-012 and FR-022 below now means **Q7**.

### Functional Requirements

- **FR-001**: System MUST present the profiling questionnaire to a member if and only if their membership application state is `approved` and their profiling is not yet complete.
- **FR-002**: System MUST refuse every ordinary member route for an approved-but-not-yet-profiled member, the same way an unapproved applicant is refused today, and MUST allow only the profiling questions/submission routes through this gate — profiling is mandatory and cannot be skipped or deferred, for every member type.
- **FR-003**: System MUST branch the questionnaire on the member's `country_of_residence` captured during Phase 1 registration: Germany (`DE`) presents the German flow (FR-004–FR-012, FR-023, FR-024–FR-028); any other or missing value presents the nearest-city flow (FR-013–FR-017) followed by relationship & family status (FR-024–FR-028), and no Q7.
- **FR-004**: System MUST ask a German-resident member whether they already know where they will settle, offering exactly two choices: "Yes" or "Please help."
- **FR-005**: System MUST ask a German-resident member which languages they speak, offered as a searchable dropdown, allowing more than one selection, with each selection displayed as an individually removable bubble, and requiring at least one selection to proceed.
- **FR-006**: System MUST ask a German-resident member their highest qualification level, as a single choice from a fixed list: No formal qualification; Secondary/High School; Diploma/Certificate; Associate Degree; Bachelor's Degree; Master's Degree; Doctorate (PhD); Professional Qualification (e.g., CA, CPA, MBA).
- **FR-007**: System MUST ask a German-resident member their current occupation/profession, as a single choice from a fixed list: Student; Unemployed; Self-Employed/Business Owner; Government Employee; Private Sector Employee; Teacher/Educator; Healthcare Professional; Engineer; IT/Software Professional; Accountant/Finance Professional; Lawyer/Legal Professional; Sales/Marketing Professional; Consultant; Homemaker; Retired; Freelancer; Other.
- **FR-008**: System MUST ask a German-resident member (Q7) what kind of job they would like to do in future, as a single choice from a fixed list: Employee; Freelancer; Business Owner; Build My Own Business; I am not sure yet.
- **FR-009**: When the FR-008 answer is "Employee", system MUST ask, in order: the industry/business (a dropdown, FR-035), then whether they are ready to work in that field (yes/no).
- **FR-010**: When the FR-008 answer is "Freelancer" or "Build My Own Business", system MUST ask, in order: what the member wants to offer, the industry/business, and what product or service idea they have. The two paths ask the identical three questions.
- **FR-011**: When the FR-008 answer is "I am not sure yet", system MUST ask the member to select which one of three fixed statements applies — wanting to spend time with family, valuing balance and lifestyle, wanting to become wealthy and build a reputation — a single choice, then the industry/business.
- **FR-029**: When the FR-008 answer is "Business Owner", system MUST ask, in order: the industry/business, then what their product or service is.
- **FR-012**: System MUST present the applicable questions in order, one at a time, skipping none, and MUST treat a member's answers as complete only when every applicable question for their branch (including Q6 and its sub-flows, and for German residents Q7 and its follow-ups) has an answer. Completion itself happens only on the explicit submit (FR-030).
- **FR-013**: System MUST ask a non-German-resident member for their nearest cities: exactly one primary location and up to two secondary locations, each location specified as a (country, city) pair. The locations are saved as a unit and may be re-saved (Story 5).
- **FR-014**: System MUST require the primary location and MUST reject a submission where the primary location is missing or where any two of the up-to-three submitted locations are identical (country, city) pairs.
- **FR-015**: System MUST check each submitted location against a maintained reference list of designated "GWC cities" (country + city pairs) to determine whether any submitted location matches one.
- **FR-016**: When none of the submitted locations match a GWC city, system MUST, at submit (FR-030), record the outcome as "in-person meeting to be arranged," present that outcome to the member on the completion screen, and make the submission visible to staff so the meeting can be arranged.
- **FR-017**: When at least one submitted location matches a GWC city, system MUST, at submit, record which submitted location matched which GWC city and present the member a distinct placeholder outcome indicating the club will follow up — without implying an in-person meeting and without erroring, since the downstream flow for this case is intentionally undefined and out of scope for this feature.
- **FR-018**: System MUST persist a partially completed profiling attempt so that a member who leaves mid-flow resumes at their next unanswered question rather than restarting.
- **FR-019**: System MUST persist each member's finished profiling answers/outcome durably and associate them with that member, queryable by staff.
- **FR-020**: System MUST NOT allow a member to modify their profiling answers once profiling is submitted/complete, through member-facing routes (before submit, answers are freely editable — FR-031) (staff-side correction, if ever needed, is a separate concern not covered by this feature).
- **FR-021**: System MUST maintain the "GWC city" reference list (FR-015) as data separate from the profiling submissions themselves, so the list can grow over time without altering past submissions' recorded match state.
- **FR-022**: If a German-resident member's FR-008 answer changes before profiling is submitted, system MUST discard any follow-up answer(s) already captured under the previous FR-008 answer, so a switched choice never leaves stale, mismatched follow-up data in place.

- **FR-023**: System MUST ask a German-resident member (Q3, after languages) their yearly revenue/salary range as a single choice: 0–50K Euro; 50K–100K Euro; 100K+ Euro. The same question is asked of a partner (FR-026).
- **FR-024**: System MUST ask every member (after their branch's questions: Q5 for Germany, the nearest cities for elsewhere) their relationship & family status (Q6) as multi-select tags: Single, Partner, Family, Kids; at least one required.
- **FR-025**: *Single* MUST be exclusive: it cannot be saved together with any other tag, and the clients MUST make selecting one deselect the other.
- **FR-026**: When *Kids* is selected, system MUST ask how many kids (a whole number, 1–20) and, for each kid, an age range: 0–6, 6–14, 14–18, 18+. All ranges are required.
- **FR-027**: When *Partner* or *Family* is selected, system MUST collect the partner's answers to the German questionnaire (languages, yearly income, qualification, occupation) — all required — under the same rules as the member's own (FR-005–FR-007, FR-023). The partner is **not** asked the settling question (FR-004), Q6 or Q7. Kids and partner sub-flows may both apply; kids first, then partner.
- **FR-028**: After Q6 and its sub-flows, a German-resident member MUST continue to Q7 (FR-008); a non-German member MUST NOT be asked Q7 and goes to the review step.
- **FR-030**: System MUST complete profiling only on an explicit member submit after a review step, and MUST refuse the submit, naming what is missing, if any applicable question is unanswered. For the elsewhere branch, the GWC-city match and outcome are computed at this moment.
- **FR-031**: Until submit, system MUST let the member re-answer any earlier question and MUST return the saved answers so the clients can pre-fill it; a re-answer replaces the previous value.
- **FR-032**: System MUST provide Back navigation on every step but the first, and a review step listing every answer with a "Change" action that returns to the review after saving. This applies to both web and Expo.
- **FR-033**: When a changed answer alters which questions apply — Q6 tags removing *Kids* or *Partner*/*Family*, a different kid count, a different Q7 path — system MUST discard the answers that no longer apply (kids, partner answers, surplus kid age ranges, previous Q7 follow-ups) so no stale data is submitted.
- **FR-035**: The industry/business question, asked on every Q7 path, MUST be a single-choice dropdown of exactly these 21 values: Technology & IT; Finance & Banking; Real Estate; Construction & Engineering; Retail & E-commerce; Hospitality & Tourism; Food & Beverage; Healthcare & Pharmaceuticals; Education & Training; Manufacturing & Industrial; Automotive & Transportation; Logistics & Supply Chain; Consulting & Professional Services; Legal Services; Marketing & Advertising; Media & Entertainment; Government & Public Sector; Energy & Utilities; Telecommunications; General Sales; Other. Its wording is "Which industry or business area is your business or line of work in?". The list is shared reference data in `@gwc/contracts`.
- **FR-034**: The step order and "what is still missing" MUST be defined once in the shared contracts and used by the server (submit check) and both clients (navigation), so they cannot disagree.

### Key Entities *(include if feature involves data)*

- **Profiling Record**: One per member; tracks which branch applies (derived from `country_of_residence`), progress (which questions are answered / which fields are filled), completion state, and the final outcome for the non-German branch (in-person-meeting vs. GWC-city-matched vs. not yet resolved).
- **Profiling Answer (German branch)**: The five base values for a German-resident member — settling status, one-or-more spoken languages, qualification level, occupation, desired future work type — plus the desired-work-type-specific follow-up(s): sector/industry and work-readiness (Employee), offering and product/service idea (Freelance / own business), or one-or-more selected life-priority statements (not sure yet).
- **Relationship & Family Status**: One or more of Single/Partner/Family/Kids per member (both branches), the list of kids' age ranges (one entry per kid), and, when Partner/Family applies, a **Partner Answer** set: settling status, languages, yearly income, qualification, occupation.
- **Yearly income range**: New single-choice German-branch value (and partner value).
- **Nearest City Submission (non-German branch)**: The primary location plus up to two secondary locations submitted by a non-German-resident member, each a (country, city) pair, together with which (if any) matched a GWC city.
- **GWC City**: A designated (country, city) pair maintained independently of any single member's submission, against which nearest-city submissions are checked.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of newly approved members are shown the correct branch of the profiling questionnaire (German five-question flow vs. nearest-city flow) on their very next sign-in, with no approved member ever reaching an ordinary member feature before profiling is complete.
- **SC-002**: A German-resident member can complete the full questionnaire — the five base questions plus whichever desired-work-type follow-up(s) apply — in a single sitting in under 4 minutes.
- **SC-003**: A non-German-resident member can submit their nearest cities in under 2 minutes.
- **SC-007**: A member can go back and change any earlier answer, and the submitted result contains only the final answers (no stale kids, partner or Q7 follow-up data) in 100% of tested change sequences.
- **SC-004**: 100% of non-German submissions resolve to exactly one of the two defined outcomes (in-person meeting arranged, or GWC-city-matched placeholder) with zero submissions erroring or hanging in an unresolved state.
- **SC-005**: A member who abandons profiling mid-flow and returns resumes at the correct next question 100% of the time, with zero loss of previously submitted answers.
- **SC-006**: Staff can locate any member's profiling outcome (including which city matched, if any) without needing to inspect raw data directly.

## Assumptions

- "Super admin approves the use[r] request" refers to the existing Phase 1 membership-application approval (`membership_applications.state = 'approved'`); this feature adds no new approval step of its own.
- `country_of_residence` is already captured and fixed by the time profiling begins (existing Phase 1 field); this feature only reads it, never re-asks it.
- Profiling is a one-time flow per member: once complete, member-facing routes never show it again, and answers are not member-editable afterward (FR-020). Any future need for a member to update their answers, or for staff to correct one, is out of scope here.
- The GWC city reference list is new data introduced by this feature (a small admin-maintained list of designated cities), not derived from an existing table; a full staff-facing CRUD interface for managing that list is out of scope for this feature's minimum scope; it may be seeded/maintained directly until a dedicated management UI is requested.
- The downstream flow when a GWC city matches (Story 3 / FR-017) is explicitly out of scope beyond recording the match and showing a non-committal placeholder to the member — no matching, scheduling, or notification logic beyond that placeholder is built here.
- "Making the submission visible to staff" (FR-016, FR-019) means the data is queryable through the existing staff/admin surface conventions of this platform; this feature does not require new staff UI screens beyond what's needed to see the record, unless later requested.
- The language list (FR-005) and the fixed choice lists (FR-006–FR-008) are treated as shared reference data suitable for the existing contracts package, consistent with how the platform already shares country lists between server and clients.
- The "offering"/"idea"/"product or service" questions (FR-009, FR-010, FR-029) are free-text answers, not fixed choice lists (the industry is a fixed list — FR-035) — the business description gives no candidate list for them, unlike every other German-branch question.
- The "I am not sure yet" life-priority statements (FR-011) require at least one selection to proceed, matching the same requirement already placed on the languages question (FR-005) — the business description does not say whether zero is allowed, and this feature treats every required question as needing a real answer.
- Mobile app and web console both present the same profiling gate against the same endpoints, consistent with how Phase 1 onboarding already works across both faces.
- The partner questionnaire is Q2–Q5 (languages, income, qualification, occupation): the settling question was removed for the partner in revision 3; the partner is not asked Q7, and no partner name or contact detail is collected — the business description asks only for the questionnaire answers.
- Members who **completed** profiling before this revision are not re-gated: completed profiling is final (FR-020) and the trigger enforces it. Only members mid-flow, and members approved from now on, see the new questions.
- Back navigation covers the whole flow up to submit; the server keeps every answer as it is saved, so leaving and returning loses nothing (FR-018).


---

# Revision 4 (2026-09-30): Phase 1 rules and the rewritten Phase 2

Source: the updated `german-world-club-business-description.md`. Where this section conflicts with Revisions 1–3 it wins; the conflicts are the two the user decided explicitly (below).

## User Stories

### User Story 6 - Register captures age confirmation, primary language and residence (P1)
The applicant confirms their age, chooses **German** or **Non-German** as their primary language, and picks their country of residence from **Germany / Austria / Switzerland / Others**; *Others* opens the full country list and the ISO code is stored as before. **Independent test**: register with `ageConfirmed: true` and `primaryLanguage`; either missing or `ageConfirmed: false` is refused.

### User Story 7 - Phase 1 decisions (P1)
When the email is confirmed: a **Non-German** applicant is **denied automatically** (never in the staff queue; the denial email carries a reason); a **German** applicant receives the **thank-you email** ("approval may take up to 48 hours") and waits. A scheduled job **approves** any German application still pending **24 hours** after submission, with the same approval email as a manual approval. **Independent test**: quickstart Scenario 10.

### User Story 8 - Settling question (P2)
Q1 "Do you know where you'll settle?": *Please help* shows an information screen and asks nothing; *Yes* asks country then city; if the place is **Dubai**, "How long are you already working?" (less than 1 year / 1–3 / 3–5 / 5–10 / more than 10 years). The **partner** is asked the same (this reverses Revision 3, which had removed it for the partner).

### User Story 9 - Question order, income, Q7 (P1)
German order: Q1 settling, Q2 languages, Q3 qualification, Q4 occupation, **Q5 yearly income** (0–50K / 50–100K / 100K+ / 500K+ / 1M+ Euro), Q6 relationship, Q7 work. Q7: Employee (industry, ready); Freelancer and Build My Own Business (offering, industry, idea); **Business Owner (industry, then multi-select Produce / Distribute / Sales / Other)**; **"I am not sure yet" (multi-select statements, no industry)** — this reverses Revision 3's single-select and industry-on-every-path for this option only.

### User Story 10 - Non-German path (P2)
Nearest city (one primary, two secondary) from country/city dropdowns fed by the InterNations list; a designated GWC city is always selectable. **No GWC city** → straight to the review (Q6 is not asked; Submit gives the in-person-meeting outcome). **A GWC city** → Q6 and its sub-flows, then the review. Q7 is German-only.

## Requirements (FR-036 onward)
- **FR-036** Register requires `ageConfirmed = true` and `primaryLanguage ∈ {german, non_german}`; both are stored (`age_confirmed_at`, `primary_language`).
- **FR-037** At email confirmation a `non_german` application is denied by the system (reason "Primary language is not German"), `decided_automatically = true`, never queued for staff; a `german` one gets the `onboarding.thank-you` email. Applications with no stored language trigger neither rule.
- **FR-038** The `onboarding.auto-approve` job approves `german` applications pending 24 h after `submitted_at`; a staff decision made first wins; the job is stoppable like every platform job.
- **FR-039** Staff see the applicant's language and whether a decision was automatic.
- **FR-040** Q1 follows US8; the Dubai duration is one of five bands; the partner is asked Q1 too.
- **FR-041** Question order and income bands follow US9; the industry is a fixed list of 21 (FR-035) on every Q7 path except "not sure".
- **FR-042** Business Owner's product/service is a non-empty multi-select of `produce | distribute | sales | other`.
- **FR-043** "I am not sure yet" needs at least one statement and no industry; an industry sent for that path is refused.
- **FR-044** The GWC match is stored when the non-German cities are saved (`matched_gwc_city_id`) and decides whether Q6 is asked; when the cities stop matching, the Q6, kids and partner answers are deleted. The outcome (`in_person_meeting` / `gwc_city_match`) is still set at submit.
- **FR-045** The city dropdowns offer `world_cities` ∪ `gwc_cities` for a country; for a country neither covers (about 90) the city is free text; a city outside the list of a covered country is refused.

## Decisions taken with the user
Partner asked Q1 again; "not sure" multi-select without industry; "Others" opens the country picker; InterNations data supplied as `400_Cities_160_Countries.xlsx`; Dubai duration in five bands; no legacy data to preserve (the development database is rebuilt with `migrate:down`); a non-German member with no GWC city still goes through review + Submit.


---

# Revision 5 (2026-10-01): one German pathway for Germany, Austria and Switzerland

The business description now routes residents of **Germany, Austria and Switzerland** through the one German pathway (settling, languages, qualification, occupation, income, relationship, Q7); **Others** follow the non-German pathway. This amends FR-003 and the Edge Case on a missing country: the German pathway needs `country_of_residence` in `{DE, AT, CH}`; any other, or a missing, value is non-German. The set is `GERMAN_PATHWAY_COUNTRIES` / `isGermanPathway` in `@gwc/contracts/onboarding` and is the only place the server decides it; neither client branches on the country (they render what `GET /profiling/status` says). Migration `038` removes the unfinished non-German rows of Austrian and Swiss members so they restart on the right pathway.


---

# Revision 6 (2026-10-05): the partner is not asked the settling question

The business description's partner questionnaire is now **German Q2–Q5** (languages, qualification, occupation, income), and for the non-German path **the same German questionnaire from Q2** — in both, without the relationship and family-status question (Q6) and without Q1. This **reverses Revision 4's "partner asked Q1 again"** (US8, FR-040) and restores Revision 3's rule for the partner only; the member's own Q1 is unchanged.

- **FR-046** The partner questionnaire is languages, qualification, occupation, yearly income — all required — on **both** pathways. The partner is never asked Q1 (settling place, Dubai duration), Q6 or Q7.
- **FR-047** The API refuses partner settling fields (`settlingStatus`, `settlingCountry`, `settlingCity`, `settlingWorkDuration`) on `partner`, and `profilingSteps` / `profilingMissing` no longer emit any `partner-settling*` step, so a client cannot show it and the server cannot require it.
- **FR-048** Partner settling answers already saved are discarded with their columns (migration `039`); they were never shown to staff or members. Completed profiles are otherwise untouched (R15: no re-profiling).
- **FR-049** Web console and Expo app show the same four partner steps, in the order above, then continue to Q7 (German) or the review (non-German). Both render the steps list the contracts return; neither carries its own copy of the order.

Amends US4 ("Q1–Q5" → "Q2–Q5"), US8 and FR-027/FR-040.
