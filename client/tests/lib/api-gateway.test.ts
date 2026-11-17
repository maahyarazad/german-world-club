import { describe, it, expect, afterEach, vi } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { get, ApiError } from '../../src/lib/api'

/**
 * A reverse proxy's own error page (feature 024, User Story 2).
 *
 * When Node is down or restarting, nginx answers 502/503/504 with HTML. That
 * page has no problem type, and the console used to show its status text —
 * "Bad Gateway" — which an applicant cannot act on. It is now read as the
 * translated service-unavailable problem, keeping the real status.
 */

afterEach(() => vi.unstubAllGlobals())

const answer = (status: number, statusText: string, body: string, contentType: string) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, statusText, headers: { 'content-type': contentType } })))

const refusal = async () => {
  const error = await get('/x').catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

describe('a gateway error page', () => {
  for (const [status, text] of [[502, 'Bad Gateway'], [503, 'Service Unavailable'], [504, 'Gateway Timeout']] as const) {
    it(`reads a non-problem ${status} as service-unavailable, keeping the status`, async () => {
      answer(status, text, `<html><body>${text}</body></html>`, 'text/html')
      const error = await refusal()
      expect(error.problem.type).toBe(PROBLEMS.SERVICE_UNAVAILABLE.type)
      expect(error.status).toBe(status)
      expect(error.described.title).not.toBe(text)
    })
  }

  it('keeps a real problem response sent with 503 — the counter-assertion', async () => {
    answer(503, 'Service Unavailable', JSON.stringify({ ...PROBLEMS.REQUEST_DEADLINE_EXCEEDED }), 'application/problem+json')
    expect((await refusal()).problem.type).toBe(PROBLEMS.REQUEST_DEADLINE_EXCEEDED.type)
  })

  it('leaves a non-problem 404 to the existing fallback', async () => {
    answer(404, 'Not Found', '<html>nope</html>', 'text/html')
    expect((await refusal()).problem.type).toBe('about:blank')
  })
})
