# Implementation Plan: Full-width dashboard layout for the web console

**Branch**: `019-console-full-width-dashboard` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/019-console-full-width-dashboard/spec.md`

## Summary

This is a client-only layout change to the web console (`client/`). The console frame
(`ConsoleShell`) loses its 1600 px cap. A new `components/ui/DashboardPage.tsx` provides:
- a page wrapper with an optional sticky side panel;
- a `CardGrid` that adds columns as the width grows;
- `ReadableText` for line length.

The ten member pages that are a narrow centred column today switch to these. Posts, activity
entries and people become cards from `lg` up. Marketplace listings use `CardGrid`, and `KpiRow`
fits tiles to the width. Every desktop rule sits behind `lg:`, so below 1024 px nothing changes.
A static test stops a page from going back to a narrow column.

## Technical Context

**Language/Version**: TypeScript, React 19.2, Vite 8, Tailwind 4.3 (web client only).

**Primary Dependencies**: none new. Uses the existing `components/ui` kit and Tailwind
arbitrary values.

**Storage**: N/A. There is no data, server, contracts or app change.

**Testing**: Vitest + Testing Library + jsdom (`client/tests/`), `test:i18n` (unchanged), and a
new static test `client/tests/no-narrow-pages.test.ts`. jsdom has no layout engine, so measured
widths are checked by hand in a browser (quickstart.md).

**Target Platform**: evergreen desktop and mobile browsers.

**Project Type**: web console (SPA under `/konsole`).

**Performance Goals**: no change. CSS only, with no new JavaScript work per render.

**Constraints**:
- Mobile (< 1024 px) must be unchanged.
- The CSP is nonce-only for styles, so classes only, no inline `style`.
- Reading order must be unchanged.
- No horizontal scroll from 320 px up.

**Scale/Scope**:
- 1 new component file.
- About 12 changed files: `ConsoleShell`, `KpiTile`, `PostCard`, `PostList`, `Activity`,
  `PostView`, `Feed`, `MyProfile`, `MemberProfile`, `OrganisationView`, `EditProfile`, `Privacy`,
  `Marketplace`.
- 1 new test, and about 2 tests updated.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Engaged? | Verdict |
|---|---|---|
| I. One rule set, three clients | No: no rule moves | **PASS.** Pure presentation. No client decides anything new. |
| II. Declare every posture | No | **PASS.** No route or surface is added. `/konsole` stays gated and never indexed. |
| III. Published state = real state | No | **PASS.** No public surface is touched. |
| IV. Integrity in the database | No | **PASS.** |
| V. Failure explicit and bounded | No | **PASS.** |
| VI. Server shapes what leaves it | Images in wider cards | **PASS.** Media still render delivered derivatives through the existing `MediaGrid` `srcset`. A wider card picks a larger breakpoint variant, never the original. |

Project conventions:
- No new strings, so `no-hardcoded-strings` and `test:i18n` are unaffected.
- The responsive rules (`tests/responsive.test.tsx`: 16 px gutter, no fixed pixel widths) still
  hold.
- Comments say *why* a page has a side panel and why some surfaces stay narrow.

**Post-design re-check**: unchanged, all PASS.

## Project Structure

### Documentation (this feature)

```text
specs/019-console-full-width-dashboard/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R8
├── quickstart.md        # browser checks at 320 / 768 / 1024 / 1440 / 1920 / 2560
├── contracts/
│   └── ui-contract.md   # per-page layout at < lg and ≥ lg
├── checklists/requirements.md
└── tasks.md
```

No `data-model.md`: there is no data.

### Source Code

```text
client/src/
├── components/ui/DashboardPage.tsx    NEW  DashboardPage (aside), CardGrid, ReadableText (R1, R2)
├── components/ui/KpiTile.tsx          KpiRow auto-fit at lg (R5)
├── console/ConsoleShell.tsx           drop max-w-[1600px]; xl gutter (R4)
├── member/threads/PostCard.tsx        lg card styling; body in ReadableText (R3)
├── member/threads/PostList.tsx        entries in CardGrid
├── member/threads/Feed.tsx            DashboardPage
├── member/threads/Activity.tsx        DashboardPage + CardGrid rows as cards
├── member/threads/PostView.tsx        DashboardPage ×3 (post, quotes, likes); AuthorList in CardGrid
├── member/profile/MyProfile.tsx       DashboardPage aside = ProfileHeader
├── member/profile/MemberProfile.tsx   DashboardPage aside = ProfileHeader; FollowList full width
├── member/profile/OrganisationView.tsx DashboardPage aside = header
├── member/profile/EditProfile.tsx     DashboardPage; fields lg:grid-cols-2
├── member/profile/Privacy.tsx         DashboardPage; two lists side by side at lg
└── member/Marketplace.tsx             listings <ul> → CardGrid
client/tests/
├── no-narrow-pages.test.ts            NEW  static guard (R7)
├── components/dashboard-page.test.tsx NEW  aside DOM order, lg classes, no max-w
└── responsive.test.tsx                + console frame has no max-width cap
```

**Structure Decision**: one shared primitive in `components/ui`, next to `KpiRow` and `Card`,
applied page by page. Nothing outside `client/` changes.

## Risks

- **jsdom can't measure layout.** Tests assert classes and DOM order. SC-001 to SC-004 need the
  browser checks in quickstart.md.
- **Feature 018 merges with two narrow pages.** The static test fails on whichever branch merges
  second, which is the intended reminder (R8).
- **Post grids change how a timeline scans.** Row-major order is kept in the DOM, and each card
  keeps its own date. If people find a multi-column timeline odd, `CardGrid` on `PostList` is the
  single line to revert, without touching anything else.

## Complexity Tracking

None.
