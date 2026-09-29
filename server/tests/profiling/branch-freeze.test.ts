import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables, createMember, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => { await resetAuthTables(app.pg) })

async function approvedMember(country: string) {
  const row = await createMember(app.pg, { passwordHash: null })
  await app.pg.query('UPDATE members SET country_of_residence = $2 WHERE id = $1', [row.id, country])
  await app.pg.query(
    `INSERT INTO membership_applications (member_id, device_id, state, submitted_at, reviewed_at)
     VALUES ($1, 'device-x', 'approved', now(), now())`,
    [row.id],
  )
  const { authorization } = await bearerFor(app, { accountId: String(row.id), accountKind: 'member' })
  return { memberId: row.id, authorization }
}

const status = (headers: Record<string, string>) =>
  app.inject({ method: 'GET', url: '/profiling/status', headers })
const patch = (headers: Record<string, string>, payload: object) =>
  app.inject({ method: 'PATCH', url: '/profiling', headers, payload })

describe.skipIf(!hasDatabase)('branch freezing (research R3)', () => {
  it('freezes the branch at the first answer, ignoring a later country change', async () => {
    const { memberId, authorization } = await approvedMember('DE')
    await patch({ authorization }, { settlingStatus: 'know_where' })
    expect((await status({ authorization })).json().branch).toBe('germany')

    await app.pg.query(`UPDATE members SET country_of_residence = 'FR' WHERE id = $1`, [memberId])

    const after = (await status({ authorization })).json()
    expect(after.branch).toBe('germany')
    // Progress from before the country changed is not reset.
    expect(after.answers.settlingStatus).toBe('know_where')
  })

  it('computes the branch on the fly before any row exists, with no side effect', async () => {
    const { memberId, authorization } = await approvedMember('FR')
    expect((await status({ authorization })).json().branch).toBe('elsewhere')

    const { rows } = await app.pg.query('SELECT 1 FROM member_profiling WHERE member_id = $1', [memberId])
    expect(rows).toHaveLength(0)

    // Now DE — still elsewhere, because no row was created and the read is
    // recomputed from the CURRENT country each time until an answer freezes it.
    await app.pg.query(`UPDATE members SET country_of_residence = 'DE' WHERE id = $1`, [memberId])
    expect((await status({ authorization })).json().branch).toBe('germany')
  })
})
