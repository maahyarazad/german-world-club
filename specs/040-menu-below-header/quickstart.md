# Quickstart: validating "the menu opens below the header, and stays the phone's own" (feature 040)

Spec: [spec.md](./spec.md) (US1 to US4, FR-001 to FR-008, SC-001 to SC-005). Design: [plan.md](./plan.md). Evidence and what is not known: [research.md](./research.md).

All commands run in `expo-client/german-world-club` unless stated.

## 1. Static checks (no device)

```bash
npx tsc --noEmit                                        # clean
npx expo lint src/components                            # no error in a touched file (handle-form.tsx is the known one, untouched)
npx expo export --platform ios     --output-dir <scratch>/export-ios
npx expo export --platform android --output-dir <scratch>/export-android
git diff --stat -- package.json ../../package-lock.json # expect no output: no new dependency
grep -n "Modal\|header-menu-panel" src/components/header-menu*.tsx   # expect no output: no app-drawn menu (FR-002)
```

Expected: both bundles build; `header-menu.android.tsx` still imports `@expo/ui/community/menu` and `header-menu.ios.tsx` still imports `@expo/ui/swift-ui`; neither file draws a menu of its own.

## 2. Layout of the part that is ours, in a browser

The system menus cannot be rendered in a browser (they are SwiftUI and Jetpack Compose). What can be checked is the iPhone file's own layout with `@expo/ui` stubbed, the way feature 039's T043 did (Vite with `react-native` aliased to `react-native-web`, the real header and the real `header-menu.ios.tsx`, stand-ins for the SwiftUI components that record their props): render the header and the page content in the stack's own order (the header wrapped in a view with `zIndex: 1`, then the content), with `ANCHOR_EXTENSION` at 12 and at 0.

| Check | Expected |
|---|---|
| Label frame given to the native `Image` | 40 wide, `44 + ANCHOR_EXTENSION` tall, `opacity(0)`, `contentShape(rectangle)` |
| Header's height, the emblem's centre, the dots' box (40 x 44) | identical at 12 and at 0 (the extension changes no layout, FR-005) |
| The `Host` overflows the box | by exactly `ANCHOR_EXTENSION` at the bottom, none elsewhere |
| A point inside the extension, below the header | resolves to the label stand-in, not to the page content |
| A point 14 points below the header's bottom edge | resolves to the page content (SC-005) |
| **Counter-assertion** | with the header wrapper's `zIndex` removed, the same point inside the extension resolves to the page content, so the check can fail |

What this does not show: UIKit's hit-testing, whether the native screen container clips, and anything about where the system menu opens (section 4).

## 3. Android phone (a development build with `@expo/ui`'s `MenuView`)

Marketplace and Threads, light and dark:

1. Tap the three dots: **the Material menu's top edge is at the header's bottom edge** and the dots, the emblem and the title are all visible (SC-001).
2. The menu is fully on screen although the dots are at the right edge, and its right edge lines up with the dots' side of the screen (the anchor strip's width, research D1).
3. A row opens its screen; a tap outside or the phone's back closes the menu and opens nothing; a row with news reads "Messages •".
4. The dots do not move or resize when the menu opens (FR-005).
5. TalkBack reads the dots as a button called "More" ("More •" with news).

If the menu opens somewhere other than the header's bottom edge, adjust the strip's width or position in `header-menu.android.tsx`; the menu itself is not changed.

## 4. iPhone: the one attempt, and what to do with the result

With `ANCHOR_EXTENSION = 12`, in Marketplace and Threads, light and dark:

1. Tap the three dots. **Look at where the system menu appears relative to the dots and the header.**
2. Tap on the page just under the header: within 12 points of the header's bottom edge it opens the menu (expected, it is the extension); **14 points or more below it, it never does** (SC-005). Tap the emblem and the title: they never do.
3. A row opens its screen once the menu has closed; a tap outside closes it and opens nothing; VoiceOver reads one button, "More" ("More •" with news).
4. Note the iOS version of the phone.

**Decision rule (spec FR-003, SC-003):**

| What you see | Then |
|---|---|
| The menu is below the header and the dots are visible | Keep `ANCHOR_EXTENSION = 12`. Record "worked, iOS <version>" in the spec and in `CLAUDE.md`. |
| The menu still covers the dots, or taps on the extension do nothing | Set `ANCHOR_EXTENSION = 0`. The iPhone is exactly as it was. Record "did not help, iOS <version>" in the spec (SC-003's alternative outcome) and in `CLAUDE.md`. Do **not** draw a menu of the app's own, and do not upgrade the library in this feature. |
| Mixed (it clears at a larger extension only) | The spec's cap is 12 points (FR-007); anything larger is a change to the spec, so report the number and stop. |
