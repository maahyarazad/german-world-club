import { z } from 'zod'
import { GENDERS, countryCodeSchema } from './onboarding.ts'
import { mediaItemSchema } from './media.ts'

/**
 * Profiles (feature 009) — one per identity the platform knows.
 *
 * A member and an organisation principal (merchant, partner) are different
 * audiences with different tables (§5: a merchant is not a member), so they
 * get different profile shapes rather than one shape with half its fields
 * null.
 *
 * An influencer is a member with a staff-granted designation (feature 010,
 * research R3), not a fifth audience: they sign in as a member and can do
 * everything a member can. The affiliate link is a later feature that hangs
 * off the designation.
 */

export const PROFILE_BIO_MAX = 500

// --- Handles (010) ------------------------------------------------------------

/**
 * 3–30 of `a-z 0-9 . _`, not starting or ending with a dot. Lowercase only:
 * the column is case-insensitive for uniqueness, and storing one spelling
 * keeps `@Alice` and `@alice` from rendering as two people. The same rule is
 * a CHECK constraint in 026_profiles.sql.
 */
export const HANDLE_PATTERN = /^(?!\.)[a-z0-9._]{3,30}(?<!\.)$/

/**
 * Handles nobody may take, because each would read as the club speaking or
 * collide with a route segment. Enforced by the server; a client uses it only
 * for an inline hint.
 */
export const RESERVED_HANDLES = Object.freeze([
  'admin', 'administrator', 'gwc', 'germanworldclub', 'german.world.club', 'support', 'staff',
  'konsole', 'threads', 'profile', 'profil', 'mitglied', 'mitglieder', 'api', 'root', 'system',
  'moderator', 'moderation', 'help', 'hilfe', 'info', 'team', 'official', 'offiziell', 'club',
  'marketplace', 'marktplatz', 'events', 'me', 'null', 'undefined',
] as const)

/** A handle may change at most once in this many days (spec FR-011). */
export const HANDLE_CHANGE_DAYS = 30

/** Normalise what somebody typed into the one spelling that is stored. */
export const normaliseHandle = (raw: string) => raw.trim().replace(/^@/, '').toLowerCase()

export const handleSchema = z.string().transform(normaliseHandle).pipe(z.string().regex(HANDLE_PATTERN))

export const setHandleRequestSchema = z.object({ handle: handleSchema })

export const handleAvailabilitySchema = z.object({ available: z.boolean() })

// --- Links and avatar (010) ---------------------------------------------------

export const PROFILE_LINKS_MAX = 3

/** https only: a javascript: or data: URL on somebody else's screen is the attack. */
export const profileLinkSchema = z.object({
  url: z.string().trim().max(200).regex(/^https:\/\/\S+$/),
  label: z.string().trim().min(1).max(40).nullable(),
})

export const setLinksRequestSchema = z.object({ links: z.array(profileLinkSchema).max(PROFILE_LINKS_MAX) })

/** `null` clears the avatar. */
export const setAvatarRequestSchema = z.object({ assetId: z.string().uuid().nullable() })

/** Your own profile. Contact details appear here and nowhere else. */
export const memberProfileSchema = z.object({
  kind: z.literal('member'),
  id: z.string().uuid(),
  displayName: z.string().nullable(),
  email: z.string(),
  mobile: z.string().nullable(),
  birthday: z.string().nullable(),
  gender: z.enum(GENDERS).nullable(),
  countryOfResidence: z.string().nullable(),
  bio: z.string().nullable(),
  city: z.string().nullable(),
  memberSince: z.string(),
  followers: z.number().int().nonnegative(),
  following: z.number().int().nonnegative(),
  handle: z.string().nullable(),
  /** When the next handle change is allowed; null means now. */
  handleChangeableAt: z.string().nullable(),
  avatar: mediaItemSchema.nullable(),
  links: z.array(profileLinkSchema),
  isInfluencer: z.boolean(),
})

/**
 * What you may change yourself.
 *
 * Not the name: §3.2 routes a name change through a justified request that
 * staff approve. Not the mobile number or the email: each was verified, and
 * changing one is a re-verification, not an edit. Not the birthday: it was
 * part of what staff approved.
 *
 * Present-and-null clears a field; absent leaves it alone.
 */
export const updateProfileRequestSchema = z.object({
  bio: z.string().trim().max(PROFILE_BIO_MAX).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  gender: z.enum(GENDERS).optional(),
  countryOfResidence: countryCodeSchema.optional(),
})

/**
 * Another member, as a member sees them.
 *
 * No email, no mobile and no birthday — §7's privacy controls decide who sees
 * those, and until that feature exists the answer is nobody.
 */
export const publicMemberProfileSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().nullable(),
  bio: z.string().nullable(),
  city: z.string().nullable(),
  countryOfResidence: z.string().nullable(),
  followers: z.number().int().nonnegative(),
  following: z.number().int().nonnegative(),
  isFollowing: z.boolean(),
  isSelf: z.boolean(),
  handle: z.string().nullable(),
  avatar: mediaItemSchema.nullable(),
  links: z.array(profileLinkSchema),
  isInfluencer: z.boolean(),
  /** I block them. (Whether they block me is never disclosed: that is a 404.) */
  isBlocked: z.boolean(),
  isMuted: z.boolean(),
})

/**
 * An organisation as members see it (010, research R11).
 *
 * Read from `organisation_profiles` only — never `legal_name`, fee tier or
 * contract dates, which live on `organisations` and are staff business.
 */
export const organisationPublicProfileSchema = z.object({
  slug: z.string(),
  kind: z.enum(['merchant', 'partner']),
  displayName: z.string(),
  about: z.string().nullable(),
  website: z.string().nullable(),
  city: z.string().nullable(),
  logo: mediaItemSchema.nullable(),
})

/**
 * What an organisation's owner or manager may change. Absent leaves a field
 * alone; null clears it. `displayName` cannot be cleared: it is how members
 * see the organisation at all.
 */
export const updateOrganisationProfileRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  about: z.string().trim().max(1000).nullable().optional(),
  website: z.string().trim().max(200).regex(/^https:\/\/\S+$/).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  logoAssetId: z.string().uuid().nullable().optional(),
})

export const organisationProfileSchema = z.object({
  kind: z.enum(['merchant', 'partner']),
  id: z.string().uuid(),
  displayName: z.string().nullable(),
  email: z.string(),
  role: z.string(),
  organisation: z.object({
    id: z.string().uuid(),
    name: z.string(),
    status: z.string(),
  }),
  /** The public face members see, or null until somebody fills it in. */
  publicProfile: organisationPublicProfileSchema.nullable(),
  /** Owner or manager. Display only — the server re-checks every edit. */
  canEdit: z.boolean(),
})

// --- Designations (staff, 010) --------------------------------------------------

export const DESIGNATIONS = Object.freeze(['influencer'] as const)

export const designationSchema = z.object({
  id: z.string().uuid(),
  designation: z.enum(DESIGNATIONS),
  grantedAt: z.string(),
  grantedBy: z.string().uuid().nullable(),
  grantReason: z.string(),
  revokedAt: z.string().nullable(),
  revokedBy: z.string().uuid().nullable(),
  revokeReason: z.string().nullable(),
})

export const designationHistorySchema = z.object({ items: z.array(designationSchema) })

export const designationReasonSchema = z.object({ reason: z.string().trim().min(3).max(2000) })

export type MemberProfile = z.infer<typeof memberProfileSchema>
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>
export type PublicMemberProfile = z.infer<typeof publicMemberProfileSchema>
export type OrganisationProfile = z.infer<typeof organisationProfileSchema>
export type OrganisationPublicProfile = z.infer<typeof organisationPublicProfileSchema>
export type UpdateOrganisationProfileRequest = z.infer<typeof updateOrganisationProfileRequestSchema>
export type ProfileLink = z.infer<typeof profileLinkSchema>
export type SetHandleRequest = z.input<typeof setHandleRequestSchema>
export type SetLinksRequest = z.infer<typeof setLinksRequestSchema>
export type SetAvatarRequest = z.infer<typeof setAvatarRequestSchema>
export type Designation = z.infer<typeof designationSchema>
