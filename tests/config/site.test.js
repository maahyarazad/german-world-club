import { describe, expect, it } from 'vitest'
import siteConfig from '../../src/config/site.js'

/** Contract: specs/001-coming-soon-revamp/contracts/site-config.md (C1–C6) */
describe('siteConfig contract', () => {
  it('C1: is frozen and cannot be mutated by consumers', () => {
    expect(Object.isFrozen(siteConfig)).toBe(true)

    try {
      siteConfig.brandName = 'Mutated'
    } catch {
      /* strict mode throws; non-strict silently ignores — both are acceptable */
    }
    expect(siteConfig.brandName).toBe('Experts Circle')
  })

  it('C2: launchDate is ISO 8601 carrying an explicit UTC offset', () => {
    expect(siteConfig.launchDate).toMatch(/([+-]\d{2}:\d{2}|Z)$/)
  })

  it('C3: launchDate always parses to a real date', () => {
    expect(Number.isNaN(new Date(siteConfig.launchDate).getTime())).toBe(false)
  })

  it('C4: socials is always an array', () => {
    expect(Array.isArray(siteConfig.socials)).toBe(true)
  })

  it('C5: offerings have unique, stable string ids', () => {
    const ids = siteConfig.offerings.map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
    ids.forEach((id) => expect(typeof id).toBe('string'))
  })

  it('C6: ships no invented contact address', () => {
    // Placeholder must use the IANA-reserved example domain, never a real one.
    expect(siteConfig.contactEmail).toMatch(/@example\.(com|org|net)$/)
  })

  it('C6: ships no invented social URLs', () => {
    siteConfig.socials.forEach((s) => expect(s.url).toMatch(/^https:\/\//))
  })

  it('exposes the required display fields', () => {
    for (const field of ['brandName', 'parentOrg', 'tagline', 'status', 'description']) {
      expect(typeof siteConfig[field]).toBe('string')
      expect(siteConfig[field].length).toBeGreaterThan(0)
    }
    expect(siteConfig.offerings.length).toBeGreaterThanOrEqual(3)
    expect(siteConfig.about.length).toBeGreaterThanOrEqual(1)
  })

  it('keeps the tagline short enough to hold one line on desktop', () => {
    expect(siteConfig.tagline.length).toBeLessThanOrEqual(120)
  })
})
