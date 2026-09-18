import { safeEmail, EMAIL_DOMAIN } from './faker.ts'
import { hashFor } from './hashing.ts'

/**
 * Club Merchants and Corporate Club Partners, with the people who sign in for
 * them.
 *
 * The fee bands are the ones the design document fixes — merchants by location
 * count, partners by employee count. They are recorded as contract facts, never
 * computed, and this feature introduces no new pricing logic.
 */

export const MERCHANT_PASSWORD = 'demo-merchant'
export const PARTNER_PASSWORD = 'demo-partner'

/** §8 of the design document: annual fee by number of locations. */
const MERCHANT_BANDS = [
  { max: 1, fee: 'US$500' }, { max: 3, fee: 'US$1.000' }, { max: 10, fee: 'US$2.500' },
  { max: 25, fee: 'US$5.000' }, { max: 50, fee: 'US$8.500' }, { max: 100, fee: 'US$15.000' },
]

/** §9: annual fee by number of employees. */
const PARTNER_BANDS = [
  { max: 100, fee: 'US$7.500' }, { max: 250, fee: 'US$12.500' }, { max: 500, fee: 'US$20.000' },
  { max: 1000, fee: 'US$30.000' }, { max: 2500, fee: 'US$45.000' },
]

const bandFor = (bands, count) => (bands.find((b) => count <= b.max) ?? bands.at(-1)).fee

/**
 * The organisations the credentials table names, with chosen slugs and emails.
 *
 * One of each kind is deliberately not `active`: a suspended merchant is how
 * you see that an offer's visibility depends on more than the offer.
 */
const NAMED = [
  { id: 'alpine', kind: 'merchant', slug: 'alpine-hiking', name: 'Alpine Hiking Co.', status: 'active' },
  { id: 'suspended', kind: 'merchant', slug: 'hafen-bistro', name: 'Hafen Bistro GmbH', status: 'suspended' },
  { id: 'siemens', kind: 'partner', slug: 'siemens-schweiz', name: 'Siemens Schweiz AG', status: 'active' },
  { id: 'pending', kind: 'partner', slug: 'nordwind-gruppe', name: 'Nordwind Gruppe', status: 'pending' },
]

export const ORG_EMAIL = Object.freeze({
  alpine: safeEmail('demo.owner.alpine', EMAIL_DOMAIN.merchant),
  alpineManager: safeEmail('demo.manager.alpine', EMAIL_DOMAIN.merchant),
  suspended: safeEmail('demo.owner.hafen', EMAIL_DOMAIN.merchant),
  siemens: safeEmail('demo.owner.siemens', EMAIL_DOMAIN.partner),
  siemensManager: safeEmail('demo.manager.siemens', EMAIL_DOMAIN.partner),
  pending: safeEmail('demo.owner.nordwind', EMAIL_DOMAIN.partner),
})

export async function seedOrganisations(pool, faker, options) {
  const merchantHash = await hashFor(MERCHANT_PASSWORD)
  const partnerHash = await hashFor(PARTNER_PASSWORD)

  let orgs = 0
  let people = 0

  /** Insert one organisation and its people. Returns the id, or null if present. */
  const upsert = async ({ kind, slug, name, status, locations, employees, owners }) => {
    const { rows } = await pool.query(
      `INSERT INTO organisations (kind, legal_name, slug, status, status_changed_at,
                                  contract_start, contract_end, fee_tier,
                                  location_count, employee_count)
       VALUES ($1::organisation_kind, $2, $3, $4::organisation_status, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
      [
        kind, name, slug, status, faker.date.past({ years: 1 }),
        faker.date.past({ years: 2 }), faker.date.future({ years: 1 }),
        kind === 'merchant' ? bandFor(MERCHANT_BANDS, locations) : bandFor(PARTNER_BANDS, employees),
        kind === 'merchant' ? locations : null,
        kind === 'partner' ? employees : null,
      ],
    )
    if (rows.length === 0) return null
    orgs += 1

    for (const person of owners) {
      const { rowCount } = await pool.query(
        `INSERT INTO organisation_users (organisation_id, email, password_hash, role, status, display_name)
         VALUES ($1, $2, $3, $4::organisation_role, 'active'::member_status, $5)
         ON CONFLICT (organisation_id, email) DO NOTHING`,
        [
          rows[0].id, person.email,
          kind === 'merchant' ? merchantHash : partnerHash,
          person.role, person.name,
        ],
      )
      people += rowCount
    }
    return rows[0].id
  }

  // The named organisations first, so the credentials table always has them
  // even when --merchants or --partners is small.
  const ids = {}
  ids.alpine = await upsert({
    kind: 'merchant', slug: 'alpine-hiking', name: 'Alpine Hiking Co.', status: 'active',
    locations: 3,
    owners: [
      { email: ORG_EMAIL.alpine, role: 'owner', name: faker.person.fullName() },
      { email: ORG_EMAIL.alpineManager, role: 'manager', name: faker.person.fullName() },
    ],
  })
  ids.suspended = await upsert({
    kind: 'merchant', slug: 'hafen-bistro', name: 'Hafen Bistro GmbH', status: 'suspended',
    locations: 1,
    owners: [{ email: ORG_EMAIL.suspended, role: 'owner', name: faker.person.fullName() }],
  })
  ids.siemens = await upsert({
    kind: 'partner', slug: 'siemens-schweiz', name: 'Siemens Schweiz AG', status: 'active',
    employees: 1248,
    owners: [
      { email: ORG_EMAIL.siemens, role: 'owner', name: faker.person.fullName() },
      { email: ORG_EMAIL.siemensManager, role: 'manager', name: faker.person.fullName() },
    ],
  })
  ids.pending = await upsert({
    kind: 'partner', slug: 'nordwind-gruppe', name: 'Nordwind Gruppe', status: 'pending',
    employees: 180,
    owners: [{ email: ORG_EMAIL.pending, role: 'owner', name: faker.person.fullName() }],
  })

  // Then the generated remainder, to fill a list.
  const extraMerchants = Math.max(0, options.merchants - 2)
  const extraPartners = Math.max(0, options.partners - 2)

  for (let i = 0; i < extraMerchants; i += 1) {
    const name = `${faker.company.name()} ${faker.helpers.arrayElement(['GmbH', 'AG', 'e.K.'])}`
    const slug = `m-${faker.helpers.slugify(name).toLowerCase()}-${i}`
    const locations = faker.number.int({ min: 1, max: 40 })
    await upsert({
      kind: 'merchant', slug, name, locations,
      status: faker.helpers.arrayElement(['active', 'active', 'active', 'pending']),
      owners: [{
        email: safeEmail(`inhaber.${slug}`, EMAIL_DOMAIN.merchant),
        role: 'owner', name: faker.person.fullName(),
      }],
    })
  }

  for (let i = 0; i < extraPartners; i += 1) {
    const name = `${faker.company.name()} ${faker.helpers.arrayElement(['AG', 'SE', 'Holding'])}`
    const slug = `p-${faker.helpers.slugify(name).toLowerCase()}-${i}`
    const employees = faker.number.int({ min: 50, max: 2400 })
    await upsert({
      kind: 'partner', slug, name, employees,
      status: faker.helpers.arrayElement(['active', 'active', 'pending']),
      owners: [{
        email: safeEmail(`hr.${slug}`, EMAIL_DOMAIN.partner),
        role: 'owner', name: faker.person.fullName(),
      }],
    })
  }

  return { organisations: orgs, organisation_users: people }
}

export const ORGANISATION_ROLES = Object.freeze([
  { kind: 'merchant', role: 'owner, active organisation', email: ORG_EMAIL.alpine, password: MERCHANT_PASSWORD, expect: 'authenticated', describes: 'Runs Alpine Hiking Co. — offers, locations, analytics' },
  { kind: 'merchant', role: 'manager, active organisation', email: ORG_EMAIL.alpineManager, password: MERCHANT_PASSWORD, expect: 'authenticated', describes: 'Manages offers but does not own the account' },
  { kind: 'merchant', role: 'owner, suspended organisation', email: ORG_EMAIL.suspended, password: MERCHANT_PASSWORD, expect: 'inactive', describes: 'Refused: the organisation is suspended' },
  { kind: 'partner', role: 'owner, active organisation', email: ORG_EMAIL.siemens, password: PARTNER_PASSWORD, expect: 'authenticated', describes: 'Runs Siemens Schweiz — entitlements, vacancies, PR' },
  { kind: 'partner', role: 'manager, active organisation', email: ORG_EMAIL.siemensManager, password: PARTNER_PASSWORD, expect: 'authenticated', describes: 'Manages partner content' },
  { kind: 'partner', role: 'owner, pending organisation', email: ORG_EMAIL.pending, password: PARTNER_PASSWORD, expect: 'authenticated', describes: 'Signs in; the contract is not yet active' },
])
