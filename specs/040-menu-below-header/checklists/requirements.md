# Specification Quality Checklist: The header menu opens below the header, and stays the phone's own menu

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-26
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — the requirements and success criteria name none; the Assumptions carry the minimum technical context needed to explain the iPhone attempt, and point to the research notes for the rest
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders — the stories, requirements and criteria are; the Assumptions are more technical
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — the one raised (FR-003, the iPhone) was answered 2026-11-26 (Q1, option B) and is recorded under Clarifications
- [x] Requirements are testable and unambiguous — FR-003 is now an attempt with a defined test (a phone) and a defined fallback (take it back out)
- [x] Success criteria are measurable (SC-001 0 px overlap; SC-005 12 points; SC-003 has an explicit alternative outcome if the phone test fails)
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Iteration 1 found FR-007 ("must not extend meaningfully") untestable and the spec naming a source file; both were fixed (a 12-point default, and a pointer to the research notes).
- Iteration 2, after the answer to Q1: all items pass.
- What the spec cannot settle, and a phone will: whether the system menu, with its invisible area lengthened past the header, opens below the header or still covers the dots (US3, FR-003, SC-003). Both outcomes are specified.
- This feature supersedes feature 039's US9, FR-026 to FR-029, plan item 8 and tasks T046 to T054 for the iPhone; those documents say so.
