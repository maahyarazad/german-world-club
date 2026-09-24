import type { Pool } from 'pg'
import type { Faker } from './faker.ts'
import type { SeedOptions } from './options.ts'
/**
 * Push, jobs, devices — and history, under one rule.
 *
 * ── The consistent-history rule ─────────────────────────────────────────────
 * `audit_log`, `job_runs`, `push_deliveries` and `counters` record
 * what *happened*. Filling them with invented events would make the audit log —
 * the one table nobody may edit, append-only by revoked grant — the one table
 * full of fiction, and would leave job runs describing jobs that never ran.
 *
 * So: **an entry only where a seeded fact implies one, at that fact's own
 * timestamp.** A member whose status is `locked` gets the entry that locked
 * them, stamped `status_changed_at`. A campaign that exists gets the delivery
 * receipts its own totals imply. Nothing is invented; the history and the state
 * agree because the history is derived from the state.
 */

export async function seedOperations(pool: Pool, faker: Faker, options: SeedOptions) {
  // Idempotency, for the same reason offers and events need it: devices and
  // job runs have no natural key the seeder controls, so ON CONFLICT has
  // nothing to catch. Demo devices are this seeder's first write.
  const { rows: seeded } = await pool.query(
    `SELECT count(*)::int AS n
       FROM push_devices d JOIN members m ON m.id = d.member_id
      WHERE m.email LIKE '%@demo.invalid'`,
  )
  const counts = {
    push_devices: 0, push_test_recipients: 0,
    job_definitions: 0, device_approvals: 0,
    audit_log: 0, job_runs: 0,
  }
  if (seeded[0].n > 0) return counts

  const { rows: members } = await pool.query(
    `SELECT id, status, status_changed_at, email_suppressed, email_bounce_count
       FROM members WHERE email LIKE '%@demo.invalid' ORDER BY email`,
  )
  const { rows: staff } = await pool.query(
    `SELECT id FROM admin_users WHERE email LIKE '%@staff.demo.invalid' ORDER BY email LIMIT 1`,
  )
  const actor = staff[0]?.id ?? null

  // ---- Devices -------------------------------------------------------------
  for (const member of members.slice(0, Math.floor(members.length * 0.6))) {
    const { rowCount } = await pool.query(
      `INSERT INTO push_devices (member_id, token, provider, platform, locale, enabled, last_seen_at)
       VALUES ($1, $2, $3::push_provider, $4::push_platform, $5, $6, $7)
       ON CONFLICT (token) DO NOTHING`,
      [
        member.id,
        `ExponentPushToken[demo-${member.id.slice(0, 18)}]`,
        faker.helpers.arrayElement(['expo', 'expo', 'fcm']),
        faker.helpers.arrayElement(['ios', 'android', 'web']),
        faker.helpers.arrayElement(['de', 'de', 'en']),
        faker.datatype.boolean({ probability: 0.85 }),
        faker.date.recent({ days: 30 }),
      ],
    )
    counts.push_devices += rowCount
  }

  // Device approvals — §6.2's per-device gate, in all three states.
  for (const [index, member] of members.slice(0, 30).entries()) {
    const state = index % 7 === 0 ? 'pending' : index % 11 === 0 ? 'denied' : 'approved'
    const { rowCount } = await pool.query(
      `INSERT INTO device_approvals (member_id, device_id, state, denial_reason, reviewed_by, reviewed_at)
       VALUES ($1, $2, $3::approval_state, $4, $5, $6)
       ON CONFLICT (member_id, device_id) DO NOTHING`,
      [
        member.id, `demo-device-${index}`, state,
        state === 'denied' ? 'Gerät konnte nicht verifiziert werden' : null,
        state === 'pending' ? null : actor,
        state === 'pending' ? null : faker.date.recent({ days: 60 }),
      ],
    )
    counts.device_approvals += rowCount
  }

  // ---- Test recipients -----------------------------------------------------
  for (const member of members.slice(0, 3)) {
    const { rowCount } = await pool.query(
      `INSERT INTO push_test_recipients (member_id, added_by)
       VALUES ($1, $2) ON CONFLICT (member_id) DO NOTHING`,
      [member.id, actor],
    )
    counts.push_test_recipients += rowCount
  }

  // ---- No notifications, and no deliveries ---------------------------------
  //
  // Feature 011 made push an outbox: `push_notifications` rows are queued
  // work, and a `push_deliveries` row says a provider was asked to reach a
  // phone. A seeded one would be a send that never happened — and a *queued*
  // one would actually be sent by the next `push.deliver` tick to whatever
  // real devices a development database holds. So the history rule gives the
  // answer: no seeded fact implies a send, so there is none.

  // ---- Jobs, and runs that correspond to them ------------------------------
  const JOBS = [
    ['deactivate-inactive-members', '0 3 * * *', 'Setzt Mitglieder ohne Aktivität auf inaktiv (§3.2)'],
    ['expire-offers', '0 * * * *', 'Entfernt abgelaufene Angebote aus aktiven Flächen'],
    ['send-event-reminders', '0 9 * * *', 'Erinnert angemeldete Mitglieder an bevorstehende Events'],
    ['prune-sessions', '*/15 * * * *', 'Entfernt abgelaufene Sitzungen'],
  ]
  for (const [name, schedule, description] of JOBS) {
    const { rowCount } = await pool.query(
      `INSERT INTO job_definitions (name, schedule, enabled, description, last_run_at)
       VALUES ($1, $2, true, $3, $4)
       ON CONFLICT (name) DO NOTHING`,
      [name, schedule, description, faker.date.recent({ days: 2 })],
    )
    counts.job_definitions += rowCount

    // A run per definition that exists, never for a job that does not.
    for (let i = 0; i < 3; i += 1) {
      const startedAt = faker.date.recent({ days: 7 })
      const failed = i === 2 && name === 'prune-sessions'
      const { rowCount: runs } = await pool.query(
        `INSERT INTO job_runs (job_name, started_at, finished_at, outcome, error, items_processed)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [
          name, startedAt, new Date(startedAt.getTime() + faker.number.int({ min: 40, max: 9000 })),
          // The vocabulary the table's own CHECK allows: success | failure |
          // skipped. Not 'ok'/'failed' — a seeder inventing its own words for a
          // constrained column is a seeder writing rows the app cannot read.
          failed ? 'failure' : 'success',
          failed ? 'connection reset by peer' : null,
          faker.number.int({ min: 0, max: 400 }),
        ],
      )
      counts.job_runs += runs
    }
  }

  // ---- The audit log, derived from state ----------------------------------
  //
  // One entry per member whose status is not 'active', stamped with that
  // member's own status_changed_at. The log and the table therefore agree,
  // which is the only way seeded history is worth having.
  //
  // Written entirely in SQL, selecting `status_changed_at` from the member row
  // rather than reading it into JavaScript and writing it back. A timestamptz
  // has microsecond precision and a JS Date has milliseconds, so the round trip
  // silently truncates — and the entry would then disagree with the fact it
  // describes by a few microseconds, which is exactly the kind of near-miss
  // that makes seeded history untrustworthy.
  const { rowCount: auditRows } = await pool.query(
    `INSERT INTO audit_log (occurred_at, request_id, actor_id, actor_kind, action,
                            target_type, target_id, outcome, detail)
     SELECT m.status_changed_at,
            'seed-' || left(m.id::text, 12),
            $1, 'admin',
            CASE m.status
              WHEN 'locked'   THEN 'member_locked'
              WHEN 'inactive' THEN 'member_deactivated'
              ELSE 'membership_ended'
            END,
            'member', m.id, 'allowed',
            jsonb_build_object('seeded', true, 'reason', 'demo data')
       FROM members m
      WHERE m.email LIKE '%@demo.invalid'
        AND m.status <> 'active'
        AND NOT EXISTS (
          SELECT 1 FROM audit_log a
           WHERE a.target_type = 'member' AND a.target_id = m.id)`,
    [actor],
  )
  counts.audit_log += auditRows

  return counts
}
