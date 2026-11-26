import { describe, it, expect } from 'vitest'
import { ACCEPTED_MEDIA_TYPES, isAcceptedMediaType, sniffImageType } from './media.ts'

/**
 * `sniffImageType` is how the app tells what a picked photo REALLY is before it
 * decides to upload or refuse it (feature 037, research R12). Wrong in either
 * direction is costly: calling a JPEG "HEIC" blocks a valid photo, and calling a
 * HEIC "JPEG" wastes an upload that the server will refuse. So both directions
 * are pinned, with the real byte layouts.
 */

const bytes = (...parts: Array<number | string>) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === 'number' ? [p] : [...p].map((c) => c.charCodeAt(0)))))
/** An ISO base media header: a 4-byte size, `ftyp`, then the major brand. */
const ftyp = (brand: string) => bytes(0, 0, 0, 24, 'ftyp', brand, 0, 0, 0, 0, 'mif1', brand)

describe('sniffImageType', () => {
  it('recognises the formats the club accepts, by their bytes', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, 'JFIF'))).toBe('image/jpeg')
    expect(sniffImageType(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13))).toBe('image/png')
    expect(sniffImageType(bytes('RIFF', 1, 2, 3, 4, 'WEBPVP8 '))).toBe('image/webp')
    expect(sniffImageType(ftyp('avif'))).toBe('image/avif')
    expect(sniffImageType(ftyp('avis'))).toBe('image/avif')
  })

  it.each(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'])('calls a %s-brand file HEIC, as an iPhone photo is', (brand) => {
    expect(sniffImageType(ftyp(brand))).toBe('image/heic')
  })

  it.each(['mif1', 'msf1'])('calls a %s-brand file HEIF', (brand) => {
    expect(sniffImageType(ftyp(brand))).toBe('image/heif')
  })

  it('looks at the bytes and not at a name: a JPEG is a JPEG whatever it is called', () => {
    // There is no name in the signature, so there is nothing for a `.heic` label to mislead.
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xdb, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('image/jpeg')
  })

  it('does not know video, text or anything short, and says null, never "unsupported"', () => {
    expect(sniffImageType(ftyp('isom'))).toBeNull() // an MP4
    expect(sniffImageType(ftyp('qt  '))).toBeNull() // a MOV
    expect(sniffImageType(bytes('just some text here'))).toBeNull()
    expect(sniffImageType(bytes())).toBeNull()
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeNull()
    expect(sniffImageType(bytes('RIFF', 0, 0, 0, 0, 'WAVEfmt '))).toBeNull() // RIFF but not WebP
  })
})

describe('the accepted media types', () => {
  it('are exactly what the server accepts, and exclude the iPhone formats', () => {
    expect(Object.keys(ACCEPTED_MEDIA_TYPES).sort()).toEqual([
      'image/avif', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm',
    ])
    expect(isAcceptedMediaType('image/heic')).toBe(false)
    expect(isAcceptedMediaType('image/heif')).toBe(false)
  })

  it('treat what the sniffer calls an accepted type as accepted, and HEIC as not', () => {
    expect(isAcceptedMediaType(sniffImageType(bytes(0xff, 0xd8, 0xff, 0)))).toBe(true)
    expect(isAcceptedMediaType(sniffImageType(ftyp('heic')))).toBe(false)
  })
})
