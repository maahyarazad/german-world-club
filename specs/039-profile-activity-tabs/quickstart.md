# Quickstart: validating "the menu opens below the whole header" (US9)

Spec: [spec.md](./spec.md) (US9, FR-026 to FR-029, SC-010). Design: [plan.md](./plan.md) item 8. Reasons and fallbacks: [research.md](./research.md).

All commands run in `expo-client/german-world-club` unless stated.

## 1. Static checks (no device)

```bash
npx tsc --noEmit                                   # clean
npx expo lint src/components                       # no error in a touched file (handle-form.tsx is the known one, untouched)
npx expo export --platform ios     --output-dir <scratch>/export-ios
npx expo export --platform android --output-dir <scratch>/export-android
grep -n "@expo/ui" src/components/header-menu.ios.tsx   # expect no output: the iPhone no longer imports it (FR-029)
git diff --stat -- package.json ../../package-lock.json # expect no change: no new dependency (FR-029)
```

Expected: both bundles build; `header-menu.android.tsx` still imports `@expo/ui/community/menu`; nothing else in `src` imports `@expo/ui/swift-ui` for the menu.

## 2. Geometry in a browser (real code, not stubbed)

`header-menu-panel.tsx` and `MenuDots` import no native module, so they render for real through `react-native-web` in headless Chrome. Only the router, theme, strings and the Entypo font are stubbed (the harness used for T043 in `tasks.md` shows how: Vite with `react-native` aliased to `react-native-web`). Render a stand-in header (a bar of 44 and one of 56 with the dots at the right, and a header lower in the window to stand for an iOS sheet), press the dots, and check:

| Check | Expected |
|---|---|
| Card top vs the header's bottom edge, for each header | card top is at or below it; overlap 0 px (SC-010); gap is the hairline plus `Spacing.one` |
| Card right edge | `Spacing.two` from the window's right edge |
| Dots, emblem, title | not covered by the card (the card's rectangle does not intersect theirs) |
| A long German label | wraps; the card stays within `maxWidth` |
| Tap outside the card | closes; nothing navigates |
| Tap a row | closes first; `router.push` is called only after `onDismiss` fires, once |
| Row with news | red dot present; without news, absent |
| `accessibilityLabel` | the dots read "More" ("More •" with news); the backdrop reads "Close" |
| **Counter-assertion** | position the same card from the dots' own bottom edge instead: it overlaps the bar. The check must be able to fail |

What this cannot show: `Modal` over a native-stack screen, and Android's `show()` (section 3).

## 3. On the phones (needs a development build with `@expo/ui`'s `MenuView`)

Marketplace and Threads, light and dark, on an iPhone and an Android phone:

1. Tap the dots. **The menu's top edge is under the header, and the dots and the emblem are still visible** (SC-010). The page is not dimmed.
2. iPhone: the card is right-aligned under the dots; a long German row wraps; a tap on the header while it is open closes it and does not also press anything.
3. Android: the Material drop-down opens under the header's bottom edge and stays on screen although the dots are at the right edge.
4. A row opens its screen (iPhone: after the card has gone, not during); the back button and the edge swipe return; the menu is closed when you come back.
5. A row with news: iPhone red dot beside the label; Android "Messages •".
6. VoiceOver and TalkBack: "More" button; iPhone rows read by label, the area outside the card "Close".
7. A screen shown as an iOS sheet that has this header: the card is below that screen's header, not below the top of the window.
8. Rotate the phone with the menu open (iPhone): the card stays inside the screen.

## 4. If something fails

- Android: the drop-down does nothing, or opens somewhere other than under the header → use the panel on Android too (research.md R3, option F).
- iPhone: a row's screen does not open after choosing it → `onDismiss` did not fire; push after a short timeout instead (research.md R6).
- iPhone: the card is below where it should be → check the measured `anchorBottom` against the header's height; the dots' box is assumed to be vertically centred in the bar's row (`app-header.tsx`).
