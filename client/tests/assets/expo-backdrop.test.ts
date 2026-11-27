import { describe, it, expect } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Feature 043 (US4, research R12 and R13): the app's backdrop follows the phone's light and
 * dark setting, from two PHONE-SIZED copies of the supplied art, with a wash that keeps text
 * readable. The Expo app has no test runner, so this reads its source from here, as
 * `fallback-parity.test.ts` does for the offer fallback image.
 *
 * What it stops:
 *  - Someone pointing the backdrop at a 4875 x 10550 original. Decoding one costs hundreds of
 *    megabytes on a phone (4875 x 10550 x 4 bytes is about 205 MB) for no visible gain, and
 *    nothing at runtime would say why the app became slow or was killed.
 *  - A wash that is not a colour (an empty string was written once), or one lowered until
 *    secondary text on the dark art is unreadable (measured: 2.4:1 with no wash, 5.2:1 with the
 *    0.5 black one, against a 4.5:1 minimum).
 */
const APP = join(process.cwd(), '..', 'expo-client', 'german-world-club')
const ASSETS = join(APP, 'assets')

const MAX_WIDTH = 1242 // an iPhone Pro Max's width in pixels: more than any phone needs
const MAX_BYTES = 1.5 * 1024 * 1024
const COPIES = ['main-bg-light-phone.png', 'main-bg-dark-phone.png']

/** The width in pixels, from a PNG's IHDR chunk (a big-endian uint32 at byte 16). */
const pngWidth = (file: string) => {
  const head = readFileSync(file).subarray(0, 24)
  expect(head.subarray(0, 8).toString('hex'), `${file} is not a PNG`).toBe('89504e470d0a1a0a')
  return head.readUInt32BE(16)
}

/** The paths given to `require(...)` in a source file: code only, so a comment may name an original freely. */
const requiredPaths = (source: string) => [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]!)

const isOriginal = (path: string) => /-01\.png$|main_bg\.png$|main-bg-phone\.png$/.test(path)

describe('the phone-sized backdrops', () => {
  it.each(COPIES)('%s exists, is a PNG no wider than a phone, and is small', (name) => {
    const file = join(ASSETS, name)
    expect(pngWidth(file), `${name} is wider than a phone needs`).toBeLessThanOrEqual(MAX_WIDTH)
    expect(statSync(file).size, `${name} is larger than 1.5 MB`).toBeLessThanOrEqual(MAX_BYTES)
  })
})

describe('what AppBackground draws', () => {
  const source = readFileSync(join(APP, 'src', 'components', 'app-background.tsx'), 'utf8')

  it('requires exactly the two phone-sized copies, one per colour scheme', () => {
    expect(requiredPaths(source).map((p) => p.split('/').pop()).sort()).toEqual([...COPIES].sort())
  })

  it('never requires an original', () => {
    expect(requiredPaths(source).filter(isOriginal)).toEqual([])
  })

  // The counter-assertion: the extractor and the matcher above really do catch what they guard
  // against, so "no originals" is not true merely because nothing was looked at.
  it('would notice an original if one were required', () => {
    const bad = `const a = require('../../assets/main-bg-dark-01.png'); const b = require("../../assets/main_bg.png")`
    expect(requiredPaths(bad).filter(isOriginal)).toHaveLength(2)
    // ...and ignores a comment that merely names one.
    expect(requiredPaths(`// the original, main-bg-dark-01.png, is never loaded`)).toEqual([])
  })
})

describe('the wash over the backdrop', () => {
  const theme = readFileSync(join(APP, 'src', 'constants', 'theme.ts'), 'utf8')
  const block = theme.match(/export const BackdropScrim = \{([\s\S]*?)\} as const/)
  const entries = Object.fromEntries([...(block?.[1] ?? '').matchAll(/(\w+):\s*'([^']*)'/g)].map((m) => [m[1]!, m[2]!]))

  const COLOUR = [
    /^transparent$/,
    /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
    /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/,
  ]
  const isColour = (value: string) => COLOUR.some((re) => re.test(value))

  it('has a value for each colour scheme', () => {
    expect(Object.keys(entries).sort()).toEqual(['dark', 'light'])
  })

  it('is a valid colour in each, never an empty string ("no wash" is written transparent)', () => {
    for (const [scheme, value] of Object.entries(entries)) {
      expect(isColour(value), `BackdropScrim.${scheme} = ${JSON.stringify(value)} is not a colour`).toBe(true)
    }
  })

  // The decision of research R13: the light art is cream with fine gold lines and text is already
  // 16.6:1 on it, so a white veil (the old 0.72 one, written for grey art) would only bleach the
  // lines. If the art or the text colours change, re-measure and change this test with R13.
  it('puts no wash over the light art', () => {
    expect(entries.light).toBe('transparent')
  })

  it('keeps the dark wash at 0.45 or darker, which is what keeps secondary text readable on the dark art', () => {
    const alpha = Number(/rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(entries.dark ?? '')?.[1])
    expect(alpha, 'BackdropScrim.dark must be an rgba() black wash (research R13)').toBeGreaterThanOrEqual(0.45)
  })

  it('would notice an empty or lowered wash', () => {
    expect(isColour('')).toBe(false)
    expect(isColour('rgba(0, 0, 0, 0.5)')).toBe(true)
    expect(isColour('transparent')).toBe(true)
  })
})
