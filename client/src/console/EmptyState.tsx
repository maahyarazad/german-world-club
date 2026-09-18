import Callout from '../components/ui/Callout'

/**
 * What a principal with no grants sees.
 *
 * Deliberately a real, explanatory screen rather than an error or a blank page.
 * An account with no modules is a normal state — a new staff member before
 * anyone has granted them anything — and the console must say so and name the
 * remedy, not behave as though something broke.
 */
export function EmptyState({ title, children }) {
  return (
    <div className="mx-auto max-w-2xl py-12">
      <Callout variant="neutral" title={title}>
        {children}
      </Callout>
    </div>
  )
}

export default EmptyState
