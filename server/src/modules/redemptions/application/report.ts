import type { RedemptionReport, RedemptionReportQuery } from '@gwc/contracts/redemptions'
import { query } from '../../../db/query.ts'
import { REFEREE_NAME } from '../../referrals/application/read-model.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * The redemption report (feature 035, research R11): one query shape for a
 * merchant's own redemptions and for the whole platform.
 *
 * **The scope is chosen by the route, never by the request.** A merchant's route
 * passes its own organisation from the session and the `organisationId` filter in
 * the query string is ignored for it, so no parameter can widen a merchant's
 * view to a competitor's. Only the platform route honours that filter, and only
 * staff with the `merchant_offers` grant reach it.
 *
 * Totals are over the WHOLE filtered set and are separate queries from the page
 * of rows, so a total is never "what fits on the screen". An admin's total for a
 * period is the sum of the merchants' totals for it, because both read the same
 * rows through this one function.
 *
 * Who redeemed is shown by a handle, "First L." or a staff or organisation
 * display name, with the kind of account — never an email, a number or an id of
 * the account. Rows hold `organisation_id` and `category_id` as they were when
 * redeemed, so a later change of category does not rewrite a past report.
 */

export type ReportScope = { organisationId: string } | 'platform'

const PAGE = 50
const DAYS = 366

type Cursor = { at: string; id: string }
const encode = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url')
const decode = (raw: string | undefined): Cursor | null => {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    return typeof parsed?.at === 'string' && typeof parsed?.id === 'string' ? parsed : null
  } catch {
    return null
  }
}

function filtersSql(scope: ReportScope, q: RedemptionReportQuery) {
  const where: string[] = []
  const params: unknown[] = []
  const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)) }

  if (scope !== 'platform') add('r.organisation_id = ?', scope.organisationId)
  else if (q.organisationId) add('r.organisation_id = ?', q.organisationId)
  if (q.offerId) add('r.offer_id = ?', q.offerId)
  if (q.categoryId) add('r.category_id = ?', q.categoryId)
  if (q.from) add('r.redeemed_at >= ?::timestamptz', q.from)
  if (q.to) add('r.redeemed_at < ?::timestamptz', q.to)
  return { where, params }
}

export async function redemptionReport(
  app: GwcApp,
  { scope, filters, signal }: { scope: ReportScope; filters: RedemptionReportQuery; signal?: AbortSignal },
): Promise<RedemptionReport> {
  const { where, params } = filtersSql(scope, filters)
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const [totals, byOffer, byDay] = await Promise.all([
    query(app.pg, `SELECT count(*)::int AS n, sum(r.estimated_saving_cents)::bigint AS saving FROM redemptions r ${clause}`, params, { signal }),
    query(
      app.pg,
      `SELECT r.offer_id, o.title, r.category_id, count(*)::int AS n
         FROM redemptions r JOIN offers o ON o.id = r.offer_id
         ${clause}
        GROUP BY r.offer_id, o.title, r.category_id
        ORDER BY n DESC, o.title, r.offer_id
        LIMIT 100`,
      params, { signal },
    ),
    query(
      app.pg,
      `SELECT to_char(date_trunc('day', r.redeemed_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, count(*)::int AS n
         FROM redemptions r
         ${clause}
        GROUP BY 1
        ORDER BY 1 DESC
        LIMIT ${DAYS}`,
      params, { signal },
    ),
  ])

  const after = decode(filters.cursor)
  const pageParams = [...params]
  let pageClause = clause
  if (after) {
    pageParams.push(after.at, after.id)
    const keyset = `(r.redeemed_at, r.id) < ($${pageParams.length - 1}::timestamptz, $${pageParams.length}::uuid)`
    pageClause = clause ? `${clause} AND ${keyset}` : `WHERE ${keyset}`
  }
  const { rows } = await query(
    app.pg,
    `SELECT r.id, r.reference, r.redeemed_at, r.offer_id, o.title, r.category_id, r.redeemer_kind, r.redeemer_id
       FROM redemptions r JOIN offers o ON o.id = r.offer_id
       ${pageClause}
      ORDER BY r.redeemed_at DESC, r.id DESC
      LIMIT ${PAGE + 1}`,
    pageParams, { signal },
  )
  const page = rows.slice(0, PAGE)

  // Names, resolved in one query for the page. The member branch reuses the one
  // selection of member name fields the referral routes use, so a column added
  // to `members` later cannot reach a report.
  const idsOf = (kinds: string[]) => page.filter((r) => kinds.includes(r.redeemer_kind)).map((r) => String(r.redeemer_id))
  const names = await query(
    app.pg,
    `SELECT 'member' AS kind, m.id, ${REFEREE_NAME} AS name FROM members m WHERE m.id = ANY($1::uuid[])
     UNION ALL
     SELECT 'admin', a.id, COALESCE(NULLIF(btrim(a.display_name), ''), '—') FROM admin_users a WHERE a.id = ANY($2::uuid[])
     UNION ALL
     SELECT o.kind::text, u.id, COALESCE(NULLIF(btrim(u.display_name), ''), '—')
       FROM organisation_users u JOIN organisations o ON o.id = u.organisation_id WHERE u.id = ANY($3::uuid[])`,
    [idsOf(['member']), idsOf(['admin']), idsOf(['merchant', 'partner'])],
    { signal },
  )
  const nameOf = new Map(names.rows.map((n) => [`${n.kind}:${n.id}`, String(n.name)]))

  const last = page[page.length - 1]
  const saving = totals.rows[0]!.saving
  return {
    totals: {
      count: Number(totals.rows[0]!.n),
      // Null, not zero, when nothing in the set had prices to estimate from.
      estimatedSavingCents: saving === null ? null : Number(saving),
    },
    byOffer: byOffer.rows.map((r) => ({ offerId: String(r.offer_id), title: String(r.title), categoryId: String(r.category_id), count: Number(r.n) })),
    byDay: byDay.rows.map((r) => ({ day: String(r.day), count: Number(r.n) })),
    rows: page.map((r) => ({
      id: String(r.id),
      reference: String(r.reference),
      redeemedAt: new Date(r.redeemed_at).toISOString(),
      offerId: String(r.offer_id),
      offerTitle: String(r.title),
      categoryId: String(r.category_id),
      redeemerKind: r.redeemer_kind,
      redeemerName: nameOf.get(`${r.redeemer_kind}:${r.redeemer_id}`) ?? '—',
    })),
    nextCursor: rows.length > PAGE && last ? encode({ at: new Date(last.redeemed_at).toISOString(), id: String(last.id) }) : null,
  }
}
