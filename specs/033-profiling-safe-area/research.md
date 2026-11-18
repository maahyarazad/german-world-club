# Research: status-bar overlap on header-less screens

## R1. Where the gap comes from

**Decision**: the shared containers, not the profiling screens, are the defect.

**Rationale**: `FormScreen` wraps its content in `SafeAreaView edges={['bottom']}`; `Centered` (and `Loading`, which renders it) is a plain `View`. The profiling group, `(applicant)/waiting` and `r/[code]` set `headerShown: false`, so nothing else pushes content below the status bar. Screens that show a native header are pushed down by the header itself.

**Alternatives considered**: padding each profiling screen by hand (rejected: breaks FR-003, and drifts); a fixed 44/48 px (rejected: FR-002, wrong on every other model).

## R2. Which API measures it

**Decision**: use `SafeAreaView` from `react-native-safe-area-context` with `edges={['top', 'bottom']}`.

**Rationale**: the library is already a dependency and used in the same file. Its native `SafeAreaView` applies the insets by measuring how much the view actually overlaps the unsafe area (status bar, cut-out, home indicator) on iOS and Android, so a view laid out below a native header receives a top inset of 0. That satisfies FR-004 without knowing whether a header exists. `expo-router` mounts the provider, so no root change is needed. No native module is added (FR-007).

**Alternatives considered**: `useSafeAreaInsets()` plus manual `paddingTop` (rejected: it reports the screen's insets, not the view's overlap, so it double-pads under a header and needs the header state); `StatusBar.currentHeight` (rejected: Android only, ignores cut-outs); `useHeaderHeight()` (rejected: throws on screens with no header).

**Open check**: confirm on device that screens under a native header (public register/country, member screens) show no extra gap; if any does, pass `edges={['bottom']}` from that screen via an optional prop. Recorded as a task, not assumed.

## R3. Status bar icon colour

**Decision**: leave as is.

**Rationale**: `userInterfaceStyle` is `automatic` and the screens' backgrounds follow the theme; with content now below the bar the icons sit on the theme background in both appearances (FR-006). Verified in the manual walk-through.

## R4. Dependents of `Centered` and `Loading`

**Decision**: change `Centered` itself; `Loading` and the roughly 20 member screens that use them inherit it.

**Rationale**: member screens sit under native headers or tabs, where R2 gives a 0 top inset, so they should look unchanged; the quickstart checks a sample of them.
