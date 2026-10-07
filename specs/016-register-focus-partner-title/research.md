# Research: Register focus chain and partner question marking

All Technical Context unknowns are resolved below. Each entry: Decision / Rationale /
Alternatives considered.

## R1 — Is the partner already kept off Q1?

**Decision**: Yes, on every layer. No behaviour change is needed. The plan removes the dead code
that still *looks* like partner Q1 and keeps the existing tests as the guard.

**Evidence** (commit `95e52ee`, "partner questionnaire starts at Q2", merged as `2bdfd48`):

- `packages/contracts/src/profiling.ts` — `profilingSteps` pushes exactly
  `partner-languages, partner-qualification, partner-occupation, partner-income` after Q6/kids.
  `ProfilingStepId` has no `partner-settling*` member, so a client cannot even name one.
- Same file: the PATCH `partner` object is `.strict()` with only the four Q2–Q5 keys, so a
  settling key is a 400.
- `server/migrations/039_partner_no_settling.sql` dropped the partner settling columns.
- Tests already asserting it: `packages/contracts/tests/profiling-steps.test.ts:83-88`,
  `server/tests/profiling/settling.test.ts:85-97`,
  `client/tests/onboarding/profiling.test.tsx:290-298` (web: partner starts at languages,
  never settling, never relationship).
- Both `StepView`s derive the partner step from the contracts list, so neither can render a
  partner Q1. **However**, both still wrap the four `settling*` cases' titles in `title()`, the
  partner wrapper. That code is unreachable for a partner today, but it reads as if a partner
  settling screen exists. The Expo doc comment also still says "Partner steps are the German
  Q1-Q5 again" (the web comment was corrected to "Q2–Q5 (never Q1, settling)").

**Alternatives considered**: Adding a client-side guard that refuses a `partner-settling` step.
Rejected because the type system already makes that step unnameable. A second check would be
the rule written twice, which Constitution I prohibits.

## R2 — Which gold, given the contrast rules

**Decision**: Add an Expo theme token `accentText`: **`#856B1A`** in light mode and
**`#E0BD4A`** in dark mode (the existing dark `accent`). The partner label uses `accentText`,
not `accent`.

**Rationale**: The app's `accent` `#C9A227` is **2.42:1** on white. That fails even the 3:1
large-text floor, and the 30 px title is borderline "large" anyway. `#856B1A` is the smallest
darkening of the same hue (same HLS hue and saturation, lower lightness) that clears 4.5:1:
**5.10:1** on `background` `#ffffff` and 4.60:1 on `backgroundElement`. Dark `accent` is
already **10.7:1** on `#0B0D10`. The web console made the same call for the same reason
(`client/src/styles/theme.css`: `--color-accent` "2.4:1 on white and MUST NOT carry text
there", with a separate darker `--color-accent-fg` for text). Keeping `accent` for non-text
uses and adding a text token mirrors that split.

**Alternatives considered**: Use `accent` as is, which is illegible in light mode. Darken
`accent` itself, which would change every existing non-text use of it. Reuse the web's
`#9A6106`, a different hue from the app's gold.

## R3 — Colouring only the `partnerTitle` part of a single title string

**Decision**: Keep the catalogue key `partnerTitle: 'Your partner: {question}'` /
`'Ihre Partnerschaft: {question}'` unchanged. Render it by splitting the template on
`{question}`: the literal text on either side goes in a nested `<Text>` styled `accentText`,
and the question is plain. `FormScreen`'s `title` (and `Frame`/`Choice`/`Multi`'s) widens from
`string` to `ReactNode`. `ThemedText` is an RN `<Text>`, and nested `<Text>` inherits size and
weight and overrides only colour.

**Rationale**: Splitting the template rather than hard-coding "prefix then question" respects
word order in any locale. No new catalogue key, so the key-parity check and the review
screen's `summary.ts` (which uses the same template as a plain string) are untouched. Nested
RN `<Text>` is one accessibility node, so a screen reader still reads "Your partner: Which
languages…" as one heading (FR-006).

**Alternatives considered**: A separate `partnerLabel` key rendered as an eyebrow above the
title, which adds keys to both catalogues and changes the layout beyond "colour". Passing a
`titleAccent` prop to `FormScreen`, which special-cases one screen in a primitive every form
uses.

## R4 — Focus chaining in React Native 0.86 / React 19

**Decision**: `useRef<TextInput>(null)` per focus target (Email, Password, Mobile, Day, Month,
Year). Each field gets `returnKeyType="next"`, `submitBehavior="submit"` and
`onSubmitEditing={() => nextRef.current?.focus()}`. Year gets `returnKeyType="done"` and
`submitBehavior="blurAndSubmit"` with no submit action. `TextField` accepts `ref` as a prop
(React 19 passes `ref` through `memo` as an ordinary prop) and hands it to `TextInput`.
`TextFieldProps` gains `ref?: Ref<TextInput>`, since `TextInputProps` does not declare it.
`MobileField` gains optional `ref`, `returnKeyType` and `onSubmitEditing`, passed to its inner
`TextField`. `verify-mobile.tsx` passes none and is unaffected.

**Rationale**: `submitBehavior="submit"` (it replaces the deprecated `blurOnSubmit={false}`)
keeps the keyboard up between fields, so it doesn't close and reopen at every step. Year does
not call `next()` on submit because gender, language and the age confirmation are chips still
to be answered below it (FR-002). Submitting there would only flash three validation errors.

**Alternatives considered**: `forwardRef`, which is unnecessary in React 19 and would be
the only use in the app. A focus-index array with one ref list, which is more indirection for
six fixed fields.

## R5 — iOS numeric keyboards have no return key

**Decision**: Day and Month advance on their own when they reach two digits (`maxLength`). Year
is last. For Mobile, the iOS phone pad has no return key and the number has no fixed length.
On iOS the applicant taps Day, which is recorded as a known limitation.

**Rationale**: Without auto-advance, "hits enter → next field" cannot happen from any of the
three date fields on iOS, which is the main platform. Two-digit completion is unambiguous.
Advancing from Mobile on a guessed length would interrupt numbers of other lengths.

**Alternatives considered**: An iOS `InputAccessoryView` with a "Next" bar. It works for every
numeric field but adds a platform-specific component the app does not use anywhere else, and
it is more than the request asks for. Revisit if the Mobile gap matters in testing.

## R6 — Scope on the web console

**Decision**: The web console gets the dead-code cleanup from R1 only (no `title()` on the
`settling*` cases). It gets no gold heading and no Enter-to-next-field change.

**Rationale**: "Check the web application as well for this" follows the partner-Q1 line, and
that check passes (R1). The gold title was asked for in the Expo `StepView`. On the web it
would hit the console's documented gold rule ("Gold nur als gezielter Marken- und
Aktionsakzent"; `--color-accent-fg` is reserved for labels on `--color-tint-gold`), which is a
design call to make deliberately, not a side effect. If wanted, it is a small follow-up:
`AuthCard`'s `title` is already `ReactNode`, and `--color-accent-fg` (5.14:1 on white) is the
legible token.
