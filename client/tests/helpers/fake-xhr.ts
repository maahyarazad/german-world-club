import { vi } from 'vitest'

/**
 * A stand-in for `XMLHttpRequest`, for `upload()` in src/lib/api.ts (feature
 * 021, Story 6).
 *
 * jsdom's own XHR would try the network. This one records what was asked of it
 * and lets a test play the server: fire upload progress, the end of the body,
 * and a response. Every instance is kept in `FakeXhr.instances`, newest last,
 * so a retry is a second instance a test can answer separately.
 */
type Handler = ((event: ProgressEvent) => void) | null

export class FakeXhr {
  static instances: FakeXhr[] = []

  method = ''
  url = ''
  withCredentials = false
  requestHeaders: Record<string, string> = {}
  body: unknown = undefined
  sent = false
  aborted = false

  status = 0
  statusText = ''
  responseText = ''
  private responseHeaders: Record<string, string> = {}

  onload: Handler = null
  onerror: Handler = null
  onabort: Handler = null
  upload: { onprogress: Handler; onload: Handler } = { onprogress: null, onload: null }

  constructor() { FakeXhr.instances.push(this) }

  open(method: string, url: string) { this.method = method; this.url = url }
  setRequestHeader(name: string, value: string) { this.requestHeaders[name.toLowerCase()] = value }
  send(body?: unknown) { this.body = body; this.sent = true }
  abort() { this.aborted = true; this.onabort?.(new ProgressEvent('abort')) }
  getResponseHeader(name: string) { return this.responseHeaders[name.toLowerCase()] ?? null }

  // ---- The test plays the server -----------------------------------------

  progress(loaded: number, total: number, lengthComputable = true) {
    this.upload.onprogress?.(new ProgressEvent('progress', { loaded, total, lengthComputable }))
  }

  bodySent() { this.upload.onload?.(new ProgressEvent('load')) }

  respond(status: number, body: unknown, contentType = 'application/json') {
    this.status = status
    this.statusText = String(status)
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body)
    this.responseHeaders = { 'content-type': contentType }
    this.onload?.(new ProgressEvent('load'))
  }

  fail() { this.onerror?.(new ProgressEvent('error')) }
}

export function installFakeXhr() {
  FakeXhr.instances = []
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  return FakeXhr
}

/** The newest request, once it has been sent. */
export const lastXhr = () => FakeXhr.instances[FakeXhr.instances.length - 1]!
