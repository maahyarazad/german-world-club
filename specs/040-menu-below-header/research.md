# Research: the header menu below the header, kept native (feature 040)

Everything below about the libraries was read in the installed source under `node_modules` (`@expo/ui` 57.0.20, `react-native` 0.86, `expo-router`'s native stack), not taken from documentation for a newer SDK. The earlier findings this builds on are in [feature 039's research.md](../039-profile-activity-tabs/research.md) (R1 to R6); read its banner first, it records what was withdrawn and one correction.

**Inputs from the spec**: the menu stays the phone's own on both phones (FR-002, no app-drawn menu); Android opens below the header (FR-001); the iPhone gets one native-only attempt, taken back out if it does not help (FR-003, Q1 option B); the area that opens the menu may extend at most 12 points below the header (FR-007).

## D1. Android: keep `MenuView`, move its anchor to the header's bottom edge

**Decision.** The dots become an ordinary button that calls `ref.show()`. The `MenuView`'s own child is a thin invisible strip along the bottom edge of a slot as tall as the header's bar, so the Material menu opens at the header's bottom edge. The menu itself is untouched.

**Evidence** (`@expo/ui/src/community/menu/MenuView.android.tsx`, read in full):

- `MenuView` renders `<View style><Host matchContents><DropdownMenu expanded><DropdownMenu.Trigger><RNHostView matchContents><Pressable>{children}</Pressable></RNHostView></DropdownMenu.Trigger><DropdownMenu.Items/></DropdownMenu></Host></View>`. So the **anchor is the `children`**, at the size they are laid out, and the menu is a Compose `DropdownMenu`, which opens at the bottom edge of its anchor.
- `show()` is `open`: it flips the same `expanded` state a tap on the trigger flips, so a separate button can open the menu.
- The outer `View` takes `style`; the `Host` is `matchContents`, so the anchor is exactly the child's size.
- **A detail that changes the earlier design (039 T050):** the anchor needs an explicit **width** as well as height. A child with `height: 1` and no width is zero-wide, and Compose aligns a menu to the anchor's edges, so a zero-wide anchor would put the menu's edge at one point instead of lining it up with the dots. The child is `MENU_BUTTON.width` wide and 1 high.
- There is no offset prop on `DropdownMenu` in this package, so placement is chosen only by choosing the anchor.

**Alternatives considered.** Keep the dots as the anchor and live with the menu starting a few points above the header's bottom (the slot's bottom is 6 points below the 44-point dots box in a 56-point bar): rejected, it is the reported fault in a milder form. Build the menu from `@expo/ui/jetpack-compose` directly: more code for the same result, and it would change what the menu is made of. Draw an app card: declined (FR-002).

## D2. iPhone: lengthen the invisible native label downward, behind a one-line switch

**Decision.** In `header-menu.ios.tsx` the system `Menu`'s label (already an invisible native `Image` at `opacity(0)`, framed to the dots' 40 x 44 box with `contentShape`) is framed `ANCHOR_EXTENSION` points taller (12), so the area the system anchors its menu to reaches below the header. The dots, the 44-point box they sit in, the header's layout and the unread badge are unchanged. **`ANCHOR_EXTENSION = 0` is today's behaviour exactly**, so taking the attempt back out (FR-003) is changing one constant.

**Why it can work at all, and what was checked:**

- A touch below the header's bottom edge must reach the label. `react-native/React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm` (`hitTest:`, about lines 740 to 770): a view that does not clip, and has children overflowing it, still hit-tests those children outside its bounds. (This **corrects** the 039 research, which said the opposite.)
- Nothing in the header's own chain clips: the stack wraps a custom header in `<View style={{ zIndex: 1 }}>` (`expo-router/build/react-navigation/native-stack/views/NativeStackView.native.js`, `styles.header`), a plain view, rendered before the screen's content. Its `zIndex: 1` makes it a later, hence first-tested, sibling of the content, so the page content below the header does not take the touch first. The one `overflow: 'hidden'` in that file is `styles.background`, which is only the header's background layer. `app-header.tsx`'s own views (`container`, `row`, the right column) set no overflow.
- The invisible label draws nothing, so the part that lies over the page is not visible.
- `frame` takes `width`, `height` and `alignment` (`swift-ui/modifiers/index.d.ts`); `contentShape(shapes.rectangle())` already makes the whole frame the tap area, so the longer frame is tappable without any other change.

**What is not known, and cannot be from here:**

1. Whether the native screen container (`react-native-screens`' native view) clips its children. If it does, the extension gets no touches and the attempt fails before the menu question.
2. **The main one:** whether the system opens its menu below a longer label or still over it. On the phone the menu opened over the dots with a label exactly the dots' size, which is consistent with the system presenting the menu over its source view; if so, a longer label would still be covered, dots included. If it instead places the menu relative to the label's bottom edge, the dots clear. Only an iPhone shows which. The iOS version was not reported.
3. Whether 12 points is enough. It is the spec's cap (FR-007), and may not be enough to clear the menu's overlap with its source even if the second point goes the right way.

**Cost of being wrong**: the attempt is invisible and costs a few points of tap area under the header, so a failed attempt is removed by setting the constant to 0 (or deleting it), and the iPhone is exactly as it is today (Q1: no app-drawn fallback, no library upgrade).

**Alternatives considered.**

| Option | Verdict |
|---|---|
| A. Leave the iPhone as it is | Always available as the fallback; no progress on the iPhone. |
| An app-drawn card (feature 039 US9) | Declined: "do not change the native menu". |
| A newer `@expo/ui` that can place the menu (Q1 option C) | Not chosen; could mean an SDK upgrade, its own decision. Not checked. |
| A taller label that also moves the dots | The dots are drawn by React Native over the label and stay in the 44-point box; moving them would change the header (FR-005). |
| A different SwiftUI primitive (`Popover`, `ContextMenu`) | `Popover` has only coarse anchors and becomes a sheet on an iPhone (039 research R2); `ContextMenu` is a long-press menu. Neither is the menu the member uses today. |

## D3. Nothing else is added

No new dependency, native module, string or shared contract. The iPhone file keeps its `@expo/ui` imports (the system menu is the point); the Android file keeps `@expo/ui/community/menu`. The `MenuDots` component (used only by the Android file) changes from a picture to a button. The earlier plan's `common.close` string and the `header-menu-panel.tsx` file belong to the withdrawn card and are not part of this feature.

## D4. How it is validated

- **Headless:** neither system menu can be rendered in a browser. What can be checked there is the part of the change that is our own layout: with the label extension on, the header's height, the emblem's centre and the dots' position are unchanged, the 44-point box does not grow, and a point in the extension region resolves to the label and not to a stand-in for the page content (with the header wrapper and content built in the stack's own order, the wrapper with `zIndex: 1`). That shows the layout invariants and the web's stacking, not UIKit's hit-testing.
- **Static:** `tsc`, `expo lint`, `expo export` for both platforms, and that no dependency changed.
- **On a phone** (the only real test of D1's placement and D2's attempt): see `quickstart.md`.
