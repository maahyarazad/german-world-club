import { useCallback, useEffect, useState } from 'react'

import { profilingSteps, profilingMissing } from '@gwc/contracts/profiling'
import type { ProfilingStatus, ProfilingStepId } from '@gwc/contracts/profiling'
import { PROBLEMS } from '@gwc/contracts/errors'

import { get, patch, post, ApiError } from '../lib/api'
import AuthCard from '../auth/AuthCard'
import Button from '../components/ui/Button'
import { useLocale, useTranslations } from '../i18n/index'
import { StepView } from './profiling/steps'
import { stepTitle, stepSummary } from './profiling/summary'

type Answerable = Exclude<ProfilingStepId, 'review'>
/** Steps that hold an answer; the information screens do not appear on the review. */
type Reviewable = Exclude<Answerable, 'settling-info' | 'partner-settling-info'>
const isReviewable = (step: ProfilingStepId): step is Reviewable =>
  step !== 'review' && step !== 'settling-info' && step !== 'partner-settling-info'

/**
 * Onboarding Phase 2 (feature 013): the questionnaire an approved member sees
 * before `Application.tsx` lets them into the console. Rendered instead of
 * `enter()` whenever `GET /profiling/status` reports `completed: false`.
 *
 * Which questions apply, in what order, and which are still unanswered all
 * come from `profilingSteps` / `profilingMissing` in @gwc/contracts — the same
 * functions the server's submit check uses, so this screen never decides them
 * itself. Answers are saved as they are given and stay changeable (Back, or
 * "Change" on the review) until the member submits.
 */
export function Profiling({ onComplete }: { onComplete: () => void }) {
  const t = useTranslations()
  const copy = t.profiling
  const { locale } = useLocale()
  const [snapshot, setSnapshot] = useState<ProfilingStatus | null>(null)
  const [step, setStep] = useState<ProfilingStepId>('review')
  // True while a "Change" from the review is in progress: saving returns to the review.
  const [fromReview, setFromReview] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const loaded = await get('/profiling/status') as ProfilingStatus
      setSnapshot(loaded)
      setStep(profilingMissing(loaded.branch, loaded.answers)[0] ?? 'review')
    } catch (err) {
      console.error('Profiling.load', err instanceof ApiError ? err.problem : err)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = useCallback(async (body: object) => {
    if (!snapshot) return
    setBusy(true)
    try {
      const next = await patch('/profiling', body) as ProfilingStatus
      setSnapshot(next)
      if (fromReview) {
        // A change can make new questions apply (another Q7 path, say): answer those first.
        const missing = profilingMissing(next.branch, next.answers)
        setStep(missing[0] ?? 'review')
        if (missing.length === 0) setFromReview(false)
      } else {
        const steps = profilingSteps(next.branch, next.answers)
        setStep(steps[steps.indexOf(step) + 1] ?? 'review')
      }
    } catch (err) {
      console.error('Profiling.save', err instanceof ApiError ? err.problem : err)
    } finally {
      setBusy(false)
    }
  }, [snapshot, fromReview, step])

  const submit = useCallback(async () => {
    if (!snapshot) return
    setBusy(true)
    try {
      const done = await post('/profiling/submit') as ProfilingStatus
      setSnapshot(done)
      if (done.branch === 'germany') onComplete()
    } catch (err) {
      console.error('Profiling.submit', err instanceof ApiError ? err.problem : err)
      if (err instanceof ApiError && err.problem?.type === PROBLEMS.PROFILING_ANSWERS_MISSING.type) {
        // The server disagrees that everything is answered: take the member to what it is missing.
        await load()
      }
    } finally {
      setBusy(false)
    }
  }, [snapshot, onComplete, load])

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
          <Button onClick={onComplete}>{copy.next}</Button>
        </div>
      </AuthCard>
    )
  }

  const steps = profilingSteps(snapshot.branch, snapshot.answers)
  const answerable = steps.filter(isReviewable)

  if (step === 'review' || !steps.includes(step)) {
    const missing = profilingMissing(snapshot.branch, snapshot.answers)
    return (
      <AuthCard title={copy.reviewTitle} subtitle={copy.reviewSubtitle}>
        <dl className="mt-6 flex flex-col gap-3">
          {answerable.map((s) => (
            <div key={s} className="flex items-start justify-between gap-3 border-b border-hairline pb-2">
              <div className="min-w-0">
                <dt className="text-[11px] text-text-muted">{stepTitle(s, copy)}</dt>
                <dd className="text-[13px] text-text">{stepSummary(s, copy, snapshot.answers)}</dd>
              </div>
              <Button variant="quiet" disabled={busy} onClick={() => { setFromReview(true); setStep(s) }}>{copy.change}</Button>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex flex-col gap-2">
          <Button disabled={busy || missing.length > 0} onClick={submit}>{busy ? copy.submitting : copy.submit}</Button>
          <Button variant="quiet" disabled={busy || answerable.length === 0} onClick={() => setStep(answerable[answerable.length - 1] ?? 'review')}>{copy.back}</Button>
        </div>
      </AuthCard>
    )
  }

  const index = steps.indexOf(step)
  const back = fromReview
    ? () => { setFromReview(false); setStep('review') }
    : index > 0 ? () => setStep(steps[index - 1] ?? 'review') : null

  return (
    <StepView
      key={step}
      step={step as Answerable}
      ctx={{
        copy, locale, answers: snapshot.answers, busy, back,
        save: (body) => { void save(body) },
        // An information screen saves nothing; it just moves on (or back to the review).
        next: () => setStep(fromReview ? 'review' : steps[index + 1] ?? 'review'),
      }}
    />
  )
}

export default Profiling
