import { useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useNavigate } from 'react-router'

import { GENDERS, PRIMARY_LANGUAGES, RESIDENCE_SHORTCUTS, registerRequestSchema } from '@gwc/contracts/onboarding'
import type { Gender, PrimaryLanguage, RegisterRequest, RegisterResponse } from '@gwc/contracts/onboarding'
import { COUNTRIES } from '@gwc/contracts/countries'

import { post, ApiError } from '../lib/api'
import { describeProblem } from '../lib/problems'
import { collatorFor, fill } from '../lib/format'
import AuthCard from '../auth/AuthCard'
import Button from '../components/ui/Button'
import Field from '../components/ui/Field'
import MobileField from '../components/ui/MobileField'
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
  ageConfirmed: boolean
  primaryLanguage: PrimaryLanguage | ''
  fullName: string
  email: string
  password: string
  mobile: string
  birthday: string
  gender: Gender | ''
}

type Errors = Partial<Record<keyof Details | 'countryOfResidence' | 'registerRequestError', string>>

export function Register() {
  const t = useTranslations()
  const copy = t.onboarding
  const { locale } = useLocale()
  const navigate = useNavigate()

  const [step, setStep] = useState<1 | 2>(1)
  const [details, setDetails] = useState<Details>({
    ageConfirmed: false, primaryLanguage: '',
    fullName: '', email: '', password: '', mobile: '', birthday: '', gender: '',
  })
  // Germany, Austria and Switzerland are one click; "Others" opens the full list.
  const [choice, setChoice] = useState<'' | 'DE' | 'AT' | 'CH' | 'others'>('')
  const [otherCountry, setOtherCountry] = useState('')
  const country = choice === 'others' ? otherCountry : choice
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)

  const set = (key: 'fullName' | 'email' | 'password' | 'birthday') => (event: ChangeEvent<HTMLInputElement>) =>
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
    if (!details.ageConfirmed) found.ageConfirmed = copy.errors.ageConfirmed
    if (!details.primaryLanguage) found.primaryLanguage = copy.errors.primaryLanguage
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
    setErrors((current) => ({ ...current, registerRequestError: undefined }))
    try {
      const request: RegisterRequest = {
        fullName: details.fullName.trim(),
        email: details.email.trim().toLowerCase(),
        password: details.password,
        mobile: normalisedMobile,
        birthday: details.birthday,
        gender: details.gender as Gender,
        countryOfResidence: country,
        ageConfirmed: true,
        primaryLanguage: details.primaryLanguage as PrimaryLanguage,
      }
      const sent = (await post('/onboarding/register', request)) as RegisterResponse
      // Router state, not the URL: a challenge id has no business in browser
      // history or a referrer header.
      // The email and number travel along so step 3 can offer to correct them.
      navigate('/konsole/registrieren/mobil', {
        state: { challengeId: sent.challengeId, sentTo: sent.sentTo, email: request.email, mobile: request.mobile },
      })
    } catch (error) {
      console.error('Register.submit', error instanceof ApiError ? error.problem : error)
      // Shown as well as logged: a taken mobile number (the one case this step
      // can refuse) leaves the applicant stuck with no way to tell why.
      // Registration itself never says whether an email is taken (§6.1); that
      // stays true because `describeProblem` translates by type, not by detail.
      if (error instanceof ApiError) {
        const described = describeProblem(error.problem, locale)
        setErrors((current) => ({
          ...current,
          registerRequestError: described.body ? `${described.title}: ${described.body}` : described.title,
        }))
      }
    } finally {
      setBusy(false)
    }
  }

  const countries = useMemo(() => {
    const collator = collatorFor(locale)
    const shortcuts = RESIDENCE_SHORTCUTS.map((code) => COUNTRIES.find((c) => c.code === code)).filter((c) => c !== undefined)
    // "Others" is everything except the three shortcuts.
    const rest = COUNTRIES
      .filter((c) => !(RESIDENCE_SHORTCUTS as readonly string[]).includes(c.code))
      .sort((a, b) => collator.compare(a[locale], b[locale]))
    return { shortcuts, rest }
  }, [locale])

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
          <MobileField
            value={details.mobile} error={errors.mobile} hint={copy.mobileHint}
            onChange={(mobile) => setDetails((current) => ({ ...current, mobile }))}
          />
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

          <fieldset className="flex flex-col gap-1.5" aria-describedby={errors.primaryLanguage ? 'language-error' : undefined}>
            <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              {copy.primaryLanguage}
            </legend>
            <div className="flex flex-wrap gap-2">
              {PRIMARY_LANGUAGES.map((language) => (
                <label
                  key={language}
                  className={`cursor-pointer rounded-card border px-3 py-1.5 text-[13px]
                    has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy
                    ${details.primaryLanguage === language ? 'border-navy bg-navy text-text-on-dark' : 'border-hairline bg-surface text-text'}`}
                >
                  <input
                    type="radio" name="primary-language" value={language} className="sr-only"
                    checked={details.primaryLanguage === language}
                    onChange={() => setDetails((current) => ({ ...current, primaryLanguage: language }))}
                  />
                  {copy.primaryLanguages[language]}
                </label>
              ))}
            </div>
            {errors.primaryLanguage && <p id="language-error" className="text-[12px] text-tint-danger-fg">{errors.primaryLanguage}</p>}
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label className="flex items-start gap-2 text-[13px] text-text">
              <input
                type="checkbox" name="age-confirmed" className="mt-0.5"
                checked={details.ageConfirmed}
                aria-invalid={errors.ageConfirmed ? 'true' : undefined}
                onChange={(event) => setDetails((current) => ({ ...current, ageConfirmed: event.target.checked }))}
              />
              <span>{copy.ageConfirm}</span>
            </label>
            {errors.ageConfirmed && <p className="text-[12px] text-tint-danger-fg">{errors.ageConfirmed}</p>}
          </div>

          <Button type="submit">{copy.continue}</Button>
        </form>
      </AuthCard>
    )
  }

  return (
    <AuthCard title={copy.countryTitle} subtitle={fill(copy.stepOf, { step: 2 })} footer={footer}>
      <p className="mt-2 text-[13px] text-text-muted">{copy.countrySubtitle}</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        <fieldset className="flex flex-col gap-1.5" aria-describedby={errors.countryOfResidence ? 'country-error' : undefined}>
          <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {copy.country}
          </legend>
          <div className="flex flex-wrap gap-2">
            {[...countries.shortcuts.map((c) => ({ value: c.code, label: c[locale] })), { value: 'others', label: copy.countryOthers }].map((option) => (
              <label
                key={option.value}
                className={`cursor-pointer rounded-card border px-3 py-1.5 text-[13px]
                  has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy
                  ${choice === option.value ? 'border-navy bg-navy text-text-on-dark' : 'border-hairline bg-surface text-text'}`}
              >
                <input
                  type="radio" name="country-choice" value={option.value} className="sr-only"
                  checked={choice === option.value}
                  onChange={() => setChoice(option.value as typeof choice)}
                />
                {option.label}
              </label>
            ))}
          </div>
          {choice === 'others' && (
            <select
              id="country-other" name="country" autoComplete="country" aria-label={copy.countryOther}
              value={otherCountry} onChange={(event) => setOtherCountry(event.target.value)}
              className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] text-text
                focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
            >
              <option value="">{copy.countryPlaceholder}</option>
              {countries.rest.map((c) => <option key={c.code} value={c.code}>{c[locale]}</option>)}
            </select>
          )}
          {errors.countryOfResidence && (
            <p id="country-error" className="text-[12px] text-tint-danger-fg">{errors.countryOfResidence}</p>
          )}
        </fieldset>

        {errors.registerRequestError && (
          <p role="alert" className="text-[12px] text-tint-danger-fg">{errors.registerRequestError}</p>
        )}

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
