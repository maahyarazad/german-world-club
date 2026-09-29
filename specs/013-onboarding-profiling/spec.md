# Feature Specification: Onboarding Phase 2 — Profiling Workflow

**Feature Branch**: `013-onboarding-profiling`

**Created**: 2026-09-29

**Status**: Draft

**Input**: User description: "plan to implement the second phase of onboarding after super admin approves the use request" — a country-branching profiling questionnaire (5 sequential questions for German residents; a nearest-city capture with GWC-city matching for everyone else) that begins once a membership application is approved.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - German-resident applicant completes profiling (Priority: P1)

A member whose `country_of_residence` is Germany has just had their membership application approved. On their next sign-in (web or app), instead of reaching ordinary member features, they are presented with a sequential five-question profiling flow: settling status, languages spoken, highest qualification, current occupation, and desired future work type. Once all five are answered, profiling is complete and they gain full member access.

**Why this priority**: This is the majority path (Germany-resident applicants) and delivers the core value of the feature end to end — it alone makes the gate meaningful and unblocks real members.

**Independent Test**: Approve a `country_of_residence = 'DE'` applicant, sign in, answer all five questions in order, and confirm the member reaches ordinary member routes afterward and the answers are persisted.

**Acceptance Scenarios**:

1. **Given** an approved member with `country_of_residence = 'DE'` who has not started profiling, **When** they sign in, **Then** they are shown Question 1 (settling status) and no other member route succeeds until profiling is complete.
2. **Given** a member mid-flow who has answered Q1 and Q2, **When** they sign in again later, **Then** they resume at Q3 rather than restarting or losing prior answers.
3. **Given** a member who has answered all five questions, **When** the fifth answer is submitted, **Then** profiling is marked complete and every ordinary member route becomes reachable.
4. **Given** Q2 (languages), **When** the member selects multiple languages from the dropdown, **Then** each selection appears as its own removable bubble and at least one language is required to proceed.

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

### Edge Cases

- What happens when a member's `country_of_residence` is missing or not a recognized value? → Treated as non-German (routed to the nearest-city flow), since the German flow requires a confirmed `DE` value.
- What happens if a member abandons the flow partway (closes the app mid-questionnaire)? → Answers already submitted are persisted; the member resumes at the next unanswered question on their next visit (see Story 1, Scenario 2).
- What happens if the same city name exists in two countries (e.g., a city name shared by Germany and Austria)? → GWC-city matching is on the (country, city) pair, not city name alone.
- What happens if a member tries to submit the same primary city as one of their secondary cities? → Rejected; the three submitted locations must be distinct (country, city) pairs.
- What happens if an application is later un-approved? → Not applicable: application decisions are final once made (existing Phase 1 rule), so a completed or in-progress profiling record is never invalidated by a status change.
- What happens on a route that is not part of profiling while profiling is incomplete? → Refused, the same way an unapproved applicant is currently refused on non-onboarding member routes, until profiling is complete.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST present the profiling questionnaire to a member if and only if their membership application state is `approved` and their profiling is not yet complete.
- **FR-002**: System MUST refuse every ordinary member route for an approved-but-not-yet-profiled member, the same way an unapproved applicant is refused today, and MUST allow only the profiling questions/submission routes through this gate — profiling is mandatory and cannot be skipped or deferred, for every member type.
- **FR-003**: System MUST branch the questionnaire on the member's `country_of_residence` captured during Phase 1 registration: Germany (`DE`) presents the five-question flow (FR-004–FR-009); any other or missing value presents the nearest-city flow (FR-010–FR-014).
- **FR-004**: System MUST ask a German-resident member whether they already know where they will settle, offering exactly two choices: "Yes" or "Please help."
- **FR-005**: System MUST ask a German-resident member which languages they speak, offered as a searchable dropdown, allowing more than one selection, with each selection displayed as an individually removable bubble, and requiring at least one selection to proceed.
- **FR-006**: System MUST ask a German-resident member their highest qualification level, as a single choice from a fixed list: No formal qualification; Secondary/High School; Diploma/Certificate; Associate Degree; Bachelor's Degree; Master's Degree; Doctorate (PhD); Professional Qualification (e.g., CA, CPA, MBA).
- **FR-007**: System MUST ask a German-resident member their current occupation/profession, as a single choice from a fixed list: Student; Unemployed; Self-Employed/Business Owner; Government Employee; Private Sector Employee; Teacher/Educator; Healthcare Professional; Engineer; IT/Software Professional; Accountant/Finance Professional; Lawyer/Legal Professional; Sales/Marketing Professional; Consultant; Homemaker; Retired; Freelancer; Other.
- **FR-008**: System MUST ask a German-resident member what kind of work they would like to do in future, as a single choice from a fixed list: Employee; Freelance; I want to build my own business and ideas; I am not sure yet.
- **FR-009**: System MUST mark a German-resident member's profiling complete only once all five answers (FR-004–FR-008) have been captured, and MUST present the questions in order, one at a time, skipping none.
- **FR-010**: System MUST ask a non-German-resident member for their nearest cities: exactly one primary location and up to two secondary locations, each location specified as a (country, city) pair.
- **FR-011**: System MUST require the primary location and MUST reject a submission where the primary location is missing or where any two of the up-to-three submitted locations are identical (country, city) pairs.
- **FR-012**: System MUST check each submitted location against a maintained reference list of designated "GWC cities" (country + city pairs) to determine whether any submitted location matches one.
- **FR-013**: When none of the submitted locations match a GWC city, system MUST record the outcome as "in-person meeting to be arranged," mark profiling complete, present that outcome to the member, and make the submission visible to staff so the meeting can be arranged.
- **FR-014**: When at least one submitted location matches a GWC city, system MUST record which submitted location matched which GWC city, mark profiling complete, and present the member a distinct placeholder outcome indicating the club will follow up — without implying an in-person meeting and without erroring, since the downstream flow for this case is intentionally undefined and out of scope for this feature.
- **FR-015**: System MUST persist a partially completed profiling attempt so that a member who leaves mid-flow resumes at their next unanswered question rather than restarting.
- **FR-016**: System MUST persist each member's finished profiling answers/outcome durably and associate them with that member, queryable by staff.
- **FR-017**: System MUST NOT allow a member to modify their profiling answers once profiling is marked complete through member-facing routes (staff-side correction, if ever needed, is a separate concern not covered by this feature).
- **FR-018**: System MUST maintain the "GWC city" reference list (FR-012) as data separate from the profiling submissions themselves, so the list can grow over time without altering past submissions' recorded match state.

### Key Entities *(include if feature involves data)*

- **Profiling Record**: One per member; tracks which branch applies (derived from `country_of_residence`), progress (which questions are answered / which fields are filled), completion state, and the final outcome for the non-German branch (in-person-meeting vs. GWC-city-matched vs. not yet resolved).
- **Profiling Answer (German branch)**: The five captured values for a German-resident member — settling status, one-or-more spoken languages, qualification level, occupation, desired future work type.
- **Nearest City Submission (non-German branch)**: The primary location plus up to two secondary locations submitted by a non-German-resident member, each a (country, city) pair, together with which (if any) matched a GWC city.
- **GWC City**: A designated (country, city) pair maintained independently of any single member's submission, against which nearest-city submissions are checked.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of newly approved members are shown the correct branch of the profiling questionnaire (German five-question flow vs. nearest-city flow) on their very next sign-in, with no approved member ever reaching an ordinary member feature before profiling is complete.
- **SC-002**: A German-resident member can complete all five profiling questions in a single sitting in under 3 minutes.
- **SC-003**: A non-German-resident member can submit their nearest cities in under 2 minutes.
- **SC-004**: 100% of non-German submissions resolve to exactly one of the two defined outcomes (in-person meeting arranged, or GWC-city-matched placeholder) with zero submissions erroring or hanging in an unresolved state.
- **SC-005**: A member who abandons profiling mid-flow and returns resumes at the correct next question 100% of the time, with zero loss of previously submitted answers.
- **SC-006**: Staff can locate any member's profiling outcome (including which city matched, if any) without needing to inspect raw data directly.

## Assumptions

- "Super admin approves the use[r] request" refers to the existing Phase 1 membership-application approval (`membership_applications.state = 'approved'`); this feature adds no new approval step of its own.
- `country_of_residence` is already captured and fixed by the time profiling begins (existing Phase 1 field); this feature only reads it, never re-asks it.
- Profiling is a one-time flow per member: once complete, member-facing routes never show it again, and answers are not member-editable afterward (FR-017). Any future need for a member to update their answers, or for staff to correct one, is out of scope here.
- The GWC city reference list is new data introduced by this feature (a small admin-maintained list of designated cities), not derived from an existing table; a full staff-facing CRUD interface for managing that list is out of scope for this feature's minimum scope; it may be seeded/maintained directly until a dedicated management UI is requested.
- The downstream flow when a GWC city matches (Story 3 / FR-014) is explicitly out of scope beyond recording the match and showing a non-committal placeholder to the member — no matching, scheduling, or notification logic beyond that placeholder is built here.
- "Making the submission visible to staff" (FR-013, FR-016) means the data is queryable through the existing staff/admin surface conventions of this platform; this feature does not require new staff UI screens beyond what's needed to see the record, unless later requested.
- The language list (FR-005) and the fixed choice lists (FR-006–FR-008) are treated as shared reference data suitable for the existing contracts package, consistent with how the platform already shares country lists between server and clients.
- Mobile app and web console both present the same profiling gate against the same endpoints, consistent with how Phase 1 onboarding already works across both faces.
