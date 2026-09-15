# German World Club — Business Description

This document describes the **business logic and behavior** of the existing application, independent of implementation technology, so the same system can be rebuilt on a different stack while preserving how it actually works for members, staff, and partners.

---

## 1. What the product is

**German World Club (GWC)** is an invite-only social/networking club for German-speaking expatriates in the UAE, plus:
- A **companion mobile app**, tied into the same member data as the website.
- A **partner/sponsor discount network** monetized through paid partner listings and member benefit redemption.
- A **staff back-office** for running memberships, events, billing, content moderation, and communications.

### 1.1 Three faces of one domain model

All three surfaces below are clients of a **single backend and a single database**. They differ in audience and presentation, never in business rules — a rule enforced in one face must be enforced identically in the others, since the legacy system's most persistent defects came from web and mobile implementing the same rule twice and drifting apart.

1. **Member web app + public site** — German-first. Serves both the gated member portal (profile, contacts, Threads, messaging, marketplace, event registration) and the public, indexable surface (landing pages, magazine, partner listings, public event pages).
2. **Mobile app** — the companion app for members, covering profile, offers/redemption, event RSVP, push notifications, Threads, and real-time messaging.
3. **Staff admin console** — role/permission gated back-office (see §11), used to run memberships, events, billing, partners, moderation, and communications.

### 1.2 Target technology stack

| Layer | Technology | Role |
|---|---|---|
| Backend API | **Fastify** (Node.js) | One API serving all three faces — web, mobile, and admin |
| Database | **PostgreSQL** | Single relational store for the whole domain model (§2) |
| Real-time transport | **WebSocket** (served by Fastify) | Member-to-member messaging, delivery/read state, live notifications (§7) |
| Web frontend | **React + Vite** | Member portal, public site, and staff admin console |
| Mobile app | **React Native** | Native iOS and Android from one codebase |

**Constraints this stack has to satisfy:**

- **The public surface cannot be client-rendered only.** §10.2 requires public pages to deliver real content in the initial HTML response. A plain client-side React/Vite bundle does not meet this, so public pages (landing, magazine, partner listings, public event pages) require server-side rendering or build-time pre-rendering. The gated portal and admin console are never indexed (§10.1) and may remain client-rendered.
- **One rule set, three clients.** Authentication *mechanism* legitimately differs per face (cookie/session for web, token + OTP for mobile — §6.2), but entitlement, pricing, capacity, quota, and moderation rules are computed server-side in the Fastify API so no client can diverge from them.
- **Relational integrity is load-bearing.** Invitation quotas, event capacity across sources, membership-card validity windows, and redemption counters are all correctness-critical under concurrency and belong in PostgreSQL constraints and transactions rather than in application-level checks.
- **Real-time is additive, not authoritative.** WebSocket delivery is how messages arrive promptly; the message itself is persisted first, so a dropped socket never loses a message (§7).

> **Legacy note:** the behavior documented in the rest of this file was derived from the previous implementation — a PHP website and staff console alongside a Node.js mobile API. That system is the **source of truth for behavior only**, not for architecture; the stack above replaces it. Legacy implementation practices are explicitly *not* carried forward — notably the unsalted MD5 password hashing of the old PHP layer, which was never an intended business rule and must be replaced with a modern password hashing algorithm.

---

## 2. Core entities (business objects)

| Entity | Represents | Key attributes |
|---|---|---|
| Member | A club member (person) | name, salutation, contact info, birthday, nationality, employment/company/industry, interests, privacy settings |
| Invitation | The only path to becoming a member | inviter, invitee email/name, registration code, accepted/blocked/pending state |
| Event | A club social event | title, description, location (geocoded), capacity, price tiers by registration timing, registration window |
| Event Registration | A member's (and guests') sign-up for an event | guest count, kids/babies count, payment method, paid flag, invoice token |
| Partner | A sponsoring business offering member discounts | category, discount %, contract start/duration, branches ("outlets"), staff contact |
| Offer / Redemption (mobile app) | A partner discount coupon a mobile-app user can redeem | issued code, redemption counter, redemption transaction log |
| Marketplace Listing | Member classified ad | type (vehicle / real estate / job / general), offer vs. request mode, photos |
| Thread Post | Member public post in a Threads-style feed | author, text/media, reply-to (nesting), like count, repost, moderation flags |
| Real-Time Message | A message exchanged member-to-member over a live WebSocket connection | conversation id, sender, body, delivery/read state, timestamp |
| Magazine Article / News | Editorial/partner content | category, publish window |
| SEO Metadata | Search/share presentation attached to any public content record (partner, article, event, page) | url slug, SEO title, meta description, share image, indexable flag, last-modified |
| Committee | A club sub-organization | members |
| Support Ticket / Spam Report | Trust & safety records | reporter, reported content, staff resolution |
| Newsletter / Mass Message | Bulk communication to members | schedule, recipients, open/sent counters |
| Admin User | Staff account | role flags (admin/superadmin), per-module read/write/edit/delete/status permissions |

---

## 3. Membership lifecycle

### 3.1 Joining — invite-only
- There is **no open self-registration**. A prospective member can only join via a personal invitation from an existing member.
- An invitation requires: the invitee's email must not already belong to a member, the invitee must not have opted out of invites, and the same inviter cannot invite the same email twice.
- Each member has an **invitation quota**: none, a limited number per rolling period (configurable), or unlimited. Quota and cooldown windows exist to prevent spam.
- Accepting an invitation (via a unique registration code link) creates the member's full profile (personal, business, contact, location, interests) and automatically creates a mutual "contact" relationship between inviter and invitee, plus a welcome message and a notification to the inviter.

### 3.2 Member status (account state machine)
| Status | Meaning | Login allowed? |
|---|---|---|
| Active | Normal member | Yes |
| Locked/Suspended | Blocked by staff | No — must contact support |
| Inactive | Auto-deactivated (no activity beyond a configurable threshold) | No — must reset password to reactivate |
| Ex-member ("membership ended") | Soft-deleted, kept for history | No |

- A cron job automatically flags members inactive after a configurable period of no login activity (excludes members explicitly marked "hidden"/exempt).
- Full deletion of a member is **deliberately not allowed** — "ending membership" is always a soft state change, not data removal.
- Email must be confirmed before full access is granted; unconfirmed accounts are routed to a "complete your profile" flow.
- Members can request changes to their name/salutation with a justification; staff approve or reject the request.

### 3.3 Paid membership card (3 tiers)
- **Package 1** — basic card, partner discounts, reduced event fees.
- **Package 2** — adds a **30% discount** on event registration fees.
- **Package 3** — **all events free** (100% discount).
- A card is valid while `purchase_date + duration >= now`. Renewal is expected once ~11 months have elapsed since the last purchase; an upgrade to a higher package is allowed within 6 months of purchase.
- Purchase requires billing details (name, address, company, mobile) and a payment method:
  - **Online** — redirected to a hosted payment page (WorldPay), returns via a callback carrying a unique transaction token that reconciles the pending order.
  - **Bill/cash** — creates a pending order immediately; payment is collected and confirmed manually by staff afterward.
- Any pending order for the same member is purged before a new attempt is started.
- Paid, confirmed orders trigger a PDF invoice (branded, itemized, VAT-aware) emailed to the member.
- Admin has explicit workflow stages: Open (unpaid) → Paid & ready to ship → Shipped/Completed → Active card holders → About to expire (surfaced ~30 days before contract end).

---

## 4. Events

- Each event has a **capacity** and a **registration window** split into three pricing phases: early-bird, standard, and late — the price applied depends on *when* the member registers, computed live against the event's configured dates (not stored as a fixed price at signup time).
- A member may register **only once** per event. Registration also captures named additional guests and a count of children in two age bands (0–5 free, 6–12 charged a reduced kids rate; a maximum combined number of kids is enforced).
- **Membership-tier discounts apply automatically**: Package 2 → 30% off; Package 3 → free. VAT is applied on top if configured.
- Capacity is enforced across all registration sources (web and legacy mobile-app guest tables combined) — once full, no further registrations are accepted.
- Payment options mirror the membership card flow: online (hosted payment redirect) or pay-at-the-door/invoice (pending until confirmed).
- A member can optionally bundle a membership card purchase into the same event checkout.
- **Unpaid registration follow-up**: staff can send a manual payment reminder; the admin UI highlights members who were warned but haven't paid.
- **Event state machine** (admin-controlled): Not opened → Open (sub-phases: early/standard/late, computed automatically) → Closed (manual) → Review (post-event recap published, only allowed after the event date has passed).
- After an event, staff publish a **recap** (text + photo gallery) and can generate printable attendance/guest lists with headcounts, payment status, and amounts for on-site check-in.
- A parallel, simplified mobile-app event flow exists ("attend" / "cancel" / "attend with guests") for RSVP-only use cases without the full billing engine.
- **Public visibility**: an event has a public, indexable description page (title, date, venue, and what it is) that is separate from the member-only registration and checkout flow — see §10.1. Its published availability must track the event's real registration state so that what search engines and share previews advertise matches what a visitor actually finds.

---

## 5. Partner / sponsor network and offer redemption

- Partners are businesses offering member discounts, each with a **paid listing contract** (start date + duration in years, with a grace period) that determines whether the listing is currently "active" and shown to members.
- Partners can have multiple branch locations ("outlets") linked to one parent listing, and a designated staff/member contact person.
- Partner names in free-text content (threads, marketplace, magazine) are automatically hyperlinked back to the partner's page.
- **Mobile-app offer redemption** (a more structured, POS-facing flow than the website's static discount display):
  1. A user requests a coupon code for a specific partner offer; the system issues (or reuses) a code composed of a category prefix and a sequence number.
  2. At redemption time (merchant-facing), the code is validated against a **merchant terminal PIN**, daily redemption counters (global and per-category) are checked, a redemption transaction is logged with a generated reference number, the user's offer is marked consumed, and the offer's remaining availability count is decremented.
- This effectively implements a lightweight coupon/voucher ledger with anti-abuse counters, separate from the membership-card discount mechanism used for events.
- **Search visibility is part of what the partner buys.** Partner and outlet pages are public and indexable, carry staff-editable SEO metadata and local-business structured data (address, geo, hours, discount), and their indexing status follows the listing contract — a lapsed contract must stop being advertised for indexing. See §10.4–§10.5 and §10.8.

---

## 6. Mobile app

The mobile app is a single-tenant application for German World Club members, tied into the same member data as the website.

### 6.1 Onboarding & verification workflow
- A new mobile-app user registers by providing their **full name**, **mobile number**, **birthday**, and **location**, then verifies their mobile number.
- The user then **verifies their email address**.
- After verification, the user is shown a **"waiting for approval"** screen.
- Staff review the submission and approve or deny access (with a reason on denial); approval/denial triggers an email notification.
- "Demo"/sample accounts bypass this approval automatically, for testing/demo purposes.
- Changing the device a user logs in from **invalidates prior approval**, forcing re-submission/re-approval — approval is tied to a specific device.

### 6.2 Mobile authentication
- Login is username/email + password, followed by a **4-digit OTP sent via SMS**, required to complete login (bypassed for demo accounts).
- Successful login issues a session token; the system enforces **single active session per user** — logging in on a new device invalidates the previous session's token.
- A newer (in-progress) authentication redesign replaces this with a standard short-lived access token + longer-lived refresh token pair, but implements the same OTP/approval rules underneath.

### 6.3 Push notifications
- Users register a push token; staff can broadcast notifications to all opted-in users, with a separate "test recipients" list for pre-launch testing of notification content.

---

## 7. Member-to-member social features

- **Contacts**: bidirectional relationships with confirmed/unconfirmed/bookmarked states.
- **Real-time messaging**: member-to-member conversations delivered live over a persistent **WebSocket connection**, replacing the old poll-on-refresh internal inbox. Covers 1:1 (and optionally group) conversations, live delivery/typing/read-receipt state, and offline members receive the message on reconnect plus a push/email notification. System notifications (welcome messages, birthday greetings) continue to ride the same conversation/notification channel.
- **Threads**: a public, member-facing post feed modeled on a Threads-style experience (short posts, nested replies, likes, reposts, and a chronological/algorithmic feed) — **replaces the old category-based Forum**. There are no forum categories or per-category moderators; instead, posts and replies are moderated globally by staff (see Trust & safety) and members can follow one another to shape their feed. Threads support @mentions, media attachments, and a "reply" thread view (nested conversation), mirroring the interaction model of threads.com.
- **Marketplace (classifieds)**: member-posted listings in three structured categories — vehicles (with ~40 feature checkboxes), real estate (rent/sale, rooms, size), and jobs (location, department, seniority) — each listing is either an "offer" or a "request," supports multiple photos, and a configurable contact method. Posting requires an explicit per-member permission flag and acceptance of terms.
- **Privacy controls**: granular per-member settings control visibility of contact list, business info, activity, and birthday (and at what precision), plus per-notification-type opt-in/opt-out (new message, new contact, invite accepted, marketplace inquiry, thread reply/mention).
- **Birthdays**: a daily job congratulates the member and notifies their confirmed contacts (if the member opted to share it), with an advance flag one week before.

---

## 8. Trust & safety / content moderation

- Members can report abusive content — covers both real-time messages and Threads posts/replies; staff review and can delete reported content.
- Support tickets are raised by members (or generated automatically when staff bulk-email members) and organized into staff-defined categories/mailboxes.
- Thread moderation rights (delete, hide, pin) are staff-assignable per member (global, not per-category, since Threads has no categories).
- Bounce handling: incoming mail is monitored for delivery failures; after repeated bounces (5+) for the same address, that member's email is marked invalid and further mail is suppressed.

---

## 9. Communications

- **Transactional email** covers: invitations, invite-acceptance notifications, welcome messages, email/profile confirmation, password reset, event/membership invoices, payment reminders, approval/denial notices.
- **Newsletters**: scheduled bulk emails with a lifecycle (locked → scheduled → sending → completed); a newsletter must be test-previewed by staff before it can be activated for real sending; tracks sent count and open (read) count.
- **Mass messages**: a simpler one-at-a-time broadcast mechanism, sent in throttled batches by a scheduled job to all members with a valid, non-suppressed email address.
- Both mechanisms **self-throttle** (batch pauses / per-run send caps) to avoid mail server abuse — this is a business rule worth preserving, not just an implementation detail.

---

## 10. Search engine optimization (SEO)

SEO is treated as an **application-wide capability, not a marketing add-on**. Membership growth is invite-only and deliberately not driven by search — but two parts of the business depend directly on being found: the **paid partner network** (sponsors buy listings whose value is visibility) and **public editorial/event content**, which is how prospective members, partners, and press discover the club in the first place. Every surface of the application must therefore make an explicit, deliberate decision about whether it is public and indexable or gated and excluded — silence is not an acceptable default in either direction.

### 10.1 Indexability by surface

Every surface declares its crawl posture. Nothing is left undeclared.

| Surface | Public | Indexed | Rationale |
|---|---|---|---|
| Landing / coming-soon / marketing pages | Yes | Yes | First point of contact for all audiences |
| Magazine articles & news | Yes | Yes | Primary organic-traffic driver |
| Partner listing & outlet pages | Yes | Yes | **Monetized** — sponsors pay for this visibility |
| Public event pages (pre-event) | Yes | Yes | Drives awareness and partner/press interest |
| Event recaps & photo galleries | Yes | Yes (text) | Credibility content; galleries need alt text |
| Committee / about / legal pages | Yes | Yes | Institutional credibility |
| Member portal (profile, contacts, settings) | No | **Never** | Member PII — gated |
| Threads feed & posts | No | **Never** | Member-only discussion; invite-only club |
| Real-time messaging | No | **Never** | Private correspondence |
| Marketplace listings | No | **Never** | Member-only classifieds |
| Event registration & checkout | No | **Never** | Transactional, member-only |
| Invitation / registration-code links | No | **Never** | One-time tokens; must never be crawled |
| Staff admin console | No | **Never** | Back-office |

- Gated areas must be excluded by **both** access control and crawl directives — an authenticated redirect alone is not sufficient, because URL shapes leak through referrers and shared links.
- Member-only content must never be partially rendered to unauthenticated visitors "for SEO value." Doing so would contradict the invite-only model that defines the club.

### 10.2 Rendering requirement

- Public pages must deliver their **meaningful content in the initial HTML response**, without requiring client-side JavaScript execution. Whether this is achieved by server-side rendering or build-time pre-rendering is an implementation choice; the business requirement is that a crawler, a link-preview bot, or a visitor with a slow connection receives real content on first load.
- This is a genuine constraint, not a preference: social/link-preview crawlers and most non-Google crawlers do not execute JavaScript at all, so a client-only rendering strategy silently costs the club its share links and its partner visibility.

### 10.3 Per-page metadata

- Every public page carries **unique, content-derived metadata**: page title, meta description, canonical URL, and social preview tags (Open Graph and Twitter card — title, description, image with dimensions and alt text).
- Metadata must derive from a **single source of truth** shared with the page content. Hand-maintained metadata that duplicates on-page copy drifts and is a recurring defect source.
- Titles and descriptions must be unique per page; duplicated boilerplate across partner or article pages suppresses all of them.

### 10.4 Structured data

Machine-readable structured data is emitted where the content type supports it, so listings qualify for rich results:

- **Organization** for the club itself, on every public page.
- **LocalBusiness** for partner listings and each branch/outlet — with address, geo coordinates (already captured for events/outlets), opening hours, and the member discount where expressible.
- **Event** for public event pages — date, location, and availability, kept consistent with the event's real registration state.
- **Article** for magazine and news content — headline, author, publish and modified dates.
- **BreadcrumbList** for nested content.

Structured data must reflect actual system state; publishing an `Event` as available after registration has closed, or a partner as active after their contract lapsed, is both an SEO penalty and a factual misstatement to members.

### 10.5 Crawl control and sitemaps

- A **sitemap** is generated from live content state, not hand-maintained — entries appear when content is published and disappear when it is unpublished, expires, or (for partners) when the listing contract lapses past its grace period.
- Sitemap entries carry last-modified timestamps drawn from the content's real modification date.
- A **robots directive file** declares crawl permissions and points at the sitemap; all gated areas in §10.1 are disallowed.
- **Expired partner listings** are a specific case: when a contract lapses, the page must stop being advertised for indexing, but the business decision of whether to return "gone", redirect to the partner category, or keep a non-indexed page must be made deliberately rather than by accident.

### 10.6 URLs, canonicalisation, and status-code correctness

- Public URLs are **human-readable and slug-based**, never bare internal numeric IDs.
- URLs are **stable**. Existing indexed URLs from the legacy system represent accumulated SEO equity; the rebuild must preserve them or permanently redirect (301) old paths to their new equivalents. Silently dropping the legacy URL set would forfeit the club's existing search presence.
- Exactly **one canonical origin** is served (a single host and scheme); all other variants permanently redirect to it.
- **A URL that does not exist must return a "not found" status, never a success status carrying fallback content.** A catch-all that answers every unknown path with the homepage at HTTP 200 creates unlimited duplicate indexable URLs and is a real, easily-introduced defect in single-page application delivery — it must be explicitly prevented and regression-tested.

### 10.7 Language and regional targeting

- The club is German-first and serves German-speaking expatriates in the UAE, with English as a secondary audience. Where a page exists in more than one language, each version must declare its language and cross-reference its alternates, so search engines serve the right variant rather than treating the translations as duplicates.
- Regional relevance (UAE / Germany) is reinforced through structured data address and geo information rather than through separate country sites.

### 10.8 Staff-managed SEO fields

- Partner and editorial content records carry **first-class, staff-editable SEO fields** — SEO title, meta description, social share image, and URL slug — overriding the values otherwise derived from the content.
- These sit inside the existing five-flag permission matrix (§11) like any other content attribute, so SEO editing is a grantable staff privilege rather than a developer task.
- Because partner visibility is a **paid deliverable**, staff need to see and adjust how a partner's page presents in search and in shared links without engineering involvement.

### 10.9 Performance as an SEO factor

- Public pages must meet reasonable Core Web Vitals targets (fast initial paint, responsiveness, minimal layout shift). Performance affects both ranking and conversion, and therefore directly affects the visibility the club has sold to its partners.
- Images — event galleries, partner logos, article headers — are the dominant weight on public pages and must be served in appropriate sizes and formats with explicit dimensions, since unsized images are the most common cause of layout shift.

### 10.10 Measurability

- SEO requirements are verifiable, not aspirational: indexability posture per surface, presence and uniqueness of metadata, validity of structured data, correct status codes for missing pages, and Core Web Vitals thresholds should all be checked automatically as part of the delivery pipeline, the same way accessibility and functional behaviour are.

---

## 11. Staff administration & permissions

- Staff accounts have two special flags — **admin** (department admin) and **superadmin** (full bypass of all checks) — plus, for every other admin module, a **five-flag permission matrix**: read, write, edit, delete, status(enable/disable). This is finer-grained than a typical single "role" system and should be preserved as-is.
- Business rule: lower-privileged staff can never edit or remove admin/superadmin accounts or their permissions; only a superadmin can manage other admins.
- Staff can: manage members (search, lock/unlock, end membership, edit privileges, assign as partner contact/committee member/thread moderator, leave internal notes), manage events end-to-end (create, price, monitor registrations, send reminders, publish recaps, export attendance), manage partners and their contracts, manage membership card orders through their fulfillment pipeline, manage committees, review invitations and content moderation queues, and configure system-wide settings (invitation quotas, inactivity thresholds, mail throttling, tax rate).
- Staff editing any public content record (partner, article, event, marketing page) can also manage its **SEO metadata** — slug, SEO title, meta description, share image, and indexable flag — governed by the same five-flag permission matrix as the record itself (§10.8).
- Scheduled jobs (cron) are themselves admin-managed entities: each can be enabled/disabled/deleted, and every run is logged (start, end, outcome) for auditability.

---

## 12. Cross-cutting business rules to preserve

1. **Invite-only growth** — no public registration; invitation quotas and cooldowns gate growth and prevent spam.
2. **Membership-tier discounting is entitlement-driven** — a member's active card package (not a coupon) automatically discounts event pricing (30% / 100%).
3. **Time-window pricing** — event price is computed live from the current time versus the event's configured registration phases, not fixed at signup.
4. **Soft-delete only for members** — ending a membership never deletes data; it's a status transition, preserving full history.
5. **Idempotent invoicing** — invoices are generated once and cached/reused by a deterministic reference number, so re-sending doesn't regenerate a new document.
6. **Device-bound mobile approval** — mobile app access approval is tied to a specific device; switching devices requires re-approval.
7. **Single active session** — logging in from a new device/session invalidates the previous one (both classic web and mobile).
8. **Self-throttled bulk communication** — all bulk email/SMS/push sending caps batch sizes and paces sends to protect deliverability.
9. **Per-module, five-flag staff permissions** with an admin/superadmin bypass tier — not a simple role enum.
10. **Explicit crawl posture per surface** — every surface is deliberately declared public/indexable or gated/never-indexed; member data, Threads, messaging, marketplace, and invitation links are never indexed, and member-only content is never partially exposed to earn search visibility.
11. **Public content is rendered, not assembled client-side** — public pages must deliver real content in the initial response, because link-preview and non-Google crawlers do not execute JavaScript, and partner visibility is a sold deliverable.
12. **URL stability is an asset** — legacy indexed URLs carry accumulated SEO equity; the rebuild preserves them or permanently redirects them, and serves exactly one canonical origin.
13. **Missing means missing** — a URL that does not exist returns a not-found status, never a success response carrying fallback content (the single-page-app soft-404 trap).
14. **Published state must match real state** — structured data and share previews (event availability, partner active status) are generated from live system state, never from stale or optimistic copies.
15. **One rule set across three clients** — web, mobile, and admin are presentation layers over one Fastify API; entitlement, pricing, capacity, quota, and moderation rules are computed server-side and never reimplemented per client.


