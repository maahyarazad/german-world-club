import { z } from 'zod'

/**
 * Push notification contracts (feature 011, specs/011-push-notifications/).
 *
 * Shared by the API, the admin console and the mobile app — Constitution
 * Principle I. The payload's destination types, the offer text template and
 * the deep-link table all live here, because each of them is a string two
 * sides must agree on and one of those sides is a phone that cannot be
 * redeployed in a minute.
 */

export const PUSH_PROVIDERS = Object.freeze(['expo', 'fcm'] as const)
export const PUSH_PLATFORMS = Object.freeze(['ios', 'android', 'web'] as const)

/**
 * The two languages a notification can arrive in (research R5).
 *
 * The operating system renders a push while the app is not running, so the
 * app cannot translate it on arrival. Each device therefore tells the server
 * which language it wants, and the server picks the matching text.
 */
export const PUSH_LOCALES = Object.freeze(['de', 'en'] as const)
export type PushLocale = (typeof PUSH_LOCALES)[number]

/**
 * Length caps mirror the columns, and the columns mirror what the platforms
 * actually display. A longer title is not an error the member ever sees — it is
 * simply truncated on the lock screen, so it is refused at the edge instead.
 */
export const TITLE_MAX = 65
export const BODY_MAX = 240

/**
 * The whole deep-link vocabulary (contracts/push-payload.md).
 *
 * `article` stays so history rows that used it still parse; the app has no
 * screen for it and treats it like `none`.
 */
export const DESTINATION_TYPES = Object.freeze(
  ['offer', 'listing', 'thread_post', 'event', 'partner', 'article', 'none'] as const,
)
export type DestinationType = (typeof DESTINATION_TYPES)[number]

/** `rehearsal` and `broadcast` are staff-authored; `offer` is queued by a database trigger. */
export const NOTIFICATION_KINDS = Object.freeze(['rehearsal', 'broadcast', 'offer'] as const)
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export const NOTIFICATION_STATUSES = Object.freeze(
  ['queued', 'sending', 'done', 'partial', 'failed', 'cancelled'] as const,
)
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number]

/** A notification in one of these never changes again; the console stops polling. */
export const FINAL_NOTIFICATION_STATUSES = Object.freeze(
  ['done', 'partial', 'failed', 'cancelled'] as const,
)

/**
 * Per-device delivery states (data-model.md, push_deliveries).
 *
 * `sending` means "handed to the provider, outcome not yet saved". It is the
 * state that makes at-most-once possible: a row left there by a crash is
 * failed as `outcome unknown` rather than sent again.
 */
export const DELIVERY_STATUSES = Object.freeze(
  ['pending', 'sending', 'sent', 'delivered', 'failed', 'skipped'] as const,
)
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

/** The payload version the app understands. Anything else is ignored on tap. */
export const PUSH_PAYLOAD_VERSION = '1'

// ---------------------------------------------------------------------------
// Devices (member)
// ---------------------------------------------------------------------------

export const deviceRegistrationSchema = z.object({
  /**
   * An Expo token or a raw FCM token. Which one it is comes from `provider`,
   * never from inspecting the string: guessing is how an Expo token ends up
   * sent through FCM, which hard-fails for that whole cohort.
   */
  token: z.string().min(1).max(512),
  provider: z.enum(PUSH_PROVIDERS),
  platform: z.enum(PUSH_PLATFORMS).optional(),
  /** Required: the app always knows its language, and a guess would be German for everyone. */
  locale: z.enum(PUSH_LOCALES),
  /** The member's opt-in. Absent means opted in, since they just registered. */
  enabled: z.boolean().optional(),
})

export const devicePatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    locale: z.enum(PUSH_LOCALES).optional(),
  })
  .refine((v) => v.enabled !== undefined || v.locale !== undefined, {
    message: 'Nothing to change: pass enabled, locale, or both.',
  })

export const deviceSchema = z.object({
  id: z.string().uuid(),
  provider: z.enum(PUSH_PROVIDERS),
  platform: z.enum(PUSH_PLATFORMS).nullable(),
  locale: z.enum(PUSH_LOCALES),
  enabled: z.boolean(),
  /** Truncated: a push token is a credential for addressing someone's phone. */
  tokenPreview: z.string(),
  lastSeenAt: z.string(),
  createdAt: z.string(),
})

export const deviceListSchema = z.object({ devices: z.array(deviceSchema) })

/**
 * Which kinds of notification a member wants (research R13).
 *
 * "Everything off" is not a third flag: it is the device's own `enabled`, or
 * the operating system permission, both of which already mean exactly that.
 */
export const preferencesSchema = z.object({
  offers: z.boolean(),
  broadcasts: z.boolean(),
})

// ---------------------------------------------------------------------------
// Sending (staff)
// ---------------------------------------------------------------------------

export const localizedTextSchema = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX),
  body: z.string().trim().min(1).max(BODY_MAX),
})

export const destinationSchema = z.object({
  type: z.enum(DESTINATION_TYPES),
  /** Always a string on the wire, whatever it is in the database. */
  id: z.string().max(64).default(''),
  /**
   * Captured at send time so the history still reads correctly after the event
   * or partner it pointed at is renamed or deleted.
   */
  label: z.string().max(200).optional(),
})

export const campaignRequestSchema = z.object({
  /**
   * A uuid the console makes when the form opens and again after every
   * accepted send (research R2). A retry of the same message reuses it and is
   * answered with the notification already queued; a different message under
   * the same ref is refused rather than silently dropped.
   */
  clientRef: z.string().uuid(),
  /** Both languages are required (FR-014): half the club would otherwise get the other half's text. */
  de: localizedTextSchema,
  en: localizedTextSchema,
  destination: destinationSchema.optional(),
})

const count = z.number().int().nonnegative()

export const notificationSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(NOTIFICATION_KINDS),
  status: z.enum(NOTIFICATION_STATUSES),
  createdAt: z.string(),
  /** When the first batch went out; null while still queued. */
  sentAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  /** Null only for an offer notification the dispatcher has not rendered yet. */
  de: z.object({ title: z.string(), body: z.string() }).nullable(),
  en: z.object({ title: z.string(), body: z.string() }).nullable(),
  destination: z
    .object({ type: z.enum(DESTINATION_TYPES), id: z.string(), label: z.string().nullable() })
    .nullable(),
  /** Null for offer notifications, which nobody on staff sent. */
  sentBy: z.object({ id: z.string().uuid(), displayName: z.string().nullable() }).nullable(),
  totals: z.object({
    pending: count,
    sent: count,
    delivered: count,
    failed: count,
    skipped: count,
  }),
})

export const notificationListSchema = z.object({ notifications: z.array(notificationSchema) })

/** `"false"` must mean false; `z.coerce.boolean()` would read any non-empty string as true. */
const queryBoolean = z.enum(['true', 'false']).transform((v) => v === 'true')

export const notificationQuerySchema = z.object({
  kind: z.enum(NOTIFICATION_KINDS).optional(),
  /** Superseded by `kind`; still accepted for one release. */
  isTest: queryBoolean.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/** The two staff audiences. Offer notifications are never sent by hand. */
export const AUDIENCE_KINDS = Object.freeze(['broadcast', 'rehearsal'] as const)

export const audienceQuerySchema = z.object({ kind: z.enum(AUDIENCE_KINDS) })

/** What the broadcast confirm dialog shows — computed by the same rule that sends. */
export const audienceSchema = z.object({ members: count, devices: count })

// ---------------------------------------------------------------------------
// The rehearsal list (staff)
// ---------------------------------------------------------------------------

export const testRecipientSchema = z.object({
  memberId: z.string().uuid(),
})

/**
 * Add someone to the rehearsal list, by member id or by handle.
 *
 * By handle so the console needs nothing beyond `mass_messages`: looking a
 * member up through `/admin/members/by-handle` requires `members.read`, which
 * the staff who compose push notifications do not otherwise need.
 */
export const testRecipientAddSchema = z
  .object({
    memberId: z.string().uuid().optional(),
    handle: z.string().trim().min(1).max(31).transform((h) => h.replace(/^@/, '')).optional(),
  })
  .refine((v) => (v.memberId === undefined) !== (v.handle === undefined), {
    message: 'Pass exactly one of memberId or handle.',
  })

/**
 * Who is on the rehearsal list — not how to reach them.
 *
 * No email: the console adds people by handle and only needs to tell staff
 * *who* will get the rehearsal (constitution VI, analysis A2).
 */
export const testRecipientListSchema = z.object({
  recipients: z.array(
    z.object({
      memberId: z.string().uuid(),
      displayName: z.string().nullable(),
      handle: z.string().nullable(),
      deviceCount: count,
    }),
  ),
})

export const deletedSchema = z.object({ id: z.string().uuid(), deleted: z.literal(true) })

// ---------------------------------------------------------------------------
// Offer notification text
// ---------------------------------------------------------------------------

/**
 * The text of an offer notification (contracts/push-payload.md).
 *
 * The one place the platform assembles prose on the server's behalf (plan.md,
 * Complexity Tracking). Staff notifications carry both languages because staff
 * write both; an offer notification has no author, and the phone cannot
 * translate a push it renders while the app is closed. The template lives here
 * rather than in the server so it is reviewed as a contract, not as a string
 * inside a SQL path.
 */
export const OFFER_PUSH_TEMPLATE = Object.freeze({
  de: Object.freeze({ title: 'Neues Angebot: {merchant}', body: '{title}' }),
  en: Object.freeze({ title: 'New offer: {merchant}', body: '{title}' }),
})

/** Cut to `max` characters, ending in an ellipsis when anything was removed. */
export function truncate(text: string, max: number): string {
  const chars = [...text.trim()]
  if (chars.length <= max) return chars.join('')
  return `${chars.slice(0, max - 1).join('').trimEnd()}…`
}

/**
 * Fill the offer template for both languages.
 *
 * Truncates rather than refuses — the only place it does. The offer title is
 * merchant-authored and already accepted, and refusing to announce an offer
 * because its title is long would punish the member, not the merchant.
 */
export function renderOfferPush(values: { merchant: string; title: string }) {
  const fill = (template: string) =>
    template.replace(/\{(merchant|title)\}/g, (_, key: 'merchant' | 'title') => values[key])
  const render = (locale: PushLocale) => ({
    title: truncate(fill(OFFER_PUSH_TEMPLATE[locale].title), TITLE_MAX),
    body: truncate(fill(OFFER_PUSH_TEMPLATE[locale].body), BODY_MAX),
  })
  return { de: render('de'), en: render('en') }
}

// ---------------------------------------------------------------------------
// Deep links (contracts/push-payload.md, research R10)
// ---------------------------------------------------------------------------

/**
 * Where each destination type opens in the mobile app.
 *
 * Plain data, and here rather than in the app, because the Expo workspace has
 * no test runner and one tested table beats an untested copy (analysis U2).
 * Typed as a `Record` over every type, so adding a destination type without
 * deciding where it opens is a compile error, not a notification that goes
 * nowhere.
 */
export const DESTINATION_ROUTES: Readonly<
  Record<DestinationType, { pathname: string; param: 'id' | 'slug' } | null>
> = Object.freeze({
  offer: { pathname: '/(member)/activity/offer/[id]', param: 'id' },
  listing: { pathname: '/(member)/activity/listing/[id]', param: 'id' },
  thread_post: { pathname: '/(member)/threads/[id]', param: 'id' },
  event: { pathname: '/(member)/events/[id]', param: 'id' },
  // The partner profile is addressed by organisation slug, not uuid.
  partner: { pathname: '/(member)/threads/organisation/[slug]', param: 'slug' },
  // No article screen exists on mobile.
  article: null,
  none: null,
})

export type ResolvedDestination = {
  pathname: string
  params: Record<string, string>
}

/**
 * Turn a notification's `data` into a route, or `null` for "stay where you are".
 *
 * Every refusal is `null` rather than an error: a phone that received a
 * payload from a newer server must still open the app, just without
 * navigating (FR-010).
 */
export function resolveDestination(
  data: Readonly<Record<string, unknown>> | null | undefined,
): ResolvedDestination | null {
  if (!data || data.v !== PUSH_PAYLOAD_VERSION) return null
  const type = data.type
  if (typeof type !== 'string' || !(DESTINATION_TYPES as readonly string[]).includes(type)) return null
  const route = DESTINATION_ROUTES[type as DestinationType]
  if (!route) return null
  const id = typeof data.id === 'string' ? data.id.trim() : ''
  if (id === '') return null
  return { pathname: route.pathname, params: { [route.param]: id } }
}

/** The `data` object every push carries. Every value is a string (FCM refuses anything else). */
export type PushPayloadData = {
  v: typeof PUSH_PAYLOAD_VERSION
  nid: string
  type: DestinationType
  id: string
}

// ---------------------------------------------------------------------------
// Types (feature 007). Derived from the schemas above so there is still exactly
// one definition per shape.
// ---------------------------------------------------------------------------

export type DeviceRegistration = z.infer<typeof deviceRegistrationSchema>
export type DevicePatch = z.infer<typeof devicePatchSchema>
export type Device = z.infer<typeof deviceSchema>
export type DeviceList = z.infer<typeof deviceListSchema>
export type Preferences = z.infer<typeof preferencesSchema>
export type LocalizedText = z.infer<typeof localizedTextSchema>
export type Destination = z.infer<typeof destinationSchema>
export type CampaignRequest = z.infer<typeof campaignRequestSchema>
export type CampaignRequestInput = z.input<typeof campaignRequestSchema>
export type Notification = z.infer<typeof notificationSchema>
export type NotificationList = z.infer<typeof notificationListSchema>
export type NotificationQuery = z.infer<typeof notificationQuerySchema>
export type AudienceKind = (typeof AUDIENCE_KINDS)[number]
export type AudienceQuery = z.infer<typeof audienceQuerySchema>
export type PushAudience = z.infer<typeof audienceSchema>
export type TestRecipient = z.infer<typeof testRecipientSchema>
export type TestRecipientAdd = z.input<typeof testRecipientAddSchema>
export type TestRecipientList = z.infer<typeof testRecipientListSchema>
export type Deleted = z.infer<typeof deletedSchema>

/**
 * A push token is a credential for addressing someone's phone; this is all of
 * it anyone sees — in history, in logs, in the app's development console.
 * Shared (feature 012) so the app's masking cannot drift from the server's.
 */
export const tokenPreview = (token: unknown) => `${String(token).slice(0, 12)}…${String(token).slice(-4)}`
