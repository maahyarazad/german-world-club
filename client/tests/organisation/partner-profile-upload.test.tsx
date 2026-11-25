import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { clearCsrfToken } from '../../src/lib/api'
import { renderConsole, mockCapabilityFetch } from '../helpers/console'
import { installFakeXhr, lastXhr, FakeXhr } from '../helpers/fake-xhr'

/**
 * The partner profile's logo upload shows progress (feature 035, US5): the bytes
 * going up, then the server working, and a failed upload leaves the saved logo
 * exactly as it was — the profile is only changed once the new file is ready.
 */
beforeEach(() => { clearCsrfToken(); installFakeXhr() })
afterEach(() => vi.unstubAllGlobals())

const partnerSnapshot = () => ({
  kind: 'partner', id: '00000000-0000-4000-8000-000000000001', displayName: 'Pia Partner',
  organisationId: '00000000-0000-4000-8000-000000000002', organisationName: 'Partner AG',
  organisationStatus: 'active', role: 'owner', available: [],
})

const profile = {
  kind: 'partner', id: '00000000-0000-4000-8000-000000000001', displayName: 'Pia Partner', email: 'pia@test.invalid',
  role: 'owner', organisation: { id: '00000000-0000-4000-8000-000000000002', name: 'Partner AG', status: 'active' },
  publicProfile: { slug: 'partner-ag', kind: 'partner', displayName: 'Partner AG', about: null, website: null, city: null, logo: null },
  canEdit: true,
}
const ok = (body: unknown) => () => ({ status: 200, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

function open() {
  const patched = vi.fn()
  const fetchMock = mockCapabilityFetch(partnerSnapshot(), {
    extraRoutes: {
      '/profile/partner': ok(profile),
      '/profile/partner/public': (options) => { patched(options); return ok(profile)() },
    },
  })
  renderConsole(<ConsoleRoutes />, { route: '/konsole/partner/profil' })
  return { fetchMock, patched }
}

const chooseLogo = async () => {
  const input = await screen.findByLabelText(t.organisationProfile.logoChange)
  fireEvent.change(input, { target: { files: [new File(['x'], 'logo.png', { type: 'image/png' })] } })
  await vi.waitFor(() => expect(FakeXhr.instances.at(-1)?.sent).toBe(true))
  return lastXhr()
}

describe('the partner profile logo upload', () => {
  it('goes to the partner upload route and shows the bytes going up, then processing', async () => {
    open()
    const xhr = await chooseLogo()
    expect(xhr.url).toBe('/media/partner')

    xhr.progress(30, 100)
    expect(await screen.findByRole('progressbar')).toHaveProperty('value', 0.3)

    xhr.progress(100, 100)
    xhr.bodySent()
    expect(await screen.findByText(t.upload.processing)).toBeInTheDocument()
  })

  it('saves the new logo only once the file is ready', async () => {
    const { patched } = open()
    const xhr = await chooseLogo()
    expect(patched).not.toHaveBeenCalled()

    xhr.bodySent()
    xhr.respond(201, { id: '00000000-0000-4000-8000-0000000000f1', state: 'ready' })
    await waitFor(() => expect(patched).toHaveBeenCalledOnce())
    expect(JSON.parse(String((patched.mock.calls[0]![0] as RequestInit).body))).toEqual({ logoAssetId: '00000000-0000-4000-8000-0000000000f1' })
  })

  it('says it failed and changes nothing when the upload is refused — the counter-assertion', async () => {
    const { patched } = open()
    const xhr = await chooseLogo()
    xhr.respond(500, { type: 'https://german-world-club.com/problems/internal', title: 'Internal error', status: 500 }, 'application/problem+json')

    expect(await screen.findByRole('alert')).toHaveTextContent(t.upload.failed)
    expect(patched).not.toHaveBeenCalled()
  })
})
