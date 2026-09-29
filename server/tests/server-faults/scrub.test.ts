import { describe, it, expect } from 'vitest'
import { scrubText } from '../../src/ops/scrub.ts'

/**
 * Feature 012, research R4: the one free-text field a fault record keeps must
 * not carry contact details or credentials (Principle VI) — and must still say
 * what failed, or the record is useless.
 */
describe('scrubText', () => {
  const secrets = {
    email: 'anna.schmidt+club@example.de',
    phone: '+49 151 2345-6789',
    jwt: 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlLXZhbHVlLWhlcmU',
    hex: 'a3f9c2e81b7d4056a3f9c2e81b7d4056a3f9c2e8',
    token: 'rt_8fK2mQ9xLp4vN7wZ3bY6cH1dJ5gT0sRa',
  }

  for (const [kind, value] of Object.entries(secrets)) {
    it(`removes a ${kind}`, () => {
      const out = scrubText(`lookup failed for ${value} while saving`, 2000)
      expect(out).not.toContain(value)
      expect(out).toContain('[redacted]')
      expect(out).toContain('lookup failed for')
    })
  }

  it('leaves ordinary diagnostic text intact', () => {
    // Counter-assertion: a scrub that ate everything would pass every test above.
    const messages = [
      'duplicate key value violates unique constraint "members_email_key"',
      'Cannot read properties of undefined (reading \'id\')',
      'listing 3f2b8c1e-7a4d-4e5f-9b6a-0c1d2e3f4a5b not found',
      'at createPost (/srv/app/server/src/modules/threads/application/compose.ts:120:15)',
      'deadline passed at 2026-09-24T10:15:00Z',
      'connect ECONNREFUSED 127.0.0.1:5432',
    ]
    for (const message of messages) expect(scrubText(message, 2000)).toBe(message)
  })

  it('truncates to the maximum after scrubbing', () => {
    expect(scrubText('x'.repeat(5000), 2000)).toHaveLength(2000)
    expect(scrubText('short', 2000)).toBe('short')
  })
})
