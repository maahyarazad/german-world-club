# Implementation Plan: The header menu opens below the header, and stays the phone's own menu (app)

**Branch**: `040-menu-below-header` (not created; the work is on `main` until a branch is made) | **Date**: 2026-11-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/040-menu-below-header/spec.md`

## Summary

On Marketplace and Threads the three dots open the phone's own menu. This feature makes that menu open below the header on both phones **without replacing or redrawing it** (FR-002).

- **Android**: `MenuView` stays. The dots become a button that calls `ref.show()`, and the menu's anchor becomes a thin invisible strip along the header's bottom edge, so the Material menu opens there (D1 in [research.md](./research.md)).
- **iPhone**: one native-only attempt. The system `Menu`'s invisible label is made 12 points taller, reaching below the header, so the system may anchor its menu lower. It costs nothing to take back out: one constant set to 0 is today's behaviour (D2). Whether it works is only knowable on a phone.

No server, contract, web, dependency, string or native-module change.

## Technical Context

**Language/Version**: TypeScript (strict), React 19.2, React Native 0.86, Expo SDK 57, Expo Router.

**Primary Dependencies**: none added. Used as they already are: `@expo/ui` 57.0.20 (`swift-ui` `Menu`, `Host`, `Image`, modifiers on iPhone; `community/menu` `MenuView` on Android), `@expo/vector-icons` (the dots).

**Storage**: N/A.

**Testing**: the app has no test runner (`lint` and `typecheck` only). Validation is static checks, a headless layout check of the part that is ours, and a phone (see [quickstart.md](./quickstart.md)).

**Target Platform**: iPhone (iOS) and Android phones, portrait only (`orientation: "portrait"` in the app config).

**Project Type**: mobile app (`expo-client/german-world-club`), inside an npm workspace with the server and web client.

**Performance Goals**: none new; opening the menu is as fast as it is.

**Constraints**: the menu is the phone's own on both phones and the app draws no replacement (FR-002); the area that opens the iPhone's menu may reach at most 12 points below the header (FR-007); the dots do not move or resize (FR-005); styles in `StyleSheet.create`, no inline style objects, strings in both catalogues, no problem state stored (CLAUDE.md).

**Scale/Scope**: two files of real change (`header-menu.android.tsx`, `header-menu.ios.tsx`), one small one (`header-menu-shared.tsx`), and `CLAUDE.md`. Two screens have the menu (Marketplace, Threads).

## Constitution Check

*GATE: passed before Phase 0, re-checked after Phase 1.*

The constitution's principles (one rule set for three clients, declared posture, published state, integrity in the database, bounded failure, the server shaping what leaves it) concern the server, the shared contracts and the crawl surface. This change touches none of them: no route, response, outbound call, persistence, media or crawl surface, and no shared type. Principle I holds trivially: nothing a client and the server both need is added or changed. The workflow gate "specification first" holds (spec, then this plan, then tasks). No violation, so no Complexity Tracking.

Repository conventions that do apply (CLAUDE.md): styles in `StyleSheet.create` and never an inline object (the ESLint rule rejects it); a value that comes from props in a small `useMemo` sheet; strings in both catalogues (none are added); failures logged, not stored (none are added).

## Design

1. **`src/components/header-menu-shared.tsx`: `MenuDots` becomes a button.** It is used only by the Android file. Signature `MenuDots({ unread, onPress })`, rendered as a `Pressable` (`accessibilityRole="button"`, the "More" label, with " •" when a row has news, `MenuIcon` inside, `MenuBadge` over it). It no longer has to be "only a picture with no `onPress`": that rule existed because `MenuView` wrapped it in its own `Pressable`, and in the new design it is not `MenuView`'s child. `MenuIcon`, `MenuBadge`, `MENU_BUTTON`, `openHeaderMenuItem` and the `Entypo.loadFont()` call are unchanged. The iPhone file does not use `MenuDots`, so this changes nothing there. Update the doc comments that say otherwise.

2. **`src/components/header-menu.android.tsx`: the anchor moves, the menu does not (US1, FR-001, D1).** The right-hand slot becomes `<View style={styles.slot}>` with `width: MENU_BUTTON.width` and `height: HEADER_BAR_HEIGHT` (56 on Android, the bar's height, so the slot's bottom edge is the header's bottom edge; import `HEADER_BAR_HEIGHT` from `@/components/app-header`, which does not import the menu, so there is no cycle), `alignItems: 'center'`, `justifyContent: 'center'`. In it:
   - `<MenuDots unread onPress={() => menuRef.current?.show()} />`, centred (its 44-point box inside the 56-point slot);
   - `<MenuView ref={menuRef} actions onPressAction style={styles.anchor}>` as now (`actions` with `id` the row's `key` and `" •"` for news; `onPressAction` calls `openHeaderMenuItem`), whose style is `{ position: 'absolute', left: 0, right: 0, bottom: 0 }` and whose **child is `<View style={styles.anchorFill} />` with `{ width: MENU_BUTTON.width, height: 1 }`**. The width matters: the anchor is the child at its own size (research D1), and Compose lines the menu up with the anchor's edges.
   - `menuRef = useRef<MenuComponentRef>(null)` (`MenuComponentRef` is exported by `@expo/ui/community/menu`; `MenuView` types `ref` as an ordinary prop).
   - Empty list still returns `null`. A tap on the 1 dp strip would also open the menu, which is harmless.

3. **`src/components/header-menu.ios.tsx`: the one native-only attempt, behind a constant (US3, FR-003, FR-007, D2).** Add `const ANCHOR_EXTENSION = 12;` with a comment (how far the invisible native label reaches below the header; the spec's cap; **`0` is exactly today's behaviour**, which is how the attempt is taken back out). Change one thing: the label's `frame` height from `MENU_BUTTON.height` to `MENU_BUTTON.height + ANCHOR_EXTENSION`. Nothing else moves: the fixed 40 x 44 `box` (so the header's layout and the emblem's centre are unchanged, and the extended `Host` overflows the box by 12 points at the bottom, over the header's bottom hairline and the first points of the page), `MenuIcon` centred in the box, `MenuBadge`, `contentShape(shapes.rectangle())`, `opacity(0)`, the rows. Rewrite the doc comment: the attempt, why it is invisible and where it can only be judged (a phone), and the revert. Do not add `overflow` styling; the default (visible) is what lets the overflow take touches (research D2), and the wrapper the stack puts the header in has `zIndex: 1` and does not clip.

4. **`CLAUDE.md`**: the `HeaderMenu` sentences: on Android the dots are a button that asks `MenuView` to open (`ref.show()`), and the menu is anchored to a strip along the header's bottom edge, so it opens below the header; on iOS the label reaches `ANCHOR_EXTENSION` points below the header, and **record the phone result** (kept if the system menu then clears the dots, else set to 0 and the iPhone is as it was).

5. **Not changed**: `app-header.tsx` (the user's own padding edit stays), `header-menu.tsx` (the fallback), the Marketplace and Threads screens, `i18n`, `package.json`, the server, contracts and the web console.

### What is withdrawn from feature 039

The iPhone card (039 US9, FR-027, plan item 8, tasks T046 to T054) is declined and was never implemented; those documents are marked superseded. From it, this plan keeps only the Android anchor idea, corrected (the anchor strip needs a width).

### Risks

| Risk | Where | Handling |
|---|---|---|
| The system menu still covers the dots with a longer label | iPhone | Expected possibility. Set `ANCHOR_EXTENSION = 0`, record the result in the spec (SC-003), leave the iPhone as it is. |
| The native screen container clips the extension, so it gets no touches | iPhone | Same handling; a tap on the extension does nothing and is noticed on the phone. |
| `show()` or the popup's place is wrong on Android | Android | Check on a phone; the anchor can be adjusted (width, position) without touching the menu. |
| The extension takes taps meant for the page | iPhone | Capped at 12 points (FR-007); the area is invisible and sits where the header ends. Test: a tap 14 points below the header does not open the menu (SC-005). |

## Project Structure

### Documentation (this feature)

```text
specs/040-menu-below-header/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── checklists/
│   └── requirements.md  # Spec quality checklist (/speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

`data-model.md` and `contracts/` are not produced: the change has no entities and no interface a client or the server depends on.

### Source Code (repository root)

```text
expo-client/german-world-club/
└── src/components/
    ├── header-menu-shared.tsx    # MenuDots becomes a button (Android only uses it)
    ├── header-menu.android.tsx   # slot + MenuDots button + MenuView on an anchor strip
    └── header-menu.ios.tsx       # label frame + ANCHOR_EXTENSION (the revertable attempt)
CLAUDE.md                          # the HeaderMenu sentences, and the phone result
```

**Structure Decision**: mobile app only, in `expo-client/german-world-club`; one shared file and one file per platform, as the menu already is. No new files in `src/`.

## Complexity Tracking

No Constitution Check violation; nothing to justify.
