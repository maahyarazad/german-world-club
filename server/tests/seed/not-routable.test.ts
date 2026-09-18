import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { withSeededDatabase } from './helpers.ts'
import { hasDatabase } from '../helpers/db.ts'
import { isNonRoutableEmail, isNonRoutableMobile, EMAIL_DOMAIN } from '../../src/seed/faker.ts'

/**
 * SC-005 — nothing the seed writes can reach a real person.
 *
 * `safety.test.js` checks the three columns that hold addresses and the one
 * that holds numbers. This suite makes the stronger claim, which is the one the
 * success criterion actually states: sweep **every text column of every table**
 * and find nothing routable anywhere.
 *
 * The difference is not academic. Faker's `internet.email()` returns live
 * domains — hotmail.com was the first thing it produced here — and the place an
 * address escapes to is not the `email` column somebody thought to check. It is
 * a `display_name`, a campaign body, an offer's terms, a seeded comment.
 *
 * Why it matters at all: a demo database gets pointed at a real mail relay
 * roughly once per project. On that day the only thing standing between a
 * generated population and several hundred strangers receiving club newsletters
 * is that none of the addresses can resolve.
 */

/** RFC 5322 is not the goal — finding anything that a mailer would try is. */
const EMAIL_SHAPED = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
/** E.164 and common national forms, loose enough to catch what a dialler would take. */
const PHONE_SHAPED = /(?:\+|00)\d[\d\s().-]{7,17}\d|\b0\d{9,12}\b/g

describe.skipIf(!hasDatabase)('no seeded value can reach anybody', () => {
  let db
  let columns

  beforeAll(async () => {
    db = await withSeededDatabase('gwc_seed_routable')
    const { rows } = await db.pool.query(`
      SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_name = c.table_name AND t.table_schema = c.table_schema
       WHERE c.table_schema = 'public'
         AND t.table_type = 'BASE TABLE'
         AND c.data_type IN ('text', 'character varying', 'citext')
       ORDER BY c.table_name, c.column_name`)
    columns = rows
  }, 180_000)

  afterAll(async () => { await db?.drop() })

  it('found text columns to sweep — a sweep of none is not a result', () => {
    expect(columns.length).toBeGreaterThan(30)
  })

  it('has no routable email address in any text column of any table', async () => {
    const offenders = []
    for (const { table_name: table, column_name: column } of columns) {
      const { rows } = await db.pool.query(
        `SELECT DISTINCT "${column}" AS value FROM "${table}" WHERE "${column}" IS NOT NULL`,
      )
      for (const { value } of rows) {
        for (const match of String(value).match(EMAIL_SHAPED) ?? []) {
          if (!isNonRoutableEmail(match)) offenders.push(`${table}.${column}: ${match}`)
        }
      }
    }
    expect(offenders).toEqual([])
  }, 120_000)

  it('has no dialable number in any text column of any table', async () => {
    const offenders = []
    for (const { table_name: table, column_name: column } of columns) {
      const { rows } = await db.pool.query(
        `SELECT DISTINCT "${column}" AS value FROM "${table}" WHERE "${column}" IS NOT NULL`,
      )
      for (const { value } of rows) {
        for (const match of String(value).match(PHONE_SHAPED) ?? []) {
          // A number-shaped run inside prose is not a phone number. Only a
          // value that IS one — the whole column — is treated as dialable,
          // which keeps the sweep honest without making it noisy.
          if (String(value).trim() !== match.trim()) continue
          if (!isNonRoutableMobile(match)) offenders.push(`${table}.${column}: ${match}`)
        }
      }
    }
    expect(offenders).toEqual([])
  }, 120_000)

  it('swept columns that actually contain addresses', async () => {
    // Counter-assertion for the sweep itself. If the column query returned
    // nothing useful — wrong schema, wrong data types — both tests above would
    // pass on an empty result set.
    const { rows } = await db.pool.query(
      `SELECT count(*)::int AS n FROM members WHERE email LIKE $1`,
      [`%@${EMAIL_DOMAIN.member}.invalid`],
    )
    expect(rows[0].n).toBeGreaterThan(50)
  })
})

describe('the detectors refuse a routable fixture', () => {
  /**
   * The suite above is a search for absence, and a broken detector finds
   * absence everywhere. These are the values it must catch.
   */
  it.each([
    'somebody@gmail.com',
    'Luiz60@hotmail.com',
    'press@german-world-club.com',
    'a.real.person@company.co.uk',
  ])('rejects %s', (address) => {
    expect(isNonRoutableEmail(address)).toBe(false)
  })

  it.each([
    '+4915112345678',   // a real German mobile prefix
    '07700900123',      // the drama range, but national and therefore dialable
    '+971501234567',
  ])('rejects %s', (number) => {
    expect(isNonRoutableMobile(number)).toBe(false)
  })

  it('accepts what the seed actually generates', () => {
    // And the other direction, or a detector that rejected everything would
    // pass every case above while failing the whole database.
    for (const subdomain of Object.values(EMAIL_DOMAIN)) {
      expect(isNonRoutableEmail(`anna.schmidt@${subdomain}.invalid`), subdomain).toBe(true)
    }
    expect(isNonRoutableMobile('+447700900123')).toBe(true)
  })

  it('finds an address that a column-by-column check would miss', () => {
    // The scenario this file exists for: a live address inside a free-text
    // field, where nobody would think to look.
    const prose = 'Bei Fragen wenden Sie sich an kontakt@echte-firma.de — wir helfen gern.'
    const found = prose.match(EMAIL_SHAPED) ?? []
    expect(found).toEqual(['kontakt@echte-firma.de'])
    expect(isNonRoutableEmail(found[0])).toBe(false)
  })
})
