# German World Club platform

One API serving three faces — member web, mobile app, staff console — plus the
public site that search engines and preview bots see.

## Layout

```
server/              Fastify 5 API. Everything testable lives in app.js;
                     server.js only listens. See server/ARCHITECTURE.md for
                     how src/ is laid out (routes/controllers/application,
                     plugins/decorators/hooks).
client/              Vite web client.
expo-client/german-world-club/
                     Expo SDK 57 mobile app (feature 009). An npm workspace:
                     it imports @gwc/contracts like every other client.
packages/contracts/  Zod schemas, problem types and permission constants,
                     imported by the server AND every client.
specs/               Spec-kit artifacts: spec, plan, tasks, contracts.
```

`server/src/plugins/` holds the numbered Fastify bootstrap (unchanged by feature
006); `server/src/decorators/` and `server/src/hooks/` hold the cross-cutting
`app.decorate`/`app.addHook` calls that used to sit inline in `app.js`; each
HTTP-facing feature lives under `server/src/modules/<domain>/` split into
`routes.js` (schema + posture + wiring), `controller.js` (request/reply
shaping) and `application/` (the actual business rule, framework-free).

`packages/contracts` exists so a field renamed in one place is a type error
everywhere else rather than a runtime surprise in one client. Since feature 007
that is literal: it exports TypeScript types, and `tsc --noEmit` names every
caller. Adding a shape that both the server and a client need? It goes there,
not in either of them — a type declared locally because the shared one was
inconvenient recreates exactly the divergence the package exists to prevent,
and nothing detects it at runtime any more.

## Commands

```bash
npm run -w server dev          # watch mode
npm run -w server migrate      # apply migrations
npm run -w server seed:dev     # a published page and an asset with variants
npm run -w server seed:demo    # the full demo population, with a credentials table
npm run -w server test         # vitest; SQL suites skip loudly without a DB
npm run -w server verify:seo   # crawl the real sitemap, exit non-zero on problems
npm run -w server seed:perf    # 5k members / 50k posts for measuring (dev only)
npm run -w server bench:feed   # p95 of the Threads hot paths vs their budgets
npm test                       # every workspace
```

`server/README.md` covers the three deployment preconditions — `TRUST_PROXY`,
`CANONICAL_ORIGIN`, `KEEP_ALIVE_TIMEOUT_MS` — and why none of them has a safe
default.

## Things that will bite you

**Plugin filenames are numbered because the order is semantic.** Correlation
before logging, security headers before routes, rate limits before
authentication (so an unauthenticated flood is cheap to refuse), authentication
before authorization, deadlines before handlers. Renaming or reordering them
changes behaviour. `15-openapi.js` in particular must register **before** the
route plugins: `@fastify/swagger` collects routes through an `onRoute` hook,
and a Fastify `onRoute` hook only fires for routes registered after it.

**A third-party plugin's routes are still your routes.** A plugin that
registers routes of its own — `@fastify/swagger-ui`, `@fastify/static` —
declares no posture for them, so a bare registration does not produce an
unguarded route, it produces a server that will not boot. Register it inside an
encapsulated scope and declare the posture once for the whole subtree with a
scope-level `onRoute` hook; `11-rbac.js` defers its judgement to `onReady`
precisely so that hook has run. Enforce with a scope-level `onRequest` hook
rather than the plugin's own hook option: swagger-ui's `uiHooks` are not passed
to the `@fastify/static` registration serving its bundle, so using them would
have gated the page and left the assets open. Watch for config that another
plugin reads at `onRoute` time — a `config.rateLimit` stamped by a scope hook
arrives after `@fastify/rate-limit` has already looked, and builds no limiter
at all without saying so.

**An environment-only route is a registration, not a check.** `/swagger-ui` is
the unauthenticated API reference, and it exists only when
`NODE_ENV=development` because the whole `app.register` is inside the `if` —
not because a handler asks what environment it is in. Outside development there
is no route, so there is no posture to get wrong and no refusal confirming the
surface exists; the test for it asserts `404` rather than `401`. The gated
`/admin/docs` mount is unchanged in every environment, which is the point:
production behaviour never depends on reading a conditional correctly.

**Three gates refuse to boot**, rather than letting a defect through to review:

- a route with no `config.auth`
- Σ(outbound budgets) ≥ the route's deadline
- a dependency with no declared fallback

Adding a route means declaring its access posture. Making it public is an
affirmative act that shows up in a diff.

There used to be a fourth: a route with no `schema.response` and no
`config.produces`. Feature 007 removed it along with the response schemas it
checked, under constitution 2.0.0. Nothing now stops a column added later from
reaching a client, so **queries in `application/` name their columns
explicitly** — never `SELECT *` on a path that reaches a response. That is a
convention backed by a test where it used to be a property of the framework.

**Rate limits are not quotas.** A 429 means "retry later and it will work". A
business quota — invitations, coupons, event capacity, stored bytes — means
retrying changes nothing until state does. Quotas live in PostgreSQL under a
row lock via `db/counters.js`, never in the rate limiter, because they must be
exact under concurrency, survive a Redis flush, and be auditable.

**Authorization is never read from the token.** Permissions are resolved per
request, so a revoked grant takes effect on the *next* request rather than when
the token happens to expire.

**The original upload is never served.** Clients get derivatives at declared
breakpoints. The original is a storage artefact, and `verify:seo` plus the
media suites both assert no response references it.

**Two languages, two mechanisms, for opposite reasons.** The console switches in
place and remembers the choice in the browser; the public landing pages switch
by *link*, because they run no JavaScript at all and the platform already serves
one URL per language (`about`/`about-us`, `impressum`/`imprint`). `/` and `/en`
are a translation pair: each is canonical for **itself**, and their hreflang set
is derived from a shared `translation_group_id` so a one-directional
declaration — which search engines ignore, suppressing both pages — cannot be
written. Canonicalising `/en` onto `/` delists the English page entirely; that
is the single most consequential line in the feature.

**The landing pages know who is looking, without JavaScript (feature 022,
`specs/022-landing-signed-in-avatar/`).** `/` and `/en` render a signed-in
visitor's avatar (or initials) linking to `/konsole` in place of every sign-in
link: the server fills the `<!--gwc:account|signin|footer-->` marker pairs in
`client/index.html` and `en.html` (`tests/seo/landing-viewer.test.ts` fails if a
shell loses one). Who is looking is `app.peekViewer` in 10-auth — the console's
own session and gate rules, run against a stand-in request, so the route stays
`audience: 'public'`, gets no `request.principal` and audits nothing. A
signed-in page is `private, no-store` with `Vary: Cookie`; the anonymous page is
byte-for-byte the shell with its public caching — never add `Vary: Cookie` to
it, which would make nearly every visitor a cache miss. The refresh cookie is
scoped to `/auth/refresh`, so after the 24-hour access token lapses the page
shows "Anmelden" until the console is used again; that is accepted, not a bug.

**Interface strings live in `client/src/i18n/`, one module per locale, read
through `useTranslations()`.** A component that imports a catalogue directly
hard-codes its language and survives every switch silently, so
`tests/no-hardcoded-strings.test.js` refuses one. `npm run -w client test:i18n`
fails the build when the catalogues disagree on any key, **in either
direction** — a missing translation is otherwise invisible until someone
switches language on the one screen that uses it. Formatting follows the locale
too: translating labels while leaving `1.240,50 €` in an English interface is
the half-done version of the feature.

**The server emits no localised text, and that is deliberate.** Problem `detail`
stays English and the console translates on `type`, which is why a second
language cost no server change at all. `tests/ops/no-server-localisation.test.js`
asserts no response body varies with `Accept-Language`, because "localise the
API too" is the obvious next step and it is not one this platform takes.

**The demo seed has three standing rules.** `seed:demo` (feature 005) fills every
table and prints a credentials table with a working password for each role, so
it is **development-only, enforced by a gate that runs before `loadEnv()`** —
under `NODE_ENV=production` or `test` it refuses and explains why. Publishing
passwords is the deliberate point of the command, which is exactly why it must
never run anywhere real.

`sessions`, `refresh_tokens`, `otp_challenges` and `password_reset_tokens` are
**never seeded**. A seeded session is a valid credential nobody authenticated
for and a seeded reset token is a working password-reset link sitting in a
table — with the demo passwords published, both are live. `src/seed/tables.js`
is the manifest and `tests/seed/no-live-credentials.test.js` enforces it twice:
statically against the seeder's source, and against the database after a run.
Those tables fill themselves on sign-in, which is the only way they should.

History tables follow the **consistent-history rule: an entry only where a
seeded fact implies one, at that fact's own timestamp and its own value.** A
member whose status is `locked` gets the entry that locked them, stamped
`status_changed_at`; a `media.stored_bytes` counter is `sum(bytes)` over that
member's assets, computed by Postgres in the insert. Nothing gets invented
history. The audit log is the one table nobody may edit, and filling it with
fiction would be the worst available use of it.

`seed:demo` is additive and idempotent, and it never deletes: `members` and
`organisations` both refuse `DELETE` by trigger, and a seeder that disabled a
trigger to make itself re-runnable is one tab-completion from the wrong
database. Generated identities live at `@*.demo.invalid` so they can never
collide with the six fixed `@test.invalid` accounts `seed:dev` creates — which
`tests/seed/fixed-accounts.test.js` checks by comparing password hashes, because
a collision that rewrote one leaves the row count unchanged.

**A commercial counterparty is neither a member nor staff.** `merchant` and
`partner` are their own audiences with their own tables (`organisations`,
`organisation_users`), because §5 is emphatic that a merchant is not a member
and a corporate partnership is expressly not a membership. Audience isolation
is enforced at token verification, but it cannot express "your own
organisation" — that is `guardOrganisationScope` in `authz/object-guards.js`,
and it answers **404, not 403**, so a merchant login cannot enumerate the club's
partners by guessing uuids.

**The marketplace is two modules, and messaging is not part of it.**
`modules/marketplace/` holds member classifieds (feature 008, §7): member routes
in `routes.ts`, the `/admin/marketplace/*` moderation routes in
`staff-routes.ts`, gated on the existing `marketplace_moderation` module.
`modules/messaging/` is its own module because it outlives the marketplace —
threads and system notifications will ride the same tables — so a conversation
references its subject softly (`subject_type`, `subject_id`) rather than by a
foreign key to listings, and the application enforces that reference. On the
clients (feature 017), the web compose form lives in a right-edge `Drawer`
opened from the page header, and the app's Marketplace tab is the fifth — and
last — bottom-bar slot. Five rules that look optional and are not:

- **Ownership refusals are 404, never 403**, and indistinguishable from an
  absent id (status, body and headers — `tests/marketplace/ownership.test.ts`).
- **Every member may post, and no member may offer a job** (feature 021,
  `specs/021-member-marketplace-posting/`). There is no posting flag —
  `marketplace_post` was retired and stripped. Which modes a category allows
  is `CATEGORY_DEFS[…].modes` in `@gwc/contracts/marketplace` (job:
  `request` only); the server refuses anything else with 422
  `marketplace/mode-not-allowed` and both compose forms display only those
  modes. Behind it, the `marketplace_no_new_job_offer` trigger refuses
  *creating* a job offer — insert, change into one, publish a draft — and
  deliberately not a CHECK, which would also refuse filling, withdrawing,
  expiring or moderating the job offers that predate the rule. Tests that
  need one create it with `session_replication_role = replica`
  (`tests/marketplace/helpers.ts`); the seed never does.
- **`expires_at IS NULL` means unlimited**, a first-class choice. The
  `marketplace-expiry` job's predicate is `expires_at IS NOT NULL AND
  expires_at <= now()` — both halves, or it silently expires every unlimited
  listing. `tests/marketplace/expiry.test.ts` asserts the null case survives.
- **Staff moderate, they do not rewrite.** Hide, restore, remove and resolve
  each need a reason and write to the audit log; `write` and `edit` are
  deliberately unused on `marketplace_moderation`, so no staff endpoint changes
  what a member said.
- **Two surfaces, two declarations.** `/marketplace` is gated and never
  indexed; `/marktplatz` is public, indexed, and shows aggregate counts only —
  no listing id, title, photo, price or owner. They are separate rows in
  `seo/surfaces.ts` so adding the public one cannot relax the gated one.

**Editing, publishing and disabling listings (feature 037,
`specs/037-marketplace-listing-management/`).** "Published" is `active`,
"unpublished" is `draft`, "disabled by staff" is `hidden` — no new state, so
every read that filters `state = 'active'` already hides a draft and a disabled
listing everywhere (browse, detail, `/marktplatz` counts, new requests). Six
rules that look optional and are not:

- **Every member may edit their own listings, with no permission flag.** The
  gate is ownership, checked on the loaded row inside the transaction (404 for
  anyone else, identical to an absent id). Editable states are `draft`,
  `active`, `expired` (`EDITABLE_STATES`); sold, filled, withdrawn and hidden
  answer 409 `marketplace/not-editable`, and photos follow the same rule.
- **One PATCH carries the fields, the expiry and Publish** (`published`), in one
  transaction. `version` (`updated_at` to the microsecond) is required, and a
  stale one is 409 `conflict`. Attaching or removing a photo does **not** move it.
  A new listing's `publish` defaults to `true`, so older app builds still go live.
- **The server serialises responses through Zod, and drops any key the schema
  does not declare.** `version`, `canEdit`, `canPublish`, `moderated`,
  `hiddenFromState` and `openReports` exist on the wire only because the route
  schemas list them; the tests read the HTTP body, not the handler's return.
- **Disable is hide, from `draft` or `active` only, and Enable returns the
  listing to where it was.** `hidden_from_state` remembers it; NULL (a row hidden
  before the column existed) means `active`. A disabled draft comes back a draft
  and is never published. The owner is told only `moderated: true` — never the
  reason, who, or `hiddenFromState`; those stay in the audit log.
- **The staff page (`GET /admin/marketplace/listings`) is read-only on `read`.**
  Member listings only (merchant offers are other tables), no contact detail, no
  body text, keyset paged on a microsecond cursor. It reverses the old "no
  separate listing browser" stance, but staff still cannot change what a member
  wrote: `write` and `edit` stay unused.
- **A draft counts toward the 20-listing limit**, the same as a live one.

**The app uploads through one path, and the server's upload budget includes the
time the file takes to arrive.** The handler deadline starts when the request's
headers arrive and a multipart body is read inside the handler, so
`media-upload`'s deadline (25 s, under the 30 s `requestTimeout`) covers the whole
upload. At 8 s a phone photo on a mobile uplink got a 503 before it finished
arriving, and listing photos, avatars and Threads media "did not save"
(`specs/037-marketplace-listing-management/research.md` R11;
`tests/media/app-upload-shape.test.ts` sends one over a real socket). Merchants
only escaped it because their photos are held to 1 MiB. In the app every upload
is `useMediaUpload('member' | 'merchant' | 'partner')` over `uploadWithProgress`,
shown with `UploadProgress` (`variant="spinner"` for the club loader and a
percentage, covering a whole batch); never plain `fetch`, which reports no
progress.

**An iPhone's photo is HEIC, and the server will not decode it.** `sharp`'s
bundled libheif has no HEVC decoder (it reads a HEIC's header and fails on the
pixels), so a HEIC upload is refused `400 unsupported-media-type`. The fix is at
the source: `pickMedia` asks the picker for `preferredAssetRepresentationMode:
Compatible`, so iOS converts to JPEG on the phone. The native default is
`current` (the type docs say `automatic`), which returns raw HEIC and ignores
`quality`; every pick that is not a cropped one goes through that path. Do not
remove the setting. A file still labelled HEIC is checked against its own bytes
(`sniffImageType`, `@gwc/contracts/media`) before it is refused, because a
converted photo can keep a `.heic` name. What the club accepts is one list,
`ACCEPTED_MEDIA_TYPES`, shared by the server's validator and both clients; never
copy it. The refusal carries `detectedType` and `acceptedTypes` as problem
extension members (`error.extensions`, which cannot override a standard
member), and the app turns it into `reason: 'unsupported-format'`: its own
message, no Retry. Decoding HEIC on the server is a deliberate non-goal
(patent and licence exposure, CPU on untrusted input); see
`specs/037-marketplace-listing-management/research.md` R12 for when to revisit.

**A message is persisted before anyone is told about it.** `converse.ts`
commits first and notifies after, never inside the transaction, so a failed
push cannot roll back a message the sender was told was accepted
(`tests/messaging/persist-before-notify.test.ts`). **In-app real-time
transport is a later feature.** Messages are delivered on read today: there is
no `delivered_at` or `read_at` on messages, and no WebSocket. They arrive
together with the transport that can actually set them, not as columns nothing
writes. Push (feature 011) is not that transport: a `push_deliveries` row
records that a provider was asked to reach a phone, not that a member read
anything.

The demo seed's marketplace corpus follows the history rule like everything
else: a sold, filled or withdrawn listing gets the owner's state-change entry
at its own `state_changed_at`, a hidden one the moderator's, and an expired one
the `marketplace-expiry` job run that moved it. Nothing else gets history.

**Onboarding is gated by approval, not invitation** (feature 009,
`specs/009-expo-client/spec.md`). Registration is open; a row in
`membership_applications` that is not `approved` makes 10-auth refuse that
member on *every* route and every face — web included, because device approval
alone would let an applicant with a confirmed email walk in through a browser.
Members with no row (invited, legacy) are untouched. The only routes an
applicant reaches are those declaring `config.auth.onboarding: true`, which
11-rbac accepts on member routes only. Both faces run it — the app, and the
console at `/konsole/registrieren` — against the same endpoints: the app sends
a `deviceId` and gets tokens, the browser sends none and gets cookies, and a
web application (`device_id IS NULL`) approves no device. Sign-in gives an
unapproved applicant a session only on the face they applied from — their
phone by SMS, or a browser by password — so they can resume.

Two Phase 1 rules decide applications without staff. At email confirmation a
`non_german` applicant (`members.primary_language`, asked at Register) is denied
by the system and never reaches the queue; a `german` one gets the 48-hour
thank-you mail, and the `onboarding.auto-approve` job approves them after 24 h.
Both go through `applyDecision` like a staff decision (`reviewed_by` NULL,
`decided_automatically` true), and only rows with an explicit language are ever
touched — a missing one triggers neither rule.

**A member is signed in per device, not per account (feature 026,
`specs/026-device-sessions/`).** The web and any number of phones are signed in
at once; the rule is a partial unique index — one active session per
`member_devices` row — and a sign-in on one device never ends another.
Staff and organisation accounts have no device row and keep one session per
account. There is **no per-device staff approval** any more: a phone is *known*
(`member_devices.known_at`) once an SMS code has proven it, or staff approved the
application it applied from, and a known phone signs in with the password alone;
a new phone gets the code. Four rules that look optional and are not:

- **Ending a device from the list forgets it; signing out does not.** `DELETE
  /member/devices/:id` clears `known_at` (and ends the session, push
  registration and refresh tokens). A plain sign-out, ending *this* device from
  the list, or the 30-day idle expiry leaves the phone known. A member becoming
  `locked`, `inactive` or `ended` forgets every phone — by trigger, because
  nothing in the application revokes sessions on a status change.
- **A browser is an entry because it holds a `gwc_bid` cookie**, stored only as
  its SHA-256. A cleared cookie or a private window is a new entry, honestly.
- **The device list shows a label, never an IP, user agent, device key, token or
  session id**, and another member's device answers the same 404 as an unknown
  one. `tests/devices/list.test.ts` scans the body for those.
- **A new revocation reason must be added to `sessions_revoked_reason_check` in
  the same change** (043 and 044 both exist because it was not).

`device_approvals` is still written when an application is decided, but nothing
reads it at sign-in or per request. A member manages their sessions at
`/konsole/mitglied/profil/einstellungen` (Settings, next to Edit profile in the
web profile; feature 027). The 026 address `profil/geraete` redirects there.

**Roles & permissions and the dashboard figures (feature 028,
`specs/028-superadmin-dashboard-roles/`).** `GET /admin/admins` lists every staff
account with its grants; `PATCH /admin/admins/:id` changes role, active state and
per-area grants. A role is **derived** (`is_superadmin` → superadmin, `is_admin` →
administrator, else staff) — there is no role table. Five rules that look optional
and are not:

- **The server decides what is allowed, once.** `constraintsFor` in
  `modules/admins/application/constraints.ts` builds the `constraints` the console
  renders (a disabled control, the reason as a tooltip) *and* refuses a PATCH, so the
  page and the refusal cannot disagree. Reasons are codes — `self`,
  `last-superadmin`, `superadmin-required` — with problem types `CANNOT_CHANGE_SELF`,
  `LAST_SUPERADMIN`, `CANNOT_MANAGE_ADMIN`; the server sends no translated text.
  `last-superadmin` outranks `self`, so the only superadmin is told why, not just "you".
- **Promoting anyone, and a non-superadmin editing their own grants, are refused.**
  `guardAdminTarget` alone looks at the target's *current* state, so `admins.edit`
  would otherwise be "make yourself administrator" or "grant yourself everything".
- **Two superadmins demoting each other is serialised by an advisory lock**, taken
  before anything is read in `update.ts`. The 006 trigger alone is not enough under
  READ COMMITTED: each transaction sees the other superadmin still in place and both
  commit. The caller is re-read from the database inside the transaction too.
- **A change must call `app.permissions.invalidate(id)` after commit.** The resolver
  caches snapshots for 30 s and relies on explicit invalidation; without it a grant
  or a deactivation would bite 30 s late (SC-003). Other instances still wait out the TTL.
- **A stale edit is a 409.** The account's `version` is its `updated_at` formatted by
  the database to the microsecond (a JS Date keeps milliseconds), and every PATCH
  bumps it, grants-only changes included. The audit entry is written in the same
  transaction (`auditInTransaction`) under the allowlisted key `adminChange`.

The dashboard figures are `GET /admin/dashboard/figures`, **superadmin only by a
handler check**: the posture vocabulary has no "superadmin only", so the route
declares module `admins` + `read` and the handler refuses everyone else. "Active
member" excludes applicants (their `members.status` stays `active` while an
application is pending). A figure that cannot be computed is `null`, never `0`.

**The web console renews its own session (feature 029).** The access token lives
`ACCESS_TOKEN_TTL_SECONDS` (24 h, `@gwc/contracts/auth`); the browser then drops the
cookie and the next request answers 401 `unauthenticated`. `client/src/lib/api.ts`
answers that with ONE `POST /auth/refresh` from the 30-day refresh cookie and one
retry of the request, as the app always did. Three rules: **one refresh at a time**
(a refresh token is single-use and a replay revokes the whole session, so parallel
requests share a single in-flight refresh), **across tabs too** (Web Locks make tabs
take turns; a `gwc.refreshedAt` timestamp lets the second skip a refresh the first
just did), and **only for `unauthenticated`** — a revoked session, a wrong password
or a 403 are never "renewed". The denylist lifetime (`DENYLIST_TTL_SECONDS` in
`modules/auth/sessions.ts`) is *derived* from the token lifetime, so a revoked
session's token can never outlive its denylist entry; never make it a second number.

**One loader, on both platforms (feature 030, `specs/030-main-loader/`).**
`client/src/components/ui/Spinner.tsx` and `expo-client/.../components/spinner.tsx`
draw the same figure (feature 038, `specs/038-themed-spinner/`): a faint ring and an
arc that grows and shrinks while it turns, 1.5 s a turn and a 3 s cycle, sized
`xs` 14 / `sm` 20 / `md` 32 / `lg` 48, ring 1/12 of the size and never under 2 px.
The web one is a `<span class="gwc-spinner">` drawn by `client/src/styles/spinner.css`
(a conic gradient whose two ends are registered `<angle>` properties). Its colours
are `currentColor` and a 25% `color-mix` of it, and **that file may not contain a
colour literal** (`check-tokens` and `tests/components/spinner.test.tsx`, which reads
the file, enforce it). The app one has no conic gradient to use, so the arc is built
from two clipped half-rings and transforms on the native driver, with the left
half-ring at opacity 0 while it has nothing to draw (its edges would leak hairlines);
its geometry was checked against the keyframes — **never `react-native-svg`**, which
would need a new EAS build. Under reduced motion both **slow to 6 s a turn with a
fixed 158° arc and never stop**, which replaces feature 030's "nothing rotates". Use `PageLoader` /
`ScreenLoader` for a page or screen waiting for data (silent for the first
150 ms, so a fast response never flickers), `Button loading` for a button whose
request is running, and `AsyncButton` / `useAction` when there is no state of
your own. A page that has not received its data must show the loader, **never
nothing and never a false "empty" message**; `client/tests/loading-states.test.tsx`
scans for components that call the API and `return null` while loading, with an
allow-list that needs a reason per entry. `useAction` guards re-entry with a ref
(two presses in one frame start one request) and logs failures the usual way.

**One-time codes carry a purpose, and endpoints redeem only their own.**
`verifyChallenge(…, { purposes })`: `/auth/verify-otp` redeems `login` and
`device_approval`, `/onboarding/*` redeems `mobile_verification` and
`email_verification`. A mismatch answers exactly like a wrong code. A resend
mints a *new* challenge and returns its id — the old id never accepts the new
code.

**Every SMS goes through one gateway, behind a country policy.**
`app.sendOtp` (`decorators/send-otp.ts`) is the only caller of the provider
(`tests/auth/sms-gateway.test.ts` scans `src/` for any other), and it checks
`integrations/sms-country-policy.ts` first. The precedence is fixed:
the sanctions denylist, then the US-only +1 area codes (Canada and the
Caribbean share +1), then the allowlist generated from the business's
accepted-zone list. A refusal is one masked `SMS_BLOCKED_COUNTRY` log line and
a `sms-destination-not-allowed` 422. Registration asks `app.smsDestination()`
before writing any row. The server still issues, hashes and verifies its own
codes, and verification is deliberately **not** gated, so a code sent before
the allowlist narrowed still redeems. `sms-countries.generated.ts` is converted
from another project's build; do not hand-edit it. **In development the code is also printed in the
terminal, and the real SMS is still sent** (the email verification code too, from
`sendMailInstantly`, as `Email (development) code … for …`) (feature 027, `SMS_DEV_LOG`, on by
default when `NODE_ENV=development`, `false` turns it off): a provider refusal —
a seeded member's number is fake — is printed and no longer fails sign-in.
`config/env.ts` refuses to boot in production with it set to true. It sits behind
`app.sendOtp`, so the country policy still applies, and it writes a plain console
line rather than the structured logger (which redacts codes centrally) because
reading the code is its whole purpose; constitution 4.0.0 records that exception.
A laptop `.env` must **not** point `DATABASE_URL` at the production database:
sign-in there texts real members' numbers through the real account.

**A mobile number is checked once, in `@gwc/contracts/mobile` (feature 031).**
`checkMobile(country, typed)` is the rule for the web form, the app and the server
(`registerRequestSchema.mobile` refines with `isValidMobileE164`). The old regex
alone let `+49971585831595` through — right shape, not a number — so the SMS
provider refused it and the server called that an outage. Now a number that does
not exist is `422 invalid-mobile`, a number typed with its country code but no `+`
is read as international (`corrected`, and the field says "Read as …"), and a
landline is refused. A provider 400 naming `destination` also answers
`invalid-mobile`; every other provider fault stays `503` (a retry can work). Test
numbers must be real ones (`uniqueMobile()` builds a valid German mobile): do not
loosen the rule to keep a fixture. `invalid-mobile` is shown on screen as well as
logged, like `mobile-in-use`.

**Mail goes through the outbox, except the email code.** `app.enqueueMail()`
writes `mail_outbox`; the `mail.deliver` job sends with backoff and clears the
row's variables once delivered (they hold reset tokens). Pass `{ client }`
when the mail must exist only if the surrounding transaction commits. The
onboarding email verification code is the one exception: `app.sendMailInstantly()`
sends it inside the `email-send` request and, on any failure, answers 503
`service-unavailable` with **no** outbox fallback — a code delivered late by the
job is already stale, and a queued one sits readable in the table
(`tests/onboarding/email-code-instant.test.ts`). In development mail is logged,
contents included, so onboarding can be finished on a laptop — the same
bargain `seed:demo` makes.

**Requests about listings email the other side (feature 020,
`specs/020-listing-requests/`).** A request is 008's inquiry (one conversation per
member per listing); Messages is the inbox on both faces. `app.notifyMessage`,
called by `notifyAfterCommit` after the message is committed, is the email
scheduler (`messaging/application/notify-mail.ts`): one `messaging.new-message`
outbox email per recipient per conversation, a burst merged into the email still
waiting, the next one scheduled 15 minutes after the last so nothing is dropped.
"Waiting" means `mail_outbox.next_attempt_at` still equals
`message_mail_schedule.last_scheduled_for` — written by one statement, compared
for equality, because `mail.deliver`'s lease moves it and merging into an email
being sent would lose the message. No email to locked, suppressed or
address-less recipients or across a block (which also refuses a new request,
answering like a lapsed owner). Mails are German then English and say replies
are not read; every mail carries `Auto-Submitted`.

**Member events are `/member/events`, not `/events`.** `/events` is the
public, indexed page surface; member JSON with prices and seat counts must not
inherit its crawl posture. Capacity is still the trigger's job, and a cancelled
registration (a timestamp, never a DELETE) holds no seat.

**Threads are never edited, by anyone.** The `thread_posts` trigger refuses a
changed body and makes `removed`/`deleted` final. Hidden, removed, deleted,
locked-author and absent posts all answer the same 404.

**Threads and profiles, completed (feature 010, `specs/010-threads-profile/`).**
Five things that look optional and are not:

- **Media is attached only in the transaction that creates the post.** The
  `thread_post_media` insert trigger compares the post row's `xmin` to the
  current transaction, and UPDATE/DELETE are refused outright. There is no
  attach endpoint on purpose: posts are immutable, so attaching later would be
  an edit. `compose.ts` is the one write path; a seeder must insert a post and
  its media in one transaction too (and never inside a SAVEPOINT).
- **`VISIBLE_POST` in `threads/application/threads.ts` is the single
  visibility rule** — state, author visibility and blocks in both directions.
  Quotes, replies, profile tabs, Activity and mention resolution all use it; a
  second copy is how a hidden post comes back through a side door.
  `AUTHOR_COLUMNS` is likewise the only place member columns are selected for
  Threads, and `tests/ops/no-pii-in-social.test.ts` scans every route for
  contact details, legal names, fee tiers and storage keys.
- **A quote of a post that is no longer visible is a tombstone,
  `{ unavailable: true }`, never a snapshot.** Nothing of the quoted post is
  sent.
- **Activity is computed on read** from likes, posts, reposts, mentions and
  follows; only `member_activity_cursor` is stored, and it only moves forward.
  Push notifications are persisted (below); Activity is not, and the two are
  not the same record. In the app, Activity (`profile/activity.tsx`) is the one
  screen for your Threads: **Interactions** (this feed, opened first) and your own
  posts in the four tabs Threads, Replies, Media and Reposts, which used to be on
  Profile (feature 039). Another member's profile keeps its own four tabs.
  Every tab's stack draws its own header (`components/app-header.tsx`, via the stack's
  `header` option, `renderAppHeader`): the title on the left, the club's emblem in the
  middle, the screen's `headerRight` on the right. It has to, because iOS cannot
  left-align a native title (`headerTitleAlign` is "not supported on iOS"); a new tab's
  `_layout.tsx` must set it too, or that tab quietly keeps the native header. A screen's
  actions are not text buttons in the header but rows of `HeaderMenu`
  (`components/header-menu*.tsx`), the three dots and the platform's own drop-down through
  `@expo/ui`: SwiftUI's `Menu` on iOS (`.ios.tsx`) and the drop-in `MenuView` on Android
  (`.android.tsx`), with `header-menu.tsx` the fallback that draws nothing — Marketplace has
  Messages, My listings and New listing. A screen with only **one** action does not use the dots:
  Threads' New post is a plain `HeaderIconButton` (`components/header-icon-button.tsx`, AntDesign
  `plus`, the dots' 40 x 44 tap area and tint), because a one-row drop-down is a tap more than the
  action needs; give a screen a second action and it moves behind `HeaderMenu`. Rows are data
  (`HeaderMenuItem`). The dots are one drawing on both platforms, `MenuIcon` (Entypo's
  `dots-three-vertical` from `@expo/vector-icons`). On iOS it is laid *over* the menu, never put
  in its label with `RNHostView`: the `Menu`'s label is an invisible native `Image` at
  `opacity(0)` (never `hidden()`, which cannot be tapped) framed to the dots' 40 x 44 box, and the
  icon is a `pointerEvents: 'none'` sibling above it. Hosted, the menu opened over the dots and the
  dots moved when tapped. With the label exactly their box the system still opened its menu over
  the dots, and `@expo/ui` has no placement option and no way to open an iOS menu by code, so
  feature 040 makes one native-only attempt (`ANCHOR_EXTENSION` in `header-menu.ios.tsx`, 12
  points): the invisible label reaches that far below the header so the system may anchor its
  menu lower. **Untested on a phone** (task T007 of `specs/040-menu-below-header/`); `0` is
  exactly the behaviour before it, and if it does not help set it to 0 and do not draw a menu of
  our own. On Android the dots are a button (`MenuDots`) that calls `ref.show()` on a `MenuView`
  whose child is a `MENU_BUTTON.width` x 1 strip along the bottom edge of a slot as tall as the
  bar, so the Material menu opens at the header's bottom edge: Compose opens a `DropdownMenu` at
  the bottom edge of its anchor, and the anchor is `MenuView`'s child at its own size, so it needs
  a width as well as a height. Draw no pop-up of our own.
  The Marketplace stack opens every pushed screen with the platform's own transition
  (`PUSH_ANIMATION` in its `_layout.tsx`: `default`, which on Android 13 and later is a short
  slide with a fade; only Android 12 and earlier gets `slide_from_right`, because their
  `default` is a zoom), so a screen there sets no `animation` of its own.
- **`organisation_profiles` is the only member-visible projection of an
  organisation.** `organisations` holds contract data (`legal_name`,
  `fee_tier`); no member route reads it. Organisation users upload logos at
  `POST /media/{merchant,partner}` — one route per audience, same pipeline.

Influencers are members with a row in `member_designations` (staff-granted,
audited, never deleted), not a fifth audience. A handle is required to post
(`403 handle-required`) and changes at most every 30 days; ended members keep
theirs. The avatar lives in `member_avatars`, not on `members`, so the media
test reset's `TRUNCATE assets … CASCADE` cannot reach the members table.

**Push notifications are an outbox (feature 011, `specs/011-push-notifications/`).**
No request sends a push. A staff send inserts a `push_notifications` row and
returns `202`; the `push.deliver` job sends it, kicked at once through pg-boss
(`push.dispatch`, whose only action is `runJob('push.deliver')`) and swept every
minute. Disabling `push.deliver` stops every send path. Five rules:

- **`ELIGIBLE_DEVICE` in `push/application/audience.ts` is the single audience
  rule** — device enabled and not dead, member active, application approved or
  absent, test list or preference. The confirm dialog's count, materialisation
  and the per-batch re-check all import it; a second copy is how the number
  staff confirm stops matching who gets it.
- **At most once per device.** `push_deliveries` is unique on
  (notification, device), a claim moves `pending → sending` in the same
  statement, and only a *provable* refusal (429/5xx, no connection, open
  breaker) goes back to `pending`. A row left in `sending` past the lease is
  failed as `outcome unknown` and never resent — a missed notification beats a
  phone buzzing twice.
- **Offers announce themselves by trigger** (`029_offer_push_trigger.sql`) on
  the transition to `published`, once per offer (`idempotency_key =
  'offer:'||id`), held until `valid_from` and cancelled at dispatch if
  `VISIBLE_OFFER` no longer holds. The demo seed sets `SET LOCAL
  gwc.suppress_offer_push = 'on'`: seeded offers were never announced, and
  `push_notifications` / `push_deliveries` are never seeded.
- **The app registers Expo tokens only**, once the session is `member`; the
  device routes carry no `onboarding` flag, so an applicant is refused
  server-side. A token belongs to one member (`UNIQUE (token)`), and sign-out
  deletes the devices of the session it revokes.
- **The FCM service-account key lives in EAS credentials and nowhere else** —
  never in the repo, the app or `server/`. `EXPO_ACCESS_TOKEN` is required in
  production; FCM settings are all or none. A token is never logged, returned
  or copied into history: `tokenPreview` is all anyone sees.

**Merchant stores, offers and redemptions (feature 035, `specs/035-merchant-store-offers/`).**
A merchant organisation has one store; its offers sit under staff-managed categories;
any active account redeems them. Seven things that look optional and are not:

- **One store per organisation is the database's rule** (`stores.organisation_id
  UNIQUE`), so two simultaneous creates cannot both win. A store is switched off by
  staff with `PUT /admin/stores/:id/active` (`false` or `0`, a reason required to
  switch off, `merchant_offers.status`) and never deleted.
- **`VISIBLE_OFFER` is the one rule for "an account may see this offer"** and now
  includes the store: browse, detail, redeem, the push dispatch and the landing strip
  all use it, so a switched-off store's offers vanish on the next request. Anything
  using it must use `OFFER_JOINS` too.
- **Media is bounded in the database and by the server.** An offer holds at most ten
  images or videos and a store gallery at most ten (`position BETWEEN 0 AND 9`); the
  store cover is separate, one image about 16:9. What a merchant uploads is held to a
  photo under 1 MiB and a video under 5 MiB (`MERCHANT_*` in `@gwc/contracts/media`),
  decided after content inspection; members and partners keep 25 MB. A merchant can
  delete a file nothing uses (`DELETE /media/merchant/:id`; in use is 409).
- **Publishing sets the state and nothing else.** There is no approval step. The one
  announcement to members is queued by the `offers_queue_push` trigger, keyed
  `offer:<id>`, so withdrawing and publishing again never notifies twice. **Never
  queue a notification from application code**: a second path would not share the key.
- **A redemption is an append-only ledger row**, redeemed by a `(kind, id)` — member,
  `admin`, merchant or partner — with no foreign key (an insert trigger checks the
  account exists and is active). It is exact under an offer-row lock, idempotent by the
  client's `requestId`, and a merchant cannot redeem its own organisation's offers.
  `remaining` counting down does not move the offer's edit version.
- **Reports take their scope from the route, never the request.** A merchant's report
  ignores any `organisationId` in the query; only `/admin/reports/redemptions`
  (`merchant_offers.read`) honours it. Who redeemed is a handle, "First L." or a display
  name — never contact details (`tests/redemptions/report-no-pii.test.ts`).
- **The landing strip is read live and only shows the public face.** `/` and `/en`
  carry `<!--gwc:partners-->…<!--/gwc:partners-->`; it lists active partners and
  merchants whose store is on, by name and logo, with no script, and is omitted when
  empty. A partner is linked only if it has a published `seo_metadata` page; a merchant
  never, because its store is members-only. The anonymous page keeps `PUBLIC_CACHE` and
  gets no `Vary: Cookie`.

**Profiling is the second onboarding gate (feature 013, `specs/013-onboarding-profiling/`).**
An approved applicant is refused on every route except those declaring
`config.auth.profiling: true` until `member_profiling.completed_at` is set. Two
rules that look optional and are not:

- **Completion is `POST /profiling/submit`, never a `PATCH`.** `PATCH /profiling`
  only saves, so a member can go back and change any answer until they confirm
  on the review step. Which questions apply, their order and what is still
  unanswered come from `profilingSteps` / `profilingMissing` in
  `@gwc/contracts/profiling`, used by the server's submit check and both clients;
  a second copy of that order is how a client and the server come to disagree
  about "done". Changing an earlier answer deletes the answers that no longer
  apply (kids, partner, the previous Q7 path's follow-ups) in the same
  transaction.
- **The partner answers Q2–Q5 only** (languages, qualification, occupation,
  income). Settling is the member's own question: `partner` on the PATCH body is
  strict, so a settling key is a 400, and `profilingSteps` has no
  `partner-settling*` step. A partner question is added or removed there and
  nowhere else.
- **A non-German member's GWC match is stored when the cities are saved, not at
  submit**, because it decides whether Q6 is asked at all (no match: review
  straight after the cities). The city lists are `world_cities` (the InterNations
  workbook, 160 countries) **and** `gwc_cities` read together — the workbook
  omits three designated emirates — and a country neither covers takes free text.
- **`member_profiling_kids` and `member_profiling_partner` are final with their
  parent, by trigger.** Deletes are allowed only while the parent is
  incomplete — that is how the cascade above works — and after completion even
  an ad-hoc `DELETE` is refused. The elsewhere branch's GWC match and outcome
  are computed at submit from the cities as saved, not when they are entered.

**Referral links and XP (feature 018, `specs/018-referral-xp/`).** Everybody who
can sign in — member, merchant user, partner user, staff — has one personal link,
`/r/<code>`, created on first read of Refer & earn. XP is to become real money,
so it is treated as money already. Six rules that look optional and are not:

- **A referral is recorded at mobile verification, never at `register`.**
  `/onboarding/register` only resolves the code into
  `membership_applications.pending_referral_link_id` (the last code before
  verification wins); `verifyMobile` records the referral *and* its award in
  the transaction that sets `mobile_verified_at`, and only when that update is
  the one that set it. Register creates the account before any proof —
  recording there pays XP for any number typed into the form. The link and its
  owner are re-checked at that moment, and the owner's own email or mobile
  credits nobody (silently, audited as `referral_refused`).
- **The ledger is append-only by trigger, and no balance is stored.**
  `referrals`, `xp_entries` and `referral_xp_rates` refuse UPDATE and DELETE
  (`040_referrals.sql`); one referrer per person, one award per referral and
  one reversal per award are unique constraints. A balance is
  `SUM(amount)`. A correction is a reversal entry; a new rate is a new row, and
  an award copies the amount in force. Tests empty these tables only through
  `resetReferrals` (TRUNCATE, which fires no row trigger).
- **Stages are computed on read** from `membership_applications` and
  `member_profiling` (`application/read-model.ts`). XP never moves with a
  stage. `REFEREE_NAME` is the only referee field that reaches a referrer —
  handle or "First L." — and `tests/referrals/no-pii.test.ts` guards it.
- **Every code that credits nobody is one identical 404** — malformed,
  unknown, replaced, disabled, owner locked. `resolveActiveLink` returns `null`
  for all of them and nothing may tell them apart, on `/r/` or through
  registration, whose response never changes with a code. Clients never look a
  code up.
- **`/r/<code>` is lower case, English at `/r/<code>/en`.** `/r` is a public
  surface, and `03-canonical-origin` lower-cases public paths and strips unknown
  query parameters — `?lang=en` cannot work there. Never indexed, `no-store`,
  `no-referrer`, no script. `/.well-known/*` claim `/r/*` only.
- **Staff never act on their own records.** Every staff member earns XP, so
  `/admin/referrals/me` is `anyStaff` (the pinned exemption list in
  `tests/authz/matrix.test.ts` grew for it), while reversing, disabling and the
  rate are the `referrals` module (`status`, `status`, `edit`) and refuse the
  actor's own link or entry with 403.

Opening a link *in the app* is native configuration (`associatedDomains`,
`intentFilters` from `EXPO_PUBLIC_LINK_HOST`, plus `expo-clipboard`): it needs a
new EAS build, and Android also needs `ANDROID_APP_CERT_SHA256` on the server.
Until then the landing page and a typed code still work.

**Server faults are recorded, not just logged (feature 012,
`specs/012-error-persistence/`).** A request the error handler answers with the
generic `INTERNAL` problem also leaves a row in `server_faults`, keyed on the
request id the member was shown. Six rules:

- **Request ids are always the server's.** `genReqId` returns a monotonic ULID
  and ignores every inbound header. A client's own `x-request-id` is kept as
  `clientRequestId`: echoed on `x-client-request-id`, bound into every log line
  through `childLoggerFactory` (a hook rebinding `request.log` would miss
  Fastify's own request lines), stored on a fault record — never the id
  `audit_log` or `server_faults` is keyed on. Both patterns live in
  `@gwc/contracts/request-id`.
- **`INTERNAL`, not `status >= 500`.** Every deliberate 5xx (load shedding, an
  open breaker, a passed deadline) has its own problem type; storing those would
  flood the table during the outage they describe.
- **Recorded after the answer is decided, never awaited.** `app.recordServerFault`
  never throws, holds at most two pool connections, stores at most
  `SERVER_FAULTS_PER_MINUTE` rows per instance and counts the rest in
  `server_fault_suppressions`. A dead database changes nothing about the
  response (`tests/server-faults/db-down.test.ts`).
- **An allowlisted shape, scrubbed.** The recorder never sees `request` or the
  error object: route pattern not URL, no bodies, headers or query strings, and
  `message`/`stack` pass through `ops/scrub.ts`. Driver fields like pg's
  `detail` (which echoes values) are never copied.
- **Immutable, with a 30-day delete floor, both by trigger.** Only
  `server-faults.prune` removes rows; even an ad-hoc `DELETE` cannot touch a
  fresh one. The tables sit under `HISTORY` in `seed/tables.ts` and get no rows
  (`NEVER_SEEDED` is for live credentials only).
- **Read-only access on `server_faults.read`** — the console's Fehlerprotokoll
  and two GET routes. No staff action edits or deletes a record.

**Clients report failures to the console, not on screen.** In both the web
console (`client/`) and the Expo app, a catch logs
`console.error('<Component>.<function>', error instanceof ApiError ? error.problem : error)`
and stores nothing: there is no `problem`/`error` state holding a server
refusal, and no pop-up showing one. Info goes to `console.log`, including one
line per API request in the Expo client (`src/api/client.ts`: method, path,
status, timing and the server's request id — never headers or bodies, which
carry tokens). This is plain `console.*` with no `__DEV__` guard, so release
builds log too. What survives in state is only what changes behaviour: a local
form check (a missing alt text, a photo permission), a flag that stops a
spinner or keeps sign-out reachable when a screen cannot load, a retry flag, and
the redirects a refusal triggers (`needsSignIn`, `HANDLE_REQUIRED`).
Exceptions that are shown as well as logged, because the person cannot proceed
without knowing why: the web sign-in refusal (translated from the problem
`type` by `describeProblem`), and `email-in-use` / `mobile-in-use` on the
registration step-3 contact change.

**Offer media, the fallback image and search (feature 042,
`specs/042-offer-media-and-search/`).** Six things that look optional and are not:

- **"The picture an offer leads with" is `LEAD_OFFER_ASSET`, in
  `offers/application/offer.ts`: the first item whose asset is `ready`.** The list
  card, the detail's `media[0]` and a redemption's thumbnail all use it. It used to be
  written three times as "position 0, whatever its state" while the detail dropped
  unready assets, so a first video still processing showed no card picture and a
  different first picture on the detail. A second copy is how that comes back
  (`tests/offers/lead-media.test.ts`).
- **The API never substitutes a stand-in for a missing picture.** `thumbnail: null`
  and `media: []` mean "no usable media" and the *clients* draw the club's fallback
  (`offer-fallback.webp`: bundled in `client/src/assets/` and the app's `assets/`,
  byte-identical, `tests/assets/fallback-parity.test.ts`) in the 16:9 frame from
  `OFFER_MEDIA_ASPECT`. A server-side fake item would break "success never carries
  fallback content" and would stop a merchant's editor seeing that they have no photo.
  A picture that fails to load gets the fallback too (`OfferPicture`, both clients).
- **`OfferGallery` (app) measures its own container with `onLayout`; it never
  subtracts an inset from the window width.** That was the bug: `MediaCarousel` assumed
  one padding and `FormScreen` used another. `MediaCarousel` is Threads', quote embeds',
  listing detail's and the store gallery's, with each file's own ratio, and is not to be
  changed for offers; they share only `MediaSlide` (poster until tapped, muted, one player
  per slide).
- **Choosing the main media is `PUT /merchant/offers/:id/main-media` and
  `PUT /admin/offers/:id/main-media`, one function, `setMainMedia`.** It moves one
  existing file to the front under the offer's row lock, never "replace the whole set"
  (a stale tab would drop files), and is a no-op, unaudited, when it already leads. The
  staff door declares `merchant_offers.edit` and the handler narrows it to a super admin
  (the dashboard figures' pattern). **`audit_log.actor_kind` is the `account_kind` enum:
  a staff account is `'admin'`, never `'staff'`.**
- **The staff merchant-offers list is at `/konsole/admin/angebote-entdecken`.**
  `/konsole/admin/angebote` is marketplace moderation; with both on one path the router
  takes the first and the offers list was unreachable.
- **`q` is a text search, ANDed on after visibility and never in place of it.** Bounds
  are `@gwc/contracts/search`; matching is `pg_trgm` partial GIN indexes and `ILIKE`
  (`server/src/db/text-search.ts`), case-insensitive, inside a word, every word required,
  accents not folded, recency order and the same cursors. **`q` must stay in the
  marketplace controller's `RESERVED` set**, or it is read as a category filter and
  answers 400. The text is masked in the server's request log (`maskSearchQuery`) and the
  app's (`redactQuery`): a person can type a name or a phone number. The worst case is a
  two-character term matching nothing, a sequential scan, about 71 ms at 50,000 listings
  and linear (`bench:search`, research R11). The app's search box lives *outside* the
  `loading ? <Loading/> : <FlashList/>` swap, or it unmounts on every keystroke.

## Conventions

- ES modules, Node 22. The server is TypeScript (`.ts`, run by Node's type stripping, checked by `tsc --noEmit`).
- Errors are RFC 9457 problem+json. Clients branch on `type`, never on `detail`.
- Comments explain **why**, especially where the obvious implementation is
  wrong. If a line looks odd and the reason is not next to it, add the reason.
- Tests assert behaviour, not implementation, and carry a counter-assertion
  wherever a test would otherwise pass against a server that did nothing.
- Styles in the Expo app live in `StyleSheet.create` (feature 036,
  `specs/036-expo-stylesheet/`), never as an object literal in JSX. Colours that
  come from the theme go through `useThemedStyles(makeStyles)`
  (`src/hooks/use-themed-styles.ts`), because `StyleSheet.create` runs once at
  module load and cannot see light or dark mode; a value that comes from props
  (an avatar's size) gets a small `useMemo(() => makeSized(size), [size])` sheet.
  An ESLint rule (`no-restricted-syntax`, an error) rejects an inline style
  object; the only exception is an `Animated` value, with a disable comment
  giving the reason. In a file that imports `styles` from `@/components/ui`, the
  local sheet is `styles` and the import is `uiStyles`.
- A web page's outcome message is brought into view (feature 041,
  `specs/041-scroll-to-form-message/`): the `FormMessage` or `Callout` a page shows after a
  save sits at the top of the page, and a person who pressed Save at the bottom of a long form
  never saw it. `useReveal(message)` (`client/src/lib/useReveal.ts`) returns a ref that goes on
  the message element, and calls `scrollIntoView({ block: 'nearest' })` on it one animation
  frame after the value changes to something truthy: `nearest` does nothing when the message is
  already fully in view, it eases unless the person asked for reduced motion, and it never moves
  focus (`FormMessage` is `role="alert"`, so it is announced anyway). Four rules that look
  optional and are not. **Give it the page's own message value, which must change on every
  outcome**: a new object per `setMessage({...})`, or a flag that is reset before the next
  success. It keys on the value and not on the message mounting, because Offer categories keeps
  its message on screen between two saves and a second save with the same words mounts nothing.
  **Call it above any early `return <PageLoader />`**, like every hook. **Give the ref to the
  message itself**, never a wrapper `div`, which would change the page's `gap-6` spacing;
  `FormMessage` and `Callout` take `ref` as a prop (React 19) and carry `scroll-my-6` for the gap
  at the window's edge. **It runs one frame late on purpose**: in Marketplace the same commit
  closes the drawer, which then returns focus to the New listing button, and that scrolls the
  page too; a layout effect would be overtaken. The hook reveals whatever the page puts in the
  slot, so a refusal shown there (a stale edit, a taken slug) is revealed like a success;
  `message?.tone === 'success' ? message : null` limits it. jsdom has no `scrollIntoView` or
  `matchMedia`, so both are called defensively and tests use `installScrollSpy`
  (`client/tests/helpers/scroll-spy.ts`). `client/tests/outcome-reveal-guard.test.ts` fails the
  build for a file that shows a success-toned message and never calls the hook, and for a hook
  whose ref reaches no element; it cannot see a `Callout`-only outcome, so a new page like
  Marketplace's or Push's goes on its list of pages by hand. Not covered, on purpose: forms that
  confirm nothing on screen today (staff moderation, applicant decisions, referral changes, the
  store switch, and the **handle change** on Edit profile) and in-place confirmations that
  replace the control the person just pressed.
