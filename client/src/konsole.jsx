import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router'

import './styles/theme.css'
import { CapabilityProvider, useCapabilities, STATUS, homeFor } from './lib/capabilities.jsx'
import SignIn from './auth/SignIn.jsx'
import PasswordReset from './auth/PasswordReset.jsx'
import AdminLayout from './console/admin/AdminLayout.jsx'
import AdminDashboard from './console/AdminDashboard.jsx'
import EmptyState from './console/EmptyState.jsx'
import { t } from './i18n/de.js'
import Button from './components/ui/Button.jsx'

/**
 * The console entry — a second Vite entry, separate from the public
 * coming-soon page. See client/konsole.html for why they are two documents.
 */

/** Sign-in, and the redirect to wherever this principal belongs. */
function SignInRoute() {
  const navigate = useNavigate()
  return <SignIn onSignedIn={(snapshot) => navigate(homeFor(snapshot?.kind), { replace: true })} />
}

function PasswordResetRoute() {
  const [params] = useSearchParams()
  return <PasswordReset token={params.get('token')} />
}

/**
 * The gate between "not signed in" and the console.
 *
 * Renders nothing of the console until the capability snapshot has arrived —
 * not a skeleton of the sidebar, not a guessed navigation. A console that
 * painted its chrome first would be showing a shape nobody had been granted.
 */
function Authenticated({ children }) {
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
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

export default App
