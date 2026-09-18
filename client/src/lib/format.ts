import { BCP47, DEFAULT_LOCALE } from '../i18n/locales'

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

const tagFor = (locale) => BCP47[locale] ?? BCP47[DEFAULT_LOCALE]

/** One cache per formatter kind, keyed by locale. */
const cache = new Map()

function memo(kind, locale, build) {
  const key = `${kind}:${locale}`
  let formatter = cache.get(key)
  if (!formatter) {
    formatter = build(tagFor(locale))
    cache.set(key, formatter)
  }
  return formatter
}

const dateFormat = (locale) =>
  memo('date', locale, (tag) =>
    new Intl.DateTimeFormat(tag, { day: '2-digit', month: '2-digit', year: 'numeric' }))

const dateTimeFormat = (locale) =>
  memo('dateTime', locale, (tag) =>
    new Intl.DateTimeFormat(tag, {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }))

const numberFormat = (locale) => memo('number', locale, (tag) => new Intl.NumberFormat(tag))

const percentFormat = (locale) =>
  memo('percent', locale, (tag) =>
    new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 1 }))

/** Currency varies per offer (EUR, AED, USD all appear in the mockups). */
const currencyFormat = (locale, currency) =>
  memo(`currency:${currency}`, locale, (tag) =>
    new Intl.NumberFormat(tag, { style: 'currency', currency }))

const listFormat = (locale) =>
  memo('list', locale, (tag) => new Intl.ListFormat(tag, { style: 'long', type: 'conjunction' }))

/**
 * Collation moves with the locale too.
 *
 * Sorting German text with an English collator puts "Ärztin" after "Zürich"
 * instead of beside "Arzt".
 */
export const collatorFor = (locale = DEFAULT_LOCALE) =>
  memo('collator', locale, (tag) => new Intl.Collator(tag, { sensitivity: 'base', numeric: true }))

const toDate = (value) => (value instanceof Date ? value : new Date(value))

export function formatDate(value, locale = DEFAULT_LOCALE) {
  if (!value) return ''
  const date = toDate(value)
  return Number.isNaN(date.getTime()) ? '' : dateFormat(locale).format(date)
}

export function formatDateTime(value, locale = DEFAULT_LOCALE) {
  if (!value) return ''
  const date = toDate(value)
  return Number.isNaN(date.getTime()) ? '' : dateTimeFormat(locale).format(date)
}

export function formatNumber(value, locale = DEFAULT_LOCALE) {
  return typeof value === 'number' && Number.isFinite(value) ? numberFormat(locale).format(value) : ''
}

/**
 * Money, from integer minor units.
 *
 * Amounts cross the wire as integer cents because a float cannot represent them
 * exactly, and an offer's advantage is checkable only if its prices are.
 * Dividing here, once, is the only place that conversion happens.
 */
export function formatMoney(cents, currency = 'EUR', locale = DEFAULT_LOCALE) {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return ''
  return currencyFormat(locale, currency).format(cents / 100)
}

/** `ratio` is a fraction: 0.92, not 92. */
export function formatPercent(ratio, locale = DEFAULT_LOCALE) {
  return typeof ratio === 'number' && Number.isFinite(ratio) ? percentFormat(locale).format(ratio) : ''
}

export function formatList(items, locale = DEFAULT_LOCALE) {
  return Array.isArray(items) && items.length > 0 ? listFormat(locale).format(items.map(String)) : ''
}

export const compareText = (a, b, locale = DEFAULT_LOCALE) =>
  collatorFor(locale).compare(String(a ?? ''), String(b ?? ''))

/**
 * Every formatter, bound to one locale.
 *
 * What a component actually wants: `const f = formattersFor(locale)` once,
 * rather than threading the locale through every call site.
 */
export function formattersFor(locale = DEFAULT_LOCALE) {
  return {
    locale,
    date: (v) => formatDate(v, locale),
    dateTime: (v) => formatDateTime(v, locale),
    number: (v) => formatNumber(v, locale),
    money: (cents, currency) => formatMoney(cents, currency, locale),
    percent: (v) => formatPercent(v, locale),
    list: (v) => formatList(v, locale),
    compare: (a, b) => compareText(a, b, locale),
  }
}
