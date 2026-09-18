import { safeEmail, safeMobile, EMAIL_DOMAIN } from './faker.ts'
import { hashFor, LEGACY_MD5_HASH } from './hashing.ts'
import type { Pool } from 'pg'

/**
 * Members, spread deliberately across every state the product models.
 *
 * Uniform data hides exactly the defects a demo exists to surface. A member
 * table where every row is `active` proves nothing about how the other three
 * statuses render, and a population where every credential works proves nothing
 * about the four sign-in outcomes that carry no session.
 *
 * The shares below are a distribution, not a promise — `coverage.test.js`
 * asserts that every state is *present*, not that it holds a particular ratio,
 * because a ratio would be brittle for no gain.
 */

export const MEMBER_PASSWORD = 'demo-member'

/**
 * How the population is divided. Shares are normalised, so changing one does
 * not silently change the total.
 */
const SLICES = [
  { id: 'active', share: 55, status: 'active', confirmed: true, mobile: 'verified', role: 'active, full profile' },
  { id: 'unconfirmed', share: 8, status: 'active', confirmed: false, mobile: 'unverified', role: 'email unconfirmed' },
  { id: 'nomobile', share: 10, status: 'active', confirmed: true, mobile: 'none', role: 'active, no mobile' },
  { id: 'locked', share: 7, status: 'locked', confirmed: true, mobile: 'verified', role: 'locked' },
  { id: 'inactive', share: 7, status: 'inactive', confirmed: true, mobile: 'unverified', role: 'inactive' },
  { id: 'ended', share: 5, status: 'ended', confirmed: true, mobile: 'none', role: 'membership ended' },
  { id: 'legacy', share: 4, status: 'active', confirmed: true, mobile: 'verified', credential: 'legacy', role: 'legacy credential' },
  { id: 'nopassword', share: 2, status: 'active', confirmed: true, mobile: 'none', credential: 'none', role: 'no usable password' },
  { id: 'suppressed', share: 2, status: 'active', confirmed: true, mobile: 'verified', suppressed: true, role: 'email suppressed after bounces' },
]

/**
 * The first member of each slice gets a chosen address, not a generated one.
 *
 * The credentials table has to name a specific account per role, and an
 * address Faker produced would change the moment the pinned version moved —
 * which would make the printed table unstable for a reason nobody reading it
 * could see. Roles, emails and passwords are chosen; only the names behind
 * them are generated.
 */
export const REPRESENTATIVE = Object.freeze(
  Object.fromEntries(SLICES.map((s) => [s.id, safeEmail(`demo.${s.id}`, EMAIL_DOMAIN.member)])),
)

/**
 * Expand the shares into one entry per member, deterministically.
 *
 * Every slice gets at least one member however small `--members` is, which is
 * what keeps the state-coverage guarantee true when somebody seeds 20 rows to
 * check one screen.
 */
function plan(count) {
  const total = SLICES.reduce((sum, s) => sum + s.share, 0)
  const rows = []
  for (const slice of SLICES) {
    const n = Math.max(1, Math.round((slice.share / total) * count))
    for (let i = 0; i < n; i += 1) rows.push({ slice, first: i === 0 })
  }
  return rows
}

export async function seedMembers(pool: Pool, faker, options) {
  const usable = await hashFor(MEMBER_PASSWORD)
  const rows = plan(options.members)
  let created = 0

  for (const [index, { slice, first: isRepresentative }] of rows.entries()) {
    const first = faker.person.firstName()
    const last = faker.person.lastName()
    // The representative of each slice gets the chosen address the credentials
    // table names; the rest get generated ones, indexed because Faker repeats
    // names long before it repeats 200 times and a collision would silently
    // drop a member through ON CONFLICT.
    const email = isRepresentative
      ? REPRESENTATIVE[slice.id]
      : safeEmail(`${first}.${last}.${index}`, EMAIL_DOMAIN.member)

    const passwordHash =
      slice.credential === 'legacy' ? LEGACY_MD5_HASH
        : slice.credential === 'none' ? null
          : usable

    const mobile = slice.mobile === 'none' ? null : safeMobile(faker)
    const mobileVerified = slice.mobile === 'verified'

    const { rowCount } = await pool.query(
      `INSERT INTO members (email, password_hash, status, email_confirmed_at,
                            mobile, mobile_verified_at, display_name,
                            inactivity_exempt, email_bounce_count, email_suppressed,
                            permissions)
       VALUES ($1, $2, $3::member_status, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (email) DO NOTHING`,
      [
        email,
        passwordHash,
        // Set at INSERT rather than transitioned through: the status guard
        // governs UPDATEs, and a seeder that walked a member through
        // active → locked would be asserting a history that did not happen.
        slice.status,
        slice.confirmed ? faker.date.past({ years: 2 }) : null,
        mobile,
        mobileVerified ? faker.date.past({ years: 1 }) : null,
        `${first} ${last}`,
        // §3.2's "hidden" members, exempt from auto-deactivation.
        faker.datatype.boolean({ probability: 0.05 }),
        slice.suppressed ? faker.number.int({ min: 5, max: 12 }) : 0,
        slice.suppressed === true,
        JSON.stringify({
          marketplace_post: faker.datatype.boolean({ probability: 0.15 }),
          thread_moderate: faker.datatype.boolean({ probability: 0.05 }),
        }),
      ],
    )
    created += rowCount
  }

  return { members: created, skipped: rows.length - created }
}

/**
 * One credentials row per slice.
 *
 * `password: null` where the account is not meant to authenticate — those are
 * the interesting accounts and the table would be lying if it omitted them.
 */
export const MEMBER_ROLES = Object.freeze(
  SLICES.map((slice) => ({
    kind: 'member',
    role: slice.role,
    email: REPRESENTATIVE[slice.id],
    password: slice.credential ? null : MEMBER_PASSWORD,
    expect:
      slice.credential === 'legacy' ? 'password_reset_required'
        // A null hash is not a refusal: credentialState() treats "no usable
        // credential" the same way it treats a legacy one, and routes the
        // account to a password reset. The table has to say what the server
        // does, not what seemed likely.
        : slice.credential === 'none' ? 'password_reset_required'
          : slice.status === 'locked' ? 'locked'
            : slice.status === 'inactive' ? 'inactive'
              : slice.status === 'ended' ? 'ended'
                // An unconfirmed address is a 200 carrying no session: the
                // server routes it to profile completion (FR-011).
                : slice.confirmed === false ? 'profile_incomplete'
                  : 'authenticated',
  })),
)
