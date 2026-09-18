# Phase 0 Research: GWC Web Console

**Feature**: 003-web-console | **Date**: 2026-09-17

Every decision below was taken against the code as it actually stands on `002-server-platform`,
not against the design document's aspiration. Where the two disagree the disagreement is recorded,
because that gap is most of this feature's work.

---

## R1. Where the design system actually comes from

**Decision**: Derive the token set from the rendered mockups, not from the document's styling.

The `.docx` carries Office defaults in `word/theme/theme1.xml` — Calibri, Cambria, the stock
`4F81BD` accent ramp. None of it is the GWC design. The design lives in thirteen embedded PNGs:
one logo and twelve full-page mockups at 1475×950. Sampling every pixel of the twelve mockups
produces an unusually clean palette, which is itself evidence the mockups were generated from a
token set rather than hand-painted:

| Token | Value | Observed use | Pixel share |
|---|---|---|---|
| `surface` | `#FFFFFF` | cards, sheets | 10.5M |
| `ground` | `#F7F8FA` | page background, KPI tiles | 1.97M |
| `ink` | `#171B20` | portal sidebar, dark hero panels | 1.36M |
| `navy` | `#0A2457` | brand primary, KPI numerals, primary CTA, mobile headers | 432k |
| `gold-tint` | `#FFF7E4` | callout backgrounds | 247k |
| `gold` | `#D49626` | accent rule, secondary CTA, active-nav marker | 137k |
| `hairline` | `#D9DEE4` / `#E6E9ED` | card borders, table rules | 106k |
| `navy-2` | `#1E4C7C` | secondary blue, chart fills | 26k |
| `success-tint` | `#EAF7EF` | "freigegeben" pills | 25k |
| `info-tint` | `#EAF2FC` | informational pills | 12k |

Three colours appear in the document's own run properties rather than the artwork, which fixes
their text-safe variants: `#A96B08` (gold used as text — the `#D49626` artwork value fails AA on
white), `#626A73` (muted body text), `#0A2457` (confirming the navy above).

**Rationale**: The mockups are the only authoritative artefact. Reading the theme XML would have
produced a generic Office palette with none of the brand in it.

**Alternatives considered**: Extracting from the logo PNG — rejected, the logo's gold is a gradient
over black and yields no usable UI ramp. Asking for a brand style guide — no such file is in the
repository.

**Structural rule**: The document is explicit that *"Gold nur als gezielter Marken- und
Aktionsakzent"*. Gold's pixel share is 1.0% against navy's 3.2% and white's 76%. The token set must
make that ratio easy to keep, so gold is exposed only as `--color-accent` and `--color-accent-fg`,
with no gold surface or gold text token for body copy.

---

## R2. Typography

**Decision**: `NEEDS CLARIFICATION — brand font not named in the source document.` Proceed on a
neutral system grotesk stack behind a single `--font-sans` token.

No font name appears anywhere in `German_World_Club_Digital_Plattform.docx` outside the Office
theme defaults, and the mockups are rasterised, so the family cannot be recovered from them. The
rendering is a neutral grotesk with tight headline tracking and a clear weight jump between a
600/700 headline and a 400 body.

**Rationale**: One token means swapping in the real family later is a one-line change, not a sweep.
Guessing a specific commercial family and wiring it into components would make that swap expensive
and would be a fabricated brand decision.

**What is fixed regardless of family**: the type scale observed in the mockups — page title ~26px
bold, card title ~17px semibold, body ~13px, label/caption ~11px uppercase-tracked, KPI numeral
~28px bold in navy.

**Open question for the user**: name the brand typeface, or confirm the system stack is acceptable.

---

## R3. Capability bootstrap is currently impossible for most staff

**Decision**: Add `GET /auth/session` as the capability endpoint, declared
`{ audience: 'staff', anyStaff: true }` — a module-less staff posture that the startup gate must be
taught to accept explicitly (below). Leave `/auth/staff/me` exactly as it is.

This is a blocking defect, not a preference. `/auth/me` is declared `{ audience: 'member' }`, and
`server/src/plugins/10-auth.js:22` maps route audiences to token audiences one-to-one
(`{ member: 'member', staff: 'admin' }`). An admin token on `/auth/me` fails at verification with
`FST_JWT_BAD_AUDIENCE` and is refused 403 before the handler runs. The only other route that
returns a capability snapshot is `/auth/staff/me`, and it is declared
`{ audience: 'staff', module: 'settings', flag: 'read' }` (`server/src/auth/routes.js:497`).

So a staff member holding `seo.read` and nothing else is refused their own capability set, and the
console cannot render any navigation for them at all. User Story 1 and FR-003 are unbuildable
until this is fixed.

**Rationale**: Knowing what you may do is not itself a privilege on the settings module. Reading
the system's configuration is; those are different things and only one of them is `settings.read`.

### The gate will refuse this route as written

`validateAuthConfig` in `server/src/plugins/11-rbac.js:41-48` requires a staff route to declare
*both* a known module and a known flag:

```js
if (auth.audience === 'staff') {
  if (!MODULES.includes(auth.module)) problems.push('staff routes must declare a known module, …')
  if (!FLAGS.includes(auth.flag))     problems.push('staff routes must declare one of …')
}
```

So `{ audience: 'staff' }` alone fails startup. The gate is doing its job — this is exactly the
silence it exists to refuse — and the fix must not be to stop it doing so.

**Decision**: extend the gate to accept a module-less staff route **only when the route says so
affirmatively**, with `{ audience: 'staff', anyStaff: true }`. Silence still fails; the exemption
is an affirmative act that appears in a diff, which is precisely the shape Principle II asks for
when a route is made broadly reachable. `validateAuthConfig` gains one branch and one new failure
mode of its own: `anyStaff` together with a module or flag is itself a declaration error, because
it would leave two postures on one route and no way to tell which governs.

**Alternatives considered**:

- *Relax the staff branch to make module/flag optional.* Rejected — it turns an omission back into
  a valid declaration, which is the defect the gate was written against.
- *Add a `session` module that every admin implicitly holds.* Rejected — an implicit grant that no
  administrator can see or revoke is worse than an explicit exemption, and it would put a
  permanently-true row in a matrix whose whole premise is that absence is denial.
- *Relax `/auth/staff/me` to require no module.* Rejected — it is the staff profile route, its
  `settings.read` posture is asserted by the existing authz matrix suite, and changing it would
  weaken a declared posture to fix an unrelated gap.
- *Put capabilities in the token.* Rejected outright by Principle II, which requires authorization
  to be resolved from server-held state at request time.

---

## R4. Two principal kinds do not exist

**Decision**: Add `merchant` and `partner` as token audiences and as route audiences, over the
existing session/refresh machinery rather than beside it.

`packages/contracts/src/permissions.js` declares `AUDIENCES = ['public','member','staff']` and
`TOKEN_AUDIENCES = ['member','admin']`. There is no merchant principal and no partner principal.
The migrations list twenty tables and none of them is an organisation, a merchant, an offer, a
redemption, an entitlement or a vacancy.

The change is therefore: two entries in `AUDIENCES`, two in `TOKEN_AUDIENCES`, two in
`10-auth.js`'s `TOKEN_AUDIENCE` map, plus organisation and organisation-user tables, plus the
per-organisation scoping rule.

**Rationale**: Merchants and partners sign in, hold sessions, refresh and are revoked exactly as
members and staff are. A second auth system would duplicate session uniqueness, the denylist and
the revocation window — each of which is already correct once.

**Alternatives considered**: Modelling merchants as staff with a narrow module grant — rejected,
it would make an external commercial party a staff principal and put them one grant edit away from
the admin console. Modelling them as members — rejected, the design document is emphatic that
*"Merchant ist kein Mitglied"* and *"Die Firmenbeziehung ist ausdrücklich keine Mitgliedschaft"*.

**Scoping rule this creates**: a merchant or partner principal's every query is scoped to their own
organisation. Per Constitution Principle II, a rule that depends on the target of an operation
must be enforced against the loaded target inside the transaction — a route-level audience
declaration cannot express "this offer belongs to your organisation", so object-level guards are
required. `server/src/authz/object-guards.js` already exists as the seam for this.

---

## R5. Sixteen of nineteen modules have no API

**Decision**: Build the console module by module, each slice shipping its server endpoints, its
contract schemas and its screen together. Never ship a screen without its API.

Dumping `app.routePostures()` from a booted instance gives 75 routes. Behind RBAC there are only:

| Module | Routes today |
|---|---|
| `seo` | `GET`/`PATCH /admin/seo/:recordType/:recordId` |
| `settings` | `GET /admin/openapi.json`, `GET /auth/staff/me`, `POST /auth/staff/sign-out` |
| `mass_messages` | push campaigns, campaign preview, test recipients |

`members`, `invitations`, `events`, `event_registrations`, `partners`, `partner_contracts`,
`membership_orders`, `committees`, `threads_moderation`, `marketplace_moderation`,
`support_tickets`, `newsletters`, `magazine`, `pages`, `admins`, `jobs` — sixteen modules — have
no route and, for most, no table.

**Rationale**: A console that renders sixteen dead sidebar entries is worse than one that renders
three live ones, and SC-001 requires a module to be either working or visibly marked unavailable.
Slicing by module keeps each increment independently testable, which is what the spec's user
stories already assume.

**Alternatives considered**: Building the full UI against mocks and swapping in real endpoints —
rejected. It front-loads the cheap half, defers every hard question about data shape, and would
put a screen in front of staff that cannot do what it appears to do.

**Ordering** (derived from what unblocks what):

1. Shell, auth, capability bootstrap, design tokens — no new modules, unblocks everything.
2. `seo`, `mass_messages`, `settings` — APIs exist; first genuinely useful console.
3. `members`, `admins` — the `members` table exists; `admin_users`/`admin_permissions` exist.
4. Submission/approval mechanism — shared by every module below it.
5. Organisations, merchant portal, partner portal — new principals, new tables.
6. `events`, `event_registrations`, `committees`, remaining content modules.

---

## R6. Approval is one mechanism, not one per module

**Decision**: Model submission-and-approval once — a submission with versions, comments, a state
and an append-only decision record — and let merchant offers, partner vacancies, editorial content
and events all use it.

The design document describes the same flow four times in four places: *"Entwurf → automatische
Pflichtfeld-/Preisprüfung → GWC Mitarbeiter prüft → freigeben / Änderungen / ablehnen →
Veröffentlichung → Nutzung → Mitgliederfeedback → Performance"*. The admin mockup shows three
queues (Mitgliederanträge, Merchant-Angebote, Partner-Content) rendered with one visual grammar and
one set of decisions.

**Rationale**: Four implementations of one workflow is the exact defect Constitution Principle I
was written against. A shared mechanism also makes FR-024's audit guarantee provable once.

**What stays per-module**: the validation rules, the member-facing preview, and which grant decides.

**Alternatives considered**: Per-module `status` columns — rejected; it gives no version history,
no comment thread, and no single place to prove the audit record is complete.

---

## R7. Client stack

**Decision**: Build in the existing `client/` workspace. React 19.2, Vite 8.3, Tailwind 4.3,
Vitest 5, Testing Library, `axe-core` — all already installed by feature 001.

**Rationale**: The workspace exists, the test harness exists, and `axe-core` is already wired,
which SC-006 depends on. Introducing a second frontend workspace would split the design tokens.

**What must be added**: a router. Nothing routing-related is installed today; `client/src/App.jsx`
renders one page. The console needs nested, role-scoped routes.

**Decision on the router**: use React Router's data router. It is the only mature option that
expresses nested layouts with per-route loaders, which is how a capability-scoped shell is
naturally written.

**Tailwind 4 specifics**: tokens are declared in CSS with `@theme`, not in a JS config. The R1
palette becomes custom properties on `@theme`, and SC-005's "fail the build on a hard-coded colour"
check becomes a lint rule over the arbitrary-value syntax plus a stylesheet scan.

---

## R8. Dark portal chrome is not dark mode

**Decision**: One theme. The `#171B20` sidebar is a component surface, not a colour scheme.

The mockups show a dark sidebar against light content on every portal page, in every mockup. No
mockup shows a dark content area.

**Rationale**: Treating the sidebar as a dark-mode instance would put every token in two states for
no design requirement, and would double the contrast surface SC-006 must verify.

**Consequence for FR-011**: contrast must be verified against two backgrounds — `#FFFFFF`/`#F7F8FA`
for content and `#171B20` for chrome — which is a fixed, small matrix rather than a theme system.

---

## R9. SPA deep links currently 404

**Decision**: Register an explicit, posture-declared SPA fallback confined to the console's route
prefix.

`server/src/app.js:258` registers `@fastify/static` with `wildcard: false` and `index: false`, and
the comment is explicit that this is load-bearing: with the catch-all gone, `setNotFoundHandler`
produces a real 404, which Constitution Principle III requires. A client-routed console at
`/konsole/...` would therefore 404 on every deep link and every refresh.

**Rationale**: The fallback must be additive and narrow, or it destroys the not-found correctness
the platform already proves. Confining it to one prefix keeps every other path answering a real
404.

**Constraints on the fallback**: it declares `{ audience: 'public' }` because it serves only the
empty application shell — but it must therefore serve *no member content whatsoever* (Principle VI
and FR-002's sibling rule), and it must carry `noindex` because it is a gated surface
(Principle II). `server/src/seo/surfaces.js` is where that posture is declared.

**Alternatives considered**: Hash routing — rejected; it works without server change but produces
unshareable URLs and breaks the deep-linking the portals need. Restoring `wildcard: true` —
rejected; it would silently re-break 404 correctness across the whole origin.

---

## R10. German interface

**Decision**: German only, with all copy in a single module per surface rather than inline in
components. No i18n framework.

**Rationale**: The design document is entirely in German and names no second language. A framework
for one language is cost without benefit; keeping strings out of components is what makes adding
one later cheap.

**Consequence**: `<html lang="de">`, German date, number and currency formatting via `Intl`, and
`de-DE` collation for anything sorted.

---

## R11. Testing approach

**Decision**: Four gate classes, each mapping to a success criterion.

| Gate | Proves | Criterion |
|---|---|---|
| Capability-matrix rendering | every module/flag pair shows for a holder and not for a non-holder | SC-002 |
| Refusal handling | every under-privileged action surfaces a refusal, never a broken screen | SC-003 |
| Token purity | no colour outside the token set reaches the build | SC-005 |
| Accessibility | zero `axe-core` violations against both backgrounds | SC-006 |

Each carries a counter-assertion, per the repository's existing test convention: a matrix test that
only proves a surface renders would pass against a console that renders everything to everyone, so
the negative half is the load-bearing half.

**Server-side**, the existing authz matrix suite (`server/tests/authz/matrix.test.js`) already
walks every route posture; new endpoints join it automatically, and the four startup gates
(undeclared posture, undeclared response shape, budget sum, undeclared fallback) mean a new route
cannot merge under-declared.

---

## Unresolved

| # | Question | Blocking? | Carried as |
|---|---|---|---|
| 1 | Brand typeface | No — token indirection absorbs a late answer | R2 |
| 2 | Console route prefix (`/konsole` assumed) | No | R9 |
| 3 | Whether merchant/partner sign-in shares the member sign-in screen or is a separate entry point | No — affects one screen | Phase 1 |
| 4 | Whether the existing coming-soon page stays at `/` after the console ships | No — the console mounts under its own prefix | R9 |
