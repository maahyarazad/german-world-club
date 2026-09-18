---

description: "Task list for 007 — TypeScript migration and runtime validation removal"
---

# Tasks: TypeScript Migration and Runtime Validation Removal

**Input**: Design documents from `/specs/007-typescript-migration/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The spec requests them explicitly — SC-003 requires every retargeted suite to be itemised, SC-008 requires every removed rejection to be visible, and `contracts/http-boundary-contract.md` assertion 6 requires a test per preserved rule. CLAUDE.md additionally requires a counter-assertion wherever a test would otherwise pass against a server that did nothing.

**Organization**: Grouped by user story. US1 gates US4. US2 is the MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US4 from spec.md
- Exact file paths in every task

## Path Conventions

Three npm workspaces: `server/`, `client/`, `packages/contracts/`. `expo-client/` is already TypeScript and out of scope.

## The one rule that governs every conversion task

**A rename and its importers' specifier rewrites land in the same commit.** Node does not resolve `./x.js` to `x.ts` (research.md R2, verified). A rename without the rewrite produces a server that does not start. Every task below that says "convert" means: rename, rewrite the specifiers *inside* the file, and rewrite the specifiers in every file that imports it.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Toolchain and the baseline that makes "no behaviour changed" measurable

- [X] T001 Capture the pre-migration baseline: run `npm test` and `npm run -w server verify:seo` with `DATABASE_URL` and `REDIS_URL` set, saving output to `/tmp/baseline-tests.txt` and `/tmp/baseline-seo.txt` per quickstart.md Scenario 0. A green run with no database is not a baseline — confirm the SQL suites actually ran.
- [X] T002 Verify the runtime accepts TypeScript: `node -v` reports ≥ 22.18 and a probe `.ts` file runs unflagged (quickstart.md Scenario 1). If this fails, stop — research.md R1's no-build-step approach is unavailable and the fallback rewrites all eleven server npm scripts.
- [X] T003 Install `typescript@^7.0.2` and `typescript-eslint` as root devDependencies in `package.json`. Root only — no workspace gains a TypeScript runtime dependency, so `server`'s production dependency list is unchanged.
- [X] T004 [P] Create `tsconfig.base.json` at the repository root with the exact settings in `contracts/tsconfig-contract.md`: `noEmit`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `strict`, `noUncheckedIndexedAccess`, `module`/`moduleResolution: nodenext`.
- [X] T005 [P] Create `server/tsconfig.json` extending the base, with `allowImportingTsExtensions: true`, `types: ["node"]`, and `include` covering **both** `src/**/*.ts` and `tests/**/*.ts`.
- [X] T006 [P] Create `packages/contracts/tsconfig.json` extending the base with `allowImportingTsExtensions: true`.
- [X] T007 [P] Create `client/tsconfig.json` extending the base with `jsx: react-jsx`, `moduleResolution: bundler`, DOM libs, and `types: ["vite/client", "vitest/globals", "@testing-library/jest-dom"]`. No `allowImportingTsExtensions` — client imports go extensionless.
- [X] T008 Create the root `tsconfig.json` solution file with project references to all three workspace configs.
- [X] T009 Add `"typecheck": "tsc --noEmit -p ."` to the root `package.json` scripts and wire it into `"test"` so a type error fails the suite.
- [X] T010 Set `allowJs: true` temporarily in `server/tsconfig.json`, `client/tsconfig.json` and `packages/contracts/tsconfig.json` so partially-converted states type-check. T115 removes it; FR-006 forbids it in the final commit.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Prove the checker actually checks, before 254 files depend on it

**⚠️ CRITICAL**: No conversion work begins until T013–T015 have passed. A type checker that silently checks nothing is the primary failure mode of a migration this size.

- [X] T011 [P] Add the `typescript-eslint` parser and plugin to `server/eslint.config.js`, preserving every existing rule. Without it ESLint parses `.ts` as JavaScript and silently stops covering the tree. This file stays `.js` (named exclusion under SC-001).
- [X] T012 [P] Add `typescript-eslint` to `client/eslint.config.js`, preserving the React Hooks and React Refresh plugins. Stays `.js` (named exclusion).
- [X] T013 Counter-assertion — the checker sees test files: introduce a deliberate type error in a file under `server/tests/`, confirm `npm run typecheck` **fails**, then revert. If it passes, `tests/**` is missing from `include` and 92 test files are unchecked (research.md R5).
- [X] T014 Counter-assertion — non-erasable syntax is caught at compile time: add `enum E { A }` to `server/src/config/budgets.js`, confirm `npm run typecheck` **fails** with an `erasableSyntaxOnly` error rather than only failing at runtime, then revert.
- [X] T015 Counter-assertion — specifier resolution: create two throwaway `.ts` files, one importing `./dep.js` and one importing `./dep.ts`, and confirm the first fails with `ERR_MODULE_NOT_FOUND` and the second runs. This is the behaviour every conversion task depends on (research.md R2).
- [X] T016 Add `@typescript-eslint/no-explicit-any` as an error in `server/eslint.config.js` and `client/eslint.config.js`. SC-002's value depends on the checker having something to check; the failure mode of a large migration is `any` sprayed to silence it.
- [X] T017 Write a repeatable specifier-rewrite helper in the scratch directory that rewrites `from './x.js'` → `from './x.ts'` across a given path, for the 404 server and 2 contracts specifiers. Not committed to the repo — it is migration tooling, not platform code.
- [X] T018 Record the current specifier counts as a progress metric: `grep -rn "from '\..*\.js'" server/src server/tests packages/contracts/src | wc -l` should read 406 now and 0 at T115.

**Checkpoint**: The toolchain is proven to catch errors. Conversion can begin.

---

## Phase 3: User Story 1 - Governance record matches the code (Priority: P1) 🚧 GATE

**Goal**: Amend `.specify/memory/constitution.md` so it describes the platform this feature produces, under the procedure the document itself specifies.

**Independent Test**: A reviewer reads the amended constitution alone, with no access to the diff, and correctly states which runtime protections the platform no longer provides and what stands in their place.

**⚠️ This phase BLOCKS Phase 6 (US4).** Governance: amendments "are never made implicitly by a feature that declines to comply." US2 and US3 do not depend on it and may proceed in parallel.

- [ ] T019 [US1] Amend Principle VI in `.specify/memory/constitution.md`: the clause "Responses MUST be serialized through an explicit schema, so a column added later cannot leak" is removed. State what replaces the protection — the honest answer is *nothing*, and the amendment should say so rather than reach for a substitute. Record the surviving obligation from `contracts/http-boundary-contract.md`: queries in `application/` name their columns explicitly.
- [ ] T020 [US1] Amend Principle I in `.specify/memory/constitution.md`: "Request and response schemas... MUST live in one shared package" becomes types in one shared package. Preserve the surviving guarantee — one definition per shape — and note that no client ever imported a schema to validate with (research.md R6), so the practical loss is server-only.
- [ ] T021 [US1] Amend the Technology & Security Baseline configuration clause in `.specify/memory/constitution.md`: startup validation is now partial. The three production deployment preconditions still throw; general type validation of environment values does not. This is the narrowest of the three violations and the amendment should say exactly where the line now falls.
- [ ] T022 [US1] Update the SYNC IMPACT REPORT header in `.specify/memory/constitution.md` with the version change, the bump rationale, the three modified clauses, and the migration path for features 001–006, each of which recorded a Constitution Check against the superseded text. The 1.0.0 report's handling of feature 002's void "PASS (vacuous)" is the precedent to follow.
- [ ] T023 [US1] Set the version line in `.specify/memory/constitution.md` to `2.0.0` with `**Last Amended**: 2026-09-18`. MAJOR is required by the document's own versioning policy — "a MUST is downgraded."
- [ ] T024 [US1] Identify every automated check tied to the three removed MUSTs and list them in the amendment for withdrawal in Phase 6. The Workflow section requires each principle to have a passing check; a red suite nobody is allowed to fix is worse than a withdrawn one. Start from `server/tests/authz/route-posture.test.js` and `server/tests/ops/openapi-ui.test.js`.
- [ ] T025 [US1] Update `CLAUDE.md` where the amendment falsifies it: the "Four gates refuse to boot" list loses the response-schema gate (three remain), and the `packages/contracts` rationale changes from schemas to types. Leave the TypeScript convention line for T113, which has the conversion facts.
- [ ] T026 [US1] Verify the independent test: hand the amended `constitution.md` and `CLAUDE.md` to a reader with no access to the diff and confirm they can state the three removed protections. If they cannot, the amendment is not done (quickstart.md Scenario 11).

**Checkpoint**: Governance is in order. Phase 6 is unblocked.

---

## Phase 4: User Story 2 - Compiler finds every caller (Priority: P1) 🎯 MVP

**Goal**: Convert `packages/contracts` and `client` to TypeScript. A field renamed in the shared package produces a compile error in every consuming client file.

**Independent Test**: Rename one exported field in `packages/contracts`, run `npm run typecheck`, confirm the error list names every consuming file, revert.

**Why this is the MVP**: The client is the control case. Research R6 established that all ten of its `@gwc/contracts` import sites are constants and helper functions — not one imports a schema to validate with. So the client's runtime behaviour must be *identical* before and after, and any behavioural difference observed in this phase is a conversion defect, not a consequence of the feature.

### Tests for User Story 2

- [ ] T027 [P] [US2] Convert `client/tests/helpers/` (1 file) to TypeScript so the remaining client test conversions have typed helpers to build on.
- [ ] T028 [P] [US2] Convert `client/tests/` root suites (14 files) to `.ts`/`.tsx`, rewriting relative specifiers to extensionless form.
- [ ] T029 [P] [US2] Convert `client/tests/console/` (2 files) and `client/tests/a11y/` (1 file) to `.tsx`.
- [ ] T030 [US2] Run `npm run -w client test` and diff against `/tmp/baseline-tests.txt` from T001. Expect zero differences — the client has no runtime validation to lose, so any change here is a conversion defect.

### Implementation for User Story 2

- [ ] T031 [P] [US2] Convert `packages/contracts/src/errors.js` → `errors.ts`. `PROBLEMS` and `PROBLEM_KEYS` are runtime values and survive unchanged; add `as const` and derive a `ProblemType` union.
- [ ] T032 [P] [US2] Convert `packages/contracts/src/permissions.js` → `permissions.ts`. Add `as const` to `AUDIENCES`, `TOKEN_AUDIENCES`, `FLAGS`, `MODULES`, `MEMBER_PERMISSIONS`, `MEMBER_STATUSES` and derive `Audience`, `Flag`, `Module` unions via `typeof X[number]`. Keep `isModule` and `isFlag` as **type predicates** (`value is Module`) — data-model.md §3 explains why they are not redundant: their inputs come from the database and from tokens, which the compiler never saw.
- [ ] T033 [P] [US2] Convert `packages/contracts/src/capabilities.js` → `capabilities.ts`. `CONSOLE_KINDS`, `HOME_FOR_KIND`, `hasGrant`, `hasAnyGrant`, `isAvailable` survive as runtime exports. The four schemas become types (data-model.md §2).
- [ ] T034 [US2] Convert `packages/contracts/src/auth.js` → `auth.ts`. 14 schemas → 14 types. All nine TTL/attempt constants and `COOKIES`, `SIGN_IN_OUTCOMES`, `ACCESS_TOKEN_CLAIMS` survive. **Do not delete the rule bodies yet** — Phase 6 needs them as the source for the hand-written checks; leave the Zod definitions in place alongside the new types until T086.
- [ ] T035 [P] [US2] Convert `packages/contracts/src/media.js` → `media.ts`. 9 schemas → 9 types; `ASSET_KINDS`, `ASSET_STATES`, `VARIANTS`, `FORMATS`, `BREAKPOINT_WIDTHS`, `MEDIA_MAX_BYTES`, `MEDIA_MAX_PIXELS`, `DELIVERY_CACHE_CONTROL` survive.
- [ ] T036 [P] [US2] Convert `packages/contracts/src/push.js` → `push.ts`. 10 schemas → 10 types; `PUSH_PROVIDERS`, `PUSH_PLATFORMS`, `TITLE_MAX`, `BODY_MAX`, `DESTINATION_TYPES` survive — `TITLE_MAX` and `BODY_MAX` are consumed by the hand-written checks in T090, so they must not be removed with their schemas.
- [ ] T037 [P] [US2] Convert `packages/contracts/src/seo.js` → `seo.ts`. 4 schemas → 4 types. These are the easiest in the package: data-model.md §4d established they are wired to no route, so nothing at runtime changes.
- [ ] T038 [US2] Update `packages/contracts/package.json`: all seven `exports` subpaths point at `.ts`. Leave the `zod` dependency until T093.
- [ ] T039 [US2] Apply the naming rule across the package: `xxxSchema` → `Xxx` for all 41 types (`contracts/shared-types-contract.md`). No `Schema`-suffixed type name may survive — a surviving one means a schema survived.
- [ ] T040 [P] [US2] Convert `client/src/lib/` (4 files: `api.js`, `capabilities.jsx`, `format.js`, `problems.js`) to `.ts`/`.tsx`. `ApiError extends Error` converts as a plain rename.
- [ ] T041 [P] [US2] Convert `client/src/i18n/` (4 files: `de.js`, `en.js`, `index.jsx`, `locales.js`) to `.ts`/`.tsx`. Type the catalogue so `de.ts` and `en.ts` must agree on keys structurally — this makes `npm run -w client test:i18n` a compile error in one direction as well as a test failure.
- [ ] T042 [P] [US2] Convert `client/src/components/ui/` (9 files) to `.tsx`, typing props.
- [ ] T043 [P] [US2] Convert `client/src/auth/` (3 files) to `.tsx`.
- [ ] T044 [US2] Convert `client/src/console/` (5 files) and `client/src/console/admin/` (1 file) to `.tsx`. `RequireGrant` and `Sidebar` consume `hasGrant`/`hasAnyGrant`/`isAvailable` and are where the contracts types first pay off.
- [ ] T045 [US2] Convert `client/src/konsole.jsx` → `konsole.tsx` and update the entry reference in `client/konsole.html`.
- [ ] T046 [P] [US2] Convert `client/scripts/check-tokens.mjs` and `check-i18n.mjs` to `.ts`, updating the `test:tokens` and `test:i18n` script paths in `client/package.json`.
- [ ] T047 [US2] Convert `client/vite.config.js` → `vite.config.ts` and `client/dev-server.js` → `dev-server.ts`, keeping all three build entries (`index.html`, `en.html`, `konsole.html`) and the `consoleFallback` plugin and API proxy unchanged.
- [ ] T048 [US2] Rewrite every client relative specifier: 28 `.js` and 70 `.jsx` become extensionless (research.md R2 — the client rule differs from the server's on purpose, because Vite resolves specifiers).
- [ ] T049 [US2] Run `npm run typecheck` and confirm `packages/contracts` and `client` are clean.
- [ ] T050 [US2] Verify the story: rename one exported field in `packages/contracts/src/auth.ts`, run `npm run typecheck`, confirm every consuming client file is named in the error output, revert. Then run `npm run -w client build` and confirm all three entries emit.

**Checkpoint**: Two of three workspaces are TypeScript. The compiler enforces the shared contract. This is a shippable increment — the server is untouched and still runs.

---

## Phase 5: User Story 3 - No JavaScript left behind (Priority: P2)

**Goal**: Convert `server/` — 194 files, the bulk of the codebase — and remove `allowJs`.

**Independent Test**: `find server/src server/tests -name '*.js'` returns nothing but the named exclusions, and `npm run -w server dev` boots.

**Depends on**: Phase 4 (contracts types must exist first — research.md R12).

**Sequencing within this phase**: leaf-first. `application/` directories are framework-free and take plain arguments, so they convert with the least friction; `plugins/` and `app.ts` come last because everything imports them.

- [ ] T051 [P] [US3] Convert `server/src/config/` (4 files) to `.ts`. **Do not touch the Zod schema in `env.ts` yet** — T083 owns that and it is the highest-risk change in the feature. This task is a rename plus types only.
- [ ] T052 [P] [US3] Convert `server/src/db/` (4 files) to `.ts`, including `counters.ts` (`QuotaExceededError extends Error`) and `migrate.ts`. Update the `migrate`/`migrate:down` script paths in `server/package.json`.
- [ ] T053 [P] [US3] Convert `server/src/authz/` (3 files) to `.ts`. `AuthorizationError extends Error` and `guardOrganisationScope` — the 404-not-403 object guard — convert as plain renames with types.
- [ ] T054 [P] [US3] Convert `server/src/modules/auth/application/` (10 files) to `.ts`, typing arguments from the new `@gwc/contracts/auth` types.
- [ ] T055 [P] [US3] Convert `server/src/modules/media/application/` (3 files) to `.ts`.
- [ ] T056 [P] [US3] Convert `server/src/modules/seo/application/` (3 files) to `.ts`.
- [ ] T057 [P] [US3] Convert `server/src/modules/push/application/` (3 files) to `.ts`.
- [ ] T058 [P] [US3] Convert `server/src/modules/public/application/` (2 files) and `server/src/modules/organisations/application/` (1 file) to `.ts`.
- [ ] T059 [P] [US3] Convert `server/src/modules/public/templates/` (7 files) to `.ts`. These render the no-JavaScript landing pages — the output must be byte-identical.
- [ ] T060 [US3] Convert `server/src/modules/auth/` routes, controller and the remaining 4 files to `.ts`. Leave the `schema:` blocks intact — Phase 6 removes them.
- [ ] T061 [US3] Convert `server/src/modules/media/` (9 files) to `.ts`, including `validate.ts` (`MediaRejected extends Error`, magic-byte inspection). The content inspection is **not** type validation and is not touched by this feature (research.md R11.5).
- [ ] T062 [US3] Convert `server/src/modules/seo/` (6 files) to `.ts`. `build-page-meta.ts` carries the JSDoc annotation at line 51 that references `contentRecordSchema`; replace it with a real `ContentRecord` parameter type (data-model.md §4d).
- [ ] T063 [US3] Convert `server/src/modules/push/` (3 files) and `server/src/modules/organisations/` (2 files) to `.ts`.
- [ ] T064 [US3] Convert `server/src/modules/public/` (3 files) to `.ts`.
- [ ] T065 [P] [US3] Convert `server/src/integrations/` (5 files) to `.ts`, including `payments.ts` (`CardDeclinedError extends Error`). Declared fallbacks and breaker wiring are unchanged.
- [ ] T066 [P] [US3] Convert `server/src/ops/` (4 files) to `.ts`.
- [ ] T067 [P] [US3] Convert `server/src/decorators/` (5 files) and `server/src/hooks/` (3 files) to `.ts`.
- [ ] T068 [P] [US3] Convert `server/src/seed/` (12 files) to `.ts`. `tables.ts` is the manifest that `tests/seed/no-live-credentials.test.ts` checks **statically against the seeder's source** — confirm that static check still resolves the renamed file, or it silently stops enforcing that sessions and reset tokens are never seeded.
- [ ] T069 [US3] Convert `server/src/plugins/` (16 files) to `.ts`. The numbered filenames are load-bearing — `00-` through `15-` encode registration order and must be preserved exactly. Do not touch the `onReady` gate in `11-rbac.ts` (T081) or `15-openapi.ts` (T082).
- [ ] T070 [US3] Convert `server/src/app.js` → `app.ts` and `server/src/server.js` → `server.ts`. Update `main` and every one of the eleven scripts in `server/package.json` to `.ts` paths.
- [ ] T071 [P] [US3] Convert `server/src/scripts/` (4 files) to `.ts` and update the `seed:demo`, `seed:dev`, `keys:generate`, `token:mint` and `verify:seo` script paths. `seed-demo.ts` has a production gate that runs **before** `loadEnv()` — confirm it still runs first after conversion.
- [ ] T072 [US3] Rewrite all 404 server relative specifiers from `.js` to `.ts` using the T017 helper, then confirm `grep -rn "from '\..*\.js'" server/src` returns 0.
- [ ] T073 [US3] Convert `server/vitest.config.js` → `vitest.config.ts` and change the coverage `include` glob from `src/**/*.js` to `src/**/*.ts`. Keep `pool: 'forks'` and `maxWorkers: 1` — the Postgres suites share one scratch database.
- [ ] T074 [P] [US3] Convert `server/tests/helpers/` (4 files) and `server/tests/fixtures/` (1 file) to `.ts` first — every other suite imports them.
- [ ] T075 [P] [US3] Convert `server/tests/auth/` (11 files) to `.ts`.
- [ ] T076 [P] [US3] Convert `server/tests/media/` (12 files) and `server/tests/seed/` (12 files) to `.ts`.
- [ ] T077 [P] [US3] Convert `server/tests/seo/` (12 files) and `server/tests/resilience/` (6 files) to `.ts`.
- [ ] T078 [P] [US3] Convert `server/tests/authz/` (6 files), `server/tests/ops/` (5 files), `server/tests/http/` (1), `server/tests/console/` (1), `server/tests/db/` (1) and the 2 root suites to `.ts`.
- [ ] T079 [US3] Run `npm run -w server dev` and confirm the server boots (quickstart.md Scenario 2). An `ERR_MODULE_NOT_FOUND` naming a `.js` path means a rename landed without its rewrite.
- [ ] T080 [US3] Run `npm test` and diff against `/tmp/baseline-tests.txt` from T001. Expect zero differences — Phase 5 changes no behaviour at all. Any failure here is a conversion defect and must be fixed before Phase 6 begins, because Phase 6 deliberately changes behaviour and would mask it.

**Checkpoint**: The entire codebase is TypeScript and behaves identically. This is the last point at which "no behaviour changed" is a meaningful assertion.

---

## Phase 6: User Story 4 - Runtime type validation removed (Priority: P2)

**Goal**: Remove Zod, replace the 21 rules that must survive, and record a decision for the other 15.

**Independent Test**: `grep -rn "from 'zod'"` over all three workspaces returns nothing, and the server boots and serves.

**Depends on**: Phase 3 (governance gate) and Phase 5 (convert first, remove last — research.md R12).

### Structural changes

- [ ] T081 [US4] Amend the `onReady` gate in `server/src/plugins/11-rbac.ts`: remove the `declaresResponse(route)` condition, keep `validateAuthConfig(route.config?.auth)`. One deliberate change in one file, so a reviewer reading this diff learns the guarantee is gone (research.md R8). Do **not** stamp placeholder `config.produces` on routes to satisfy the gate — that leaves a green gate verifying nothing.
- [ ] T082 [US4] Delete `server/src/plugins/15-openapi.ts` and its registration in `server/src/app.ts`, removing the `/admin/docs` and development `/swagger-ui` mounts (research.md R9). Remove `@fastify/swagger` and `@fastify/swagger-ui` from `server/package.json`. This also removes the encapsulated-scope posture machinery CLAUDE.md warns about — the one place in this feature where removal makes something smaller rather than weaker.
- [ ] T083 [US4] Rewrite `server/src/config/env.ts` to keep **coercion, defaulting and cross-field invariants** by hand while removing type validation (research.md R7, FR-012). Preserve: string→number for `PORT` and every `*_MS` setting with its default; string→boolean where `bool` was used; the `TRUST_PROXY` transform to `false` or a hop count, still rejecting the literal `"true"`; the `CONNECTION_TIMEOUT_MS > REQUEST_TIMEOUT_MS` invariant; and the production refinement that throws when `TRUST_PROXY`, `CANONICAL_ORIGIN` or `KEEP_ALIVE_TIMEOUT_MS` is unset. **This is the highest-risk task in the feature.**
- [ ] T084 [US4] Preserve the token-minting strict check at `server/src/modules/auth/tokens.ts:40` as an explicit allowed-key check over the `claims` object (data-model.md §6b). Its removal would let a field added to `claims` by a later change ship inside every access token, readable by anyone holding one — an outbound disclosure path, not an inbound acceptance path.
- [ ] T085 [US4] Remove the 21 `schema.body`, the 31 `schema.response` and the `schema.params` declarations across all 38 routes in `server/src/modules/*/routes.ts`, and remove the `validatorCompiler`/`serializerCompiler` wiring from `server/src/app.ts`.
- [ ] T086 [US4] Delete the 41 Zod schema definitions from `packages/contracts/src/*.ts`, leaving the types from Phase 4 and every runtime constant and helper. Verify no `Schema`-suffixed export survives.

### Preserved rules — request-side (data-model.md §4a, §4b, §4c)

Each task replaces schema refinements with explicit checks that raise the same RFC 9457 problem type the schema produced. These are business and security rules, not type checks.

- [ ] T087 [US4] Preserve the 5 sign-in and OTP rules in `server/src/modules/auth/controller.ts`: `email` format and ≤ 320 chars; `password` 8–256 chars — **this is the entire password length policy and nothing else enforces it**; `deviceId` 1–128 chars on both sign-in and verify-otp; `code` matching `/^\d{4}$/`.
- [ ] T088 [US4] Preserve the 4 credential-path rules in `server/src/modules/auth/controller.ts`: `refreshToken` 16–512 chars; password-reset `email` format and ≤ 320; reset `token` 16–512; reset `password` 8–256. The reset path must enforce the same 8-character minimum as sign-in or it becomes the weaker door.
- [ ] T089 [US4] Preserve the media alt-text rule in `server/src/modules/media/controller.ts`: 1–300 characters after trim, raising `MediaRejected(PROBLEMS.VALIDATION_FAILED, ...)` exactly as `altSchema.safeParse` did. §10.1 requires alt text at ingest; the existing comment explains why it is not backfilled.
- [ ] T090 [US4] Preserve the 5 push campaign rules in `server/src/modules/push/controller.ts`: `title` and `body` trimmed, 1 to `TITLE_MAX`/`BODY_MAX`; `destinationId` ≤ 64; `destinationLabel` ≤ 200; device `token` 1–512.
- [ ] T091 [US4] Preserve the pagination rules in `server/src/modules/push/controller.ts` — **the sharpest case in the feature**. `campaignQuery.limit` was coerced from string, defaulted to 50, and bounded at 200, then passed into a SQL parameter at `application/campaign.ts:160`. All three must be hand-written: query strings are strings, so without this `limit` reaches SQL as `"50"` or as `undefined`, and `?limit=1000000` is served. Also coerce `isTest` — `"false"` is truthy.
- [ ] T092 [US4] Preserve the remaining identifier shapes in `server/src/modules/media/controller.ts` and `server/src/modules/push/controller.ts`: the `assetIdParam` and `deliveryLookupParam` route params, and `testRecipient.memberId` as a UUID. These flow into database lookups.

### Recorded deletions (data-model.md §7)

- [ ] T093 [US4] Record the deletion of the 3 response-side rules in `packages/contracts/src/auth.ts` (`csrfTokenResponse.csrfToken` min(1) at L106, `meResponse.package` int 1–3 at L131) and `packages/contracts/src/media.ts` (`asset.checksum` sha256 shape at L73) as covered by the accepted Principle VI loss, with a one-line note in the commit. No replacement.
- [ ] T094 [US4] Record the deletion of the 12 SEO metadata rules as a no-op: usage tracing found them wired to no route, so nothing at runtime changes (data-model.md §4d). No replacement.
- [ ] T095 [US4] Remove `zod` and `fastify-type-provider-zod` from `server/package.json` and `zod` from `packages/contracts/package.json`. The contracts package then has **no runtime dependencies at all**. Run `npm install` and confirm the lockfile drops them.

### Tests for User Story 4

- [ ] T096 [P] [US4] Retarget `server/tests/authz/route-posture.test.ts` to assert the amended gate: `config.auth` is still mandatory and a route without it refuses to boot; response schemas are no longer required. Keep the counter-assertion — remove `config.auth` from one route and confirm the server refuses (quickstart.md Scenario 8).
- [ ] T097 [P] [US4] Retarget `server/tests/http/error-envelope.test.ts` to build its problem payloads without Zod, preserving every RFC 9457 assertion.
- [ ] T098 [P] [US4] Retarget `server/tests/ops/logging-redaction.test.ts` to drop its Zod import. Redaction is enforced centrally in `plugins/01-logging.ts` and is unaffected by this feature — this suite must stay green.
- [ ] T099 [US4] Delete `server/tests/ops/openapi-ui.test.ts` — its subject is withdrawn by T082 — and add an assertion that `/admin/docs` and `/swagger-ui` both return 404 in every environment, so the withdrawal is tested rather than merely untested.
- [ ] T100 [P] [US4] Add tests in `server/tests/auth/` proving each of the 9 preserved auth rules still rejects: empty password, 7-character password on both sign-in and reset, non-numeric OTP, 5-digit OTP, malformed email, over-length email, short refresh token, short reset token. Each carries a counter-assertion that a valid value is accepted.
- [ ] T101 [P] [US4] Add tests in `server/tests/media/` proving alt text is still required and still bounded at 300 characters, and that the asset-id route param still rejects a malformed value.
- [ ] T102 [US4] Add tests in `server/tests/ops/push-pagination.test.ts` for the pagination rules: `GET /push/campaigns?limit=1000000` returns at most 200 rows; `GET /push/campaigns` with no `limit` returns 50 and does not error; `limit` reaches the application layer as a **number**, not a string. This last assertion is the one that catches the regression T091 exists to prevent.
- [ ] T103 [US4] Add tests for `loadEnv()` in `server/tests/ops/`: `TRUST_PROXY=false` yields boolean `false` and `typeof` is `'boolean'`; `PORT=3000` yields the number `3000`; omitted settings take their documented defaults; `CONNECTION_TIMEOUT_MS < REQUEST_TIMEOUT_MS` throws; and production with any of the three preconditions unset refuses to boot. The `typeof` assertions are the point — a string `"false"` passes a truthiness test and fails the platform.
- [ ] T104 [US4] Add a test in `server/tests/auth/token-claims.test.ts` proving the token-minting check from T084 still rejects an unexpected claim, so a future field added to `claims` cannot ship inside an access token unnoticed.
- [ ] T105 [US4] Add a lint rule or test asserting no `type`/`interface` in `server/src` or `client/src` describes a request or response body. Those live in `packages/contracts` only — this is the one Principle I guarantee that outlives the amendment (`contracts/shared-types-contract.md`), and after this feature nothing detects the divergence at runtime.
- [ ] T106 [US4] Add a test asserting no `SELECT *` on any path that reaches a response (`contracts/http-boundary-contract.md`). With response schemas gone, the query is the last thing standing between a new column and a member-facing response.
- [ ] T107 [US4] Run `npm test`, diff against `/tmp/baseline-tests.txt`, and write the itemised list SC-003 requires into the PR description: every suite whose result differs, named, with the reason. An aggregate count is not sufficient, and a deleted test is the cheapest way to make this pass dishonestly.

**Checkpoint**: Zod is gone. Every rule that survived is tested; every rule that did not is recorded.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T108 [P] Run quickstart.md Scenario 3's suppression audit: count `@ts-ignore`, `@ts-expect-error`, `: any` and `as any` across all three workspaces and justify each one line by line, or remove it.
- [ ] T109 [P] Measure the serialization change (research.md R11.3): compare p95 response times on the largest list endpoint against the existing route deadline budgets, now that `JSON.stringify` has replaced the compiled `fast-json-stringify` serializers. Record the number even if it is noise — it is a regression in the direction nobody expects from a typing change.
- [ ] T110 [P] Run `npm run -w server verify:seo` and diff against `/tmp/baseline-seo.txt` (SC-004).
- [ ] T111 [P] Run `npm run -w client build`, then open `client/index.html` and `client/en.html` with JavaScript disabled and confirm both render completely. No automated check covers this, and the Constitution's "Public rendering" clause depends on it.
- [ ] T112 [P] Run `npm run -w client test:i18n` and `test:tokens` and confirm the catalogues still agree in both directions.
- [ ] T113 Update `CLAUDE.md`: replace "ES modules, Node 22, no TypeScript in the server" with the TypeScript conventions — native type stripping, erasable syntax only, `.ts` specifiers on relative imports, `tsc --noEmit` as the checking gate. Add why `.js` specifiers do not work, so the next person does not rediscover R2 the hard way.
- [ ] T114 Update `server/README.md` where the three deployment preconditions are documented, reflecting that they are now enforced by hand-written checks rather than by schema refinement.
- [ ] T115 Remove `allowJs` from all three workspace tsconfigs (FR-006) and confirm `find server/src server/tests client/src client/tests client/scripts packages/contracts/src -name '*.js' -o -name '*.jsx'` returns nothing. The only permitted survivors are `server/eslint.config.js` and `client/eslint.config.js`, both named exclusions under SC-001.
- [ ] T116 Run `npm run lint` across all workspaces and confirm the TypeScript sources are actually covered — introduce a deliberate lint violation in `server/src/app.ts`, confirm it is caught, revert.
- [ ] T117 Execute quickstart.md end to end, all 11 scenarios, and record the result against the definition-of-done table.
- [ ] T118 Delete the stale worktree at `.claude/worktrees/speckit-impl-002/` if it is genuinely abandoned — it holds a full JavaScript copy of the pre-006 tree and will confuse every future `grep` for leftover `.js` files. Confirm with the repository owner before removing.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: no dependencies
- **Phase 2 (Foundational)**: depends on Phase 1 — **blocks all conversion work**
- **Phase 3 (US1, governance)**: depends on Phase 2 — **blocks Phase 6 only**
- **Phase 4 (US2, contracts + client)**: depends on Phase 2 — the MVP
- **Phase 5 (US3, server)**: depends on Phase 4 (needs contracts types)
- **Phase 6 (US4, removal)**: depends on Phase 3 **and** Phase 5
- **Phase 7 (Polish)**: depends on Phase 6

### User Story Dependencies

```
Setup → Foundational ─┬─→ US1 (governance) ──────────┐
                      │                              ├─→ US4 (removal) → Polish
                      └─→ US2 (contracts+client) → US3 (server) ───────┘
                            [MVP — shippable]    [full conversion]
```

- **US1** is fully independent of US2 and US3 and can run in parallel with them by a different person. It is documentation work, not code.
- **US2** is the MVP and ships on its own: the server is untouched and still runs.
- **US3** requires US2's contracts types.
- **US4** requires both US1 (governance permits it) and US3 (convert first, remove last).

### Within Each User Story

- Test helpers before the suites that import them (T027 before T028; T074 before T075–T078)
- `application/` before `routes`/`controller` (framework-free first)
- Modules before `plugins/` before `app.ts` (everything imports them)
- Renames and specifier rewrites in the same commit, always

### Parallel Opportunities

| Phase | Parallel tasks | Notes |
|---|---|---|
| 1 | T004–T007 | four independent tsconfigs |
| 2 | T011, T012 | two eslint configs |
| 4 | T031–T033, T035–T037 | six contracts modules, independent files |
| 4 | T040–T043, T046 | client directories, no shared files |
| 5 | T051–T058 | eight leaf directories, all framework-free |
| 5 | T065–T068, T071 | integrations, ops, decorators/hooks, seed, scripts |
| 5 | T074–T078 | five test directories after helpers land |
| 6 | T096–T098, T100, T101 | test retargets in different files |
| 7 | T108–T112 | five independent verification runs |

**Not parallelizable**: T034 and T039 (same package, ordering matters), T060–T064 (module routes depend on their own application layer), T069/T070 (everything imports them), T081–T086 (structural, sequenced), T087–T092 (two share `auth/controller.ts`, two share `push/controller.ts`).

---

## Parallel Example: User Story 2

```bash
# The six independent contracts modules:
Task: "Convert packages/contracts/src/errors.js → errors.ts (T031)"
Task: "Convert packages/contracts/src/permissions.js → permissions.ts (T032)"
Task: "Convert packages/contracts/src/capabilities.js → capabilities.ts (T033)"
Task: "Convert packages/contracts/src/media.js → media.ts (T035)"
Task: "Convert packages/contracts/src/push.js → push.ts (T036)"
Task: "Convert packages/contracts/src/seo.js → seo.ts (T037)"

# Then the client directories, once contracts types exist:
Task: "Convert client/src/lib/ to .ts/.tsx (T040)"
Task: "Convert client/src/i18n/ to .ts/.tsx (T041)"
Task: "Convert client/src/components/ui/ to .tsx (T042)"
Task: "Convert client/src/auth/ to .tsx (T043)"
```

---

## Implementation Strategy

### MVP (US1 + US2)

1. Phase 1 Setup → Phase 2 Foundational, **including the three counter-assertions T013–T015**
2. Phase 3 (US1) and Phase 4 (US2) in parallel — different people, no shared files
3. **STOP and VALIDATE**: `npm run typecheck` clean, client tests match baseline, contract rename names every caller
4. Shippable. The server is untouched JavaScript and still runs; the console is fully typed; governance is in order.

US1 is grouped into the MVP rather than treated as the MVP alone because on its own it delivers a document change and no working software. It is a gate, not an increment.

### Incremental Delivery

1. Setup + Foundational → toolchain proven
2. + US2 → contracts and client typed → **ship (MVP)**
3. + US3 → whole codebase typed, behaviour identical → **ship**
4. + US1 → governance amended → unblocks removal
5. + US4 → validation removed → **ship, with the itemised behaviour-change list**
6. + Polish

Steps 2 and 3 are behaviour-preserving and independently shippable. Step 5 is not: it deliberately changes behaviour, which is why T080 requires a clean baseline diff before Phase 6 starts — otherwise a conversion defect hides inside an intended change.

### Parallel Team Strategy

- **Developer A**: Phase 3 (US1) — documentation and governance, no code
- **Developer B**: Phase 4 (US2) — contracts, then client
- **Developers B + C**: Phase 5 (US3) — the server splits cleanly along T051–T058 and T074–T078
- **Developer B**: Phase 6 (US4) — must be one person; the 21 preserved rules need a single consistent judgement about what "explicit check" means

---

## Notes

- **[P] = different files, no dependencies.** Two tasks touching `auth/controller.ts` are never parallel.
- Commit after each task. For conversion tasks, the rename and its specifier rewrites are one commit.
- The two counter-assertion tasks in Phase 2 (T013, T014) are not optional ceremony — a type checker configured to check nothing is the primary way a migration this size fails silently.
- T083 and T091 are the two tasks whose failure does not announce itself. Both produce a server that boots and serves traffic while being wrong: a truthy `"false"` for `TRUST_PROXY`, and an unbounded `LIMIT`. Review both by hand, whatever the tests say.
- **Task count: 118**, T001–T118, 49 marked [P].

| Phase | Tasks | |
|---|---|---|
| 1. Setup | 10 | T001–T010 |
| 2. Foundational | 8 | T011–T018 |
| 3. US1 — governance | 8 | T019–T026 |
| 4. US2 — contracts + client | 24 | T027–T050 (MVP) |
| 5. US3 — server | 30 | T051–T080 |
| 6. US4 — removal | 27 | T081–T107 |
| 7. Polish | 11 | T108–T118 |
