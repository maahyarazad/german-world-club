import { useCallback, useEffect, useRef, useState } from 'react'
import { get, upload, ApiError } from './api'
import type { UploadProgress } from './api'

/**
 * Sending one file and waiting for the server to finish with it (feature 035,
 * research R10).
 *
 * Two phases the person can see: the bytes going up (a share when the browser
 * knows it), then "processing" while the server inspects the file and makes the
 * thumbnails. An image is ready as the upload returns; a video is accepted at
 * once and transcoded afterwards, so this polls the organisation's own status
 * route (`GET /media/{kind}/:id`) until it is `ready` or `failed`. The poll is
 * bounded and is cancelled with the upload, so it can never run forever or after
 * the page is gone.
 *
 * A failure stays in `state` so the page can say so and offer a retry; the
 * previous content is never touched here, because nothing is saved until the
 * caller links the returned asset.
 */

export type UploadedAsset = { id: string; state: 'processing' | 'ready' | 'failed' }

export type MediaUploadState =
  | { phase: 'idle' }
  | UploadProgress
  | { phase: 'failed' }

const POLL_MS = 1000
const POLL_LIMIT = 90

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
  })

export function useMediaUpload(kind: 'merchant' | 'partner') {
  const [state, setState] = useState<MediaUploadState>({ phase: 'idle' })
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  /** Resolves to the ready asset, or null when it failed or was cancelled. */
  const start = useCallback(async (file: File, alt: string): Promise<UploadedAsset | null> => {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setState({ phase: 'uploading', fraction: 0 })
    try {
      const form = new FormData()
      // `alt` before `file`: the server reads the fields that precede the file part.
      form.append('alt', alt)
      form.append('file', file)
      let asset = (await upload(`/media/${kind}`, form, { onProgress: setState, signal: abort.signal })) as UploadedAsset

      for (let i = 0; asset.state === 'processing' && i < POLL_LIMIT; i += 1) {
        setState({ phase: 'processing' })
        await delay(POLL_MS, abort.signal)
        asset = (await get(`/media/${kind}/${asset.id}`, { signal: abort.signal })) as UploadedAsset
      }
      if (asset.state !== 'ready') {
        setState({ phase: 'failed' })
        return null
      }
      setState({ phase: 'idle' })
      return asset
    } catch (error) {
      if (abort.signal.aborted) { setState({ phase: 'idle' }); return null }
      console.error('useMediaUpload.start', error instanceof ApiError ? error.problem : error)
      setState({ phase: 'failed' })
      return null
    }
  }, [kind])

  const cancel = useCallback(() => controller.current?.abort(), [])
  const reset = useCallback(() => setState({ phase: 'idle' }), [])

  return { state, start, cancel, reset }
}
