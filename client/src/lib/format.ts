import { BCP47, DEFAULT_LOCALE } from '../i18n/locales'
import type { Locale } from '../i18n/locales'

/**
 * Locale-aware formatting, through Intl.
 *
 * Translating the labels while leaving `1.240,50 €` in an English interface is
 * the half-done version of a language switch, which is why FR-006 names
 * formatting separately from translation. `01.10.2026` and `01/10/2026` are the
 * same date; a component does not get to pick which one a reader sees.
 *
 * Formatters are constructed once **per locale** and cached. Intl constructors
 * are the expensive part — building one per cell in a table of a few hundred
 * rows is measurable.
 */

const tagFor = (locale: Locale): string => BCP47[locale] ?? BCP47[DEFAULT_LOCALE]

/** One cache per formatter kind, keyed by locale. */
const cache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat | Intl.ListFormat | Intl.Collator>()

function memo<T extends Intl.DateTimeFormat | Intl.NumberFormat | Intl.ListFormat | Intl.Collator>(
  kind: string,
  locale: Locale,
  build: (tag: string) => T,
): T {
  const key = `${kind}:${locale}`
  let formatter = cache.get(key)
  if (!formatter) {
    formatter = build(tagFor(locale))
    cache.set(key, formatter)
  }
  return formatter as T
}

const dateFormat = (locale: Locale) =>
  memo('date', locale, (tag) =>
    new Intl.DateTimeFormat(tag, { day: '2-digit', month: '2-digit', year: 'numeric' }))

const dateTimeFormat = (locale: Locale) =>
  memo('dateTime', locale, (tag) =>
    new Intl.DateTimeFormat(tag, {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }))

const numberFormat = (locale: Locale) => memo('number', locale, (tag) => new Intl.NumberFormat(tag))

const percentFormat = (locale: Locale) =>
  memo('percent', locale, (tag) =>
    new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 1 }))

/** Currency varies per offer (EUR, AED, USD all appear in the mockups). */
const currencyFormat = (locale: Locale, currency: string) =>
  memo(`currency:${currency}`, locale, (tag) =>
    new Intl.NumberFormat(tag, { style: 'currency', currency }))

const listFormat = (locale: Locale) =>
  memo('list', locale, (tag) => new Intl.ListFormat(tag, { style: 'long', type: 'conjunction' }))

/**
 * Collation moves with the locale too.
 *
 * Sorting German text with an English collator puts "Ärztin" after "Zürich"
 * instead of beside "Arzt".
 */
export const collatorFor = (locale: Locale = DEFAULT_LOCALE) =>
  memo('collator', locale, (tag) => new Intl.Collator(tag, { sensitivity: 'base', numeric: true }))

type DateLike = Date | string | number | null | undefined
const toDate = (value: Exclude<DateLike, null | undefined>): Date =>
  value instanceof Date ? value : new Date(value)

export function formatDate(value: DateLike, locale: Locale = DEFAULT_LOCALE): string {
  if (!value) return ''
  const date = toDate(value)
  return Number.isNaN(date.getTime()) ? '' : dateFormat(locale).format(date)
}

export function formatDateTime(value: DateLike, locale: Locale = DEFAULT_LOCALE): string {
  if (!value) return ''
  const date = toDate(value)
  return Number.isNaN(date.getTime()) ? '' : dateTimeFormat(locale).format(date)
}

export function formatNumber(value: unknown, locale: Locale = DEFAULT_LOCALE): string {
  return typeof value === 'number' && Number.isFinite(value) ? numberFormat(locale).format(value) : ''
}

/**
 * Money, from integer minor units.
 *
 * Amounts cross the wire as integer cents because a float cannot represent them
 * exactly, and an offer's advantage is checkable only if its prices are.
 * Dividing here, once, is the only place that conversion happens.
 */
export function formatMoney(cents: unknown, currency = 'EUR', locale: Locale = DEFAULT_LOCALE): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return ''
  return currencyFormat(locale, currency).format(cents / 100)
}

/** `ratio` is a fraction: 0.92, not 92. */
export function formatPercent(ratio: unknown, locale: Locale = DEFAULT_LOCALE): string {
  return typeof ratio === 'number' && Number.isFinite(ratio) ? percentFormat(locale).format(ratio) : ''
}

export function formatList(items: unknown, locale: Locale = DEFAULT_LOCALE): string {
  return Array.isArray(items) && items.length > 0 ? listFormat(locale).format(items.map(String)) : ''
}

export const compareText = (a: unknown, b: unknown, locale: Locale = DEFAULT_LOCALE): number =>
  collatorFor(locale).compare(String(a ?? ''), String(b ?? ''))

/**
 * Every formatter, bound to one locale.
 *
 * What a component actually wants: `const f = formattersFor(locale)` once,
 * rather than threading the locale through every call site.
 */
export function formattersFor(locale: Locale = DEFAULT_LOCALE) {
  return {
    locale,
    date: (v: DateLike) => formatDate(v, locale),
    dateTime: (v: DateLike) => formatDateTime(v, locale),
    number: (v: unknown) => formatNumber(v, locale),
    money: (cents: unknown, currency?: string) => formatMoney(cents, currency, locale),
    percent: (v: unknown) => formatPercent(v, locale),
    list: (v: unknown) => formatList(v, locale),
    compare: (a: unknown, b: unknown) => compareText(a, b, locale),
  }
}

/**
 * Fill `{name}` placeholders in a catalogue string.
 *
 * The catalogues were placeholder-free until onboarding needed to say where a
 * code was sent. One tiny function rather than an i18n library: named slots
 * only, no plurals, no formats — the values arrive already formatted.
 */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match))
}
