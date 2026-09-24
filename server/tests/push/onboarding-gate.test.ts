import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { buildAuthApp, resetAuthTables, createMember, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { resetPush } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Only approved members register a phone (feature 011, FR-001, research R4).
 *
 * The app only asks for permission once the session is `member`, but the rule
 * is the server's: the device routes do not declare `onboarding: true`, so
 * 10-auth refuses an applicant on them whatever a tampered client sends.
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetPush(app.pg)
  await resetAuthTables(app.pg)
})

async function memberWithApplication(state: 'pending' | 'approved' | null) {
  const row = await createMember(app.pg, { passwordHash: null })
  if (state) {
    await app.pg.query(
      `INSERT INTO membership_applications (member_id, device_id, state, submitted_at, reviewed_at)
       VALUES ($1, 'device-x', $2::approval_state, now(), CASE WHEN $2 = 'approved' THEN now() END)`,
      [row.id, state],
    )
  }
  const { authorization } = await bearerFor(app, { accountId: String(row.id), accountKind: 'member' })
  return { authorization }
}

const register = (headers: Record<string, string>) => app.inject({
  method: 'POST', url: '/push/devices', headers,
  payload: { token: `ExponentPushToken[gate-${Math.random()}]`, provider: 'expo', locale: 'de' },
})

describe.skipIf(!hasDatabase)('the onboarding gate on device registration', () => {
  it('refuses an applicant whose application is pending', async () => {
    const response = await register(await memberWithApplication('pending'))
    expect(response.statusCode).toBe(403)
    expect(response.json().type).toBe(PROBLEMS.APPROVAL_PENDING.type)
    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM push_devices')
    expect(rows[0].n).toBe(0)
  })

  it('accepts an approved member and a member who never applied', async () => {
    expect((await register(await memberWithApplication('approved'))).statusCode).toBe(200)
    expect((await register(await memberWithApplication(null))).statusCode).toBe(200)
  })
})
