import { z } from 'zod'
import { FLAGS, MODULES } from './permissions.ts'

/**
 * The superadmin dashboard figures and the administrator list (feature 028,
 * contracts/admin-api.md).
 *
 * "Which change is allowed, and why not" is computed once on the server and sent
 * as codes: the page only disables a control and shows the reason's tooltip, so
 * it cannot disagree with the refusal the server would give (constitution I).
 * The server sends reason codes, never translated sentences.
 */

/** The nine figures, in the order the dashboard shows them. */
export const DASHBOARD_FIGURES = Object.freeze([
  'activeMembers',
  'waitingApplications',
  'activeMerchants',
  'activePartners',
  'liveListings',
  'listingRequests',
  'openReports',
  'upcomingEvents',
  'activeStaff',
] as const)

export type DashboardFigureKey = (typeof DASHBOARD_FIGURES)[number]

export const dashboardFiguresResponseSchema = z.object({
  asOf: z.string(),
  figures: z.array(z.object({
    key: z.enum(DASHBOARD_FIGURES),
    /** `null` means this one figure could not be computed — never shown as zero. */
    value: z.number().int().nullable(),
  })),
})

/** Derived from `is_superadmin` / `is_admin`; there is no role table (§11 keeps the matrix as is). */
export const ADMIN_ROLES = Object.freeze(['superadmin', 'administrator', 'staff'] as const)
export type AdminRole = (typeof ADMIN_ROLES)[number]

/** Why a change is not allowed. */
export const CHANGE_BLOCKERS = Object.freeze(['self', 'last-superadmin', 'superadmin-required'] as const)
export type ChangeBlocker = (typeof CHANGE_BLOCKERS)[number]

export const ADMIN_ACTIONS = Object.freeze(['changeRole', 'setActive', 'editGrants'] as const)
export type AdminAction = (typeof ADMIN_ACTIONS)[number]

const constraintSchema = z.union([
  z.object({ allowed: z.literal(true) }),
  z.object({ allowed: z.literal(false), reason: z.enum(CHANGE_BLOCKERS) }),
])
export type ChangeConstraint = z.infer<typeof constraintSchema>

const flagsSchema = z.object(Object.fromEntries(FLAGS.map((flag) => [flag, z.boolean()])))

/** Only areas where at least one flag is true: absence is denial, as everywhere else. */
export const adminGrantsSchema = z.partialRecord(z.enum(MODULES), flagsSchema)

export const adminAccountSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string().nullable(),
  role: z.enum(ADMIN_ROLES),
  isActive: z.boolean(),
  /** The account's `updated_at`; a PATCH must echo it, so a stale edit is refused. */
  version: z.string(),
  /** True for the caller's own row. */
  current: z.boolean(),
  grants: adminGrantsSchema,
  constraints: z.object({
    changeRole: constraintSchema,
    setActive: constraintSchema,
    editGrants: constraintSchema,
  }),
})

export const adminListResponseSchema = z.object({ admins: z.array(adminAccountSchema) })

export const updateAdminRequestSchema = z.object({
  version: z.string().min(1).max(64),
  role: z.enum(ADMIN_ROLES).optional(),
  isActive: z.boolean().optional(),
  /** Replaces the five flags of each named area; an area with all five false is removed. */
  grants: adminGrantsSchema.optional(),
}).refine(
  (body) => body.role !== undefined || body.isActive !== undefined || body.grants !== undefined,
  { message: 'at least one of role, isActive, grants is required' },
)

export type DashboardFiguresResponse = z.infer<typeof dashboardFiguresResponseSchema>
export type AdminAccount = z.infer<typeof adminAccountSchema>
export type AdminListResponse = z.infer<typeof adminListResponseSchema>
export type UpdateAdminRequest = z.infer<typeof updateAdminRequestSchema>
