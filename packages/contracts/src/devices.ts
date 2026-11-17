import { z } from 'zod'

/**
 * A member's own device list (feature 026, contracts/devices-api.md).
 *
 * Deliberately narrow: no IP address, user agent, device key, token or session
 * id. The label is derived on the server from what the device reports, so
 * nothing here lets a client learn something it could replay.
 */
export const DEVICE_KINDS = Object.freeze(['web', 'mobile'])

export const memberDeviceSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(DEVICE_KINDS),
  label: z.string().min(1).max(64),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  /** True for the device making this request; ending it behaves as sign-out. */
  current: z.boolean(),
})

export const memberDevicesResponseSchema = z.object({
  devices: z.array(memberDeviceSchema),
})

export type MemberDevice = z.infer<typeof memberDeviceSchema>
export type MemberDevicesResponse = z.infer<typeof memberDevicesResponseSchema>
