import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CATEGORY_DEFS,
  MARKETPLACE_CATEGORIES,
  filterableFieldsFor,
  requiredFieldsFor,
} from '@gwc/contracts/marketplace'
import type { MarketplaceCategory } from '@gwc/contracts/marketplace'

/**
 * The category definitions and the migration have to agree.
 *
 * A field marked `filterable` with no index behind it is a sequential scan
 * that looks fine on a seeded corpus of forty listings and stops looking fine
 * at four thousand. The definition is in `@gwc/contracts` and the index is in
 * SQL, so nothing but this test connects them.
 */

const MIGRATION = readFileSync(
  join(process.cwd(), 'migrations', '019_marketplace.sql'),
  'utf8',
)

/**
 * Indexed columns, **per table**.
 *
 * Deliberately table-aware. An earlier version of this collected column names
 * globally, which passed `property.price_minor` because some *other* table
 * happened to index a column of that name — false confidence, and precisely
 * the bug the suite exists to catch.
 */
const indexedColumnsByTable = (): Map<string, Set<string>> => {
  const byTable = new Map<string, Set<string>>()
  for (const match of MIGRATION.matchAll(/CREATE INDEX[^;]*?ON\s+(\w+)\s*\(([^)]*)\)/gi)) {
    const table = match[1]!.toLowerCase()
    const columns = byTable.get(table) ?? new Set<string>()
    for (const part of match[2]!.split(',')) {
      const name = part.trim().split(/\s+/)[0]
      if (name) columns.add(name.toLowerCase())
    }
    byTable.set(table, columns)
  }
  return byTable
}

/** Which detail table holds a category's fields. */
const DETAIL_TABLE: Readonly<Record<string, string>> = {
  vehicle: 'marketplace_vehicle_details',
  property: 'marketplace_property_details',
  job: 'marketplace_job_details',
  general: 'marketplace_general_details',
}

describe('every filterable field has an index behind it, in its own table', () => {
  const byTable = indexedColumnsByTable()

  it('reads the migration — a scan of nothing proves nothing', () => {
    // Counter-assertion. Without it this suite passes when the regex stops
    // matching, which is exactly when it would matter.
    expect(byTable.size).toBeGreaterThan(4)
    expect(byTable.get('marketplace_listings')).toContain('created_at')
  })

  it.each(MARKETPLACE_CATEGORIES)('%s', (category) => {
    const table = DETAIL_TABLE[category]!
    const indexed = byTable.get(table) ?? new Set<string>()
    for (const field of filterableFieldsFor(category as MarketplaceCategory)) {
      expect(
        indexed,
        `${category}.${field} is filterable but ${table} has no index on it`,
      ).toContain(field.toLowerCase())
    }
  })
})

describe('the definitions describe four categories', () => {
  it('covers exactly the categories the enum names', () => {
    expect(Object.keys(CATEGORY_DEFS).sort()).toEqual([...MARKETPLACE_CATEGORIES].sort())
  })

  it('gives every category at least one required field', () => {
    for (const category of MARKETPLACE_CATEGORIES) {
      expect(requiredFieldsFor(category).length, category).toBeGreaterThan(0)
    }
  })

  it('requires different fields per category — the point of having four', () => {
    // US1.4: the same payload refused as `vehicle` is accepted as `job`. That
    // is only meaningful if the required sets actually differ.
    const vehicle = [...requiredFieldsFor('vehicle')].sort()
    const job = [...requiredFieldsFor('job')].sort()
    expect(vehicle).not.toEqual(job)
  })

  it('keeps `general` the loosest — it exists so anything has somewhere to go', () => {
    expect(requiredFieldsFor('general').length).toBeLessThanOrEqual(
      requiredFieldsFor('vehicle').length,
    )
  })
})
