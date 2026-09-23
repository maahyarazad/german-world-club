import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildAuthApp } from '../helpers/auth.ts'
import { surfaceByName, disallowedPrefixes } from '../../src/modules/seo/surfaces.ts'
import { BUCKETS } from '../../src/config/rate-limits.ts'
import { ROUTE_BUDGETS, OUTBOUND } from '../../src/config/budgets.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The public question-answering endpoint.
 *
 * The model call itself is not exercised here — it needs pgai, Ollama and a
 * live Anthropic key, none of which belong in a unit run. What IS asserted is
 * everything that decides whether the route is safe to leave unauthenticated:
 * the posture it declares, the bounds on what a stranger may send, and the
 * limiter's failure behaviour.
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

const ask = (payload: unknown) =>
  app.inject({ method: 'POST', url: '/rag/ask', payload: payload as never })

describe('the route is reachable without a credential', () => {
  it('declares the public audience', () => {
    const route = app.routePostures().find((r) => r.url === '/rag/ask')
    expect(route, 'the route did not register at all').toBeTruthy()
    expect(route?.auth.audience).toBe('public')
  })

  it('does not answer 401 to an anonymous caller', async () => {
    // The point of the route. It may fail for want of a model provider in this
    // environment, but it must never refuse for want of a credential.
    const response = await ask({ prompt: 'How long do I have to return something?' })
    expect(response.statusCode).not.toBe(401)
    expect(response.statusCode).not.toBe(403)
  })
})

describe('what a stranger may send', () => {
  it('refuses an empty prompt', async () => {
    expect((await ask({ prompt: '' })).statusCode).toBe(400)
  })

  it('refuses a prompt past the ceiling', async () => {
    // The ceiling is what stops a long paste running up a bill, so it is
    // enforced by the schema — before a connection is taken from the pool.
    expect((await ask({ prompt: 'x'.repeat(2001) })).statusCode).toBe(400)
  })

  it('refuses a body with no prompt at all', async () => {
    expect((await ask({})).statusCode).toBe(400)
  })

  it('ACCEPTS a reasonable prompt — the counter-assertion', async () => {
    // Without this the three refusals above would pass against a route that
    // rejected everything, which would look like working validation.
    const response = await ask({ prompt: 'How long do I have to return something?' })
    expect(response.statusCode).not.toBe(400)
  })
})

describe('the declarations that make it safe to expose', () => {
  it('rate-limits per address and does NOT fail open', () => {
    const bucket = BUCKETS['rag-ask']
    expect(bucket.dimension).toBe('ip')
    // The load-bearing half. `public-read` sets this true because a 429 to a
    // crawler costs partner visibility; here an unavailable limiter must mean
    // refusal, because the request costs money.
    expect(bucket.skipOnError).toBe(false)
  })

  it('keeps Σ(outbound budgets) under its deadline', () => {
    const { deadlineMs, calls } = ROUTE_BUDGETS.rag
    const total = calls.reduce((sum, call) => sum + (OUTBOUND[call] ?? 0), 0)
    expect(total).toBeLessThan(deadlineMs)
  })

  it('is public but never indexed', () => {
    const surface = surfaceByName('rag')
    expect(surface?.public).toBe(true)
    expect(surface?.indexed).toBe(false)
  })

  it('stays fetchable — noindex, not Disallow', () => {
    // Public-but-not-indexed surfaces must not be disallowed: Disallow stops
    // the fetch, which would break the route for a legitimate client, while
    // noindex is what keeps generated answers out of search results.
    expect(disallowedPrefixes()).not.toContain('/rag')
  })
})
