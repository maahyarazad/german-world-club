# Feature Specification: Server Platform Foundation

**Feature Branch**: `002-server-platform`

**Created**: 2026-09-15

**Status**: Draft

**Input**: User description: "read from business description and start the server implementation plan - add the Role-Based Access Control (RBAC) with JWT from business description and add that to the server, add the time out request, og tag handlers, circuit breaker, rate limit, and all the seo stuff into consideration"

**Source of requirements**: [`BUSINESS_DESCRIPTION.md`](../../BUSINESS_DESCRIPTION.md) — §1.2 (target stack), §3.2 (member status), §5 (redemption counters), §6.2 (mobile auth/OTP), §9 (bulk-send throttling), §10 (SEO, all subsections), §11 (staff permissions), §12 (cross-cutting rules 6, 7, 9, 10, 11, 12, 13, 14, 15).

## Context

`BUSINESS_DESCRIPTION.md` specifies one Fastify API serving three clients — member web, mobile app, and staff admin console — over a single PostgreSQL database, with the explicit rule that entitlement, pricing, capacity, quota, and moderation are computed server-side so no client can diverge (§12.15).

What exists today is a 33-line `server.js`: one `/api/hello` route, a static handler for `client/dist`, and a catch-all not-found handler. It has no authentication, no authorization, no timeouts, no rate limiting, no dependency isolation, and no server-side control over what crawlers see. It also contains, in delivered form, the exact defect the business description names as a specific thing to prevent (§10.6, §12.13): every unknown non-`/api` path is answered with `index.html` at HTTP 200 — an unbounded soft-404 surface.

This feature builds the **server platform foundation**: the cross-cutting layer every later domain module (events, partners, marketplace, Threads, messaging, membership cards) will be built on top of. It delivers access control, public-delivery correctness, resilience, and operability. It deliberately does **not** deliver domain features; it delivers the layer that makes them safe to add.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Only the right principal reaches a gated surface (Priority: P1)

A member signs in from the web portal, and a staff member signs in to the admin console. Each reaches exactly what their account entitles them to and nothing more. A member cannot reach an admin route by presenting their own valid token. A department admin cannot edit a superadmin's account. A staff member whose permission is revoked loses access on their next request, not when their token happens to expire. A member who is suspended cannot sign in at all.

**Why this priority**: Every gated surface in the business description — member portal, Threads, messaging, marketplace, checkout, admin console — is unreachable until this exists. It is also the layer where a mistake is a breach rather than a bug. Nothing else in the platform can ship first.

**Independent Test**: Issue tokens for each principal kind (member, department admin, superadmin) and attempt every route class with each; confirm the permitted set matches the declared matrix exactly, and that revoking a permission or a session takes effect on the next request.

**Acceptance Scenarios**:

1. **Given** a request with no credentials, **When** it targets any gated route, **Then** the response is 401 with the standard error envelope and no resource data.
2. **Given** a valid member token, **When** it targets any staff admin route, **Then** the response is 403 and the attempt is recorded in the audit log.
3. **Given** a staff account holding `read` but not `edit` on a module, **When** it attempts an edit operation on that module, **Then** the response is 403 and no state changes.
4. **Given** a superadmin, **When** they perform any operation on any module, **Then** the permission matrix is bypassed and the operation proceeds.
5. **Given** a department admin, **When** they attempt to edit or delete another admin or superadmin account or its permissions, **Then** the response is 403 regardless of their module flags.
6. **Given** a staff account whose `edit` flag on a module is revoked by a superadmin, **When** that account issues its next request to that module, **Then** the request is refused without requiring re-login or token expiry.
7. **Given** a member who signs in on a second device, **When** the earlier session's refresh token is next presented, **Then** it is rejected and the earlier session is terminated.
8. **Given** a member whose status is Locked, Inactive, or Ex-member, **When** they attempt to sign in with correct credentials, **Then** sign-in is refused with the status-appropriate remedy and no token is issued.
9. **Given** a mobile user approved on device A, **When** they sign in from device B, **Then** prior approval does not apply and they are routed to re-approval.
10. **Given** any route registered in the application, **When** the server starts, **Then** startup fails if that route has not declared an access posture.

---

### User Story 2 - Public content is found, previewed truthfully, and never soft-404s (Priority: P2)

A partner has paid for a listing whose value is search visibility. A journalist shares an event page in a group chat. A prospective member finds a magazine article. In each case the crawler or preview bot receives real content in the first response, unique and accurate metadata, structured data that matches the system's actual state, and — for any URL that does not exist — an honest not-found status.

**Why this priority**: Partner visibility is a sold deliverable (§10, §5), so this is revenue-bearing, not cosmetic. It also closes the live soft-404 defect. It ranks below access control only because it exposes no private data if delayed.

**Independent Test**: Fetch each public route class with JavaScript disabled and with a preview-bot user agent; assert real content, unique metadata, valid structured data, correct status codes, and that every gated path is both refused and marked non-indexable.

**Acceptance Scenarios**:

1. **Given** a public page, **When** it is fetched without executing JavaScript, **Then** the response body contains the page's meaningful content.
2. **Given** a URL that matches no content record or route, **When** it is fetched, **Then** the response status is 404 and the body is not a fallback application shell.
3. **Given** two different public content records, **When** their pages are fetched, **Then** their title, meta description, canonical URL, and share-preview tags are each unique and derived from the record's own content.
4. **Given** a public page, **When** its share tags are read, **Then** they include title, description, and an image with explicit dimensions and alt text.
5. **Given** a request to a non-canonical host or scheme variant, **When** it is received, **Then** it is permanently redirected to the single canonical origin.
6. **Given** any gated surface listed as never-indexed in §10.1, **When** it is requested, **Then** the response both refuses access and carries a non-indexable crawl directive, and the path is disallowed in the robots directive file.
7. **Given** an event whose registration has closed, **When** its public page's structured data is read, **Then** availability reflects the closed state rather than advertising it as open.
8. **Given** a partner whose listing contract has lapsed past its grace period, **When** the sitemap is generated, **Then** that partner's page is absent from it.
9. **Given** a content record that is edited, **When** the sitemap is generated, **Then** that entry's last-modified timestamp reflects the record's real modification date.
10. **Given** a legacy indexed URL from the previous system, **When** it is requested, **Then** it either serves the same content or permanently redirects to its new equivalent.
11. **Given** a public page that exists in both German and English, **When** either version is fetched, **Then** it declares its own language and cross-references its alternate.

---

### User Story 3 - Media is stored once and served at the right size (Priority: P3)

A member uploads a photograph from their phone for a marketplace listing. A staff member uploads a
partner logo and an event gallery. In every case the server keeps the original, derives the sizes
and formats it will actually deliver, and records the dimensions of each one — so a visitor on a
phone receives a few tens of kilobytes rather than the multi-megabyte original, and no page shifts
while an unsized image loads.

**Why this priority**: it ranks above resilience because the public pages delivered by User Story 2
carry images — partner logos, article headers, event galleries — and those pages are the visibility
the club sells. Serving originals there costs both ranking and the Core Web Vitals target in
SC-017. It is also the prerequisite for every later feature that accepts an upload (marketplace
photos, Threads media, event recaps), and Principle VI of the constitution prohibits serving an
unoptimized original as the default rendering path.

**Independent Test**: upload a representative photograph and a short video, then confirm that
derivatives exist at each configured breakpoint with recorded dimensions and byte sizes, that the
delivered bytes for a phone-width layout are a small fraction of the original, and that a file
whose extension disagrees with its content is refused.

**Acceptance Scenarios**:

1. **Given** an uploaded photograph, **When** the upload request completes, **Then** its intrinsic
   width and height are recorded and derivatives exist at every configured image breakpoint.
2. **Given** an uploaded photograph, **When** a public page references it, **Then** the page
   references the smallest derivative that satisfies its rendered size, never the stored original.
3. **Given** a source narrower than a configured breakpoint, **When** derivatives are generated,
   **Then** no derivative is upscaled beyond the source's own dimensions.
4. **Given** a source with transparency, **When** derivatives are generated, **Then** the fallback
   format preserves that transparency.
5. **Given** an uploaded video, **When** the upload request completes, **Then** the asset reports a
   processing state and a web-deliverable derivative plus a still poster image appear once
   processing finishes.
6. **Given** a file whose extension claims one type and whose bytes are another, **When** it is
   uploaded, **Then** it is refused on the basis of its actual content.
7. **Given** a small file that decodes to an extreme pixel count, **When** it is uploaded, **Then**
   it is refused before decoding exhausts memory.
8. **Given** an image carrying location metadata, **When** it is stored, **Then** neither the stored
   file nor any derivative retains it.
9. **Given** derivative generation is unavailable, **When** an upload is attempted, **Then** the
   failure is explicit and no asset is recorded as ready.
10. **Given** a derivative URL, **When** it is fetched twice, **Then** it is byte-identical and
    served with a disposition that prevents inline execution.

---

### User Story 4 - The API degrades predictably instead of hanging or falling over (Priority: P4)

A payment provider stops responding. An SMS gateway starts timing out. A credential-stuffing script hits the login endpoint. In each case the API answers quickly with a clear failure, stops hammering the failed dependency, keeps serving the requests that do not depend on it, and does not let one slow dependency exhaust the whole server.

**Why this priority**: The platform is usable without this, but not operable. It is ranked third because its value is realised under failure rather than in normal use — with one exception noted below.

> **Dependency note**: the abuse limits protecting sign-in, OTP dispatch, and password reset are a slice of this story that must ship **with User Story 1**. An unthrottled credential endpoint is a security defect, not a resilience nicety.

**Independent Test**: Drive each failure mode against a stub dependency — hang, slow response, error storm, request flood — and assert the response time, status code, and recovery behaviour against the declared budgets.

**Acceptance Scenarios**:

1. **Given** a request whose handler exceeds its declared time budget, **When** the budget elapses, **Then** the request is terminated with a timeout status rather than held open indefinitely.
2. **Given** an outbound dependency that does not respond, **When** it is called, **Then** the call is abandoned at its own budget, which is shorter than the inbound budget of the request that triggered it.
3. **Given** an outbound dependency failing repeatedly, **When** the failure threshold is crossed, **Then** subsequent calls fail immediately without contacting it, and its declared fallback applies.
4. **Given** a dependency circuit that is open, **When** the recovery interval elapses, **Then** a single trial call determines whether to close the circuit, and a success restores normal traffic.
5. **Given** a dependency returning a business rejection — for example a declined card — **When** that response is received, **Then** it is reported as a business outcome and does **not** count toward tripping the circuit.
6. **Given** the payments dependency is unavailable, **When** a member attempts a paid action, **Then** the outcome is an explicit failure and the system never records the payment as successful.
7. **Given** repeated sign-in attempts against one account from many addresses, or from one address against many accounts, **When** either limit is exceeded, **Then** further attempts are refused with a retry-after indication.
8. **Given** a client that disconnects mid-request, **When** the disconnect is detected, **Then** work still in flight for that request is cancelled.
9. **Given** a crawler fetching public pages at a normal crawl rate, **When** its requests are counted, **Then** it is not rate-limited, because throttling public pages would undermine User Story 2.
10. **Given** the API is running behind a proxy, **When** per-client limits are computed, **Then** they key on the real client address rather than the proxy's, so one shared address is not treated as one client.
11. **Given** the process receives a termination signal, **When** it shuts down, **Then** in-flight requests are allowed to finish within a bounded drain period and idle connections are closed.

---

### User Story 5 - An operator can tell what happened (Priority: P5)

An on-call engineer investigating a failed payment or a permission complaint can trace a single request end to end, see which dependency failed, and confirm whether a scheduled job ran — without finding member personal data or credentials in the logs.

**Why this priority**: Required before the platform carries real money or real member data in production, but it blocks nothing functionally and can follow the first three stories.

**Independent Test**: Issue a request that fails at each layer, then confirm a correlated log trail exists for each, with sensitive fields redacted and a stable request identifier returned to the caller.

**Acceptance Scenarios**:

1. **Given** any request, **When** it is logged, **Then** every log line for it shares one correlation identifier that is also returned to the caller.
2. **Given** a log line for an authenticated request, **When** it is inspected, **Then** it contains no credential, token, OTP, or member contact detail.
3. **Given** a scheduled job run, **When** it completes or fails, **Then** its start, end, and outcome are recorded for audit.
4. **Given** a permission-denied event, **When** it occurs, **Then** the principal, target, and required permission are recorded.
5. **Given** the health endpoint, **When** it is polled, **Then** it reports liveness separately from readiness, and readiness reflects whether required dependencies are usable.

---

### Edge Cases

- **Permission revoked mid-session**: authorization data must not be trusted from a token whose claims predate the change (§11's matrix is staff-editable at any time).
- **Membership entitlement expires mid-session**: a card that lapses between sign-in and checkout must not still grant its discount — entitlement is computed at use time, never carried in a credential (§12.2).
- **Two devices, one account, simultaneous**: single-active-session (§12.7) must resolve deterministically; the later sign-in wins and the earlier is terminated.
- **Refresh token replayed**: a refresh token presented twice must be treated as compromise, not as a retry, and must terminate the session family.
- **Clock skew between clients and server**: short token lifetimes must tolerate reasonable skew without locking legitimate users out.
- **Gated URL shape leaked via referrer or a shared link**: access control alone is insufficient; crawl directives must also refuse it (§10.1).
- **Unknown path that looks like an asset** (`/logo.png`, `/.env`, `/wp-login.php`): must 404 without touching the application shell and without logging noise that drowns real signal.
- **Trailing slash, mixed case, and query-parameter variants of a public URL**: must resolve to one canonical form rather than multiplying indexable duplicates.
- **A content record unpublished while a crawler holds its URL**: must return the deliberately chosen status, not an accidental 200.
- **Dependency recovers while its circuit is open**: recovery must be detected automatically, not require a deploy or restart.
- **Rate-limit store unavailable**: the limiter's own failure must be decided deliberately — fail-open for public reads, fail-closed for credential endpoints — never left to a library default.
- **Bulk send collides with rate limiting**: §9's self-throttled newsletter batches are a business rule with their own pacing and must not be silently governed by a transport rate limiter.
- **Legacy password hashes**: the previous system used unsalted MD5 (§1.2); those values must never be accepted as-is if legacy data is imported.
- **Animated source image**: an animated GIF or WebP must either preserve animation in the derivative or be documented as flattened to its first frame — not silently produce a still.
- **Source already smaller than the smallest breakpoint**: must yield a single derivative at the source's own size rather than an upscaled set.
- **Upload aborted mid-transfer**: must leave no partial asset recorded as ready and no orphaned bytes in storage.
- **Video upload whose processing fails**: the asset must report a failed state with a reason, not remain in processing indefinitely.
- **Two uploads of byte-identical content**: content-addressed storage must not duplicate the stored bytes, and must not let one uploader's deletion break another's reference.
- **SVG upload**: an SVG can carry script, so it must be rejected or sanitised rather than stored and served as-is.

## Requirements *(mandatory)*

### Functional Requirements

#### Access control and identity

- **FR-001**: Every route MUST declare an explicit access posture — public, member-authenticated, or staff-permission-gated — and the server MUST refuse to start if any registered route leaves it undeclared.
- **FR-002**: The system MUST authenticate members and staff by issuing a short-lived access token and a longer-lived refresh token, where the refresh token is revocable server-side.
- **FR-003**: Member credentials and staff credentials MUST be distinguishable such that a member credential can never satisfy a staff-gated route, and vice versa.
- **FR-004**: The system MUST enforce a single active session per account; a successful sign-in MUST invalidate the previously active session for that account.
- **FR-005**: Presenting a refresh token that has already been used MUST terminate the entire session lineage it belongs to and MUST be recorded as a security event.
- **FR-006**: Authorization decisions MUST be computed from server-held permission state at request time, not read from claims embedded in the credential, so that permission changes take effect on the next request.
- **FR-007**: The system MUST enforce the five-flag permission matrix — read, write, edit, delete, status — independently per administrative module.
- **FR-008**: A superadmin principal MUST bypass all module permission checks.
- **FR-009**: The system MUST prevent any principal that is not a superadmin from editing, deleting, or changing the permissions of an admin or superadmin account, irrespective of that principal's module flags.
- **FR-010**: Sign-in MUST be refused for accounts in Locked, Inactive, or Ex-member status, with a status-specific remedy, and no credential may be issued.
- **FR-011**: The system MUST require a confirmed email address before granting full member access, routing unconfirmed accounts to profile completion.
- **FR-012**: Mobile sign-in MUST require a one-time code delivered out of band in addition to the password, and MUST bind approval to the specific device used, invalidating prior approval when the device changes.
- **FR-013**: Member entitlements derived from a paid membership card MUST be resolved at the point of use and MUST NOT be carried in an authentication credential.
- **FR-014**: Passwords MUST be stored using a modern, salted, memory-hard password hash; unsalted MD5 values from the legacy system MUST NOT be accepted for authentication.
- **FR-015**: Every authorization denial MUST be recorded with the principal, the target, and the permission that was required.

#### Public delivery, metadata, and crawl posture

- **FR-016**: Public pages MUST deliver their meaningful content in the initial response without requiring client-side JavaScript execution.
- **FR-017**: A URL that corresponds to no route and no content record MUST return a not-found status and MUST NOT return an application shell with a success status.
- **FR-018**: Every public page MUST carry a unique, content-derived title, meta description, canonical URL, and social preview tags including an image with explicit dimensions and alt text.
- **FR-019**: Page metadata MUST be produced from the same source of truth as the page's content, so the two cannot drift.
- **FR-020**: Where staff-editable SEO fields exist on a content record — slug, SEO title, meta description, share image — they MUST override the values otherwise derived from that record's content.
- **FR-021**: Staff editing of SEO fields MUST be governed by the same five-flag permission matrix that governs the underlying record.
- **FR-022**: The system MUST emit structured data appropriate to each public content type, and that data MUST reflect live system state rather than a cached or optimistic copy.
- **FR-023**: The system MUST serve a sitemap generated from live content state, with real last-modified timestamps, adding entries when content is published and removing them when content is unpublished, expired, or — for partner listings — lapsed past its contract grace period.
- **FR-024**: The system MUST serve a robots directive file that disallows every gated surface and points at the sitemap.
- **FR-025**: Gated surfaces MUST be excluded from indexing by a crawl directive in addition to access control, not by access control alone.
- **FR-026**: Member-only content MUST NOT be rendered, even partially, to an unauthenticated requester for the purpose of search visibility.
- **FR-027**: Public URLs MUST be human-readable and slug-based rather than exposing internal numeric identifiers.
- **FR-028**: The system MUST serve exactly one canonical origin and MUST permanently redirect all other host and scheme variants to it.
- **FR-029**: Legacy indexed URLs MUST either continue to serve their content or permanently redirect to their new equivalent.
- **FR-030**: Public pages available in more than one language MUST declare their own language and cross-reference their alternates.
- **FR-031**: The handling of an expired partner listing — gone, redirected, or retained but non-indexed — MUST be an explicit configured decision rather than an emergent default.

#### Resilience and abuse control

- **FR-032**: Every request MUST be subject to a bounded time budget, after which it is terminated with a timeout status rather than held open.
- **FR-033**: Every outbound dependency call MUST carry its own time budget, and the sum of budgets a request may incur MUST be smaller than that request's own budget.
- **FR-034**: Work in flight for a request MUST be cancelled when the requesting client disconnects.
- **FR-035**: Each outbound dependency MUST be isolated behind a failure detector that stops calling it after a configured failure threshold and probes for recovery automatically.
- **FR-036**: A dependency's business rejections MUST be distinguished from its availability failures, and business rejections MUST NOT contribute to tripping its failure detector.
- **FR-037**: Each isolated dependency MUST have a declared behaviour for when it is unavailable, and for payment operations that behaviour MUST never record success.
- **FR-038**: Retries through a failure detector MUST only be applied to operations that are safe to repeat, and repeatable operations MUST carry a deterministic reference so a retry cannot duplicate their effect.
- **FR-039**: The system MUST apply request limits across multiple independent dimensions, including per-client-address and per-account limits on credential endpoints.
- **FR-040**: Per-client limits MUST be computed from the real client address when the API is deployed behind a trusted proxy.
- **FR-041**: Public content routes MUST NOT be limited so tightly that a normal crawl rate is refused.
- **FR-042**: A refused request MUST indicate when the caller may retry.
- **FR-043**: This feature MUST provide a transactional counter primitive — a helper that reserves against a bounded counter under a row lock inside the caller's transaction — and MUST NOT implement any business quota as a transport rate limit. Business quotas themselves (invitation quotas and cooldowns, coupon redemption counters, bulk-send pacing, event capacity) are delivered by their own features and MUST be built on this primitive rather than on the rate limiter.
- **FR-044**: When the rate-limit store is unavailable, the resulting behaviour MUST be explicitly configured per route class rather than inherited from a default.
- **FR-045**: The system MUST shed or queue load when its own resources are exhausted, rather than accepting work it cannot complete.
- **FR-046**: On receiving a termination signal the system MUST stop accepting new work, allow in-flight requests a bounded period to finish, and then exit.

#### Media handling

- **FR-052**: Uploads MUST be validated by inspecting the file's actual bytes, never by filename extension or client-declared content type.
- **FR-053**: Uploads MUST be refused when the decoded pixel count or dimensions exceed configured bounds, before decoding consumes the memory implied by them.
- **FR-054**: Location and device metadata MUST be stripped from the stored file and from every derivative.
- **FR-055**: An accepted image's intrinsic width and height MUST be recorded before its upload request completes, so every reference to it can carry explicit dimensions.
- **FR-056**: The system MUST generate derivatives at configured size breakpoints, preserving aspect ratio and never upscaling beyond the source's own dimensions.
- **FR-057**: Image derivatives MUST be produced in a modern compressed format as the primary delivery format, with a fallback format that preserves transparency when the source has it.
- **FR-058**: Video uploads MUST produce a web-deliverable derivative and a still poster image.
- **FR-059**: Derivatives that can be produced inside the upload request's time budget MUST be; those that cannot MUST be produced asynchronously, with the asset reporting a processing state until they are ready and a failed state with a reason if they cannot be.
- **FR-060**: The stored original MUST NOT be the default rendering path for any client; each surface MUST reference the smallest derivative that satisfies its rendered size.
- **FR-061**: Each derivative MUST record its own format, width, height, and byte size.
- **FR-062**: Derivative URLs MUST be immutable and content-addressed so they can be cached indefinitely, and MUST be served with a disposition that prevents inline execution in the application's origin.
- **FR-063**: Uploads MUST be bounded per account by both a stored-byte quota and a request rate limit, and derivative generation MUST be isolated behind a failure detector with a declared unavailable behaviour.

#### Operability

- **FR-047**: Every request MUST carry one correlation identifier across all of its log records, and that identifier MUST be returned to the caller.
- **FR-048**: Logs MUST NOT contain credentials, tokens, one-time codes, or member contact details.
- **FR-049**: All error responses MUST share one machine-readable envelope, so that all three clients handle failures identically.
- **FR-050**: The system MUST expose liveness and readiness separately, with readiness reflecting whether required dependencies are usable.
- **FR-051**: Every scheduled job run MUST record its start, end, and outcome, and each job MUST be individually enableable and disableable.

### Key Entities

- **Principal**: the authenticated actor behind a request — either a Member or an Admin User — carrying an identity, an account status, and an audience that determines which route classes it may reach.
- **Session**: one active sign-in for an account. Holds the device binding, the issuing context, and its own lifecycle; at most one is active per account.
- **Refresh Token**: a single-use, revocable token belonging to a Session lineage; replay terminates the lineage.
- **Password Reset Token**: a single-use, expiring token authorising one password change; consuming it revokes every session for the account.
- **Permission Grant**: the five flags — read, write, edit, delete, status — held by an Admin User for one administrative module.
- **Route Posture**: the declaration attached to every route: public, member-authenticated, or the module and flag required. Absence is a startup error.
- **Page Metadata**: the resolved presentation of a public content record in search and share contexts — slug, title, description, canonical URL, share image with dimensions and alt text, indexable flag, language and alternates, last-modified. Derived from the record, overridable by staff.
- **Structured Data Document**: the machine-readable description emitted for a public content record, generated from live state.
- **Sitemap Entry**: one published, indexable URL with its real last-modified timestamp; present only while its record is published and in contract.
- **Dependency Circuit**: the health state of one outbound dependency — closed, open, or probing — with its failure threshold, time budget, and unavailable-behaviour policy.
- **Rate Limit Bucket**: one named limit with its dimension (address, account, device, or token), allowance, window, and store-unavailable behaviour.
- **Audit Record**: a security-relevant event — sign-in, denial, permission change, session termination, credential replay — with principal, target, and outcome.
- **Job Run**: one execution of a scheduled job, with start, end, and outcome.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of registered routes have a declared access posture, verified by a test that fails the build if any route does not.
- **SC-002**: An access-control matrix test covers every route class against every principal kind, with zero permitted combinations outside the declared matrix.
- **SC-003**: A permission revoked by a superadmin is refused on the target account's very next request, with no re-login and no wait for credential expiry.
- **SC-004**: Zero unknown URLs return a success status; a crawl of at least 50 known-bad paths returns 404 for every one.
- **SC-005**: Every public route class returns its meaningful content with JavaScript disabled.
- **SC-006**: Title, meta description, and canonical URL are unique across all public pages, with zero duplicates detected by an automated crawl of the generated sitemap.
- **SC-007**: 100% of emitted structured-data documents validate against their schema type, and event availability plus partner active status match live database state in every sampled case.
- **SC-008**: Every gated path in the §10.1 table is both access-refused and marked non-indexable, and appears as disallowed in the robots directive file.
- **SC-009**: No request exceeds its declared time budget by more than 10%, measured under an induced dependency hang.
- **SC-010**: With a dependency hung, the p99 latency of requests that do not touch that dependency stays within 20% of its baseline.
- **SC-011**: After a dependency's failure threshold is crossed, zero further calls reach it until a recovery probe, and recovery is detected automatically within one configured recovery interval.
- **SC-012**: A declined-payment response leaves the payment circuit closed, verified by an explicit test.
- **SC-013**: A credential-stuffing pattern — many addresses against one account, and one address against many accounts — is refused in both directions.
- **SC-014**: A crawl at a normal rate over all public routes incurs zero rate-limit refusals.
- **SC-015**: Under a termination signal, zero in-flight requests are dropped within the configured drain period.
- **SC-016**: Every log record for a request shares one correlation identifier, and an automated scan of log output for credentials, tokens, one-time codes, and contact details finds zero occurrences.
- **SC-017**: Public pages meet Core Web Vitals thresholds in a production build, measured the same way accessibility and functional behaviour are.
- **SC-018**: No public page requests an image whose intrinsic width exceeds twice its maximum rendered width, measured across every public route class.
- **SC-019**: A 2 MB source photograph yields a medium derivative of 60 KB or less and a thumbnail of 8 KB or less at the configured breakpoints.
- **SC-020**: 100% of stored media and derivatives carry a recorded width, height, and byte size, and zero retain location metadata.
- **SC-021**: Zero uploads are accepted on a declared content type alone; a file whose extension and magic bytes disagree is refused in every sampled case.

## Assumptions

- **Mobile number is part of the identity subset.** §6.1 makes it a registration field and FR-012's out-of-band code cannot be delivered without it, so `members` carries a mobile number and its verification timestamp even though the rest of the contact and profile model arrives with the member-profile feature.
- **Membership entitlement resolves to none in this feature.** No membership-card table is in scope, so the entitlement field of the current-principal response is a documented null until the card feature lands. FR-013's rule — resolved at point of use, never carried in a credential — is established here so the card feature inherits it.
- **Media is stored behind a storage interface with two drivers**: an S3-compatible object store for deployed environments and a local-disk driver for development. Object storage is chosen so derivatives are not tied to an app instance and can be fronted by a CDN, which SC-017's Core Web Vitals target rewards.
- **Scope boundary**: this feature delivers the platform layer only. Domain modules — events, partners, membership cards, marketplace, Threads, messaging, newsletters, mobile onboarding — are separate features that consume this layer. The identity and authorization schema delivered here is the minimum needed to gate them, not the full member profile model of §2.
- **PostgreSQL and Fastify are settled** by §1.2 and are not re-litigated here. Node's current LTS line is the runtime.
- **Existing client is retained**: `client/` (feature 001) continues to be the public coming-soon surface. Its pre-rendered boot shell already satisfies FR-016 for that one page; other public page types are served by this feature's rendering path.
- **The canonical origin, the launch date, the real social channel URLs, and the club's contact address are the club's to supply**; placeholders are used and flagged until then.
- **External providers are treated as abstract dependencies** in this feature — payments, SMS, mail, geocoding — each behind an interface with a stub implementation, so resilience behaviour is testable before any provider contract is signed. Provider selection is a later decision.
- **The legacy URL inventory is not yet available.** The redirect mechanism is built and tested in this feature; the actual legacy-to-new URL map is populated when the club supplies the inventory, and FR-029 cannot be verified complete until then.
- **Legacy password hashes are assumed compromised.** If legacy member data is imported, affected accounts are required to reset rather than having MD5 values verified once and upgraded.
- **Redis is assumed available** for distributed rate-limit and session-revocation state in deployed environments; a single-process fallback is used in development, with the operational difference documented rather than hidden.
- **Real-time WebSocket messaging (§7) is out of scope here.** This feature establishes the authentication that a socket upgrade will reuse; the messaging protocol itself is a later feature.
- **No load-balancer or infrastructure configuration is delivered.** Where a server setting must agree with a proxy setting — idle timeouts, trusted proxy headers, canonical host termination — the required agreement is documented as a deployment precondition.
