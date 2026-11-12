# Feature Specification: Referral links and XP

**Feature Branch**: `018-referral-xp`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "Any role from the application can create a referer link so they can
invite others using that link and they can also track this referrals and consider the bounus for
this like and XP it adds more gamification to the project and later on these XP will be real money,
so other people can use this referral link and sign-up - handle it for both web and mobile
application"

> **Relation to the business description.** `german-world-club-business-description.md` lists
> **Influencer Affiliate — "Special private link for the onboarding process"** as a P1 server
> function. This feature delivers it and widens it from influencers to every role. It does
> **not** bring back invitation-only joining: registration stays open and the approval gate
> (feature 009) stays the gate. A referral link records *who brought someone in*. It does not
> let anyone in.
>
> **Why the bar is high.** The request says XP "later on will be real money". Paying out is out
> of scope here, but every XP amount recorded by this feature will one day be a payment. So this
> feature treats XP as if it were money already. Each XP change has a recorded reason. Nothing
> is ever edited or deleted. Corrections are new entries, never rewrites of old ones.

## Clarifications

### Session 2026-11-12

- Q: When does a referral earn XP? → A: **When the new person registers.** The XP is recorded at
  the same moment as the referral itself, and later onboarding stages are tracked but award
  nothing more.
- Q: Which roles earn XP? → A: **Every role, each person individually.** That covers staff,
  members, merchant users and partner users. XP belongs to the person, never to an organisation.
- Q: Does the new member get a bonus too? → A: **No. Only the referrer earns XP.**

> **Accepted risk, stated plainly.** Registration is the earliest point and the cheapest to
> fake. A throwaway sign-up needs only a mobile number and an email that pass verification, and
> it earns XP even if the person is later denied, for example by the automatic non-German rule.
> Staff earn too, so recruiting members becomes a source of future money for employees. Nothing
> in this feature prevents either. What it does provide is detection and correction: every
> referral shows how far it got (a referrer whose referrals mostly end in **Did not join** is
> visible), and staff can reverse an award (US4). This makes US4 more urgent, and it should ship
> before XP is ever converted into money.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Get and share my referral link (Priority: P1)

A signed-in person opens **Refer & earn** on the web console or in the app. They see their
personal referral link and a short referral code they can read out loud. They can copy either
one. In the app they can also hand the link to the phone's share sheet (messages, mail and so on).
The link is created the first time they open the screen. After that it stays the same until they
choose to replace it.

**Why this priority**: until someone can share a link, nothing else in the feature can happen.

**Independent test**: sign in as a member, open Refer & earn, and copy the link. Sign out, sign
back in on the other client, and confirm both clients show the same link and code.

**Acceptance Scenarios**:

1. **Given** a full member (approved, profiling complete), **When** they open Refer & earn,
   **Then** they see one referral link and one referral code, both belonging to them.
2. **Given** a merchant user, a partner user or a staff member, **When** they open Refer & earn
   in their own console area, **Then** they see their own link and code too.
3. **Given** a person who already has a link, **When** they open the screen again on either
   client, **Then** they see the same link and code. Nothing new is created.
4. **Given** a person who replaces their link, **When** someone later opens the old link,
   **Then** the old link behaves exactly like a link that never existed (US2, scenario 4).
   People who already signed up through it stay credited to the person.
5. **Given** an applicant who is still waiting for approval or has not finished profiling,
   **When** they look for Refer & earn, **Then** it is not offered to them, and the server
   refuses them if they try anyway.

---

### User Story 2 — Sign up through someone's link (Priority: P1)

A prospective member opens a referral link. On a phone with the app installed, the link opens
the app's registration with the referral already filled in. Anywhere else, it opens the web
registration (`/konsole/registrieren`) with the referral filled in. Someone who installs the app
only after tapping the link can type the referral code at Register instead. From then on,
registration is exactly the existing onboarding. The language rule, SMS country policy, email
and mobile verification, approval and profiling all apply unchanged.

**Why this priority**: a link that loses the sign-up it led to is worthless. This story is
where a referral actually gets recorded.

**Independent test**: open a member's link in a private browser window and register a new
applicant. Confirm the member's Refer & earn list shows the new person as **Registered**. Then
register a second applicant without a link and confirm nobody gets credited.

**Acceptance Scenarios**:

1. **Given** a valid referral link, **When** a new person completes Register (web or app),
   **Then** the new person is credited to the link's owner. The credit is fixed at that moment
   and nobody can change it later.
2. **Given** a person who registered with no referral, **When** they try to add a code later,
   **Then** they can't. A referral can only be attached at Register.
3. **Given** a referral link, **When** its owner tries to register a second account with it
   (the same mobile number or email as the owner), **Then** the referral is ignored, and the
   person is told only what an ordinary duplicate registration would tell them.
4. **Given** a referral code that never existed, was replaced, or belongs to someone who was
   locked, ended or whose link staff disabled, **When** it is opened or typed in, **Then**
   registration still works and nobody is credited. All of these cases look the same to the
   visitor, so nobody can guess codes to find out who has one.
5. **Given** a referred applicant, **When** they register, **Then** being referred changes
   nothing about how their application is decided. They get no shortcut and no extra check.

---

### User Story 3 — Track my referrals and earn XP (Priority: P2)

Under Refer & earn, the person sees everyone who signed up through them and how far each one
has got: **Registered**, **Approved**, **Joined** (approved and profiling complete), or **Did not join**. They also see
their XP balance and a history of every XP change: what it was, when, and which referral it came
from. The referrer earns XP once, at the moment the referred person registers, and never again
for that person. The later stages are for following progress only and earn nothing.

**Why this priority**: tracking and XP are the gamification the request asks for. It's P2
because the referrals recorded in US1 and US2 are what it builds on.

**Independent test**: register an applicant through a member's link. Confirm the member's
balance goes up by the configured XP at once and the referral shows **Registered**. Take the
applicant through approval and profiling and confirm the stage moves to **Joined** while the
balance stays the same. Retry the registration request and confirm the XP doesn't go up a
second time.

**Acceptance Scenarios**:

1. **Given** a new person who completes Register through a link, **When** the referrer opens
   Refer & earn, **Then** the referral shows **Registered**, the balance has gone up by the XP
   amount in force at that moment, and the history shows one entry for it.
2. **Given** a referral whose application was later denied or withdrawn, **When** the referrer
   looks at it, **Then** it shows **Did not join**, with no reason and no detail about the
   person's application. The XP awarded at registration stays unless staff reverse it (US4).
3. **Given** a referral that is approved and then finishes profiling, **When** the referrer
   looks at it, **Then** it shows **Approved** and then **Joined**, and no further XP entry is
   added.
4. **Given** staff change the XP amount per referral, **When** the referrer looks at earlier
   awards, **Then** those keep the amount they were awarded with.
5. **Given** a registration that is retried or arrives twice at the same time, **Then** exactly
   one referral and exactly one XP entry exist for that person.
6. **Given** a staff member, merchant user or partner user who refers someone, **Then** they
   earn XP on their own balance just like a member. A merchant or partner user's XP is theirs,
   not their organisation's.
7. **Given** the referred person, **Then** they receive no XP for having been referred.
8. **Given** any referral, **When** it is listed, **Then** the referrer sees only the person's
   display name (their handle if they have one, otherwise first name and last initial), the
   stage and the dates. No contact details, birthday, country or profiling answers are shown.

---

### User Story 4 — Staff oversight of referrals and XP (Priority: P3)

Staff with the referral permission can see referrals and XP balances for anyone. They can set
how much XP a referral earns, disable a person's referral link, and reverse an XP
award that should not have been made (for example a fake account ring). Every action needs a
reason and goes into the audit log. Staff can never edit or delete an existing XP entry.

**Why this priority**: XP is awarded at registration, the step that is cheapest to fake
(Clarifications, accepted risk), and this is the only control against that. It isn't needed for
members to start referring people, but it MUST ship before XP is converted into money.

**Independent test**: as staff, reverse one XP award with a reason. Confirm the referrer's
balance goes down by the same amount, the history shows the original award and the reversal
side by side, and the audit log names the staff member and the reason.

**Acceptance Scenarios**:

1. **Given** staff with the permission, **When** they reverse an award with a reason, **Then** a
   matching negative entry is added and the original entry is left untouched.
2. **Given** staff without the permission, **When** they try any of these actions, **Then** the
   server refuses.
3. **Given** staff disable someone's referral link, **When** the link is opened, **Then** it
   behaves like a link that never existed (US2, scenario 4). Referrals and XP already earned
   through it stay.
4. **Given** staff try to reverse the same award twice, **Then** the second attempt is refused.
   An award can only be reversed once.

---

### Edge Cases

- **The referrer is locked or ended after a referral was recorded.** The XP awarded at
  registration stays, because it happened and the ledger records facts. Staff can reverse it
  under US4. The referral still moves through its stages. New sign-ups through the link stop at
  once and earn nothing (US2, scenario 4).
- **The referred person is denied automatically** (the non-German rule). The referrer keeps the
  XP from registration, and the referral shows **Did not join**. This is the accepted risk in
  Clarifications. Staff see the pattern and can reverse it.
- **A staff member refers someone whose application they then decide.** Nothing in this feature
  stops it. The audit log records both the referral and the decision, so the pairing can be
  found. A rule against staff deciding their own referrals would be a separate feature.
- **The referee already has an account** (same mobile number or email). Registration refuses
  them the way it does today, so no referral is created.
- **A link is opened on desktop and registration is finished later on a phone.** The referral
  doesn't carry over between devices on its own. The person types the code at Register in the
  app. The code is short and readable so this works (FR-002).
- **The link is opened with the app installed, but the person registers on the web anyway.**
  The web registration carries the code just the same.
- **A code is typed with a different letter case or with spaces.** It still matches. Codes leave
  out characters that are easy to confuse.
- **Someone gets two links and uses the second one.** Only the code present at the moment
  Register completes counts. The last one entered before completion wins, and nothing changes
  afterwards.
- **XP balance**: never stored separately from the history. The balance is always the sum of
  the history, so the two can't disagree.
- **The person replaces their link many times.** Each replacement retires the previous code.
  A retired code is never reused for anyone.
- **Someone guesses codes in bulk.** Code lookups are rate-limited, and an unknown code looks
  exactly like a retired one (US2, scenario 4), so guessing reveals nothing.

## Requirements *(mandatory)*

### Functional Requirements

**Links and codes**

- **FR-001**: Any signed-in full member (approved, profiling complete), merchant user, partner
  user or staff member MUST be able to get their personal referral link and referral code on the
  web console, and members, merchant users and partner users MUST also be able to in the app.
  Applicants who are not yet approved or not yet profiled MUST NOT be able to.
- **FR-002**: Each person MUST have at most one active code at a time. A code MUST be short
  (at most 10 characters), readable aloud, matched regardless of letter case and spaces, free of
  easily confused characters, and never reused once retired.
- **FR-003**: A person MUST be able to replace their link. Replacing it retires the old code for
  new sign-ups and leaves every referral already recorded unchanged.
- **FR-004**: Opening a referral link MUST lead to registration with the code already filled
  in: in the app if it is installed on that phone, on the web otherwise. Registration in the app
  MUST also accept a code typed by hand.
- **FR-005**: The referral landing page MUST never be indexed, MUST stay out of the sitemap,
  and MUST name the referrer only by their display name (members), organisation profile name
  (merchant and partner users) or "the German World Club team" (staff). It MUST never show
  contact details.
- **FR-006**: An unknown, retired or disabled code, or the code of a locked or ended person,
  MUST produce exactly the same visible result: registration continues and nobody is credited.

**Attribution**

- **FR-007**: A referral MUST be recorded when, and only when, a new person completes Register
  with a valid code. Register is complete when the new person's mobile number is verified, the
  first point where the account is proven to belong to a real, reachable phone. An account
  whose number is never verified earns its referrer nothing (planning, research R1). It MUST be fixed from that moment. There MUST be no way to add, change or
  remove a referrer afterwards.
- **FR-008**: Self-referral MUST be refused without saying why. A registration whose mobile
  number or email matches the code owner's is never credited to them.
- **FR-009**: A referral MUST NOT affect how the application is decided. The language rule, SMS
  country policy, verification, automatic approval, staff approval and profiling all apply
  exactly as they do without one.

**XP**

- **FR-010**: A referral MUST earn the referrer XP exactly once, at the moment the referral is
  recorded (FR-007). The referral and its XP entry MUST either both exist or neither exist. Later
  stages (Approved, Joined, Did not join) MUST NOT add or remove XP on their own.
- **FR-011**: Every role that can have a link (FR-001) MUST earn XP: members, merchant users,
  partner users and staff. XP MUST belong to the individual person. There MUST be no
  organisation-level XP balance.
- **FR-012**: The person who signed up through a link MUST NOT receive XP for it. Only the
  referrer earns.
- **FR-013**: The XP for a referral MUST be a single amount that staff can set.
  Each award MUST record the amount in force at that moment, and a later change MUST NOT alter
  past awards.
- **FR-014**: Every XP change MUST be its own permanent history entry with an amount, a reason,
  a time and the referral it belongs to. Entries MUST NOT be edited or deleted by anyone, and that
  rule MUST hold even against direct database edits.
- **FR-015**: A person's XP balance MUST always equal the sum of their history entries. It MUST
  NOT be kept as a separate figure that could disagree with them.
- **FR-016**: XP MUST have no cash value in this feature. It can't be redeemed, paid out,
  transferred between people or spent, and the interface MUST NOT show it as money.

**Tracking**

- **FR-017**: A person MUST be able to see each of their referrals with its stage
  (Registered, Approved, Joined, Did not join), the date of each stage reached and the XP it
  earned, plus their total XP and full XP history. This works on both clients wherever FR-001
  gives them a link.
- **FR-018**: The referrer MUST never see a referee's contact details, birthday, country,
  denial reason or profiling answers. They see only the display name described in US3,
  scenario 5.

**Staff**

- **FR-019**: Staff with a new referral permission MUST be able to view any person's referrals
  and XP history, set the XP amount, disable a person's link, and reverse an award. Every action
  except viewing MUST need a reason and MUST be written to the audit log.
- **FR-020**: A reversal MUST be a new entry that cancels exactly one award. Each award MUST be
  reversible at most once.

**Both clients, both languages**

- **FR-021**: Every screen in this feature MUST exist in German and English on the web console
  and in the app, following the platform's existing language rules.

### Key Entities

- **Referral link**: belongs to one person (member, merchant user, partner user or staff
  member). It has a code and a state: active, retired (replaced by its owner) or disabled (by
  staff, with a reason). A person has at most one active link.
- **Referral**: a record that one new person registered through one link. It holds the
  referrer, the referee, the link used, the registration time and the time of each later stage.
  It is fixed once created. There is at most one per referee.
- **XP entry**: one permanent change to one person's XP. It holds the amount (positive for an
  award, negative for a reversal), the reason, the time, the referral it belongs to, and for a
  reversal, the award it cancels and the staff member who made it.
- **XP setting**: the current XP per referral, set by staff. Changes are audited.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-in person can copy or share their referral link within 30 seconds of
  opening the app or web console.
- **SC-002**: 100% of registrations completed through a valid link or code are credited to the
  right referrer, on the web and in the app, and 0% of registrations without one are credited
  to anybody.
- **SC-003**: Across any number of retries or concurrent attempts, every recorded referral has
  exactly one award and no referee has more than one. Measured over the whole history, the
  number of awards equals the number of referrals.
- **SC-004**: For every person, the displayed XP balance equals the sum of their history at
  every moment. An audit can rebuild any balance from the history alone.
- **SC-005**: A referred applicant's approval outcome and timing match those of an
  equivalent applicant who wasn't referred.
- **SC-006**: Nobody can tell from outside whether a given code ever existed. Unknown, retired
  and disabled codes produce identical visible results.

## Assumptions

- **Registration stays open.** Referral links don't replace or bypass approval. The invite-only
  rule in the older business description (§3.1) is still superseded by feature 009's approval
  gate.
- **Money is a later feature.** Converting XP into money, paying it out, tax, KYC and the terms
  under which XP becomes money are out of scope. This feature only makes sure the XP history is
  good enough to support that later.
- **One flat XP amount per referral.** Tiers, levels, badges, streaks, leaderboards
  and campaign multipliers are out of scope. A leaderboard in particular would publish
  who referred how many people, which is a privacy decision of its own.
- **No notifications in this feature.** The referrer sees progress when they open Refer & earn.
  A push or Activity entry when someone registers through a link is a natural follow-up, built on the
  existing push outbox.
- **No automatic carry-over between devices.** If someone installs the app after tapping a link,
  they type the code at Register. The app doesn't try to pick up the referral by itself.
- **Staff use the web console only.** The app has no staff face, so staff get their link, and
  see their XP, on the web.
- **Policy before payout.** Staff earning XP, and XP earned for applicants who are later denied,
  are both allowed here (Clarifications). The terms that decide whether such XP is ever paid out
  belong to the feature that converts XP into money, and that feature can use the stage history
  this one records.
- **Sharing is copy and the phone's share sheet.** QR codes and posters are out of scope.
- **Existing rate limiting** protects code lookups. No new business quota limits how many
  people one link can bring in.
