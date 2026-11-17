import { parsePhoneNumberWithError, ParseError } from 'libphonenumber-js/mobile'
import type { CountryCode, PhoneNumber } from 'libphonenumber-js/mobile'

/**
 * One rule for "is this a mobile number we can text" (feature 031), shared by the
 * server and both clients so they cannot disagree (constitution I).
 *
 * Until now the only check anywhere was the shape regex `^\+[1-9][0-9]{6,14}$`.
 * A number typed WITH its country code but without the `+` — `971585831595` — was
 * glued onto the picked country's code (Germany by default) as `+49971585831595`,
 * which has the right shape and is not a number: the SMS provider refused it and the
 * server called that an outage. This asks whether the number exists.
 *
 * It uses the library's `mobile` metadata, which only accepts mobile ranges, because a
 * code can only be texted to a mobile; a landline is `not-mobile`'s case, and shows
 * up as `invalid` here (the mobile metadata does not know it).
 */
export type MobileProblem = 'empty' | 'too-short' | 'too-long' | 'invalid'

export type MobileCheck =
  | {
    ok: true
    /** The number in E.164, the form the server validates and the SMS provider takes. */
    e164: string
    /** True when what was typed was read differently from the picked country, see below. */
    corrected: boolean
  }
  | { ok: false; reason: MobileProblem }

const MIN_DIGITS = 6
const MAX_DIGITS = 17

const strip = (typed: string) => typed.replace(/[\s\-().]/g, '')

function parse(text: string, country?: string): PhoneNumber | null {
  try {
    return parsePhoneNumberWithError(text, country ? (country as CountryCode) : undefined)
  } catch (error) {
    if (error instanceof ParseError) return null
    throw error
  }
}

const validMobile = (number: PhoneNumber | null): number is PhoneNumber => number !== null && number.isValid()

/**
 * Check what a person typed in the number field, given the country picked beside it.
 *
 *  - A leading `+` or `00` means international: it is read as such and wins over the
 *    picker (so a pasted `+44 …` is never glued onto Germany).
 *  - Otherwise the digits are a NATIONAL number of the picked country (a leading 0 is
 *    dropped by the library as that country's trunk prefix).
 *  - If that is not a valid mobile but the same digits read as international ARE
 *    (`971585831595` with Germany picked), the number is returned corrected, flagged
 *    `corrected: true` so the field can say how it was read. A valid national number is
 *    never "corrected".
 */
export function checkMobile(country: string, typed: string): MobileCheck {
  const text = strip(typed)
  if (text === '') return { ok: false, reason: 'empty' }

  const digits = text.replace(/\D/g, '')
  const international = text.startsWith('+') || text.startsWith('00')

  if (international) {
    const number = parse(text.startsWith('00') ? `+${text.slice(2)}` : text)
    if (validMobile(number)) return { ok: true, e164: number.number, corrected: false }
  } else {
    const national = parse(text, country)
    if (validMobile(national)) return { ok: true, e164: national.number, corrected: false }
    // Typed with its own country code but no `+`: read the digits as international.
    const asInternational = digits.length >= MIN_DIGITS ? parse(`+${digits}`) : null
    if (validMobile(asInternational)) return { ok: true, e164: asInternational.number, corrected: true }
  }

  if (digits.length < MIN_DIGITS) return { ok: false, reason: 'too-short' }
  if (digits.length > MAX_DIGITS) return { ok: false, reason: 'too-long' }
  return { ok: false, reason: 'invalid' }
}

/** Is this E.164 string a number the SMS provider can be asked to text? The server's check. */
export function isValidMobileE164(e164: string): boolean {
  if (!e164.startsWith('+')) return false
  return validMobile(parse(e164))
}

/** `+971 58 583 1595`, for reading back to the person; the input unchanged if it is not valid. */
export function formatMobile(e164: string): string {
  const number = e164.startsWith('+') ? parse(e164) : null
  return number ? number.formatInternational() : e164
}
