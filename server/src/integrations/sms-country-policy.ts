// Outbound SMS country policy: normalise a destination, resolve its country,
// decide whether it may be dispatched to.
//
// Pure functions. No I/O, no network, no logging of its own (an invalid
// override entry is reported through the `warn` callback the caller passes).
// Configuration is read ONCE, when the policy is created at boot, never per
// call: `SMS_BLOCKED_COUNTRIES` and `SMS_ALLOWED_COUNTRIES` arrive through
// config/env.ts like every other setting. The allowlist tables are imported;
// neither the accepted-zone list nor the pricing CSV is read at runtime.
//
// Converted from the originating project's helper/smsCountryPolicy.js
// (specs/004-sms-country-allowlist/ there). The one enforcement point that
// uses it is decorators/send-otp.ts.

import { APPROVED_COUNTRIES, KNOWN_DIALING_CODES, BUILD_META } from './sms-countries.generated.ts'
import { NANP_US_AREA_CODES, BLOCKED_DIALING_CODES } from './sms-countries.constants.ts'
import type { ApprovedCountry } from './sms-countries.generated.ts'

export type SmsRefusalReason =
  | 'unparseable'
  | 'unknown_country'
  | 'country_blocked'
  | 'nanp_area_not_allowed'
  | 'country_not_allowed'

export type SmsDecision = {
  allowed: boolean
  dialingCode: string | null
  /** The first zone name recorded for the dialing code, for logs. */
  name: string | null
  reason: SmsRefusalReason | null
  /** All but the last 4 digits masked. The only form a number may be logged in. */
  maskedDestination: string
}

export type SmsCountryTables = {
  approved: readonly ApprovedCountry[]
  known: ReadonlySet<string>
  nanpUsAreaCodes: ReadonlySet<string>
  blocked: ReadonlySet<string>
}

export type SmsCountryPolicyOptions = {
  /** `SMS_BLOCKED_COUNTRIES`: comma-separated dialing codes. REPLACES the seed denylist. */
  blockedOverride?: string
  /** `SMS_ALLOWED_COUNTRIES`: comma-separated ISO alpha-2 codes. NARROWS the allowlist. */
  allowedFilter?: string
  warn?: (message: string) => void
  /** Test seam; defaults to the shipped tables. */
  tables?: SmsCountryTables
}

export const SHIPPED_TABLES: SmsCountryTables = Object.freeze({
  approved: APPROVED_COUNTRIES,
  known: KNOWN_DIALING_CODES,
  nanpUsAreaCodes: NANP_US_AREA_CODES,
  blocked: BLOCKED_DIALING_CODES,
})

export { BUILD_META }

const MAX_CODE_LENGTH = 3

function parseCsv(raw: string | undefined): string[] {
  if (typeof raw !== 'string') return []
  return raw.split(',').map((part) => part.trim()).filter(Boolean)
}

/**
 * Reduce a destination to bare digits, or null if it is unusable.
 * Fails closed: anything it cannot confidently parse becomes null.
 */
export function normalizeDestination(value: unknown): { digits: string | null; raw: string } {
  const raw = value === null || value === undefined ? '' : String(value)

  // Strip separators and a single leading +.
  let digits = raw.trim().replace(/^\+/, '').replace(/[\s\-().]/g, '')

  // Strip one international access prefix: 00 (most of the world) or 011 (NANP).
  if (digits.startsWith('011') && digits.length > 3) {
    digits = digits.slice(3)
  } else if (digits.startsWith('00') && digits.length > 2) {
    digits = digits.slice(2)
  }

  // Anything left that is not a digit means we are guessing - refuse instead.
  if (!/^[0-9]+$/.test(digits)) return { digits: null, raw }

  // No real destination is this short.
  if (digits.length < 4) return { digits: null, raw }

  return { digits, raw }
}

/** Mask all but the last 4 digits. */
export function maskDestination(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value)
  return str.replace(/\d(?=(?:\D*\d){4})/g, '*')
}

export function createSmsCountryPolicy({
  blockedOverride, allowedFilter, warn = () => {}, tables = SHIPPED_TABLES,
}: SmsCountryPolicyOptions = {}) {
  // SMS_BLOCKED_COUNTRIES REPLACES the shipped seed rather than extending it,
  // so a code can be removed as well as added. Dialing codes, not ISO codes:
  // the denylist has to name a country by the only identifier unambiguous here.
  const activeBlockedCodes: ReadonlySet<string> = (() => {
    const override = parseCsv(blockedOverride)
    if (!override.length) return new Set(tables.blocked)
    const valid: string[] = []
    for (const code of override) {
      if (/^[1-9][0-9]{0,3}$/.test(code)) valid.push(code)
      // Never fatal: a typo in .env must not take the API down.
      else warn(`ignoring invalid SMS_BLOCKED_COUNTRIES entry "${code}" (expected a dialing code such as 850)`)
    }
    return new Set(valid)
  })()

  // SMS_ALLOWED_COUNTRIES narrows the generated table. ISO alpha-2, because it
  // is meant to be readable in a .env file. The table is keyed by dialing code
  // and carries no ISO codes, so narrowing matches the START of the zone names
  // recorded against each entry. That is best-effort and can surprise: "DE"
  // does not match "Germany", and "CH" matches both "Chile" and "China".
  const allowedIsoFilter = parseCsv(allowedFilter).map((v) => v.toUpperCase())

  const codeIndex = new Map(tables.approved.map((country) => [country.dialingCode, country]))

  // Matching runs against every code the zone map can identify, not just the
  // approved ones, so a refusal can say WHICH country was refused. Membership
  // here never permits a dispatch - that is decided in step 3 below.
  const matchIndex = new Set([...tables.known, ...codeIndex.keys()])

  const activeCountries = tables.approved.filter((c) => {
    if (activeBlockedCodes.has(c.dialingCode)) return false
    if (!allowedIsoFilter.length) return true
    return c.zones.some((zone) => allowedIsoFilter.some((iso) => zone.toUpperCase().startsWith(iso)))
  })
  const activeCodes = new Set(activeCountries.map((c) => c.dialingCode))

  /**
   * Resolve a destination against the policy.
   *
   * PRECEDENCE IS FIXED AND LOAD-BEARING (data-model.md):
   *   1. denylist        -> country_blocked
   *   2. NANP area code  -> nanp_area_not_allowed
   *   3. allowlist       -> country_not_allowed
   *
   * Steps 1 and 2 both refuse destinations that ARE in the business's accepted
   * list - the four sanctioned jurisdictions, and the 11 Caribbean +1 zones.
   * Moving either below step 3 silently reverses research.md R3, R9, R10 and
   * R12, and does so while every happy-path check still passes.
   */
  function resolveDestination(value: unknown): SmsDecision {
    const { digits, raw } = normalizeDestination(value)

    if (digits === null) {
      return { allowed: false, dialingCode: null, name: null, reason: 'unparseable', maskedDestination: maskDestination(raw) }
    }

    const maskedDestination = maskDestination(digits)

    // Longest-prefix match: 3 digits, then 2, then 1. Longest-first is required
    // so 351 (Portugal) is not shadowed by a shorter entry.
    let matched: string | null = null
    for (let len = MAX_CODE_LENGTH; len >= 1; len--) {
      const candidate = digits.slice(0, len)
      if (matchIndex.has(candidate)) {
        matched = candidate
        break
      }
    }

    if (matched === null) {
      return { allowed: false, dialingCode: null, name: null, reason: 'unknown_country', maskedDestination }
    }

    const country = codeIndex.get(matched) ?? null
    const base = { dialingCode: matched, name: country ? country.zones[0] ?? null : null, maskedDestination }

    // 1. Denylist wins over everything, accepted-list membership included.
    if (activeBlockedCodes.has(matched)) return { ...base, allowed: false, reason: 'country_blocked' }

    // 2. NANP area code, before the allowlist test. +1 covers the USA
    //    (approved), Canada (not approved - R12) and the Caribbean (not
    //    approved - R9); only the area code separates them.
    if (matched === '1') {
      const areaCode = digits.slice(1, 4)
      if (areaCode.length < 3 || !tables.nanpUsAreaCodes.has(areaCode)) {
        return { ...base, allowed: false, reason: 'nanp_area_not_allowed' }
      }
    }

    // 3. Allowlist.
    if (!activeCodes.has(matched)) return { ...base, allowed: false, reason: 'country_not_allowed' }

    return { ...base, allowed: true, reason: null }
  }

  return {
    resolveDestination,
    isAllowed: (value: unknown) => resolveDestination(value).allowed,
    /** The active allowlist, after SMS_ALLOWED_COUNTRIES and the denylist. */
    activeCountries: (): ApprovedCountry[] => activeCountries.slice(),
    /** The active denylist, after any SMS_BLOCKED_COUNTRIES override. */
    blockedCodes: (): Set<string> => new Set(activeBlockedCodes),
  }
}

export type SmsCountryPolicy = ReturnType<typeof createSmsCountryPolicy>
