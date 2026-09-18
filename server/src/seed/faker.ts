import { Faker, de, en } from '@faker-js/faker'

/**
 * Re-exported so the generators can name the type without importing the
 * package. `tests/seed/determinism` forbids that import anywhere else, because
 * a module reaching for its own faker would not draw from the seeded instance
 * and the run would stop being reproducible. The rule is about the value; the
 * type has to come from somewhere, and this is the module that owns it.
 */
export type { Faker }

/**
 * The one generator every seed module draws from.
 *
 * Shared deliberately: two modules each constructing their own instance would
 * each be independently seeded, and the *combination* would stop being
 * reproducible even though each half looked fine.
 *
 * ── Why the version is pinned exactly ───────────────────────────────────────
 * Faker's output for a given seed is not stable across versions — new locale
 * data shifts every subsequent draw. `server/package.json` therefore pins an
 * exact version rather than a caret range. That pin is load-bearing for the
 * determinism this file promises, not hygiene: a range would silently change
 * every generated name on the next install, with no commit to point at.
 */

/** Constant, so two runs on two machines produce one database. */
export const SEED = 20260917

/**
 * Constant "now".
 *
 * Anything relative — "joined eight months ago", "expires next week" — would
 * otherwise move with the wall clock, and the second run would differ from the
 * first for reasons nothing in the source explains.
 */
export const REF_DATE = '2026-09-17T12:00:00.000Z'

/**
 * German first, English as the fallback for anything the German locale lacks.
 *
 * Not `de` alone: the club's whole premise is German speakers living abroad, and
 * an exclusively German population would misrepresent it. A locale array is how
 * Faker fills the gaps.
 */
export function createFaker({ random = false } = {}) {
  const faker = new Faker({ locale: [de, en] })
  if (!random) {
    faker.seed(SEED)
    faker.setDefaultRefDate(REF_DATE)
  }
  return faker
}

/**
 * An address that can never reach anybody.
 *
 * Faker's own `internet.email()` returns live domains — `Luiz60@hotmail.com`
 * was the first thing it produced in testing — and a seeded member with a real
 * address is one misconfigured mail integration away from sending a stranger a
 * password reset for an account they have never heard of. "The integration is
 * stubbed in development" is a property of today's configuration, not a control.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, in any DNS, ever.
 * A per-kind subdomain means an address says what it is at a glance, and means
 * a generated one can never shadow a fixed `seed:dev` account even if the local
 * parts collide.
 */
export function safeEmail(localPart: string, subdomain: string): string {
  const local = String(localPart)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '')
    .toLowerCase()
  return `${local}@${subdomain}.invalid`
}

/** The subdomain each identity kind's addresses live under. */
export const EMAIL_DOMAIN = Object.freeze({
  member: 'demo',
  staff: 'staff.demo',
  merchant: 'merchant.demo',
  partner: 'partner.demo',
})

/**
 * A number that can never ring.
 *
 * Ofcom reserves +44 7700 900000–900999 specifically so that fiction cannot
 * dial a real handset — it is the range television dramas use. There is no
 * equivalent reserved mobile range in the German numbering plan, and "currently
 * unassigned" is not "will never be assigned".
 *
 * A British number on a member living in Dubai reads slightly oddly. A real
 * handset receiving a real one-time code reads much worse.
 */
export function safeMobile(faker: Faker): string {
  const suffix = faker.number.int({ min: 0, max: 999 }).toString().padStart(3, '0')
  return `+447700900${suffix}`
}

/** True for anything safeEmail/safeMobile produced. Used by the safety suites. */
export const isNonRoutableEmail = (email: unknown): boolean => typeof email === 'string' && email.endsWith('.invalid')
export const isNonRoutableMobile = (mobile: unknown): boolean =>
  typeof mobile === 'string' && /^\+447700900\d{3}$/.test(mobile)
