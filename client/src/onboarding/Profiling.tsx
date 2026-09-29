import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'

import {
  SETTLING_STATUSES, QUALIFICATION_LEVELS, OCCUPATIONS, DESIRED_WORK_TYPES, LANGUAGES,
} from '@gwc/contracts/profiling'
import type { ProfilingStatus, CitySlot } from '@gwc/contracts/profiling'
import { COUNTRIES, PINNED } from '@gwc/contracts/countries'

import { get, patch, ApiError } from '../lib/api'
import { collatorFor, fill } from '../lib/format'
import AuthCard from '../auth/AuthCard'
import Button from '../components/ui/Button'
import { useLocale, useTranslations } from '../i18n/index'

/**
 * Onboarding Phase 2 (feature 013): the questionnaire an approved member sees
 * before `Application.tsx` lets them into the console. Rendered instead of
 * `enter()` whenever `GET /profiling/status` reports `completed: false`.
 *
 * The branch and every answer already given come from the server on mount —
 * this component never guesses at progress, the same discipline `Application`
 * already applies to the Phase 1 steps.
 */
export function Profiling({ onComplete }: { onComplete: () => void }) {
  const t = useTranslations()
  const copy = t.profiling
  const { locale } = useLocale()
  const [snapshot, setSnapshot] = useState<ProfilingStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setSnapshot(await get('/profiling/status') as ProfilingStatus)
    } catch (err) {
      console.error('Profiling.load', err instanceof ApiError ? err.problem : err)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const submit = useCallback(async (body: object) => {
    setError(null)
    try {
      const next = await patch('/profiling', body) as ProfilingStatus
      setSnapshot(next)
      if (next.completed && next.branch === 'germany') onComplete()
    } catch (err) {
      console.error('Profiling.submit', err instanceof ApiError ? err.problem : err)
      setError(copy.genericError)
    }
  }, [onComplete, copy])

  if (!snapshot) {
    return (
      <AuthCard title={copy.title}>
        <p className="mt-2 text-[13px] text-text-muted">{t.console.loading}</p>
      </AuthCard>
    )
  }

  if (snapshot.completed) {
    if (snapshot.branch === 'germany') return null // onComplete() already fired
    const outcome = snapshot.outcome === 'gwc_city_match'
      ? { title: copy.matchTitle, body: copy.matchBody }
      : { title: copy.meetingTitle, body: copy.meetingBody }
    return (
      <AuthCard title={outcome.title}>
        <p className="mt-2 text-[13px] text-text-muted">{outcome.body}</p>
        <div className="mt-6">
          <Button onClick={onComplete}>{copy.submit}</Button>
        </div>
      </AuthCard>
    )
  }

  return snapshot.branch === 'germany'
    ? <GermanyQuestions copy={copy} snapshot={snapshot} error={error} onSubmit={submit} />
    : <NearestCityForm copy={copy} locale={locale} error={error} onSubmit={submit} />
}

type Copy = ReturnType<typeof useTranslations>['profiling']

/** One question at a time, in order — the first one `answers` does not already hold. */
function GermanyQuestions({
  copy, snapshot, error, onSubmit,
}: { copy: Copy; snapshot: ProfilingStatus; error: string | null; onSubmit: (body: object) => Promise<void> }) {
  const { answers } = snapshot
  const [busy, setBusy] = useState(false)
  const [languagePick, setLanguagePick] = useState('')
  const [languages, setLanguages] = useState<string[]>(answers.languages ?? [])

  const act = async (body: object) => {
    setBusy(true)
    await onSubmit(body)
    setBusy(false)
  }

  const choice = (
    title: string, options: readonly string[], optionLabels: Record<string, string>, field: string,
  ) => (
    <AuthCard title={title}>
      <div className="mt-6 flex flex-col gap-2">
        {options.map((value) => (
          <Button key={value} variant="secondary" disabled={busy} onClick={() => act({ [field]: value })}>
            {optionLabels[value]}
          </Button>
        ))}
        {error && <p role="alert" className="mt-2 text-[12px] text-tint-danger-fg">{error}</p>}
      </div>
    </AuthCard>
  )

  if (answers.settlingStatus === null) {
    return choice(copy.settlingTitle, SETTLING_STATUSES, copy.settlingOptions, 'settlingStatus')
  }

  if (answers.languages === null) {
    const addLanguage = (event: ChangeEvent<HTMLSelectElement>) => {
      const code = event.target.value
      if (code && !languages.includes(code)) setLanguages((current) => [...current, code])
      setLanguagePick('')
    }
    const remove = (code: string) => setLanguages((current) => current.filter((c) => c !== code))
    return (
      <AuthCard title={copy.languagesTitle}>
        <p className="mt-2 text-[13px] text-text-muted">{copy.languagesSubtitle}</p>
        <div className="mt-4 flex flex-col gap-3">
          <select
            value={languagePick}
            onChange={addLanguage}
            className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] text-text
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
          >
            <option value="">{copy.languagesPlaceholder}</option>
            {LANGUAGES.filter((l) => !languages.includes(l.code)).map((l) => (
              <option key={l.code} value={l.code}>{l.en}</option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            {languages.map((code) => {
              const language = LANGUAGES.find((l) => l.code === code)
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => remove(code)}
                  aria-label={fill(copy.languagesRemove, { language: language?.en ?? code })}
                  className="rounded-full border border-navy bg-navy px-3 py-1 text-[12px] text-text-on-dark"
                >
                  {language?.en ?? code} ×
                </button>
              )
            })}
          </div>
          {error && <p role="alert" className="text-[12px] text-tint-danger-fg">{error}</p>}
          <Button disabled={busy || languages.length === 0} onClick={() => act({ languages })}>
            {copy.next}
          </Button>
        </div>
      </AuthCard>
    )
  }

  if (answers.qualificationLevel === null) {
    return choice(copy.qualificationTitle, QUALIFICATION_LEVELS, copy.qualificationOptions, 'qualificationLevel')
  }

  if (answers.occupation === null) {
    return choice(copy.occupationTitle, OCCUPATIONS, copy.occupationOptions, 'occupation')
  }

  return choice(copy.desiredWorkTitle, DESIRED_WORK_TYPES, copy.desiredWorkOptions, 'desiredWorkType')
}

/** The whole elsewhere-branch submission is one form, per contracts/profiling-api.md. */
function NearestCityForm({
  copy, locale, error, onSubmit,
}: { copy: Copy; locale: 'en' | 'de'; error: string | null; onSubmit: (body: object) => Promise<void> }) {
  const [primary, setPrimary] = useState<CitySlot>({ country: '', city: '' })
  const [secondary, setSecondary] = useState<CitySlot[]>([])
  const [busy, setBusy] = useState(false)

  const countries = useMemo(() => {
    const collator = collatorFor(locale)
    const pinned = PINNED.map((code) => COUNTRIES.find((c) => c.code === code)).filter((c) => c !== undefined)
    const rest = COUNTRIES
      .filter((c) => !(PINNED as readonly string[]).includes(c.code))
      .sort((a, b) => collator.compare(a[locale], b[locale]))
    return [...pinned, ...rest]
  }, [locale])

  const countrySelect = (value: string, onChange: (v: string) => void) => (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] text-text
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
    >
      <option value="">{copy.country}</option>
      {countries.map((c) => <option key={c.code} value={c.code}>{c[locale]}</option>)}
    </select>
  )

  const addSecondary = () => {
    if (secondary.length < 2) setSecondary((current) => [...current, { country: '', city: '' }])
  }
  const removeSecondary = (index: number) => setSecondary((current) => current.filter((_, i) => i !== index))
  const setSecondaryField = (index: number, field: keyof CitySlot, value: string) =>
    setSecondary((current) => current.map((slot, i) => (i === index ? { ...slot, [field]: value } : slot)))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    await onSubmit({ primaryCity: primary, secondaryCities: secondary.filter((s) => s.country && s.city) })
    setBusy(false)
  }

  return (
    <AuthCard title={copy.cityTitle}>
      <p className="mt-2 text-[13px] text-text-muted">{copy.citySubtitle}</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {copy.primaryCity}
          </legend>
          <div className="flex gap-2">
            {countrySelect(primary.country, (country) => setPrimary((c) => ({ ...c, country })))}
            <input
              value={primary.city}
              onChange={(event) => setPrimary((c) => ({ ...c, city: event.target.value }))}
              placeholder={copy.city}
              className="flex-1 rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] text-text
                focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
            />
          </div>
        </fieldset>

        {secondary.map((slot, index) => (
          <fieldset key={index} className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              {fill(copy.secondaryCity, { n: index + 2 })}
            </legend>
            <div className="flex gap-2">
              {countrySelect(slot.country, (country) => setSecondaryField(index, 'country', country))}
              <input
                value={slot.city}
                onChange={(event) => setSecondaryField(index, 'city', event.target.value)}
                placeholder={copy.city}
                className="flex-1 rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] text-text
                  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
              />
              <Button type="button" variant="quiet" onClick={() => removeSecondary(index)}>{copy.removeSecondary}</Button>
            </div>
          </fieldset>
        ))}

        {secondary.length < 2 && (
          <Button type="button" variant="secondary" onClick={addSecondary}>{copy.addSecondary}</Button>
        )}

        {error && <p role="alert" className="text-[12px] text-tint-danger-fg">{error}</p>}

        <Button type="submit" disabled={busy || !primary.country || !primary.city}>
          {busy ? copy.submitting : copy.submit}
        </Button>
      </form>
    </AuthCard>
  )
}

export default Profiling
