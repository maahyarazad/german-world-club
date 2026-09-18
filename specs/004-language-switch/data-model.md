# Phase 1 Data Model: Language Switch

**Feature**: 004-language-switch | **Date**: 2026-09-17

Almost nothing here is a database entity. The language choice lives in the browser, the catalogues
live in the repository, and the only persisted rows are two `seo_metadata` records that should have
existed already (research R8).

---

## 1. Persisted

### `seo_metadata` — two new rows, no schema change

The table already carries everything needed: `language NOT NULL DEFAULT 'de'` and
`translation_group_id` (`server/migrations/004_seo_metadata.sql:17-20`). This feature adds rows,
not columns.

| Field | German landing | English landing |
|---|---|---|
| `record_type` | `page` | `page` |
| `slug` | `home` | `en` |
| `language` | `de` | `en` |
| `translation_group_id` | shared uuid | *same* uuid |
| `title` | "German World Club — Ein globales Vertrauensnetz" | "German World Club — A Global Network of Trust" |
| `description` | current German meta description | its English translation |
| `indexable` | `true` | `true` |
| `published` | `true` | `true` |

- **`slug: 'home'` is load-bearing.** `pathFor` maps it to `/`, which is why the German page is the
  site root rather than `/home` (research R2).
- **The shared `translation_group_id` is what makes hreflang reciprocal.** Neither row names the
  other; `build-page-meta.js` derives the pair from the group, so a one-directional declaration —
  which search engines ignore, leaving both pages competing as duplicates — is not expressible.
- **`x-default` follows from `language`**, resolving to the `de` member. No extra column.

**Consequence**: both pages enter the sitemap, which closes the pre-existing gap where `/` was
absent from it entirely.

### Nothing else

No `locale` column on `members` or `admin_users`. No preference endpoint. No migration. The choice
is per-browser by decision (FR-023), and the seam where a stored preference would later attach is
`resolveLocale()` in §3 — one function, not a schema.

---

## 2. In the repository

### Message catalogue

One module per locale, both with **identical key sets**, enforced at build time.

```
client/src/i18n/
├── de.js        # exists — 163 lines, flat, no interpolation
├── en.js        # new — same shape, same keys
└── index.js     # new — catalogue selection and the active-locale hook
```

| Entity | Shape | Rule |
|---|---|---|
| **Locale** | `'de' \| 'en'` | German is the default and the `x-default` target |
| **Catalogue** | nested plain object, string leaves | Key sets MUST be identical across locales (FR-002) |
| **Key** | dotted path, e.g. `signIn.outcomes.passwordResetRequiredTitle` | Present in every catalogue or the build fails |

**Key parity is the invariant that matters.** It is checked by a recursive comparison over the two
objects, reported as the symmetric difference, and it fails the build — because the alternative is
a member reading a blank space or a raw key, and a missing translation is otherwise invisible until
someone switches language on the one screen that has it.

**What the catalogue deliberately does not have**: interpolation, plural categories,
gender/context forms, lazy namespaces. None is needed for 163 strings in two languages, and adding
the machinery for them is the framework research R3 declined.

**Keys that are not translated** — the same in both catalogues, because the design document fixes
them: `Ask GWC`, `Club Merchant`, `Corporate Club Partner`, `GWC CONNECT / MEMBER / PREMIUM /
EXECUTIVE / PRIVATE CIRCLE`, and the membership amounts.

### Landing page copy

Not a catalogue. `client/index.html` and `client/en.html` are two static documents, each carrying
its own copy inline, because the whole point is that they need no JavaScript to render
(research R1). The translation relationship lives in the `seo_metadata` pair above, not in a
shared string table.

**The duplication is real and deliberate**, and it is the same trade the design tokens already
make: `index.html` repeats the palette inline and `check-tokens.mjs` proves it has not drifted. The
equivalent guard here is structural rather than textual — see `contracts/landing-pages.md`.

---

## 3. In the browser

| Entity | Shape | Lifetime |
|---|---|---|
| `storedLocale` | `'de' \| 'en'`, in `localStorage` under one key | Until cleared; survives reloads |
| `activeLocale` | the resolved locale, in React context | Per page load |
| `catalogue` | the selected catalogue object | Derived from `activeLocale` |
| `formatters` | `Intl` instances, cached per locale | Per page load |

### `resolveLocale()` — the whole precedence rule, in one place

```
stored choice        →  wins if present and still offered
browser preference   →  used when it resolves to an offered locale
'de'                 →  otherwise
```

- **An explicit choice outranks the browser.** Otherwise the switch would appear not to work on the
  next visit.
- **The browser is consulted only on a first visit**, which is the one moment the control is
  hardest to find (FR-018).
- **A stored value that is no longer offered falls back to German** rather than rendering empty
  strings — the edge case named in the spec.
- **Every read and write is wrapped in `try`/`catch`.** Private browsing and blocked site data both
  make `localStorage` throw, and the console must still render (FR-021).

This function is also the seam a per-account preference would attach to, if FR-023 is ever
revisited: one more branch above `stored`, and nothing else in the console changes.

### Formatting

`client/src/lib/format.js` currently hard-codes `const LOCALE = 'de-DE'` and builds every formatter
at module scope. It becomes locale-parameterised, with formatters cached per locale.

| Locale | BCP 47 | Date | Money |
|---|---|---|---|
| `de` | `de-DE` | `01.10.2026` | `1.240,50 €` |
| `en` | `en-GB` | `01/10/2026` | `€1,240.50` |

`en-GB` rather than `en-US` — closer to German conventions and to the European audience the design
document describes (research R10, unresolved #3).

The collator moves with the locale too: sorting German text with an English collator puts "Ärztin"
after "Zürich" instead of beside "Arzt".

---

## 4. State transitions

```
first visit ──resolveLocale()──► de or en
     │
active ──user selects other──► re-render in place, persist choice
     │                          (no reload; unsaved input preserved — FR-016)
     │
landing page ──follows link──► the other URL, full page load
```

The two surfaces do **not** share state. The landing page has no JavaScript and so cannot read
`localStorage`; following its link is an ordinary navigation to a different document.

**A consequence worth stating**: a visitor who reads the English landing page and then signs in
gets the console in whatever `resolveLocale()` decides — their browser preference, not the page
they came from. Carrying it across would require the landing page to write storage, which needs
JavaScript, which is the one thing that page must not have. The console's own negotiation gets the
common case right anyway: a browser set to English sees both surfaces in English.

---

## 5. Deliberately absent

- **No account-level locale.** FR-023.
- **No server-side negotiation.** The URL decides for public pages (FR-013); the browser decides
  for the console. No route reads `Accept-Language`.
- **No translated `detail`, email, SMS or push copy.** FR-022, research R6.
- **No third locale.** The shape does not prevent one, but nothing is designed for it.
- **No translation workflow or service.** Both catalogues are maintained in the repository.
