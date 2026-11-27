import { describe, it, expect } from 'vitest'
import { escapeLike, searchPredicates, searchTerms } from '../../src/db/text-search.ts'

/**
 * Feature 042, research R12: how a typed search becomes SQL. Pure, so it runs
 * without a database. The properties that matter are the ones a mistake would
 * turn into a bug a happy-path test never sees: a typed `%` matching everything,
 * a quote reaching the SQL text, a column name taken from the request.
 */
const COLUMNS = ['o.title', 'o.description'] as const

describe('searchTerms', () => {
  it('splits on any whitespace, trims, and drops empties', () => {
    expect(searchTerms('  pizza   rabatt\tkaffee\n')).toEqual(['pizza', 'rabatt', 'kaffee'])
  })

  it('removes repeats regardless of case, keeping the first spelling', () => {
    expect(searchTerms('Rad rad RAD helm')).toEqual(['Rad', 'helm'])
  })

  it('caps the number of terms at six, whatever it is given', () => {
    expect(searchTerms('a1 b2 c3 d4 e5 f6 g7 h8')).toEqual(['a1', 'b2', 'c3', 'd4', 'e5', 'f6'])
  })

  it('returns nothing for no search', () => {
    expect(searchTerms(undefined)).toEqual([])
    expect(searchTerms('')).toEqual([])
    expect(searchTerms('   ')).toEqual([])
  })
})

describe('escapeLike', () => {
  it('escapes the three characters that mean something to LIKE', () => {
    expect(escapeLike('50%')).toBe('50\\%')
    expect(escapeLike('a_b')).toBe('a\\_b')
    expect(escapeLike('a\\b')).toBe('a\\\\b')
  })

  it('leaves ordinary text, accents and quotes alone', () => {
    expect(escapeLike(`Café "Müller's"`)).toBe(`Café "Müller's"`)
  })
})

describe('searchPredicates', () => {
  it('adds one parameter and one predicate per term, each over every column', () => {
    const params: unknown[] = []
    const predicates = searchPredicates('pizza rabatt', COLUMNS, params)
    expect(params).toEqual(['%pizza%', '%rabatt%'])
    expect(predicates).toEqual([
      "(o.title ILIKE $1 ESCAPE '\\' OR o.description ILIKE $1 ESCAPE '\\')",
      "(o.title ILIKE $2 ESCAPE '\\' OR o.description ILIKE $2 ESCAPE '\\')",
    ])
  })

  it('numbers its placeholders after the parameters already there', () => {
    const params: unknown[] = ['a', 'b']
    const predicates = searchPredicates('rad', ['l.title', 'l.body'], params)
    expect(params).toEqual(['a', 'b', '%rad%'])
    expect(predicates).toEqual(["(l.title ILIKE $3 ESCAPE '\\' OR l.body ILIKE $3 ESCAPE '\\')"])
  })

  it('matches a typed wildcard as itself', () => {
    const params: unknown[] = []
    searchPredicates('50% a_b', COLUMNS, params)
    expect(params).toEqual(['%50\\%%', '%a\\_b%'])
  })

  it('never puts what was typed into the SQL text, only into parameters', () => {
    const params: unknown[] = []
    const hostile = `x'; DROP TABLE offers; --`
    const sql = searchPredicates(hostile, COLUMNS, params).join(' ')
    expect(sql).not.toMatch(/DROP|offers;|--|x'/)
    expect(params).toContain(`%x';%`)
  })

  it('does nothing for no search: no predicate, no parameter', () => {
    for (const q of [undefined, '', '   ']) {
      const params: unknown[] = ['keep']
      expect(searchPredicates(q, COLUMNS, params)).toEqual([])
      expect(params).toEqual(['keep'])
    }
  })
})
