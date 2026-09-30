import { useId, useMemo, useState } from 'react'

import { COUNTRIES, PINNED } from '@gwc/contracts/countries'
import { dialLabel, hasDialCode, splitE164, toE164 } from '@gwc/contracts/dial-codes'

import { collatorFor } from '../../lib/format'
import { useLocale, useTranslations } from '../../i18n/index'

/**
 * A mobile number as a country (its calling code) plus the number itself, so
 * nobody has to know to type `+49` first. The parent still holds one string,
 * the E.164 number the server validates — empty until a number is typed.
 *
 * A number typed with its own `+` is taken as international and wins over the
 * picked country, which is how someone pasting `+44 20 …` is not surprised.
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

  const countries = useMemo(() => {
    const collator = collatorFor(locale)
    const withCode = COUNTRIES.filter((c) => hasDialCode(c.code))
    const pinned = PINNED.map((code) => withCode.find((c) => c.code === code)).filter((c) => c !== undefined)
    const rest = withCode.filter((c) => !(PINNED as readonly string[]).includes(c.code)).sort((a, b) => collator.compare(a[locale], b[locale]))
    return [...pinned, ...rest]
  }, [locale])

  const emit = (nextCountry: string, nextNational: string) =>
    onChange(nextNational.trim() === '' ? '' : toE164(nextCountry, nextNational))

  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">{copy.mobile}</label>
      <div className="flex gap-2">
        <select
          aria-label={copy.mobileCountry}
          value={country}
          onChange={(event) => { setCountry(event.target.value); emit(event.target.value, national) }}
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
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={[error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined}
          onChange={(event) => { setNational(event.target.value); emit(country, event.target.value) }}
          className={`min-w-0 flex-1 rounded-card border bg-surface px-3 py-2.5 text-[13px] text-text
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy
            ${error ? 'border-tint-danger-fg' : 'border-hairline'}`}
        />
      </div>
      {hint && <p id={hintId} className="text-[12px] text-text-muted">{hint}</p>}
      {error && <p id={errorId} className="text-[12px] text-tint-danger-fg">{error}</p>}
    </div>
  )
}

export default MobileField
