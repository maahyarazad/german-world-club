# UI contract: loader components

No HTTP interface; this is the component contract both platforms follow, so a test on one side describes the other.

## Sizes (px, both platforms)
`xs` 14 · `sm` 20 · `md` 32 · `lg` 48. Ring width is 1/8 of the size, the arc is a quarter of the ring, one rotation per 750 ms (from `main-loader.html`).

## Web (`client/src/components/ui/`)
- `<Spinner size="md" label? className? />`: an `<svg role="img" aria-hidden>` plus nothing else; it carries no text of its own; `className` lets a caller set `text-*`; default colour `text-navy`; rotation via `animate-spin motion-reduce:animate-none`.
- `<PageLoader size="lg" label? delayMs=150 />`: a centred block, `role="status"` and `aria-live="polite"`, containing the spinner and a visually hidden `label` (default `t.console.loading`). Renders nothing until `delayMs` has passed (`useGrace`).
- `<Button loading? …>`: when `loading`, `disabled` is forced, `aria-busy="true"`, the label stays in the layout (hidden with `invisible`, so the width does not change) and an `xs` `Spinner` is centred over it in `currentColor`.
- `useAction(name, fn, { onError? }) → [run, pending]`: `run(...args)` returns immediately if `pending`; otherwise sets `pending`, awaits `fn`, and in `finally` clears it. A rejection is logged as `console.error(name, error instanceof ApiError ? error.problem : error)` and swallowed unless `onError` is given, which is called instead of the log.
- `useGrace(active, ms) → boolean`.

## App (`expo-client/german-world-club/src/`)
- `<Spinner size color? />` in `components/spinner.tsx`: faint ring + coloured arc, `Animated` rotation with `useNativeDriver`, `accessibilityElementsHidden`; colour defaults to `theme.tint`; static under reduced motion.
- `<ScreenLoader size="lg" label? />` in `components/screen-loader.tsx`: centred, `accessibilityRole="progressbar"` (+ `accessibilityLabel`, `accessibilityLiveRegion="polite"` on Android), grace-delayed.
- `Button` in `components/ui.tsx`: unchanged props; `loading` now draws `Spinner size="xs"` in `theme.onTint`/`theme.text` over the hidden label.
- `useAction`, `useGrace` in `hooks/`, same signatures as the web.

## Strings
- `t.console.loading` (web, exists), and the app's existing `loading: 'Loading…'` string at `expo-client/german-world-club/src/i18n/en.ts:13` (confirm its key group when implementing), each in German and English; no other new user-visible text.

## Behavioural guarantees (what the tests pin)
1. Nothing rotates under reduced motion.
2. A button never changes size while loading and never sends twice while loading.
3. A page loader does not appear before the grace period and disappears when the data or the failure arrives.
4. A failed request never leaves a loader on screen.
