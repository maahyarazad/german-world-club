import { LANGUAGES } from '@gwc/contracts/profiling'
import type { ProfilingAnswers, ProfilingStepId } from '@gwc/contracts/profiling'

import { fill } from '../../lib/format'
import type { Copy } from './steps'

/** The title a step is listed under on the review screen. */
export function stepTitle(step: Exclude<ProfilingStepId, 'review' | 'settling-info' | 'partner-settling-info'>, copy: Copy): string {
  const partner = step.startsWith('partner-')
  const base = partner ? step.slice('partner-'.length) : step
  const own: Record<string, string | undefined> = {
    settling: copy.settlingTitle, 'settling-place': copy.settlingPlaceTitle, 'settling-work': copy.workingDurationTitle, languages: copy.languagesTitle, income: copy.incomeTitle,
    qualification: copy.qualificationTitle, occupation: copy.occupationTitle, cities: copy.cityTitle,
    relationship: copy.relationshipTitle, kids: copy.kidsCountTitle, 'work-type': copy.desiredWorkTitle,
    'work-industry': copy.futureWorkSectorTitle, 'work-offering': copy.futureWorkOfferingTitle,
    'work-idea': copy.futureWorkIdeaTitle, 'work-activities': copy.productServiceTitle,
    'work-ready': copy.futureWorkReadyTitle, 'work-priorities': copy.futureWorkPrioritiesTitle,
  }
  const question = own[base] ?? ''
  return partner ? fill(copy.partnerTitle, { question }) : question
}

/** The saved answer for a step, as text for the review screen. */
export function stepSummary(step: Exclude<ProfilingStepId, 'review' | 'settling-info' | 'partner-settling-info'>, copy: Copy, answers: ProfilingAnswers): string {
  const partner = step.startsWith('partner-')
  const base = partner ? step.slice('partner-'.length) : step
  const s = partner ? answers.partner : answers
  const list = (values: readonly string[] | null | undefined, labels: Record<string, string>) =>
    (values ?? []).map((v) => labels[v] ?? v).join(', ')
  const one = (value: string | null | undefined, labels: Record<string, string>) => (value ? labels[value] ?? value : '')

  const text: Record<string, string> = {
    settling: one(s?.settlingStatus, copy.settlingOptions),
    'settling-place': [s?.settlingCity, s?.settlingCountry ? `(${s.settlingCountry})` : ''].filter(Boolean).join(' '),
    'settling-work': one(s?.settlingWorkDuration, copy.workingDurationOptions),
    languages: (s?.languages ?? []).map((code) => LANGUAGES.find((l) => l.code === code)?.en ?? code).join(', '),
    income: one(s?.yearlyIncomeRange, copy.incomeOptions),
    qualification: one(s?.qualificationLevel, copy.qualificationOptions),
    occupation: one(s?.occupation, copy.occupationOptions),
    cities: [answers.primaryCity, ...answers.secondaryCities].filter((c) => c != null).map((c) => `${c.city} (${c.country})`).join(', '),
    relationship: list(answers.relationshipStatus, copy.relationshipOptions),
    kids: answers.kids.map((k, i) => `${fill(copy.kidLabel, { n: i + 1 })}: ${copy.kidAgeOptions[k]}`).join(', '),
    'work-type': one(answers.desiredWorkType, copy.desiredWorkOptions),
    'work-industry': one(answers.futureWorkSector, copy.industryOptions),
    'work-offering': answers.futureWorkOffering ?? '',
    'work-idea': answers.futureWorkIdea ?? '',
    'work-ready': answers.futureWorkReady === null ? '' : answers.futureWorkReady ? copy.futureWorkReadyOptions.yes : copy.futureWorkReadyOptions.no,
    'work-activities': list(answers.futureWorkBusinessActivities, copy.businessActivityOptions),
    'work-priorities': list(answers.futureWorkPriorities, copy.futureWorkPrioritiesOptions),
  }
  return text[base] || copy.notAnswered
}
