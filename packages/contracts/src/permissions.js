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

/** Principal audiences. A token for one can never satisfy a route for the other. */
export const AUDIENCES = Object.freeze(['public', 'member', 'staff'])

/** Token audiences as they appear in the `aud` claim. */
export const TOKEN_AUDIENCES = Object.freeze(['member', 'admin'])

/** The five flags, per §11. */
export const FLAGS = Object.freeze(['read', 'write', 'edit', 'delete', 'status'])

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
])

/** Per-member permission flags — members have no module matrix. */
export const MEMBER_PERMISSIONS = Object.freeze(['marketplace_post', 'thread_moderate'])

/** Member account states (§3.2). Only `active` may sign in. */
export const MEMBER_STATUSES = Object.freeze(['active', 'locked', 'inactive', 'ended'])

/** An all-false grant. An absent permission row resolves to this: absence is denial. */
export const NO_GRANT = Object.freeze(
  Object.fromEntries(FLAGS.map((f) => [f, false])),
)

export const isModule = (m) => MODULES.includes(m)
export const isFlag = (f) => FLAGS.includes(f)
