import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { MERCHANT_IMAGE_MAX_BYTES, MAX_STORE_MEDIA } from '@gwc/contracts/media'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch } from '../helpers/console'

/**
 * A merchant's store page (feature 035): creating it, the limits a person is
 * told about before anything is sent, the full gallery, and the notice when
 * staff have switched the store off.
 */
afterEach(() => vi.unstubAllGlobals())

const merchantSnapshot = () => ({
  kind: 'merchant',
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'Meryem Menne',
  organisationId: '00000000-0000-4000-8000-000000000002',
  organisationName: 'Café Test',
  organisationStatus: 'active',
  role: 'owner',
  available: [],
})

const media = (n: number) => Array.from({ length: n }, (_, i) => ({
  assetId: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`,
  kind: 'image', alt: `Bild ${i + 1}`, width: 1600, height: 1200, durationMs: null, posterUrl: null,
  variants: [{ variant: 'thumb', format: 'webp', width: 160, height: 120, url: `/media/${'a'.repeat(64)}/thumb.webp` }],
}))

const store = (overrides: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000aa', displayName: 'Café Test', logo: null, description: 'Gutes Essen',
  cover: null, media: [], openingHours: 'Mo-Fr 9-18', active: true, deactivationNotice: null,
  version: '2026-11-23T10:00:00.000000Z', ...overrides,
})

const json = (body: unknown, status = 200) => () => ({
  status, body: JSON.stringify(body),
  headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
})

const open = (routes: Record<string, () => { status?: number; body?: string; headers?: Record<string, string> }>) => {
  const fetchMock = mockCapabilityFetch(merchantSnapshot(), { extraRoutes: routes })
  renderConsole(<ConsoleRoutes />, { route: '/konsole/merchant/shop' })
  return fetchMock
}
const asked = (fetchMock: ReturnType<typeof mockCapabilityFetch>, path: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url) === path)

describe('the merchant store page', () => {
  it('offers to create the store when the organisation has none, then creates it', async () => {
    let created = false
    const fetchMock = open({
      '/merchant/store': () => (created
        ? { status: 201, body: JSON.stringify(store()), headers: { 'content-type': 'application/json' } }
        : { status: 404, body: JSON.stringify({ type: 'https://german-world-club.com/problems/offers/store-not-found', title: 'No store yet', status: 404 }), headers: { 'content-type': 'application/problem+json' } }),
    })

    fireEvent.click(await screen.findByRole('button', { name: t.merchantStore.create }))
    created = true
    await waitFor(() => expect(asked(fetchMock, '/merchant/store').some(([, o]) => (o as RequestInit)?.method === 'POST')).toBe(true))
    expect(await screen.findByText(t.merchantStore.saved).catch(() => screen.findByText(t.merchantStore.created))).toBeInTheDocument()
  })

  it('refuses a photo at the limit before sending anything', async () => {
    const fetchMock = open({ '/merchant/store': json(store()) })
    const input = await screen.findByLabelText(t.merchantStore.galleryAdd)

    const tooBig = new File([new Uint8Array(MERCHANT_IMAGE_MAX_BYTES)], 'big.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [tooBig] } })

    expect(await screen.findByText(t.merchantStore.limits.imageTooLarge)).toBeInTheDocument()
    expect(asked(fetchMock, '/media/merchant')).toHaveLength(0)
  })

  it('refuses a file type the pipeline does not take', async () => {
    const fetchMock = open({ '/merchant/store': json(store()) })
    const input = await screen.findByLabelText(t.merchantStore.galleryAdd)
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] } })
    expect(await screen.findByText(t.merchantStore.limits.unsupported)).toBeInTheDocument()
    expect(asked(fetchMock, '/media/merchant')).toHaveLength(0)
  })

  it('stops adding when the gallery is full', async () => {
    open({ '/merchant/store': json(store({ media: media(MAX_STORE_MEDIA) })) })
    const add = await screen.findByRole('button', { name: t.merchantStore.galleryAdd })
    expect(add).toBeDisabled()
    expect(screen.getByText(t.merchantStore.galleryFull.replace('{max}', String(MAX_STORE_MEDIA)))).toBeInTheDocument()
  })

  it('STILL allows adding with room to spare — the counter-assertion', async () => {
    open({ '/merchant/store': json(store({ media: media(MAX_STORE_MEDIA - 1) })) })
    expect(await screen.findByRole('button', { name: t.merchantStore.galleryAdd })).toBeEnabled()
  })

  it('tells the merchant when staff have switched the store off', async () => {
    open({ '/merchant/store': json(store({ active: false, deactivationNotice: 'deactivated' })) })
    expect(await screen.findByText(t.merchantStore.deactivatedTitle)).toBeInTheDocument()
    // The data is still there: the page did not turn into an empty state.
    expect(screen.getByDisplayValue('Gutes Essen')).toBeInTheDocument()
  })

  it('does not show the notice for an active store', async () => {
    open({ '/merchant/store': json(store()) })
    await screen.findByDisplayValue('Gutes Essen')
    expect(screen.queryByText(t.merchantStore.deactivatedTitle)).toBeNull()
  })
})
