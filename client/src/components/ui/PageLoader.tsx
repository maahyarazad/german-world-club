/**
 * The loader for a whole page or an area of one (feature 030): centred, announced
 * as a status, and silent for the first `delayMs` so a fast response shows no
 * flicker. Render it while the page's data is on its way, and replace it with the
 * content or with the page's own failure state — it never decides about errors.
 */
import { Spinner } from './Spinner'
import type { SpinnerSize } from './Spinner'
import { useGrace } from '../../lib/useGrace'
import { useTranslations } from '../../i18n/index'

export type PageLoaderProps = {
  size?: SpinnerSize
  /** The accessible name; defaults to the console's "Loading …". */
  label?: string
  delayMs?: number
  className?: string
}

export function PageLoader({ size = 'lg', label, delayMs = 150, className = '' }: PageLoaderProps) {
  const t = useTranslations()
  const visible = useGrace(true, delayMs)
  if (!visible) return null
  return (
    <div role="status" aria-live="polite" className={`flex min-h-[40vh] items-center justify-center ${className}`}>
      <Spinner size={size} />
      <span className="sr-only">{label ?? t.console.loading}</span>
    </div>
  )
}

export default PageLoader
