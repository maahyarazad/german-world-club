# Contract: Member Marketplace API

**Feature**: 008-marketplace

Every route here is **member-audience, gated, never indexed**. Every one declares
`config.auth` — the boot gate that survived constitution 2.0.0 refuses to start
the server otherwise.

**One API, three faces.** The staff console, the member web tab and the member
mobile tab all call these routes. Authentication *mechanism* differs — cookies
for the browser, bearer tokens for mobile — and Principle I permits exactly that
while requiring the authorization *outcome* to be identical (FR-031).

**"One shared API" does not mean an unauthenticated one.** Nothing here is
readable signed out, on any face (FR-033). `seo/surfaces.ts` continues to declare
`/marketplace` gated and never-indexed; this feature changes no crawl posture.

## Posture

```ts
config: { auth: { audience: 'member' }, budget: 'marketplace' }
```

`budget` names the route class whose deadline and outbound budgets apply. The
startup gate asserts Σ(outbound budgets) < the route's deadline, so the class must
exist in `config/budgets.ts` before any of these routes register.

## Endpoints

| Method | Path | Purpose | Extra guard |
|---|---|---|---|
| `GET` | `/marketplace/listings` | The index, filtered and paged | — |
| `GET` | `/marketplace/listings/:id` | One listing | visible-or-gone |
| `POST` | `/marketplace/listings` | Create | `marketplace_post` + current terms |
| `PATCH` | `/marketplace/listings/:id` | Edit | owner only |
| `POST` | `/marketplace/listings/:id/state` | sold / filled / withdrawn | owner only |
| `GET` | `/marketplace/mine` | Own listings, **including** hidden and withdrawn | — |
| `POST` | `/marketplace/listings/:id/media` | Attach an uploaded asset (image or video) | owner only |
| `DELETE` | `/marketplace/listings/:id/media/:assetId` | Detach — never deletes bytes | owner only |
| `POST` | `/marketplace/listings/:id/report` | Report | one open report per member |
| `POST` | `/marketplace/listings/:id/inquire` | Start a conversation | listing must be inquirable |
| `GET` | `/marketplace/terms` | Current terms version | — |
| `POST` | `/marketplace/terms/accept` | Record acceptance | — |
| `GET` | `/marketplace/categories` | Field definitions + feature catalogue | — |

`/inquire` is specified in [messaging-api.md](./messaging-api.md). It lives under
`/marketplace` because that is the resource it acts on and the guard it needs.

**Expiry** is optional on create and edit. Omitting it, or sending null, means
*unlimited* — a first-class choice, not a missing value (FR-028, FR-030). A
member may clear an expiry back to unlimited at any time.

`GET /marketplace/categories` exists so the compose form is built from the same
definition the server validates against (Principle I). It is the client's only
source for the ~40 vehicle features; hard-coding them in the console would be the
second home for a rule.

## The index query

```
GET /marketplace/listings
  ?category=vehicle|property|job
  &mode=offer|request
  &cursor=<opaque>
  &limit=<1..50, default 20>
  + category-specific filters
```

### `limit` is the sharpest parameter in this feature

It is coerced, defaulted and bounded **in the handler**, not only in a schema.

This is not caution in the abstract. `specs/007-typescript-migration/data-model.md`
§4b traces the existing `campaignQuery.limit` from `request.query` into a SQL
`LIMIT` and records that removing its Zod schema without replacing the coercion
yields three regressions at once: `"50"` as a string, `undefined` when the
parameter is absent, and no upper bound at all — so `?limit=1000000` is served.
Query strings are strings. This feature adds a second parameter with the same
path into SQL, and Phase 6 will delete its schema too.

**Assertion**: `limit` reaches the application layer as a **number**, bounded at
50, defaulting to 20 when absent. Test all three, not just the bound.

### Cursor

Opaque, encoding `(created_at, id)`. Keyset, not offset: a classifieds index is
append-heavy and offset paging skips or repeats rows as listings arrive
mid-scroll.

An unparseable cursor is a 400, not a silent reset to page one — silently
restarting is how a client loops forever without noticing.

## Responses

**Every response names its columns.** No `SELECT *` on any path that reaches a
client.

This is the only thing standing between a new `members` column and a marketplace
response, because constitution 2.0.0 removed the response-schema requirement and
named no replacement. A listing response joins listing, owner and contact data,
so the exposure here is wider than on the routes that were live when the
amendment was written.
`specs/007-typescript-migration/contracts/http-boundary-contract.md` already
asserts no `SELECT *` on a response path; these routes are covered by it.

A listing response carries:

- the listing's own fields
- its category detail block
- media **derivative** URLs at declared breakpoints — never the original, which
  `verify:seo` and the media suites both already assert. A listing may carry one
  photo, several photos or a video; for video the index uses the `poster`
  variant, so a browse page never autoplays and never waits on a transcode
- the owner's **display** identity only
- a resolved contact **affordance**, never a contact value (R9)

## Refusals

RFC 9457 problem+json. Clients branch on `type`, never on `detail`.

| Situation | Problem | Status |
|---|---|---|
| Not signed in | `UNAUTHENTICATED` | 401 |
| No `marketplace_post` | `PERMISSION_REQUIRED` | 403 |
| Terms not accepted | `VALIDATION_FAILED` + a terms-specific detail | 400 |
| Someone else's listing | `NOT_FOUND` | **404** |
| Listing gone | `GONE` | 410 |
| Listing quota reached | `QUOTA_EXCEEDED` | **422** |
| Too many requests | `RATE_LIMITED` | 429 |

Two of these are load-bearing:

**404, not 403, on someone else's listing.** The `guardOrganisationScope`
precedent: answering 403 confirms the row exists, which turns id-guessing into
enumeration. The refusal must be indistinguishable from the listing not existing
(FR-004, SC-006).

**422, not 429, on the listing quota.** A 429 means "retry later and it will
work". A quota means retrying changes nothing until state does. A client shown
429 for an exhausted quota retries forever. This is CLAUDE.md's rule, and it is
why the quota lives in PostgreSQL under a row lock rather than in the rate
limiter.

## Assertions

1. Every route declares `config.auth`; removing one refuses to boot.
2. No marketplace response is reachable unauthenticated; all carry `noindex`.
3. `limit` arrives as a number, bounded at 50, defaulted to 20.
4. No response references an original upload.
5. Another member's listing is 404, byte-identical to a genuinely absent one.
6. Quota exhaustion is 422, and concurrent creates at the boundary never exceed
   the cap — asserted under real concurrency, not sequentially.
7. `grep -rn "SELECT \*" server/src/modules/marketplace/` returns nothing.
