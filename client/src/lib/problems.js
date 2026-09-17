import { PROBLEMS } from '@gwc/contracts/errors'

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
})

const byType = new Map()

function register(problem, copy) {
  byType.set(problem.type, { ...copy, type: problem.type, status: problem.status })
}

// --- Authentication ---------------------------------------------------------

register(PROBLEMS.UNAUTHENTICATED, {
  title: 'Anmeldung erforderlich',
  body: 'Bitte melden Sie sich an, um fortzufahren.',
  retry: RETRY.REAUTHENTICATE,
})

register(PROBLEMS.INVALID_CREDENTIALS, {
  title: 'Anmeldung fehlgeschlagen',
  body: 'E-Mail-Adresse oder Passwort ist nicht korrekt.',
  retry: RETRY.IMMEDIATE,
})

register(PROBLEMS.SESSION_REVOKED, {
  title: 'Sitzung beendet',
  // At most one session per account is active, so this is the expected
  // outcome of signing in elsewhere — not an error the user caused.
  body: 'Diese Sitzung wurde beendet, weil das Konto an einem anderen Gerät angemeldet wurde.',
  retry: RETRY.REAUTHENTICATE,
})

register(PROBLEMS.INVALID_REFRESH_TOKEN, {
  title: 'Sitzung abgelaufen',
  body: 'Bitte melden Sie sich erneut an.',
  retry: RETRY.REAUTHENTICATE,
})

// --- Account state ----------------------------------------------------------
//
// The server states the remedy in each of these. The console shows it and does
// not invent one of its own.

register(PROBLEMS.ACCOUNT_LOCKED, {
  title: 'Konto gesperrt',
  body: 'Dieses Konto ist gesperrt. Bitte wenden Sie sich an den Support.',
  retry: RETRY.NEVER,
})

register(PROBLEMS.ACCOUNT_INACTIVE, {
  title: 'Konto inaktiv',
  body: 'Dieses Konto ist inaktiv. Setzen Sie Ihr Passwort zurück, um es zu reaktivieren.',
  retry: RETRY.NEVER,
})

register(PROBLEMS.MEMBERSHIP_ENDED, {
  title: 'Mitgliedschaft beendet',
  body: 'Diese Mitgliedschaft ist beendet.',
  retry: RETRY.NEVER,
})

// --- Authorization ----------------------------------------------------------

register(PROBLEMS.INSUFFICIENT_PERMISSION, {
  title: 'Keine Berechtigung',
  // Deliberately identical wording whether the record is missing or simply not
  // theirs. An authorization refusal must not reveal whether the resource
  // exists (FR-007), and the server does not distinguish the two either.
  body: 'Sie haben keine Berechtigung für diesen Bereich.',
  retry: RETRY.NEVER,
  staleCapabilities: true,
})

register(PROBLEMS.PERMISSION_REQUIRED, {
  title: 'Berechtigung erforderlich',
  body: 'Für diese Aktion fehlt Ihnen die erforderliche Berechtigung.',
  retry: RETRY.NEVER,
  staleCapabilities: true,
})

register(PROBLEMS.CANNOT_MANAGE_ADMIN, {
  title: 'Nicht möglich',
  body: 'Dieses Administratorkonto kann nicht von Ihnen verwaltet werden.',
  retry: RETRY.NEVER,
})

// --- Resources --------------------------------------------------------------

register(PROBLEMS.NOT_FOUND, {
  title: 'Nicht gefunden',
  body: 'Der angeforderte Eintrag existiert nicht.',
  retry: RETRY.NEVER,
})

register(PROBLEMS.CONFLICT, {
  title: 'Konflikt',
  body: 'Dieser Eintrag wurde zwischenzeitlich geändert. Bitte laden Sie ihn neu.',
  retry: RETRY.IMMEDIATE,
})

register(PROBLEMS.GONE, {
  title: 'Nicht mehr verfügbar',
  body: 'Dieser Eintrag ist nicht mehr verfügbar.',
  retry: RETRY.NEVER,
})

register(PROBLEMS.VALIDATION_FAILED, {
  title: 'Eingabe unvollständig',
  body: 'Bitte prüfen Sie die markierten Felder.',
  retry: RETRY.IMMEDIATE,
})

// --- Limits -----------------------------------------------------------------

register(PROBLEMS.RATE_LIMITED, {
  title: 'Zu viele Anfragen',
  body: 'Bitte warten Sie einen Moment und versuchen Sie es erneut.',
  retry: RETRY.AFTER_WAIT,
})

register(PROBLEMS.QUOTA_EXCEEDED, {
  title: 'Kontingent erreicht',
  // The whole point of separating this from RATE_LIMITED: retrying cannot
  // help, so the copy must not suggest waiting.
  body: 'Das Kontingent für diesen Vorgang ist erschöpft. Ein erneuter Versuch ändert daran nichts.',
  retry: RETRY.NEVER,
})

// --- Server -----------------------------------------------------------------

register(PROBLEMS.REQUEST_DEADLINE_EXCEEDED, {
  title: 'Zeitüberschreitung',
  body: 'Die Anfrage hat zu lange gedauert. Bitte versuchen Sie es erneut.',
  retry: RETRY.AFTER_WAIT,
})

register(PROBLEMS.SERVICE_UNAVAILABLE, {
  title: 'Dienst nicht verfügbar',
  body: 'Der Dienst ist vorübergehend nicht erreichbar.',
  retry: RETRY.AFTER_WAIT,
})

register(PROBLEMS.INTERNAL, {
  title: 'Unerwarteter Fehler',
  body: 'Es ist ein unerwarteter Fehler aufgetreten.',
  retry: RETRY.AFTER_WAIT,
})

/**
 * Render a problem.
 *
 * An unrecognised `type` is not an error condition — the server may add one at
 * any time, and a console that threw on an unknown problem would break on a
 * deploy it had nothing to do with. It falls back to the problem's own `title`,
 * which RFC 9457 requires the server to send.
 */
export function describeProblem(problem) {
  if (!problem) {
    return {
      title: 'Unerwarteter Fehler',
      body: 'Es ist ein unerwarteter Fehler aufgetreten.',
      retry: RETRY.AFTER_WAIT,
      known: false,
    }
  }

  const known = byType.get(problem.type)
  if (known) return { ...known, known: true, instance: problem.instance }

  return {
    title: problem.title || 'Unerwarteter Fehler',
    body: '',
    retry: problem.status >= 500 ? RETRY.AFTER_WAIT : RETRY.NEVER,
    known: false,
    instance: problem.instance,
  }
}

/** Whether this refusal means the client's capability snapshot is stale. */
export function invalidatesCapabilities(problem) {
  return byType.get(problem?.type)?.staleCapabilities === true
}

/** Whether this refusal means the credential is gone and sign-in is the remedy. */
export function requiresReauthentication(problem) {
  return describeProblem(problem).retry === RETRY.REAUTHENTICATE
}

/** Whether the console may offer a retry control at all (FR-019). */
export function isRetryable(problem) {
  const { retry } = describeProblem(problem)
  return retry === RETRY.AFTER_WAIT || retry === RETRY.IMMEDIATE
}
