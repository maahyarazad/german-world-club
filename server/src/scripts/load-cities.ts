#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { Pool } from 'pg'

/**
 * Loads the InterNations country/city list (server/data/internations-cities.json,
 * converted from the club's workbook by convert-cities.py) into `world_cities`.
 *
 * Idempotent and additive: it upserts and never deletes, so running it on every
 * seed is safe and a city the club adds by hand is not removed.
 */
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'internations-cities.json')

type Entry = { country: string; city: string; region: string; capital: boolean }

export async function loadCities(pool: Pick<Pool, 'query'>, { file = FILE }: { file?: string } = {}): Promise<number> {
  const entries = JSON.parse(await readFile(file, 'utf8')) as Entry[]
  await pool.query(
    `INSERT INTO world_cities (country, city, region, is_capital)
     SELECT * FROM unnest($1::char(2)[], $2::text[], $3::text[], $4::boolean[])
     ON CONFLICT (country, lower(city)) DO UPDATE
       SET city = EXCLUDED.city, region = EXCLUDED.region, is_capital = EXCLUDED.is_capital`,
    [entries.map((e) => e.country), entries.map((e) => e.city), entries.map((e) => e.region), entries.map((e) => e.capital)],
  )
  return entries.length
}

// Run directly: `npm run -w server load:cities`.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { loadEnv } = await import('../config/env.ts')
  const { createPool } = await import('../db/pool.ts')
  const pool = createPool(loadEnv())
  try {
    console.log(`world_cities: ${await loadCities(pool)} cities loaded`)
  } finally {
    await pool.end()
  }
}
