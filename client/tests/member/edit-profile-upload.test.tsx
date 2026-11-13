import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { PROBLEMS } from '@gwc/contracts/errors'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { fill, formatPercent } from '../../src/lib/format'
import { clearCsrfToken } from '../../src/lib/api'
import { renderConsole, mockCapabilityFetch, memberSnapshot } from '../helpers/console'
import { installFakeXhr, FakeXhr, lastXhr } from '../helpers/fake-xhr'

/**
 * Profile picture upload progress on Edit profile (feature 021, Story 6).
 *
 * The member sees the share of the picture the server has received, then that
 * it is being processed, then "Saved." — and on a refusal, no stuck bar.
 */

const ME = memberSnapshot().id
const json = (body: unknown, status = 200) => () => ({ status, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

const profile = (avatar: unknown = null) => ({
  kind: 'member', id: ME, displayName: 'Arian Geissler', email: 'a@test.invalid', mobile: null,
  birthday: null, gender: null, countryOfResidence: null, bio: null, city: null,
  memberSince: '2025-01-01T00:00:00.000Z', followers: 0, following: 0, handle: null,
  handleChangeableAt: null, avatar, links: [], isInfluencer: false,
})

beforeEach(() => {
  clearCsrfToken()
  installFakeXhr()
})
afterEach(() => vi.unstubAllGlobals())

async function openAndChoose() {
  mockCapabilityFetch(memberSnapshot(), {
    extraRoutes: {
      '/profile/me': json(profile()),
      '/profile/me/avatar': json(profile({ id: 'asset-1', alt: 'Profilbild', variants: [] })),
    },
  })
  renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/profil/bearbeiten' })
  await screen.findByRole('button', { name: t.memberProfile.avatarChange })

  // No progress before anything was chosen — the counter-assertion for the bar.
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['x'.repeat(100)], 'me.png', { type: 'image/png' })] } })
  await waitFor(() => expect(FakeXhr.instances.at(-1)?.sent).toBe(true))
  return lastXhr()
}

describe('Edit profile: picture upload progress', () => {
  it('shows the share received, then processing, then Saved', async () => {
    const xhr = await openAndChoose()

    xhr.progress(42, 100)
    const bar = await screen.findByRole('progressbar')
    expect(bar).toHaveAttribute('value', '0.42')
    // Compared as text, not with getByText: the German percent carries a
    // no-break space, which Testing Library's matcher normalises on the page
    // but not in the expected string.
    expect(bar.parentElement!.textContent).toBe(fill(t.memberProfile.avatarUploading, { percent: formatPercent(0.42, 'de') }))

    xhr.bodySent()
    await waitFor(() => expect(screen.getByText(t.memberProfile.avatarProcessing)).toBeInTheDocument())
    // Indeterminate while the server works: no value at all.
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('value')

    xhr.respond(201, { id: 'asset-1', state: 'ready' })
    expect(await screen.findByText(t.memberProfile.saved)).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('removes the progress on a refusal, logs it, and frees the buttons', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const xhr = await openAndChoose()
    xhr.progress(100, 100)
    xhr.respond(400, { ...PROBLEMS.VALIDATION_FAILED, detail: 'unsupported image' }, 'application/problem+json')

    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    expect(errors).toHaveBeenCalledWith('EditProfile.uploadAvatar', expect.objectContaining({ status: 400 }))
    expect(screen.getByRole('button', { name: t.memberProfile.avatarChange })).toBeEnabled()
    expect(screen.queryByText(t.memberProfile.saved)).not.toBeInTheDocument()
    errors.mockRestore()
  })
})
