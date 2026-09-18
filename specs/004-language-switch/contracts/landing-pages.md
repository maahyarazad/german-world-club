# Contract: The Two Landing Pages

**Feature**: 004-language-switch

`/` and `/en` are one page in two languages. This is what each owes the other, and what both owe a
crawler.

## The pair

| | German | English |
|---|---|---|
| URL | `/` | `/en` |
| File | `client/index.html` | `client/en.html` |
| Vite entry | `index` | `en` |
| Served by | route at `server/src/public/routes.js:152` | a sibling route beside it |
| `seo_metadata` slug | `home` | `en` |
| `<html lang>` | `de` | `en` |
| `og:locale` | `de_DE` | `en_GB` |
| `hreflang` | names `en`, and itself | names `de`, and itself |
| `x-default` | **points here** | points at `/` |

`slug: 'home'` is why the German page is the site root: `pathFor` maps it to `/`. `slug: 'en'`
resolves to `/en` through the same function with no change to it (research R2).

## Rules

### Each page is canonical for itself

`<link rel="canonical">` on `/en` points at `/en`. **Never at `/`.**

Canonicalising a translation onto its original delists the translation entirely — the crawler is
told "this is a duplicate, index the other one". `hreflang` exists to express exactly the
relationship that `rel=canonical` destroys. This is the single easiest thing to get wrong here,
which is why FR-011 states it and a test asserts it.

### The alternates are reciprocal, and derived

Neither page names the other by hand. Both `seo_metadata` rows share one `translation_group_id`,
and `build-page-meta.js:85-100` generates the alternate set from the group.

A one-directional `hreflang` is ignored by search engines, and the two pages then compete as
duplicates — suppressing both. Deriving the set from the group rather than writing it per page
makes the one-directional version inexpressible rather than merely discouraged. The existing
`server/tests/seo/hreflang.test.js` already asserts reciprocity, absolute hrefs and the
`x-default` target.

### The URL decides the language. Nothing else.

No `Accept-Language` negotiation, no cookie, no redirect from `/` to `/en`.

Two URLs that can serve the same body compete as duplicates, cache poorly, and answer a crawler
differently from a visitor. A visitor whose browser prefers English and who lands on `/` gets
German and a visible link — which is the correct outcome, because the alternative is a crawler
indexing whichever language it happened to be served.

The console negotiates; the public pages do not. They are different problems: one is gated and
never indexed, the other is the indexed surface.

### Both render with no JavaScript

Neither page has a `<script>` tag. Both carry their styling inline. The language control is a
plain `<a href>`.

This is the constitution's public-rendering rule, and it is why the switch is a link rather than a
toggle: link-preview bots and most non-Google crawlers execute nothing, and partner visibility is a
sold deliverable. `client/tests/landing.test.js` already asserts zero script tags for the German
page; the English page joins the same assertions.

### Both appear in the sitemap

Falls out of the `seo_metadata` rows — `sitemap.js` selects from that table. Closing a
**pre-existing gap**: `/` has no metadata row today and is therefore absent from the sitemap
entirely (research R8). This feature fixes the German page as a side effect of adding the English
one.

## The control

In the masthead of both pages, beside the sign-in button:

```
Deutsch · English          ← the current one marked, the other a link
```

- **Each language names itself in its own language.** Someone who cannot read the current language
  needs to recognise the target, and "Englisch" does not help an English speaker.
- **No flags.** A flag names a country. There is no flag meaning "English" to a reader in Dubai,
  Zürich and Singapore at once — which is the audience the design document describes.
- **`aria-current="true"`** on the active one, so the current language is announced and not only
  shown. The gold accent may mark it but never carries the meaning alone — the rule `StatusPill`
  already follows.
- **Keyboard-reachable with a visible focus ring**, like every other control on the page.

## What the two pages share, and what they must not

**Share**: structure, section order, the sign-in route, the palette, the logo, the absence of any
account-creation affordance (003 FR-002 applies to both).

**Must not share**: a string table. Each document carries its own copy inline, because that is what
lets them render without JavaScript. The duplication is the same trade the palette already makes —
`index.html` repeats the design tokens inline and `check-tokens.mjs` proves they have not drifted.

The equivalent guard here is **structural rather than textual**: a test asserts both pages have the
same section ids, the same heading count, the same set of `/konsole` links, and neither has a
script tag. Two pages that have drifted apart structurally are no longer translations of each
other, and that is checkable even though the words differ.

## Content

The English page is a faithful translation of the German one, which is itself drawn from
`German_World_Club_Digital_Plattform.docx`. The facts are identical in both:

- the four Wertschleifen / value loops,
- the five membership tiers **with the same amounts — not re-denominated**,
- the trust rules,
- the product nouns the design document fixes (`Ask GWC`, `Club Merchant`, tier names).

**Open**: whether the club supplies the English copy or accepts a translation made here. The
translation is the starting point and is cheap to replace — it is one file.

**Open**: whether the English page links to `about-us`, `imprint` and `privacy` in place of
`about`, `impressum` and `datenschutz`. Both sets already exist as institutional slugs; it is a
link-target choice, not new work.
