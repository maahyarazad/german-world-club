# Implementation Plan: TypeScript Migration and Runtime Validation Removal

**Branch**: `007-typescript-migration` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-typescript-migration/spec.md`

## Summary

Convert all 254 JavaScript files (~29,200 lines) across `server`, `client` and
`packages/contracts` to TypeScript, then remove every runtime type validation —
including Zod — leaving compile-time types as the only type discipline.

The conversion runs on **Node's native type stripping** (verified working on
Node v22.23.2), so the platform keeps its defining property: there is no build
step. `tsc --noEmit` becomes a separate checking gate. The one significant
mechanical cost is that Node does not rewrite import specifiers, so all 404
relative `.js` specifiers on the server must be rewritten to `.ts` alongside
their renames (research.md R2).

The removal half is **not a pure deletion**. Three of the things being removed
are doing work no type annotation performs, and each is planned as a
replacement rather than a delete: environment coercion and defaulting (R7), the
alt-text business rule (R10), and the boot gate that would otherwise refuse to
start the server (R8). The OpenAPI document is withdrawn rather than left empty
(R9).

This feature knowingly violates three constitutional MUSTs. Governance requires
the amendment to land first, so it is US1 and blocks the removal phases.

## Technical Context

**Language/Version**: TypeScript 7.0.2 (`strict: true`), targeting Node 22 ESM.
Erasable syntax only — no `enum`, no namespaces, no parameter properties
(verified constraint of native type stripping; costs this codebase nothing,
see R1).

**Runtime**: Node v22.23.2. Native type stripping, unflagged. No loader, no
bundler, no emit on the server.

**Primary Dependencies**: Unchanged at runtime — Fastify 5, pg, pino, sharp,
argon2, React 19, Vite 8. **Removed**: `zod`, `fastify-type-provider-zod`,
`@fastify/swagger`, `@fastify/swagger-ui`. **Added** (devDependencies only):
`typescript`, `typescript-eslint`. `@types/react` and `@types/react-dom` are
already present.

**Storage**: PostgreSQL. Untouched — no migration, no schema change, no query
change. Constitution Principle IV is unaffected by this feature.

**Testing**: Vitest 5 in both workspaces, no transform config needed. Coverage
`include` glob changes from `src/**/*.js` to `src/**/*.ts`. `tsc --noEmit` must
cover `tests/` as well as `src/`, or 92 test files become an untyped island
(R5).

**Target Platform**: Linux server behind a proxy; evergreen browsers for the
console; the two public landing pages still execute no JavaScript.

**Project Type**: npm workspace monorepo — API + web client + shared contracts.
`expo-client/german-world-club` is already TypeScript and is not an npm
workspace; out of scope.

**Performance Goals**: No regression against existing route deadline budgets,
with one known exception to measure: removing the 31 response schemas replaces
compiled `fast-json-stringify` serializers with `JSON.stringify` (R11.3).

**Constraints**:
- Every file rename must land with its importers' specifier rewrites in the
  same commit; intermediate states do not run (R2).
- `TRUST_PROXY` coercion must survive the removal. `"false"` is a truthy
  string, and losing this silently makes every per-address rate limit
  forgeable (R7).
- The two landing pages must still render fully with JavaScript disabled.

**Scale/Scope**: 254 files, ~29,200 lines. 38 routes, 34 `schema:` blocks (21
request bodies, 31 responses), 41 exported contract schemas, 434 `.js` and 70
`.jsx` relative import specifiers, 6 server modules, 8 `Error` subclasses.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Phase 0

**Result: FAIL — three MUSTs violated.** Proceeding under Governance's
amendment procedure, which permits a violation only when it is "justified in
writing against the specific principle, with the simpler rejected alternative
named." That justification is in Complexity Tracking below, and the amendment
itself is FR-016, sequenced ahead of every removal task.

| Principle | Verdict | Detail |
|---|---|---|
| I. One Rule Set, Three Clients | **VIOLATED (narrow)** | "Request and response schemas... MUST live in one shared package that every client imports." Schemas cease to exist; types replace them in the same package. Every other clause holds: rules stay server-side, clients still import one package, capability data is still display-only, authorization outcome is still uniform. |
| II. Declare Every Posture | **PASS** | `config.auth` remains mandatory and the `onReady` gate still refuses to boot without it. Only the response-schema half of that gate is removed (R8). Crawl posture, server-side authorization resolution and object-guard enforcement are untouched. |
| III. Published State Must Match Real State | **PASS** | No change to routing, status codes, sitemap generation, canonical origin or slug handling. `verify:seo` is the check and is expected to stay green (SC-004). |
| IV. Integrity Lives In The Database | **PASS** | No migration, no query change. Row locks, quota counters, `DELETE` triggers and append-only audit grants are all database-level. |
| V. Failure Is Explicit And Bounded | **PASS** | Deadline budgets, the startup budget-summation gate, breaker fallbacks and rate limits are unchanged — **provided** R7's `TRUST_PROXY` coercion survives. If it does not, per-address limits silently stop working, which would convert this to a violation. |
| VI. The Server Shapes What Leaves It | **VIOLATED** | "Responses MUST be serialized through an explicit schema, so a column added later cannot leak." Removed with nothing in its place. Other clauses hold: derivatives still served (never originals), upload content inspection intact, central redaction intact, no member content rendered to unauthenticated requesters. |
| Tech Baseline — configuration | **VIOLATED (partial)** | "Configuration MUST be validated at startup, and an invalid value MUST prevent boot." Production deployment preconditions still throw (R7); general type validation of environment values does not. |
| Tech Baseline — public rendering | **PASS** | Landing pages keep inline content and styles and pull in no bundle. |
| Workflow — every principle verifiable | **ACTION REQUIRED** | The automated checks tied to the removed MUSTs must be withdrawn in the same change, not left failing. A red suite nobody is allowed to fix is worse than a withdrawn one. |

### Post-Phase 1 re-check

Design did not change the verdict. Four findings sharpen it:

1. **The client loses nothing.** All ten of the client's `@gwc/contracts`
   imports are constants and helper functions; not one imports a schema to
   validate with (R6). Principle I's violation is therefore narrower in
   practice than in text — the console never had runtime validation to lose.
2. **Principle VI's violation is wider than the spec implied.** Beyond the
   leak risk, `JSON.stringify` replacing `fast-json-stringify` is a measurable
   serialization regression (R11.3), which the constitution's payload-discipline
   rationale cares about directly.
3. **The removal is 33 decisions, not 41 deletions.** The contracts audit
   found 33 business rules encoded inside the schemas, where the spec assumed
   one. Twelve are security-relevant (the `min(8)` password policy, the
   four-digit OTP shape, email and token bounds), and two are
   coercion-and-default cases of the same class as R7 — one of which lands in a
   SQL `LIMIT` parameter. Usage tracing then reduced the enforced count to 20:
   the twelve SEO rules are wired to no route at all (one JSDoc reference is
   their only use), so Principle III's PASS does **not** depend on them. A
   twenty-first rule was found afterwards at `auth/tokens.js:40`, a strict check
   run when an access token is minted. This changes the feature's size, not its
   direction, and makes per-rule tasks mandatory (data-model.md §4, §6b, §7).
4. **Principle V has a new dependency.** Its PASS is conditional on R7 being
   implemented as a replacement rather than a deletion. This is the single
   highest-risk task in the feature and is isolated into its own phase with its
   own tests.

## Project Structure

### Documentation (this feature)

```text
specs/007-typescript-migration/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output — 14 findings
├── data-model.md        # Phase 1 output — schema→type mapping
├── quickstart.md        # Phase 1 output — validation guide
├── contracts/           # Phase 1 output
│   ├── tsconfig-contract.md
│   ├── shared-types-contract.md
│   └── http-boundary-contract.md
└── tasks.md             # Phase 2 — NOT created by /speckit-plan
```

### Source Code (repository root)

```text
tsconfig.json                     # NEW — solution file, project references
tsconfig.base.json                # NEW — strict, erasable-syntax-only settings

packages/contracts/
├── tsconfig.json                 # NEW
└── src/
    ├── auth.ts                   # 41 schemas → types (10 here)
    ├── capabilities.ts           # types + hasGrant/isAvailable survive
    ├── errors.ts                 # PROBLEMS survives as `as const`
    ├── media.ts                  # altSchema → explicit check (R10)
    ├── permissions.ts            # AUDIENCES/FLAGS/MODULES → const unions
    ├── push.ts
    └── seo.ts

server/
├── tsconfig.json                 # NEW — allowImportingTsExtensions
├── eslint.config.js              # + typescript-eslint
├── vitest.config.ts              # coverage glob → src/**/*.ts
└── src/
    ├── app.ts  server.ts
    ├── config/env.ts             # HIGHEST RISK — R7, own phase
    ├── plugins/                  # 16 files; 11-rbac.ts gate change (R8)
    │                             # 15-openapi.ts DELETED (R9)
    ├── decorators/  hooks/
    ├── modules/<domain>/         # auth media organisations public push seo
    │   ├── routes.ts             # schema: {} blocks removed
    │   ├── controller.ts
    │   └── application/          # framework-free; pure rename
    ├── authz/  db/  ops/  integrations/  seed/  scripts/
└── tests/                        # 74 files — convert, do not leave as .js

client/
├── tsconfig.json                 # NEW
├── vite.config.ts                # renamed; three entries unchanged
└── src/
    ├── auth/  components/ui/  console/   # .jsx → .tsx
    ├── i18n/                     # de.ts en.ts locales.ts index.tsx
    └── lib/                      # api.ts capabilities.tsx format.ts problems.ts

expo-client/                      # already TypeScript — OUT OF SCOPE
```

**Structure Decision**: The existing three-workspace layout is kept exactly.
Feature 006's `routes.js` / `controller.js` / `application/` split inside
`server/src/modules/<domain>/` is preserved file-for-file — this feature renames
and retypes, it does not reorganise. The `application/` directories are the
cheapest part of the migration because they are already framework-free and take
plain arguments.

Two files disappear rather than convert: `server/src/plugins/15-openapi.js`
(R9) and, from `packages/contracts`, nothing — every module survives, with
schemas replaced by types.

The only new top-level files are the two tsconfigs.

## Complexity Tracking

> Required by Governance: a violation must be justified in writing against the
> specific principle, with the simpler rejected alternative named.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **Principle VI** — responses no longer serialized through an explicit schema | Directly requested: remove all runtime type validation including Zod. Presented with the consequence — that a column added later reaches the client, which is the exact scenario the principle names — and reaffirmed. | *Keep response schemas and derive static types via `z.infer`.* This was the recommended option and was explicitly declined. It would have satisfied Principle VI unchanged while still delivering the whole TypeScript migration. |
| **Principle I** — schemas no longer live in the shared package | Follows unavoidably from removing Zod. The package survives and still holds one definition of every shape, now as types. | *Keep schemas in the package and export `z.infer` types alongside.* Declined with the above. Worth recording that the practical loss is server-only: no client ever imported a schema to validate with (R6). |
| **Tech Baseline** — configuration no longer type-validated at startup | Same decision. Scoped down as far as the request allows: the three production deployment preconditions still throw, and all coercion, defaulting and cross-field invariants are preserved by hand (R7). | *Keep Zod for `env.js` alone* — a 1-file exemption that would have preserved the clause entirely. Contradicts FR-009's "no source file imports zod", so it is recorded here rather than taken silently. |
| **Withdrawing `/admin/docs`** (not a violation; a capability loss) | The document is generated from the schemas being removed. Nothing in the constitution mandates an API reference, so this is a product regression rather than a governance one. | *Serve the document with paths but no shapes.* Rejected: it looks like documentation and is not. *Hand-maintain it* — rejected by the argument already written into `15-openapi.js`'s own header comment. |
| **Changing the boot gate** rather than satisfying it | With 31 response schemas gone, all 38 routes offend and the server cannot start. | *Stamp a placeholder `config.produces` on every route.* Rejected outright: it leaves a green gate that verifies nothing, which misleads the next reviewer more than an absent gate does. |

**Not justified here because not violated**: Principles II, III, IV and V hold,
with Principle V conditional on R7. Of the four boot gates in CLAUDE.md, three
survive: auth posture, budget summation, dependency fallbacks.
