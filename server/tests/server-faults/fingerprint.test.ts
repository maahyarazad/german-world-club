import { describe, it, expect } from 'vitest'
import { fingerprintOf, firstAppFrame } from '../../src/modules/server-faults/application/fingerprint.ts'

/**
 * Feature 012, research R5: the same bug groups together across deploys; a
 * different bug does not.
 */
const stackAt = (line: number, fn = 'createPost', file = 'modules/threads/application/compose.ts') => [
  'Error: boom',
  '    at Object.query (/srv/app/node_modules/pg/lib/client.js:525:17)',
  `    at ${fn} (/srv/app/server/src/${file}:${line}:15)`,
  '    at async handler (/srv/app/server/src/modules/threads/controller.ts:40:9)',
].join('\n')

const base = { errorName: 'Error', errorCode: null, method: 'POST', route: '/threads/posts' }

describe('fingerprintOf', () => {
  it('names the first frame of our own code, relative and without positions', () => {
    expect(firstAppFrame(stackAt(120))).toBe('at createPost (modules/threads/application/compose.ts)')
    expect(firstAppFrame(null)).toBe('')
  })

  it('is stable when only line numbers move', () => {
    const a = fingerprintOf({ ...base, stack: stackAt(120) })
    const b = fingerprintOf({ ...base, stack: stackAt(187) })
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toBe(b)
  })

  it('differs when the route or the first app frame differs', () => {
    // Counter-assertion: a constant fingerprint would pass the test above.
    const a = fingerprintOf({ ...base, stack: stackAt(120) })
    expect(fingerprintOf({ ...base, route: '/threads/posts/:id/replies', stack: stackAt(120) })).not.toBe(a)
    expect(fingerprintOf({ ...base, stack: stackAt(120, 'createReply', 'modules/threads/application/reply.ts') })).not.toBe(a)
    expect(fingerprintOf({ ...base, errorName: 'TypeError', stack: stackAt(120) })).not.toBe(a)
  })
})
