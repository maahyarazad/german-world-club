# Implementation Plan: Signed-in visitors see their avatar on the landing page

**Branch**: `022-landing-signed-in-avatar` | **Date**: 2026-11-13 | **Spec**: [spec.md](./spec.md)

## Summary

The landing pages (`/`, `/en`) are rendered by the server from `client/index.html` and
`client/en.html`. With this feature:
- a new `app.peekViewer(request)` decides "signed in" by the same session and gate rules as the
  console, and never throws;
- `loadViewer` loads the name and avatar;
- `renderLanding` swaps the two marked sign-in blocks for an avatar or initials link to
  `/konsole`, and a "Zur Konsole" button.

Signed-in responses are `private, no-store`. Anonymous responses are unchanged, byte for byte.
There's no JavaScript and no new route.

## Technical Context

**Language/Version**: TypeScript on Node 22 (server); static HTML shells (client)

**Primary Dependencies**: Fastify 5, @fastify/jwt (cookie `gwc_at`), pg

**Storage**: none new. It reads `members`, `member_avatars`, `admin_users`,
`organisation_users` and assets.

**Testing**: vitest against `gwc_test`

**Target Platform**: Linux server; any browser (no JS)

**Project Type**: web service (server-rendered public page)

**Performance Goals**: an anonymous request does no database work (no cookie → no lookup). A
signed-in one adds a session lookup and one or two queries.

**Constraints**:
- Shared caches must never store a signed-in page.
- No JavaScript on the landing pages.
- No original uploads served.

**Scale/Scope**: 1 decorator, 1 application module, 2 shells, 1 renderer, 1 controller, about 2
test files.

## Constitution Check

| Principle | Assessment |
|---|---|
| I. One rule set | Pass. "Signed in" reuses 10-auth's session and gate rules, not a copy. |
| II. Declare every posture | Pass. The routes stay `audience: 'public'`. `peekViewer` doesn't authenticate the route, sets no principal, and grants nothing. |
| III. Published state matches real state | Pass. Crawlers see the unchanged page, so canonical and hreflang are untouched. A signed-in page is never cached as public. |
| IV. Integrity in the database | n/a. It's read only. |
| V. Failure explicit and bounded | Pass. Every failure degrades to the anonymous page, and the extra queries run under the route's existing deadline. |
| VI. The server shapes what leaves it | Pass. Only the derivative avatar URL and the escaped display name leave. |

## Project Structure

```text
specs/022-landing-signed-in-avatar/  spec, plan, research, contracts/landing.md, quickstart, tasks
server/src/plugins/10-auth.ts                       # peekViewer; gate functions shared
server/src/modules/public/application/viewer.ts     # loadViewer (new)
server/src/modules/public/application/landing.ts    # renderLanding({ …, viewer, language })
server/src/modules/public/controller.ts             # landingHandler: peek, render, cache headers
client/index.html, client/en.html                   # markers + .account / .initials CSS
server/tests/seo/landing-viewer.test.ts             # new
CLAUDE.md                                           # one paragraph
```

## Complexity Tracking

None.
