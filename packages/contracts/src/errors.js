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

/** @type {Record<string, {type: string, title: string, status: number}>} */
export const PROBLEMS = {
  // --- Validation -----------------------------------------------------------
  VALIDATION_FAILED: { type: `${BASE}/validation-failed`, title: 'Validation failed', status: 400 },

  // --- Authentication -------------------------------------------------------
  INVALID_CREDENTIALS: { type: `${BASE}/invalid-credentials`, title: 'Invalid credentials', status: 401 },
  INVALID_OTP: { type: `${BASE}/invalid-otp`, title: 'Invalid one-time code', status: 401 },
  OTP_EXPIRED: { type: `${BASE}/otp-expired`, title: 'One-time code expired', status: 410 },
  OTP_ATTEMPTS_EXCEEDED: { type: `${BASE}/otp-attempts-exceeded`, title: 'Too many attempts', status: 429 },
  INVALID_REFRESH_TOKEN: { type: `${BASE}/invalid-refresh-token`, title: 'Invalid refresh token', status: 401 },
  SESSION_REVOKED: { type: `${BASE}/session-revoked`, title: 'Session revoked', status: 401 },
  UNAUTHENTICATED: { type: `${BASE}/unauthenticated`, title: 'Authentication required', status: 401 },

  // --- Account state (§3.2) -------------------------------------------------
  ACCOUNT_LOCKED: { type: `${BASE}/account-locked`, title: 'Account locked', status: 403 },
  ACCOUNT_INACTIVE: { type: `${BASE}/account-inactive`, title: 'Account inactive', status: 403 },
  MEMBERSHIP_ENDED: { type: `${BASE}/membership-ended`, title: 'Membership ended', status: 403 },
  PROFILE_INCOMPLETE: { type: `${BASE}/profile-incomplete`, title: 'Profile incomplete', status: 403 },
  APPROVAL_PENDING: { type: `${BASE}/approval-pending`, title: 'Approval pending', status: 403 },

  // --- Authorization --------------------------------------------------------
  INSUFFICIENT_PERMISSION: { type: `${BASE}/insufficient-permission`, title: 'Insufficient permission', status: 403 },
  CANNOT_MANAGE_ADMIN: { type: `${BASE}/cannot-manage-admin`, title: 'Cannot manage an administrator', status: 403 },
  PERMISSION_REQUIRED: { type: `${BASE}/permission-required`, title: 'Permission required', status: 403 },

  // --- Resources ------------------------------------------------------------
  NOT_FOUND: { type: `${BASE}/not-found`, title: 'Not found', status: 404 },
  GONE: { type: `${BASE}/gone`, title: 'Gone', status: 410 },
  CONFLICT: { type: `${BASE}/conflict`, title: 'Conflict', status: 409 },

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
}

/** Problem keys, for exhaustiveness checks in tests. */
export const PROBLEM_KEYS = Object.freeze(Object.keys(PROBLEMS))
