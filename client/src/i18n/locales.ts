/**
 * The two locales, and the one place their vocabulary is defined.
 *
 * German is the default and the `x-default` target for the public pages
 * (§10.7). English is additive: nothing about the German path changes because
 * it exists.
 */

/** Offered locales, in display order. */
export const LOCALES = Object.freeze(['de', 'en'] as const)

/** The two offered locales, as a union. */
export type Locale = (typeof LOCALES)[number]

/** Falls back here whenever nothing better is known. */
export const DEFAULT_LOCALE: Locale = 'de'

/**
 * BCP 47 tags for `Intl`.
 *
 * `en-GB`, not `en-US`: day-first dates and the €-before-number convention sit
 * closer to the German forms the same screens show, and closer to the
 * European audience the design document describes. If the club wants US
 * conventions this is the one line to change.
 */
export const BCP47: Readonly<Record<Locale, string>> = Object.freeze({ de: 'de-DE', en: 'en-GB' })

/**
 * What each locale calls itself.
 *
 * In its own language, always. Someone who cannot read the current language
 * needs to recognise the target, and "Englisch" does not help an English
 * speaker find their way out of a German page.
 */
export const ENDONYM: Readonly<Record<Locale, string>> = Object.freeze({ de: 'Deutsch', en: 'English' })

/** `de_DE` / `en_GB` — the Open Graph spelling, which uses an underscore. */
export const OG_LOCALE: Readonly<Record<Locale, string>> = Object.freeze({ de: 'de_DE', en: 'en_GB' })

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value)

/**
 * Narrow a browser language tag to an offered locale.
 *
 * Matched on the primary subtag, so `en-US`, `en-GB` and `en` all resolve to
 * `en`. Returns null rather than the default, so callers can tell "the browser
 * asked for something we do not offer" from "the browser asked for German".
 */
export function matchLocale(tag: unknown): Locale | null {
  if (typeof tag !== 'string' || tag === '') return null
  const primary = tag.toLowerCase().split('-')[0]
  return isLocale(primary) ? primary : null
}
