import type { ReactNode } from 'react'
import { Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router'

import type { Snapshot } from '../lib/capabilities'
import { useCapabilities, STATUS, homeFor } from '../lib/capabilities'
import { useTranslations } from '../i18n/index'
import SignIn from '../auth/SignIn'
import PasswordReset from '../auth/PasswordReset'
import AdminLayout from './admin/AdminLayout'
import AdminDashboard from './AdminDashboard'
import NotBuilt from './NotBuilt'
import EmptyState from './EmptyState'
import Button from '../components/ui/Button'

/**
 * The console's route table, separated from the mount.
 *
 * `konsole.tsx` calls `createRoot` at module scope, so anything importing it to
 * reach the routes would mount the whole app as a side effect. Keeping the
 * routes here makes them drivable inside a MemoryRouter — the same split the
 * server makes between `app.ts` (everything testable) and `server.ts` (listen).
 */

/** Sign-in, and the redirect to wherever this principal belongs. */
function SignInRoute() {
  const navigate = useNavigate()
  return (
    <SignIn
      onSignedIn={(snapshot: Snapshot | null) => navigate(homeFor(snapshot?.kind), { replace: true })}
      onResetPassword={() => navigate('/konsole/passwort')}
    />
  )
}

function PasswordResetRoute() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  // `hasTokenParam` distinguishes "no token in the link" from "not on the
  // confirm step at all". Without it, a truncated reset link — `?token=` with
  // nothing after it — would silently render the request form again, and the
  // user would keep asking for links that keep arriving broken.
  return (
    <PasswordReset
      token={params.get('token')}
      hasTokenParam={params.has('token')}
      onRequestNewLink={() => navigate('/konsole/passwort', { replace: true })}
    />
  )
}

/**
 * Where an unrecognised console path goes.
 *
 * Signed in, it returns to the principal's own home rather than the sign-in
 * screen. Sending an authenticated staff member to sign in reads as having been
 * logged out, and they then re-enter credentials for a session that was never
 * lost. Only a genuinely anonymous visitor gets the sign-in screen.
 *
 * Waits for the snapshot first: redirecting while it is still loading would be
 * guessing, and not guessing is what the capability gate exists for.
 */
function Elsewhere() {
  const { status, snapshot } = useCapabilities()

  if (status === STATUS.LOADING) return null
  if (status === STATUS.READY && snapshot) {
    return <Navigate to={homeFor(snapshot.kind)} replace />
  }
  return <Navigate to="/konsole/anmelden" replace />
}

/**
 * The gate between "not signed in" and the console.
 *
 * Renders nothing of the console until the capability snapshot has arrived —
 * not a skeleton of the sidebar, not a guessed navigation. A console that
 * painted its chrome first would be showing a shape nobody had been granted.
 */
function Authenticated({ children }: { children?: ReactNode }) {
  const t = useTranslations()
  const { status, refresh } = useCapabilities()

  if (status === STATUS.LOADING) {
    return (
      <p className="flex min-h-svh items-center justify-center bg-ground font-sans text-[13px] text-text-muted">
        {t.console.loading}
      </p>
    )
  }

  if (status === STATUS.ANONYMOUS) return <Navigate to="/konsole/anmelden" replace />

  if (status === STATUS.FAILED) {
    // Never a hard-coded fallback navigation. A failed capability fetch is an
    // error state, not an invitation to guess (contracts/capability-api.md).
    return (
      <div className="min-h-svh bg-ground px-4 font-sans">
        <EmptyState title={t.console.capabilitiesFailedTitle}>
          <p>{t.console.capabilitiesFailedBody}</p>
          <Button className="mt-4" onClick={() => refresh()}>
            {t.console.retry}
          </Button>
        </EmptyState>
      </div>
    )
  }

  return children
}

export function ConsoleRoutes() {
  return (
    <Routes>
      <Route path="/konsole/anmelden" element={<SignInRoute />} />
      <Route path="/konsole/passwort" element={<PasswordResetRoute />} />

      <Route
        path="/konsole/admin"
        element={
          <Authenticated>
            <AdminLayout />
          </Authenticated>
        }
      >
        <Route index element={<AdminDashboard />} />
        {/* Keeps an admin area with no page yet inside the shell. Without this
            it fell through to the `*` below and redirected to sign-in, which
            reads as a logout on a session that is still perfectly valid. */}
        <Route path="*" element={<NotBuilt />} />
      </Route>

      <Route path="/konsole" element={<Elsewhere />} />
      <Route path="*" element={<Elsewhere />} />
    </Routes>
  )
}

export default ConsoleRoutes
