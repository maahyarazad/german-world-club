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
foreign key to listings, and the application enforces that reference. Four
rules that look optional and are not:

- **Ownership refusals are 404, never 403**, and indistinguishable from an
  absent id (status, body and headers — `tests/marketplace/ownership.test.ts`).
  `marketplace_post` gates *creating* a listing, not managing one you already
  have: a member whose flag was revoked can still withdraw what they posted.
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

**A message is persisted before anyone is told about it.** `converse.ts`
commits first and notifies after, never inside the transaction, so a failed
push cannot roll back a message the sender was told was accepted
(`tests/messaging/persist-before-notify.test.ts`). **Real-time transport is a
later feature.** Delivery is on read today: there is no `delivered_at` or
`read_at`, and no WebSocket. They arrive together with the transport that can
actually set them, not as columns nothing writes.

The demo seed's marketplace corpus follows the history rule like everything
else: a sold, filled or withdrawn listing gets the owner's state-change entry
at its own `state_changed_at`, a hidden one the moderator's, and an expired one
the `marketplace-expiry` job run that moved it. Nothing else gets history.

**Mobile onboarding is gated by approval, not invitation** (feature 009,
`specs/009-expo-client/spec.md`). Registration is open; a row in
`membership_applications` that is not `approved` makes 10-auth refuse that
member on *every* route and every face — web included, because device approval
alone would let an applicant with a confirmed email walk in through a browser.
Members with no row (invited, legacy) are untouched. The only routes an
applicant reaches are those declaring `config.auth.onboarding: true`, which
11-rbac accepts on member routes only. Sign-in gives an unapproved applicant a
token solely on the device they applied from, by SMS, so they can resume.

**One-time codes carry a purpose, and endpoints redeem only their own.**
`verifyChallenge(…, { purposes })`: `/auth/verify-otp` redeems `login` and
`device_approval`, `/onboarding/*` redeems `mobile_verification` and
`email_verification`. A mismatch answers exactly like a wrong code. A resend
mints a *new* challenge and returns its id — the old id never accepts the new
code.

**Mail goes through the outbox, never inline.** `app.enqueueMail()` writes
`mail_outbox`; the `mail.deliver` job sends with backoff and clears the row's
variables once delivered (they hold codes and reset tokens). Pass `{ client }`
when the mail must exist only if the surrounding transaction commits. In
development queued mail is logged, contents included, so onboarding can be
finished on a laptop — the same bargain `seed:demo` makes.

**Member events are `/member/events`, not `/events`.** `/events` is the
public, indexed page surface; member JSON with prices and seat counts must not
inherit its crawl posture. Capacity is still the trigger's job, and a cancelled
registration (a timestamp, never a DELETE) holds no seat.

**Threads are never edited, by anyone.** The `thread_posts` trigger refuses a
changed body and makes `removed`/`deleted` final. Hidden, removed, deleted,
locked-author and absent posts all answer the same 404.

## Conventions

- ES modules, Node 22, no TypeScript in the server.
- Errors are RFC 9457 problem+json. Clients branch on `type`, never on `detail`.
- Comments explain **why**, especially where the obvious implementation is
  wrong. If a line looks odd and the reason is not next to it, add the reason.
- Tests assert behaviour, not implementation, and carry a counter-assertion
  wherever a test would otherwise pass against a server that did nothing.
