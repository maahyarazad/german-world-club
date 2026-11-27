# Specification Quality Checklist: Offer Media Gallery, Fallback Image and Search

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-27
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — the spec names no framework, library, endpoint or table. The only technical-looking items are properties of the supplied artwork (1672 x 941, WebP) and the 16:9 ratio, which are requirements, not design.
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — the open points are recorded as defaults in "Decisions taken on the requester's behalf", each with the reason it is safe to proceed.
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (SC-006 states a latency and a data volume, not a mechanism)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded — "Out of Scope" and Decisions 1-8
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria — FR-001..007 map to US1/US2, FR-008..011 to US2, FR-012..018 to US3, FR-019..028 to US4, FR-029..030 to all
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- **Please confirm before implementation** (they change scope, not just wording). None blocks planning:
  1. *"Global search"* is read as "complete across all pages, one box per surface", not "one box over both surfaces" (Decision 1).
  2. *Super admin* chooses among the offer's existing media only; no uploading on a merchant's behalf (Decision 5).
  3. *Main-media choice* is web-only; the phone's merchant editor is not given the control (Decision 6).
- **Discovered while reading the code, folded into scope as FR-027**: the web Marketplace shows only the first page of listings and ignores the next-page cursor, so a search could not reach results past the first 20 without paging.
- **Discovered, folded into scope as FR-031**: the staff sidebar's "Merchant offers" tab and the "Marketplace" (moderation) tab both link to `/konsole/admin/angebote`, and the route table declares that path twice, so the first (moderation) wins and the staff merchant-offers list is unreachable. Without fixing it, "a super admin chooses the main media" cannot be done from the console.
- **Discovered, folded into scope as FR-012**: the "lead picture" rule is written three times on the server (offers list, redemptions list, redeem response). Changing it (first *ready* item, honouring the chosen main) in one place and not the others would make the card and the detail disagree.
