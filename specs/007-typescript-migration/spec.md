# Feature Specification: TypeScript Migration and Runtime Validation Removal

**Feature Branch**: `007-typescript-migration`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "convert the entire code base from js to ts from javascript to typescript and remove any type validation that is in the code base"

## Clarifications

### Session 2026-09-18

- **Q**: How far does "remove any type validation" go? → **A**: All runtime validation, including Zod. Zod is stripped from routes, environment loading and the shared contracts package; TypeScript's compile-time types are the only type discipline that remains. The consequences were presented before the choice was made and were accepted: the `onReady` gate in `server/src/plugins/11-rbac.js` stops finding response schemas, the OpenAPI document loses its source, and three constitutional MUSTs are contradicted. The amendment required by Governance is therefore in scope as US1.
- **Q**: Where do the artifacts live? → **A**: A new feature directory, `specs/007-typescript-migration/`. Feature 006 is merged and its plan stays untouched.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The governance record matches what the code actually does (Priority: P1)

A reviewer opens `.specify/memory/constitution.md` and reads what the platform guarantees. Today it states as MUSTs that responses are serialized through an explicit schema, that request and response schemas live in one shared package, and that configuration is validated at startup so an invalid value prevents boot. After this feature, none of those three hold. The document has to say so, in its own amendment format, naming what replaces each protection it removes — otherwise the constitution describes a system that no longer exists and every later Constitution Check is performed against fiction.

**Why this priority**: Governance in this repository is explicit that "an unjustified violation blocks the change" and that amendments "are never made implicitly by a feature that declines to comply." Every other story in this feature is a violation of at least one MUST until this one lands. It is not documentation work that trails the code; it is the gate that unblocks it.

**Independent Test**: Read the amended constitution alone, with no access to the diff, and correctly state which runtime protections the platform no longer provides and what stands in their place. The version line has incremented per the stated MAJOR rule (a MUST is downgraded).

**Acceptance Scenarios**:

1. **Given** the constitution at 1.0.1, **When** the amendment is adopted, **Then** the version is 2.0.0, because Governance classifies a downgraded MUST as MAJOR.
2. **Given** the amended Principle VI, **When** a reviewer reads the serialization clause, **Then** it states what now prevents a column added later from leaking, or states plainly that nothing does.
3. **Given** the amended Technology & Security Baseline, **When** a reviewer reads the configuration clause, **Then** it states what now prevents boot on an invalid `TRUST_PROXY`, or states plainly that boot no longer fails.
4. **Given** the SYNC IMPACT REPORT header, **When** the amendment is adopted, **Then** it records the migration path for features 001–006, each of which recorded a Constitution Check against the superseded text.

---

### User Story 2 - A developer changes a shared contract and the compiler finds every caller (Priority: P1)

A developer renames a field on the session payload in the shared package. Today that rename is caught by Zod at runtime, in whichever client happens to exercise the path first. After this feature, `tsc --noEmit` names every file that reads the old field — server controller, console component, test fixture — before anything runs.

**Why this priority**: This is the whole return on the migration. It is also what the shared-contracts package was built to deliver, by a slower route: CLAUDE.md records that the package exists "so a field renamed in one place is a type error everywhere else rather than a runtime surprise in one client." The compiler makes that literal.

**Independent Test**: Rename one exported field in `packages/contracts`, run `tsc --noEmit` across all three workspaces, and confirm the error list names every consuming file. Revert.

**Acceptance Scenarios**:

1. **Given** the converted workspaces, **When** `tsc --noEmit` runs at the repository root, **Then** it exits zero with no `any` introduced by suppression comments in the counted set.
2. **Given** a deliberately mistyped call into `@gwc/contracts`, **When** the type check runs, **Then** it fails and names the file and line.
3. **Given** a converted workspace, **When** `npm test` runs, **Then** every suite that passed before the conversion passes after it, with the same assertions.

---

### User Story 3 - The whole codebase is TypeScript, with no JavaScript left behind (Priority: P2)

A developer opens any file under `server/src`, `server/tests`, `client/src`, `client/tests`, `client/scripts` or `packages/contracts/src` and finds TypeScript. No `allowJs` escape hatch remains once the migration completes, so a new `.js` file cannot quietly reappear.

**Why this priority**: A migration that stops at 90% leaves two toolchains, two lint configs and a permanent "which files are typed?" question. The value in US2 is only real for the files that actually type-check.

**Independent Test**: `find server client packages -name '*.js' -o -name '*.jsx'` returns nothing but generated output and config files that must stay JavaScript, and `allowJs` is absent from every tsconfig.

**Acceptance Scenarios**:

1. **Given** the completed migration, **When** the source tree is searched for `.js`/`.jsx` under the converted directories, **Then** only intentionally-excluded files are found and each is listed in the plan.
2. **Given** a new `.js` file added under `server/src`, **When** the build runs, **Then** it fails rather than silently ignoring the file.
3. **Given** the Expo client, which is already TypeScript, **When** the migration completes, **Then** it is unchanged except where it consumes the shared package.

---

### User Story 4 - Runtime type validation is gone (Priority: P2)

A request arrives at `POST /auth/sign-in`. Today its body is parsed by `signInRequestSchema` before the handler sees it, and the response is serialized through `signInResponseSchema`. After this feature neither schema exists; the handler receives whatever was posted, typed by declaration rather than by inspection.

**Why this priority**: This is the second half of the request. It is sequenced after US2 and US3 because removing the schemas while the code is still JavaScript leaves the platform with neither compile-time nor runtime type discipline for the duration of the migration.

**Independent Test**: Grep the converted tree for `zod`. The dependency is absent from all three `package.json` files and no source file imports it.

**Acceptance Scenarios**:

1. **Given** the converted server, **When** the dependency tree is inspected, **Then** `zod` and `fastify-type-provider-zod` are absent from `server/package.json` and `packages/contracts/package.json`.
2. **Given** a route with no response schema, **When** the server starts, **Then** it starts — the `onReady` gate has been changed to match, deliberately and visibly, rather than being worked around per route.
3. **Given** `TRUST_PROXY=false` in the environment, **When** the server boots, **Then** `trustProxy` is the boolean `false` and not the truthy string `"false"`. Coercion is behaviour, not validation, and it survives the removal.
4. **Given** `CONNECTION_TIMEOUT_MS` less than `REQUEST_TIMEOUT_MS`, **When** the server boots, **Then** the documented behaviour is whatever the plan states — either an explicit check that survives, or a recorded, accepted regression.

---

### Edge Cases

Each of these is a place where "remove the schema" is not a deletion but a replacement, because the schema was doing work no type annotation performs.

- **Environment coercion and defaults.** `process.env` values are strings. `server/src/config/env.js` uses Zod to coerce `PORT` to a number, turn `"true"`/`"false"` into booleans, apply defaults for a dozen settings, parse `TRUST_PROXY` into a hop count, and assert `CONNECTION_TIMEOUT_MS > REQUEST_TIMEOUT_MS`. A TypeScript annotation performs none of this. Deleting the schema without replacing the coercion makes `TRUST_PROXY="false"` truthy, which is the exact X-Forwarded-For forgery the file's own comment warns about.
- **The boot gate.** `server/src/plugins/11-rbac.js` refuses to start when a route declares no response schema. With schemas removed, every route offends and the server never boots. The gate must be changed as an explicit decision recorded in the diff.
- **The OpenAPI document.** `server/src/plugins/15-openapi.js` derives the document from the same Zod objects the runtime uses, which is what makes drift impossible. Without them, `/admin/docs` and the development `/swagger-ui` render an empty or hand-maintained document.
- **Business rules wearing a schema's clothes.** `altSchema` enforces alt text of 1–300 characters at media ingest — a §10.1 business rule, not a type check. The Phase 1 audit found this is one of **33**: the password minimum, the OTP digit shape, the email format bound, the push title and body limits, the SEO metadata requirements, and a pagination `limit` that is coerced, defaulted, bounded and then passed into a SQL parameter. Removing the schemas drops all 33 unless each is decided individually. See `data-model.md` §4.
- **Content inspection is not type validation.** `server/src/modules/media/validate.js` inspects magic bytes to decide what an upload actually is. It is a security control over runtime bytes; no type system can perform it and it is out of scope for removal.
- **Quotas and database integrity are unaffected.** `db/counters.js` row locks and the `DELETE` triggers on `members` and `organisations` are database-level and untouched by either half of this feature.
- **Tests that assert rejection.** Suites asserting a malformed body yields `400` will fail once nothing rejects it. Each must be retargeted or removed, and its removal recorded — a deleted test is the easiest way to make this feature look successful without being so.

## Requirements *(mandatory)*

### Functional Requirements

**Conversion**

- **FR-001**: Every `.js` and `.jsx` file under `server/src`, `server/tests`, `client/src`, `client/tests`, `client/scripts` and `packages/contracts/src` MUST become `.ts` or `.tsx`. The count at planning time is 254 files and roughly 29,200 lines.
- **FR-002**: The repository MUST type-check under `tsc --noEmit` with `strict: true`.
- **FR-003**: Each workspace MUST carry its own `tsconfig.json`, with the shared package's declarations consumed by the other two through project references or path mapping.
- **FR-004**: The server MUST continue to run as ES modules on Node 22 with no bundler, via a loader or a build step named in the plan.
- **FR-005**: The client build MUST continue to emit the three existing entries (`index.html`, `en.html`, `konsole.html`) with the two landing pages still requiring no JavaScript.
- **FR-006**: `allowJs` MUST be absent from every committed tsconfig once the migration completes. It MAY be used on intermediate branches.
- **FR-007**: Lint MUST cover the TypeScript sources, replacing the current `eslint.config.js` coverage in both `server` and `client`.
- **FR-008**: Behaviour MUST NOT change except as required by FR-010 through FR-014. This is a conversion, not a rewrite.

**Validation removal**

- **FR-009**: `zod` and `fastify-type-provider-zod` MUST be removed from `server/package.json` and `packages/contracts/package.json`, and no source file may import either.
- **FR-010**: The 41 exported schemas in `packages/contracts/src` MUST be replaced by exported TypeScript types carrying the same names' shapes.
- **FR-011**: The 21 request-body schemas and 31 response schemas on the server's 38 routes MUST be removed, and the `onReady` response-schema gate in `server/src/plugins/11-rbac.js` MUST be amended to match in one deliberate change.
- **FR-012**: Environment **coercion, defaulting and cross-field invariants** MUST be preserved in hand-written form. Only the *type validation* is being removed; turning `"3000"` into `3000` is behaviour the platform depends on.
- **FR-013**: Business rules currently expressed as schemas MUST be preserved as explicit checks, or removed by an explicit decision recorded per rule. They MUST NOT disappear as a side effect of deleting a schema. Phase 1 audited the contracts package and found **33 such rules**, not the single alt-text case this spec first assumed: 12 security-relevant (including the `min(8)` password policy and the four-digit OTP shape), 2 coercion-and-default (including the `limit` that reaches a SQL parameter), 7 product bounds, and 12 SEO metadata rules on which Principle III's compliance depends. They are enumerated individually in `data-model.md` §4, and each needs its own recorded decision.
- **FR-014**: The OpenAPI document MUST either be generated from another source or be withdrawn, with the choice recorded. `/admin/docs` MUST NOT serve a document that no longer describes the API.
- **FR-015**: Upload content inspection, RFC 9457 problem shaping, authorization resolution, rate limiting, quota counters and database constraints MUST be untouched.

**Governance**

- **FR-016**: `.specify/memory/constitution.md` MUST be amended before the removal in FR-009 through FR-011 merges, under the procedure the document itself specifies, naming the principle affected, the rationale, the migration path, and what replaces each protection removed.
- **FR-017**: The amendment MUST be versioned MAJOR, because MUSTs are being downgraded.
- **FR-018**: `CLAUDE.md` MUST be updated where it is falsified — at minimum the "no TypeScript in the server" convention, the four-boot-gates list and the contracts-package rationale.

### Key Entities

- **Shared contract**: a request or response shape imported by the server and every client. Currently a Zod schema that validates and describes. After this feature, a TypeScript type that describes only.
- **Route posture declaration**: `config.auth` plus, today, `schema.response`. After this feature the posture declaration survives and the response half does not, so the boot gate enforces one of its two former conditions.
- **Environment configuration**: the frozen object `loadEnv()` returns. Its coercion and defaults survive; its validation does not.
- **Constitutional principle**: a numbered MUST in `.specify/memory/constitution.md`. Three are affected: I, VI, and the Technology & Security Baseline's configuration clause.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero `.js`/`.jsx` files remain in the six converted directories, excluding the exclusions the plan names.
- **SC-002**: `tsc --noEmit` exits zero across all three workspaces with `strict: true`.
- **SC-003**: Every test that passed before the migration passes after it, except those the plan lists as intentionally retargeted or removed, and that list is itemised rather than aggregate.
- **SC-004**: `npm run -w server verify:seo` exits zero, proving public rendering and canonical behaviour survived.
- **SC-005**: The server boots under `NODE_ENV=production` with the three deployment preconditions set, and refuses to boot with any of them unset — or the plan records that it no longer refuses, as an accepted regression against the Technology & Security Baseline.
- **SC-006**: `grep -r "from 'zod'"` over the three workspaces returns nothing.
- **SC-007**: The constitution's version line reads 2.0.0 or higher and its amendment names all three downgraded MUSTs.
- **SC-008**: A reviewer reading only the diff can identify every place where runtime rejection of malformed input was removed. No removal is implicit in a file rename.

## Assumptions

- "Entire code base" means the three npm workspaces: `server`, `client`, `packages/contracts`. `expo-client/german-world-club` is already TypeScript and is not in the workspace list, so it is out of scope beyond consuming the shared package.
- Tests convert along with sources. A JavaScript test suite asserting against TypeScript sources would leave the largest body of code in the repository untyped.
- "Remove any type validation" was clarified to include Zod. Validation that is not type validation — magic-byte inspection, authorization, quotas, database constraints — stays.
- Coercion is not validation. `"3000"` becoming `3000` is behaviour the platform depends on and is preserved (FR-012).
- No CI workflow exists in this repository today (`.github/workflows` is absent), so the gates named here are local commands, and adding CI is out of scope.
- The stale worktree at `.claude/worktrees/speckit-impl-002/` is not part of the codebase and is excluded from all counts.
