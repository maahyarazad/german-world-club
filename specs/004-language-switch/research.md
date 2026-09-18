# Phase 0 Research: Language Switch

**Feature**: 004-language-switch | **Date**: 2026-09-17

Every decision below was taken against the code as it stands on `003-web-console`. The recurring
finding is that this feature is smaller than it looks, because the platform was already built
bilingual below the interface — and the one place that is *not* true is recorded as R8.

---

## R1. The landing page switches by URL, not by toggle

**Decision**: The English landing page is a second URL. The control is a link.

Two independent constraints force this, and they agree:

1. **The constitution.** Public pages must deliver meaningful content in the initial response with
   no JavaScript executed. `client/index.html` has zero `<script>` tags and carries its styling
   inline, which `client/tests/landing.test.js` asserts. A JavaScript toggle would break that
   outright; a CSS-only toggle would ship both languages to every visitor and leave
   `<html lang>` lying about one of them.
2. **The existing pattern.** Institutional pages are already one-URL-per-language:
   `about`/`about-us`, `impressum`/`imprint`, `datenschutz`/`privacy`. There is no precedent here
   for a URL that serves two languages, and inventing one would put the new page at odds with
   every other public page on the origin.

**Rationale**: Principle III treats indexed URLs as an asset and requires exactly one canonical
form per page. Two languages at one URL cannot both be canonical, and content negotiation on `/`
would make the same URL serve different bodies to different visitors — which is what `hreflang`
exists to avoid.

**Alternatives considered**:

- *A `?lang=en` query parameter.* Rejected — `build-page-meta.js` already strips and canonicalises
  query strings, so the parameter would be redirected away before it reached anything.
- *Content negotiation on `Accept-Language`.* Rejected — one URL, two bodies, varying on a header
  that caches poorly and that a crawler does not send. FR-013 states the rule explicitly.
- *Client-side toggle with both languages in the markup.* Rejected — doubles the page weight for
  every visitor and cannot honestly set `<html lang>`.

---

## R2. `/en` is already a working path — no new routing concept

**Decision**: Serve the English landing page at `/en`, from a second Vite entry
(`client/en.html`) and a sibling route beside the existing `/`.

`pathFor` in `server/src/seo/build-page-meta.js:42` maps a record to its public path:

```js
return slug === 'home' || slug === '' ? '/' : `${prefix}/${slug}`
```

With `recordType: 'page'` the prefix is `''`, so `{ recordType: 'page', slug: 'en' }` resolves to
`/en` with no change to the function. The German landing page is the `home` slug, which is why it
resolves to `/`.

`/` is not served by `@fastify/static` — `server/src/public/routes.js:152` is an explicit route
that reads `client/dist/index.html` once at boot. The English page is the same shape: one more
route, one more file, one more Vite entry alongside `index.html` and `konsole.html`.

**Rationale**: The alternate-href machinery and the sitemap both compute paths through `pathFor`.
Choosing a slug it already handles means hreflang and the sitemap need no special case.

**Alternatives considered**: `/en/` as a directory prefix for a whole English site tree — rejected
as premature. Only the landing page is being translated; a prefix implies a parallel tree that does
not exist and would immediately disagree with `about-us`, which lives at the root.

---

## R3. Two catalogues, no framework, and a build gate on key parity

**Decision**: `client/src/i18n/de.js` gains a sibling `en.js` with an identical key set, selected
at runtime. No i18n library.

Feature 003's R10 chose "German only, no framework", and the reason it gave was not "one language
forever" — it was that a framework for one language is cost without benefit, *and* that keeping
strings out of components is what makes adding one cheap. That second half is now being cashed in:
`de.js` is already a flat keyed module with no interpolation, no pluralisation and no
context-dependent forms.

What a library would add — ICU message format, plural categories, lazy namespace loading,
translator tooling — is not needed by 163 strings across two languages maintained in this
repository by the people writing the code.

**The part that does need building** is the guarantee that the two stay in step. FR-002 requires a
key present in one and missing from the other to fail the build, because the alternative is a
member seeing a blank space or a raw key. That is a recursive key-set comparison, and it is the
single most valuable piece of tooling in this feature.

**Rationale**: The cost of a framework is permanent; the cost of a key-parity check is twenty
lines. If a third language or real pluralisation ever arrives, that is the moment to reconsider —
and the catalogue shape does not prevent it.

**Alternatives considered**: `i18next` / `react-intl` — rejected on the reasoning above.
`Intl.MessageFormat` — not yet available in the target runtimes, and unnecessary without plurals.

---

## R4. The console negotiates once, then remembers

**Decision**: On first visit, honour `navigator.language` when it resolves to one of the two
offered; otherwise German. Afterwards, the stored choice wins. Stored in `localStorage`.

**Rationale**: A staff member whose browser is set to English should not have to find a control
before they can read the page — that is the one moment the control is hardest to find. After they
have chosen, an explicit choice must outrank a browser default, or the switch would appear not to
work on the next visit.

**Storage**: `localStorage`, read and written inside `try`/`catch`. Private browsing and blocked
site data both make it throw, and FR-021 requires the console to render anyway. The value is a
per-browser convenience, not state anything depends on, which is exactly what browser storage is
appropriate for.

**Alternatives considered**:

- *A cookie.* Rejected — it would be sent on every API request, making it look like server input
  when nothing on the server reads it. It would also need a CSRF-adjacent conversation it does not
  deserve.
- *A per-account column.* Explicitly out of scope, and the user chose per-browser. A seam is left
  where a stored preference would attach, but no migration or endpoint is added.
- *Always negotiate, never store.* Rejected — the switch would not persist, which is FR-017.

---

## R5. Formatting is locale-driven, and currently is not

**Decision**: `client/src/lib/format.js` takes the active locale instead of hard-coding one.

It currently opens with `const LOCALE = 'de-DE'` and builds every `Intl` formatter against it at
module scope. That is correct for a German-only console and wrong the moment there is a switch:
FR-006 requires `01.10.2026` and `€1.240,50` to become `01/10/2026` and `€1,240.50`, not merely for
the labels around them to change.

The formatters are constructed once per locale and cached, as they are today — `Intl` constructors
are the expensive part, and a table of a few hundred rows would otherwise build one per cell.

**Consequence**: `compareText` and its collator are locale-dependent too. Sorting German text with
an English collator puts "Ärztin" after "Zürich" instead of with "Arzt".

---

## R6. Refusals need no server change

**Decision**: Translate problems in the console, keyed on `type`, as it already does.

`client/src/lib/problems.js` maps each `PROBLEMS.*` type to German copy. The server sends English
`detail` strings that the console never renders. So English is a second copy table against the same
keys — the mechanism is already right, and this is the strongest argument that the "clients branch
on `type`, never on `detail`" rule was worth enforcing.

**Rationale**: Localising `detail` server-side would duplicate work the client already does, add an
`Accept-Language` dependency to every route, and make the server's output vary by header — which
Principle VI's "the server shapes what leaves it" makes a deliberate decision rather than a default.

**Consequence for SC-010**: no server response body changes in this feature. That is checkable, and
it is worth checking, because "just localise the API too" is the obvious next step and it is not
one this feature takes.

---

## R7. Each landing page is canonical for itself

**Decision**: `/` and `/en` each declare their own canonical URL and name the other as an
`hreflang` alternate, with `x-default` resolving to `/`.

`build-page-meta.js:85-100` already generates reciprocal alternates from a translation set and
points `x-default` at the `DEFAULT_LOCALE` member. `server/tests/seo/hreflang.test.js` asserts
reciprocity, absolute hrefs and the `x-default` target. The fixtures in
`server/tests/helpers/fixtures.js` already carry a `de`/`en` pair sharing `translationGroupId:
'tg-about'`, so the machinery is exercised rather than theoretical.

**The trap**: canonicalising `/en` onto `/` would delist the English page entirely. They are
translations, not duplicates — a distinction `hreflang` exists to express and `rel=canonical`
destroys. FR-011 states it because it is the single easiest thing to get wrong here.

---

## R8. The landing page is not in the sitemap, and that is a pre-existing gap

**Decision**: Give both landing pages `seo_metadata` rows sharing a `translation_group_id`, seeded
alongside the existing institutional pages.

`server/src/seo/sitemap.js:60` builds its entries from a `SELECT` over the metadata table. The
landing page has no row: `server/src/public/routes.js` holds a hard-coded `LANDING_RECORD` used
only as a fallback when no client build exists. So **`/` is absent from the sitemap today** — not a
regression this feature introduces, but a gap it has to close anyway to satisfy FR-012, and one
worth naming because closing it fixes the German page too.

Giving both pages real rows also makes the hreflang pair fall out of `translation_group_id`
automatically, rather than needing the landing route to assemble alternates by hand.

**Also noted, not fixed here**: `LANDING_RECORD`'s copy still describes "Ein privates Netzwerk
deutschsprachiger Expatriates in den Vereinigten Arabischen Emiraten" — wording from before the
landing page was rebuilt in feature 003. It is reachable only when there is no client build, but it
is stale, and the row created above is the natural place for the current text.

---

## R9. Where the control goes

**Decision**: Landing page — in the masthead beside the sign-in button, as two links with the
current one marked. Console — in the header beside sign-out, as a two-option control.

Both name the languages in their own language ("Deutsch", "English"), per FR-004. No flags: a flag
names a country, and there is no flag that means "English" to a reader in Dubai, Zürich and
Singapore at once — which is precisely the audience the design document describes.

**Accessibility**: the current language is conveyed with `aria-current` on the landing page's links
and `aria-pressed` on the console's control, so it is announced rather than only shown. The gold
accent may mark the active option but never carries the meaning alone — the same rule `StatusPill`
already follows.

---

## R10. What does not change

Recorded because the temptation to widen this feature is the main risk to it:

| Untouched | Why |
|---|---|
| Problem `detail`, transactional email, OTP SMS | Out of scope by decision; R6 makes the console side sufficient |
| Push campaign title and body | Staff-authored content, not interface strings — translating them is a content workflow |
| Any account column, endpoint or migration | Per-browser by decision |
| Membership tier amounts | The same facts in both languages; not re-denominated |
| "Ask GWC", "Club Merchant", "Corporate Club Partner", tier names | Product nouns the design document fixes in one form |
| The console's never-indexed posture | Unchanged in both languages |

---

## Unresolved

| # | Question | Blocking? | Carried as |
|---|---|---|---|
| 1 | Who provides the English landing copy — translated here, or supplied by the club? | No — a faithful translation of the German page is the starting point and is easy to replace | Phase 1 |
| 2 | Should `about-us`, `imprint` and `privacy` be linked from the English landing page in place of their German twins? | No — both sets exist already; it is a link-target choice | Phase 1 |
| 3 | Does the club want `en-GB` or `en-US` number and date conventions? | No — `en-GB` assumed, closer to German conventions and to the European audience | R5 |
