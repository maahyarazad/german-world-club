/**
 * Short, human display names for the member's device list (feature 026).
 *
 * Only a browser name and an operating system ever leave here — never the raw
 * User-Agent string, which can carry build numbers and extension hints that
 * identify a person more precisely than a settings screen needs to. No parsing
 * library: the list only has to tell a member's own devices apart.
 */

const MAX = 64

const BROWSERS: Array<[RegExp, string]> = [
  [/edg(e|a|ios)?\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/firefox|fxios/i, 'Firefox'],
  [/chrome|crios|chromium/i, 'Chrome'],
  [/safari/i, 'Safari'],
]

// Order matters: iPhone/iPad user agents also say "like Mac OS X", and Android
// ones say "Linux".
const SYSTEMS: Array<[RegExp, string]> = [
  [/iphone|ipad|ipod/i, 'iOS'],
  [/android/i, 'Android'],
  [/windows/i, 'Windows'],
  [/mac os x|macintosh/i, 'macOS'],
  [/cros/i, 'ChromeOS'],
  [/linux|x11/i, 'Linux'],
]

const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()

/** "Chrome on macOS", "Safari on iOS", or "Web browser" when nothing is recognisable. */
export function labelForWeb(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ''
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1]
  const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1]
  if (browser && system) return `${browser} on ${system}`
  return browser ?? system ?? 'Web browser'
}

/** What the phone calls itself (e.g. "iPhone 15"), trimmed and capped; "Phone" if it sent nothing. */
export function labelForPhone(deviceLabel: string | null | undefined): string {
  const label = clean(deviceLabel ?? '').slice(0, MAX).trim()
  return label.length > 0 ? label : 'Phone'
}
