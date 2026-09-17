import { useCapabilities } from '../lib/capabilities.jsx'
import { hasGrant, hasAnyGrant, isAvailable } from '@gwc/contracts/capabilities'
import { t } from '../i18n/de.js'
import Callout from '../components/ui/Callout.jsx'

/**
 * A DISPLAY gate. Not an authorization gate.
 *
 * This decides what to render. It does not decide what is permitted, and
 * nothing behind it is protected by it: every request it wraps is re-checked by
 * the server against live state (FR-004, Constitution Principle I). Deleting
 * this component would make the console ugly and confusing; it would not make
 * anything reachable that is not already reachable.
 *
 * Read that twice before adding a `RequireGrant` around something and
 * concluding the thing inside is safe.
 */
export function RequireGrant({ module, flag, children, fallback = null }) {
  const { snapshot } = useCapabilities()

  const permitted = flag ? hasGrant(snapshot, module, flag) : hasAnyGrant(snapshot, module)
  if (!permitted) return fallback

  // Held, but the server has no endpoint for it yet. Saying so is the honest
  // outcome and what SC-001 asks for — a dead sidebar link would be worse than
  // either rendering it or hiding it.
  if (module && !isAvailable(snapshot, module)) {
    return (
      <Callout variant="neutral" title={t.console.notAvailable}>
        {t.console.notAvailableHint}
      </Callout>
    )
  }

  return children
}

/**
 * True when the principal may change this module.
 *
 * Used to decide whether to render a submitting control AT ALL. FR-017 is
 * specific about this: a module held at `read` renders with no control that
 * would submit — absent, not disabled. A disabled control still tells the
 * reader the action exists, and is a standing invitation to re-enable it in the
 * browser and find out what happens.
 */
export function useCanEdit(module, flag = 'edit') {
  const { snapshot } = useCapabilities()
  return hasGrant(snapshot, module, flag)
}

export default RequireGrant
