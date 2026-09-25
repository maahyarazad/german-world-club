/**
 * RFC 9457 problem types, shared by the API and every client.
 *
 * Clients branch on `type`, never on `detail` — `detail` is specific to one
 * occurrence and may change. Because every client imports this object, a typo
 * in a comparison is a missing property rather than a silent mis-branch
 * (Constitution Principle I).
 */

// The problem-type namespace. These URIs are identifiers, not fetchable pages,
// but they are the stable key every client branches on — so the club's own
// domain is the right namespace and it must be the CURRENT one. Renamed from
// german-emirates-club.com when the platform settled on German World Club.
const BASE = 'https://german-world-club.com/problems'

export type Problem = { readonly type: string; readonly title: string; readonly status: number }

export const PROBLEMS = {
  // --- Validation -----------------------------------------------------------
  VALIDATION_FAILED: { type: `${BASE}/validation-failed`, title: 'Validation failed', status: 400 },

  // --- Authentication -------------------------------------------------------
  INVALID_CREDENTIALS: { type: `${BASE}/invalid-credentials`, title: 'Invalid credentials', status: 401 },
  INVALID_OTP: { type: `${BASE}/invalid-otp`, title: 'Invalid one-time code', status: 401 },
  OTP_EXPIRED: { type: `${BASE}/otp-expired`, title: 'One-time code expired', status: 410 },
  OTP_ATTEMPTS_EXCEEDED: { type: `${BASE}/otp-attempts-exceeded`, title: 'Too many attempts', status: 429 },
  /**
   * The club does not send SMS to this number's country (or +1 area): the
   * sanctions denylist, a non-US +1 number, or a country outside the allowlist.
   * Retrying changes nothing — only a different number does — which is why it
   * is a 422 and not the 503 of a provider outage (integrations/sms-country-policy.ts).
   */
  /**
   * Registration step 3: the applicant changed their email or mobile number to
   * one another member already has. Said plainly, so they can pick another —
   * a deliberate difference from `/onboarding/register`, which never reveals a
   * taken email address. Only an applicant holding a pending verification
   * code can ask, and the route is rate-limited.
   */
  EMAIL_IN_USE: { type: `${BASE}/email-in-use`, title: 'Email address already in use', status: 409 },
  /** A mobile number belongs to one member (migration 031); registration and the step-3 change both refuse one in use. */
  MOBILE_IN_USE: { type: `${BASE}/mobile-in-use`, title: 'Mobile number already in use', status: 409 },
  SMS_DESTINATION_NOT_ALLOWED: { type: `${BASE}/sms-destination-not-allowed`, title: 'SMS not available for this number', status: 422 },
  INVALID_REFRESH_TOKEN: { type: `${BASE}/invalid-refresh-token`, title: 'Invalid refresh token', status: 401 },
  /**
   * A password-reset link that is unknown, already consumed or expired.
   *
   * Distinct from INVALID_REFRESH_TOKEN, which it used to share. They are both
   * "a single-use credential did not check out", but they mean opposite things
   * to a client: an invalid refresh token means the session is over and
   * sign-in is the remedy, while an invalid reset link means the link is stale
   * and a NEW link is the remedy. A console branching on the shared type sent
   * the user back to sign-in — the one place that cannot help someone who
   * cannot remember their password.
   *
   * The three causes are deliberately one type. Distinguishing "expired" from
   * "already used" from "never existed" would tell an attacker which reset
   * tokens have existed.
   */
  INVALID_RESET_TOKEN: { type: `${BASE}/invalid-reset-token`, title: 'Invalid reset link', status: 401 },
  SESSION_REVOKED: { type: `${BASE}/session-revoked`, title: 'Session revoked', status: 401 },
  UNAUTHENTICATED: { type: `${BASE}/unauthenticated`, title: 'Authentication required', status: 401 },

  // --- Account state (§3.2) -------------------------------------------------
  ACCOUNT_LOCKED: { type: `${BASE}/account-locked`, title: 'Account locked', status: 403 },
  ACCOUNT_INACTIVE: { type: `${BASE}/account-inactive`, title: 'Account inactive', status: 403 },
  MEMBERSHIP_ENDED: { type: `${BASE}/membership-ended`, title: 'Membership ended', status: 403 },
  PROFILE_INCOMPLETE: { type: `${BASE}/profile-incomplete`, title: 'Profile incomplete', status: 403 },
  APPROVAL_PENDING: { type: `${BASE}/approval-pending`, title: 'Approval pending', status: 403 },
  /**
   * Staff reviewed the application and refused it (§6.1). Distinct from
   * APPROVAL_PENDING because the remedy is the opposite: waiting helps a
   * pending applicant and changes nothing for a denied one.
   */
  APPLICATION_DENIED: { type: `${BASE}/application-denied`, title: 'Application denied', status: 403 },

  // --- Authorization --------------------------------------------------------
  INSUFFICIENT_PERMISSION: { type: `${BASE}/insufficient-permission`, title: 'Insufficient permission', status: 403 },
  /**
   * A cookie-borne state-changing request arrived without a usable CSRF token.
   *
   * Distinct from INSUFFICIENT_PERMISSION, which it used to be flattened into.
   * They mean opposite things to a client: missing permission is final, while a
   * missing or stale CSRF token is fixed by fetching a fresh one and retrying —
   * and a client cannot tell them apart without branching on `detail`, which
   * `contracts/http-conventions.md` forbids.
   */
  CSRF_TOKEN_INVALID: { type: `${BASE}/csrf-token-invalid`, title: 'CSRF token missing or invalid', status: 403 },
  CANNOT_MANAGE_ADMIN: { type: `${BASE}/cannot-manage-admin`, title: 'Cannot manage an administrator', status: 403 },
  PERMISSION_REQUIRED: { type: `${BASE}/permission-required`, title: 'Permission required', status: 403 },

  // --- Resources ------------------------------------------------------------
  NOT_FOUND: { type: `${BASE}/not-found`, title: 'Not found', status: 404 },
  GONE: { type: `${BASE}/gone`, title: 'Gone', status: 410 },
  CONFLICT: { type: `${BASE}/conflict`, title: 'Conflict', status: 409 },

  // --- Events (§4) ----------------------------------------------------------
  // Three types rather than one CONFLICT, because a client does three
  // different things: show "sold out", show when registration opens, or show
  // the registration the member already has.
  EVENT_FULL: { type: `${BASE}/event-full`, title: 'Event full', status: 409 },
  REGISTRATION_CLOSED: { type: `${BASE}/registration-closed`, title: 'Registration not open', status: 409 },
  ALREADY_REGISTERED: { type: `${BASE}/already-registered`, title: 'Already registered', status: 409 },

  // --- Profiles and threads (010) --------------------------------------------
  /**
   * Authoring in Threads needs a handle, because mentions resolve against
   * handles and a member without one could not be mentioned in replies to
   * their own post. 403 like PROFILE_INCOMPLETE, whose remedy is the same
   * shape: finish the profile, then retry.
   */
  HANDLE_REQUIRED: { type: `${BASE}/handle-required`, title: 'Handle required', status: 403 },
  /**
   * Distinct from VALIDATION_FAILED: the handle is fine, the timing is not,
   * and the remedy is waiting until `handleChangeableAt`, not editing it.
   */
  HANDLE_CHANGE_TOO_SOON: { type: `${BASE}/handle-change-too-soon`, title: 'Handle changed too recently', status: 409 },

  // --- Push notifications (011) ----------------------------------------------
  /**
   * A rehearsal with nobody on the test list. Refused rather than accepted as
   * a notification to zero devices, because "sent" with nothing arriving is
   * exactly the result that leads staff to broadcast untested.
   */
  PUSH_NO_TEST_RECIPIENTS: { type: `${BASE}/push/no-test-recipients`, title: 'No test recipients', status: 409 },
  /**
   * The `clientRef` was already used for a *different* message. Answering with
   * the earlier notification would silently drop the new one, so it is
   * refused; the console makes a new ref and asks staff to send again.
   */
  PUSH_IDEMPOTENCY_CONFLICT: { type: `${BASE}/push/idempotency-conflict`, title: 'Reference already used', status: 409 },

  // --- Quotas vs. rate limits ----------------------------------------------
  // 429 is a transport limit: retry later and it will work.
  // 422 is a business quota: retrying changes nothing until state changes.
  // A client shown 429 for an exhausted invitation quota would retry forever.
  RATE_LIMITED: { type: `${BASE}/rate-limited`, title: 'Too many requests', status: 429 },
  QUOTA_EXCEEDED: { type: `${BASE}/quota-exceeded`, title: 'Quota exceeded', status: 422 },

  // --- Media ----------------------------------------------------------------
  UNSUPPORTED_MEDIA_TYPE: { type: `${BASE}/unsupported-media-type`, title: 'Unsupported media type', status: 400 },
  MEDIA_DIMENSIONS_EXCEEDED: { type: `${BASE}/media-dimensions-exceeded`, title: 'Media dimensions exceeded', status: 400 },
  MEDIA_TOO_LARGE: { type: `${BASE}/media-too-large`, title: 'Media too large', status: 413 },
  MEDIA_QUOTA_EXCEEDED: { type: `${BASE}/media-quota-exceeded`, title: 'Media quota exceeded', status: 409 },
  MEDIA_PROCESSING_UNAVAILABLE: { type: `${BASE}/media-processing-unavailable`, title: 'Media processing unavailable', status: 503 },

  // --- Server ---------------------------------------------------------------
  INTERNAL: { type: `${BASE}/internal`, title: 'Internal error', status: 500 },
  REQUEST_DEADLINE_EXCEEDED: { type: `${BASE}/request-deadline-exceeded`, title: 'Request deadline exceeded', status: 503 },
  SERVICE_UNAVAILABLE: { type: `${BASE}/service-unavailable`, title: 'Service unavailable', status: 503 },
} as const satisfies Record<string, Problem>

/** Problem keys, for exhaustiveness checks in tests. */
export const PROBLEM_KEYS = Object.freeze(Object.keys(PROBLEMS))

/** Every problem key, as a union. A typo in a comparison is now a type error. */
export type ProblemKey = keyof typeof PROBLEMS

/** Every problem `type` URI, as a union. Clients branch on this, never on `detail`. */
export type ProblemType = (typeof PROBLEMS)[ProblemKey]['type']

/**
 * An RFC 9457 problem as it appears on the wire.
 *
 * Lives here rather than in a client because both faces parse it and the
 * server emits it — three places, one definition (Principle I). `detail` is
 * deliberately present and deliberately never branched on: it is specific to
 * one occurrence and may change between releases.
 */
export type ProblemResponse = {
  type: string
  title: string
  status: number
  detail?: string
  instance?: string
}
