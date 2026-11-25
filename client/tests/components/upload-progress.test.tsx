import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LocaleProvider } from '../../src/i18n/index'
import { t } from '../../src/i18n/de'
import { UploadProgress } from '../../src/components/ui/UploadProgress'

/**
 * What a person sees while a file goes up (feature 035): the bytes moving, then
 * the server working, or the note that it failed — and nothing at all while idle.
 */
const show = (state: Parameters<typeof UploadProgress>[0]['state'], extra: Partial<Parameters<typeof UploadProgress>[0]> = {}) =>
  render(<LocaleProvider initialLocale="de"><UploadProgress state={state} label="Titelbild" {...extra} /></LocaleProvider>)

describe('UploadProgress', () => {
  it('shows nothing while idle', () => {
    const { container } = show({ phase: 'idle' })
    expect(container.firstChild).toBeNull()
  })

  it('shows a bar with the share that has been sent', () => {
    show({ phase: 'uploading', fraction: 0.42 })
    const bar = screen.getByRole('progressbar', { name: 'Titelbild' }) as HTMLProgressElement
    expect(bar.value).toBeCloseTo(0.42)
    expect(screen.getByText(/42/)).toBeInTheDocument()
  })

  it('shows an indeterminate bar when the size is not known', () => {
    show({ phase: 'uploading', fraction: null })
    const bar = screen.getByRole('progressbar', { name: 'Titelbild' }) as HTMLProgressElement
    expect(bar.hasAttribute('value')).toBe(false)
  })

  it('says the server is processing once the bytes have gone', () => {
    show({ phase: 'processing' })
    expect(screen.getByText(t.upload.processing)).toBeInTheDocument()
    // Counter-assertion: no percentage is claimed for work whose size is unknown.
    expect(screen.queryByText(/%/)).toBeNull()
  })

  it('says it failed, that nothing was changed, and offers a retry', () => {
    const onRetry = vi.fn()
    show({ phase: 'failed' }, { onRetry })
    expect(screen.getByRole('alert')).toHaveTextContent(t.upload.failed)
    fireEvent.click(screen.getByRole('button', { name: t.upload.retry }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('offers to cancel only while the bytes are going', () => {
    const onCancel = vi.fn()
    const { rerender } = show({ phase: 'uploading', fraction: 0.1 }, { onCancel })
    fireEvent.click(screen.getByRole('button', { name: t.upload.cancel }))
    expect(onCancel).toHaveBeenCalledOnce()

    rerender(<LocaleProvider initialLocale="de"><UploadProgress state={{ phase: 'processing' }} label="x" onCancel={onCancel} /></LocaleProvider>)
    expect(screen.queryByRole('button', { name: t.upload.cancel })).toBeNull()
  })
})
