import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Feature 042, research R2: the club's offer fallback image is bundled with each
 * client (so it appears without a network request), which means there are two
 * copies. They must be the same file; this is what stops them drifting.
 */
const WEB = join(process.cwd(), 'src', 'assets', 'offer-fallback.webp')
const APP = join(process.cwd(), '..', 'expo-client', 'german-world-club', 'assets', 'offer-fallback.webp')

const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

describe('the offer fallback image', () => {
  it('is present in both clients and not empty', () => {
    expect(readFileSync(WEB).length, `missing or empty: ${WEB}`).toBeGreaterThan(0)
    expect(readFileSync(APP).length, `missing or empty: ${APP}`).toBeGreaterThan(0)
  })

  it('is byte-identical in the web client and the app', () => {
    expect(digest(APP), `${APP} has drifted from ${WEB}`).toBe(digest(WEB))
  })

  it('is a WebP file (RIFF....WEBP)', () => {
    const head = readFileSync(WEB).subarray(0, 12)
    expect(head.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(head.subarray(8, 12).toString('ascii')).toBe('WEBP')
  })
})
