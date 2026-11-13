# Feature Specification: Every member can post on the Marketplace, except job offers

**Feature Branch**: `021-member-marketplace-posting`
**Created**: 2026-11-13
**Status**: Draft
**Input**: User description: "member roles should be able to post on the Maket place and listing but they cannot offer a job (update the german-world-club-business-description.md) as well on this so they can post other type of listing"

## Context

Today, posting a marketplace listing needs a per-member permission that staff would have to
grant. No staff screen grants it, so in practice only a few seeded members can post at all. Any
member who can post can also offer a job.

This feature turns that around:
- **Every member can post.**
- **No member can offer a job.** The marketplace is for members trading with members. Hiring is
  an employer's business, and employers (merchants, partners) are not members.

## Clarifications

### Session 2026-11-13

- Q: Should staff still be able to stop one member from posting? → A: No. Posting is open to
  every onboarded member. Misuse is handled by moderation and locking (FR-003).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A member posts a listing without being granted anything first (Priority: P1)

A member who has finished onboarding opens Marketplace and sees **New listing**. They post a
vehicle, a property, a general product or service, or a job *request* (they're looking for
work). No staff action is needed first.

**Why this priority**: this is the feature. Today the Marketplace is effectively read-only for
almost everyone, which is the complaint behind it.

**Independent Test**: sign in as a member who never had posting granted. Create a listing in
each allowed category, and see it appear in the marketplace for another member.

**Acceptance Scenarios**:

1. **Given** a member who has finished onboarding and never had posting granted, **When** they
   open Marketplace, **Then** they see **New listing** on the web and on the app.
2. **Given** that member, **When** they post a general listing (offer or request) after
   accepting the marketplace terms, **Then** it's published and other members see it.
3. **Given** that member, **When** they post a vehicle or property listing, either offer or
   request, **Then** it's published.
4. **Given** that member, **When** they post a job **request** (seeking work), **Then** it's
   published.
5. **Given** a member who hasn't accepted the current marketplace terms, **When** they try to
   post, **Then** they're asked to accept them first, as today.
6. **Given** an applicant still in onboarding or profiling, **When** they reach the marketplace,
   **Then** they're refused, as on every member route today.

---

### User Story 2 - Job offers are not available to members (Priority: P1)

A member composing a listing can't choose "offer" together with the "job" category. If anything
sends that combination anyway, the platform refuses it and nothing is saved.

**Why this priority**: it's the other half of the rule. Opening posting to everyone without it
would open job offers to everyone.

**Independent Test**: as any member, try to create a job offer through the form and directly.
Both are refused, and no listing exists afterwards.

**Acceptance Scenarios**:

1. **Given** the compose form on the web or the app, **When** a member picks the job category,
   **Then** only "request" is available as the mode, with a short note that job offers aren't
   available to members.
2. **Given** the compose form with "offer" selected, **When** the member picks the job category,
   **Then** the mode changes to "request" and the note explains why. The member is never left
   with a form that can't be sent.
3. **Given** a job-offer submission that bypasses the form, **When** the platform receives it,
   **Then** it's refused with a clear reason, and no listing or draft is stored.
4. **Given** a member's existing **offer** listing in another category, **When** they edit it and
   change its category to job, **Then** the change is refused and the listing stays as it was.
5. **Given** the marketplace filters, **When** a member browses, **Then** they can still filter
   jobs and see job requests, and any job offers that are still active (Story 3).

---

### User Story 3 - Job offers that already exist are wound down, not deleted (Priority: P2)

Members who posted job offers before this change keep them, and other members can still see
them. The owner can still close them as filled, withdraw them, or answer requests about them.
They can't be renewed into a new job offer.

**Why this priority**: listings are member content with history, and the platform never deletes
member content to enforce a new rule. There are few such listings (only seeded members could
post).

**Independent Test**: with a job offer created before the change, the owner can still view it,
mark it filled or withdraw it, and reply to requests. Nobody can create a new one.

**Acceptance Scenarios**:

1. **Given** an active job offer from before the change, **When** members browse, **Then** it's
   shown as before until it ends (filled, withdrawn, expired or hidden).
2. **Given** that listing, **When** its owner marks it filled or withdraws it, **Then** that works
   as today.
3. **Given** that listing, **When** its owner edits its text or details, **Then** the edit is
   accepted. The listing stays a job offer, but nothing can *create* a new one.

---

### User Story 4 - The business description states the rule (Priority: P2)

`german-world-club-business-description.md`, the document the platform is rebuilt from,
describes the Marketplace:
- who may post (every member who finished onboarding, after accepting the terms);
- the categories and modes;
- that job offers aren't open to members.

**Why this priority**: the user asked for it. Without it the next rebuild would bring back the
per-member flag and member job offers.

**Independent Test**: read the document. It has a Marketplace section with these rules, and the
Core Server Functions table refers to it.

**Acceptance Scenarios**:

1. **Given** the business description, **When** someone reads the Marketplace section, **Then**
   it says who may post, the four categories, offer and request, and that a member can request
   a job but not offer one.

### Edge Cases

- **A member who never had the old posting permission, or had it set to false**, can post like
  everyone else (FR-003).
- **Influencers** are members, so they follow the same rules: they can post, and can't offer jobs.
- **Merchants, partners and staff** still can't post member listings. They aren't members, and
  this feature gives them nothing new. Offering jobs as an employer would be a separate feature.
- **A draft job offer** saved before the change can't be published. The owner can change its
  mode to request or delete the draft.
- **Moderation** is unchanged. Staff can hide or remove any listing, including the remaining job
  offers.
- **A burst of new posters**: the existing posting rate limits and the marketplace terms still
  apply, and moderation and reporting work as before.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every member who has finished onboarding (approved, profiling complete) and is
  active MUST be able to create marketplace listings, with no individual grant from staff.
- **FR-002**: Accepting the current marketplace terms MUST remain required before a first post,
  and again when the terms change, as today.
- **FR-003**: Posting MUST NOT depend on any individual member permission. Staff don't switch
  posting on or off for one member. Misuse is handled by moderation (hide or remove a listing)
  and by locking the member, both as today. *(Clarified 2026-11-13.)*
- **FR-004**: The platform MUST refuse any listing whose category is **job** and whose mode is
  **offer**, from any member, on creation and on edit (including changing an existing listing's
  category to job). Nothing is stored.
- **FR-005**: The refusal MUST have its own reason, distinct from "not permitted to post" and from
  ordinary field errors, so the clients can explain it.
- **FR-006**: Members MUST be able to post job **requests** (seeking work).
- **FR-007**: The compose form on web and app MUST NOT offer the job + offer combination, and
  MUST say briefly why when the job category is chosen.
- **FR-008**: Job offers that existed before this change MUST remain visible and manageable by
  their owner (edit text and details, mark filled, withdraw), and expire, as before. They are
  never deleted or hidden by this change.
- **FR-009**: A draft job offer MUST NOT be publishable.
- **FR-010**: Merchants, partner users and staff MUST remain unable to create member listings.
- **FR-011**: The business description MUST gain a Marketplace section stating FR-001, FR-002,
  FR-004 and FR-006, and the four categories with offer and request.
- **FR-012**: The marketplace's browse and filters MUST keep working for jobs (requests and the
  remaining offers).

### Key Entities

- **Marketplace listing**: unchanged. Category (vehicle, property, job, general), mode (offer or
  request), state. The new rule restricts which combinations a member may create.
- **Member posting permission**: today an individual grant that is required to post. It is no
  longer consulted for posting (FR-003).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of members who have finished onboarding and accepted the terms can publish a
  non-job-offer listing, with no staff involvement.
- **SC-002**: 0 job offers can be created or produced by editing after the change, through any
  face or directly.
- **SC-003**: Every job offer that existed before the change is still present afterwards, in the
  same state.
- **SC-004**: A member choosing the job category understands in the form, before submitting,
  that only requests are possible. No member sees the job-offer refusal from a normal use of
  the form.

## Assumptions

- "Member roles" means members, influencers included. Merchant and partner users are their own
  audiences, and this feature doesn't open member listings to them.
- "Cannot offer a job" means the job category in offer mode. Job requests (a member looking for
  work) are allowed, because the user said members should post the other types of listing.
- Existing job offers are wound down rather than removed (Story 3). Only seeded members could
  post, so there are few of them.
- The listing rate limits, terms, moderation, reports and the 020 request-and-email flow are
  unchanged.
