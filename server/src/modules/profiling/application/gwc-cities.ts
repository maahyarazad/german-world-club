import { query } from '../../../db/query.ts'
import type { GwcApp } from '../../../app.ts'
import type { CitySlot } from '@gwc/contracts/profiling'

/**
 * The designated cities a client can offer as a dropdown (research R4). A
 * short, reference-data list — currently just the UAE emirates — so returning
 * it whole and letting the client filter by the country it already picked is
 * simpler than a query-string filter for a table this size.
 */
export async function listGwcCities(
  app: GwcApp,
  { signal }: { signal?: AbortSignal } = {},
): Promise<CitySlot[]> {
  const { rows } = await query<{ country: string; city: string }>(
    app.pg,
    'SELECT country, city FROM gwc_cities ORDER BY country, city',
    [],
    { signal },
  )
  return rows
}
