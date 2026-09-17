<!--
SYNC IMPACT REPORT
==================
Version change: (unratified template) -> 1.0.0
Bump rationale: MINOR-from-nothing is not applicable; this is the initial ratification of a
document that previously contained only unfilled bracketed placeholder tokens. No prior principles
existed, so nothing was redefined or removed. Adopted as 1.0.0.

Modified principles: none (no prior principles existed)

Added sections:
  - Core Principles I-VI (six principles; the resolved scaffold offered five slots, extended
    to six because Principle VI encodes a governance rule supplied in this session that none
    of the other five subsumes)
  - Technology & Security Baseline (SECTION_2)
  - Development Workflow & Quality Gates (SECTION_3)
  - Governance (amendment procedure, versioning policy, compliance review)

Removed sections: none

Source of derived content:
  - BUSINESS_DESCRIPTION.md Section 12 ("Cross-cutting business rules to preserve", rules 1-15)
  - BUSINESS_DESCRIPTION.md Sections 1.2, 10.1, 10.2, 10.4, 10.6, 10.9, 10.10, 11
  - specs/002-server-platform/plan.md "Self-imposed gates applied in the constitution's absence"
  - User input in this session (Principle VI, payload shaping)

Follow-up TODOs:
  - RESOLVED 2026-09-17 (PROJECT_NAME_CONFLICT): The canonical brand is **German World Club
    (GWC)**, confirmed by explicit instruction during feature 003. The Experts Circle / German
    Emirates Club client, its palette, its copy and its domain have been removed from the
    repository; `/` now serves a GWC landing page, and the RFC 9457 problem-type namespace moved
    from german-emirates-club.com to german-world-club.com. This constitution already used
    "German World Club", so no principle changes — hence PATCH.
  - Ratification date recorded as the date of this adoption. If the project considers an
    earlier date authoritative, amend as a PATCH.

Compliance consequences for work already planned (informational, not part of this document):
  - Feature 002 recorded its Constitution Check as "PASS (vacuous)". That is now void; it must
    be re-checked against these six principles.
  - Principle VI is not currently satisfied by feature 002 (no media pipeline exists, and
    response serialization schemas are scheduled in its final phase).
-->

# German World Club Platform Constitution

## Core Principles

### I. One Rule Set, Three Clients

Every business rule MUST be computed on the server and MUST NOT be reimplemented in any client.

- Entitlement, pricing, capacity, quota, and moderation decisions MUST be resolved server-side.
- Request and response schemas, error types, and permission constants MUST live in one shared
  package that every client imports. A rule expressed in two places is a defect, not a
  convenience.
- A client MAY use server-supplied capability data to decide what to *display*. It MUST NOT use
  it to decide what is *allowed*; the server re-checks every operation.
- Authentication *mechanism* MAY differ per client (cookies for browsers, bearer tokens for
  mobile). Authorization *outcome* MUST NOT.

**Rationale**: The legacy system's most persistent defects came from the web and mobile layers
implementing the same rule twice and drifting apart. A shared contract package makes divergence
structurally harder than correctness.

### II. Declare Every Posture; Silence Fails The Build

Every route MUST declare an access posture and every public surface MUST declare a crawl posture.
An undeclared posture MUST fail startup or fail the build — never default to permissive or
restrictive.

- A route is made public by an affirmative declaration that appears in a diff, never by omission.
- Gated surfaces MUST be excluded from indexing by a crawl directive *in addition to* access
  control, because URL shapes leak through referrers and shared links.
- Authorization MUST be resolved from server-held state at request time, never read from claims
  embedded in a credential, so that a revoked permission takes effect on the next request.
- Rules that depend on the *target* of an operation MUST be enforced against the loaded target,
  inside the transaction — route-level declarations cannot express them.

**Rationale**: "Silence is not an acceptable default in either direction" is already the stated
rule for crawl posture. The same discipline applied to authorization converts the most common
authorization defect — a route added under time pressure that nobody guarded — from a review
checklist item into an un-mergeable failure.

### III. Published State Must Match Real State

The system MUST NOT advertise anything its own state does not support.

- A URL that does not exist MUST return a not-found status. A success response carrying fallback
  content is prohibited.
- Structured data, share previews, and sitemaps MUST be generated from live state, never from a
  cached, denormalised, or optimistic copy.
- Exactly one canonical origin MUST be served; all other host and scheme variants permanently
  redirect to it.
- Indexed URLs are an asset. They MUST be preserved or permanently redirected, never silently
  dropped.
- Public URLs MUST be human-readable and slug-based, never bare internal identifiers.

**Rationale**: Publishing an event as available after registration closed, or a partner as active
after their contract lapsed, is both a search penalty and a factual misstatement to members.
Partner visibility is a paid deliverable, so accuracy here is a contractual obligation, not a
quality preference.

### IV. Integrity Lives In The Database

Correctness-critical invariants MUST be enforced by database constraints and transactions, not by
application-level checks.

- Quotas, counters, capacity, and session uniqueness MUST be enforced by constraints, row locks,
  or transactions that make a violation impossible rather than unlikely.
- Member records MUST NOT be deleted. Ending a membership is a status transition that preserves
  history, and the prohibition MUST be enforced at the database level so it survives an ad-hoc
  query.
- Operations that may be retried MUST carry a deterministic reference so a retry cannot duplicate
  their effect.
- Audit records MUST be append-only, enforced by revoked grants rather than by convention.

**Rationale**: Invitation quotas, event capacity across multiple sources, card validity windows,
and redemption counters are all concurrency-sensitive. An application-level check is a race
condition with extra steps.

### V. Failure Is Explicit And Bounded

No library default may decide what happens when something fails.

- Every request MUST have a bounded time budget. For any request, the sum of the outbound budgets
  it may incur MUST be strictly less than its own budget, asserted at startup.
- Every outbound dependency MUST be isolated behind a failure detector with a declared
  unavailable-behaviour. A dependency's *business rejections* MUST NOT count toward tripping it.
- Where a protective mechanism can itself fail, its failure behaviour MUST be configured
  explicitly per route class — permissive where availability outweighs the control, restrictive on
  every credential path.
- Bulk communication MUST pace itself, capping batch size and send rate to protect deliverability.
- Protective limits MUST NOT be set so tightly that they refuse legitimate traffic the business
  depends on being served.

**Rationale**: A protection that fails closed on a busy evening of legitimately declined cards is
an outage caused by the safety mechanism. Explicit, per-dependency policy is the only way to tell
the two apart.

### VI. The Server Shapes What Leaves It

Nothing leaves the server in a shape or size the server did not choose.

- Uploaded media MUST be transformed at ingest into delivery-appropriate derivatives. Clients MUST
  NOT be served an unoptimized original as the default rendering path.
- Every image reference MUST carry explicit dimensions, and every derivative MUST record its own
  width, height, and byte size.
- Uploads MUST be validated by content inspection, never by filename or client-declared type, and
  MUST have bounded decoded size. Embedded location and device metadata MUST be stripped.
- Responses MUST be serialized through an explicit schema, so a column added later cannot leak.
- Credentials, tokens, one-time codes, and member contact details MUST NOT appear in logs, error
  bodies, or responses. Redaction MUST be configured centrally so it applies to code not yet
  written.
- Member-only content MUST NOT be rendered, even partially, to an unauthenticated requester for
  the purpose of search visibility.

**Rationale**: Images are the dominant weight on public pages and unsized images are the most
common cause of layout shift, so payload discipline is directly a performance and ranking concern
for visibility the club has sold. The same principle governs disclosure: an unshaped response is
how member personal data reaches a surface that was never meant to carry it. Upload handling is
also the sharpest attack surface the platform exposes, which is why validation and metadata
stripping are stated as absolutes.

## Technology & Security Baseline

- **Stack**: One API serves all clients. PostgreSQL is the single relational store. Real-time
  transport is additive — a message MUST be persisted before it is delivered, so a dropped
  connection never loses data.
- **Public rendering**: Public pages MUST deliver meaningful content in the initial response
  without requiring client-side JavaScript execution. Link-preview and non-search crawlers execute
  no JavaScript, and partner visibility is a sold deliverable.
- **Gated surfaces** MAY remain client-rendered; they are never indexed.
- **Passwords** MUST use a modern, salted, memory-hard hash. The legacy system's unsalted MD5
  values MUST NOT be accepted for authentication under any migration strategy; they are treated as
  already public.
- **Credentials** MUST be short-lived and server-revocable. At most one session per account is
  active; a new sign-in terminates the previous one. Replay of a single-use credential MUST be
  treated as compromise, not as a retry.
- **Settings that must agree with infrastructure** — trusted-proxy depth, canonical origin, and
  keep-alive versus proxy idle timeout — MUST have no silent default. Production startup MUST fail
  when they are unset.
- **Secrets** MUST NOT be committed. Configuration MUST be validated at startup, and an invalid
  value MUST prevent boot rather than degrade behaviour.

## Development Workflow & Quality Gates

- **Specification first**: features are specified, planned, and decomposed into tasks before
  implementation. Each feature records its Constitution Check against this document, and
  "vacuous pass" is no longer an available outcome.
- **Every principle is verifiable**: each of I-VI MUST have at least one automated check that
  fails the build when violated. A principle with no test is an aspiration, not a rule.
- **Required gate classes**: access-control matrix coverage across every route and principal kind;
  crawl-posture coverage across every declared surface; not-found correctness against a corpus of
  known-bad paths; induced dependency failure against declared budgets; a log scan proving no
  credential or contact detail is emitted; and payload checks proving no client is served an
  unoptimized original.
- **Measurability over intent**: search posture, metadata uniqueness, structured-data validity,
  status-code correctness, and Core Web Vitals MUST be checked automatically in the delivery
  pipeline, the same way functional behaviour and accessibility are.
- **Staff-editable where the business owns it**: presentation attributes that staff are
  accountable for — search metadata, slugs, share images — MUST be editable under the permission
  system rather than requiring engineering work.
- **Scheduled work is auditable**: every job MUST be individually enableable, and every run MUST
  record its start, end, and outcome.

## Governance

This constitution supersedes conflicting practices, plans, and task lists. Where a feature's
design conflicts with a principle here, the design changes — not the principle, and not by
reinterpretation or silent omission.

**Amendment procedure**: Amendments MUST be proposed as an explicit change to this document,
stating the principle affected, the rationale, and the migration path for work already planned or
shipped. An amendment that weakens a principle MUST state what replaces the protection it removes.
Amendments are adopted by updating this file and its version line; they are never made implicitly
by a feature that declines to comply.

**Versioning policy**: Semantic versioning applies to governance.

- **MAJOR** — a principle is removed or redefined in a backward-incompatible way, or a MUST is
  downgraded.
- **MINOR** — a principle or section is added, or existing guidance is materially expanded.
- **PATCH** — clarification, wording, or typo correction that does not change what is required.

**Compliance review**: Every plan MUST record a Constitution Check before design begins and
re-check it after design. Every review MUST confirm that each principle the change touches has a
passing automated check. Complexity that violates a principle MUST be justified in writing against
the specific principle, with the simpler rejected alternative named; an unjustified violation
blocks the change.

**Version**: 1.0.1 | **Ratified**: 2026-09-15 | **Last Amended**: 2026-09-17
