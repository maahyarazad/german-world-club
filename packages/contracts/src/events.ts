import { z } from 'zod'

/**
 * Club events, member face (§4, feature 009).
 *
 * The price shown is the price *now*: §4 computes it live against the event's
 * phase dates and never freezes it at signup, so neither may a client. A
 * client that cached `currentPriceCents` from the list and charged it at
 * registration would be doing exactly what §4 forbids — the registration
 * response carries the amount the server actually computed.
 */

export const EVENT_STATES = Object.freeze(['not_opened', 'open', 'closed', 'review'] as const)

/** Which of §4's three pricing phases applies right now, or why none does. */
export const PRICE_PHASES = Object.freeze(['not_open', 'early', 'standard', 'late', 'closed'] as const)

/**
 * The mobile face offers the two offline methods only.
 *
 * `online` needs the hosted payment page (§3.3) and its callback, which the
 * mobile app does not have yet. Offering it would create registrations that
 * could never be paid.
 */
export const MOBILE_PAYMENT_METHODS = Object.freeze(['door', 'invoice'] as const)

export const MAX_GUESTS = 10

const instant = z.string()

export const eventSummarySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  venue: z.string().nullable(),
  city: z.string().nullable(),
  startsAt: instant,
  endsAt: instant.nullable(),
  state: z.enum(EVENT_STATES),
  phase: z.enum(PRICE_PHASES),
  currentPriceCents: z.number().int().nullable(),
  currency: z.string(),
  seatsLeft: z.number().int().nonnegative(),
  registered: z.boolean(),
})

export const eventRegistrationSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  guestCount: z.number().int().nonnegative(),
  kidsFree: z.number().int().nonnegative(),
  kidsCharged: z.number().int().nonnegative(),
  paymentMethod: z.string(),
  paid: z.boolean(),
  amountCents: z.number().int().nullable(),
  currency: z.string(),
  registeredAt: instant,
})

export const eventDetailSchema = eventSummarySchema.extend({
  description: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  capacity: z.number().int().positive(),
  prices: z.object({
    earlyCents: z.number().int().nullable(),
    standardCents: z.number().int().nullable(),
    lateCents: z.number().int().nullable(),
    kidsCents: z.number().int().nullable(),
  }),
  earlyUntil: instant.nullable(),
  standardUntil: instant.nullable(),
  registrationOpens: instant.nullable(),
  registrationCloses: instant.nullable(),
  maxKids: z.number().int().nullable(),
  myRegistration: eventRegistrationSchema.nullable(),
})

export const eventListSchema = z.object({
  items: z.array(eventSummarySchema),
  nextCursor: z.string().nullable(),
})

export const registerForEventRequestSchema = z.object({
  guestCount: z.number().int().min(0).max(MAX_GUESTS).default(0),
  /** Ages 0–5: free (§4). */
  kidsFree: z.number().int().min(0).max(20).default(0),
  /** Ages 6–12: the reduced kids rate (§4). */
  kidsCharged: z.number().int().min(0).max(20).default(0),
  paymentMethod: z.enum(MOBILE_PAYMENT_METHODS),
})

export type EventState = (typeof EVENT_STATES)[number]
export type PricePhase = (typeof PRICE_PHASES)[number]
export type MobilePaymentMethod = (typeof MOBILE_PAYMENT_METHODS)[number]
export type EventSummary = z.infer<typeof eventSummarySchema>
export type EventDetail = z.infer<typeof eventDetailSchema>
export type EventList = z.infer<typeof eventListSchema>
export type EventRegistration = z.infer<typeof eventRegistrationSchema>
export type RegisterForEventRequest = z.input<typeof registerForEventRequestSchema>
