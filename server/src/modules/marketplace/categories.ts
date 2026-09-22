import { CATEGORY_DEFS } from '@gwc/contracts/marketplace'
import type {
  CategoryDef, FieldDef, ListingDetails, MarketplaceCategory,
} from '@gwc/contracts/marketplace'

/**
 * Server-side validation of a listing's category-specific fields.
 *
 * Reads the same definitions the console builds its compose form from
 * (`@gwc/contracts/marketplace`). A client MAY shape its form from them; this
 * is the enforcement point, and the only one (FR-009). A client that validated
 * instead of the server would be the only barrier.
 *
 * These checks are also business rules that must outlive feature 007's Phase 6:
 * when the Zod schema on the route is removed, this function and the CHECK
 * constraints in 019_marketplace.sql are what remain. See
 * specs/007-typescript-migration/data-model.md §4.
 */

export type FieldProblem = { field: string; reason: string }

/** Which detail table a category's fields live in. */
export const DETAIL_TABLE: Readonly<Record<MarketplaceCategory, string>> = Object.freeze({
  vehicle: 'marketplace_vehicle_details',
  property: 'marketplace_property_details',
  job: 'marketplace_job_details',
  general: 'marketplace_general_details',
})

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '')

function checkField(def: FieldDef, value: unknown): string | null {
  if (isBlank(value)) return def.required ? 'is required' : null

  switch (def.kind) {
    case 'integer':
    case 'decimal':
    case 'money': {
      const n = Number(value)
      if (!Number.isFinite(n)) return 'must be a number'
      if (def.kind === 'integer' && !Number.isInteger(n)) return 'must be a whole number'
      if (def.min !== undefined && n < def.min) return `must be at least ${def.min}`
      if (def.max !== undefined && n > def.max) return `must be at most ${def.max}`
      return null
    }
    case 'enum':
      return def.options?.includes(String(value)) ? null
        : `must be one of: ${def.options?.join(', ')}`
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false'
    case 'date':
      return Number.isNaN(Date.parse(String(value))) ? 'must be a date' : null
    case 'text':
    default: {
      const s = String(value)
      if (def.max !== undefined && s.length > def.max) return `must be at most ${def.max} characters`
      return null
    }
  }
}

/**
 * Validate `details` against its category.
 *
 * Returns every problem rather than the first, because a compose form that
 * surfaces one error per round trip is how a member gives up on the fourth
 * attempt.
 */
export function validateDetails(
  category: MarketplaceCategory,
  details: ListingDetails,
): FieldProblem[] {
  const def: CategoryDef = CATEGORY_DEFS[category]
  const problems: FieldProblem[] = []

  for (const field of def.fields) {
    const reason = checkField(field, details?.[field.key])
    if (reason) problems.push({ field: field.key, reason })
  }

  // An unknown key is a client sending a field this category does not have —
  // usually a category change that did not clear the old form. Refusing names
  // it rather than silently dropping it, because silently dropping is how a
  // member loses the price they typed.
  const known = new Set(def.fields.map((f) => f.key))
  for (const key of Object.keys(details ?? {})) {
    if (!known.has(key)) problems.push({ field: key, reason: `is not a ${category} field` })
  }

  return problems
}

/** The column list and values for a category's detail row insert. */
export function detailColumns(
  category: MarketplaceCategory,
  details: ListingDetails,
): { columns: string[]; values: unknown[] } {
  const def = CATEGORY_DEFS[category]
  const columns: string[] = []
  const values: unknown[] = []
  for (const field of def.fields) {
    const value = details?.[field.key]
    if (isBlank(value)) continue
    columns.push(field.key)
    values.push(value)
  }
  return { columns, values }
}
