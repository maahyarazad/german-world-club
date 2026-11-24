# Research: inline styles in the Expo app

## R1 Baseline (2026-11-24)

Counts at the start (run from `expo-client/german-world-club`):

- `grep -rn "style={{" src | wc -l` → **201** lines in **47** files (of 88 `.tsx` files).
- `grep -rn "Style={{" src | grep -v " style={{"` → at least 4 further props (`contentContainerStyle={{ … }}`).
- `style={[ … ]}` arrays that embed an object literal: **24**.
- Files that already use `StyleSheet.create`: 7 (`(public)/index.tsx`, `themed-text`, `notification-prompt`, `media-carousel`, `post-card`, `country-picker`, `ui`).
- Files importing `styles` from `@/components/ui`: 15 (the name clash in FR-004).
- Roughly 55 of the 201 lines read `theme.*`, so about a quarter need the themed sheet.

Largest files: `components/club-offers.tsx` 12, `(public)/register.tsx` 11, `(member)/marketplace/new.tsx` 10, `(member)/threads/[id].tsx` 8, `(member)/marketplace/index.tsx` 8.

`tsc --noEmit`: clean (exit 0).

`expo lint` (whole project, `npx eslint .`), 2026-11-24 before any change: **19 problems, 15 errors and 4 warnings**, all pre-existing. This feature must not add to them; line numbers will move, so compare by file and rule.

```text
.expo/types/router.d.ts:1 warning -
src/app/(applicant)/verify-email.tsx:52 warning react-hooks/exhaustive-deps
src/app/(member)/events/[id].tsx:44 error react-hooks/set-state-in-effect
src/app/(member)/profile/devices.tsx:41 error react-hooks/set-state-in-effect
src/app/(profiling)/index.tsx:2 warning @typescript-eslint/no-unused-vars
src/app/(profiling)/index.tsx:57 error react-hooks/set-state-in-effect
src/app/(profiling)/index.tsx:59 error react-hooks/preserve-manual-memoization
src/components/handle-form.tsx:27 error react-hooks/set-state-in-effect
src/components/spinner.tsx:41 error react-hooks/refs
src/components/spinner.tsx:41 error react-hooks/refs
src/components/spinner.tsx:55 error react-hooks/refs
src/components/spinner.tsx:55 error react-hooks/refs
src/hooks/use-action.ts:21 error react-hooks/refs
src/hooks/use-color-scheme.web.ts:11 error react-hooks/set-state-in-effect
src/hooks/use-grace.ts:13 error react-hooks/set-state-in-effect
src/hooks/use-paged.ts:24 warning no-unused-expressions
src/hooks/use-paged.ts:39 error react-hooks/use-memo
src/notifications/notification-router.tsx:31 error react-hooks/refs
src/notifications/registration.ts:82 error react-hooks/refs
```

## R2 Why a hook rather than inline colour literals

`StyleSheet.create` is evaluated once at module load, so it cannot see the theme. Reading `useColorScheme()` at module scope would freeze the scheme at start-up. Building the sheet inside a hook, memoised on the theme object, keeps `StyleSheet.create` for every style while still reacting to the scheme.

## R3 Why `no-restricted-syntax`

`eslint-plugin-react-native`'s `no-inline-styles` would be the usual choice, but it adds a dependency (FR-007) and is not part of `eslint-config-expo`. A selector on `JSXAttribute[name.name=/[sS]tyle$/] > JSXExpressionContainer > ObjectExpression` does the same job with what is already installed, and its message can say what to do instead.

## R4 Result (2026-11-24)

- `grep -rnE "[sS]tyle=\{\{" src` → **0**. The one inline object left is `{ transform: [{ rotate }] }` in `components/spinner.tsx`: `rotate` is an `Animated` interpolation, a runtime object that cannot live in a `StyleSheet`; it carries an `eslint-disable-next-line` with that reason.
- The lint rule is an `error`; adding `style={{ flex: 1 }}` or `style={[{ flex: 1 }]}` to a file fails lint.
- `tsc --noEmit`: clean. `expo lint`: **18 problems (15 errors, 3 warnings)** against the baseline's 19 (15 errors, 4 warnings): the same 15 errors, one unused-import warning fewer. Nothing new.
- `npx expo export --platform ios` builds the bundle.
- 235 rule hits at the start; a codemod (TypeScript compiler API, run once from the scratchpad, not added to the repo) converted 222 literals mechanically (164 static, 58 theme-dependent), 16 mixed literals were split, and the rest were done by hand: `Button`, `TextField`, `Message`, `Chip`, `Stepper` and `Card` in `ui.tsx`; `ThemedText` / `ThemedView` (one colour style per theme token); `Avatar`, `Spinner`, `MediaCarousel` and `UploadProgress` (a sheet per size or progress); `WideImage` (new, in `media-carousel.tsx`) for the three per-image aspect ratios; and conditional colours as two themed styles picked by a ternary.
- Beyond the lint rule: a `useMemo`'d style array in `TextField`, `Pressable` function styles in `Card`, the style `const`s in `QuoteEmbed` and the profiling steps, a conditional pair in `ScreenLoader` and the `labelStyle` options of the member tabs were also inline objects; they are converted too.
- The manual light/dark check (quickstart.md step 4) has not been done: no device or simulator was available in this session.
