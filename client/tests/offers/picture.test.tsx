import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { MediaItem } from '@gwc/contracts/media'
import { OFFER_MEDIA_ASPECT } from '@gwc/contracts/offers'
import { LocaleProvider } from '../../src/i18n/index'
import { t as de } from '../../src/i18n/de'
import { t as en } from '../../src/i18n/en'
import { OfferPicture } from '../../src/offers/OfferPicture'

/**
 * Feature 042, US2: the picture of an offer in a 16:9 frame, or the club's
 * fallback when there is none (FR-001, FR-008, FR-011, research R1/R6).
 *
 * "No usable media" is the server's `null`; this is only what the client draws
 * for it. The counter-assertions matter as much as the positives: a component
 * that always drew the fallback would pass every "shows the fallback" test.
 */

const item = (over: Partial<MediaItem> = {}): MediaItem => ({
  assetId: '00000000-0000-4000-8000-0000000000a1',
  kind: 'image',
  alt: 'Zwei Kaffee auf dem Tisch',
  width: 1600,
  height: 900,
  durationMs: null,
  variants: [
    { variant: 'thumb', format: 'webp', width: 160, height: 90, url: '/media/aaa/thumb.webp' },
    { variant: 'small', format: 'webp', width: 480, height: 270, url: '/media/aaa/small.webp' },
    { variant: 'medium', format: 'webp', width: 960, height: 540, url: '/media/aaa/medium.webp' },
  ],
  posterUrl: null,
  ...over,
})

const renderPicture = (ui: React.ReactElement, locale: 'de' | 'en' = 'de') =>
  render(<LocaleProvider initialLocale={locale}>{ui}</LocaleProvider>)

describe('OfferPicture', () => {
  it('draws the club fallback when there is no media, with its real dimensions and a German description', () => {
    renderPicture(<OfferPicture item={null} />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toContain('offer-fallback')
    expect(img.getAttribute('width')).toBe('1672')
    expect(img.getAttribute('height')).toBe('941')
    expect(img.getAttribute('alt')).toBe(de.clubOffers.fallbackAlt)
  })

  it('describes the fallback in the active interface language', () => {
    renderPicture(<OfferPicture item={undefined} />, 'en')
    expect(screen.getByRole('img').getAttribute('alt')).toBe(en.clubOffers.fallbackAlt)
    expect(en.clubOffers.fallbackAlt).not.toBe(de.clubOffers.fallbackAlt)
  })

  it('draws the offer\'s own picture, not the fallback, when there is one', () => {
    renderPicture(<OfferPicture item={item()} maxWidth={400} />)
    const img = screen.getByRole('img')
    // The smallest variant at least 400 px wide.
    expect(img.getAttribute('src')).toBe('/media/aaa/small.webp')
    expect(img.getAttribute('src')).not.toContain('offer-fallback')
    expect(img.getAttribute('width')).toBe('1600')
    expect(img.getAttribute('height')).toBe('900')
    expect(img.getAttribute('alt')).toBe('Zwei Kaffee auf dem Tisch')
  })

  it('swaps a picture that fails to load for the fallback', () => {
    renderPicture(<OfferPicture item={item()} />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).not.toContain('offer-fallback')
    fireEvent.error(img)
    expect(screen.getByRole('img').getAttribute('src')).toContain('offer-fallback')
    expect(screen.getByRole('img').getAttribute('alt')).toBe(de.clubOffers.fallbackAlt)
  })

  it('tries the next offer\'s picture again after a different item arrives', () => {
    const { rerender } = renderPicture(<OfferPicture item={item()} />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByRole('img').getAttribute('src')).toContain('offer-fallback')

    rerender(
      <LocaleProvider initialLocale="de">
        <OfferPicture item={item({ assetId: '00000000-0000-4000-8000-0000000000b2', alt: 'Anderes' })} />
      </LocaleProvider>,
    )
    expect(screen.getByRole('img').getAttribute('src')).toBe('/media/aaa/medium.webp')
    expect(screen.getByRole('img').getAttribute('alt')).toBe('Anderes')
  })

  it('shows a video through its still picture', () => {
    const video = item({
      kind: 'video', alt: 'Ein Video', durationMs: 4000, variants: [], posterUrl: '/media/vvv/poster.webp',
    })
    renderPicture(<OfferPicture item={video} />)
    expect(screen.getByRole('img').getAttribute('src')).toBe('/media/vvv/poster.webp')
  })

  it('treats an item with nothing to show as having no picture', () => {
    renderPicture(<OfferPicture item={item({ variants: [], posterUrl: null })} />)
    expect(screen.getByRole('img').getAttribute('src')).toContain('offer-fallback')
  })

  it('is a 16:9 frame, taken from the shared contract', () => {
    const { container } = renderPicture(<OfferPicture item={null} />)
    const frame = container.firstElementChild as HTMLElement
    expect(OFFER_MEDIA_ASPECT).toEqual({ width: 16, height: 9 })
    expect(frame.getAttribute('data-aspect')).toBe('16/9')
  })
})
