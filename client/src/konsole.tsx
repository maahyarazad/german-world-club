import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'

import './styles/theme.css'
import { CapabilityProvider } from './lib/capabilities'
import { LocaleProvider } from './i18n/index'
import ConsoleRoutes from './console/routes'

/**
 * The console entry — a second Vite entry, separate from the public
 * coming-soon page. See client/konsole.html for why they are two documents.
 *
 * This file does nothing but mount. The route table lives in
 * `console/routes.tsx` so the suites can drive it without `createRoot` running
 * as an import side effect.
 */
function App() {
  return (
    <BrowserRouter>
      {/* Above the router and above capabilities: the sign-in screen needs the
          language before there is a principal to have a preference. */}
      <LocaleProvider>
        <CapabilityProvider>
          <ConsoleRoutes />
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
