# Implementation Plan: Bring the outcome of a save into view

**Branch**: `041-scroll-to-form-message` | **Date**: 2026-11-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/041-scroll-to-form-message/spec.md`

## Summary

Seven pages of the web client already show a message at the top (or above the send button) when a save succeeds, and the person who pressed Save at the bottom of a long form never sees it. The message stays exactly as it is; the page now moves to it. One small hook, `useReveal`, watches the value a page already holds for its message and, one frame after it changes to something to show, calls `scrollIntoView({ block: 'nearest' })` on the message's element. `nearest` does nothing when the message is already fully visible, so no measuring code is needed. `FormMessage` and `Callout` get a `ref` prop and a scroll margin so the hook can reach them. No server, contract, dependency, string or native change.

## Technical Context

**Language/Version**: TypeScript (strict), React 19.2, Vite, Tailwind CSS v4, in `client/`.

**Primary Dependencies**: none added. The browser's own `Element.scrollIntoView` and `matchMedia`.

**Storage**: N/A.

**Testing**: vitest 5 with jsdom and Testing Library, as in the rest of `client/tests`. jsdom has no layout, no `scrollIntoView` and no `matchMedia`, so tests install a spy (R10) and a real-browser pass is in `quickstart.md`.

**Target Platform**: the gated web console in modern browsers (`/konsole`); never the public landing pages, which run no JavaScript.

**Project Type**: web client of a platform with one API and three clients; this feature touches the web client only (the app is out of scope).

**Performance Goals**: one `requestAnimationFrame` and one `scrollIntoView` per outcome, and nothing on any render that does not change the outcome.

**Constraints**:
- The message must not change in any visible way (spec FR-003): same markup, no wrapper element, no inline style (the CSP allows styles by nonce only; the scroll margin is a utility class).
- No new strings (`tests/no-hardcoded-strings.test.ts`, the i18n parity checks) and no colour literal (`scripts/check-tokens`).
- Every existing test keeps passing: the code runs under jsdom, which lacks the browser features it uses, so each is guarded.
- A hook must be called before a page's early `return <PageLoader />`.

**Scale/Scope**: one hook, two ui components, eight pages (seven of FR-009 plus Offers for User Story 3), one test helper, five test files, `CLAUDE.md`. About 120 lines of source.

## Constitution Check

*GATE: passed before research, re-checked after design.*

| Principle | Verdict | Note |
|---|---|---|
| I. One rule set, three clients | Pass | A display behaviour of the web client. It decides nothing about what is allowed and reimplements no rule; the message text and the decision to show it are the pages' existing ones. |
| II. Declare every posture | Not touched | No route. |
| III. Published state matches real state | Not touched | Gated console only; no public surface, URL or structured data. |
| IV. Integrity lives in the database | Not touched | No write path changes. |
| V. Failure is explicit and bounded | Not touched | No outbound call. |
| VI. The server shapes what leaves it | Not touched | No server change; nothing is added to a response or a log. |
| Baseline: public pages need no JavaScript | Pass | The landing pages do not load the console bundle. The gated console "MAY remain client-rendered". |
| Workflow: every principle touched has an automated check | Pass | No principle is touched. The feature adds its own checks (hook tests, per-page tests, the source scan). |

No violation, so nothing in Complexity Tracking. Re-checked after the design in `research.md` and `contracts/ui-contract.md`: unchanged.

## Decisions

Each is argued, with the alternatives, in [research.md](./research.md).

1. **`scrollIntoView({ block: 'nearest' })`** is the move: it is already "only if it is out of view" (R2).
2. **A hook keyed on the page's own value**, not a scroll on mount, so a second identical save (Offer categories keeps its message mounted) still counts (R3).
3. **One frame later**, so the Marketplace drawer's focus return, which scrolls too, cannot overtake it (R4).
4. **Reduced motion** read at the moment of the move; no global `scroll-behavior` (R5).
5. **`scroll-my-6` on the message roots** for a gap at the edge; a class, not a style (R6).
6. **A `ref` prop** on `FormMessage` and `Callout`, no wrapper `div`, which would change the page's `gap-6` spacing (R7).
7. **The whole slot, not only success**: refusals shown there are revealed too, as User Story 3; one condition at a call site drops them (R8).
8. **A source scan** that fails the build when a success-toned message appears in a file that does not call `useReveal`, with its limit stated (R9).

## Project Structure

### Documentation (this feature)

```text
specs/041-scroll-to-form-message/
├── spec.md
├── plan.md                  # this file
├── research.md              # the form-by-form survey and the decisions
├── quickstart.md            # automated and manual validation
├── contracts/
│   └── ui-contract.md       # useReveal, the ref prop, what each page passes
├── checklists/
│   └── requirements.md
└── tasks.md                 # NOT created here: /speckit-tasks
```

There is no `data-model.md`: nothing is stored, and no entity is added or changed.

### Source Code

```text
client/
├── src/lib/useReveal.ts                       # NEW: the hook
├── src/components/ui/Field.tsx                # FormMessage: ref prop, scroll-my-6
├── src/components/ui/Callout.tsx              # ref prop, scroll-my-6
├── src/member/profile/EditProfile.tsx         # useReveal(message)
├── src/member/Marketplace.tsx                 # useReveal(posted || saved)
├── src/organisation/Profile.tsx               # useReveal(message)
├── src/organisation/Store.tsx                 # useReveal(message)
├── src/organisation/OfferEditor.tsx           # useReveal(message)
├── src/organisation/Offers.tsx                # useReveal(message)   (User Story 3)
├── src/console/admin/OfferCategories.tsx      # useReveal(message)
├── src/console/admin/Push.tsx                 # useReveal(notice)
└── tests/
    ├── helpers/scroll-spy.ts                  # NEW: the spy and the revealed elements
    ├── lib/use-reveal.test.tsx                # NEW: the hook alone
    ├── member/outcome-reveal.test.tsx         # NEW: Edit profile, Marketplace
    ├── organisation/outcome-reveal.test.tsx   # NEW: Profile, Store, Offer editor, Offers
    ├── console/outcome-reveal.test.tsx        # NEW: Offer categories, Push
    └── outcome-reveal-guard.test.ts           # NEW: the source scan (FR-010)

CLAUDE.md                                      # one paragraph under Conventions
```

**Structure Decision**: no new component and no new element. The two shared message components gain one prop each, and every page's change is two lines (the hook call, the ref). The hook lives in `client/src/lib` beside `useAction`, which it resembles: a small behaviour shared by pages, with no UI of its own.

## Risks and how they are covered

- **The move lands before the drawer's focus return and is overtaken** (Marketplace): one frame of delay (R4); a test asserts the message is the *last* element revealed after the drawer closes.
- **A page calls the hook after its early return** and React throws "rendered more hooks than during the previous render": the contract says before any early return; each page test renders the page through its loader into its content.
- **jsdom crashes on `scrollIntoView`/`matchMedia`** in the existing suites: both calls are guarded, and the existing suites run unchanged in the same gate.
- **Smooth scrolling feels slow when the message is far away**: the browser caps and eases it; there is no custom duration to tune. If it is unwelcome, `behavior: 'auto'` is a one-word change in the hook.
- **A message that is taller than the window** (not a case in these pages): `nearest` aligns its top, which is the useful end.
