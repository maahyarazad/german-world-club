import { useLocale } from '../../i18n/index.jsx'
import { ENDONYM } from '../../i18n/locales.js'

/**
 * The console's language control.
 *
 * A pair of buttons rather than a link pair: the console re-renders in place,
 * without a page reload and without losing unsaved input (FR-016). The landing
 * pages use links instead, because they have no JavaScript and switch by URL.
 *
 * Three rules it exists to honour:
 *
 *  - **Each language names itself.** "Englisch" does not help an English
 *    speaker find their way out of a German interface.
 *  - **`aria-pressed`, not colour.** The current language is announced rather
 *    than only shown; the gold underline reinforces it and never carries it
 *    alone — the same rule StatusPill already follows.
 *  - **No flags.** A flag names a country, and none means "English" to a reader
 *    in Dubai, Zürich and Singapore at once.
 */
export function LanguageSwitch({ className = '', onDark = false }) {
  const { locale, setLocale, locales } = useLocale()

  return (
    <div
      role="group"
      aria-label={locale === 'de' ? 'Sprache' : 'Language'}
      className={`inline-flex items-center gap-1 ${className}`}
    >
      {locales.map((option) => {
        const active = option === locale
        return (
          <button
            key={option}
            type="button"
            lang={option}
            aria-pressed={active}
            onClick={() => setLocale(option)}
            className={`rounded-card px-2 py-1 text-[12px] transition-colors
              focus-visible:outline-2 focus-visible:outline-offset-2
              ${onDark ? 'focus-visible:outline-accent' : 'focus-visible:outline-navy'}
              ${
                active
                  ? `font-semibold ${onDark ? 'text-text-on-dark' : 'text-text'} border-b-2 border-accent`
                  : `border-b-2 border-transparent ${
                      onDark
                        ? 'text-text-on-dark-muted hover:text-text-on-dark'
                        : 'text-text-muted hover:text-text'
                    }`
              }`}
          >
            {ENDONYM[option]}
          </button>
        )
      })}
    </div>
  )
}

export default LanguageSwitch
