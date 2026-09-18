/**
 * The five-flag permission matrix of BUSINESS_DESCRIPTION.md §11.
 *
 * §11 states the matrix "should be preserved as-is" and is "finer-grained than
 * a typical single role system" — a role enum cannot express "read but not
 * delete on events", so it is not used.
 *
 * The admin console renders its permission editor from these same lists, so a
 * module cannot exist in the UI but not the server (Constitution Principle I).
 */

/**
 * Principal audiences. A token for one can never satisfy a route for another.
 *
 * `merchant` and `partner` are commercial counterparties, not members and not
 * staff: the design document is emphatic that "Merchant ist kein Mitglied" and
 * that a corporate partnership "ist ausdrücklich keine Mitgliedschaft".
 * Modelling either as a member would put an external party in the member
 * directory; modelling them as staff would put them one grant edit from the
 * admin console.
 */
export const AUDIENCES = Object.freeze(['public', 'member', 'staff', 'merchant', 'partner'] as const)

/** Token audiences as they appear in the `aud` claim. */
export const TOKEN_AUDIENCES = Object.freeze(['member', 'admin', 'merchant', 'partner'] as const)

/** The five flags, per §11. */
export const FLAGS = Object.freeze(['read', 'write', 'edit', 'delete', 'status'] as const)

/**
 * Administrative modules, derived from §11's listed staff capabilities.
 *
 * `seo` is a module in its own right: §10.8 requires SEO fields to be
 * staff-editable under the same five flags as any other content attribute, so
 * adjusting how a paying partner's page presents in search is a grantable
 * privilege rather than a developer task.
 */
export const MODULES = Object.freeze([
  'members',
  'invitations',
  'events',
  'event_registrations',
  'partners',
  'partner_contracts',
  'membership_orders',
  'committees',
  'threads_moderation',
  'marketplace_moderation',
  'support_tickets',
  'newsletters',
  'mass_messages',
  'magazine',
  'pages',
  'seo',
  'admins',
  'settings',
  'jobs',
] as const)

/** Per-member permission flags — members have no module matrix. */
export const MEMBER_PERMISSIONS = Object.freeze(['marketplace_post', 'thread_moderate'] as const)

/** Member account states (§3.2). Only `active` may sign in. */
export const MEMBER_STATUSES = Object.freeze(['active', 'locked', 'inactive', 'ended'] as const)

/** An all-false grant. An absent permission row resolves to this: absence is denial. */
export const NO_GRANT: Readonly<Record<Flag, boolean>> = Object.freeze(
  Object.fromEntries(FLAGS.map((f) => [f, false])) as Record<Flag, boolean>,
)

/** Exact unions derived from the frozen lists above — one definition, both uses. */
export type Audience = (typeof AUDIENCES)[number]
export type TokenAudience = (typeof TOKEN_AUDIENCES)[number]
export type Flag = (typeof FLAGS)[number]
export type Module = (typeof MODULES)[number]
export type MemberPermission = (typeof MEMBER_PERMISSIONS)[number]
export type MemberStatus = (typeof MEMBER_STATUSES)[number]

/**
 * Runtime predicates, kept deliberately (feature 007, data-model.md §3).
 *
 * These are NOT redundant type checks: their inputs come from the database and
 * from tokens, which the compiler never saw. A predicate over a value TypeScript
 * did not type is the only check there is.
 */
export const isModule = (m: string): m is Module => (MODULES as readonly string[]).includes(m)
export const isFlag = (f: string): f is Flag => (FLAGS as readonly string[]).includes(f)
