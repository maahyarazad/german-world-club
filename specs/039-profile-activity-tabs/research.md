# Research: the menu opens below the header (feature 039, seventh pass)

**Request**: "In iOS the three dots open a menu, and this menu opens on top of the three dots (the icon goes behind the menu). The menu should open below the entire header (`<Stack screenOptions={{ header: renderAppHeader }}>`), on both iOS and Android."

All facts below about `@expo/ui` 57.0.20 were read in `node_modules/@expo/ui/build` (types), not taken from the SDK 58 docs the earlier requests quoted.

> **Superseded in part by [feature 040](../040-menu-below-header/spec.md).** The decision in R3 (an app-drawn card on the iPhone) was **declined**: the instruction is *do not change the native menu*. R1, R2, R5 (Android) and the facts about what the library can and cannot do stand. R3 row B and a sentence in R4 contained an error, corrected in place below.

## R1. What T045 found

T045 asked, on an iPhone: does an invisible native label take taps, and does the menu open below the dots and not over them? The report is that the menu opens, and opens **over** the dots, which then sit behind it. That is the second branch T045 anticipated ("it opens but still covers the dots"). It also means the sixth pass did what it was built to do (an Entypo icon on the iPhone, a native menu that opens) and still cannot give the placement, so this is not a fault in the layering.

The iPhone's iOS version was not reported. The behaviour is consistent with a SwiftUI `Menu` presenting out of its own label and covering it. That is a reading, not a measurement.

The new requirement is stronger than "under the dots": the menu must clear the **whole header**, not only the dots' 40 x 44 box, and on Android as well.

## R2. What the installed package can and cannot do

| Fact | Where | Consequence |
|---|---|---|
| `Menu` takes `label`, `systemImage`, `onPrimaryAction`, `children`. `menuStyle`, `menuIndicator`, `menuOrder` do not choose a side or an offset. | `swift-ui/Menu/types.d.ts`, `modifiers/index.d.ts` | The iPhone's system menu cannot be placed. Its anchor is its own label. |
| `MenuView`'s `ref.show()` is **Android only**. On iOS it is a no-op: "SwiftUI `Menu`/`ContextMenu` have no programmatic open API". | `community/menu/types.d.ts` | On iOS the thing tapped and the thing the system anchors to must be the same view, so the anchor cannot be moved below the header. |
| `MenuView`'s `onOpenMenu` / `onCloseMenu` are Android only. | same | No close hook on iOS either, so a row's navigation cannot wait for the menu through it. |
| SwiftUI `Popover` has `isPresented`, but `attachmentAnchor` is one of `leading`, `trailing`, `center`, `top`, `bottom` of its trigger, and `arrowEdge`. No rectangle, no offset. `presentationModifiers` has detents, sizing, background and the like, and no compact-adaptation modifier. | `swift-ui/Popover/index.d.ts`, `modifiers/presentationModifiers.d.ts` | It could be opened by a flag, but not placed under a header, and on an iPhone SwiftUI turns a popover into a sheet unless told otherwise (SwiftUI's default; not shown in this package, which has no way to tell it otherwise). |
| Compose `DropdownMenu` takes `expanded`, `onDismissRequest`, and uses its children as the anchor. No offset prop. | `jetpack-compose/DropdownMenu/index.d.ts` | On Android the menu opens at the **bottom edge of its anchor**, so placement is chosen by choosing the anchor. `show()` lets the anchor be a different view from the one tapped. |

## R3. Options

| Option | iPhone | Android | Verdict |
|---|---|---|---|
| A. Keep SwiftUI `Menu`, only tune the label | cannot change the side; it already covers the dots | n/a | Rejected: no control exists (R2). |
| B. Make the native label taller so its bottom is below the header | the label is also the tap target, so the area that opens the menu grows below the header. **Correction:** this row first said a view outside its parent's bounds gets no touches on iOS. That is wrong for the installed React Native: in `React/Fabric/.../RCTViewComponentView.mm` (`hitTest:`, about lines 740 to 770) a view that does not clip still hit-tests children outside its bounds. So hit-testing does not rule it out. Whether the system then opens its menu below the header, or still over the dots, is not known | n/a | **Not rejected; untested.** Carried to feature 040 as the one native-only iPhone idea. |
| C. SwiftUI `Popover` | a sheet on an iPhone, coarse anchors | n/a | Rejected. |
| D. **An in-app drop-down for the iPhone**: a transparent `Modal` with a card whose top edge is the header's bottom edge | full control, deterministic | | **Chosen for iPhone.** |
| E. **Android: keep `MenuView`, move the anchor**: the dots become an ordinary pressable that calls `ref.show()`, and the `MenuView`'s own child is a thin invisible strip along the header's bottom edge | | Material's own menu, opening at the strip's bottom edge | **Chosen for Android.** |
| F. D on both platforms | one look, one code path | loses the Material menu that already works | Not chosen; the smaller change is E. It is the fallback if `show()` misbehaves on a phone, and is a few lines (R6). |

**Decision.** D on iPhone, E on Android. This **reverses the sixth pass's premise for the iPhone only** (feature 039 US8 / FR-022: "the app draws no pop-up of its own"). The reason is not taste: the requirement is placement, and the system menu on iOS offers no way to give it. Android keeps the platform menu.

What the iPhone loses by D: the system's own look, its animation and, on iOS 26, its glass. D draws a card in the system's style (rounded corners, a hairline, a soft shadow, 17 pt rows at least 44 pt tall, the theme's card and text colours) and fades in. It will not be indistinguishable from the system's, and this plan does not pretend it will.

What it gains besides placement: the iPhone no longer needs `@expo/ui`'s `Menu` in the development build, so the "missing native view, rebuild" caveat (spec assumption 3, T040) now applies to Android only (`MenuView`).

## R4. iPhone design (D)

- **Where the card goes.** The header's bottom edge is computed from the dots, not from the status bar. The dots' box is centred vertically in the bar's row, and the bar's height is known (`HEADER_BAR_HEIGHT`, 44), so at the moment of the tap `ref.measureInWindow` gives the dots' `y` and `height`, and the header's bottom is `y + height / 2 + HEADER_BAR_HEIGHT / 2`. The card's top is that plus the hairline and `Spacing.one`. This is why it is not `insets.top + HEADER_BAR_HEIGHT`: inside a screen presented as an iOS sheet (Threads and Profile have some) the header does not start at the top of the window, and a computed position would be wrong there, while a measured one is not. The card opens after the measurement returns, so its first frame is already in place.
- **Right-aligned** at `Spacing.two` from the screen's edge, where the dots are; `minWidth` 220, `maxWidth` the screen's width less both margins, so a long German label wraps and does not run off screen.
- **A `Modal`**, `transparent`, `animationType="fade"`, with a full-screen `Pressable` behind the card as the tap-outside target, `onRequestClose` for the same on a hardware back, and no dim (FR-012). A full-screen backdrop is the simplest way to catch a tap outside the card. (An earlier version of this sentence said a `Modal` was the only way, because a view outside its parent receives no touches on iOS; that is wrong, see R3 row B.)
- **A row's navigation waits for the modal.** A `Modal` is a view controller, and a screen pushed while one is dismissing can be dropped. So a row stores its `href`, closes the modal, and the push runs in the `Modal`'s `onDismiss` (iOS-only prop, which is the only place this file runs). This is the same wait the first version of the menu had (plan item 2, "Why not the first version's Modal").
- **The dots become an ordinary pressable** (`MenuDots` gets `onPress` and a ref to measure), still `MenuIcon` inside, still labelled "More" with " •" when a row has news. The invisible native label, `Host` and `Menu` come out of `header-menu.ios.tsx`.
- **Accessibility.** The dots are a button ("More"); the card has `accessibilityViewIsModal`; rows are buttons with their labels; the backdrop is labelled "Close" (a new string, `common.close`, "Close" / "Schließen", in both catalogues: no existing one fits).
- **Styles** in `StyleSheet.create`; the colours from the navigation theme (`card`, `border`, `text`) and the app theme (`danger` for the dot), through `useThemedStyles`. No inline style object.
- The panel is its own file (`header-menu-panel.tsx`) and imports nothing native, so it can be rendered for real through `react-native-web` (R6), and so option F is available later without writing it twice.

## R5. Android design (E)

- The right-hand slot becomes a fixed box, 40 wide and `HEADER_BAR_HEIGHT` (56) tall, so its bottom edge is the bar's bottom edge. In it: the dots (`MenuDots`, an ordinary pressable, centred, 44 tall tap area) and, absolutely positioned along the box's bottom edge, the `MenuView` with `style` of a 1-dp-high strip and an empty child.
- Pressing the dots calls `menuRef.current?.show()`. Compose's `DropdownMenu` puts its popup at the **bottom-start of its anchor**, shifts it to keep it on screen when the anchor is at the right edge (it is), and flips above only if there is no room below, which for a header at the top there always is. So the menu's top edge is the header's bottom edge, with the dots and the emblem uncovered. `onPressAction` and the rows are as they were (`" •"` on a row with news).
- The strip is also inside a `Pressable` that `MenuView` adds, so a tap on that 1-dp line would open the menu too. That is harmless, and it is 1 dp.
- No new dependency, no new native code.

## R6. What cannot be shown from here, and the fallbacks

- **Headless (real, not stubbed).** The panel imports no native module, so the real `header-menu-panel.tsx` and the real `MenuDots` render through `react-native-web` in headless Chrome. Geometry is then measured, not assumed: the card's top is at or below the header's bottom for several header heights and offsets, the card is right-aligned, rows wrap inside `maxWidth`, a tap outside closes it, a row closes it first and navigates after, and a **counter-assertion** (the card positioned from the wrong anchor, the dots' bottom, overlaps the header) shows the check can fail.
- **Not shown without a phone:** the Android `show()` call and where Compose puts the popup; the iOS `Modal` over a native-stack screen (that it is transparent, does not dim, and that `onDismiss` fires before the push); VoiceOver and TalkBack; the iOS sheet case.
- **Fallbacks, in order.** If `show()` does nothing or the popup is wrong on Android: use D there too (option F), which is the same panel with `Modal`'s `statusBarTranslucent`, and `header-menu.android.tsx` shrinks to that. If `Modal`'s `onDismiss` is unreliable on iOS: push on a short timeout after close instead.
