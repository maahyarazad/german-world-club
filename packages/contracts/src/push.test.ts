import { describe, it, expect } from 'vitest'
import {
  DESTINATION_ROUTES, DESTINATION_TYPES, PUSH_PAYLOAD_VERSION, TITLE_MAX, BODY_MAX,
  resolveDestination, renderOfferPush, truncate, tokenPreview,
} from './push.ts'

/**
 * The deep-link table (contracts/push-payload.md, analysis U2).
 *
 * The mobile app has no test runner, so the mapping it navigates by lives here
 * and is tested here; `expo-client/.../notifications/routes.ts` only turns the
 * result into an expo-router Href.
 */

const payload = (type: string, id: string, v: string = PUSH_PAYLOAD_VERSION) => ({ v, nid: 'n-1', type, id })

describe('resolveDestination', () => {
  it.each([
    ['offer', 'o-1', '/(member)/activity/offer/[id]', { id: 'o-1' }],
    ['listing', 'l-1', '/(member)/activity/listing/[id]', { id: 'l-1' }],
    ['thread_post', 'p-1', '/(member)/threads/[id]', { id: 'p-1' }],
    ['event', 'e-1', '/(member)/events/[id]', { id: 'e-1' }],
    // A partner is addressed by organisation slug, not by uuid.
    ['partner', 'acme-gmbh', '/(member)/threads/organisation/[slug]', { slug: 'acme-gmbh' }],
  ])('%s opens its screen', (type, id, pathname, params) => {
    expect(resolveDestination(payload(type, id))).toEqual({ pathname, params })
  })

  it('maps every destination type, deliberately', () => {
    // A Record over DESTINATION_TYPES already makes a missing key a compile
    // error; this catches the table and the list drifting at runtime too.
    expect(Object.keys(DESTINATION_ROUTES).sort()).toEqual([...DESTINATION_TYPES].sort())
  })

  it.each([
    ['none', payload('none', 'x')],
    ['article (no mobile screen)', payload('article', 'a-1')],
    ['an unknown type', payload('coupon', 'c-1')],
    ['a missing id', { v: PUSH_PAYLOAD_VERSION, nid: 'n', type: 'offer' }],
    ['an empty id', payload('offer', '   ')],
    ['a newer payload version', payload('offer', 'o-1', '2')],
    ['no version at all', { type: 'offer', id: 'o-1' }],
    ['no data', undefined],
  ])('stays put for %s', (_label, data) => {
    expect(resolveDestination(data as Record<string, unknown> | undefined)).toBeNull()
  })

  it('does not resolve everything to null', () => {
    // Counter-assertion for the block above: a resolver that always answered
    // null would pass every "stays put" case.
    expect(resolveDestination(payload('offer', 'o-1'))).not.toBeNull()
  })
})

describe('renderOfferPush', () => {
  it('fills both languages from the merchant and the offer title', () => {
    const text = renderOfferPush({ merchant: 'Café Kranzler', title: '20% auf Kuchen' })
    expect(text.de).toEqual({ title: 'Neues Angebot: Café Kranzler', body: '20% auf Kuchen' })
    expect(text.en).toEqual({ title: 'New offer: Café Kranzler', body: '20% auf Kuchen' })
  })

  it('truncates with an ellipsis instead of refusing', () => {
    const text = renderOfferPush({ merchant: 'M'.repeat(100), title: 'T'.repeat(400) })
    expect([...text.de.title]).toHaveLength(TITLE_MAX)
    expect(text.de.title.endsWith('…')).toBe(true)
    expect([...text.en.body]).toHaveLength(BODY_MAX)
    expect(text.en.body.endsWith('…')).toBe(true)
  })

  it('leaves text that fits alone', () => {
    expect(truncate('short', 10)).toBe('short')
    // Counts characters, not UTF-16 units, so an emoji is not split in half.
    expect(truncate('😀😀😀', 3)).toBe('😀😀😀')
  })
})

describe('tokenPreview', () => {
  it('shows only the first 12 and last 4 characters of a token', () => {
    const token = 'ExponentPushToken[abcdefghijklmnop1234]'
    const preview = tokenPreview(token)
    expect(preview).toBe('ExponentPush…234]')
    // Counter-assertion: the middle of the token, the part that addresses the
    // phone, is gone.
    expect(preview).not.toContain('abcdefghijklmnop')
  })
})
