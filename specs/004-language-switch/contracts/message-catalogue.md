# Contract: Message Catalogue

**Feature**: 004-language-switch

The agreement between the two locales, and between the catalogues and the components that read
them.

## Shape

```
client/src/i18n/
├── de.js      export const de = { … }   // exists
├── en.js      export const en = { … }   // new, identical key set
└── index.js   locale resolution, catalogue selection, the hook
```

A catalogue is a plain nested object with string leaves. No functions, no interpolation, no plural
categories — see research R3 for why none is needed for 163 strings in two languages.

## The one hard rule

**Both catalogues have exactly the same keys. A difference fails the build.**

This is the invariant the whole feature rests on, because a missing translation is otherwise
invisible: the key that only exists in German is fine on every screen until someone switches
language on the one screen that uses it, and then they get a blank space or a raw dotted path.

The check is a recursive walk over both objects reporting the symmetric difference, wired as
`npm run -w client test:i18n` and asserted in the suite. It reports **both directions** — a key only
in `en` is as much a defect as one only in `de`, and usually means a rename landed in one file.

It also fails on a **type mismatch at the same path**: a string in one catalogue and an object in
the other is a merge artefact, not a translation.

## What is not translated

These are the same string in both catalogues, because the design document fixes them:

| | |
|---|---|
| Product names | `Ask GWC`, `Club Merchant`, `Corporate Club Partner`, `World Pulse` |
| Membership tiers | `GWC CONNECT`, `GWC MEMBER`, `GWC PREMIUM`, `GWC EXECUTIVE`, `GWC PRIVATE CIRCLE` |
| Amounts | `€150–€300`, `€10.000+` and the rest — the same facts, **not re-denominated** |
| The brand | `German World Club`, `GWC` |

Repeating them in both files rather than splitting them into a third shared module is deliberate:
the parity check then covers them too, and a translator who mistakenly localises "Ask GWC" is
making a visible change to a file rather than an invisible one to a shared constant.

## Reading a string

Components read through a hook, never by importing a catalogue directly:

```jsx
const t = useTranslations()
<h1>{t.signIn.title}</h1>
```

Importing `de` directly would hard-code German into a component and silently survive every switch —
which is the defect this feature exists to remove. **SC-003 is a source scan** over
`client/src/{console,auth,components}` that fails on a direct catalogue import, and on a
non-trivial German or English string literal in JSX.

The hook returns the catalogue object rather than a lookup function, so a missing key is
`undefined` at the call site and shows up in tests, rather than being papered over by a
`t('some.key')` that falls back to echoing its argument.

## Locale resolution

```
resolveLocale():
  stored choice (localStorage)  →  if present and still offered
  navigator.language            →  if it resolves to an offered locale
  'de'                          →  otherwise
```

- An explicit choice outranks the browser, or the switch would appear not to work next visit.
- `navigator.language` is matched on its primary subtag, so `en-US`, `en-GB` and `en` all resolve
  to `en`.
- A stored value that is no longer offered falls back to German rather than rendering blanks.
- Every storage read and write is wrapped in `try`/`catch` — private browsing and blocked site data
  both throw, and the console must still render (FR-021).

## Formatting

`client/src/lib/format.js` stops hard-coding `de-DE` and takes the active locale. Formatters are
constructed once per locale and cached; `Intl` constructors are the expensive part and a table of
a few hundred rows would otherwise build one per cell.

| | `de` | `en` |
|---|---|---|
| BCP 47 | `de-DE` | `en-GB` |
| Date | `01.10.2026` | `01/10/2026` |
| Money | `1.240,50 €` | `€1,240.50` |
| Collation | Ä sorts with A | — |

Translating labels while leaving `1.240,50 €` in an English interface is the half-done version of
this feature, which is why FR-006 names formatting explicitly.

## The document's language

`<html lang>` follows the active locale in the console, updated when the switch is used. On the
landing pages it is fixed per document — `de` in `index.html`, `en` in `en.html` — because those
pages do not switch, they link.

## Adding a string

1. Add it to `de.js` **and** `en.js`. The parity check fails otherwise.
2. Read it through `useTranslations()`.
3. If it names a product, a tier or an amount, it is the same in both — see the table above.

## Adding a locale

Out of scope, and nothing here prevents it: a third catalogue, a third entry in the offered list,
and a BCP 47 mapping. The parity check generalises to N catalogues without modification. The
landing pages would not: each needs its own document and its own `seo_metadata` row.
