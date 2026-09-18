import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react'
import { de } from './de'
import { en } from './en'
import { DEFAULT_LOCALE, LOCALES, isLocale, matchLocale } from './locales'
import type { Locale } from './locales'
import type { ReactNode } from 'react'

/**
 * The active locale, and the catalogue that follows from it.
 *
 * Two catalogues, no framework. Feature 003's R10 declined an i18n library for
 * one language; the reasoning holds for two — 163 flat keys with no
 * interpolation, no plural categories and no context forms need none of what a
 * library provides. What they do need is the guarantee that both catalogues
 * stay in step, and that is `scripts/check-i18n.mjs`, not a runtime.
 */

const CATALOGUES = { de, en }

/**
 * The catalogue shape, taken from the German one.
 *
 * German is the source of truth for the key set, so a key present in `en` but
 * missing from `de` is a type error here as well as a check-i18n failure. The
 * parity script still runs: it catches the other direction and reports both
 * sides at once, which a structural type cannot.
 */
export type Catalogue = typeof de

/** Where the browser's choice lives. Per-browser by decision (FR-023). */
export const STORAGE_KEY = 'gwc.locale'

/**
 * Read the stored choice, surviving a storage that refuses to co-operate.
 *
 * `localStorage` throws in private browsing and wherever site data is blocked.
 * A language preference is a convenience, not state anything depends on, so it
 * must degrade rather than break (FR-021).
 */
export function readStoredLocale(storage: Storage | null = safeStorage()): Locale | null {
  try {
    const value = storage?.getItem(STORAGE_KEY)
    return isLocale(value) ? value : null
  } catch {
    return null
  }
}

export function writeStoredLocale(locale: Locale, storage: Storage | null = safeStorage()): boolean {
  try {
    storage?.setItem(STORAGE_KEY, locale)
    return true
  } catch {
    // The switch still works for this page; it just will not survive a reload.
    return false
  }
}

/** `localStorage` itself can throw on *access*, not only on use. */
function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * The precedence rule, in one place.
 *
 *   stored choice       → wins if present and still offered
 *   browser preference  → used when it resolves to an offered locale
 *   German              → otherwise
 *
 * An explicit choice outranks the browser, or the switch would appear not to
 * work on the next visit. The browser is consulted only on a first visit, which
 * is the one moment the control is hardest to find (FR-018). A stored value
 * that is no longer offered falls back rather than rendering blanks.
 *
 * This is also the seam a per-account preference would attach to if FR-023 is
 * ever revisited: one more branch above `stored`, and nothing else changes.
 */
export type ResolveLocaleOptions = {
  stored?: Locale | null
  navigatorLanguages?: readonly (string | undefined)[]
}

export function resolveLocale({
  stored = readStoredLocale(),
  navigatorLanguages = globalThis.navigator?.languages ?? [globalThis.navigator?.language],
}: ResolveLocaleOptions = {}): Locale {
  if (isLocale(stored)) return stored

  for (const tag of navigatorLanguages ?? []) {
    const matched = matchLocale(tag)
    if (matched) return matched
  }

  return DEFAULT_LOCALE
}

/** What `useLocale` hands back. */
export type LocaleContextValue = {
  locale: Locale
  setLocale: (next: Locale) => void
  locales: readonly Locale[]
  t: Catalogue
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export type LocaleProviderProps = { children?: ReactNode; initialLocale?: Locale }

export function LocaleProvider({ children, initialLocale }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? resolveLocale())

  /**
   * Keep the document's language in step (FR-020).
   *
   * Not cosmetic: it is what tells a screen reader which pronunciation to use,
   * and what a browser's translate prompt reads.
   */
  useEffect(() => {
    if (globalThis.document?.documentElement) {
      globalThis.document.documentElement.lang = locale
    }
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return
    setLocaleState(next)
    writeStoredLocale(next)
  }, [])

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, locales: LOCALES, t: CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE] }),
    [locale, setLocale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext)
  if (!context) throw new Error('useLocale must be used inside a LocaleProvider')
  return context
}

/**
 * The catalogue for the active locale.
 *
 * Returns the object, not a lookup function. A `t('some.key')` that falls back
 * to echoing its argument hides a missing key; `t.signIn.title` being
 * `undefined` shows up in a test and in the rendered output immediately.
 */
export function useTranslations(): Catalogue {
  return useLocale().t
}

export { LOCALES, DEFAULT_LOCALE, isLocale, matchLocale } from './locales'
