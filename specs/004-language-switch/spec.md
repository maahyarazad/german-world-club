# Feature Specification: Language Switch (Deutsch / English)

**Feature Branch**: `004-language-switch`

**Created**: 2026-09-17

**Status**: Draft

**Input**: User description: "add a switch to web-application to select the language (En/De)"

## Context

The web application is German throughout. That was a decision, not an oversight: feature 003's
research R10 recorded *"German only… No i18n framework. A framework for one language is cost
without benefit"*, and FR-014 stated the interface language MUST be German. This feature reverses
that decision for the interface, and the earlier one was made in a way that keeps the reversal
cheap — R10 also required strings to live outside components, "which is what makes adding one later
cheap".

The platform is already bilingual below the interface, and this feature inherits that model rather
than inventing one:

| Already in place | Where |
|---|---|
| `language` on every content record, `NOT NULL DEFAULT 'de'` | `server/migrations/004_seo_metadata.sql` |
| `translation_group_id`, so hreflang alternates are reciprocal by construction | same |
| `x-default` points at the German version — German is the default (§10.7) | `server/src/seo/build-page-meta.js` |
| One URL per language, not one URL that switches | `about`/`about-us`, `impressum`/`imprint`, `datenschutz`/`privacy` |
| Problem text translated by the client, keyed on `type` | `client/src/lib/problems.js` |

Two halves, with different constraints:

- **The public landing page** is static HTML with inline CSS and **no JavaScript at all**, because
  the constitution requires public pages to deliver meaningful content in the initial response
  without executing any. A language control there cannot be a toggle; it is a link to a second
  page, which is also what the slug-per-language precedent above already does.
- **The console** is gated, never indexed and client-rendered, so it can hold the choice in the
  browser and re-render.

**Out of scope by decision**: text the server emits. Problem `detail` stays English and the console
keeps translating by `type`; transactional email, OTP SMS and push campaign copy are unchanged.
Push titles and bodies are staff-authored content rather than interface strings, so translating
them is a content problem, not a switch.

**Out of scope**: a per-account language preference. The choice lives in the browser. A seam is
left where a stored preference would attach, but no column, endpoint or migration is added.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An English-speaking visitor reads the landing page (Priority: P1)

Someone arrives at the public site and does not read German. They find an obvious control in the
masthead, follow it, and get the same page in English — same content, same structure, same sign-in
route. Search engines are told the two are translations of each other rather than duplicates.

**Why this priority**: It is the surface strangers reach first, and the only one where getting it
wrong costs indexing. It is also independently valuable: it ships without touching the console.

**Independent Test**: Fetch `/` and `/en` **with JavaScript disabled**, confirm both carry their
full content, that each names the other as an alternate, and that the switch is a working link in
both directions.

**Acceptance Scenarios**:

1. **Given** a visitor on `/`, **When** they use the language control, **Then** they reach `/en`
   and see the same page in English.
2. **Given** a visitor on `/en`, **When** they use the language control, **Then** they return to
   `/`.
3. **Given** a crawler that executes no JavaScript, **When** it fetches either page, **Then** the
   whole page including the language control is present in the initial response.
4. **Given** either page, **When** its metadata is read, **Then** it declares the other as an
   `hreflang` alternate, the declaration is reciprocal, and `x-default` points at the German page.
5. **Given** the English page, **When** its language is read, **Then** `<html lang="en">` and
   `og:locale` say so.

---

### User Story 2 - A staff member switches the console to English (Priority: P1)

A staff member signs in and switches the console to English. Every screen they can reach — sign-in,
password reset, the shell, the sidebar, refusals — is in English. The choice survives a reload and
a navigation.

**Why this priority**: It is the half the request is most likely about, and it is what makes the
console usable for staff who do not read German.

**Independent Test**: Switch the language, reload, navigate between screens, and sign out and in
again; the interface stays in the chosen language throughout.

**Acceptance Scenarios**:

1. **Given** the console in German, **When** the staff member selects English, **Then** every
   visible string changes without a page reload.
2. **Given** English selected, **When** the page is reloaded, **Then** it comes back in English.
3. **Given** a refusal from the server, **When** it is rendered, **Then** it appears in the chosen
   language — the console translates by problem `type`, so this needs no server change.
4. **Given** the chosen language, **When** a date, number or price is rendered, **Then** it is
   formatted for that locale, not only translated.
5. **Given** a first-time visitor whose browser prefers English, **When** they open the console,
   **Then** it opens in English without them choosing.
6. **Given** a first-time visitor with no usable preference, **When** they open the console,
   **Then** it opens in German.

---

### User Story 3 - The switch is reachable and usable by everyone (Priority: P2)

The control is operable by keyboard and screen reader, states which language is currently active
rather than only showing it, and does not depend on colour or a flag icon to be understood.

**Why this priority**: A language control that only a sighted mouse user can find is a language
control that the people most likely to need it cannot use.

**Independent Test**: Reach and operate the control by keyboard alone on both surfaces, and confirm
the current language is announced.

**Acceptance Scenarios**:

1. **Given** keyboard-only navigation, **When** the user tabs to the control, **Then** it is
   reachable, visibly focused and operable.
2. **Given** a screen reader, **When** the control is reached, **Then** the current language and
   the target language are both announced.
3. **Given** the control, **When** it is inspected, **Then** each option names its language in that
   language ("Deutsch", "English"), which is what someone who cannot read the current one needs.

---

### Edge Cases

- A stored preference holds a language the application no longer offers. It must fall back to
  German rather than render empty strings.
- Browser storage is unavailable or throws — private browsing, blocked site data. The console must
  still render, in the negotiated or default language.
- A translation key exists in one language and not the other. This must fail the build, not render
  a blank or a raw key to a member.
- A deep link into the console is opened in a fresh browser with no stored choice.
- The English landing page is requested before it exists as a build artefact.
- A crawler requests `/en` with `Accept-Language: de`. The URL decides, not the header — otherwise
  two URLs would serve the same content and compete.

## Requirements *(mandatory)*

### Functional Requirements

#### Both surfaces

- **FR-001**: The application MUST offer exactly two languages, German and English, with German as
  the default.
- **FR-002**: Every interface string MUST exist in both languages. A key present in one and missing
  from the other MUST fail the build.
- **FR-003**: Language MUST be selectable without an account, on both surfaces.
- **FR-004**: The control MUST name each language in that language, and MUST NOT rely on a flag —
  a flag names a country, not a language.
- **FR-005**: The current language MUST be conveyed to assistive technology, not only rendered.
- **FR-006**: Dates, numbers and currency MUST be formatted for the selected locale, not merely
  translated.

#### The public landing page

- **FR-007**: The English landing page MUST be a distinct URL, following the slug-per-language
  pattern the platform already uses for institutional pages.
- **FR-008**: Both pages MUST deliver their full content in the initial HTML response with **no
  JavaScript executed**, including the language control.
- **FR-009**: Each page MUST declare the other as an `hreflang` alternate, reciprocally, with
  `x-default` pointing at the German page (§10.7).
- **FR-010**: Each page MUST declare its own language in `<html lang>` and in its share metadata.
- **FR-011**: Each page MUST carry its own canonical URL. The two MUST NOT be canonicalised onto
  one another — they are translations, not duplicates.
- **FR-012**: Both pages MUST appear in the sitemap.
- **FR-013**: The language a visitor receives MUST be determined by the URL alone, never by
  `Accept-Language`. Two URLs that can serve the same content compete as duplicates.
- **FR-014**: Both pages MUST carry the same sign-in route into the console, and MUST offer no
  account-creation affordance (003 FR-002).

#### The console

- **FR-015**: The console MUST offer a language control reachable from every screen, including
  before sign-in.
- **FR-016**: Switching MUST re-render in place, without a page reload and without losing unsaved
  input.
- **FR-017**: The choice MUST persist across reloads and navigations for that browser.
- **FR-018**: On a first visit with no stored choice, the console MUST honour the browser's
  preferred language when it is one of the two offered, and use German otherwise.
- **FR-019**: The console MUST render server refusals in the selected language, by translating on
  problem `type` — the existing mechanism, needing no server change.
- **FR-020**: The document's `lang` attribute MUST follow the selected language.
- **FR-021**: If browser storage is unavailable, the console MUST still render and remain usable
  for the session.

#### Explicitly unchanged

- **FR-022**: No server-emitted text is translated by this feature — problem `detail`, transactional
  email, OTP SMS and push campaign copy are unchanged.
- **FR-023**: No language preference is stored against an account. No migration, no endpoint.
- **FR-024**: The gated console remains never-indexed in both languages; the language control adds
  no indexable surface.

### Key Entities

- **Locale**: One of `de` or `en`. German is the default and the `x-default` target.
- **Message catalogue**: The complete set of interface strings for one locale. Two catalogues exist
  and must have identical key sets.
- **Language preference**: The visitor's chosen locale, held in that browser only. Absent on a
  first visit, when the browser's own preference is consulted instead.
- **Translation pair**: The German and English landing pages, each naming the other as an alternate
  — the same relationship `translation_group_id` already expresses for content records.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Both landing pages deliver their full content with JavaScript disabled; an automated
  check fetches each and asserts the content and the language control are present in the raw HTML.
- **SC-002**: An automated check proves the two catalogues have identical key sets, and fails the
  build on a key present in only one.
- **SC-003**: An automated check proves no interface string is hard-coded in a component on either
  surface.
- **SC-004**: `hreflang` is reciprocal between the two landing pages and `x-default` resolves to the
  German one, proven by an automated check.
- **SC-005**: Every console screen renders in both languages with zero WCAG 2.2 AA violations.
- **SC-006**: The language control is reachable and operable by keyboard alone on both surfaces.
- **SC-007**: A reload preserves the chosen language; an automated check proves it, and proves the
  console still renders when storage throws.
- **SC-008**: An automated check proves a browser preferring English gets English on a first visit,
  and one preferring neither gets German.
- **SC-009**: Both landing pages appear in the sitemap with correct language declarations.
- **SC-010**: An automated check proves no server response body changed as a result of this
  feature.

## Assumptions

- German remains the default and the `x-default` target, per §10.7. English is additive.
- Two languages, not a framework for N. The catalogue shape should not make a third expensive, but
  no third is designed for.
- The console may remain client-rendered and JavaScript-dependent; it is gated and never indexed.
  Only the landing pages carry the no-JavaScript obligation.
- The English landing copy is a translation of the German page, which is itself drawn from
  `German_World_Club_Digital_Plattform.docx`. Membership tier figures, the four Wertschleifen and
  the trust rules are the same facts in both languages — **the tier amounts are not re-denominated**.
- Product nouns that the design document leaves in English or German deliberately — "Ask GWC",
  "Club Merchant", "Corporate Club Partner", the tier names — stay as they are in both catalogues.
- No translation service or workflow is introduced; both catalogues are maintained in the
  repository alongside the code.
