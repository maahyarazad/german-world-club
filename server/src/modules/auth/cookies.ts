import { COOKIES, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TTL_DAYS } from '@gwc/contracts/auth'
/**
 * Just the two reply methods used, structurally. The auth controller holds a
 * bare FastifyReply and the onboarding controller the app's HTTP/2-typed
 * GwcReply (types/handlers.ts); both satisfy this, and neither needs a cast.
 */
type CookieReply = {
  setCookie(name: string, value: string, options: Record<string, unknown>): unknown
  clearCookie(name: string, options: Record<string, unknown>): unknown
}

/**
 * The browser face's session cookies.
 *
 * Shared by sign-in and by onboarding's mobile verification, which opens a
 * session too. Two copies of these options would drift — and the one that
 * drifted would be the one nobody tested on a real browser.
 */
export function setAuthCookies(
  reply: CookieReply,
  { accessToken, refreshToken, secure }: { accessToken: string; refreshToken?: string | null; secure: boolean },
) {
  reply.setCookie(COOKIES.access, accessToken, {
    httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: ACCESS_TOKEN_TTL_SECONDS,
  })
  if (refreshToken) {
    // Scoped to the one path that consumes it, and SameSite=Strict: a refresh
    // token is the credential that outlives the browser session, so it
    // travels as narrowly as possible.
    reply.setCookie(COOKIES.refresh, refreshToken, {
      httpOnly: true, secure, sameSite: 'strict', path: '/auth/refresh',
      maxAge: REFRESH_TTL_DAYS.web * 86_400,
    })
  }
}

export function clearAuthCookies(reply: CookieReply) {
  reply.clearCookie(COOKIES.access, { path: '/' })
  reply.clearCookie(COOKIES.refresh, { path: '/auth/refresh' })
}
