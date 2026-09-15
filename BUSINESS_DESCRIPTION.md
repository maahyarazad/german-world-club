# German Emirates Club — Business Description

This document describes the **business logic and behavior** of the existing application, independent of implementation technology, so the same system can be rebuilt on a different stack while preserving how it actually works for members, staff, and partners.

It was produced by scanning the current PHP codebase and its supporting Node.js API layer. It intentionally excludes the two React/Node.js admin applications (`admin/gec-node-admin` and `admin/gec-app-cms`), which are newer front-ends being built on top of this same business logic — they are not the source of truth for behavior, this legacy system is.

> Note on scope: the API layer (`api/dev|prod|staging`) turned out to be a Node.js/Express service rather than PHP, and `admin/gec-events/` is a small PHP mini-app (kept in scope). Both are included below because they implement real business rules of the same product, even though `api/*` isn't PHP.

---

## 1. What the product is

**German Emirates Club (GEC)** is an invite-only social/networking club for German-speaking expatriates in the UAE, plus:
- A **companion mobile app** (backed by the Node.js API), tied into the same member data as the website.
- A **partner/sponsor discount network** monetized through paid partner listings and member benefit redemption.
- A **staff back-office** for running memberships, events, billing, content moderation, and communications.

There are effectively three "faces" of the same domain model:
1. **Classic website + member portal** (PHP, session/cookie based, German-first).
2. **Mobile app API** (Node.js, JWT + OTP based).
3. **Staff admin console** (PHP, AJAX fragment-based, role/permission gated).

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

---

## 5. Partner / sponsor network and offer redemption

- Partners are businesses offering member discounts, each with a **paid listing contract** (start date + duration in years, with a grace period) that determines whether the listing is currently "active" and shown to members.
- Partners can have multiple branch locations ("outlets") linked to one parent listing, and a designated staff/member contact person.
- Partner names in free-text content (threads, marketplace, magazine) are automatically hyperlinked back to the partner's page.
- **Mobile-app offer redemption** (a more structured, POS-facing flow than the website's static discount display):
  1. A user requests a coupon code for a specific partner offer; the system issues (or reuses) a code composed of a category prefix and a sequence number.
  2. At redemption time (merchant-facing), the code is validated against a **merchant terminal PIN**, daily redemption counters (global and per-category) are checked, a redemption transaction is logged with a generated reference number, the user's offer is marked consumed, and the offer's remaining availability count is decremented.
- This effectively implements a lightweight coupon/voucher ledger with anti-abuse counters, separate from the membership-card discount mechanism used for events.

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

- **Public, unauthenticated pages** — the coming-soon/landing page, magazine articles/news, partner listing pages, and public event pages — must be crawlable and indexable: server-rendered (or pre-rendered) HTML rather than client-only rendering, so content is present on first load without requiring JavaScript execution.
- Each public page needs **unique, content-derived metadata**: `<title>`, meta description, canonical URL, and Open Graph/Twitter card tags (title, description, image) for link-preview rendering when shared.
- **Structured data (JSON-LD)** should be emitted where applicable — `Organization`/`LocalBusiness` for partner pages, `Event` for public event pages, `Article` for magazine/news content — to support rich results.
- A **sitemap.xml** (auto-generated, kept in sync as content is published/unpublished/expired) and a **robots.txt** must exist; gated/member-only areas (portal, marketplace, Threads, messaging) are excluded from indexing (`noindex` / disallow).
- URLs for public content should be **human-readable and stable** (slug-based, not internal numeric IDs), since existing indexed URLs represent SEO equity that should be preserved or 301-redirected during the rebuild.
- Partner and magazine content editors should be able to set/override the SEO title, description, and share image per item — this is already an implicit staff need (paid partner listings depend on being found) and should be made an explicit, first-class field on those content types rather than derived automatically.
- Performance is an SEO factor as well as a UX one: public pages should meet reasonable Core Web Vitals targets (fast initial paint, minimal layout shift) since this affects both ranking and paid-partner visibility, which the business monetizes.

---

## 11. Staff administration & permissions

- Staff accounts have two special flags — **admin** (department admin) and **superadmin** (full bypass of all checks) — plus, for every other admin module, a **five-flag permission matrix**: read, write, edit, delete, status(enable/disable). This is finer-grained than a typical single "role" system and should be preserved as-is.
- Business rule: lower-privileged staff can never edit or remove admin/superadmin accounts or their permissions; only a superadmin can manage other admins.
- Staff can: manage members (search, lock/unlock, end membership, edit privileges, assign as partner contact/committee member/thread moderator, leave internal notes), manage events end-to-end (create, price, monitor registrations, send reminders, publish recaps, export attendance), manage partners and their contracts, manage membership card orders through their fulfillment pipeline, manage committees, review invitations and content moderation queues, and configure system-wide settings (invitation quotas, inactivity thresholds, mail throttling, tax rate).
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
10. **Multi-tenant reuse** — the mobile backend serves two differently-branded programs (GEC and IFZA Rewards) from one shared data model and rule set, differentiated only by a tenant id and template selection.

---

## 13. Known technical debt to modernize (not to replicate as "business logic")

- Legacy password hashing is unsalted MD5 in the PHP/website layer — must be replaced with a modern hashing algorithm in the rebuild; this was never an intended business rule.
- Payment gateway integration in the mobile API is currently a stub/placeholder — no live gateway is wired up there yet (the website/admin flows do use a real hosted payment page).
- The mobile API has a legacy v1, a newer partially-migrated v2, and a separate older PHP `v2/api/` login script for the classic website — these represent migration history, not distinct business requirements. The rebuild should implement one clean version of each capability listed above.

---

## 14. Explicitly out of scope for this document

- `admin/gec-node-admin` and `admin/gec-app-cms` — newer React/Node front-ends over this same business logic; not analyzed as a source of behavior.
- Static marketing/legal pages (careers listings, legal policy pages, campaign landing microsites, app-download pages) — these carry no server-side business logic beyond simple lead-capture forms noted above.
