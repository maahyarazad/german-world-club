# Specification Quality Checklist: Reset a forgotten password in the app, by SMS code

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-27
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — the spec names no framework, endpoint, table or library. It does name "the table that stores one-time codes" once, in Decision 1, because the requester asked specifically about the database; the plan carries the detail.
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — the open points are defaults in "Decisions taken on the requester's behalf", each with its reason.
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (SC-004 and SC-007 state a probability and a scope of change, not a mechanism)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded — "Out of Scope" and Decisions 1 to 11
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria — FR-001..006 map to US1 and US3, FR-007..011 to US2, FR-012..016 to all, FR-017..019 to US4, FR-020..024 to US5
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- **Needs the requester's agreement before implementation** (it touches an explicit preference): Decision 1. "Ideally no database change" cannot be met in full. The only schema obstacle is one rule on the one-time-code table, which allows four named purposes and so refuses a fifth. Every way around it that I checked is unsafe: reusing an existing purpose lets a reset code sign a person in without a password, and keeping the code in the reset-link table lets it be guessed past the five-try limit. Details in research R1.
- **Decisions that change scope, not just wording**: members only (Decision 2); six-digit code and three codes an hour (3); a failed text is not shown to the member (5, and US3 scenario 7).
- **Added 2026-11-27 (US4, US5)**: the backdrop and the sign-in, forgot-password and reset-password look. These name the requester's own files (`main-bg-*`, `gwc-logo`) and two measured limits (1242 px, 1.5 MB, 4.5:1 contrast) because those are what make FR-017 to FR-022 testable; the mechanism (how the copies are made, which component draws them) stays in the plan and research R12 to R15. **Choices to confirm** (plan, open items 5 to 8; the logo one is closed: the requester chose the welcome screen's emblem, R14): the dark backdrop keeps its darkening wash because measured contrast fails without it; the two 2 MB originals are committed as source art; and "the exact same buttons" is read as the app's standard buttons laid out like the welcome screen's. Also: the requester's empty-string wash value (`''`) is not a colour and becomes `'transparent'` (research R13).
- **Found while reading the code, folded in**: the existing resend route re-issues a code with the default four digits, which the six-digit reset would reject. FR-006 and the plan's resend task cover it.
