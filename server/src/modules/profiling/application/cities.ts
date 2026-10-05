import { forbidden } from '../../../authz/require-permission.ts'
import { PROBLEMS } from '@gwc/contracts/errors'
import { query } from '../../../db/query.ts'
import type { GwcApp } from '../../../app.ts'
import type { PoolClient } from 'pg'

/**
 * The city lists the questionnaire offers: the InterNations list (`world_cities`)
 * plus the club's own designated cities (`gwc_cities`). The workbook omits
 * three of the seven emirates the club designates, so the two are always read
 * together — a designated city must be selectable whatever the workbook says.
 *
 * The lists cover 160 countries. For any other country the member types their
 * city, which is why every answer carries `listed`.
 */

type Db = Pick<PoolClient, 'query'>

/** Is this country covered by either list? */
async function isListed(db: Db, country: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM world_cities WHERE country = $1)
         OR EXISTS (SELECT 1 FROM gwc_cities WHERE country = $1) AS listed`,
    [country],
  )
  return rows[0].listed as boolean
}

/**
 * A city typed or picked for a country the lists cover must be on them; for
 * any other country free text is accepted (trimmed, already length-checked by
 * the schema).
 */
export async function assertCityAllowed(db: Db, country: string, city: string): Promise<void> {
  if (!(await isListed(db, country))) return
  const { rows } = await db.query(
    `SELECT 1 FROM world_cities WHERE country = $1 AND lower(city) = lower($2)
      UNION ALL
     SELECT 1 FROM gwc_cities WHERE country = $1 AND lower(city) = lower($2)
      LIMIT 1`,
    [country, city.trim()],
  )
  if (rows.length === 0) {
    throw forbidden(PROBLEMS.VALIDATION_FAILED, `"${city}" is not a listed city for ${country}.`)
  }
}

/**
 * `GET /profiling/cities?country=XX&q=`: capitals first, then alphabetical,
 * prefix-filtered, at most 50, the two lists merged and de-duplicated.
 */
export async function listCities(
  app: GwcApp,
  { country, q = '', signal }: { country: string; q?: string; signal?: AbortSignal },
): Promise<{ listed: boolean; cities: string[] }> {
  const prefix = `${q.trim().toLowerCase().replace(/[\\%_]/g, '\\$&')}%`
  const { rows } = await query<{ city: string; is_capital: boolean }>(
    app.pg,
    `SELECT DISTINCT ON (lower(city)) city, is_capital FROM (
       SELECT city, is_capital FROM world_cities WHERE country = $1
       UNION ALL
       SELECT city, false AS is_capital FROM gwc_cities WHERE country = $1
     ) merged
      WHERE lower(city) LIKE $2
      ORDER BY lower(city), is_capital DESC`,
    [country, prefix],
    { signal },
  )
  const cities = rows
    .sort((a, b) => Number(b.is_capital) - Number(a.is_capital) || a.city.localeCompare(b.city))
    .slice(0, 50)
    .map((r) => r.city)
  return { listed: cities.length > 0 || (await isListed(app.pg, country)), cities }
}
