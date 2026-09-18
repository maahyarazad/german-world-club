import { safeEmail, EMAIL_DOMAIN } from './faker.ts'
import { hashFor } from './hashing.ts'
import { MODULES, FLAGS } from '@gwc/contracts/permissions'
import type { Pool } from 'pg'
import type { Faker } from '@faker-js/faker'
import type { SeedOptions } from './options.ts'

/**
 * Staff, with varied partial permission matrices.
 *
 * An all-superadmin staff list proves nothing about the permission matrix the
 * whole platform is built on. The shapes below are chosen so that a reviewer
 * opening the console as each one sees a genuinely different sidebar — which is
 * the only way to judge whether capability-scoped navigation works.
 */

export const STAFF_PASSWORD = 'demo-staff'

/**
 * The named accounts, each demonstrating one thing.
 *
 * Emails are chosen rather than generated: the credentials table names them,
 * and a generated address would change the moment the pinned Faker version
 * moved.
 */
const SHAPES = [
  {
    id: 'super', role: 'superadmin', superadmin: true, grants: {},
    describes: 'Bypasses the module matrix entirely',
  },
  {
    id: 'seo', role: 'SEO only', grants: { seo: ['read', 'edit'] },
    describes: 'Reads and edits SEO metadata; nothing else',
  },
  {
    id: 'seoread', role: 'SEO, read-only', grants: { seo: ['read'] },
    describes: 'Sees SEO but cannot change it — the read/edit distinction',
  },
  {
    id: 'push', role: 'push campaigns', grants: { mass_messages: ['read', 'write', 'edit'] },
    describes: 'Composes and sends push campaigns',
  },
  {
    id: 'members', role: 'member administration', grants: { members: ['read', 'edit', 'status'] },
    describes: 'Administers members, including status changes',
  },
  {
    id: 'moderation', role: 'moderation', grants: { threads_moderation: ['read', 'edit', 'delete'], marketplace_moderation: ['read', 'status'] },
    describes: 'Moderates threads and the marketplace',
  },
  {
    id: 'events', role: 'events', grants: { events: ['read', 'write', 'edit', 'status'], event_registrations: ['read'] },
    describes: 'Runs events and reads their registrations',
  },
  {
    id: 'partners', role: 'partner contracts', grants: { partners: ['read', 'edit'], partner_contracts: ['read', 'edit', 'status'] },
    describes: 'Manages partner listings and their contracts',
  },
  {
    id: 'billing', role: 'billing, read-only', grants: { membership_orders: ['read'] },
    describes: 'Reads billing and nothing else',
  },
  {
    id: 'notyet', role: 'modules with no server surface', grants: { committees: ['read'], magazine: ['read', 'edit'] },
    // The account that makes the console's "noch nicht verfügbar" path real
    // rather than hypothetical: every module it holds is one the server cannot
    // serve yet.
    describes: 'Holds only modules the API does not serve yet',
  },
  {
    // A distinct matrix, not a copy of another account's. Two staff accounts
    // with identical grants demonstrate one shape between them, and the whole
    // point of this list is that each one shows a different sidebar.
    id: 'inactive', role: 'deactivated account', grants: { newsletters: ['read', 'write'] }, active: false,
    describes: 'A staff account that has been deactivated',
  },
  {
    id: 'broad', role: 'several modules', grants: { members: ['read'], events: ['read'], seo: ['read'], mass_messages: ['read'], support_tickets: ['read', 'edit'] },
    describes: 'Reads widely, edits one thing',
  },
]

export const STAFF_EMAIL = Object.freeze(
  Object.fromEntries(SHAPES.map((s) => [s.id, safeEmail(`demo.${s.id}`, EMAIL_DOMAIN.staff)])),
)

export async function seedStaff(pool: Pool, faker: Faker, options: SeedOptions) {
  const hash = await hashFor(STAFF_PASSWORD)
  const shapes = SHAPES.slice(0, Math.max(options.staff, SHAPES.length))
  let created = 0
  let grantRows = 0

  for (const shape of shapes) {
    const first = faker.person.firstName()
    const last = faker.person.lastName()

    const { rows } = await pool.query(
      `INSERT INTO admin_users (email, password_hash, is_admin, is_superadmin, is_active, display_name)
       VALUES ($1, $2, true, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [STAFF_EMAIL[shape.id], hash, shape.superadmin === true, shape.active !== false, `${first} ${last}`],
    )
    if (rows.length === 0) continue
    created += 1

    for (const [module, flags] of Object.entries(shape.grants)) {
      await pool.query(
        `INSERT INTO admin_permissions (admin_user_id, module, can_read, can_write, can_edit, can_delete, can_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (admin_user_id, module) DO NOTHING`,
        [
          rows[0].id, module,
          flags.includes('read'), flags.includes('write'), flags.includes('edit'),
          flags.includes('delete'), flags.includes('status'),
        ],
      )
      grantRows += 1
    }
  }

  return { admin_users: created, admin_permissions: grantRows }
}

/** Sanity: every module named above must be a real one. */
export const unknownModules = () =>
  SHAPES.flatMap((s) => Object.keys(s.grants)).filter((m) => !MODULES.includes(m))

export const unknownFlags = () =>
  SHAPES.flatMap((s) => Object.values(s.grants).flat()).filter((f) => !FLAGS.includes(f))

export const STAFF_ROLES = Object.freeze(
  SHAPES.map((shape) => ({
    kind: 'staff',
    role: shape.role,
    describes: shape.describes,
    email: STAFF_EMAIL[shape.id],
    password: STAFF_PASSWORD,
    expect: shape.active === false ? 'inactive' : 'authenticated',
  })),
)
