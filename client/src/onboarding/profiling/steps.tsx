import { useMemo, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'

import {
  SETTLING_STATUSES, QUALIFICATION_LEVELS, OCCUPATIONS, DESIRED_WORK_TYPES, FUTURE_WORK_PRIORITIES,
  YEARLY_INCOME_RANGES, RELATIONSHIP_TAGS, KID_AGE_RANGES, MAX_KIDS, LANGUAGES, INDUSTRIES,
} from '@gwc/contracts/profiling'
import type { ProfilingAnswers, ProfilingStepId, CitySlot, RelationshipTag, KidAgeRange } from '@gwc/contracts/profiling'
import { COUNTRIES, PINNED } from '@gwc/contracts/countries'

import { collatorFor, fill } from '../../lib/format'
import AuthCard from '../../auth/AuthCard'
import Button from '../../components/ui/Button'
import type { useTranslations } from '../../i18n/index'

export type Copy = ReturnType<typeof useTranslations>['profiling']
export type Locale = 'en' | 'de'

export type StepCtx = {
  copy: Copy
  locale: Locale
  answers: ProfilingAnswers
  busy: boolean
  /** Saves and lets the wizard decide where to go next. */
  save: (body: object) => void
  /** null on the first step. */
  back: (() => void) | null
}

const inputClass = `rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] text-text
  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy`

function Frame({ ctx, title, subtitle, children }: { ctx: StepCtx; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <AuthCard title={title}>
      {subtitle && <p className="mt-2 text-[13px] text-text-muted">{subtitle}</p>}
      <div className="mt-6 flex flex-col gap-2">{children}</div>
      {ctx.back && (
        <div className="mt-4">
          <Button variant="quiet" disabled={ctx.busy} onClick={ctx.back}>{ctx.copy.back}</Button>
        </div>
      )}
    </AuthCard>
  )
}

/** A single choice: picking an option saves it and moves on; the saved one is highlighted. */
function Choice({
  ctx, title, subtitle, options, selected, onPick,
}: {
  ctx: StepCtx; title: string; subtitle?: string; options: { value: string; label: string }[]
  selected: string | null; onPick: (value: string) => void
}) {
  return (
    <Frame ctx={ctx} title={title} subtitle={subtitle}>
      {options.map((option) => (
        <Button
          key={option.value}
          variant={selected === option.value ? 'primary' : 'secondary'}
          aria-pressed={selected === option.value}
          disabled={ctx.busy}
          onClick={() => onPick(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </Frame>
  )
}

function Bubbles({
  ctx, title, subtitle, options, initial, onToggle, onContinue,
}: {
  ctx: StepCtx; title: string; subtitle?: string; options: { value: string; label: string }[]
  initial: string[]; onToggle?: (current: string[], value: string) => string[]; onContinue: (values: string[]) => void
}) {
  const [values, setValues] = useState<string[]>(initial)
  const toggle = (value: string) => setValues((current) => (
    onToggle ? onToggle(current, value)
      : current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
  ))
  return (
    <Frame ctx={ctx} title={title} subtitle={subtitle}>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={values.includes(option.value)}
            onClick={() => toggle(option.value)}
            className={`rounded-full border px-3 py-1.5 text-[13px] ${
              values.includes(option.value) ? 'border-navy bg-navy text-text-on-dark' : 'border-hairline bg-surface text-text'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <Button disabled={ctx.busy || values.length === 0} onClick={() => onContinue(values)}>{ctx.copy.next}</Button>
    </Frame>
  )
}

function Text({
  ctx, title, initial, onContinue,
}: { ctx: StepCtx; title: string; initial: string; onContinue: (value: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <Frame ctx={ctx} title={title}>
      <input value={value} onChange={(event) => setValue(event.target.value)} className={inputClass} />
      <Button disabled={ctx.busy || !value.trim()} onClick={() => onContinue(value.trim())}>{ctx.copy.next}</Button>
    </Frame>
  )
}

/** A dropdown of a fixed list; picking an entry saves it, and the saved one is preselected. */
function Dropdown({
  ctx, title, placeholder, options, selected, onPick,
}: {
  ctx: StepCtx; title: string; placeholder: string; options: { value: string; label: string }[]
  selected: string | null; onPick: (value: string) => void
}) {
  const [value, setValue] = useState(selected ?? '')
  return (
    <Frame ctx={ctx} title={title}>
      <select
        value={value} onChange={(event) => setValue(event.target.value)} aria-label={title}
        className={inputClass}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Button disabled={ctx.busy || !value} onClick={() => onPick(value)}>{ctx.copy.next}</Button>
    </Frame>
  )
}

function Languages({ ctx, title, initial, onContinue }: {
  ctx: StepCtx; title: string; initial: string[]; onContinue: (languages: string[]) => void
}) {
  const { copy } = ctx
  const [languages, setLanguages] = useState<string[]>(initial)
  const [pick, setPick] = useState('')
  const add = (event: ChangeEvent<HTMLSelectElement>) => {
    const code = event.target.value
    if (code && !languages.includes(code)) setLanguages((current) => [...current, code])
    setPick('')
  }
  return (
    <Frame ctx={ctx} title={title} subtitle={copy.languagesSubtitle}>
      <select value={pick} onChange={add} className={inputClass}>
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
              onClick={() => setLanguages((current) => current.filter((c) => c !== code))}
              aria-label={fill(copy.languagesRemove, { language: language?.en ?? code })}
              className="rounded-full border border-navy bg-navy px-3 py-1 text-[12px] text-text-on-dark"
            >
              {language?.en ?? code} ×
            </button>
          )
        })}
      </div>
      <Button disabled={ctx.busy || languages.length === 0} onClick={() => onContinue(languages)}>{copy.next}</Button>
    </Frame>
  )
}

function Kids({ ctx }: { ctx: StepCtx }) {
  const { copy } = ctx
  const [ages, setAges] = useState<(KidAgeRange | '')[]>(ctx.answers.kids)
  const setCount = (raw: string) => {
    const n = Math.max(0, Math.min(MAX_KIDS, Math.floor(Number(raw) || 0)))
    // Keep the ranges already picked by position; new kids start unpicked.
    setAges((current) => Array.from({ length: n }, (_, i) => current[i] ?? ''))
  }
  const complete = ages.length > 0 && ages.every((a) => a !== '')
  return (
    <Frame ctx={ctx} title={copy.kidsCountTitle}>
      <input
        type="number" min={1} max={MAX_KIDS} inputMode="numeric"
        value={ages.length === 0 ? '' : ages.length}
        onChange={(event) => setCount(event.target.value)}
        aria-label={copy.kidsCountTitle}
        className={inputClass}
      />
      {ages.map((age, index) => (
        <label key={index} className="flex flex-col gap-1 text-[12px] text-text-muted">
          {fill(copy.kidAgeTitle, { n: index + 1 })}
          <select
            value={age}
            onChange={(event) => setAges((current) => current.map((a, i) => (i === index ? event.target.value as KidAgeRange : a)))}
            className={inputClass}
          >
            <option value="" />
            {KID_AGE_RANGES.map((range) => <option key={range} value={range}>{copy.kidAgeOptions[range]}</option>)}
          </select>
        </label>
      ))}
      <Button disabled={ctx.busy || !complete} onClick={() => ctx.save({ kids: ages })}>{copy.next}</Button>
    </Frame>
  )
}

function Cities({ ctx }: { ctx: StepCtx }) {
  const { copy, locale } = ctx
  const [primary, setPrimary] = useState<CitySlot>(ctx.answers.primaryCity ?? { country: '', city: '' })
  const [secondary, setSecondary] = useState<CitySlot[]>(ctx.answers.secondaryCities)

  const countries = useMemo(() => {
    const collator = collatorFor(locale)
    const pinned = PINNED.map((code) => COUNTRIES.find((c) => c.code === code)).filter((c) => c !== undefined)
    const rest = COUNTRIES
      .filter((c) => !(PINNED as readonly string[]).includes(c.code))
      .sort((a, b) => collator.compare(a[locale], b[locale]))
    return [...pinned, ...rest]
  }, [locale])

  const countrySelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}>
      <option value="">{copy.country}</option>
      {countries.map((c) => <option key={c.code} value={c.code}>{c[locale]}</option>)}
    </select>
  )
  const setSecondaryField = (index: number, field: keyof CitySlot, value: string) =>
    setSecondary((current) => current.map((slot, i) => (i === index ? { ...slot, [field]: value } : slot)))

  return (
    <Frame ctx={ctx} title={copy.cityTitle} subtitle={copy.citySubtitle}>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">{copy.primaryCity}</legend>
        <div className="flex gap-2">
          {countrySelect(primary.country, (country) => setPrimary((c) => ({ ...c, country })))}
          <input
            value={primary.city} placeholder={copy.city} className={`flex-1 ${inputClass}`}
            onChange={(event) => setPrimary((c) => ({ ...c, city: event.target.value }))}
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
              value={slot.city} placeholder={copy.city} className={`flex-1 ${inputClass}`}
              onChange={(event) => setSecondaryField(index, 'city', event.target.value)}
            />
            <Button type="button" variant="quiet" onClick={() => setSecondary((c) => c.filter((_, i) => i !== index))}>
              {copy.removeSecondary}
            </Button>
          </div>
        </fieldset>
      ))}
      {secondary.length < 2 && (
        <Button variant="secondary" onClick={() => setSecondary((c) => [...c, { country: '', city: '' }])}>{copy.addSecondary}</Button>
      )}
      <Button
        disabled={ctx.busy || !primary.country || !primary.city.trim()}
        onClick={() => ctx.save({ primaryCity: primary, secondaryCities: secondary.filter((s) => s.country && s.city.trim()) })}
      >
        {copy.next}
      </Button>
    </Frame>
  )
}

const labelled = (values: readonly string[], labels: Record<string, string>) =>
  values.map((value) => ({ value, label: labels[value] ?? value }))

/**
 * One screen per step id. Partner steps are the German Q1–Q5 again, writing
 * under `partner` — the same components, so the two cannot drift apart.
 */
export function StepView({ step, ctx }: { step: Exclude<ProfilingStepId, 'review'>; ctx: StepCtx }) {
  const { copy, answers } = ctx
  const partner = step.startsWith('partner-')
  const base = partner ? step.slice('partner-'.length) : step
  const subject = partner ? answers.partner : answers
  const title = (own: string) => (partner ? fill(copy.partnerTitle, { question: own }) : own)
  const put = (field: string, value: unknown) => ctx.save(partner ? { partner: { [field]: value } } : { [field]: value })

  switch (base) {
    case 'settling':
      // Only the member is asked this; the partner questionnaire has no settling step.
      return <Choice ctx={ctx} title={copy.settlingTitle} subtitle={copy.settlingSubtitle}
        options={labelled(SETTLING_STATUSES, copy.settlingOptions)} selected={answers.settlingStatus}
        onPick={(v) => ctx.save({ settlingStatus: v })} />
    case 'languages':
      return <Languages ctx={ctx} title={title(copy.languagesTitle)} initial={subject?.languages ?? []}
        onContinue={(languages) => put('languages', languages)} />
    case 'income':
      return <Choice ctx={ctx} title={title(copy.incomeTitle)}
        options={labelled(YEARLY_INCOME_RANGES, copy.incomeOptions)} selected={subject?.yearlyIncomeRange ?? null}
        onPick={(v) => put('yearlyIncomeRange', v)} />
    case 'qualification':
      return <Choice ctx={ctx} title={title(copy.qualificationTitle)}
        options={labelled(QUALIFICATION_LEVELS, copy.qualificationOptions)} selected={subject?.qualificationLevel ?? null}
        onPick={(v) => put('qualificationLevel', v)} />
    case 'occupation':
      return <Choice ctx={ctx} title={title(copy.occupationTitle)}
        options={labelled(OCCUPATIONS, copy.occupationOptions)} selected={subject?.occupation ?? null}
        onPick={(v) => put('occupation', v)} />
    case 'cities':
      return <Cities ctx={ctx} />
    case 'relationship':
      return <Bubbles ctx={ctx} title={copy.relationshipTitle} subtitle={copy.relationshipSubtitle}
        options={labelled(RELATIONSHIP_TAGS, copy.relationshipOptions)} initial={answers.relationshipStatus ?? []}
        // "Single" is exclusive: choosing it clears the rest, choosing anything else clears it.
        onToggle={(current, value) => (value === 'single'
          ? (current.includes('single') ? [] : ['single'])
          : (current.includes(value) ? current.filter((v) => v !== value) : [...current.filter((v) => v !== 'single'), value]))}
        onContinue={(tags) => ctx.save({ relationshipStatus: tags as RelationshipTag[] })} />
    case 'kids':
      return <Kids ctx={ctx} />
    case 'work-type':
      return <Choice ctx={ctx} title={copy.desiredWorkTitle}
        options={labelled(DESIRED_WORK_TYPES, copy.desiredWorkOptions)} selected={answers.desiredWorkType}
        onPick={(v) => ctx.save({ desiredWorkType: v })} />
    case 'work-industry':
      return <Dropdown ctx={ctx} title={copy.futureWorkSectorTitle} placeholder={copy.industryPlaceholder}
        options={labelled(INDUSTRIES, copy.industryOptions)} selected={answers.futureWorkSector}
        onPick={(v) => ctx.save({ futureWorkSector: v })} />
    case 'work-offering':
      return <Text ctx={ctx} title={copy.futureWorkOfferingTitle} initial={answers.futureWorkOffering ?? ''}
        onContinue={(v) => ctx.save({ futureWorkOffering: v })} />
    case 'work-idea':
      // Business Owner is asked for a product or service; everyone else for an idea.
      return <Text ctx={ctx}
        title={answers.desiredWorkType === 'business_owner' ? copy.productServiceTitle : copy.futureWorkIdeaTitle}
        initial={answers.futureWorkIdea ?? ''} onContinue={(v) => ctx.save({ futureWorkIdea: v })} />
    case 'work-ready':
      return <Choice ctx={ctx} title={copy.futureWorkReadyTitle}
        options={[{ value: 'yes', label: copy.futureWorkReadyOptions.yes }, { value: 'no', label: copy.futureWorkReadyOptions.no }]}
        selected={answers.futureWorkReady === null ? null : answers.futureWorkReady ? 'yes' : 'no'}
        onPick={(v) => ctx.save({ futureWorkReady: v === 'yes' })} />
    case 'work-priorities':
      return <Choice ctx={ctx} title={copy.futureWorkPrioritiesTitle}
        options={labelled(FUTURE_WORK_PRIORITIES, copy.futureWorkPrioritiesOptions)} selected={answers.futureWorkPriority}
        onPick={(v) => ctx.save({ futureWorkPriority: v })} />
    default:
      return null
  }
}
