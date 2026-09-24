import { randomUUID } from 'node:crypto'
import { createMember, createAdmin, grant, bearerFor } from '../helpers/auth.ts'
import { dispatchDue } from '../../src/modules/push/application/dispatch.ts'
import type { Pool } from 'pg'
import type { GwcApp } from '../../src/app.ts'
import type {
  MessageOutcome, PushMessage, PushProvider, PushTransport, ReceiptOutcome,
} from '../../src/modules/push/providers.ts'

/**
 * Scaffolding for the push suites (feature 011).
 *
 * Devices and offers are inserted with SQL so a suite can put them in states
 * the API will not produce — a dead token, a locked member, an offer published
 * in the future. Those are the states the eligibility and visibility rules
 * exist for.
 */

/** A transport that records every call and answers from `respond`. */
export function stubTransport(
  respond: (provider: PushProvider, message: PushMessage) => MessageOutcome = () => ({
    status: 'sent', providerRef: `ticket-${randomUUID()}`,
  }),
) {
  const calls: { provider: PushProvider; messages: PushMessage[]; at: number }[] = []
  const receipts: Record<string, ReceiptOutcome> = {}
  const transport: PushTransport & { calls: typeof calls; receiptAnswers: typeof receipts; sentTokens(): string[] } = {
    calls,
    receiptAnswers: receipts,
    sentTokens: () => calls.flatMap((c) => c.messages.map((m) => m.token)),
    async send(provider, messages) {
      calls.push({ provider, messages: [...messages], at: Date.now() })
      return messages.map((m) => respond(provider, m))
    },
    async receipts(ids) {
      return Object.fromEntries(ids.filter((id) => receipts[id]).map((id) => [id, receipts[id]!]))
    },
  }
  return transport
}

/** Everything the push suites write, in dependency order. */
export async function resetPush(pool: Pool) {
  await pool.query(`
    TRUNCATE push_deliveries, push_notifications, push_test_recipients,
             member_push_preferences, push_devices RESTART IDENTITY CASCADE`)
  // Offers and organisations made by these suites. Organisations refuse
  // DELETE by trigger (they end, they are not removed), so their slugs are
  // unique per run and they are left behind; their offers and profiles go.
  await pool.query(`DELETE FROM offers WHERE organisation_id IN (SELECT id FROM organisations WHERE slug LIKE 'push-test-%')`)
  await pool.query(`DELETE FROM organisation_profiles WHERE organisation_id IN (SELECT id FROM organisations WHERE slug LIKE 'push-test-%')`)
}

let tokenCounter = 0

/** A member with one registered device. */
export async function memberWithDevice(
  app: GwcApp,
  {
    status = 'active', provider = 'expo', locale = 'de', enabled = true, disabledReason = null,
    handle = null,
  }: {
    status?: string; provider?: 'expo' | 'fcm'; locale?: 'de' | 'en'; enabled?: boolean
    disabledReason?: string | null; handle?: string | null
  } = {},
) {
  const member = await createMember(app.pg, { status, passwordHash: null, handle })
  const token = provider === 'expo'
    ? `ExponentPushToken[test-${++tokenCounter}-${randomUUID().slice(0, 8)}]`
    : `fcm-test-${++tokenCounter}-${randomUUID()}`
  const { rows } = await app.pg.query(
    `INSERT INTO push_devices (member_id, token, provider, platform, locale, enabled, disabled_reason)
     VALUES ($1, $2, $3, 'android', $4, $5, $6) RETURNING id`,
    [member.id, token, provider, locale, enabled, disabledReason],
  )
  return { id: String(member.id), deviceId: String(rows[0].id), token }
}

export async function addToTestList(pool: Pool, memberId: string) {
  await pool.query('INSERT INTO push_test_recipients (member_id) VALUES ($1) ON CONFLICT DO NOTHING', [memberId])
}

/** A staff member with every flag on `mass_messages`, and a bearer for them. */
export async function pushStaff(app: GwcApp, flags: true | Record<string, boolean> = true) {
  const admin = await createAdmin(app.pg)
  await grant(app.pg, String(admin.id), 'mass_messages', flags as never)
  app.permissions.invalidateAll?.()
  const { authorization } = await bearerFor(app, { accountId: String(admin.id), accountKind: 'admin' })
  return { id: String(admin.id), headers: { authorization } }
}

export const text = (suffix = '') => ({
  de: { title: `Titel ${suffix}`.trim(), body: `Nachricht ${suffix}`.trim() },
  en: { title: `Title ${suffix}`.trim(), body: `Message ${suffix}`.trim() },
})

/** POST a staff send. `path` is '' for a broadcast, '/preview' for a rehearsal. */
export function queue(
  app: GwcApp,
  headers: Record<string, string>,
  { path = '', clientRef = randomUUID(), body = text(), destination }: {
    path?: '' | '/preview'; clientRef?: string; body?: ReturnType<typeof text>
    destination?: { type: string; id?: string; label?: string }
  } = {},
) {
  return app.inject({
    method: 'POST',
    url: `/push/campaigns${path}`,
    headers,
    payload: { clientRef, ...body, ...(destination ? { destination } : {}) },
  })
}

/** Insert a notification directly, bypassing the API. */
export async function insertNotification(
  pool: Pool,
  { kind = 'broadcast', audience = kind === 'rehearsal' ? 'test' : 'broadcasts', notBefore = null }:
    { kind?: 'broadcast' | 'rehearsal'; audience?: string; notBefore?: Date | null } = {},
) {
  const { rows } = await pool.query(
    `INSERT INTO push_notifications (kind, audience, idempotency_key, title_de, body_de, title_en, body_en, not_before)
     VALUES ($1, $2, $3, 'Titel', 'Nachricht', 'Title', 'Message', COALESCE($4, now()))
     RETURNING id`,
    [kind, audience, randomUUID(), notBefore],
  )
  return String(rows[0].id)
}

/** Run the dispatcher directly: no pacing, no backoff wait. */
export const dispatch = (app: GwcApp, transport: PushTransport, extra: Record<string, unknown> = {}) =>
  dispatchDue(app, { transport, pauseMs: 0, backoff: () => 0, ...extra })

export async function deliveries(pool: Pool, notificationId: string) {
  const { rows } = await pool.query(
    `SELECT id, device_id, member_id, status, attempts, error_message, provider, provider_ref, locale
       FROM push_deliveries WHERE notification_id = $1 ORDER BY member_id`,
    [notificationId],
  )
  return rows
}

export async function notificationRow(pool: Pool, id: string) {
  const { rows } = await pool.query(
    `SELECT id, kind, status, title_de, title_en, body_de, body_en, not_before, finished_at, sent_at,
            total_success, total_failure
       FROM push_notifications WHERE id = $1`,
    [id],
  )
  return rows[0]
}

/** A merchant with a public face, and an offer from it in the given state. */
export async function merchantOffer(
  pool: Pool,
  {
    state = 'draft', validFrom = new Date(Date.now() - 86_400_000), validUntil = new Date(Date.now() + 30 * 86_400_000),
    title = 'Zwei Kaffee zum Preis von einem', displayName = 'Café Push', orgStatus = 'active',
  }: {
    state?: string; validFrom?: Date; validUntil?: Date; title?: string; displayName?: string; orgStatus?: string
  } = {},
) {
  const slug = `push-test-${randomUUID().slice(0, 12)}`
  const { rows: org } = await pool.query(
    `INSERT INTO organisations (kind, legal_name, slug, status, fee_tier)
     VALUES ('merchant', 'Push Test GmbH (legal)', $1, $2, 'tier-secret') RETURNING id`,
    [slug, orgStatus],
  )
  const organisationId = String(org[0].id)
  await pool.query(
    'INSERT INTO organisation_profiles (organisation_id, display_name) VALUES ($1, $2)',
    [organisationId, displayName],
  )
  const { rows } = await pool.query(
    `INSERT INTO offers (organisation_id, title, description, regular_price_cents, member_price_cents,
                         benefit_kind, benefit_value, valid_from, valid_until, conditions, state, published_at)
     VALUES ($1, $2, 'Beschreibung', 1000, 800, 'percentage', 20, $3, $4, 'Nur für Mitglieder',
             $5::offer_state, CASE WHEN $5 = 'published' THEN now() END)
     RETURNING id`,
    [organisationId, title, validFrom, validUntil, state],
  )
  return { id: String(rows[0].id), organisationId, slug }
}

export async function publish(pool: Pool, offerId: string) {
  await pool.query(`UPDATE offers SET state = 'published', published_at = now() WHERE id = $1`, [offerId])
}

/**
 * Wait for a notification to reach a final state.
 *
 * An accepted staff send kicks `push.deliver` itself, so a suite that then
 * calls `dispatch` may find the notification already leased by that run and
 * return having done nothing. This waits for whichever run got it.
 */
export async function settle(app: GwcApp, transport: PushTransport, id: string, timeoutMs = 5000) {
  const started = Date.now()
  for (;;) {
    await dispatch(app, transport)
    const { rows } = await app.pg.query('SELECT status FROM push_notifications WHERE id = $1', [id])
    if (['done', 'partial', 'failed', 'cancelled'].includes(rows[0]?.status)) return rows[0].status as string
    if (Date.now() - started > timeoutMs) throw new Error(`notification ${id} still ${rows[0]?.status}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
