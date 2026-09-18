import { PROBLEMS } from '@gwc/contracts/errors'
import type { ProblemResponse } from '@gwc/contracts/errors'
import { DEFAULT_LOCALE } from '../i18n/locales'
import type { Locale } from '../i18n/locales'

/**
 * RFC 9457 problems, rendered.
 *
 * Every lookup is keyed on `type`. `detail` is specific to one occurrence and
 * may change between releases; branching on it is how a client ends up parsing
 * English prose to decide what to do. Because the keys come from the shared
 * PROBLEMS object, a typo here is a missing property rather than a silent
 * mis-branch (Constitution Principle I, FR-018).
 */

/**
 * Whether retrying can possibly succeed.
 *
 * This is the distinction FR-019 exists for. A 429 is a transport limit: wait
 * and the same request works. A quota is a business limit: nothing changes
 * until state does, so offering a retry sends the user in a circle. The server
 * already separates them (429 vs 422); the console must not flatten them back
 * together.
 */
export const RETRY = Object.freeze({
  NEVER: 'never',
  AFTER_WAIT: 'after-wait',
  IMMEDIATE: 'immediate',
  REAUTHENTICATE: 'reauthenticate',
} as const)

/** What the console may offer the user in response to a refusal. */
export type RetryPolicy = (typeof RETRY)[keyof typeof RETRY]

/** One locale's rendering of a problem. */
type Copy = { title: string; body: string }

/** A registered problem: its identity, its policy, and its copy per locale. */
type Entry = {
  type: string
  status: number
  retry: RetryPolicy
  staleCapabilities?: boolean
  copy: Record<Locale, Copy>
}

/** What `register` is given: both locales' copy plus the locale-independent policy. */
type Registration = { de: Copy; en: Copy; retry: RetryPolicy; staleCapabilities?: boolean }

/**
 * Copy per locale, keyed on problem `type`.
 *
 * The keying is what makes a second language free here: the server sends
 * English `detail` strings the console never renders, so English is a second
 * copy table against the same keys rather than a change to any response. That
 * is the payoff of "clients branch on `type`, never on `detail`".
 */
const byType = new Map<string, Entry>()

function register(problem: { type: string; status: number }, { de, en, ...shared }: Registration): void {
  byType.set(problem.type, {
    ...shared,
    type: problem.type,
    status: problem.status,
    copy: { de, en },
  })
}

// --- Authentication ---------------------------------------------------------

register(PROBLEMS.UNAUTHENTICATED, {
  de: { title: 'Anmeldung erforderlich', body: 'Bitte melden Sie sich an, um fortzufahren.' },
  en: { title: 'Sign-in required', body: 'Please sign in to continue.' },
  retry: RETRY.REAUTHENTICATE,
})

register(PROBLEMS.INVALID_CREDENTIALS, {
  de: { title: 'Anmeldung fehlgeschlagen', body: 'E-Mail-Adresse oder Passwort ist nicht korrekt.' },
  en: { title: 'Sign-in failed', body: 'That email address or password is not correct.' },
  retry: RETRY.IMMEDIATE,
})

register(PROBLEMS.SESSION_REVOKED, {
  de: { title: 'Sitzung beendet', body: 'Diese Sitzung wurde beendet, weil das Konto an einem anderen Gerät angemeldet wurde.' },
  en: { title: 'Session ended', body: 'This session ended because the account signed in on another device.' },
  // At most one session per account is active, so this is the expected
  // outcome of signing in elsewhere — not an error the user caused.
  retry: RETRY.REAUTHENTICATE,
})

register(PROBLEMS.INVALID_REFRESH_TOKEN, {
  de: { title: 'Sitzung abgelaufen', body: 'Bitte melden Sie sich erneut an.' },
  en: { title: 'Session expired', body: 'Please sign in again.' },
  retry: RETRY.REAUTHENTICATE,
})

register(PROBLEMS.INVALID_RESET_TOKEN, {
  de: { title: 'Link nicht mehr gültig', body: 'Dieser Link kann nicht mehr verwendet werden. Bitte fordern Sie einen neuen an.' },
  en: { title: 'Link no longer valid', body: 'This link can no longer be used. Please request a new one.' },
  // Deliberately does not say WHY. The server does not distinguish "expired"
  // from "already used" from "never existed", because doing so would tell an
  // attacker which reset tokens have existed.
  // NOT reauthenticate: sending someone who cannot remember their password
  // back to sign-in is a loop. A new link is the only thing that helps.
  retry: RETRY.NEVER,
})

// --- Account state ----------------------------------------------------------
//
// The server states the remedy in each of these. The console shows it and does
// not invent one of its own.

register(PROBLEMS.ACCOUNT_LOCKED, {
  de: { title: 'Konto gesperrt', body: 'Dieses Konto ist gesperrt. Bitte wenden Sie sich an den Support.' },
  en: { title: 'Account locked', body: 'This account is locked. Please contact support.' },
  retry: RETRY.NEVER,
})

register(PROBLEMS.ACCOUNT_INACTIVE, {
  de: { title: 'Konto inaktiv', body: 'Dieses Konto ist inaktiv. Setzen Sie Ihr Passwort zurück, um es zu reaktivieren.' },
  en: { title: 'Account inactive', body: 'This account is inactive. Reset your password to reactivate it.' },
  retry: RETRY.NEVER,
})

register(PROBLEMS.MEMBERSHIP_ENDED, {
  de: { title: 'Mitgliedschaft beendet', body: 'Diese Mitgliedschaft ist beendet.' },
  en: { title: 'Membership ended', body: 'This membership has ended.' },
  retry: RETRY.NEVER,
})

// --- Authorization ----------------------------------------------------------

register(PROBLEMS.INSUFFICIENT_PERMISSION, {
  de: { title: 'Keine Berechtigung', body: 'Sie haben keine Berechtigung für diesen Bereich.' },
  en: { title: 'No permission', body: 'You do not have permission for this area.' },
  // Deliberately identical wording whether the record is missing or simply not
  // theirs. An authorization refusal must not reveal whether the resource
  // exists (FR-007), and the server does not distinguish the two either.
  retry: RETRY.NEVER,
  staleCapabilities: true,
})

register(PROBLEMS.PERMISSION_REQUIRED, {
  de: { title: 'Berechtigung erforderlich', body: 'Für diese Aktion fehlt Ihnen die erforderliche Berechtigung.' },
  en: { title: 'Permission required', body: 'You lack the permission this action requires.' },
  retry: RETRY.NEVER,
  staleCapabilities: true,
})

register(PROBLEMS.CSRF_TOKEN_INVALID, {
  de: { title: 'Sicherheitsprüfung fehlgeschlagen', body: 'Bitte laden Sie die Seite neu und versuchen Sie es erneut.' },
  en: { title: 'Security check failed', body: 'Please reload the page and try again.' },
  // api.js retries once with a fresh token before this is ever shown, so
  // reaching this copy means the second attempt failed too.
  retry: RETRY.IMMEDIATE,
})

register(PROBLEMS.CANNOT_MANAGE_ADMIN, {
  de: { title: 'Nicht möglich', body: 'Dieses Administratorkonto kann nicht von Ihnen verwaltet werden.' },
  en: { title: 'Not possible', body: 'This administrator account cannot be managed by you.' },
  retry: RETRY.NEVER,
})

// --- Resources --------------------------------------------------------------

register(PROBLEMS.NOT_FOUND, {
  de: { title: 'Nicht gefunden', body: 'Der angeforderte Eintrag existiert nicht.' },
  en: { title: 'Not found', body: 'The requested entry does not exist.' },
  retry: RETRY.NEVER,
})

register(PROBLEMS.CONFLICT, {
  de: { title: 'Konflikt', body: 'Dieser Eintrag wurde zwischenzeitlich geändert. Bitte laden Sie ihn neu.' },
  en: { title: 'Conflict', body: 'This entry changed in the meantime. Please reload it.' },
  retry: RETRY.IMMEDIATE,
})

register(PROBLEMS.GONE, {
  de: { title: 'Nicht mehr verfügbar', body: 'Dieser Eintrag ist nicht mehr verfügbar.' },
  en: { title: 'No longer available', body: 'This entry is no longer available.' },
  retry: RETRY.NEVER,
})

register(PROBLEMS.VALIDATION_FAILED, {
  de: { title: 'Eingabe unvollständig', body: 'Bitte prüfen Sie die markierten Felder.' },
  en: { title: 'Incomplete input', body: 'Please check the highlighted fields.' },
  retry: RETRY.IMMEDIATE,
})

// --- Limits -----------------------------------------------------------------

register(PROBLEMS.RATE_LIMITED, {
  de: { title: 'Zu viele Anfragen', body: 'Bitte warten Sie einen Moment und versuchen Sie es erneut.' },
  en: { title: 'Too many requests', body: 'Please wait a moment and try again.' },
  retry: RETRY.AFTER_WAIT,
})

register(PROBLEMS.QUOTA_EXCEEDED, {
  de: { title: 'Kontingent erreicht', body: 'Das Kontingent für diesen Vorgang ist erschöpft. Ein erneuter Versuch ändert daran nichts.' },
  en: { title: 'Quota reached', body: 'The quota for this operation is exhausted. Trying again will not change that.' },
  // The whole point of separating this from RATE_LIMITED: retrying cannot
  // help, so the copy must not suggest waiting.
  retry: RETRY.NEVER,
})

// --- Server -----------------------------------------------------------------

register(PROBLEMS.REQUEST_DEADLINE_EXCEEDED, {
  de: { title: 'Zeitüberschreitung', body: 'Die Anfrage hat zu lange gedauert. Bitte versuchen Sie es erneut.' },
  en: { title: 'Timed out', body: 'The request took too long. Please try again.' },
  retry: RETRY.AFTER_WAIT,
})

register(PROBLEMS.SERVICE_UNAVAILABLE, {
  de: { title: 'Dienst nicht verfügbar', body: 'Der Dienst ist vorübergehend nicht erreichbar.' },
  en: { title: 'Service unavailable', body: 'The service is temporarily unreachable.' },
  retry: RETRY.AFTER_WAIT,
})

register(PROBLEMS.INTERNAL, {
  de: { title: 'Unerwarteter Fehler', body: 'Es ist ein unerwarteter Fehler aufgetreten.' },
  en: { title: 'Unexpected error', body: 'An unexpected error occurred.' },
  retry: RETRY.AFTER_WAIT,
})

/**
 * Render a problem, in the given locale.
 *
 * An unrecognised `type` is not an error condition — the server may add one at
 * any time, and a console that threw on an unknown problem would break on a
 * deploy it had nothing to do with. It falls back to the problem's own `title`,
 * which RFC 9457 requires the server to send. That fallback is the same in
 * every language, because it IS the server's string.
 */
export type DescribedProblem = {
  title: string
  body: string
  retry: RetryPolicy
  known: boolean
  type?: string
  status?: number
  staleCapabilities?: boolean
  instance?: string
}

export function describeProblem(
  problem: ProblemResponse | null | undefined,
  locale: Locale = DEFAULT_LOCALE,
): DescribedProblem {
  const pick = (entry: Entry): Copy => entry.copy[locale] ?? entry.copy[DEFAULT_LOCALE]

  // Non-null assertions here and below are safe by construction: INTERNAL is
  // registered unconditionally at module load, a few dozen lines above.
  const internal = byType.get(PROBLEMS.INTERNAL.type)!

  if (!problem) {
    return { ...pick(internal), retry: RETRY.AFTER_WAIT, known: false }
  }

  const known = byType.get(problem.type)
  if (known) {
    const { copy: _copy, ...rest } = known
    return { ...rest, ...pick(known), known: true, instance: problem.instance }
  }

  return {
    title: problem.title || pick(internal).title,
    body: '',
    retry: problem.status >= 500 ? RETRY.AFTER_WAIT : RETRY.NEVER,
    known: false,
    instance: problem.instance,
  }
}

/**
 * Whether this refusal means the client's capability snapshot is stale.
 *
 * Locale-independent, like every other decision below: what the console DOES
 * about a refusal must not depend on which language it is showing.
 */
export function invalidatesCapabilities(problem: ProblemResponse | null | undefined): boolean {
  return (problem ? byType.get(problem.type)?.staleCapabilities : false) === true
}

/** Whether this refusal means the credential is gone and sign-in is the remedy. */
export function requiresReauthentication(problem: ProblemResponse | null | undefined): boolean {
  return retryFor(problem) === RETRY.REAUTHENTICATE
}

/** Whether the console may offer a retry control at all (FR-019). */
export function isRetryable(problem: ProblemResponse | null | undefined): boolean {
  const retry = retryFor(problem)
  return retry === RETRY.AFTER_WAIT || retry === RETRY.IMMEDIATE
}

/** The retry policy for a problem, independent of language. */
function retryFor(problem: ProblemResponse | null | undefined): RetryPolicy {
  if (!problem) return RETRY.AFTER_WAIT
  const known = byType.get(problem.type)
  if (known) return known.retry
  return problem.status >= 500 ? RETRY.AFTER_WAIT : RETRY.NEVER
}
