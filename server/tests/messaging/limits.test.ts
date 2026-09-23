import { describe, it, expect } from 'vitest'
import { BUCKETS } from '../../src/config/rate-limits.ts'
import { PROBLEMS } from '@gwc/contracts/errors'

/**
 * Two limits in one feature, and they are not the same kind of thing.
 *
 * - **Message volume is a transport limit.** Exceeding it answers **429**:
 *   wait, and it will work. It belongs in the rate limiter.
 * - **The listing cap is a business quota.** Exceeding it answers **422**:
 *   retrying changes nothing until the member withdraws something. It lives in
 *   PostgreSQL under a row lock via `db/counters.ts`, because it must be exact
 *   under concurrency, survive a Redis flush, and be auditable.
 *
 * Both are in feature 008 and flattening them together is the easy mistake —
 * which is why they are asserted side by side rather than in their own files.
 * A 429 on a listing cap would tell a client to retry forever; a 422 on
 * message volume would tell it to give up on something that would have worked.
 */

describe('message volume is a rate limit', () => {
  it('has a bucket, dimensioned per account', () => {
    const bucket = BUCKETS.messages
    expect(bucket, 'no `messages` bucket — message volume is unlimited').toBeTruthy()
    // Per account, not per address: flooding is harassment by a person, and a
    // household behind one address is not one sender.
    expect(bucket.dimension).toBe('account')
  })

  it('does not fail open', () => {
    // Explicit, because `assertBuckets` only checks that the field is a boolean
    // — it cannot know which answer is right for this bucket.
    expect(BUCKETS.messages.skipOnError).toBe(false)
  })

  it('is the 429 problem, not the 422 one', () => {
    expect(PROBLEMS.RATE_LIMITED.status).toBe(429)
  })
})

describe('the listing cap is a quota, not a rate limit', () => {
  it('answers 422', () => {
    expect(PROBLEMS.QUOTA_EXCEEDED.status).toBe(422)
  })

  it('has NO rate-limit bucket of its own', () => {
    // The assertion that keeps them apart. A `listings` bucket appearing here
    // would mean someone had moved the business quota into the limiter, where
    // it would stop being exact under concurrency and stop surviving a Redis
    // flush.
    expect(Object.keys(BUCKETS)).not.toContain('listings')
    expect(Object.keys(BUCKETS)).not.toContain('marketplace-listings')
  })

  it('and the two statuses are genuinely different', () => {
    // The counter-assertion for the whole file: if these ever became equal,
    // every test above would still pass while the distinction was gone.
    expect(PROBLEMS.QUOTA_EXCEEDED.status).not.toBe(PROBLEMS.RATE_LIMITED.status)
  })
})
