# Feature Specification: Expo app styles live in `StyleSheet.create`

**Feature Branch**: `035-merchant-store-offers` (work continues on the current branch; this folder is numbered 036 so it does not overwrite 035's finished artifacts)

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "In the branch check the entire Expo application and all the inline style should be changed to Stylesheet.create from react-native."

## Background

The Expo app (`expo-client/german-world-club`) has 88 `.tsx` files. 47 of them style components with object literals written in JSX: 201 `style={{ … }}` lines, 7 more `contentContainerStyle={{ … }}`-style props, and 24 `style={[ … { … } ]}` arrays that embed an object. Only 7 files already use `StyleSheet.create`. Inline literals are rebuilt on every render, cannot be reused, hide a screen's layout inside its markup, and make the visual consistency work of features 033/034 and the recent form-layout changes harder than it should be.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Shared components style through `StyleSheet.create` (Priority: P1)

A developer opening any file under `src/components/` finds its layout in one `StyleSheet.create` block at the bottom of the file, and the JSX refers to `styles.x`. The theme-dependent values (colours) come from one shared hook, so a component still follows light and dark mode.

**Why this priority**: the shared components are rendered on nearly every screen; converting them first removes the most duplicated literals, and the hook and lint rule they need are then ready for every screen.

**Independent Test**: `grep -rn "style={{" src/components` returns nothing (other than allow-listed runtime values), and the app looks the same in light and dark on a screen that uses each component.

**Acceptance Scenarios**:

1. **Given** a component with a fixed style (padding, gap, flex), **When** it is converted, **Then** that style is a `styles.*` entry and renders pixel-identically.
2. **Given** a component whose style uses a theme colour, **When** the app switches between light and dark, **Then** the colour follows the theme exactly as before.
3. **Given** a component whose value is computed from data (an image's aspect ratio, a measured width), **When** it is converted, **Then** the static keys are in `styles.*` and only that one computed key stays inline, with a one-line reason.

---

### User Story 2 - Onboarding and profiling screens (Priority: P2)

The signed-out, applicant and profiling route groups (`(public)`, `(applicant)`, `(profiling)`) use `StyleSheet.create`, with no visual change to the layout fixed in the last commits (uniform `FormScreen` padding, centred sign-in).

**Independent Test**: no `style={{` literal remains under those groups; the Welcome, Register, Waiting and Profiling screens look unchanged in both themes.

**Acceptance Scenarios**:

1. **Given** the Register form, **When** converted, **Then** field spacing, the birthday row and the chip groups are unchanged.
2. **Given** the Profiling review screen, **When** converted, **Then** the per-answer blocks keep their 4-point gap.

---

### User Story 3 - Member screens (Priority: P3)

Threads, Marketplace, Events and Profile screens (the `(member)` group) use `StyleSheet.create`.

**Independent Test**: no `style={{` literal remains under `src/app/(member)` (other than allow-listed runtime values); each tab opens and looks unchanged.

**Acceptance Scenarios**:

1. **Given** a `FlashList`, **When** converted, **Then** `contentContainerStyle`, `ItemSeparatorComponent` and row styles come from `styles.*` and scrolling is unchanged.

---

### User Story 4 - Merchant and partner screens, and a guard that keeps it that way (Priority: P4)

The `(organisation)` group is converted, and a lint rule makes a new inline style object a lint error, so the conversion cannot quietly regress.

**Independent Test**: `npm run -w german-world-club lint` fails when a `style={{ … }}` is added and passes on the converted tree.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every static style in `src/` MUST be declared in a `StyleSheet.create` call (imported from `react-native`) and referenced as `styles.<name>`. This covers `style`, `contentContainerStyle`, `columnWrapperStyle`, `labelStyle`-type props and any object literal inside a `style={[ … ]}` array.
- **FR-002**: Theme-dependent values (anything read from `useTheme()`) MUST come from a `StyleSheet.create` result built by one shared hook, `useThemedStyles(factory)` in `src/hooks/use-themed-styles.ts`, memoised on the theme. They MUST NOT be written as inline literals.
- **FR-003**: A value that exists only at runtime and comes from data (an `aspectRatio` from an image's width and height, a measured width, a safe-area inset) MAY stay inline as a single key inside a `[styles.x, { key: value }]` array, with an `eslint-disable-next-line` comment that gives the reason. These are the only allowed exceptions.
- **FR-004**: In a file that already imports `styles` from `@/components/ui`, the new local sheet MUST still be called `styles`, and the import MUST be renamed to `uiStyles`.
- **FR-005**: The conversion MUST NOT change what is rendered: same values, same order of precedence in style arrays (later entries still win), same behaviour in light and dark.
- **FR-006**: An ESLint rule (`no-restricted-syntax` on an object literal in a style-named JSX prop) MUST report inline style objects, and MUST be an error by the end of the feature.
- **FR-007**: No new dependency may be added.

### Key Entities

- **Style sheet**: a module-level constant `styles = StyleSheet.create({ … })` per file; static values only.
- **Themed styles hook**: `useThemedStyles(factory)`; `factory(theme)` returns the object that goes to `StyleSheet.create`, called once per theme change.

## Success Criteria *(mandatory)*

- **SC-001**: `grep -rn "style={{" src` and the same search for the other `…Style={{` props return only FR-003 exceptions (each one carrying its disable comment and reason).
- **SC-002**: `npx tsc --noEmit` and `npm run -w german-world-club lint` pass with no new warning compared with the baseline recorded in `research.md`.
- **SC-003**: Each converted screen is checked in light and dark and looks the same as before (manual, `quickstart.md`).

## Assumptions

- The Expo workspace has no unit-test runner, so verification is `tsc`, ESLint and the manual steps in `quickstart.md`.
- Extracting a shared style into `src/components/ui.tsx`'s exported `styles` is welcome when three or more files repeat the same literal, but is not required.
- Nothing in `ios/` or `android/` is touched.
