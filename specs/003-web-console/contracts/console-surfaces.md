# Contract: Console Surfaces

**Feature**: 003-web-console

Which screen exists, who reaches it, what grant it needs, and whether the server can serve it yet.

## Route prefixes

| Prefix | Principal | Notes |
|---|---|---|
| `/konsole/anmelden` | public | Sign-in. The only unauthenticated console surface. Renders no member content. |
| `/konsole/passwort` | public | Password reset request and confirm. **No registration** (FR-002). |
| `/konsole/mitglied` | member | Member logged-in web |
| `/konsole/admin` | staff | Admin Panel |
| `/konsole/merchant` | merchant | Club Merchant Portal |
| `/konsole/partner` | partner | Corporate Club Partner Portal |

All are gated, all carry `noindex, nofollow`, and all are served by the SPA fallback of research
R9 — one narrow fallback confined to `/konsole/*`, leaving real 404s intact everywhere else. The
fallback serves the empty application shell and nothing else: no member content is rendered to an
unauthenticated requester for any reason (Principle VI).

## Admin Panel — `/konsole/admin`

Sidebar exactly as the mockup on page 10, each item gated on its module.

| Screen | Module | Flags | Server today |
|---|---|---|---|
| Dashboard | — | any grant | **Ready** — composed from the queues below |
| Mitgliederanträge | `members` | read / status | Missing |
| Mitglieder | `members` | read / edit / status | Missing |
| Merchant-Angebote | `marketplace_moderation` | read / status | Missing |
| Partner-Inhalte | `partners` | read / status | Missing |
| Expertenprüfung | `members` | read / status | Missing |
| Ask GWC | `support_tickets` | read / write / edit | Out of scope (FR-039) |
| Beschwerden | `support_tickets` | read / edit / status | Missing |
| Events | `events` | read / write / edit / delete / status | Missing |
| Billing | `membership_orders` | read | Missing |
| Audit Log | `settings` | read | Partial — `audit_log` exists, no query route |
| Rollen & Rechte | `admins` | read / write / edit / delete | Missing |
| SEO | `seo` | read / edit | **Ready** |
| Push-Kampagnen | `mass_messages` | read / write / edit | **Ready** |
| Jobs | `jobs` | read / status | Partial — tables exist, no route |

**Three of fifteen are servable today.** The rest render as *"noch nicht verfügbar"* from the
`available` list in the capability response — visible, honest, and not a dead link (SC-001).

### The read/edit distinction

A module held at `read` but not `edit` renders with **no control that would submit** (FR-017). Not
a disabled button — absent. A disabled control still tells a reader the action exists and is a
recurring source of submitted-anyway defects.

## Club Merchant Portal — `/konsole/merchant`

Sidebar from the mockup on page 8. Every screen is scoped to the principal's own organisation by an
object guard inside the transaction — a route-level audience cannot express "your organisation"
(research R4).

| Screen | Contents |
|---|---|
| Dashboard | Einlösungen, Mitgliederwert, "echter Vorteil bestätigt" %, Qualität — all aggregate |
| Profil | organisation profile, verification state |
| Produkte & Services | catalogue |
| Angebote | offers, with `Zur Freigabe einreichen` — the submission mechanism |
| Nachrichten | replies to member enquiries only; no outbound broadcast (FR-027) |
| Leads | qualified leads, no member identity |
| Analytics | views, redemptions, feedback, documented member value — aggregate only (FR-031) |
| Billing | fee band from the contract |
| Team | `organisation_users` within this organisation |
| Einstellungen | |

**Hard rules the UI must carry**: no member list, anywhere (FR-027). No outbound broadcast. Every
offer shows regular price, GWC price, availability, locations, validity and conditions (FR-028) —
so the offer form makes each required rather than optional, and `member_price < regular_price` is
refused by the database, not by the form.

## Corporate Club Partner Portal — `/konsole/partner`

Sidebar from the mockup on page 9.

| Screen | Contents |
|---|---|
| Übersicht | berechtigte Mitarbeiter, aktiviert, offene Stellen, Editorial Reach |
| Firmenprofil | |
| Mitarbeiterzugang | entitlements — invite, revoke, count against contract |
| Recruiting | vacancies, published through approval |
| News & PR | articles, published through approval |
| Events | |
| Member Benefits | what their employees can use |
| Analytics | activation, benefit use, event participation, content reach — aggregate (FR-031) |
| Billing | fee band |

**The rule the design document states most emphatically**: *"Keine Mitgliedschaft."* An entitlement
grants benefit access and creates no membership of any tier (FR-030). The portal must never use
membership vocabulary for an employee, and the dark callout from the mockup carrying that sentence
is part of the screen, not decoration.

## Member web — `/konsole/mitglied`

| Screen | Contents | Server today |
|---|---|---|
| Home | heute relevant, nächste Veranstaltung, offene Introductions, Wert | Missing |
| Profil | bio, company, cities, languages, "Ich kann helfen bei", "Ich suche" | Missing — `members` exists, `member_profiles` does not |
| Sichtbarkeit | per-field visibility (FR-034) | Missing |
| Netzwerk | connection requests, introductions | Missing |
| Vorteile | offers, redemption, savings | Missing |
| Wert | value ledger | Missing |
| Konto | password change, sessions, devices | **Partial** — sign-out and push devices exist |

A field marked private is **absent from the response**, not hidden in markup (FR-034). Because
responses serialize through an explicit schema (Principle VI), omission is structural.

## Cross-cutting

**Sign-in** is one screen serving all four principal kinds. The server decides which it is from the
credential and answers with the principal kind; the client routes on that. It does not ask the user
to pick a portal, which would leak which kinds of account exist for a given address.

**Session ending**: at most one session per account is active; a sign-in elsewhere terminates this
one. On the resulting `SESSION_REVOKED` the console returns to sign-in and preserves unsaved input
rather than discarding it silently.

**Confirmation**: every destructive or outward-facing action is confirmed before it is sent
(FR-020). Sending a push campaign, approving an offer, revoking an entitlement and ending a
membership all qualify.

**Labelling**: partner- and merchant-originated content is visibly marked wherever a member sees it
(FR-032). The design document's rule — a commercial relationship may buy distribution but never
trust — is a UI obligation as much as a server one.

**Language**: German throughout, `<html lang="de">`, `Intl` for dates, numbers and currency
(FR-014, research R10).
