# Feature Specification: Server Clean Architecture Reorganization

**Feature Branch**: `006-server-clean-architecture`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "organize server files in way that Clean architecture works, I as a software developer understand controllers, routes, middlewares, application layers, and helpers, and lib so organize the Fastify decorators, hooks, and plugins, and etc so I can also learn the Fastify structure"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find any endpoint's layers in seconds (Priority: P1)

A developer who did not write a given endpoint needs to find, in order, its HTTP route/schema, its request/response mapping, and the business logic that runs it — without grepping the whole `server/src` tree or guessing which domain folder holds what.

**Why this priority**: This is the daily-use case. If the layering doesn't make lookup faster than today's domain-folder-with-mixed-concerns layout, the reorg has no value.

**Independent Test**: Given any existing HTTP endpoint (e.g. `POST /auth/login` or `GET /media/:id`), a developer can, using only the folder structure and naming convention (no full-text search), open the route file, then the controller, then the application/use-case logic, in under 2 minutes.

**Acceptance Scenarios**:

1. **Given** the reorganized `server/src` tree, **When** a developer looks up the endpoint that handles member login, **Then** they find a routes file that only declares the HTTP schema and wiring, a controller that only translates request/response, and an application module that contains the actual login logic — each in its own predictably-named location.
2. **Given** the reorganized tree, **When** a developer needs the code that talks to Postgres or an external SMS/email provider, **Then** they find it under a single shared infrastructure/`lib` location rather than duplicated per domain folder.

---

### User Story 2 - Add a new endpoint by following one obvious pattern (Priority: P2)

A developer adding a new endpoint wants one "reference slice" (route → controller → application → lib) they can copy, so new code lands in the same layers as everything else instead of each contributor inventing their own mixing of concerns.

**Why this priority**: Prevents the reorganization from decaying back into mixed-concern files the next time someone adds a feature under time pressure.

**Independent Test**: A developer can add a new, simple endpoint end-to-end (route, controller, application logic, one lib call) by copying the structure of one existing domain and renaming, with no need to ask where a given kind of code belongs.

**Acceptance Scenarios**:

1. **Given** the documented layering, **When** a developer adds a new endpoint, **Then** they place the schema/wiring, the request/response translation, and the business rule in three distinct files/folders matching the documented convention, and code review can object to a PR that skips a layer (e.g. business logic written directly in a route handler).

---

### User Story 3 - Learn Fastify's own structure from this codebase (Priority: P3)

A developer who does not yet know Fastify well wants the codebase itself to teach them the difference between a **plugin**, a **decorator**, and a **hook**, and why this project's boot order is what it is.

**Why this priority**: Valuable but secondary to the day-to-day navigability improvements above — this is a learning/onboarding aid, not something blocking daily work.

**Independent Test**: A developer new to Fastify can read one document plus the folder names and correctly explain, without asking a teammate, what a Fastify plugin is, what a decorator is, what a hook is, and where each lives in this codebase.

**Acceptance Scenarios**:

1. **Given** the reorganized tree, **When** a developer opens the top-level `server/src` structure, **Then** Fastify plugin registrations (`fastify.register`), decorators (`fastify.decorate*`), and hooks (`fastify.addHook`) are each easy to find as distinct categories, with a short document explaining the difference and pointing at real examples already in the repo.
2. **Given** the existing numbered plugin bootstrap (`00-request-context.js` … `15-openapi.js`), **When** the reorg is complete, **Then** the numbering and registration order described in `CLAUDE.md` ("Plugin filenames are numbered because the order is semantic") is unchanged in meaning, even if the files move to a new parent folder.

### Edge Cases

- What happens to files that are simultaneously "plugin" and "route holder" today (e.g. a domain's `routes.js` that both registers Fastify routes and contains the handler logic)? They must be split, not just relocated.
- What happens when a route's business logic depends on another domain's application logic (e.g. media derivatives depending on organisation scope guards)? The layering must allow cross-domain calls at the application layer without reaching back up into another domain's route/controller files.
- How does the reorg treat the RFC 9457 problem+json error shapes and the four startup gates (auth declared, response schema declared, outbound budget ceiling, fallback declared) described in `CLAUDE.md`? These gates must keep working unchanged — they are enforced by static registration checks, so relocating files must not break the introspection those gates rely on.
- What happens to `server/src/seed/*` and `server/src/scripts/*`, which are one-off/CLI entry points rather than HTTP endpoints? They need a place in the new structure that doesn't force them into "route/controller" folders that don't apply to them.
- What happens if a test imports a moved file by its old path? All existing imports (production code and tests) must be updated in the same change; nothing may import a file at a path that no longer exists.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The server codebase MUST separate, for every HTTP endpoint, three concerns into three distinct locations: (a) the Fastify route declaration (path, method, `config.auth`, `schema.response`, and wiring to a controller), (b) the controller (translates the HTTP request into a call to application logic and the result back into an HTTP response, with no business rules of its own), and (c) the application/use-case logic (the actual business rule, framework-agnostic).
- **FR-002**: The server codebase MUST group Fastify **plugins** (anything registered via `fastify.register`, including the numbered bootstrap plugins and any third-party plugin registration such as `@fastify/swagger-ui`), Fastify **decorators** (anything added via `fastify.decorate`/`decorateRequest`/`decorateReply`), and Fastify **hooks** (anything added via `fastify.addHook`, including per-route and per-scope hooks) into locations where each category is identifiable by folder/file naming, distinct from application and controller code.
- **FR-003**: The numbered plugin bootstrap files and their registration order (`00-request-context.js` through `15-openapi.js`, and the semantic ordering rules already documented in `CLAUDE.md`) MUST be preserved exactly in meaning and order; they may be relocated as a group but MUST NOT be renumbered, reordered, or split apart from each other as part of this reorganization.
- **FR-004**: Shared, cross-domain utilities that are not business logic — database access, Redis, outbound HTTP/email/SMS/payment integrations, hashing, and other framework-agnostic helpers — MUST live in a single shared `lib`/infrastructure location rather than being duplicated or scattered per domain.
- **FR-005**: The reorganization MUST NOT change any observable HTTP behavior: request/response shapes, status codes, auth/permission posture, RFC 9457 problem `type`/`detail` semantics, and the four startup gates (declared auth, declared response schema, outbound budget ceiling, declared fallback) MUST behave identically before and after.
- **FR-006**: All existing automated tests MUST continue to pass after the reorganization, updated only where they reference a file's old import path — no test's asserted behavior may change.
- **FR-007**: The reorganization MUST be doable and verifiable one domain at a time (e.g. `auth`, then `media`, then `seo`, …) rather than as a single unverifiable rewrite, so a regression can be isolated to the domain being moved.
- **FR-008**: The codebase MUST include a short document (e.g. `server/README.md` addendum or a new `server/ARCHITECTURE.md`) that explains the layering (routes / controllers / application / middlewares / lib / plugins) and explicitly maps each term to the Fastify concept it corresponds to (plugin, decorator, hook), with pointers to real files in the repo as examples.
- **FR-009**: One-off entry points that are not HTTP endpoints (the `seed:dev`/`seed:demo` scripts, migration scripts, worker/queue processors) MUST be placed in a location distinct from `routes`/`controllers`, reflecting that they are invoked directly rather than through an HTTP route.
- **FR-010**: Cross-domain calls (e.g. media derivatives needing an organisation-scope guard) MUST happen at the application layer, not by one domain's controller or route file importing another domain's controller or route file directly.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer unfamiliar with a given endpoint can identify its route file, controller, and application logic in under 2 minutes using folder/file naming alone, with no full-text search required.
- **SC-002**: 100% of the existing automated test suite (`npm test` across workspaces) passes after the reorganization with no behavioral changes, only import-path updates.
- **SC-003**: 100% of Fastify plugins, decorators, and hooks in the codebase are located in a place identifiable by category (plugin vs. decorator vs. hook) rather than mixed into domain feature folders.
- **SC-004**: A new contributor can correctly describe, after reading only the new architecture document and browsing the folders it points to, the difference between a Fastify plugin, decorator, and hook, and name one real example of each from this codebase.
- **SC-005**: The plugin boot order enforced today (correlation → logging → security headers → canonical origin → legacy redirects → db → redis → rate limit → load shedding → jwt → auth → rbac → deadline → breakers → error handler → openapi) is unchanged after the move, verified by the existing startup-gate and plugin-order tests continuing to pass.

## Assumptions

- This is an internal, non-behavior-changing refactor: no new user-facing functionality is added, and no HTTP contract consumed by the web client, mobile app, or staff console changes.
- "Clean Architecture" is applied pragmatically for a Fastify service — routes (interface adapters) → controllers (adapters) → application/use-cases (business rules) → lib/infrastructure (framework, db, external services) — rather than a strict textbook implementation with formal dependency-inversion containers, since the codebase has no DI framework today and introducing one is out of scope.
- The numbered plugin bootstrap (`00`–`15`) is the canonical description of **boot order** and stays intact as a group; "clean architecture" layering is applied to the per-domain feature code (`auth`, `media`, `seo`, `organisations`, `ops`, `push`, `public`, `seed`), not to the plugin bootstrap sequence itself.
- Enforcing the new layering with automated tooling (e.g. an ESLint import-boundary rule preventing a route file from containing business logic) is a "nice to have" for this feature but not required for v1; it can be proposed as a follow-up.
- The reorganization touches only `server/`; `client/` and `packages/contracts/` are out of scope for this feature.
- Migration happens on this feature branch and is delivered as one PR (or a small number of domain-scoped PRs) rather than an in-place, long-running parallel structure.
