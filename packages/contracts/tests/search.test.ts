import { describe, it, expect } from 'vitest'
import { searchQuerySchema, SEARCH_MIN_LENGTH, SEARCH_MAX_LENGTH, SEARCH_MAX_TERMS } from '../src/search.ts'

/**
 * Feature 042: the bounds on a search text, shared by the server's route schemas
 * and both clients. The server re-checks every request; a client uses the numbers
 * to decide when it is worth sending one.
 */
const ok = (v: unknown) => searchQuerySchema.safeParse(v)

describe('the search text', () => {
  it('has the documented bounds', () => {
    expect([SEARCH_MIN_LENGTH, SEARCH_MAX_LENGTH, SEARCH_MAX_TERMS]).toEqual([2, 80, 6])
  })

  it('treats absent and empty as "no search"', () => {
    expect(ok(undefined).success).toBe(true)
    const empty = ok('')
    expect(empty.success).toBe(true)
    expect(empty.data).toBe('')
    expect(ok('   ').data).toBe('')
  })

  it('accepts two characters and refuses one, after trimming', () => {
    expect(ok('ab').success).toBe(true)
    expect(ok('a').success).toBe(false)
    expect(ok('  a  ').success).toBe(false)
    expect(ok('  ab  ').data).toBe('ab')
  })

  it('accepts 80 characters and refuses 81', () => {
    expect(ok('x'.repeat(80)).success).toBe(true)
    expect(ok('x'.repeat(81)).success).toBe(false)
  })

  it('accepts six terms and refuses seven, however the words are spaced', () => {
    expect(ok('a1 b2 c3 d4 e5 f6').success).toBe(true)
    expect(ok('a1 b2 c3 d4 e5 f6 g7').success).toBe(false)
    expect(ok('a1   b2\tc3 d4  e5 f6').success).toBe(true)
    expect(ok('a1   b2\tc3 d4  e5 f6  g7').success).toBe(false)
  })

  it('refuses something that is not text', () => {
    expect(ok(42).success).toBe(false)
    expect(ok(['ab']).success).toBe(false)
  })
})
