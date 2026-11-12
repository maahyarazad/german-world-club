# Research: Referral links and XP

Each decision follows the same pattern: what was chosen, why, and what else was considered and
rejected. The spec left no open questions after the session of 2026-11-12. These decisions
resolve how to build it, not what to build.

---

## R1. A referral is recorded at mobile verification, not at the `register` call

**Decision**: `POST /onboarding/register` accepts an optional `referralCode`. It resolves the
code and keeps the result on the application as a *pending* link. The referral and its XP award
are written together when `POST /onboarding/verify-mobile` succeeds, in the same transaction
that sets `members.mobile_verified_at`.

**Rationale**: `register` creates the member row *before* any proof. The SMS code has only been
sent at that point (`application/register.ts`). Awarding there would pay XP for any phone number
typed into the form, owned or not, and the SMS country policy would be the only check. Mobile
verification is the first moment the account is proven to hold a real, reachable phone, and it
is where `verify.ts` opens the applicant's first session. In the business flow that is the end
of "Register". The user chose "at registration". This makes "registration" mean a completed one,
and the spec's FR-007 now says so.

It also handles the resume path for free. `register` may be called again for a stalled
application (same email, same password, mobile not yet verified). Each call overwrites the
pending link, so "the last code entered before completion wins" (spec, edge cases) is how the
column behaves rather than a separate rule.

**Alternatives considered**:
- *Write the referral in the `register` transaction*: pays for unverified numbers (above).
- *Write it at email confirmation*: stronger, but it moves the reward past the step the user
  picked and adds a second proof the user did not ask for.
- *Keep the code in the client until verify-mobile*: a second place the rule could diverge, and
  the web and app would each carry it differently (Principle I).

## R2. The link is re-checked when the referral is written

**Decision**: at verify-mobile, the pending link must still be `active` and its owner still
able to sign in. Otherwise no referral is written and nothing is shown to the applicant.

**Rationale**: FR-006 makes a disabled link, or the link of a locked owner, worth nothing from
the moment of disabling or locking. The time between `register` and `verify-mobile` is minutes,
but staff disabling a link during a fraud wave is exactly when that matters.

**Alternatives considered**: *trust the result from register time*: lets a disabled link keep
paying for the applications already in flight.

## R3. Self-referral is checked against the owner's contact details, silently

**Decision**: at verify-mobile, the referral is dropped when the new member's email matches the
owner's email (members, organisation users and staff all have one), or when the new member's
mobile matches the owner's mobile (members only; organisation users and staff have no mobile
column). The applicant sees nothing. An audit row `referral_refused` with `reason:
'self-referral'` records it.

**Rationale**: FR-008. The registration rules already make a second account with the *same*
email or mobile as an existing *member* impossible (`members_mobile_unique`, the email `UNIQUE`).
So for member owners this check is a backstop. For staff and organisation users, whose email
lives in other tables, it is the only check. Silence keeps the response from becoming an
oracle for "is this the owner's address". The audit row gives staff the pattern to review.

**Alternatives considered**: *refuse the registration*: punishes a legitimate applicant who
happens to share an address with a corporate contact, and confirms a match to whoever is
probing.

## R4. Exactly once by constraint

**Decision**:
- `referrals.referee_member_id` is `UNIQUE`: one referrer per person, ever.
- `xp_entries` has a partial unique index on `(referral_id) WHERE kind = 'award'`: one award
  per referral.
- `xp_entries.reverses_entry_id` is `UNIQUE`: one reversal per award.
- The referral and its award are inserted in one transaction, together with the
  `mobile_verified_at` update. Retries and concurrent verify calls hit the unique constraint and
  write nothing (`ON CONFLICT DO NOTHING`).

**Rationale**: Principle IV ("operations that may be retried MUST carry a deterministic
reference"). The referee's member id is that reference. SC-003 then becomes a property of the
schema rather than of the code path.

## R5. The XP history is append-only by trigger; the balance is a sum

**Decision**: `referral_links` allows only the state transitions in data-model.md. `referrals`,
`xp_entries` and `referral_xp_rates` refuse every `UPDATE` and `DELETE` by trigger, the same
mechanism as `audit_log` (migration 002). The balance is `SUM(amount)` over a person's entries,
never stored. Tests reset these tables with `TRUNCATE`, which fires no row triggers, as
`resetServerFaults` already does for `server_faults`.

**Rationale**: FR-014 says "even against direct database edits", and FR-015 says the balance
must never disagree with the history. XP will be money. An editable ledger, or a balance column
that a buggy update could move without a matching entry, is the defect that matters most here.
An index on `(owner_kind, owner_id)` keeps the sum cheap. A person has tens of entries, not
millions.

**Alternatives considered**:
- *Stored balance kept in step by trigger*: two sources of truth, and the one people read is the
  one that can drift.
- *Revoked grants instead of triggers*: the platform connects as one role, so revoking UPDATE
  would also block the one transition `referral_links` needs. Triggers match `audit_log`.

## R6. Owners are polymorphic; referees are always members

**Decision**: links and XP entries name their owner as `(owner_kind account_kind, owner_id
uuid)` with no foreign key, the same pattern as `sessions`. `owner_kind` is `member`, `merchant`,
`partner` or `admin` (staff). The referee is always `members.id` with a real foreign key, because
registration only ever creates members and members are never deleted.

**Rationale**: FR-011 says every role earns XP individually. Merchant and partner users live in
`organisation_users` and staff in `admin_users`, which are deliberately separate tables (§5).
A single owner column with an FK to one table would force a fourth "person" table nobody needs.

## R7. Code format: 8 Crockford base-32 characters

**Decision**: codes are 8 random characters from the Crockford base-32 alphabet
(`0-9 A-Z` minus `I L O U`), shown as `XXXX-XXXX`. Input is normalised by upper-casing, removing
spaces and hyphens, and mapping `I`/`L` to `1` and `O` to `0`. Codes are `UNIQUE` across every
code ever issued, so a retired code is never reissued. Normalisation lives in
`@gwc/contracts/referrals` so both clients format the same way. The server normalises again and
is the authority.

**Rationale**: FR-002 asks for ≤ 10 characters, readable aloud, case-insensitive and free of
confusable characters. 32⁸ ≈ 1.1 × 10¹² codes against a club of thousands makes guessing a
valid code at `public-read`'s 300/minute per IP practically impossible (SC-006). A collision on
insert is retried with a fresh code.

## R8. The link is `https://<canonical>/r/<CODE>`, served as a no-JS page

**Decision**: `GET /r/:code` is a server-rendered public page in the `public` module. It uses
the same layout as the other public templates and needs no JavaScript.
- **Valid code**: `200`. Shows "*{referrer}* invites you to German World Club", the code, a
  **Register on the web** link to `/konsole/registrieren?ref=CODE`, an **Open in the app** link
  (`germanworldclub://r/CODE`), and store links.
- **Unknown, retired, disabled, or owner not active**: `404`, identical for all four. It shows a
  page saying the link isn't valid and still offers registration, without the code.
- New surface row `referral-landing`, prefix `/r`: `public: true, indexed: false`. Its
  responses carry `X-Robots-Tag: noindex`. It is not in the sitemap, and it is not disallowed in
  robots.txt so crawlers can see the `noindex`. Responses carry `cache-control: private,
  no-store` and `referrer-policy: no-referrer`.
- Open Graph tags for link previews use the referrer's display name, which the referrer chose to
  share by sending the link.

**Rationale**: Principle III forbids answering an unknown URL with `200` and fallback content,
so invalid codes are `404`, and FR-006 is met by making the four invalid cases
indistinguishable from each other. Preview bots run no JavaScript (Technology Baseline), so a
client-rendered page would show an empty preview in WhatsApp. FR-005's naming rule: members by
`display_name`, organisation users by their `organisation_profiles` name, staff as "the German
World Club team".

**Alternatives considered**:
- *`/konsole/registrieren?ref=` as the shared link*: no preview, no route into the app, and
  `/konsole` is a gated shell.
- *`/invite/…`*: that prefix is declared as one-time invitation tokens (gated, never crawled).
  A reusable referral link is a different thing, and reusing the prefix would blur two
  postures.

## R9. Opening the app: universal links and App Links on `/r/*`, plus a custom-scheme fallback

**Decision**:
- **iOS**: `ios.associatedDomains: ['applinks:<host>']` in `app.config.js`. The server serves
  `/.well-known/apple-app-site-association` with `appID: YQFY6269ZL.com.buenapublica.germanworldclub`
  and paths `/r/*` only.
- **Android**: an `intentFilters` entry with `autoVerify: true` for `https://<host>/r/*`. The
  server serves `/.well-known/assetlinks.json` with the package name and the SHA-256 signing
  fingerprints from EAS credentials, read from a new environment variable
  `ANDROID_APP_CERT_SHA256` (comma-separated). If it is unset, the route answers `404`. It is
  not a boot precondition, because universal links are an enhancement over the landing page.
- **The app**: a root-level Expo Router route `src/app/r/[code].tsx` takes the code from both
  `https://<host>/r/CODE` and `germanworldclub://r/CODE`. It writes the code into the
  registration draft and replaces itself with `(public)/register`. A signed-in user is sent home
  and the code is ignored.
- New surface row `app-links`, prefix `/.well-known`: public, not indexed.
- The host comes from a build-time `EXPO_PUBLIC_LINK_HOST`, which must equal the server's
  `CANONICAL_ORIGIN` host.

**Rationale**: FR-004 requires the link to open the app when it is installed. Only verified
universal links and App Links do that from a tapped `https` link. A custom scheme alone cannot
be shared in most messengers. The landing page covers every case where the OS does not hand the
link over (in-app browsers, the app not installed), and its **Open in the app** button covers
the in-app browser case.

**Cost, stated plainly**: `associatedDomains`, `intentFilters` and the new `expo-clipboard`
module all need a **new EAS native build**. An over-the-air update cannot deliver them. Until
the build ships, the landing page and typing the code by hand still work.

**Alternatives considered**: *deferred deep linking (a third-party attribution SDK)*: carries
the referral through an app-store install. It needs a tracking vendor, a privacy disclosure,
and sends member data to a third party. The spec assumes manual code entry instead.

## R10. The code is a field on both registration forms

**Decision**: `registerRequestSchema` gains `referralCode: string (optional)`, validated
against the shared pattern after normalisation. The web `Register.tsx` reads `?ref=` and the
app's draft is filled by `r/[code].tsx`. Both forms show an optional, editable **Referral code**
field, and the app accepts a code typed by hand. An invalid code is sent like a valid one and
silently ignored by the server (FR-006). Neither client looks the code up before submitting.

**Rationale**: a lookup endpoint would be a second, unauthenticated oracle next to the landing
page, for no gain. The server decides (Principle I).

## R11. The XP amount is an append-only rate table

**Decision**: `referral_xp_rates (id, xp, effective_from, set_by, reason)`. The rate in force is
the latest row. The award reads it inside its own transaction and copies the amount onto the
entry. The migration inserts the first row (**100 XP**, `set_by NULL`, reason "initial rate").

**Rationale**: FR-013 requires past awards to keep their amount, and the copy does that. Keeping
the history of rate changes in a table rather than only in the audit log means "what was the rate
on date X" is a query, which the future payout feature will need. There is no general settings
table to reuse.

## R12. A new staff module, `referrals`

**Decision**: `MODULES` and `admin_module` gain `referrals`. The flags used:
- `read`: view anyone's links, referrals and XP history.
- `status`: disable a link, or reverse an award. Both are state changes that need a reason.
- `edit`: change the XP rate.
- `write` and `delete` are unused. Nothing is created by staff, and nothing is ever deleted.

Staff may not act on their **own** link or entries. Doing so is refused with `403`, because a
staff member who earns XP (Q2) reversing or disabling for themselves is self-dealing in either
direction. Changing the rate affects everyone, staff included. The audit log is the control there.

**Rationale**: a separate module, like `server_faults` in 012, so granting `members` does not
quietly grant control over what will become money.

## R13. One route set per audience

**Decision**: the same handlers are mounted once per audience, the pattern `/media` uses for
`/media/merchant` and `/media/partner`:

| Audience | Prefix | Posture |
|---|---|---|
| member | `/referrals` | `{ audience: 'member' }`, which already requires approval and finished profiling (FR-001) |
| merchant | `/referrals/merchant` | `{ audience: 'merchant' }` |
| partner | `/referrals/partner` | `{ audience: 'partner' }` |
| staff (own link) | `/admin/referrals/me` | `{ audience: 'staff', anyStaff: true }` |
| staff (oversight) | `/admin/referrals/…` | `{ audience: 'staff', module: 'referrals', flag: … }` |

New surface row `referrals`, prefix `/referrals`: gated, not indexed.

**Rationale**: a token for one audience can never satisfy another (`permissions.ts`). A member
route with no `onboarding`/`profiling` flag is refused to applicants by 10-auth, so FR-001's
"applicants not yet approved or profiled MUST NOT" needs no new code. It is tested anyway.

## R14. Referral stages are computed on read

**Decision**: nothing about a referral's progress is stored. The stage comes from the referee's
own rows:
- **Registered**: the referral exists (its `created_at`).
- **Approved**: `membership_applications.state = 'approved'` (`reviewed_at`).
- **Joined**: `member_profiling.completed_at` is set.
- **Did not join**: `membership_applications.state = 'denied'`. The denial reason is never
  selected.

**Rationale**: the same reasoning as Activity in feature 010. A stored stage is a second copy of
facts that already live in onboarding, and it would need every onboarding write to update it.
Computing it on read cannot disagree with onboarding.

## R15. What the referrer sees of the referee

**Decision**: the referee's `handle` if set, otherwise the first word of `display_name` plus the
initial of the last word ("Jana K."). It is computed on the server and named in one constant,
`REFEREE_COLUMNS`. A test asserts no response under `/referrals` or `/admin/referrals/me` carries
an email, mobile, birthday, country, denial reason or profiling field. It extends the scan in
`tests/ops/no-pii-in-social.test.ts`.

**Rationale**: FR-018, and the CLAUDE.md convention that queries on a response path name their
columns, because nothing else stops a new column from leaking (Principle VI, amended).

## R16. Rate limits

**Decision**: `/r/:code` uses the existing `public-read` bucket (300/min per IP, fail-open).
Member, organisation and staff routes use `member-api` and `admin-api`. **Replace link** uses
`write-heavy`. No new bucket.

**Rationale**: with 10¹² codes, guessing at 300/min finds nothing (R7), and failing open keeps
a sales-critical landing page up when Redis is not. Registration itself stays behind `register`
(5/h per IP) and `otp-send` (10/h per phone), which are the real throttles on making accounts.

## R17. Audit actions

**Decision**: `referral_link_created`, `referral_link_replaced`, `referral_link_disabled`
(staff, with reason), `referral_recorded`, `referral_refused` (`reason: 'self-referral' |
'link-inactive'`), `xp_awarded`, `xp_reversed` (staff, with reason), `xp_rate_changed` (staff,
with reason). `SAFE_DETAIL_KEYS` gains `xp`. Codes are never written to the audit log: they act
as bearer identifiers for the landing page, so link ids are logged instead.

## R18. Demo seed follows the consistent-history rule

**Decision**: the four new tables go under `SEEDED`. The seed:
- gives links to a sample of members, a few organisation users and one staff member;
- records referrals only for seeded members whose `mobile_verified_at` falls after their
  referrer's link was created, stamped at that `mobile_verified_at`;
- writes one award per referral at that same timestamp, using the rate in force then;
- inserts no reversals and no disabled links, because no seeded fact implies them.

The initial rate row is the migration's own and is not reseeded.

## R19. The app: Refer & earn lives in the profile stack

**Decision**: members reach `(member)/profile/referrals` from their profile screen, because the
five bottom-bar slots are full (feature 017, R7). Organisation users get
`(organisation)/referrals` from their home screen. Sharing uses React Native's built-in
`Share.share`, and **Copy** uses the new `expo-clipboard`.

**Rationale**: no sixth tab exists. Profile is where "my account" things already live (handle,
privacy, notifications).
