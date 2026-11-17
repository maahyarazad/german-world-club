import { useId, useMemo, useState } from 'react'

import { COUNTRIES, PINNED } from '@gwc/contracts/countries'
import { dialLabel, hasDialCode, splitE164, toE164 } from '@gwc/contracts/dial-codes'
import { checkMobile, formatMobile } from '@gwc/contracts/mobile'

import { collatorFor, fill } from '../../lib/format'
import { mobileErrorText } from '../../lib/mobile'
import { useLocale, useTranslations } from '../../i18n/index'

/**
 * A mobile number as a country (its calling code) plus the number itself, so
 * nobody has to know to type `+49` first. The parent still holds one string,
 * the E.164 number the server validates — empty until a number is typed.
 *
 * A number typed with its own `+` is taken as international and wins over the
 * picked country, which is how someone pasting `+44 20 …` is not surprised.
 *
 * Feature 031: the number is CHECKED as it is typed, with the rule the server and the
 * app share (`checkMobile`). Typing a number with its own country code but no `+`
 * (`971585831595` with Germany picked) used to become `+49971585831595` — right shape,
 * not a number — and fail at the SMS provider. It is now read as the international
 * number it is, the picker follows, and the field says how it was read. An invalid
 * number is reported under the field once the person leaves it.
 */
export type MobileFieldProps = {
  /** E.164 (or empty); read once, to start the picker and the field. */
  value: string
  onChange: (e164: string) => void
  error?: string
  hint?: string
}

export function MobileField({ value, onChange, error, hint }: MobileFieldProps) {
  const copy = useTranslations().onboarding
  const { locale } = useLocale()
  const id = useId()
  const initial = useMemo(() => splitE164(value), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [country, setCountry] = useState(initial?.country ?? 'DE')
  const [national, setNational] = useState(initial ? initial.national : value)
  const [blurred, setBlurred] = useState(false)
  // How a corrected number was read ("+971 58 583 1595"); cleared as soon as the text changes.
  const [readAs, setReadAs] = useState<string | null>(null)

  const countries = useMemo(() => {
    const collator = collatorFor(locale)
    const withCode = COUNTRIES.filter((c) => hasDialCode(c.code))
    const pinned = PINNED.map((code) => withCode.find((c) => c.code === code)).filter((c) => c !== undefined)
    const rest = withCode.filter((c) => !(PINNED as readonly string[]).includes(c.code)).sort((a, b) => collator.compare(a[locale], b[locale]))
    return [...pinned, ...rest]
  }, [locale])

  /** Tell the parent the E.164 number, or what was typed when it is not (the parent validates it again). */
  const emit = (nextCountry: string, nextNational: string, { announce }: { announce: boolean }) => {
    if (nextNational.trim() === '') { onChange(''); setReadAs(null); return }
    const check = checkMobile(nextCountry, nextNational)
    if (!check.ok) { onChange(toE164(nextCountry, nextNational)); setReadAs(null); return }
    onChange(check.e164)
    // The picker follows a number that named its own country, so field and picker agree.
    // Only while typing: a person who PICKS a country has decided, and the picker must not snap back.
    const named = check.corrected || /^\s*(\+|00)/.test(nextNational)
    const detected = splitE164(check.e164)?.country
    if (announce && named && detected && detected !== nextCountry) setCountry(detected)
    setReadAs(announce && check.corrected ? check.e164 : null)
  }

  const own = national.trim() === '' ? null : checkMobile(country, national)
  const problem = own && !own.ok ? mobileErrorText(copy.errors, own.reason) : undefined
  // The parent's error (submit, or a refusal from the server) wins over the live one.
  const shownError = error ?? (blurred ? problem : undefined)

  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const noticeId = `${id}-notice`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">{copy.mobile}</label>
      <div className="flex gap-2">
        <select
          aria-label={copy.mobileCountry}
          value={country}
          onChange={(event) => { setCountry(event.target.value); emit(event.target.value, national, { announce: false }) }}
          className="w-[46%] rounded-card border border-hairline bg-surface px-2 py-2.5 text-[13px] text-text
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
        >
          {countries.map((c) => <option key={c.code} value={c.code}>{dialLabel(c.code, locale)}</option>)}
        </select>
        <input
          id={id}
          type="tel"
          autoComplete="tel-national"
          value={national}
          placeholder={country === 'DE' ? '151 12345678' : ''}
          aria-invalid={shownError ? 'true' : undefined}
          aria-describedby={[shownError ? errorId : null, readAs ? noticeId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined}
          onBlur={() => setBlurred(true)}
          onChange={(event) => { setNational(event.target.value); emit(country, event.target.value, { announce: true }) }}
          className={`min-w-0 flex-1 rounded-card border bg-surface px-3 py-2.5 text-[13px] text-text
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy
            ${shownError ? 'border-tint-danger-fg' : 'border-hairline'}`}
        />
      </div>
      {hint && <p id={hintId} className="text-[12px] text-text-muted">{hint}</p>}
      {readAs && !shownError && (
        <p id={noticeId} role="status" className="text-[12px] text-navy">{fill(copy.mobileCorrected, { number: formatMobile(readAs) })}</p>
      )}
      {shownError && <p id={errorId} className="text-[12px] text-tint-danger-fg">{shownError}</p>}
    </div>
  )
}

export default MobileField
