import { DASHBOARD_FIGURES } from '@gwc/contracts/admin'
import type { DashboardFigureKey, DashboardFiguresResponse } from '@gwc/contracts/admin'
import { query } from '../../../db/query.ts'
import type { Pool } from 'pg'

/**
 * The superadmin dashboard figures (feature 028, research R6).
 *
 * One `count(*)` per figure, each over the record the rest of the platform
 * treats as the truth for that thing, run in parallel. A figure that cannot be
 * computed is `null` and the rest still answer: a dashboard showing a zero it
 * could not verify would be a lie told in a larger typeface.
 *
 * "Active member" is a member whose status is active AND who is not an
 * applicant: `members.status` stays `active` while an application is pending or
 * denied (migration 020 gates applicants by the application row, not by status),
 * so counting status alone would put every applicant in the member total.
 */
const SQL: Record<DashboardFigureKey, string> = {
  activeMembers: `SELECT count(*)::int AS n FROM members m
                   WHERE m.status = 'active'
                     AND NOT EXISTS (SELECT 1 FROM membership_applications a
                                      WHERE a.member_id = m.id AND a.state <> 'approved')`,
  // What staff actually see in the queue: submitted (email confirmed) and undecided.
  waitingApplications: `SELECT count(*)::int AS n FROM membership_applications
                         WHERE state = 'pending' AND submitted_at IS NOT NULL`,
  activeMerchants: `SELECT count(*)::int AS n FROM organisations WHERE kind = 'merchant' AND status = 'active'`,
  activePartners: `SELECT count(*)::int AS n FROM organisations WHERE kind = 'partner' AND status = 'active'`,
  liveListings: `SELECT count(*)::int AS n FROM marketplace_listings WHERE state = 'active'`,
  // A request is the first message of one conversation per member per listing (008).
  listingRequests: `SELECT count(*)::int AS n FROM conversations
                     WHERE subject_type = 'listing' AND created_at > now() - interval '30 days'`,
  openReports: `SELECT ((SELECT count(*) FROM marketplace_reports WHERE state = 'open')
                       + (SELECT count(*) FROM thread_reports WHERE state = 'open'))::int AS n`,
  upcomingEvents: `SELECT count(*)::int AS n FROM events WHERE starts_at > now()`,
  activeStaff: `SELECT count(*)::int AS n FROM admin_users WHERE is_active = true`,
}

export async function computeFigures(
  pool: Pool,
  { signal, log = () => undefined }: { signal?: AbortSignal; log?: (key: string, error: unknown) => void } = {},
): Promise<DashboardFiguresResponse> {
  const results = await Promise.allSettled(
    DASHBOARD_FIGURES.map((key) => query<{ n: number }>(pool, SQL[key], [], { signal })),
  )
  return {
    asOf: new Date().toISOString(),
    figures: DASHBOARD_FIGURES.map((key, i) => {
      const result = results[i]!
      if (result.status === 'fulfilled') return { key, value: Number(result.value.rows[0]?.n ?? 0) }
      log(key, result.reason)
      return { key, value: null }
    }),
  }
}
