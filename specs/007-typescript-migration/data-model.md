# Phase 1 Data Model: Schema → Type Mapping

**Feature**: 007-typescript-migration | **Date**: 2026-09-18

The "entities" in a migration are the shapes that change representation. This
document enumerates all 41 Zod schemas, what each becomes, and — the part that
matters — which of them carry rules a TypeScript type cannot express.

---

## 1. The headline finding

**33 business rules are encoded inside the 41 schemas.** Research R10 found one
(`altSchema`). A full audit of the contracts package found 33, spread across
four modules:

| Module | Rules | Kinds |
|---|---|---|
| `auth.js` | 12 | password policy, email format, OTP shape, token length bounds |
| `seo.js` | 13 | URL format, required non-empty metadata |
| `push.js` | 6 | title/body limits, pagination bound + coercion + default |
| `media.js` | 2 | alt-text bound, checksum digest shape |

None of these is a type check. Every one of them is a rule that survives
`typeof x === 'string'` and fails the business. They are listed individually in
§4 because "remove the schemas" deletes all 33 unless each is decided
deliberately, and a reviewer cannot see a deleted `.min(8)` in a file rename.

---

## 2. Schemas → types (41)

Each becomes an exported `type` of the same shape, named without the `Schema`
suffix. `signInRequestSchema` → `SignInRequest`.

**`auth.ts` (14)** — `signInRequest`, `verifyOtpRequest`, `resendOtpRequest`,
`refreshRequest`, `passwordResetRequest`, `passwordResetConfirm`, `principal`,
`signInResponse`, `tokenPairResponse`, `resendOtpResponse`,
`passwordResetAccepted`, `csrfTokenResponse`, `meResponse`,
`accessTokenClaims`.

**`capabilities.ts` (4)** — `moduleGrant`, `grantedModules`, `availableModules`,
`sessionResponse`.

**`media.ts` (9)** — `alt`, `variant`, `asset`, `uploadAccepted`,
`uploadRequest`, `assetIdParam`, `deliveryParam`, `deliveryLookupParam`,
`deleteResult`.

**`push.ts` (10)** — `deviceRegistration`, `device`, `deviceList`,
`campaignRequest`, `campaignResult`, `campaignHistory`, `campaignQuery`,
`testRecipient`, `testRecipientList`, `deleted`.

**`seo.ts` (4)** — `shareImage`, `alternate`, `pageMeta`, `contentRecord`.

---

## 3. Runtime values that survive unchanged

These are data and behaviour, not validation. They convert as plain renames and
keep their exports, so all ten client import sites keep working untouched.

**Constants** (38): `PROBLEMS`, `PROBLEM_KEYS`, `SIGN_IN_OUTCOMES`,
`ACCESS_TOKEN_CLAIMS`, `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TTL_DAYS`,
`OTP_TTL_SECONDS`, `OTP_MAX_ATTEMPTS`, `OTP_RESEND_COOLDOWN_SECONDS`,
`PASSWORD_RESET_TTL_SECONDS`, `COOKIES`, `CONSOLE_KINDS`, `HOME_FOR_KIND`,
`ASSET_KINDS`, `ASSET_STATES`, `VARIANTS`, `FORMATS`, `BREAKPOINT_WIDTHS`,
`MEDIA_MAX_BYTES`, `MEDIA_MAX_PIXELS`, `DELIVERY_CACHE_CONTROL`, `AUDIENCES`,
`TOKEN_AUDIENCES`, `FLAGS`, `MODULES`, `MEMBER_PERMISSIONS`, `MEMBER_STATUSES`,
`NO_GRANT`, `PUSH_PROVIDERS`, `PUSH_PLATFORMS`, `DESTINATION_TYPES`, `OG_TYPES`,
`SITE_NAME`, `DEFAULT_LOCALE`, `TITLE_MAX` (×2), `BODY_MAX`, `DESCRIPTION_MAX`.

**Upgrade available at zero cost**: the frozen arrays become exact union types.

```ts
export const AUDIENCES = ['public','member','staff','merchant','partner'] as const
export type Audience = typeof AUDIENCES[number]
```

This is strictly better than the Zod enum it replaces for *static* purposes, and
it is why R1's erasable-syntax-only constraint costs nothing: the codebase
already avoided `enum` in favour of frozen data.

**Functions** (5): `hasGrant`, `hasAnyGrant`, `isAvailable`, `isModule`,
`isFlag`.

**Decision required — `isModule` and `isFlag`.** These are runtime type
predicates: they check a string against `MODULES` / `FLAGS`. Under a literal
reading of "remove any type validation" they qualify. They should be **kept**
and typed as TypeScript type predicates:

```ts
export function isModule(value: string): value is Module
```

The reason is that their inputs come from the database and from tokens, not
from TypeScript. A predicate over a value the compiler never saw is not a
redundant type check — it is the only check there is. Confirm before removal.

---

## 4. The 33 business rules, individually

Each row is a rule that disappears with its schema. The Disposition column is
the recommendation; the implementation task must record an explicit decision
for every row.

### 4a. Security-relevant — recommend PRESERVE

| # | Rule | Source | What is lost |
|---|---|---|---|
| 1 | `password: min(8)` | `auth.js:20` | **The password length policy.** Nothing else enforces it. An empty-string password is accepted at sign-in and at reset. |
| 2 | `password: max(256)` | `auth.js:20` | Input bound before argon2id at 19 MiB per hash. Argon2's cost is near-independent of input length, so this bounds request work rather than preventing a hash DoS — but it is an unbounded-input path where one was bounded. |
| 3 | `password: min(8).max(256)` | `auth.js:45` | Same policy on the reset path. Both call sites must be preserved together or reset becomes the weaker door. |
| 4 | `code: regex(/^\d{4}$/)` | `auth.js:26` | OTP must be four digits. Wrong codes still fail comparison, so this is input shaping rather than an auth bypass — but it is what keeps arbitrary strings out of the OTP attempt counter that `OTP_MAX_ATTEMPTS` governs. |
| 5 | `email: email().max(320)` | `auth.js:16` | Format check and the RFC 5321 length bound, on the sign-in path that also feeds the per-account rate-limit key. |
| 6 | `email: email().max(320)` | `auth.js:40` | Same, password-reset request path. |
| 7 | `refreshToken: min(16).max(512)` | `auth.js:36` | Length bounds on a credential before it reaches token lookup. |
| 8 | `token: min(16).max(512)` | `auth.js:44` | Same, password-reset token. |
| 9 | `jti: min(16)` | `auth.js:165` | Bound on the token identifier in access-token claims. |
| 10 | `csrfToken: min(1)` | `auth.js:106` | Non-empty CSRF token. |
| 11 | `checksum: regex(/^[0-9a-f]{64}$/)` | `media.js:73` | Content-addressed sha256 digest shape. Feeds storage addressing and dedupe. |
| 12 | `memberId: uuid()` | `push.js` | UUID shape on a test-push recipient. |

### 4b. Coercion and defaults — recommend PRESERVE (same class as R7)

| # | Rule | Source | What is lost |
|---|---|---|---|
| 13 | `limit: coerce.number().int().min(1).max(200).default(50)` | `push.js:98` | **The sharpest case in the feature.** Traced: `controller.js:52` reads `request.query.limit` and `application/campaign.js:160` passes it straight into a SQL parameter. Query strings are strings, so removing this yields three regressions at once — `"50"` instead of `50`, `undefined` instead of the default 50 when the param is absent, and no upper bound, so `?limit=1000000` is served. Parameterised, so not injection; unbounded, so a denial-of-service shape. |
| 14 | `isTest: coerce.boolean().optional()` | `push.js:97` | Same class. `"false"` is truthy. |

### 4c. Product rules — recommend PRESERVE

| # | Rule | Source | What is lost |
|---|---|---|---|
| 15 | `alt: trim().min(1).max(300)` | `media.js:29` | §10.1 alt-text requirement at ingest (R10). |
| 16 | `title: trim().min(1).max(TITLE_MAX)` | `push.js:52` | Push title bound. Exceeding it truncates at the provider. |
| 17 | `body: trim().min(1).max(BODY_MAX)` | `push.js:53` | Push body bound, same. |
| 18 | `token: min(1).max(512)` | `push.js:31` | Device token bound. |
| 19 | `destinationId: max(64)` | `push.js:56` | |
| 20 | `destinationLabel: max(200)` | `push.js:61` | |
| 21 | `package: int().min(1).max(3).nullable()` | `auth.js:131` | Membership package is one of three. |

### 4d. SEO metadata — recommend DELETE, no replacement (corrected)

Rules 22–33, all in `seo.js`: `url()` on `shareImage.url`, `alternate.href`,
`pageMeta.canonical`, `contentRecord.url` and `contentRecord.image`;
`min(1)` on `shareImage.alt`, `pageMeta.title`, `pageMeta.description`,
`contentRecord.slug`, `contentRecord.title`, `contentRecord.description`;
`min(2)` on `alternate.hreflang` and `pageMeta.lang`.

**These are not enforced today.** A usage search across `server/src` found
exactly one reference to any of the four SEO schemas, and it is a JSDoc
annotation:

```js
// server/src/modules/seo/build-page-meta.js:51
/** @param {import('@gwc/contracts/seo').contentRecordSchema} record */
```

No route declares them, nothing calls `.parse()` on them. They are type
documentation that happens to be written in Zod, which makes them the *easiest*
twelve rules in the audit: converting them to TypeScript types loses nothing,
because nothing was gained at runtime in the first place.

This corrects an earlier reading of this section, which claimed Principle III's
PASS depended on preserving them. It does not. Principle III is upheld by
behaviour — live-state generation, status-code correctness, canonical redirects
— and measured by `verify:seo` (SC-004), none of which touches these schemas.
The JSDoc annotation at `build-page-meta.js:51` is itself removable once the
parameter carries a real `ContentRecord` type.

### 4e. Marketplace and messaging (added by feature 008) — recommend PRESERVE

Feature 008 landed after this audit and added its own request schemas. It is
listed here because 008 is what knows these rules exist; Phase 6 would
otherwise meet them for the first time while deleting them.

Most of them have a second enforcement point — a CHECK constraint in
`019_marketplace.sql`/`018_messaging.sql`, or a runtime value in
`@gwc/contracts/marketplace` that is not a Zod schema and survives (§3). **A
CHECK constraint is not a replacement.** Nothing in `server/src` maps SQLSTATE
`23514` (check_violation) or `22P02` (invalid input syntax) to a problem type,
so once the schema is gone the data stays sound but the client's `400
validation-failed` becomes a `500`. The "Backstop" column says what is left;
"What is lost" says what the client sees change.

| # | Rule | Source | Backstop after Phase 6 | What is lost |
|---|---|---|---|---|
| 34 | `title: trim().min(3).max(140)` | `marketplace/routes.ts` create + PATCH | CHECK `listings_title_bounded` | 400 becomes 500. Both call sites must move together or PATCH becomes the weaker door. |
| 35 | `body: trim().min(10).max(8000)` | `marketplace/routes.ts` create + PATCH | CHECK `listings_body_bounded` | Same. |
| 36 | Category-required and per-field detail rules (`make`, `deal`+`city`, `employment_type`+`city`, `kind`; enum options; integer/decimal/date kinds; `year` 1900–2100) | `validateDetails` over `CATEGORY_DEFS` | **Survives** — `CATEGORY_DEFS` is a frozen runtime value, not Zod | Nearly nothing. `validateDetails` reads `details?.[key]`, so a non-object `details` fails on the category's required field rather than crashing — but the refusal then names a missing field instead of a malformed body. A plain-object check keeps the message honest. |
| 37 | Price and salary bounds: every `money` field `min: 0`; `salary_max ≥ salary_min` | `CATEGORY_DEFS` + CHECKs `*_price_non_negative`, `job_salary_ordered` | **Survives** in `validateDetails`; CHECKs behind it | Nothing, if 36's object check is kept. |
| 38 | Media per listing ≤ 20 | `MAX_MEDIA_PER_LISTING` in `application/media.ts` | CHECK `listing_media_position_bounded` (0–19) | Nothing — not a Zod rule. Listed so Phase 6 does not "tidy" the constant away as a duplicate of a schema. |
| 39 | `features: array(string()).max(60)` | `marketplace/routes.ts` create + PATCH | FK to `vehicle_features` refuses unknown keys | **The upper bound.** No constraint caps the count; a 10,000-element array would be looked up key by key. Unbounded-input path where one was bounded. |
| 40 | `category`, `mode`, `contactMethod`, `state` enums | `marketplace/routes.ts` | Postgres enum types | 400 becomes 500 (`22P02`). `state` additionally loses nothing — `manage.ts` refuses non-owner transitions itself. |
| 41 | `contactMethod` default `platform_message` | `marketplace/routes.ts` create | Column default, and `createListing`'s own destructuring default | Nothing. |
| 42 | `termsVersion: min(1)` | `marketplace/routes.ts` create | `createListing` compares against `currentTermsVersion()` | Nothing, provided the comparison stays strict equality — an absent version must not match. |
| 43 | `:id` params `uuid()` on every listing and staff route | `marketplace/routes.ts`, `staff-routes.ts` | None | **404 becomes 500** (`22P02` on the `::uuid` cast). For the ownership routes this also breaks SC-006's "indistinguishable" guarantee: a malformed id would answer differently from an absent one. |
| 44 | Report / moderation `reason: trim().min(3).max(2000)` | `marketplace/routes.ts` report; `staff-routes.ts` hide/restore/remove/resolve | CHECK `report_reason_bounded` on reports only; `requireReason` in `moderate.ts` for staff actions | Member report: 400 becomes 500. Staff actions: `requireReason` keeps the **minimum** (≥ 3 after trim) but has no maximum, and `audit_log.detail` has no CHECK — so the 2000-character cap on a staff reason is lost outright. |
| 45 | Message `body: trim().min(1).max(4000)` | `messaging/routes.ts` send; `marketplace/routes.ts` inquire | CHECK `messages_body_bounded` | 400 becomes 500 on both paths. Message *volume* is the rate limiter's (429) and is unaffected. |

`limit` on the browse index and the inbox is **not** in this list on purpose:
both routes declare `limit: z.unknown()` and bound it in the controller, so the
§4b rule-13 regression cannot happen here — the schema carries no rule to lose.

**Recommended Phase 6 disposition:** preserve 34, 35, 39, 40, 43, 44 (member
report, plus a `max(2000)` in `requireReason`) and 45 as hand-written checks, or add one error mapping that turns
`23514`/`22P02` into `validation-failed` — which fixes all of them at once but
must not turn an ownership-route `22P02` into anything other than the same 404
an absent id gets. Keep 36's plain-object check. 37, 38, 41 and 42 need no
action beyond not deleting what they depend on.

---

## 5. Server-side shapes

### 5.1 `Env` — the frozen configuration object

`loadEnv()` returns `Object.freeze({...})`. The type is straightforward; the
*construction* is the risk (R7).

```ts
export type Env = Readonly<{
  NODE_ENV: 'development' | 'test' | 'production'
  PORT: number                    // coerced from string — MUST survive
  TRUST_PROXY: false | number     // "false" → false, "1" → 1 — MUST survive
  CANONICAL_ORIGIN?: string
  KEEP_ALIVE_TIMEOUT_MS: number
  CONNECTION_TIMEOUT_MS: number   // invariant: > REQUEST_TIMEOUT_MS
  REQUEST_TIMEOUT_MS: number
  DATABASE_URL: string
  REDIS_URL?: string
  // ...
  isProduction: boolean
  isTest: boolean
  canonicalOrigin: string
  trustProxy: false | number
}>
```

The type annotation `TRUST_PROXY: false | number` is a *claim*. After the
removal, nothing checks it at runtime, so the hand-written coercion in
`config/env.ts` is the only thing that makes the claim true. If it is skipped,
the field holds the string `"false"` while the compiler reports `false | number`
everywhere downstream — the worst combination, because the type system actively
conceals it.

### 5.2 Route posture

```ts
type RouteConfig = {
  auth: { audience: Audience; module?: Module; flag?: Flag }  // gate KEEPS this
  budget?: string
  rateLimit?: RateLimitOptions
  produces?: string
}
```

`schema.response` leaves the shape entirely. The `onReady` gate in
`11-rbac.ts` keeps validating `config.auth` and stops validating responses (R8).

### 5.3 Error hierarchy

Eight `extends Error` subclasses convert as plain renames — `GwcLogController`,
`DeadlineExceededError`, `DependencyUnavailableError`, `CardDeclinedError`,
`QuotaExceededError`, `AuthorizationError`, `MediaRejected`, `ApiError`. No
parameter properties, so all eight are erasable-syntax-clean (R1).

---

## 6. State transitions

None. This feature adds no migration, alters no table and changes no state
machine. `ASSET_STATES` and `MEMBER_STATUSES` convert from frozen arrays to
`as const` unions and keep identical runtime values, so the database sees no
difference.

---

## 6b. One rule the first pass missed: token minting

`server/src/modules/auth/tokens.js:40` calls
`accessTokenClaimsSchema.parse(claims)` when an access token is **minted**, and
the comment states the intent:

> Belt and braces: the strict schema rejects any claim a future change adds
> here, at the point it is minted rather than at the point a client reads it.

This is a strict-object check guarding against accidental disclosure *into* a
JWT. Access tokens are readable by anyone holding them, so a field added to the
`claims` object by a later change — an email, an internal id — would ship inside
every token issued. Removing the parse makes that silent.

**Disposition: PRESERVE** as an explicit allowed-key check. It is one of only
three `.parse`/`.safeParse` call sites in the codebase and the only one whose
removal creates a disclosure path rather than an acceptance path.

---

## 7. Summary of what the audit changes

The spec anticipated one business rule hiding in a schema. The audit found 33,
then usage tracing reduced the number that are actually **enforced** to 20:

| Group | Count | Disposition |
|---|---|---|
| Request-side, security-relevant (§4a) | 11 | **PRESERVE** — hand-written checks |
| Coercion and defaults (§4b) | 2 | **PRESERVE** — behaviour, not validation |
| Product bounds on request bodies (§4c) | 7 | **PRESERVE** |
| Response-side only (`csrfToken`, `meResponse.package`, `asset.checksum`) | 3 | **DELETE** — covered by the accepted Principle VI loss |
| SEO metadata, not wired to any route (§4d) | 12 | **DELETE** — never enforced |
| Token-minting strict check (§6b) | 1 | **PRESERVE** |
| Marketplace and messaging, added by feature 008 (§4e) | 12 | **PRESERVE** 7 as checks (or one `23514`/`22P02` mapping); 5 need no action beyond keeping what they depend on |

So the removal is "delete 41 schema definitions, preserve 21 rules, and record
a decision for the other 15." Tasks are generated per rule, not per file, or
the decisions become invisible — which is precisely what SC-008 exists to
prevent.
