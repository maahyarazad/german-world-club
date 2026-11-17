import { createHash, randomBytes } from 'node:crypto'

/**
 * A browser's identity on the web face (feature 026).
 *
 * The web sends no device id, so each browser is given one: a random value kept
 * in an httpOnly cookie. Only its SHA-256 is stored (`member_devices.device_key`),
 * so reading the table never yields a value that could be replayed as the
 * cookie. A browser that loses it (cleared data, a private window) simply
 * appears as a new entry, which is the honest answer — it is a new browser as
 * far as the server can tell.
 */
const VALID = /^[A-Za-z0-9_-]{22,64}$/

export function hashBrowserId(id: string) {
  return createHash('sha256').update(id, 'utf8').digest('hex')
}

/** Reuse a well-formed cookie value, else mint one. `issued` tells the caller to set the cookie. */
export function readOrIssueBrowserId(cookieValue: string | undefined | null) {
  if (cookieValue && VALID.test(cookieValue)) {
    return { id: cookieValue, key: hashBrowserId(cookieValue), issued: false }
  }
  const id = randomBytes(24).toString('base64url')
  return { id, key: hashBrowserId(id), issued: true }
}
