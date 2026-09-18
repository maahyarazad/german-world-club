# Phase 0 Research: TypeScript Migration and Runtime Validation Removal

**Feature**: 007-typescript-migration | **Date**: 2026-09-18

Every finding below was verified against this repository and this machine
(Node v22.23.2, npm 10.9.8) rather than taken from general practice. Probe
commands are given where the answer was not obvious.

---

## R1. How TypeScript runs on the server

**Decision**: Node's native type stripping. No bundler, no loader, no build
step. `server/src/server.js` becomes `server/src/server.ts` and the dev command
stays `node --env-file-if-exists=.env --watch src/server.ts`.

**Rationale**: Node 22.23.2 strips types unflagged — verified by running a
`.ts` file directly, which printed its result with no flags and no
dependencies. This preserves the single most characteristic property of this
server: there is no build. `npm run -w server dev` keeps meaning what it means
today, stack traces point at real source lines without source maps, and
production runs the same files the editor opens. Type *checking* becomes a
separate `tsc --noEmit` pass, which is the correct separation regardless —
runtime behaviour should never depend on the type checker having run.

The one constraint is that type stripping accepts **erasable syntax only**.
A probe confirmed `enum` fails with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. That
constraint costs this codebase nothing:

- All eight classes are plain `extends Error` subclasses. No parameter
  properties, no decorators, no `implements` emit.
- The enum-shaped constants already exist in the form TypeScript prefers:
  `PROBLEMS` is a frozen object literal and `AUDIENCES`, `FLAGS`, `MODULES` are
  frozen arrays. Adding `as const` and deriving
  `type Audience = typeof AUDIENCES[number]` yields exact union types with no
  change to the runtime value.

**Alternatives considered**:

- *A `tsc` build to `dist/`*. Its real attraction is R2: TypeScript's `nodenext`
  resolution reads a `./env.js` specifier as `env.ts`, so all 404 server import
  specifiers would need no edit at all. Rejected because it introduces a build
  artefact, a stale-`dist/` failure mode, source maps between the crash and the
  code, and a rewrite of all eleven server npm scripts — a permanent cost to
  avoid a one-time deterministic rename.
- *`tsx` or `ts-node`*. A production dependency in the hot path to do what the
  runtime now does natively.
- *`--experimental-transform-types`*. Would permit enums and namespaces. Buys
  nothing here and trades an unflagged path for a flagged one.

---

## R2. Import specifiers must be rewritten, and this is the largest mechanical change

**Decision**: Rewrite every relative import specifier from `.js` to `.ts`
(server, contracts) and from `.jsx`/`.js` to extensionless (client). Set
`allowImportingTsExtensions: true` in the server and contracts tsconfigs, which
TypeScript permits only alongside `noEmit` — exactly the configuration R1
chooses.

**Rationale**: This is the finding most likely to derail the migration if it is
discovered late. Node's type stripping does **not** rewrite specifiers. A probe
confirmed both directions:

```
import { answer } from './dep.js'   // from a .ts file → ERR_MODULE_NOT_FOUND
import { answer } from './dep.ts'   // from a .ts file → works
```

So renaming a file without rewriting its importers produces a server that does
not start. The counts, measured:

| Location | Specifiers | Target |
|---|---|---|
| `server/src`, `server/tests` | 404 × `.js` | `.ts` |
| `packages/contracts/src` | 2 × `.js` | `.ts` |
| `client/src`, `client/tests` | 28 × `.js`, 70 × `.jsx`, 2 extensionless | extensionless |

The server and contracts rewrite is a single deterministic substitution across
the tree, not judgement work: every `from './x.js'` becomes `from './x.ts'`.
It must land in the *same commit* as the corresponding rename, because the
intermediate state does not run.

The client is different and must not use the same rule. Vite resolves
extensionless specifiers and is the only consumer, so `./Button.jsx` becomes
`./Button` rather than `./Button.tsx`. Writing `.tsx` specifiers would work in
Vite but would be the only place in the repository using that spelling.

**Alternatives considered**: `rewriteRelativeImportExtensions` (TypeScript 5.7+)
lets source keep `.ts` specifiers and emits `.js` ones. It solves a problem
created by emitting, and R1 does not emit.

---

## R3. Compiler and version

**Decision**: TypeScript 7 (`npm view typescript version` → **7.0.2**) as a root
devDependency, `strict: true`, one `tsconfig.json` per workspace plus a root
solution file. `tsc --noEmit` is the gate; it never emits.

**Rationale**: A single root installation type-checks all three workspaces; the
workspaces themselves gain no TypeScript runtime dependency, which keeps the
server's production dependency list unchanged. TypeScript 7's native compiler
matters at this size — 254 files is enough that check time is a thing
developers notice and therefore skip.

`strict: true` from the start rather than ratcheted. Ratcheting means the
migration happens twice, and the second pass never gets scheduled.

**Alternatives considered**: Per-workspace TypeScript installations (version
skew between workspaces that share a contracts package is a problem with no
upside). Beginning at `strict: false` (rejected as above).

---

## R4. Client toolchain

**Decision**: `.jsx` → `.tsx`, `.js` → `.ts`, no Vite configuration change
beyond file extensions. `vite.config.js` itself becomes `vite.config.ts`.
`@types/react` and `@types/react-dom` are **already** devDependencies.

**Rationale**: Vite 8 transpiles TypeScript through esbuild with no plugin and
no options. The three-entry build, the `consoleFallback` dev plugin and the API
proxy are unaffected — they operate on HTML entries and URLs, not on module
syntax. The two landing pages carry their styles and content inline and pull in
no bundle at all, so the no-JavaScript guarantee in the Constitution's "Public
rendering" clause is untouched by anything in this feature.

**Alternatives considered**: `vite-plugin-checker` to fail the dev server on
type errors. Deferred — `tsc --noEmit` in `npm test` covers it without slowing
every hot reload.

---

## R5. Test toolchain

**Decision**: Vitest 5 needs no transform configuration. Two edits only:
`server/vitest.config.ts` coverage `include: ['src/**/*.js']` → `['src/**/*.ts']`,
and the `setupFiles`/`globalSetup` paths follow their renamed files.

**Rationale**: Vitest transpiles TypeScript through the same esbuild pipeline
Vite uses. The `pool: 'forks'` / `maxWorkers: 1` serialization exists because
the Postgres suites share one scratch database; nothing about that interacts
with the language change.

**Risk noted**: Vitest transpiles without type-checking, so a test file can be
type-broken and still pass. `tsc --noEmit` must cover `tests/` as well as
`src/`, or the 92 test files across both workspaces become an untyped island —
which would be the largest body of unchecked code in the repository.

---

## R6. Replacing the 41 contract schemas

**Decision**: Each of the 41 exported Zod schemas in `packages/contracts/src`
becomes an exported `type`. `errors.ts`, `permissions.ts` and `capabilities.ts`
keep their runtime values — `PROBLEMS`, `AUDIENCES`, `FLAGS`, `MODULES`,
`HOME_FOR_KIND`, `hasGrant`, `isAvailable`, `extensionAgrees` — because those
are data and behaviour, not validation. Add `as const` and derive union types
from them.

**Rationale**: This is the part of the removal that genuinely loses nothing on
the client side. The console imports `PROBLEMS`, `MODULES`, `FLAGS`,
`HOME_FOR_KIND`, `hasGrant`, `hasAnyGrant` and `isAvailable` — ten import sites
across seven files, and **not one of them imports a schema to validate with**.
The client never called `.parse()`. For the client, the schemas were already
only types; making that literal changes nothing at runtime.

The server is where the loss falls, and R8 and R11 record it.

**Alternatives considered**: Keeping the schemas and deriving types via
`z.infer` — the approach that would satisfy Principle I and VI unchanged. Not
chosen; the clarified decision is to remove Zod.

---

## R7. Environment configuration — the one removal that is a rewrite

**Decision**: `config/env.ts` keeps hand-written **coercion, defaulting and
cross-field invariants** and loses only the type validation. This is the
highest-risk file in the feature and is planned as its own phase with its own
tests.

**Rationale**: `loadEnv()` is not a validator with some conveniences attached;
the conveniences are the point. Everything in `process.env` is a string, and
the current schema does four separable jobs:

1. **Coercion** — `int(d)` turns `"3000"` into `3000`; `bool` turns `"true"`
   and `"false"` into real booleans.
2. **Defaulting** — a dozen settings have declared defaults.
3. **Transformation** — `trustProxy` refines a string to `false` or a hop
   count, rejecting the literal `"true"`.
4. **Cross-field invariants** — `CONNECTION_TIMEOUT_MS > REQUEST_TIMEOUT_MS`,
   plus the production-only refinement behind the three deployment
   preconditions.

Only (1)'s *rejection* half is type validation. Delete the schema naively and
`PORT` becomes the string `"3000"`, and — the serious one — `TRUST_PROXY="false"`
becomes the **truthy string** `"false"`. Fastify would then trust
`X-Forwarded-For` from any client, every per-address rate limit would key on a
forgeable header, and the sign-in limiter in `modules/auth/routes.ts` would
become bypassable. The file's own comment names this exact failure. It would
not announce itself; the server boots and serves traffic.

So: a hand-written `loadEnv()` performing the same coercions and the same two
refinements, keeping the throw-on-invalid behaviour for the production
preconditions. FR-012 states this and SC-005 measures it.

**Alternatives considered**:

- *Delete the schema outright and read `process.env` directly.* The literal
  reading of the request. Rejected as an unflagged security regression rather
  than a validation removal — and rejecting it does not narrow the feature,
  because coercion is not type validation.
- *Keep Zod for env only.* Defensible, and contradicts FR-009.

---

## R8. The boot gate

**Decision**: Amend the `onReady` gate in `server/src/plugins/11-rbac.js` to
drop the response-schema condition and keep the `config.auth` condition. One
change, in one place, in a diff.

**Rationale**: The gate at line 166 refuses to boot when
`declaresResponse(route)` is false. Remove the 31 response schemas and all 38
routes offend at once, so the server never starts. There are only two honest
options: change the gate, or keep the schemas.

Changing the gate is preferred over the alternatives because it is **visible**.
It appears once, in a file whose purpose is to state what the platform
guarantees, and a reviewer reading that diff learns that the guarantee is gone.

The `config.auth` half of the gate survives untouched, and with it Principle II
— every route still declares an access posture, and making a route public is
still an affirmative act that shows up in a diff. Of the four boot gates named
in CLAUDE.md, this feature removes one; auth posture, budget summation and
dependency fallbacks are unaffected.

**Alternatives considered**:

- *Stamp a placeholder `config.produces` on every route to satisfy the gate.*
  Rejected outright. It preserves a green gate that checks nothing — worse than
  no gate, because the next reviewer believes it.
- *Delete the gate entirely.* Discards the auth-posture check, which nothing in
  this feature asks for.

---

## R9. The OpenAPI document

**Decision**: Withdraw it. Unregister `@fastify/swagger`, `@fastify/swagger-ui`
and the `/admin/docs` and `/swagger-ui` mounts. Record the withdrawal in
CLAUDE.md.

**Rationale**: `15-openapi.js` derives the document from the same Zod objects
the runtime compiles, and its header comment explains precisely why: a
hand-maintained description "is the one nothing breaks when it drifts, so it
drifts first and quietly." Remove the schemas and the generator has no input.
The remaining choices are to serve an empty document, to hand-maintain the very
artefact that comment argues against, or to withdraw the surface.

Withdrawal is the only one that does not ship a lie. A `/admin/docs` that
renders 38 paths with no request or response shapes is worse than a 404,
because it looks like documentation.

Withdrawal also removes the encapsulated-scope posture machinery for
swagger-ui's assets that CLAUDE.md warns about at length — a genuine
simplification, and the only place in this feature where removal makes
something smaller rather than weaker.

**Alternatives considered**:

- *Generate OpenAPI from TypeScript types.* Requires a build-time extractor,
  reintroducing the build step R1 avoids, to rebuild what R6 deletes.
- *Keep Zod in the route `schema` for documentation only.* Fastify would
  validate with it, which is the thing being removed.

---

## R10. Business rules currently wearing a schema

**Decision**: Preserve them as explicit checks. One case is known:
`altSchema.safeParse()` in `modules/media/controller.js`, enforcing alt text of
1–300 characters at ingest. It becomes a hand-written length check raising the
same `MediaRejected(PROBLEMS.VALIDATION_FAILED, ...)`.

**Rationale**: §10.1 requires alt text, and the controller comment records *why*
it is required at ingest rather than backfilled: "Discovering it is missing at
publish time means going back to whoever uploaded it weeks earlier." That is an
accessibility and editorial rule that happens to be spelled as a schema. It is
not type validation, and dropping it would be an unrequested product change.

A per-schema audit is a planned task, because `altSchema` was found by reading
the three `.parse`/`.safeParse` call sites and the other 38 schemas are applied
declaratively through `schema: {}` — where a `.min(1)`, a `.max()` or an
`.email()` is a business rule in exactly the same disguise.

**Alternatives considered**: Dropping them with the schemas. That is how a
migration silently becomes a behaviour change.

---

## R11. What the server loses, stated plainly

**Decision**: Record these as accepted consequences rather than discovering
them in review. No mitigation is planned for the first three; they are the
feature.

1. **Untrusted input reaches handlers unshaped.** 21 request-body schemas go.
   `request.body` becomes whatever was posted, typed by declaration. A cast to
   the body type is an assertion the runtime does not check.
2. **Responses are no longer shaped on the way out.** 31 response schemas go.
   Fastify falls back to `JSON.stringify` on whatever the handler returns, so a
   column added to a query later reaches the client. This is the protection
   Principle VI names — "so a column added later cannot leak" — and it is
   removed, not relocated. The `SELECT`s that feed these handlers become the
   only thing standing between a new database column and a member-facing
   response.
3. **Serialization gets slower.** The response schemas compile to
   `fast-json-stringify` serializers; `JSON.stringify` replaces them. Not a
   correctness issue, but it is a performance regression in the direction
   nobody expects from a typing change, and it is worth measuring once against
   the existing budgets before assuming it is noise.
4. **Redaction is unaffected.** Principle VI's other clause — credentials and
   contact details must not appear in logs or bodies — is enforced centrally in
   `plugins/01-logging.js`, not by response schemas. It survives, and
   `tests/ops/logging-redaction.test.js` still covers it, though that suite
   imports `zod` today and needs retargeting.
5. **Unaffected entirely**: upload content inspection (`media/validate.js`
   reads magic bytes — no type system can do that), authorization resolution,
   rate limiting, deadline budgets, breaker fallbacks, quota counters under row
   lock, and every database constraint and trigger. Principles III, IV and V
   are untouched by this feature.

---

## R12. Sequencing

**Decision**: Constitution amendment → contracts → server → client → validation
removal. Convert everything to TypeScript *first*, remove Zod *last*.

**Rationale**: Removing the schemas mid-conversion leaves the platform with
neither compile-time nor runtime type discipline for the length of the
migration, on a branch someone may need to ship from. Converting first means
every intermediate commit has at least one of the two.

Contracts leads because both other workspaces import it, and its types are what
make the server and client conversions mechanical rather than exploratory.

Within the server, `allowJs: true` is used on the branch so partially converted
states type-check, and FR-006 removes it in the final commit. The rename and
the specifier rewrite for any given file must land together (R2).

**Alternatives considered**: Removing Zod first to shrink the surface to
convert. It would delete the 41 schemas that are the best available source for
the 41 types replacing them.

---

## R13. Lint

**Decision**: `typescript-eslint` in both `eslint.config.js` files, keeping the
existing rule sets and the React Hooks and React Refresh plugins in the client.

**Rationale**: Both workspaces already run flat-config ESLint 10. Adding the TS
parser and plugin preserves every rule currently enforced; without it, ESLint
parses `.ts` as JavaScript and silently stops covering the whole tree.

**Rule worth adding**: `@typescript-eslint/no-explicit-any`. The failure mode
of a large migration is not type errors, it is `any` sprayed to make them stop,
and SC-002's value depends on the checker actually having something to check.

---

## R14. The constitutional amendment

**Decision**: Amend `.specify/memory/constitution.md` to **2.0.0** before the
removal commits merge, per the document's own procedure.

**Rationale**: Governance states that amendments must name the principle, the
rationale, the migration path, and — for an amendment that weakens a principle
— "what replaces the protection it removes." Versioning policy classifies a
downgraded MUST as MAJOR. Three clauses are affected:

| Clause | Today | After |
|---|---|---|
| Principle VI | "Responses MUST be serialized through an explicit schema, so a column added later cannot leak" | Nothing enforces response shape; handler return values are serialized as-is |
| Principle I | "Request and response schemas... MUST live in one shared package that every client imports" | Types live in the shared package; schemas no longer exist |
| Tech Baseline | "Configuration MUST be validated at startup, and an invalid value MUST prevent boot" | Partially retained — production preconditions still throw (R7), general type validation does not |

The honest answer to "what replaces the protection" is, for the first clause,
*nothing*. The amendment should say that rather than reach for a substitute,
and the Workflow section's "every principle is verifiable" requirement means
the automated checks tied to the removed MUSTs must be withdrawn in the same
change rather than left failing.

Features 001–006 each recorded a Constitution Check against the superseded
text. The SYNC IMPACT REPORT header must state whether those remain valid —
the precedent is there, since the 1.0.0 report already handled feature 002's
now-void "PASS (vacuous)".

**Alternatives considered**: Merging the removal and amending afterwards.
Governance forbids it in terms: amendments "are never made implicitly by a
feature that declines to comply."
