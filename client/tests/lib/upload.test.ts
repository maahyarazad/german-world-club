import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { upload, clearCsrfToken, ApiError } from '../../src/lib/api'
import type { UploadProgress } from '../../src/lib/api'
import { installFakeXhr, lastXhr, FakeXhr } from '../helpers/fake-xhr'

/**
 * `upload()` (feature 021, Story 6, research R9): a multipart POST that
 * reports how much of the body the server has received, then that the server
 * is processing it — and otherwise behaves exactly like `request()`: cookies,
 * the CSRF header and its one refresh, problem responses as `ApiError`.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  clearCsrfToken()
  installFakeXhr()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ csrfToken: 'tok-1' }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })))
})
afterEach(() => vi.unstubAllGlobals())

const form = () => {
  const f = new FormData()
  f.append('alt', 'A picture')
  f.append('file', new File(['x'], 'a.png', { type: 'image/png' }))
  return f
}

/** Start an upload and wait until its request has been sent. */
async function start(onProgress = vi.fn(), signal?: AbortSignal) {
  const promise = upload('/media', form(), { onProgress, signal })
  promise.catch(() => undefined)
  await vi.waitFor(() => expect(FakeXhr.instances.at(-1)?.sent).toBe(true))
  return { promise, onProgress, xhr: lastXhr() }
}

describe('upload()', () => {
  it('sends like every other request: credentials, CSRF header, problem-aware accept', async () => {
    const { xhr } = await start()
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/media')
    expect(xhr.withCredentials).toBe(true)
    expect(xhr.requestHeaders['x-csrf-token']).toBe('tok-1')
    expect(xhr.requestHeaders.accept).toContain('application/problem+json')
    expect(xhr.body).toBeInstanceOf(FormData)
    // The browser writes the multipart content-type itself, boundary included.
    expect(xhr.requestHeaders['content-type']).toBeUndefined()
  })

  it('reports the share received, then processing, then resolves to the body', async () => {
    const { promise, onProgress, xhr } = await start()
    // Counter-assertion: nothing is reported before the server has anything.
    expect(onProgress).not.toHaveBeenCalled()

    xhr.progress(42, 100)
    expect(onProgress).toHaveBeenLastCalledWith({ phase: 'uploading', fraction: 0.42 } satisfies UploadProgress)
    xhr.progress(100, 100)
    xhr.bodySent()
    expect(onProgress).toHaveBeenLastCalledWith({ phase: 'processing' } satisfies UploadProgress)

    xhr.respond(201, { id: 'asset-1', state: 'ready' })
    await expect(promise).resolves.toEqual({ id: 'asset-1', state: 'ready' })
  })

  it('reports an unknown share as null when the size is not computable', async () => {
    const { onProgress, xhr } = await start()
    xhr.progress(10, 0, false)
    expect(onProgress).toHaveBeenLastCalledWith({ phase: 'uploading', fraction: null })
  })

  it('rejects a refusal as an ApiError carrying the problem', async () => {
    const { promise, xhr } = await start()
    xhr.respond(400, { ...PROBLEMS.VALIDATION_FAILED, detail: 'unsupported' }, 'application/problem+json')
    const error = await promise.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).problem.type).toBe(PROBLEMS.VALIDATION_FAILED.type)
    expect((error as ApiError).status).toBe(400)
  })

  it('retries exactly once with a fresh token after csrf-token-invalid', async () => {
    const { promise, xhr } = await start()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'tok-2' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    xhr.respond(403, PROBLEMS.CSRF_TOKEN_INVALID, 'application/problem+json')

    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(2))
    const retry = lastXhr()
    await vi.waitFor(() => expect(retry.sent).toBe(true))
    expect(retry.requestHeaders['x-csrf-token']).toBe('tok-2')
    retry.respond(201, { id: 'asset-2' })
    await expect(promise).resolves.toEqual({ id: 'asset-2' })
  })

  it('does not retry a second csrf refusal', async () => {
    const { promise, xhr } = await start()
    xhr.respond(403, PROBLEMS.CSRF_TOKEN_INVALID, 'application/problem+json')
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(2))
    const retry = lastXhr()
    await vi.waitFor(() => expect(retry.sent).toBe(true))
    retry.respond(403, PROBLEMS.CSRF_TOKEN_INVALID, 'application/problem+json')

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await flush()
    expect(FakeXhr.instances).toHaveLength(2)
  })

  it('aborts the request when the signal fires', async () => {
    const controller = new AbortController()
    const { promise, xhr } = await start(vi.fn(), controller.signal)
    controller.abort()
    expect(xhr.aborted).toBe(true)
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects when the connection fails', async () => {
    const { promise, xhr } = await start()
    xhr.fail()
    await expect(promise).rejects.toBeInstanceOf(TypeError)
  })
})
