# UI contract: Register focus chain and partner heading

No HTTP contract changes. The partner API (`PATCH /profiling` → `partner`, `POST /profiling/submit`)
is as documented in `specs/013-onboarding-profiling/contracts/profiling-api.md`, Revision 6.

## C1 — Expo Register keyboard behaviour (`src/app/(public)/register.tsx`)

| Field | `returnKeyType` | `submitBehavior` | On submit | On change |
|---|---|---|---|---|
| Full name | `next` | `submit` | focus Email | — |
| Email | `next` | `submit` | focus Password | — |
| Password | `next` | `submit` | focus Mobile | — |
| Mobile (`MobileField`) | `next` | `submit` | focus Day | — |
| Day | `next` | `submit` | focus Month | 2 digits → focus Month |
| Month | `next` | `submit` | focus Year | 2 digits → focus Year |
| Year | `done` | `blurAndSubmit` | keyboard closes; **no** `next()` | — |

Invariants:
- Continue (`next()`) is reached only through its button. The keyboard never submits Register.
- Validation and draft behaviour are unchanged.

## C2 — Component props

```ts
// src/components/ui.tsx
type TextFieldProps = TextInputProps & { label: string; error?: string | null; hint?: string; ref?: Ref<TextInput> }
function FormScreen(props: { title?: ReactNode; subtitle?: string; children: ReactNode })

// src/components/mobile-field.tsx (all new props optional; verify-mobile.tsx passes none)
function MobileField(props: {
  value: string; onChange: (e164: string) => void; error?: string; hint?: string
  ref?: Ref<TextInput>; returnKeyType?: ReturnKeyTypeOptions; onSubmitEditing?: () => void
})
```

## C3 — Expo partner heading (`src/components/profiling/steps.tsx`)

- Partner steps are exactly `partner-languages | partner-qualification | partner-occupation |
  partner-income`, as listed by `profilingSteps`. `StepView` applies the partner heading
  only in the `languages`, `qualification`, `occupation` and `income` cases. The `settling*`
  cases use their own titles unwrapped.
- Heading = `copy.partnerTitle` split on `{question}`. The literal parts are rendered in
  `theme.accentText`, and the question is in the default title colour.
  - en: <span style="color:#856B1A">Your partner: </span>Which languages do you speak?
  - de: <span style="color:#856B1A">Ihre Partnerschaft: </span>Welche Sprachen sprechen Sie?
- Non-partner steps render no `accentText`.
- One text node, so the accessible name is the full filled string.
- The review screen (`summary.ts`) is unchanged and stays a plain string.

## C4 — Web console (`client/src/onboarding/profiling/steps.tsx`)

- The `settling*` cases drop the `title()` wrapper, the same as C3's first rule.
- Rendering, colour and behaviour are otherwise unchanged. The existing test
  `asks the partner the German questionnaire from Q2…` stays green unmodified.
