import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { CATEGORY_DEFS } from '@gwc/contracts/marketplace'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, memberSnapshot } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'

/**
 * Publishing a listing from the member tab.
 *
 * Pins the defects a member hit: the compose form mounted before the
 * categories arrived and kept `category: ''` forever, so it rendered none of
 * the category's fields and every publish failed validation; and a terms
 * fetch that failed was swallowed, leaving a button that did nothing.
 */

// jsdom has no object URLs; the picker's previews need one per file.
beforeEach(() => {
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:preview-${(n += 1)}`)
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) => ({
  body: JSON.stringify(body), status, headers: { 'content-type': 'application/json' },
})

type Call = { url: string; body: unknown }

function routes({ termsFail = false, failUploads = 0 }: { termsFail?: boolean; failUploads?: number } = {}) {
  const calls: Call[] = []
  const record = (url: string, handler: RouteHandler): RouteHandler => (options) => {
    calls.push({ url, body: options.body })
    return handler(options)
  }
  let asset = 0
  const extraRoutes: Record<string, RouteHandler> = {
    '/marketplace/categories': () => json({ categories: Object.values(CATEGORY_DEFS), vehicleFeatures: [] }),
    '/marketplace/listings': (options) => {
      if (options.method === 'POST') {
        calls.push({ url: 'POST /marketplace/listings', body: JSON.parse(String(options.body)) })
        return json({ id: 'listing-1' }, 201)
      }
      return json({ items: [], nextCursor: null })
    },
    '/marketplace/terms': () => (termsFail
      ? json({ type: 'https://german-world-club.com/problems/internal', title: 'x', status: 500 }, 500)
      : json({ version: 'v1', acceptedVersion: 'v1' })),
    '/media': record('POST /media', () => (failUploads-- > 0
      ? json({ type: 'https://german-world-club.com/problems/internal', title: 'x', status: 500 }, 500)
      : json({ id: `asset-${(asset += 1)}`, state: 'ready' }, 201))),
    '/marketplace/listings/listing-1/media': record('POST attach', () => json({ ok: true }, 201)),
  }
  return { calls, extraRoutes }
}

const poster = () => ({ ...memberSnapshot(), permissions: ['marketplace_post'] })

async function fillBasics() {
  fireEvent.change(await screen.findByLabelText(t.memberMarketplace.titleField), { target: { value: 'BMW 320d Touring' } })
  fireEvent.change(screen.getByLabelText(t.memberMarketplace.body), { target: { value: 'Scheckheftgepflegt, zweite Hand.' } })
}

describe('publishing from the member tab', () => {
  it('starts on the first category once the categories arrive, and posts it', async () => {
    const { calls, extraRoutes } = routes()
    mockCapabilityFetch(poster(), { extraRoutes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    // The category's own required field is on screen — the form knows its
    // category. Before the fix nothing below DESCRIPTION rendered.
    expect(await screen.findByLabelText('make *')).toBeInTheDocument()

    await fillBasics()
    fireEvent.change(screen.getByLabelText('make *'), { target: { value: 'BMW' } })
    fireEvent.click(screen.getByRole('button', { name: t.memberMarketplace.submit }))

    await waitFor(() => expect(screen.getByText(t.memberMarketplace.posted)).toBeInTheDocument())
    const created = calls.find((c) => c.url === 'POST /marketplace/listings')!.body as Record<string, unknown>
    expect(created.category).toBe('vehicle')
    expect(created.details).toEqual({ make: 'BMW' })
  })

  it('says so when the terms cannot be loaded, and keeps publish disabled', async () => {
    const { extraRoutes } = routes({ termsFail: true })
    mockCapabilityFetch(poster(), { extraRoutes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    expect(await screen.findByText(t.memberMarketplace.loadFailed)).toBeInTheDocument()
    await fillBasics()
    expect(screen.getByRole('button', { name: t.memberMarketplace.submit })).toBeDisabled()
  })

  it('uploads each file with its description, then attaches it to the new listing in order', async () => {
    const { calls, extraRoutes } = routes()
    mockCapabilityFetch(poster(), { extraRoutes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    await screen.findByLabelText('make *')
    await fillBasics()
    fireEvent.change(screen.getByLabelText('make *'), { target: { value: 'BMW' } })

    const files = [
      new File(['a'], 'front.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'interior.jpg', { type: 'image/jpeg' }),
    ]
    fireEvent.change(screen.getByLabelText(t.memberMarketplace.media), { target: { files } })

    // A missing description is refused before anything is created.
    fireEvent.click(screen.getByRole('button', { name: t.memberMarketplace.submit }))
    expect(await screen.findByText(t.memberMarketplace.mediaAltMissing)).toBeInTheDocument()
    expect(calls.some((c) => c.url === 'POST /marketplace/listings')).toBe(false)

    const alts = screen.getAllByLabelText(t.memberMarketplace.mediaAlt)
    fireEvent.change(alts[0]!, { target: { value: 'Front view' } })
    fireEvent.change(alts[1]!, { target: { value: 'Interior' } })
    fireEvent.click(screen.getByRole('button', { name: t.memberMarketplace.submit }))

    await waitFor(() => expect(screen.getByText(t.memberMarketplace.posted)).toBeInTheDocument())

    const uploads = calls.filter((c) => c.url === 'POST /media').map((c) => c.body as FormData)
    expect(uploads.map((f) => f.get('alt'))).toEqual(['Front view', 'Interior'])
    expect(uploads.map((f) => (f.get('file') as File).name)).toEqual(['front.jpg', 'interior.jpg'])
    // The server reads the fields before the file part, so alt comes first.
    expect([...uploads[0]!.keys()]).toEqual(['alt', 'file'])

    const attached = calls.filter((c) => c.url === 'POST attach').map((c) => JSON.parse(String(c.body)))
    expect(attached).toEqual([{ assetId: 'asset-1' }, { assetId: 'asset-2' }])
  })

  it('offers a visible way to choose files, with a preview and a cover marker', async () => {
    const { extraRoutes } = routes()
    mockCapabilityFetch(poster(), { extraRoutes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    // The defect: a bare file input rendered as text with nothing clickable.
    expect(await screen.findByRole('button', { name: t.memberMarketplace.mediaChoose })).toBeEnabled()

    fireEvent.change(screen.getByLabelText(t.memberMarketplace.media), {
      target: { files: [new File(['a'], 'front.jpg', { type: 'image/jpeg' }), new File(['b'], 'tour.mp4', { type: 'video/mp4' })] },
    })
    expect(await screen.findByText('front.jpg')).toBeInTheDocument()
    expect(screen.getByText('tour.mp4')).toBeInTheDocument()
    expect(document.querySelector('img[src="blob:preview-1"]')).not.toBeNull()
    expect(document.querySelector('video[src="blob:preview-2"]')).not.toBeNull()
    expect(screen.getAllByText(t.memberMarketplace.mediaCover)).toHaveLength(1)
  })

  it('refuses a file type the server would refuse, without adding it', async () => {
    const { extraRoutes } = routes()
    mockCapabilityFetch(poster(), { extraRoutes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    await screen.findByRole('button', { name: t.memberMarketplace.mediaChoose })
    fireEvent.change(screen.getByLabelText(t.memberMarketplace.media), {
      target: { files: [new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })] },
    })
    expect(await screen.findByText(t.memberMarketplace.mediaUnsupported)).toBeInTheDocument()
    expect(screen.queryByText('logo.svg')).toBeNull()
  })

  it('uploads in the order shown, so "make cover" changes what represents the listing', async () => {
    const { calls, extraRoutes } = routes()
    mockCapabilityFetch(poster(), { extraRoutes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    await screen.findByLabelText('make *')
    await fillBasics()
    fireEvent.change(screen.getByLabelText('make *'), { target: { value: 'BMW' } })
    fireEvent.change(screen.getByLabelText(t.memberMarketplace.media), {
      target: { files: [new File(['a'], 'front.jpg', { type: 'image/jpeg' }), new File(['b'], 'side.jpg', { type: 'image/jpeg' })] },
    })
    fireEvent.click(await screen.findByRole('button', { name: t.memberMarketplace.mediaMakeCover }))

    const alts = screen.getAllByLabelText(t.memberMarketplace.mediaAlt)
    fireEvent.change(alts[0]!, { target: { value: 'Side' } })
    fireEvent.change(alts[1]!, { target: { value: 'Front' } })
    fireEvent.click(screen.getByRole('button', { name: t.memberMarketplace.submit }))

    await waitFor(() => expect(screen.getByText(t.memberMarketplace.posted)).toBeInTheDocument())
    const names = calls.filter((c) => c.url === 'POST /media').map((c) => ((c.body as FormData).get('file') as File).name)
    expect(names).toEqual(['side.jpg', 'front.jpg'])
  })

  it('keeps a failed file and retries it against the same listing', async () => {
    const { calls, extraRoutes } = routes({ failUploads: 1 })
    mockCapabilityFetch(poster(), { extraRoutes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    await screen.findByLabelText('make *')
    await fillBasics()
    fireEvent.change(screen.getByLabelText('make *'), { target: { value: 'BMW' } })
    fireEvent.change(screen.getByLabelText(t.memberMarketplace.media), {
      target: { files: [new File(['a'], 'front.jpg', { type: 'image/jpeg' })] },
    })
    fireEvent.change(screen.getByLabelText(t.memberMarketplace.mediaAlt), { target: { value: 'Front' } })
    fireEvent.click(screen.getByRole('button', { name: t.memberMarketplace.submit }))

    expect(await screen.findByText(t.memberMarketplace.mediaFailed)).toBeInTheDocument()
    expect(screen.getByText(t.memberMarketplace.mediaStatus.failed)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t.memberMarketplace.mediaRetry }))
    await waitFor(() => expect(screen.queryByText('front.jpg')).toBeNull())

    // One listing, not two: the retry attached to the listing that exists.
    expect(calls.filter((c) => c.url === 'POST /marketplace/listings')).toHaveLength(1)
    expect(calls.filter((c) => c.url === 'POST attach').map((c) => JSON.parse(String(c.body)))).toEqual([{ assetId: 'asset-1' }])
  })
})
