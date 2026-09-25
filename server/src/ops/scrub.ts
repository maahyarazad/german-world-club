/**
 * Free-text scrubbing for server fault records (feature 012, research R4).
 *
 * The logger's REDACT_PATHS protect *keys* — `*.email`, `*.token` — and cannot
 * see inside a string. An error message is exactly where a value ends up
 * anyway: "no member with email a@b.c", a driver echoing a token back. The
 * fault record already refuses bodies, headers and query strings by taking an
 * allowlisted shape; this is the one place free text survives, so it is
 * scrubbed here, centrally, for every caller including ones not yet written.
 *
 * Deliberately conservative about *what counts*: a scrub that also ate file
 * paths, UUIDs and ISO dates would make the record useless for the one thing
 * it is for — working out what failed.
 */

const REDACTED = '[redacted]'

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

// Three base64url segments of some length — a JWT or JWS. The length floor
// keeps `a.b.c`-shaped identifiers and file names out of it.
const JWT = /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g

// A long unbroken run of token characters: refresh tokens, API keys, hashes.
// Checked in `scrubLongRun` so a UUID or an all-letter identifier survives.
const LONG_RUN = /[A-Za-z0-9_+=-]{32,}/g
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A phone-like run: an optional +, then digits with optional spaces or dashes.
// Counted in `scrubPhone`, which needs seven digits and spares ISO dates.
const PHONE = /\+?\d[\d -]{5,}\d/g
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

function scrubLongRun(match: string) {
  if (UUID.test(match)) return match
  // A token mixes letters and digits; a long identifier or word does not.
  return /\d/.test(match) && /[A-Za-z]/.test(match) ? REDACTED : match
}

function scrubPhone(match: string) {
  if (ISO_DATE.test(match)) return match
  const digits = match.replace(/\D/g, '').length
  return digits >= 7 ? REDACTED : match
}

/** Scrub `text`, then truncate it to `max` characters. */
export function scrubText(text: string, max: number): string {
  const scrubbed = String(text)
    .replace(EMAIL, REDACTED)
    .replace(JWT, REDACTED)
    .replace(LONG_RUN, scrubLongRun)
    .replace(PHONE, scrubPhone)
  return scrubbed.length > max ? scrubbed.slice(0, max) : scrubbed
}
