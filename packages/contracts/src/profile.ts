import { z } from 'zod'
import { GENDERS, countryCodeSchema } from './onboarding.ts'

/**
 * Profiles (feature 009) — one per identity the platform knows.
 *
 * A member and an organisation principal (merchant, partner) are different
 * audiences with different tables (§5: a merchant is not a member), so they
 * get different profile shapes rather than one shape with half its fields
 * null. The influencer identity arrives with the affiliate-link feature, which
 * is the first thing that can actually make somebody one.
 */

export const PROFILE_BIO_MAX = 500

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
})

export type MemberProfile = z.infer<typeof memberProfileSchema>
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>
export type PublicMemberProfile = z.infer<typeof publicMemberProfileSchema>
export type OrganisationProfile = z.infer<typeof organisationProfileSchema>
