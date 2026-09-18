# Quickstart: Language Switch

**Feature**: 004-language-switch

How to run the switch and prove it works. Shapes and rules live in
[`data-model.md`](./data-model.md) and [`contracts/`](./contracts/); this is the run guide.

## Prerequisites

Everything feature 003 needs, unchanged — Node 22, PostgreSQL, and a seeded database:

```bash
npm install
npm run -w server migrate
npm run -w server seed:dev     # now also seeds the two landing-page metadata rows
npm run -w client build
```

## Run

```bash
npm run -w server dev      # API on :3000
npm run -w client dev      # Vite on :5173, proxying the API
```

Open the Vite origin. Both landing pages and the console are reachable from it.

---

## Scenario 1 — The English visitor (User Story 1)

1. Open `/`.
2. **Expect**: German, with `Deutsch · English` in the masthead and `Deutsch` marked as current.
3. Follow `English`.
4. **Expect**: `/en`, the same page in English, with `English` now marked and `Deutsch` a link
   back.
5. Follow `Deutsch`. **Expect**: back at `/`.

**Then prove it without a browser**, which is the half that matters for crawlers:

```bash
curl -s http://localhost:3000/en | grep -c "<script"          # expect 0
curl -s http://localhost:3000/en | grep -o '<html lang="[^"]*"'
curl -s http://localhost:3000/en | grep -o 'href="/"'          # the way back
```

**Expect**: no script tags, `lang="en"`, and the link home present in the raw HTML.

**Verifies**: FR-007, FR-008, FR-010.

## Scenario 2 — Crawl posture (User Story 1)

1. Fetch both pages and read their metadata.
2. **Expect**: `/` declares an `en` alternate at `/en`; `/en` declares a `de` alternate at `/`.
   Both name the same set — reciprocity is the whole point, and a one-directional declaration is
   ignored, leaving the two competing as duplicates.
3. **Expect**: `x-default` on both resolves to `/`.
4. **Expect**: each page's canonical is **itself**. `/en` canonicalised onto `/` would delist the
   English page entirely — the most consequential thing to get wrong here.
5. Fetch `/sitemap.xml`.
6. **Expect**: both `/` and `/en` present. Note `/` was **absent before this feature** (research
   R8); closing that gap is part of the work.
7. Request `/en` with `Accept-Language: de`.

```bash
curl -s -H 'Accept-Language: de' http://localhost:3000/en | grep -o '<html lang="[^"]*"'
```

8. **Expect**: `lang="en"`. The URL decides, never the header — otherwise two URLs serve the same
   content and compete.

**Verifies**: FR-009, FR-011, FR-012, FR-013.

## Scenario 3 — Switching the console (User Story 2)

1. Open `/konsole/anmelden`. Sign in as `seo@test.invalid` (password `konsole-entwicklung`).
2. Use the language control in the header.
3. **Expect**: every visible string changes — header, sidebar, buttons, the empty state — **with no
   page reload**, and any half-typed input still there.
4. Reload. **Expect**: still English.
5. Navigate between screens, sign out, sign in again. **Expect**: still English.
6. Check the document: `document.documentElement.lang` is `en`.

**Verifies**: FR-015, FR-016, FR-017, FR-020.

## Scenario 4 — Formatting, not just translation (User Story 2)

1. In English, find a date and a money amount.
2. **Expect**: `01/10/2026` and `€1,240.50`.
3. Switch to German.
4. **Expect**: `01.10.2026` and `1.240,50 €`.

Translating the labels while leaving German number formatting is the half-done version of this
feature, which is why FR-006 names it separately.

**Verifies**: FR-006.

## Scenario 5 — First visit, no stored choice (User Story 2)

1. Clear site data. Set the browser's preferred language to English. Open the console.
2. **Expect**: English, without choosing — the one moment the control is hardest to find.
3. Clear site data again. Set the browser to French. Open the console.
4. **Expect**: German. French is not offered, so the default applies.
5. Clear site data. Browser English. Open the console and **explicitly choose German**. Reload.
6. **Expect**: German. An explicit choice outranks the browser, or the switch appears not to work.

**Verifies**: FR-018.

## Scenario 6 — Storage unavailable (edge case)

1. Open the console in a private window with site data blocked.
2. **Expect**: it renders and is usable. The switch works for the session; it simply does not
   survive a reload.

A language preference is a per-browser convenience, not state anything depends on — so it must
degrade, never break.

**Verifies**: FR-021.

## Scenario 7 — Reachable by everyone (User Story 3)

1. On each landing page, tab to the language control.
2. **Expect**: reachable, visibly focused, operable by keyboard alone.
3. With a screen reader: **expect** the current language announced, not merely shown.
4. **Expect**: each option names its language in that language — "Deutsch", "English". Someone who
   cannot read the current language needs to recognise the target.
5. **Expect**: no flag icons. A flag names a country, not a language.
6. Repeat in the console.

**Verifies**: FR-004, FR-005, SC-006.

## Scenario 8 — The server did not change (SC-010)

The most useful negative check in this feature, because "just localise the API too" is the obvious
next step and it is not one this feature takes.

1. Capture a set of API responses before and after the change — sign-in refusals, a capability
   snapshot, a problem body.
2. **Expect**: byte-identical. `detail` is still English; the console translates by `type`.

```bash
curl -s -X POST http://localhost:3000/auth/sign-in \
  -H 'content-type: application/json' -H 'accept-language: en' \
  -d '{"email":"nobody@test.invalid","password":"irrelevant-but-long"}'
```

3. **Expect**: the same body with or without the header. No route reads `Accept-Language`.

**Verifies**: FR-022, SC-010.

---

## Automated gates

```bash
npm run -w client test:i18n     # SC-002: catalogue key parity
npm run -w client test          # component, catalogue, landing, a11y
npm run -w server test          # hreflang, sitemap, crawl posture
npm run -w server verify:seo    # both pages, reciprocal alternates
```

| Gate | Criterion | The counter-assertion it must carry |
|---|---|---|
| Key parity | SC-002 | a key added to one catalogue only **fails the build**, in both directions |
| No hard-coded strings | SC-003 | a German literal planted in a component is caught |
| No-JavaScript rendering | SC-001 | content present in the raw HTML of **both** pages, not only the German one |
| hreflang reciprocity | SC-004 | a one-directional declaration fails; `x-default` resolves to `/` |
| Accessibility | SC-005 | zero violations in **both** languages, not only the default |
| Persistence | SC-007 | the choice survives a reload **and** the console renders when storage throws |
| Negotiation | SC-008 | English browser → English, French browser → German |
| Server unchanged | SC-010 | a response body that *did* change fails it |

A test that only checks the German path would pass against a console with no English at all. Each
gate above is paired for that reason — the same convention the rest of the repository follows.
