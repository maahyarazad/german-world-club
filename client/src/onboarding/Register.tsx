import { useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useNavigate } from 'react-router'

import { GENDERS, registerRequestSchema } from '@gwc/contracts/onboarding'
import type { Gender, RegisterRequest, RegisterResponse } from '@gwc/contracts/onboarding'
import { COUNTRIES, PINNED } from '@gwc/contracts/countries'
import type { ProblemResponse } from '@gwc/contracts/errors'

import { post, ApiError } from '../lib/api'
import { describeProblem } from '../lib/problems'
import { collatorFor, fill } from '../lib/format'
import AuthCard from '../auth/AuthCard'
import Button from '../components/ui/Button'
import Field, { FormMessage } from '../components/ui/Field'
import { useLocale, useTranslations } from '../i18n/index'

/**
 * Onboarding steps 1 and 2 (§6.1), on the web: who you are, then where you
 * live. The same fields, rules and single request as the mobile app — only the
 * session differs, and that is decided at step 3.
 *
 * Validated with the server's own schema from @gwc/contracts, field by field,
 * so this form cannot accept what the server refuses or refuse what it accepts.
 * The server validates again regardless.
 *
 * No `deviceId` is sent. That field is what marks the mobile face, and it
 * would bind approval to a device a browser does not have.
 */

const fields = registerRequestSchema.shape

type Details = {
  fullName: string
  email: string
  password: string
  mobile: string
  birthday: string
  gender: Gender | ''
}

type Errors = Partial<Record<keyof Details | 'countryOfResidence', string>>

export function Register() {
  const t = useTranslations()
  const copy = t.onboarding
  const { locale } = useLocale()
  const navigate = useNavigate()

  const [step, setStep] = useState<1 | 2>(1)
  const [details, setDetails] = useState<Details>({
    fullName: '', email: '', password: '', mobile: '', birthday: '', gender: '',
  })
  const [country, setCountry] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [problem, setProblem] = useState<ProblemResponse | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (key: keyof Details) => (event: ChangeEvent<HTMLInputElement>) =>
    setDetails((current) => ({ ...current, [key]: event.target.value }))

  // People type spaces and dashes in phone numbers; E.164 has neither.
  const normalisedMobile = details.mobile.replace(/[\s\-()]/g, '')

  const toCountry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const found: Errors = {}
    if (!fields.fullName.safeParse(details.fullName).success) found.fullName = copy.errors.fullName
    if (!fields.email.safeParse(details.email).success) found.email = copy.errors.email
    if (!fields.password.safeParse(details.password).success) found.password = copy.errors.password
    if (!fields.mobile.safeParse(normalisedMobile).success) found.mobile = copy.errors.mobile
    if (!fields.birthday.safeParse(details.birthday).success) found.birthday = copy.errors.birthday
    if (!details.gender) found.gender = copy.errors.gender
    setErrors(found)
    if (Object.keys(found).length === 0) setStep(2)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!country) {
      setErrors({ countryOfResidence: copy.errors.country })
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      const request: RegisterRequest = {
        fullName: details.fullName.trim(),
        email: details.email.trim().toLowerCase(),
        password: details.password,
        mobile: normalisedMobile,
        birthday: details.birthday,
        gender: details.gender as Gender,
        countryOfResidence: country,
      }
      const sent = (await post('/onboarding/register', request)) as RegisterResponse
      // Router state, not the URL: a challenge id has no business in browser
      // history or a referrer header.
      navigate('/konsole/registrieren/mobil', { state: { challengeId: sent.challengeId, sentTo: sent.sentTo } })
    } catch (error) {
      if (error instanceof ApiError) setProblem(error.problem)
      else throw error
    } finally {
      setBusy(false)
    }
  }

  const countries = useMemo(() => {
    const collator = collatorFor(locale)
    const pinned = PINNED.map((code) => COUNTRIES.find((c) => c.code === code)).filter((c) => c !== undefined)
    const rest = COUNTRIES
      .filter((c) => !(PINNED as readonly string[]).includes(c.code))
      .sort((a, b) => collator.compare(a[locale], b[locale]))
    return { pinned, rest }
  }, [locale])

  const described = problem ? describeProblem(problem, locale) : null
  const footer = (
    <a href="/konsole/anmelden" className="text-navy underline underline-offset-2">{copy.haveAccount}</a>
  )

  if (step === 1) {
    return (
      <AuthCard title={copy.detailsTitle} subtitle={fill(copy.stepOf, { step: 1 })} footer={footer}>
        <p className="mt-2 text-[13px] text-text-muted">{copy.detailsSubtitle}</p>
        <form onSubmit={toCountry} className="mt-6 flex flex-col gap-4" noValidate>
          <Field label={copy.fullName} name="name" autoComplete="name"
            value={details.fullName} onChange={set('fullName')} error={errors.fullName} />
          <Field label={copy.email} type="email" name="email" autoComplete="email"
            value={details.email} onChange={set('email')} error={errors.email} />
          <Field label={copy.password} type="password" name="new-password" autoComplete="new-password"
            value={details.password} onChange={set('password')} error={errors.password} hint={copy.passwordHint} />
          <Field label={copy.mobile} type="tel" name="tel" autoComplete="tel" placeholder="+49 151 12345678"
            value={details.mobile} onChange={set('mobile')} error={errors.mobile} hint={copy.mobileHint} />
          <Field label={copy.birthday} type="date" name="bday" autoComplete="bday"
            value={details.birthday} onChange={set('birthday')} error={errors.birthday} />

          <fieldset className="flex flex-col gap-1.5" aria-describedby={errors.gender ? 'gender-error' : undefined}>
            <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              {copy.gender}
            </legend>
            <div className="flex flex-wrap gap-2">
              {GENDERS.map((gender) => (
                <label
                  key={gender}
                  className={`cursor-pointer rounded-card border px-3 py-1.5 text-[13px]
                    has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy
                    ${details.gender === gender ? 'border-navy bg-navy text-text-on-dark' : 'border-hairline bg-surface text-text'}`}
                >
                  <input
                    type="radio"
                    name="gender"
                    value={gender}
                    checked={details.gender === gender}
                    onChange={() => setDetails((current) => ({ ...current, gender }))}
                    className="sr-only"
                  />
                  {copy.genders[gender]}
                </label>
              ))}
            </div>
            {errors.gender && <p id="gender-error" className="text-[12px] text-tint-danger-fg">{errors.gender}</p>}
          </fieldset>

          <Button type="submit">{copy.continue}</Button>
        </form>
      </AuthCard>
    )
  }

  return (
    <AuthCard title={copy.countryTitle} subtitle={fill(copy.stepOf, { step: 2 })} footer={footer}>
      <p className="mt-2 text-[13px] text-text-muted">{copy.countrySubtitle}</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="country" className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {copy.country}
          </label>
          <select
            id="country"
            name="country"
            autoComplete="country"
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            aria-invalid={errors.countryOfResidence ? 'true' : undefined}
            aria-describedby={errors.countryOfResidence ? 'country-error' : undefined}
            className={`rounded-card border bg-surface px-3 py-2.5 text-[13px] text-text
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy
              ${errors.countryOfResidence ? 'border-tint-danger-fg' : 'border-hairline'}`}
          >
            <option value="">{copy.countryPlaceholder}</option>
            <optgroup label={copy.countryPinned}>
              {countries.pinned.map((c) => <option key={c.code} value={c.code}>{c[locale]}</option>)}
            </optgroup>
            <optgroup label={copy.countryAll}>
              {countries.rest.map((c) => <option key={c.code} value={c.code}>{c[locale]}</option>)}
            </optgroup>
          </select>
          {errors.countryOfResidence && (
            <p id="country-error" className="text-[12px] text-tint-danger-fg">{errors.countryOfResidence}</p>
          )}
        </div>

        {described && <FormMessage title={described.title}>{described.body}</FormMessage>}

        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setStep(1)}>{copy.back}</Button>
          <Button type="submit" disabled={busy} className="flex-1">
            {busy ? copy.submitting : copy.submit}
          </Button>
        </div>
      </form>
    </AuthCard>
  )
}

export default Register
