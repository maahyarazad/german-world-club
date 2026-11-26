---

description: "Task list for the header menu opening below the header, kept native (feature 040)"
---

# Tasks: The header menu opens below the header, and stays the phone's own menu (app)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [quickstart.md](./quickstart.md)

**Tests**: the app has no test runner, so there are no test files. Verification is typecheck, lint, a bundle export for each platform, a headless render of the part that is our own layout, and a phone (see quickstart.md). The system menus themselves can only be judged on a phone.

## Format: `- [ ] [ID] [P?] [Story] Description with file path`

- **[P]**: can run in parallel (a different file, no dependency on an unfinished task)
- **[Story]**: US1 Android opens below the header, US2 the menu stays the phone's own, US3 the iPhone attempt, US4 nothing else changes

All paths are under `expo-client/german-world-club/` unless they start with `specs/` or `CLAUDE.md`.

## Notes that apply to every task

- **Do not change the native menu** (FR-002): no `Modal`, no card, no sheet, no overlay of the app's own, and no new dependency or native module. The earlier card plan (feature 039 US9, T046 to T054) is withdrawn and must not be revived here.
- No server, contract, web, string or `package.json` change (FR-008).
- Styles in `StyleSheet.create`, never an inline style object (an ESLint rule rejects it); this React Native has no `StyleSheet.absoluteFillObject`, so spell edges out.
- Read the installed `@expo/ui` 57.0.20 source or types before assuming an API (`AGENTS.md`); everything this feature uses was read there (research.md).
- **Threads has no menu any more** (amended 2026-11-26): its New post is a plain button (`src/components/header-icon-button.tsx`, used in `src/app/(member)/threads/index.tsx`), so the device checks in T004, T007 and T011 are on **Marketplace only**, and where they say "Marketplace and Threads" read Marketplace.
- `git` commits and pushes only when the user asks.

---

## Phase 1: Setup

- [x] T001 Create the branch the work belongs on: `git switch -c 040-menu-below-header` from `main`. The uncommitted files come along on purpose: the user's own edit to `src/components/app-header.tsx` (the header's side padding, `Spacing.three`), feature 039's documentation changes and `specs/040-menu-below-header/`. Do not commit them. **Done:** branch `040-menu-below-header` created from `main`; the uncommitted files came along; nothing was committed.

## Phase 2: Foundational

None. No task blocks every story: Android (US1) and the iPhone attempt (US3) are in different files and can be done in either order, or together.

---

## Phase 3: User Story 1 - On an Android phone the menu opens below the header (P1) MVP

**Goal**: the Material menu's top edge is the header's bottom edge, with the dots, emblem and title uncovered.

**Independent test**: on an Android phone open Marketplace and tap the dots: the menu starts under the header's bottom line.

- [x] T002 [P] [US1] In `src/components/header-menu-shared.tsx` make `MenuDots` a button. Add `Pressable` to the `react-native` import (keep `StyleSheet` and `View`; `MenuBadge` uses `View`). Replace the signature and body with `export function MenuDots({ unread, onPress }: { unread: boolean; onPress: () => void })` returning `<Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={unread ? \`${t.common.menu} •\` : t.common.menu} style={styles.button}><MenuIcon />{unread ? <MenuBadge /> : null}</Pressable>` (with `const { t } = useTranslations();` as now; no `accessible` prop, `Pressable` is accessible already; no `ref` prop, which the withdrawn card needed and nothing here does). Rewrite its doc comment: it is the Android button, and a press asks the platform menu to open (`header-menu.android.tsx`); it used to be only a picture with no `onPress`, because `MenuView` wrapped it in a `Pressable` of its own, and it is no longer `MenuView`'s child; keep the paragraph saying iOS does not use it but uses `MenuIcon`, with the reason (SwiftUI's `Menu` with an invisible native label, the icon laid over it). Leave `MenuIcon`, `MenuBadge`, `MENU_BUTTON`, `ICON_SIZE`, the `Entypo.loadFont()` call, `openHeaderMenuItem` and `styles` as they are. **Done:** `MenuDots` is a `Pressable` with `onPress`; `tsc` clean.
- [x] T003 [US1] Rewrite `src/components/header-menu.android.tsx` (after T002). Imports: `MenuView, type MenuAction, type MenuComponentRef` from `@expo/ui/community/menu`; `useRef` from `react`; `StyleSheet, View` from `react-native`; `HEADER_BAR_HEIGHT` from `@/components/app-header` (it does not import the menu, so no cycle); `MENU_BUTTON, MenuDots, openHeaderMenuItem, type HeaderMenuItem, type HeaderMenuProps` from `@/components/header-menu-shared`; keep `export type { HeaderMenuItem };`. Body: `const menuRef = useRef<MenuComponentRef>(null);` **before** the `if (items.length === 0) return null;`; `actions` as now (`id: item.key`, `title: item.dot ? \`${item.label} •\` : item.label`). Return `<View style={styles.slot}><MenuDots unread={items.some((item) => item.dot)} onPress={() => menuRef.current?.show()} /><MenuView ref={menuRef} actions={actions} onPressAction={({ nativeEvent }) => openHeaderMenuItem(items, nativeEvent.event)} style={styles.anchor}><View style={styles.anchorFill} /></MenuView></View>`. Styles: `slot: { width: MENU_BUTTON.width, height: HEADER_BAR_HEIGHT, alignItems: 'center', justifyContent: 'center' }` (as tall as the bar, so its bottom edge is the header's bottom edge); `anchor: { position: 'absolute', left: 0, right: 0, bottom: 0 }`; **`anchorFill: { width: MENU_BUTTON.width, height: 1 }`**. The width is not optional: the anchor is `MenuView`'s child at its own size (research D1, from `MenuView.android.tsx`), Compose lines the menu up with the anchor's edges, and a child with a height only would be zero-wide. Rewrite the doc comment: why the anchor is a strip along the header's bottom edge and not the dots (a `DropdownMenu` opens at its anchor's bottom edge; the dots' box ends 6 points above the bar's bottom in a 56-point bar), that `show()` is Android-only (on iOS it does nothing, which is why the iPhone is handled differently, US3), that a tap on the 1 dp strip also opens the menu and is harmless, and that the rows are data with `" •"` for news because a Material item's icon has to be an image source. **Done:** `tsc` clean and no lint finding in the file. Not run on an Android phone (T004).
- [ ] T004 [US1] On an Android phone (a development build with `@expo/ui`'s `MenuView`), in Marketplace and Threads, light and dark, quickstart.md section 3: the menu's top edge is at the header's bottom edge, overlap 0 (SC-001), with the dots, emblem and title visible; fully on screen with its right edge on the dots' side; a row opens its screen; a tap outside or the phone's back closes it and opens nothing; "Messages •" for news; the dots do not move or resize when it opens; TalkBack reads "More" ("More •" with news); and **compare the menu with another system menu on the same phone, they look and move alike** (SC-002). If it opens elsewhere, adjust the strip's width or position in `src/components/header-menu.android.tsx` and leave the menu alone. **Needs a device; not done here.**

**Checkpoint**: Android opens the Material menu below the header.

---

## Phase 4: User Story 3 - On an iPhone the menu does not cover the three dots (P1, an attempt)

**Goal**: with the phone's own menu, make one native-only attempt (research D2): the invisible native label reaches 12 points below the header, so the system may anchor its menu lower. Taking it back out is one constant. Ordered before US2 because US2's check needs both platforms' code; the spec's three P1 stories are otherwise independent.

**Independent test**: on an iPhone open Marketplace and tap the dots: note whether the system menu is below the header with the dots visible, then follow the decision rule in T007.

- [x] T005 [P] [US3] In `src/components/header-menu.ios.tsx` add `const ANCHOR_EXTENSION = 12;` above `HeaderMenu`, with a comment: how far the invisible native label reaches below the header so the system can anchor its menu lower; 12 is the spec's cap (FR-007); **`0` is exactly the behaviour before this feature**, which is how the attempt is taken back out. Change one thing in the `Menu`'s `label`: the `frame` modifier's height from `MENU_BUTTON.height` to `MENU_BUTTON.height + ANCHOR_EXTENSION` (width unchanged). Do not change anything else: the fixed 40 x 44 `box` (so the header's layout and the emblem's centre do not move, and the `Host` overflows it by `ANCHOR_EXTENSION` at the bottom), `MenuIcon` centred in the box, `MenuBadge`, `opacity(0)` (never `hidden()`), `contentShape(shapes.rectangle())`, the rows, the empty-list `return null`. Do not add an `overflow` style: the default (visible) is what lets the overflow take touches, and the wrapper the stack puts the header in (`zIndex: 1`) does not clip (research D2). Update the doc comment: the attempt, that the invisible label cannot be judged except on a phone, and the revert (`ANCHOR_EXTENSION = 0`); also the box's comment, which says the size does not depend on what the host measures: the host now measures `ANCHOR_EXTENSION` taller than the box, and the box is what stays fixed. **Done:** `ANCHOR_EXTENSION = 12`, label frame 40 x 56; `tsc` clean. Not judged on an iPhone (T007).
- [x] T006 [P] [US3] Verify the layout we own, headless (after T005), quickstart.md section 2. Make a harness in a new folder under the scratchpad, as feature 039's T043 did (Vite with `react-native` aliased to `react-native-web`, the repo's `node_modules` symlinked in): the **real** `AppHeader` (`src/components/app-header.tsx`) and the **real** `src/components/header-menu.ios.tsx`, with stubs only for `@expo/ui/swift-ui` (`Host` an inline-block, `Image` sized from its `frame` modifier, `Menu` rendering its label, `Button`), `@expo/ui/swift-ui/modifiers`, `expo-router` (`router`, `useTheme`), `expo-image`, `react-native-safe-area-context`, `@expo/vector-icons/Entypo`, the theme hooks and `@/i18n`, with `Platform.OS` patched to `ios` before the header module loads (bar 44). Render the header inside `<View style={{ zIndex: 1 }}>` followed by a content `View`, as the stack does. Build twice: the real file, and a copy in the scratchpad with `ANCHOR_EXTENSION` set to 0 by `sed`. Check: the label stub's frame is 40 x 56 at 12 and 40 x 44 at 0, `opacity(0)`, `contentShape`; the header's height, the emblem's centre and the dots' box (40 x 44) are **identical** at 12 and at 0; the `Host` overflows the box by exactly 12 at the bottom; a point 6 points below the header's bottom edge resolves to the label stub, and one 14 points below it to the content (SC-005). **Counter-assertion**: with the wrapper's `zIndex` removed, the point 6 points below resolves to the content, so the check can fail. Record in the result what it does not show: UIKit's hit-testing, whether the native screen container clips, and where the system menu opens. **Result:** the real `AppHeader` and the real `header-menu.ios.tsx`, at 12 and as a scratchpad copy at 0, in headless Chrome. **Identical at 12 and at 0**: the header (92 = inset 47 + bar 44 + hairline), the dots' box (40 x 44, same position), the emblem's centre, the glyph's centre and the title's box. **What changes**: the label's frame is 40 x 56 (was 44) with `opacity(0)` and `contentShape(rectangle)`, and the `Host` overflows the box by exactly 12 (was 0). Hit-testing at 12: the glyph and a point 6 below the header resolve to the native label, a point 14 below to the page content (SC-005), the emblem and the title to themselves; at 0 the 6-below point resolves to the content. **Counter-assertion**: with the header wrapper's `zIndex` removed the 6-below point resolves to the content, and with it restored to the label again. **Not shown**: UIKit's hit-testing, whether the native screen container clips, and where the system menu opens (T007).
- [ ] T007 [US3] On an iPhone, in Marketplace and Threads, light and dark, quickstart.md section 4, with `ANCHOR_EXTENSION = 12`: tap the dots and **see where the system menu appears relative to the dots and the header**; a tap on the page within 12 points under the header opens the menu, one 14 points or more below never does, and the emblem and title never do (SC-005); a row opens its screen once the menu has closed; a tap outside closes it and opens nothing; VoiceOver reads one button, "More" ("More •" with news); the menu is the system's, **compare it with another system menu on the same phone** (SC-002); note the iOS version. **Decision rule**: if the menu is below the header and the dots are visible, keep 12; if it still covers the dots, or taps on the extension do nothing, set `ANCHOR_EXTENSION = 0` in `src/components/header-menu.ios.tsx`, and do **not** draw a menu of the app's own or upgrade a library; if it clears only at a larger extension, report the number and stop, because the cap is the spec's (FR-007). **Needs a device; not done here.**
- [ ] T008 [US3] Record the T007 result (after T007): in `specs/040-menu-below-header/spec.md` add to Assumptions "iPhone result (iOS <version>): worked, `ANCHOR_EXTENSION` 12" or "did not help, `ANCHOR_EXTENSION` set to 0, the iPhone is as it was", and tick SC-003 or its alternative outcome; in `CLAUDE.md` make the iOS sentence from T013 say the same; and set the constant in `header-menu.ios.tsx` to match (12 or 0).

**Checkpoint**: the iPhone either has the menu below the header, or is exactly as it was and the spec says why.

---

## Phase 5: User Story 2 - The menu is still the phone's own, on both phones (P1)

**Goal**: nothing the app draws stands in for either system menu, and nothing is added to the app to make that so.

**Independent test**: open the menu on each phone and compare it with another system menu on that phone (steps in T004 and T007); statically, nothing replaces it.

- [x] T009 [P] [US2] Verify, in `expo-client/german-world-club`, after T003 and T005 (quickstart.md section 1): `grep -n "Modal\|header-menu-panel" src/components/header-menu*.tsx` prints nothing (no app-drawn menu, FR-002); `header-menu.ios.tsx` still imports `@expo/ui/swift-ui` and `header-menu.android.tsx` still imports `@expo/ui/community/menu`; `git diff --stat -- package.json ../../package-lock.json` prints nothing (no dependency, FR-008); `git diff --stat` lists only `header-menu-shared.tsx`, `header-menu.android.tsx`, `header-menu.ios.tsx` and `CLAUDE.md` of the app's and repo's files, besides the user's own `app-header.tsx` edit and the specs; no file in `src/components` named `header-menu-panel.tsx` exists. **Result:** no `<Modal`, no import of `Modal` and no `header-menu-panel` anywhere in `src/components/header-menu*.tsx` (the loose `grep -n "Modal"` also matches an older comment in `header-menu.ios.tsx` that mentions React Native's `Modal` in prose, which is not code); `header-menu-panel.tsx` does not exist; the iPhone file still imports `@expo/ui/swift-ui` and the Android file `@expo/ui/community/menu`; `package.json` and the lockfile are unchanged; the files changed in the app are `header-menu-shared.tsx`, `header-menu.android.tsx`, `header-menu.ios.tsx` and, from before, the user's `app-header.tsx` edit.

**Checkpoint**: both menus are the phones' own, and the change is confined to the files the plan names.

---

## Phase 6: User Story 4 - Nothing else about the header and menu changes (P2)

**Goal**: the dots, the unread marker, the rows, the accessibility names and both colour schemes behave as before.

**Independent test**: use Marketplace and Threads as before and compare.

- [x] T010 [P] [US4] Verify the Android button's own behaviour, headless (after T002): render the **real** `MenuDots` and `MenuIcon` from `src/components/header-menu-shared.tsx` through `react-native-web` in headless Chrome (same harness pattern as T006; stubs only for `expo-router`'s `router`, the theme hooks, `@/i18n` with `common.menu` "More", and `@expo/vector-icons/Entypo`), with `unread` false and true. Check: an element with `role="button"` and `aria-label` "More" ("More •" when unread); a 40 x 44 box with the glyph centred to within 1 px; the badge present only when unread, 8 x 8, with `pointer-events: none`; a press calls `onPress` exactly once, and the badge does not swallow it. **Counter-assertion**: a press on the badge's position with its `pointer-events` class removed would land on the badge, so the "takes no touch" check can fail. State what it does not show (the Compose menu, `show()`). **Result:** the real `MenuDots` through `react-native-web` in headless Chrome: a `button` with `aria-label` "More" ("More •" when unread); a 40 x 44 box with the glyph centred to 0 px; the badge only when unread, 8 x 8, `pointer-events: none`; one `click` is exactly one `onPress`, and a click at the badge's position resolves to the button and also presses once. **Counter-assertion**: with the badge's `pointer-events` class removed, that point resolves to the badge itself, so the check can fail. **Not shown**: the Compose menu and `show()` (T004).
- [ ] T011 [US4] On both phones, in Marketplace (`src/app/(member)/marketplace/index.tsx`) and Threads (`src/app/(member)/threads/index.tsx`), whose rows and unread marker this feature must not change, light and dark, as before this feature: the dots look and sit as they did (Entypo, theme tint) and do not move or resize when the menu opens (FR-005); with unread messages the dots carry the red dot and the Messages row its own marker; every row opens the screen it did (Messages, My listings, New listing; New post); a tab with no header actions still shows no dots; the header looks as before apart from the user's own padding edit. **Needs a device; not done here.**

**Checkpoint**: only where the menu opens has changed.

---

## Phase 7: Polish and cross-cutting

- [x] T012 [P] Run, in `expo-client/german-world-club`, after T003 and T005: `npx tsc --noEmit` (clean); `npx expo lint src/components` (no error in a touched file; `handle-form.tsx` is the known one and is not touched); `npx expo export --platform ios` and `--platform android` to the scratchpad (both succeed). Record the results in this task. **Result:** `tsc --noEmit` exit 0; `expo lint src/components`: one error, in `handle-form.tsx` (known, not touched); `expo export` for `ios` and for `android` both succeed.
- [x] T013 [P] Update `CLAUDE.md` (after T003 and T005): the `HeaderMenu` sentences in the Threads paragraph (from "The dots are one drawing on both platforms" to "Draw no pop-up of our own."). Keep what is still true (one `MenuIcon`; the icon is a `pointerEvents: 'none'` sibling laid over the iPhone's invisible `opacity(0)` native label, never inside it; no pop-up of our own). Replace the Android sentence: the dots are a button (`MenuDots`) that calls `ref.show()` on a `MenuView` whose child is a `MENU_BUTTON.width` x 1 strip along the bottom edge of a slot as tall as the bar, so the Material menu opens at the header's bottom edge, and the anchor needs a width because it is the child at its own size. Add the iPhone sentence: the label's frame is `ANCHOR_EXTENSION` taller than the dots' box so the system may anchor its menu lower; the result on a phone is recorded by T008 (until then say "untested"), and `0` is the revert. **Done:** the iPhone sentence says "Untested on a phone" and names T007; the Android sentence describes the button, `ref.show()` and the anchor strip and why it needs a width.

---

## Dependencies and order

```
T001 ─┬─► T002 ─► T003 ─► T004 (Android phone)                       [US1]
      ├─► T005 ─┬─► T006 (headless layout)                           [US3]
      │         └─► T007 (iPhone) ─► T008 (record the result)
      │
      ├─► T003, T005 ─► T009 (static: nothing app-drawn)             [US2]
      ├─► T002 ─► T010 (headless MenuDots)  ·  T011 (both phones)    [US4]
      └─► T003, T005 ─► T012 (tsc, lint, export)  ·  T013 (CLAUDE.md) ─► T008 updates it
```

- **US1 and US3 are independent**: different files (`header-menu.android.tsx` with `header-menu-shared.tsx`; `header-menu.ios.tsx`). T002 and T005 can start together.
- T003 needs T002 (it uses the button's `onPress`). T006 and T007 need T005. T008 needs T007's result and decides the constant.
- T009, T012 and T013 need both platform files (T003 and T005). T010 needs only T002.
- T004, T007 and T011 need a phone. Everything else can be done and verified here.

## Parallel example

```bash
# Together, once T001 is done (different files):
T002  header-menu-shared.tsx   (MenuDots becomes a button)
T005  header-menu.ios.tsx      (ANCHOR_EXTENSION)

# Then, together:
T003  header-menu.android.tsx  (after T002)
T006  headless layout check of the iPhone file (after T005)
T010  headless check of MenuDots (after T002)
```

## Implementation strategy

1. **MVP = T001 to T004 (US1, Android).** It is the platform where the request is known to be achievable with the Material menu unchanged, and it is one small change in two files. It can ship without the iPhone.
2. **The iPhone attempt (T005 to T008) is an experiment with a fixed escape**: `ANCHOR_EXTENSION = 12` or `0`. Do T005 and T006 here, then give the user T007 to try; do not claim it works before a phone says so. The research says the likeliest outcome is not certain either way: the menu may still open over the dots.
3. **US2 and US4 are checks, not features**: T009, T010 and T012 run here; T011 is with the phones. They protect "do not change the native menu" and "nothing else changes".
4. Finish with T013 (docs), and T008 once there is a phone result. Commit and push only when asked.
