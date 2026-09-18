import { useTranslations } from '../i18n/index.jsx'
import LanguageSwitch from '../components/ui/LanguageSwitch.jsx'


/**
 * The frame both unauthenticated screens share.
 *
 * Extracted because sign-in and password reset are the only two pages a visitor
 * sees before the console exists, and two subtly different versions of the same
 * card is exactly the drift a design system is meant to prevent.
 */
export function AuthCard({ title, subtitle, children, footer }) {
  const t = useTranslations()
  return (
    <main className="flex min-h-svh items-center justify-center bg-ground px-4 py-10 font-sans">
      <div className="w-full max-w-sm rounded-card border border-hairline bg-surface p-6">
        <a href="/" className="inline-block">
          {/* Explicit dimensions, and a derivative rather than the original
              (FR-013, Principle VI). */}
          <img
            src="/gwc-logo.png"
            alt={t.brand.logoAlt}
            width="844"
            height="578"
            className="mb-5 h-10 w-auto"
          />
        </a>
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-text">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-text-muted">{subtitle}</p>}
        {children}
        {footer && <div className="mt-4 text-[13px]">{footer}</div>}

        {/* Reachable BEFORE sign-in (FR-015). Someone who cannot read German
            must be able to change the language on the very first screen they
            see, which is this one. */}
        <div className="mt-6 flex justify-end border-t border-hairline pt-4">
          <LanguageSwitch />
        </div>
      </div>
    </main>
  )
}

export default AuthCard
