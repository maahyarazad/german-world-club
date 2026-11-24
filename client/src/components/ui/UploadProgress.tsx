/**
 * Where an upload has got to, shown to the person (feature 035, research R10).
 *
 * A native `<progress>`: accessible by itself, and no inline width style for the
 * CSP to refuse. It has a value while the share sent is known and none
 * (indeterminate) while the server processes the file or the size is not
 * computable. A failure says so and offers a retry, and the text says the
 * previous content was not touched — nothing is saved until the caller links
 * the uploaded file, so that is always true.
 *
 * Renders nothing while idle, so a page can leave it in place.
 */
import { useLocale, useTranslations } from '../../i18n/index'
import { fill, formatPercent } from '../../lib/format'
import type { MediaUploadState } from '../../lib/use-media-upload'
import Button from './Button'

export type UploadProgressProps = {
  state: MediaUploadState
  /** What is being uploaded; becomes the accessible name of the bar. */
  label: string
  onRetry?: () => void
  onCancel?: () => void
}

export function UploadProgress({ state, label, onRetry, onCancel }: UploadProgressProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  if (state.phase === 'idle') return null

  if (state.phase === 'failed') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-[13px] text-tint-danger-fg">
        <span>{t.upload.failed}</span>
        {onRetry && <Button variant="secondary" onClick={onRetry}>{t.upload.retry}</Button>}
      </div>
    )
  }

  const fraction = state.phase === 'uploading' ? state.fraction : null
  return (
    <div aria-live="polite" className="flex flex-col gap-1.5">
      <progress
        max={1}
        {...(fraction !== null ? { value: fraction } : {})}
        aria-label={label}
        className="h-2 w-full accent-navy"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-text-muted">
          {state.phase === 'processing'
            ? t.upload.processing
            : fill(t.upload.uploading, { percent: formatPercent(fraction ?? 0, locale) })}
        </span>
        {onCancel && state.phase === 'uploading' && (
          <Button variant="quiet" onClick={onCancel}>{t.upload.cancel}</Button>
        )}
      </div>
    </div>
  )
}

export default UploadProgress
