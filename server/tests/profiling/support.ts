import { createMember, bearerFor } from '../helpers/auth.ts'
import type { GwcApp } from '../../src/app.ts'

/** An approved applicant who has not started profiling, plus the bearer for it. */
export async function approvedMember(app: GwcApp, country: string) {
  const row = await createMember(app.pg, { passwordHash: null })
  await app.pg.query('UPDATE members SET country_of_residence = $2 WHERE id = $1', [row.id, country])
  await app.pg.query(
    `INSERT INTO membership_applications (member_id, device_id, state, submitted_at, reviewed_at)
     VALUES ($1, 'device-x', 'approved', now(), now())`,
    [row.id],
  )
  const { authorization } = await bearerFor(app, { accountId: String(row.id), accountKind: 'member' })
  return { memberId: String(row.id), authorization }
}

export const profilingCalls = (app: GwcApp) => ({
  status: (authorization: string) =>
    app.inject({ method: 'GET', url: '/profiling/status', headers: { authorization } }),
  patch: (authorization: string, payload: object) =>
    app.inject({ method: 'PATCH', url: '/profiling', headers: { authorization }, payload }),
  submit: (authorization: string) =>
    app.inject({ method: 'POST', url: '/profiling/submit', headers: { authorization } }),
})

/** Q1-Q5 for a German member (or a partner, minus Q6). */
export const germanQ1toQ5 = {
  settlingStatus: 'know_where', languages: ['en'], yearlyIncomeRange: '50k_to_100k',
  qualificationLevel: 'masters_degree', occupation: 'engineer',
} as const

/** The partner answers Q2-Q5 only: no settling question, no Q6, no Q7. */
export const partnerAnswers = {
  languages: ['en'], yearlyIncomeRange: '50k_to_100k', qualificationLevel: 'masters_degree', occupation: 'engineer',
} as const
