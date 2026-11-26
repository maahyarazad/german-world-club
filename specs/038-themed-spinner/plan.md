# Implementation Plan: A themed, growing-arc loader on the web and in the app

**Branch**: `038-themed-spinner` | **Date**: 2026-11-26 | **Spec**: [spec.md](./spec.md)

**Input**: the supplied sample, saved as [loading-spinner.html](./loading-spinner.html).

## Summary

Replace how the club's loader is drawn and how it moves, on both platforms, without changing where it is used or how it is announced. Every loader (page, screen, button) already goes through one `Spinner` component per platform, so changing those two components changes them all. Nothing on the server changes.

- **Web**: the figure becomes CSS, taken from the sample almost as given: a conic-gradient arc whose two ends are registered `<angle>` properties animated by keyframes (a 1.5 s turn, a 3 s grow-and-shrink), clipped to a ring by `background-clip: border-area` with a mask fallback. The colours are the one thing that is **not** taken from the sample.
- **App**: React Native has no conic gradient and `react-native-svg` needs a new native build, which this must not need (feature 030). The same figure is built from two clipped half-rings and transforms, all on the native driver, and its geometry was checked against the sample's keyframes at 101 points.

## Technical Context

**Language/Version**: TypeScript (strict); React 19 on the web (Vite, Tailwind v4), React Native 0.86 / Expo SDK 57 in the app.

**Primary Dependencies**: none added. The web uses plain CSS in a new stylesheet; the app uses `Animated` from React Native.

**Storage**: N/A.

**Testing**: the web has vitest and a stylesheet-reading test (below). The app has no test runner (`lint` and `typecheck` only), so the app is checked by those, by a numeric check of the arc geometry, and by rendering the real component through `react-native-web` in a headless browser.

**Target Platform**: modern browsers; iOS and Android.

**Project Type**: web client and mobile app on one API; this feature touches neither the API nor `packages/contracts`.

**Performance Goals**: ten loaders on a screen cost no frame drops: all app motion is on the native driver, and each `interpolate` is built once per value.

**Constraints**:
- `client/scripts/check-tokens.mjs` and `theme.css` make the console's palette the only source of colour, so the new stylesheet defines none (it uses `currentColor` and `color-mix`).
- No new native module in the app, so no new EAS build.
- The loader stays `aria-hidden` and text-free; the label belongs to the wrapper.
- The grace period before a loader appears, the sizes and the wrappers do not change.

**Scale/Scope**: two components, one stylesheet, one test file rewritten, docs. Every existing loader inherits the change.

## Constitution Check

| Principle | Verdict | Note |
|---|---|---|
| I. One rule set, three clients | Pass | Sizes and thickness are one table per platform with the same values; the web test reads the stylesheet so its half cannot drift. The loader has no business rule. |
| II to V | Not touched | No route, response, outbound call or persistence. |
| VI. The server shapes what leaves it | Not touched | No server change. |
| Technology baseline: public pages need no JavaScript | Pass | The landing pages are static and do not load the console stylesheet or any loader. |

No violation, so nothing in Complexity Tracking.

## Decisions

1. **Keep the existing element semantics, take only the figure.** The sample is a `<progress>`; the app's loaders are `aria-hidden` and carry no text, because `PageLoader`, `ScreenLoader` and `Button` own the label. Using a `<progress>` inside a button would announce a second progress bar, so the figure is a decorative `<span>`. This is also what "the progress and the text will remain the same" asks for.
2. **Colours from each platform's theme.** Web: the arc is `currentColor` (navy by default through the existing `text-navy`, white in a primary button) and the ring is `color-mix(currentColor 25%, transparent)`, the same quarter strength as before; the console is one theme, so there is no dark variant to add. App: `theme.tint`, or the colour a caller passes (a button's label colour); the ring is the same colour at 25% opacity. The sample's blue, greys and dark mode are not used.
3. **Slow, do not stop, under reduced motion.** Taken from the sample (6 s a turn, fixed 158° arc). This replaces feature 030's "nothing rotates". A loading indicator is essential content, which WCAG 2.2.2 exempts from pause/stop, and a frozen loader reads as a hung page.
4. **Flat CSS, not nested.** The sample nests `@supports` and `@media` inside a rule. The build handles nesting, but flat rules need no lowering and are easier to test as text.
5. **Thickness by size** is 1/12 of the size, never under 2 px (2, 2, 3 and 4 px for 14, 20, 32 and 48). The sample's 4 px is the 48 px case. Feature 030 used 1/8; the thinner ring is the sample's look.
6. **App: two half-rings, not an erase.** An arc between a tail and a head can be drawn by drawing `[0, head]` and painting `[0, tail]` over it in the track colour, but that needs an opaque track and leaves a fringe. Instead the arc is drawn in a frame turned by the tail, as `[0, L]`, from two half-rings that each reveal one half of the circle. It needs no opaque colour, so the ring stays translucent over any background. The left half-ring is opacity 0 while it has nothing to show, because its edges then sit exactly on the clip's edges and leak hairlines.

## Project Structure

### Documentation (this feature)

```text
specs/038-themed-spinner/
├── spec.md
├── plan.md                  # this file
├── tasks.md
└── loading-spinner.html     # the supplied sample, kept as the reference (like 030's main-loader.html)
```

### Source Code

```text
client/
├── src/styles/spinner.css                 # NEW: the figure and its motion
├── src/konsole.tsx                        # imports it beside theme.css
├── src/components/ui/Spinner.tsx          # a <span class="gwc-spinner">, SPINNER_THICKNESS added
└── tests/components/spinner.test.tsx      # rewritten: markup plus a test that reads the stylesheet

expo-client/german-world-club/
└── src/components/spinner.tsx             # the arc from two clipped half-rings

specs/030-main-loader/contracts/ui-contract.md   # a note that 038 supersedes its figure and motion
CLAUDE.md                                        # the loader paragraph
```

**Structure Decision**: no new component and no new prop. `Spinner`'s API (`size`, and `className` on the web, `color` in the app) is unchanged, so `PageLoader`, `ScreenLoader`, `Button`, `Loading` and every call site inherit the figure.
