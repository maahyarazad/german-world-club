# Contract: Site Configuration Module

**Module**: `src/config/site.js` | **Feature**: `001-coming-soon-revamp`

The one place a non-developer edits to change what the page says (FR-006). This contract defines its exported shape. Field semantics and validation rules live in [data-model.md](../data-model.md).

## Exports

```js
export const siteConfig   // frozen SiteConfig object
export default siteConfig
```

## Shape

```js
{
  brandName:    string,          // "Experts Circle"
  parentOrg:    string,          // "German Emirates Club"
  tagline:      string,          // ≤ 120 chars, one line at 1280px
  status:       string,          // explicit pre-launch wording
  launchDate:   string,          // ISO 8601 WITH offset — "2026-12-01T09:00:00+04:00"
  description:  string,          // 1–2 sentences; also the meta description
  offerings:    [{ id, title, body }],        // 3–4 items
  about:        [string],                     // 1–3 paragraphs
  contactEmail: string,                       // rendered as mailto:
  socials:      [{ id, label, url }]          // MAY BE EMPTY
}
```

## Guarantees the module must uphold

| # | Guarantee |
|---|---|
| C1 | The exported object is `Object.freeze`-d; no consumer can mutate it. |
| C2 | `launchDate` always carries an explicit UTC offset. |
| C3 | If `VITE_LAUNCH_DATE` is set and parses, it overrides `launchDate`; otherwise the literal default is used. **The module never exports an unparseable date.** |
| C4 | `socials` is always an array — `[]` when the club has no confirmed channels, never `null` or `undefined`. |
| C5 | Every `offerings[].id` and `socials[].id` is unique within its array and stable across builds (React keys). |
| C6 | No field contains an invented email address or URL. Unknown values ship as documented placeholders or are omitted. |

## Consumer contract

- Consumers **read only**. No component writes to config.
- Consumers must handle `socials.length === 0` by rendering no social block (FR-010).
- Consumers must not assume `offerings.length`; render whatever the array holds.

## Env override

| Variable | Type | Default | Effect |
|---|---|---|---|
| `VITE_LAUNCH_DATE` | ISO 8601 with offset | unset | Overrides `launchDate` at build time. Unparseable values are ignored in favour of the default (C3). |

## Verification

- Unit: exported object is frozen; mutation attempt does not change it.
- Unit: `new Date(siteConfig.launchDate)` is valid (not `NaN`) — with and without the env override set.
- Unit: `Array.isArray(siteConfig.socials)` holds when the club list is empty.
- Unit: `offerings` ids are unique.
