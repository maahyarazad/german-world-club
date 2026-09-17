/**
 * German formatting, through Intl.
 *
 * The interface language is German (FR-014), which is a formatting decision as
 * much as a wording one: 1.240,50 € and 17.09.2026 are not stylistic choices
 * that a component gets to make locally.
 *
 * Formatters are constructed once. Intl constructors are the expensive part —
 * building one per render in a table of a few hundred rows is measurable.
 */

const LOCALE = 'de-DE'

const dateFormat = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const numberFormat = new Intl.NumberFormat(LOCALE)

const percentFormat = new Intl.NumberFormat(LOCALE, {
  style: 'percent',
  maximumFractionDigits: 1,
})

/** Currency varies per offer (EUR, AED, USD all appear in the mockups). */
const currencyFormatters = new Map()

function currencyFormatter(currency) {
  let formatter = currencyFormatters.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, { style: 'currency', currency })
    currencyFormatters.set(currency, formatter)
  }
  return formatter
}

const toDate = (value) => (value instanceof Date ? value : new Date(value))

export function formatDate(value) {
  if (!value) return ''
  const date = toDate(value)
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date)
}

export function formatDateTime(value) {
  if (!value) return ''
  const date = toDate(value)
  return Number.isNaN(date.getTime()) ? '' : dateTimeFormat.format(date)
}

export function formatNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? numberFormat.format(value) : ''
}

/**
 * Money, from integer minor units.
 *
 * Amounts cross the wire as integer cents because a float cannot represent
 * them exactly, and an offer's advantage is checkable only if its prices are.
 * Dividing here, once, is the only place that conversion happens.
 */
export function formatMoney(cents, currency = 'EUR') {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return ''
  return currencyFormatter(currency).format(cents / 100)
}

/** `ratio` is a fraction: 0.92, not 92. */
export function formatPercent(ratio) {
  return typeof ratio === 'number' && Number.isFinite(ratio) ? percentFormat.format(ratio) : ''
}

/** German list: "a, b und c". */
const listFormat = new Intl.ListFormat(LOCALE, { style: 'long', type: 'conjunction' })

export function formatList(items) {
  return Array.isArray(items) && items.length > 0 ? listFormat.format(items.map(String)) : ''
}

/** Collator for anything sorted — ä sorts with a, not after z. */
export const collator = new Intl.Collator(LOCALE, { sensitivity: 'base', numeric: true })

export const compareText = (a, b) => collator.compare(String(a ?? ''), String(b ?? ''))
