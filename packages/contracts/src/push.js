import { z } from 'zod'

/**
 * Push notification contracts (PUSH-NOTIFICATION-BLUEPRINT.md §2, §5).
 *
 * Shared by the API, the admin console and the mobile app — Constitution
 * Principle I. The blueprint's §5 says "both sides must agree on strings"; the
 * way to make that true rather than hoped-for is one schema both sides import.
 */

export const PUSH_PROVIDERS = Object.freeze(['expo', 'fcm'])
export const PUSH_PLATFORMS = Object.freeze(['ios', 'android', 'web'])

/**
 * Length caps mirror the columns, and the columns mirror what the platforms
 * actually display. A longer title is not an error the member ever sees — it is
 * simply truncated on the lock screen, so it is refused at the edge instead.
 */
export const TITLE_MAX = 65
export const BODY_MAX = 240

/** §5 — the whole deep-link contract. */
export const DESTINATION_TYPES = Object.freeze(['event', 'partner', 'article', 'none'])

export const deviceRegistrationSchema = z.object({
  /**
   * An Expo token or a raw FCM token. Which one it is comes from `provider`,
   * never from inspecting the string: guessing is how an Expo token ends up
   * sent through FCM, which hard-fails for that whole cohort.
   */
  token: z.string().min(1).max(512),
  provider: z.enum(PUSH_PROVIDERS),
  platform: z.enum(PUSH_PLATFORMS).optional(),
  /** The member's opt-in. Absent means opted in, since they just registered. */
  enabled: z.boolean().optional(),
})

export const deviceSchema = z.object({
  id: z.string().uuid(),
  provider: z.enum(PUSH_PROVIDERS),
  platform: z.enum(PUSH_PLATFORMS).nullable(),
  enabled: z.boolean(),
  /** Truncated: a push token is a credential for addressing someone's phone. */
  tokenPreview: z.string(),
  lastSeenAt: z.string(),
  createdAt: z.string(),
})

export const deviceListSchema = z.object({ devices: z.array(deviceSchema) })

export const campaignRequestSchema = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX),
  body: z.string().trim().min(1).max(BODY_MAX),
  destinationType: z.enum(DESTINATION_TYPES).default('none'),
  /** Always a string on the wire, whatever it is in the database (§5). */
  destinationId: z.string().max(64).optional(),
  /**
   * Captured at send time so the history still reads correctly after the event
   * or partner it pointed at is renamed or deleted.
   */
  destinationLabel: z.string().max(200).optional(),
})

export const campaignResultSchema = z.object({
  id: z.string().uuid(),
  sentAt: z.string(),
  title: z.string(),
  body: z.string(),
  isTest: z.boolean(),
  destinationType: z.string().nullable(),
  destinationId: z.string().nullable(),
  destinationLabel: z.string().nullable(),
  totals: z.object({
    success: z.number().int().nonnegative(),
    failure: z.number().int().nonnegative(),
    expoSuccess: z.number().int().nonnegative(),
    expoFailure: z.number().int().nonnegative(),
    fcmSuccess: z.number().int().nonnegative(),
    fcmFailure: z.number().int().nonnegative(),
  }),
  /**
   * True when the push went out but the audit rows could not be written.
   *
   * The blueprint's §8 names the failure this prevents: a logging error
   * reported as a send failure invites the admin to re-send, and everyone gets
   * the notification twice. So the send still reports success and says
   * separately that the record is incomplete.
   */
  loggingIncomplete: z.boolean().optional(),
})

export const campaignHistorySchema = z.object({
  campaigns: z.array(campaignResultSchema),
})

export const campaignQuerySchema = z.object({
  isTest: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export const testRecipientSchema = z.object({
  memberId: z.string().uuid(),
})

export const testRecipientListSchema = z.object({
  recipients: z.array(
    z.object({
      memberId: z.string().uuid(),
      displayName: z.string().nullable(),
      email: z.string(),
      deviceCount: z.number().int().nonnegative(),
    }),
  ),
})

export const deletedSchema = z.object({ id: z.string().uuid(), deleted: z.literal(true) })
