# Phase 1 Data Model: Experts Circle Coming-Soon Experience

**Feature**: `001-coming-soon-revamp` | **Date**: 2026-09-11

This feature persists nothing. There is no database, no API, and no visitor data (FR-016). "Data model" here means the **client-side content and state shapes** that the page reads and renders — all of them build-time constants plus one derived runtime value.

---

## Entity: SiteConfig

The single source of truth for every configurable value on the page (FR-006). Lives at `src/config/site.js`, exported frozen.

| Field | Type | Required | Validation | Maps to |
|---|---|---|---|---|
| `brandName` | `string` | yes | non-empty, ≤ 60 chars | FR-001 |
| `parentOrg` | `string` | yes | non-empty | FR-001, FR-015 |
| `tagline` | `string` | yes | non-empty, ≤ 120 chars — must fit one line at 1280 px | FR-001 |
| `status` | `string` | yes | non-empty; explicit pre-launch wording | FR-003 |
| `launchDate` | `string` | yes | **ISO 8601 with explicit UTC offset** | FR-004, FR-006 |
| `description` | `string` | yes | 1–2 sentences; used for the meta description too | FR-002, FR-014 |
| `offerings` | `Offering[]` | yes | 3–4 items | FR-002 |
| `about` | `string[]` | yes | 1–3 paragraphs | FR-002 |
| `contactEmail` | `string` | yes | valid address; rendered as `mailto:` | FR-009 |
| `socials` | `SocialChannel[]` | yes | **may be empty** | FR-010 |

**Invariants**

- `launchDate` **must** carry an explicit offset (`2026-12-01T09:00:00+04:00`). A bare date parses as UTC and an offset-less datetime parses as local time — either would show a different countdown in Dubai than in Berlin (research R6).
- `socials: []` is a valid, expected state. The Contact section renders **no social block at all** when empty rather than emitting dead links (FR-010).
- The object is `Object.freeze`-d. Nothing mutates config at runtime.
- Every string is display copy. Placeholder values ship until the club supplies real ones; no field may contain invented contact details or invented URLs.

**Environment override**

`launchDate` may be overridden by `VITE_LAUNCH_DATE` at build time. If the variable is absent or unparseable, the module falls back to its literal default — the page must never render `Invalid Date`.

---

## Entity: Offering

One scannable value point in the "what's coming" section. Owned by `SiteConfig.offerings`.

| Field | Type | Required | Validation |
|---|---|---|---|
| `id` | `string` | yes | unique within the array; used as the React key |
| `title` | `string` | yes | non-empty, ≤ 40 chars |
| `body` | `string` | yes | non-empty, ≤ 160 chars |

**Invariants**: `id` is stable and never an array index. Three or four items — two looks unfinished, five stops being scannable (research R2).

---

## Entity: SocialChannel

An external channel the club actually operates. Owned by `SiteConfig.socials`.

| Field | Type | Required | Validation |
|---|---|---|---|
| `id` | `string` | yes | unique; matches a `<symbol id="{id}-icon">` in `public/icons.svg` |
| `label` | `string` | yes | non-empty; the channel's accessible name |
| `url` | `string` | yes | absolute `https://` URL |

**Invariants**

- A channel is listed **only if the club operates it**. Never invent a URL to fill the row (FR-010).
- Every entry renders with `target="_blank"` and `rel="noopener noreferrer"` (FR-010).
- `id` must resolve in the icon sprite, or the link renders with its text label alone rather than a broken `<use>`.

---

## Entity: TimeRemaining *(derived — the only runtime state)*

Computed by `getTimeRemaining(launchDate, now)`; never stored, never persisted. Recomputed from wall-clock time on every tick so background-tab throttling cannot desynchronise it (research R5).

| Field | Type | Range | Notes |
|---|---|---|---|
| `days` | `number` | ≥ 0 | integer; unbounded above |
| `hours` | `number` | 0–23 | integer |
| `minutes` | `number` | 0–59 | integer |
| `seconds` | `number` | 0–59 | integer |
| `hasLaunched` | `boolean` | — | `true` once `now >= launchDate` |
| `total` | `number` | ≥ 0 | milliseconds remaining; clamped at 0 |

**Invariants**

- **No field is ever negative.** Once `now >= launchDate`, all four units are `0`, `total` is `0`, and `hasLaunched` is `true` (FR-005).
- `hasLaunched === true` ⇒ the component renders the launch message, not the digits.
- An unparseable `launchDate` yields `hasLaunched: true` — degrading to the launch message, never to `NaN` on screen.

### State transitions

```text
                    now < launchDate                now >= launchDate
  ┌──────────────────────────────┐            ┌───────────────────────────┐
  │  COUNTING                    │            │  LAUNCHED                 │
  │  hasLaunched: false          │ ─────────► │  hasLaunched: true        │
  │  renders: D / H / M / S      │  (one-way) │  renders: launch message  │
  │  interval: active, 1000 ms   │            │  interval: cleared        │
  └──────────────────────────────┘            └───────────────────────────┘
                                                          │
                                          invalid launchDate ──┘
                                          (enters LAUNCHED directly)
```

The transition is **one-way** within a page session. On entering `LAUNCHED` the hook clears its interval — no timer keeps running against a finished countdown.

---

## Entity: ContentSection *(structural, not a data record)*

The page's section order, fixed in `App.jsx`. Listed here because FR-007 makes the structure itself a requirement.

| Order | id | Heading level | Source | Story |
|---|---|---|---|---|
| 1 | `hero` | `h1` | `brandName`, `tagline`, `status` | US1 |
| 2 | `offering` | `h2` | `offerings[]` | US1 |
| 3 | `countdown` | `h2` | `launchDate` → `TimeRemaining` | US2 |
| 4 | `about` | `h2` | `about[]`, `parentOrg` | US1 |
| 5 | `contact` | `h2` | `contactEmail`, `socials[]` | US3 |

**Invariants**

- Exactly one `h1` on the page, in the hero. Sections 2–5 use `h2`. Heading levels never skip (FR-011, SC-005).
- Each section carries a unique `id` and an accessible name.
- Section 5 renders its social block only when `socials` is non-empty; the `mailto:` route renders unconditionally.

---

## Relationships

```text
SiteConfig  1 ──── 3..4 ──►  Offering
     │
     ├──── 0..n ──►  SocialChannel        (0 is valid → no social block)
     │
     └──── launchDate ──►  getTimeRemaining()  ──►  TimeRemaining  (derived, transient)
```

One aggregate root, two owned collections, one derived value. No cycles, no shared mutable state, nothing crossing a process boundary.
