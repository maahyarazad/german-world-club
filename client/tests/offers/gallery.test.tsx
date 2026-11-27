import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { MediaItem } from '@gwc/contracts/media'
import { LocaleProvider } from '../../src/i18n/index'
import { t as de } from '../../src/i18n/de'
import { OfferGallery } from '../../src/offers/OfferGallery'

/**
 * Feature 042, US1: the swipeable 16:9 gallery on an offer's detail page
 * (FR-002 to FR-006).
 *
 * jsdom has no layout, no `scrollTo` and no `matchMedia` (see the feature 041
 * notes in CLAUDE.md), so the component must call them defensively and this
 * file supplies stand-ins. What is asserted is what the component decides: which
 * slide is current, which controls exist, and which scroll behaviour it asks
 * for. That the browser then snaps is CSS and is covered by the quickstart.
 */

const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const image = (n: number): MediaItem => ({
  assetId: id(n), kind: 'image', alt: `Bild ${n}`, width: 1600, height: 900, durationMs: null,
  variants: [{ variant: 'medium', format: 'webp', width: 960, height: 540, url: `/media/img${n}/medium.webp` }],
  posterUrl: null,
})
const video = (n: number): MediaItem => ({
  assetId: id(n), kind: 'video', alt: `Video ${n}`, width: 1280, height: 720, durationMs: 4000,
  variants: [{ variant: 'video', format: 'webm', width: 1280, height: 720, url: `/media/vid${n}/video.webm` }],
  posterUrl: `/media/vid${n}/poster.webp`,
})

let scrollTo: ReturnType<typeof vi.fn>
beforeEach(() => {
  scrollTo = vi.fn()
  Object.defineProperty(Element.prototype, 'scrollTo', { value: scrollTo, configurable: true, writable: true })
})
afterEach(() => {
  delete (Element.prototype as unknown as { scrollTo?: unknown }).scrollTo
  delete (window as unknown as { matchMedia?: unknown }).matchMedia
  vi.unstubAllGlobals()
})

const show = (media: MediaItem[], extra: Partial<React.ComponentProps<typeof OfferGallery>> = {}) =>
  render(<LocaleProvider initialLocale="de"><OfferGallery media={media} {...extra} /></LocaleProvider>)

const dot = (n: number, total: number) =>
  screen.getByRole('button', { name: de.clubOffers.gallery.slide.replace('{n}', String(n)).replace('{total}', String(total)) })

describe('OfferGallery', () => {
  it('shows every item as a slide with a dot each, the first current, in a labelled carousel', () => {
    show([image(1), image(2), image(3)])
    expect(screen.getByRole('region', { name: de.clubOffers.gallery.region }).getAttribute('aria-roledescription')).toBe('carousel')
    expect(screen.getAllByRole('group')).toHaveLength(3)
    expect(dot(1, 3).getAttribute('aria-current')).toBe('true')
    expect(dot(2, 3).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('button', { name: de.clubOffers.gallery.previous })).toBeTruthy()
    expect(screen.getByRole('button', { name: de.clubOffers.gallery.next })).toBeTruthy()
  })

  it('pages with the next and previous buttons and the dots, asking the track to scroll', () => {
    show([image(1), image(2), image(3)])
    fireEvent.click(screen.getByRole('button', { name: de.clubOffers.gallery.next }))
    expect(dot(2, 3).getAttribute('aria-current')).toBe('true')
    expect(dot(1, 3).getAttribute('aria-current')).toBeNull()
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'smooth' }))

    fireEvent.click(dot(3, 3))
    expect(dot(3, 3).getAttribute('aria-current')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: de.clubOffers.gallery.previous }))
    expect(dot(2, 3).getAttribute('aria-current')).toBe('true')
  })

  it('disables previous on the first slide and next on the last, so it cannot page past the ends', () => {
    show([image(1), image(2)])
    expect((screen.getByRole('button', { name: de.clubOffers.gallery.previous }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: de.clubOffers.gallery.next }))
    expect((screen.getByRole('button', { name: de.clubOffers.gallery.next }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: de.clubOffers.gallery.previous }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('pages with the arrow keys on the focused track', () => {
    show([image(1), image(2), image(3)])
    const track = screen.getByTestId('offer-gallery-track')
    fireEvent.keyDown(track, { key: 'ArrowRight' })
    expect(dot(2, 3).getAttribute('aria-current')).toBe('true')
    fireEvent.keyDown(track, { key: 'ArrowRight' })
    fireEvent.keyDown(track, { key: 'ArrowRight' }) // past the end: stays on the last
    expect(dot(3, 3).getAttribute('aria-current')).toBe('true')
    fireEvent.keyDown(track, { key: 'ArrowLeft' })
    expect(dot(2, 3).getAttribute('aria-current')).toBe('true')
  })

  it('follows a swipe: the current dot is read from the scroll position', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1 })
    show([image(1), image(2), image(3)])
    const track = screen.getByTestId('offer-gallery-track')
    Object.defineProperty(track, 'clientWidth', { value: 400, configurable: true })
    Object.defineProperty(track, 'scrollLeft', { value: 800, configurable: true, writable: true })
    fireEvent.scroll(track)
    expect(dot(3, 3).getAttribute('aria-current')).toBe('true')
  })

  it('shows no dots and no paging buttons for a single item', () => {
    show([image(1)])
    // Counter-assertion to the first test: the controls come from there being >= 2 items.
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getAllByRole('group')).toHaveLength(1)
  })

  it('shows the club fallback, and no carousel, for an offer with no media', () => {
    const { container } = show([])
    expect(screen.queryByRole('region')).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(container.querySelector('img')!.getAttribute('src')).toContain('offer-fallback')
  })

  it('shows a video as its still picture and plays it muted only when asked, and stops it on leaving', () => {
    const { container } = show([video(1), image(2)])
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector(`img[src="/media/vid1/poster.webp"]`)).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: de.clubOffers.gallery.play }))
    const playing = container.querySelector('video')!
    expect(playing).not.toBeNull()
    expect(playing.muted).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: de.clubOffers.gallery.next }))
    expect(container.querySelector('video')).toBeNull()

    // Coming back shows the still again; it does not resume by itself.
    fireEvent.click(screen.getByRole('button', { name: de.clubOffers.gallery.previous }))
    expect(container.querySelector('video')).toBeNull()
    expect(screen.getByRole('button', { name: de.clubOffers.gallery.play })).toBeTruthy()
  })

  it('does not animate the scrolling when the person prefers reduced motion', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} }) as never
    show([image(1), image(2)])
    fireEvent.click(screen.getByRole('button', { name: de.clubOffers.gallery.next }))
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'auto' }))
  })

  it('renders an action for the current item, and moves it with the slide', () => {
    show([image(1), image(2)], {
      renderAction: (item, index) => <span data-testid="action">{item.assetId}:{index}</span>,
    })
    expect(screen.getByTestId('action').textContent).toBe(`${id(1)}:0`)
    fireEvent.click(screen.getByRole('button', { name: de.clubOffers.gallery.next }))
    expect(screen.getByTestId('action').textContent).toBe(`${id(2)}:1`)
  })

  it('draws every slide in a 16:9 frame', () => {
    const { container } = show([image(1), image(2)])
    expect(container.querySelector('[data-aspect="16/9"]')).not.toBeNull()
  })
})
