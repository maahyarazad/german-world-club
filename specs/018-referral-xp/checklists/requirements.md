# Specification Quality Checklist: Referral links and XP

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-12
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
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

- The spec mentions existing platform features by name (the approval gate, the audit log,
  the push outbox, `/konsole/registrieren`). They say which current behaviour must be kept,
  not how to build this feature, and spec 017 does the same.
- FR-014 ("must hold even against direct database edits") is a business guarantee. XP will
  become money, so a history that only the application protects is not good enough.
- Clarified 2026-11-12: XP at registration (FR-010), every role individually including staff
  (FR-011), referrer only (FR-012). The fraud and conflict-of-interest risks these choices
  accept are written into the spec's Clarifications section as an accepted risk, and US4
  (staff reversal) is marked as required before XP is converted into money.
