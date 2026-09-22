# Contract: Category Field Definitions

**Feature**: 008-marketplace

One definition, in `packages/contracts/src/marketplace.ts`, read by both the
console's compose form and the server's validation. Principle I: a rule expressed
in two places is a defect, not a convenience.

The client **shapes its form** from this. The server **enforces** it. A client
that validated instead of the server would be the only barrier (FR-009).

## Shape

```ts
export type FieldDef = {
  key: string
  kind: 'text' | 'integer' | 'decimal' | 'money' | 'enum' | 'date' | 'boolean'
  required: boolean
  /** Enumerations that the SERVER branches on live here. */
  options?: readonly string[]
  min?: number
  max?: number
  /** Whether the index can filter on it — drives both the UI and the DB index. */
  filterable?: boolean
}

export type CategoryDef = {
  category: MarketplaceCategory
  fields: readonly FieldDef[]
}
```

`filterable` appears here rather than only in the UI because a filter with no
index behind it is a sequential scan that looks fine until the corpus grows. The
definition and the migration's index list must agree, and a test should say so.

## Per category

Full field lists are in [../data-model.md](../data-model.md) §3. What matters at
the contract level:

- **vehicle** — `make`, `model`, `year`, `mileage_km`, `price_minor`, `fuel`,
  `transmission`, `body_type`, `condition`, plus the feature set below.
- **property** — `deal` (rent|sale), `rooms`, `size_sqm`, `price_minor`, `city`,
  `postal_code`, `available_from`.
- **job** — `employment_type`, `seniority`, `department`, `city`, `remote`,
  `salary_min_minor`, `salary_max_minor`.

Required sets differ per category, and that difference is testable directly: the
same submission that is refused as a `vehicle` for a missing field is accepted as
a `job` (spec US1.4).

## Money

Always **integer minor units** plus a currency, never a float. The platform
already divides by 100 in exactly one place —
`client/src/lib/format.ts` `formatMoney` — and adding a second conversion site is
how the two drift.

## `deal` is not `mode`

`mode` is offer-versus-request and lives on every listing. `deal` is
rent-versus-sale and lives only on property. A *request* to *rent* is a coherent
listing; collapsing the two axes makes it unexpressible.

## Vehicle features

Served by `GET /marketplace/categories`, read from the `vehicle_features`
catalogue. **Not** in this static definition — the catalogue is data, staff-
editable, and changes without a deploy (research.md R3).

Each entry carries `key`, `group` and `position`. **No label.** Labels live in
`client/src/i18n/{de,en}.ts` keyed by `key`:

- the server emits no localised text, and
  `tests/ops/no-server-localisation.test.ts` asserts no response body varies with
  `Accept-Language`
- `npm run -w client test:i18n` fails the build when the catalogues disagree in
  either direction, so a feature added with a German label and no English one
  fails rather than rendering a German word in an English form

A retired feature (`retired_at` set) is absent from the compose form and still
renders on listings that carry it.

## Assertions

1. The console's compose form is built from this definition — no hard-coded field
   list anywhere in `client/src`.
2. Every `filterable: true` field has a backing index in `018_marketplace.sql`.
3. A required field missing under its own category is refused; the same payload
   under a category that does not require it is accepted.
4. Every vehicle-feature `key` has a label in **both** catalogues.
5. No label text is served by the API.
