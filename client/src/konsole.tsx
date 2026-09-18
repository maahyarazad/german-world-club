import type { ReactNode } from 'react'
import type { Snapshot } from './lib/capabilities'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router'

import './styles/theme.css'
import { CapabilityProvider, useCapabilities, STATUS, homeFor } from './lib/capabilities'
import { LocaleProvider, useTranslations } from './i18n/index'
import SignIn from './auth/SignIn'
import PasswordReset from './auth/PasswordReset'
import AdminLayout from './console/admin/AdminLayout'
import AdminDashboard from './console/AdminDashboard'
import EmptyState from './console/EmptyState'
import Button from './components/ui/Button'

/**
 * The console entry — a second Vite entry, separate from the public
 * coming-soon page. See client/konsole.html for why they are two documents.
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

function App() {
  return (
    <BrowserRouter>
      {/* Above the router and above capabilities: the sign-in screen needs the
          language before there is a principal to have a preference. */}
      <LocaleProvider>
        <CapabilityProvider>
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
          </Route>

          <Route path="/konsole" element={<Navigate to="/konsole/anmelden" replace />} />
          <Route path="*" element={<Navigate to="/konsole/anmelden" replace />} />
          </Routes>
        </CapabilityProvider>
      </LocaleProvider>
    </BrowserRouter>
  )
}

// Throw rather than assert: konsole.html always carries #root, so its absence
// is a broken build, and a non-null assertion would surface it as a confusing
// null-render instead of naming the cause.
const container = document.getElementById('root')
if (!container) throw new Error('konsole.html is missing its #root element')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

export default App
