# Implementation Plan: Expo app styles in `StyleSheet.create`

**Branch**: `035-merchant-store-offers` | **Spec**: [spec.md](./spec.md)

## Summary

Convert every inline style object in `expo-client/german-world-club/src` to `StyleSheet.create`. Static values go into a per-file `styles` sheet. Theme colours go through one shared hook so light and dark keep working. A lint rule, introduced as a warning at the start and raised to an error at the end, makes the migration measurable and keeps it from regressing.

## Technical Context

**Language/Version**: TypeScript ~6.0, React 19.2, React Native 0.86, Expo SDK 57, React Compiler on (see `eslint-config-expo`).
**Dependencies**: none added. `StyleSheet` from `react-native`; ESLint's built-in `no-restricted-syntax`.
**Testing**: no runner in this workspace; `tsc --noEmit`, `expo lint`, grep counts, manual light/dark check.
**Constraints**: zero visual change; `@/components/ui` already exports a `styles` object that 15 files import by that name.

## Approach

1. **Hook**: `src/hooks/use-themed-styles.ts` — `useThemedStyles(factory)` returns `useMemo(() => StyleSheet.create(factory(theme)), [theme])`. The `factory` is a module-level function, so the compiler and `useMemo` agree it is stable.
2. **Guard**: in `eslint.config.js` add `no-restricted-syntax` selectors for an `ObjectExpression` directly in a JSX attribute whose name ends in `style`/`Style`, and for an `ObjectExpression` inside an `ArrayExpression` in such an attribute. Start at `warn` (so the tree stays green mid-migration) and flip to `error` in the last phase.
3. **Conversion rule for each file**:
   - Pull every literal with only constant values into `const styles = StyleSheet.create({ … })` at the bottom of the file (existing files extend their current sheet).
   - A literal that reads `theme.*` moves into `useThemedStyles` in that component: `const styles = useThemedStyles(makeStyles)` with `const makeStyles = (theme: Theme) => ({ … })` declared at module scope.
   - A literal mixing both is split: constant keys into the sheet, colours into the themed sheet, applied as `[styles.a, themed.b]`.
   - Runtime-data keys (FR-003) stay as the one inline key with a disable comment.
   - Keep precedence: where a literal came after a style (override), keep that order in the array.
   - Name clash with `@/components/ui`'s `styles`: import it as `uiStyles`.
4. **Order**: shared components → onboarding/profiling → member → organisation → raise the rule to an error.

## Project Structure

```text
specs/036-expo-stylesheet/        spec.md, plan.md, research.md, quickstart.md, tasks.md
expo-client/german-world-club/
├── eslint.config.js              + no-restricted-syntax (warn → error)
└── src/
    ├── hooks/use-themed-styles.ts   NEW
    ├── components/**                US1
    └── app/(public|applicant|profiling)/**   US2
        app/(member)/**                      US3
        app/(organisation)/**                US4
```

## Risks

- A converted array that reorders entries changes which value wins: mitigated by FR-005 and by converting each literal in place.
- `StyleSheet.create` at module level cannot read the theme: this is what the hook is for; do not read `useColorScheme` at module scope.
- `FlashList`'s `ItemSeparatorComponent={() => <View style={{ height: … }} />}` creates a new component each render today; the conversion should move it to a named component or to a stable function with `styles.separator`.
