# Quickstart: GWC Web Console

**Feature**: 003-web-console

How to run the console and prove each user story end to end. Shapes and rules live in
[`data-model.md`](./data-model.md) and [`contracts/`](./contracts/); this file is the run guide.

## Prerequisites

- Node 22, PostgreSQL, Redis — as feature 002 already requires.
- `server/.env` populated. `DATABASE_URL` is mandatory; without it the SQL suites skip loudly and
  none of the scenarios below can run.
- Accounts already exist. **This feature never creates one** (FR-002). Seeding provides them.

```bash
npm install
npm run -w server migrate
npm run -w server seed:dev
```

## Run

```bash
npm run -w server dev      # API on :3000
npm run -w client dev      # Vite on :5173, proxying /auth, /admin, /media, /push, /health to :3000
```

Open the Vite origin, not `:3000` — the landing page links to `/konsole/anmelden` and the dev
server serves the console there.

**Both origins do the same two jobs, by different means**, and the console is unreachable without
each:

| | Production (`:3000`) | Development (Vite) |
|---|---|---|
| `/konsole/*` serves the console shell | `server/src/app.js` SPA fallback (research R9) | `consoleFallback()` in `client/dev-server.js` |
| API on the same origin as the page | it *is* the API | `apiProxy()` in `client/dev-server.js` |

The production fallback is needed because `@fastify/static` is registered `wildcard: false`, so
every deep link and refresh would otherwise 404. The Vite one is needed for the opposite reason:
Vite's default `appType: 'spa'` answers *every* unmatched path with `/index.html`, so `/konsole/…`
silently served the landing page and `/auth/…` served HTML to a JSON client. Same-origin matters
because the session is a cookie — point the console at `:3000` directly and the cookie is set for
an origin the page is not on, so it never comes back.

`client/tests/dev-server.test.js` boots a real Vite server and follows the landing page's own
links, because the failure mode here was middleware ordering and nothing short of a real server
catches that.

## Seed accounts

`seed:dev` must provide one account per principal kind and per grant shape the scenarios need:

| Account | Kind | Grants |
|---|---|---|
| `seo@test.invalid` | staff | `seo.read`, `seo.edit` — and nothing else |
| `reader@test.invalid` | staff | `seo.read` only |
| `push@test.invalid` | staff | `mass_messages.read`, `mass_messages.write` |
| `nogrants@test.invalid` | staff | none |
| `super@test.invalid` | staff | superadmin |
| `member@test.invalid` | member | active |
| `merchant@test.invalid` | merchant | `owner` of an active merchant organisation |
| `partner@test.invalid` | partner | `owner` of an active partner organisation |

`nogrants@test.invalid` is not filler. It is the counter-assertion for the whole capability
mechanism: a console that renders a full sidebar for an account holding nothing has a defect that
no positive test would catch.

## Scenario 1 — Capability-scoped navigation (User Story 1)

1. Sign in as `seo@test.invalid` at `/konsole/anmelden`.
2. **Expect**: the Admin Panel sidebar offers SEO. It does not offer Members, Events, Billing or
   Rollen & Rechte.
3. Navigate directly to `/konsole/admin/rollen`.
4. **Expect**: the server refuses with problem+json `INSUFFICIENT_PERMISSION`; the console shows
   the refusal and re-fetches capabilities. It does not show a blank screen or a partial one.
5. Sign in as `nogrants@test.invalid`.
6. **Expect**: an explicit empty state. Not an error, not a blank page, not a full sidebar.
7. As superadmin, revoke `seo.edit` from `seo@test.invalid` while their session is open. In their
   window, reload the SEO screen.
8. **Expect**: the editing controls are gone and a submitted change is refused. The grant took
   effect on the next request, not at token expiry.

**Verifies**: FR-003, FR-004, FR-016, SC-002.

## Scenario 2 — SEO editing under read vs. edit (User Story 2)

1. Sign in as `seo@test.invalid`. Open a seeded published page's SEO record.
2. Change the meta description, save.
3. **Expect**: `GET` the public page — the new description is in the served HTML.
4. Sign in as `reader@test.invalid`, open the same record.
5. **Expect**: values are visible, no field is editable, and no save control is rendered — absent,
   not disabled (FR-017).
6. With that session, `PATCH /admin/seo/...` directly.
7. **Expect**: refused. The counter-assertion that step 5 is a real posture and not just styling.

**Verifies**: FR-017, FR-021, SC-003.

## Scenario 3 — Push campaign (User Story 3)

1. Sign in as `push@test.invalid`. Compose a campaign.
2. Preview against the seeded test recipients.
3. **Expect**: the console shows the rendered notification and the recipient count **the server
   computed** — not one the client counted.
4. Send. Confirm the confirmation step appears first (FR-020).
5. Force a quota refusal by exceeding the seeded limit.
6. **Expect**: the console does not offer a retry. Contrast with a 429, which does.

**Verifies**: FR-019, FR-020, SC-003.

## Scenario 4 — Member profile and field visibility (User Story 4)

1. Sign in as `member@test.invalid` at `/konsole/mitglied`.
2. Edit the profile, including "Ich kann helfen bei" and "Ich suche". Save.
3. Mark the company field private.
4. As a second member, fetch that profile **over the API, not in the browser**.
5. **Expect**: the company field is **absent from the JSON**. If it is present and merely unrendered,
   the requirement is not met (FR-034).

**Verifies**: FR-033, FR-034, FR-035.

## Scenario 5 — Merchant offer through approval (User Story 5)

1. Sign in as `merchant@test.invalid`. Create an offer with a regular price and a member price.
2. Try a member price **above** the regular price.
3. **Expect**: refused by the database constraint, not by the form alone — the design document's
   merchant rule 1 (*"echter Vorteil - nicht Normalpreis als Rabatt etikettieren"*).
4. Submit a valid offer for approval. As `member@test.invalid`, browse benefits.
5. **Expect**: the offer is **not** visible.
6. As staff holding `marketplace_moderation.status`, open the queue.
7. **Expect**: the member-facing preview, not a raw form. Approve it.
8. As the member, browse benefits again.
9. **Expect**: visible, with regular price, GWC price, validity, locations and conditions all shown.
10. Set `valid_until` into the past.
11. **Expect**: it disappears from active surfaces with no staff action and no scheduled job.
12. As the merchant, open Analytics and capture the raw responses.
13. **Expect**: no identifiable member data in any of them (FR-031, SC-008).

**Verifies**: FR-023, FR-025, FR-026, FR-027, FR-028, FR-031.

## Scenario 6 — Partner entitlement (User Story 6)

1. Sign in as `partner@test.invalid`. Invite an employee.
2. **Expect**: an entitlement exists and **no row was added to `members`** — check the table
   directly. This is FR-030 and it is the assertion most likely to regress.
3. Activate it. Confirm benefit access; confirm no membership tier anywhere in the response.
4. Invite past the contracted `employee_count`.
5. **Expect**: refused as a quota — exact under concurrency, under a row lock, not a rate limit.
6. Publish a vacancy; confirm it awaits approval before any member sees it.
7. Open Analytics.
8. **Expect**: aggregate figures only; no employee individually identifiable.

**Verifies**: FR-029, FR-030, FR-031.

## Scenario 7 — Governance and audit (User Story 7)

1. Submit content as both merchant and partner.
2. As staff, request changes on one with a comment; reject another; approve a third.
3. Reopen the changed one as the organisation.
4. **Expect**: the comment and the previous version are both visible.
5. Read the audit log for all three decisions.
6. **Expect**: actor, timestamp, decision and the **version decided on** — not "the latest".
7. Attempt to `UPDATE` and `DELETE` an audit row as the application's database role.
8. **Expect**: both refused by revoked grants, not by application code (SC-009, Principle IV).

**Verifies**: FR-023, FR-024, SC-009.

## Automated gates

```bash
npm test                          # every workspace
npm run -w client test            # component, capability-matrix, a11y
npm run -w server test            # authz matrix, posture, startup gates
npm run -w client test:tokens     # SC-005: no colour outside the token set
npm run -w server verify:seo      # crawl posture, incl. noindex on /konsole/*
```

| Gate | Criterion | Counter-assertion it must carry |
|---|---|---|
| Capability matrix | SC-002 | renders for a holder **and not** for a non-holder |
| Refusal handling | SC-003 | every under-privileged action surfaces a refusal, never a broken screen |
| No-registration | SC-004 | no sign-up, application or approval-of-new-account route is reachable |
| Token purity | SC-005 | a deliberately hard-coded hex fails the build |
| Accessibility | SC-006 | zero `axe-core` violations on light surfaces **and** dark chrome |
| Merchant/partner leakage | SC-008 | no identifiable member data in any response to either kind |
| Crawl posture | SC-010 | `/konsole/*` is `noindex`; no member content reaches an anonymous requester |
| Responsive | SC-011 | no horizontal scroll at 320px on every screen |

A test that would pass against a console that rendered everything to everyone is not a test. Each
gate above carries its negative half for that reason — the repository's existing convention, and
the reason the `nogrants@test.invalid` account exists.
