import { useCallback, useEffect, useState } from 'react'
import type { MemberDevice, MemberDevicesResponse } from '@gwc/contracts/devices'
import { get, del, ApiError } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { useCapabilities } from '../../lib/capabilities'
import Button from '../../components/ui/Button'
import Callout from '../../components/ui/Callout'
import { useLocale, useTranslations } from '../../i18n/index'

/**
 * Where you are signed in (feature 026, US2 and US3).
 *
 * The server owns every rule here — which devices exist, which one is this one,
 * and what ending one does to the next sign-in. This screen renders the list and
 * sends the end request; it decides nothing. A refusal is logged, not shown
 * (CLAUDE.md): the only state kept is what changes behaviour — whether the list
 * could not load, and which row is waiting for its confirmation.
 */
export function Devices() {
  const t = useTranslations()
  const { locale } = useLocale()
  const { clear } = useCapabilities()
  const [devices, setDevices] = useState<MemberDevice[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = (await get('/member/devices')) as MemberDevicesResponse
      setDevices(response.devices)
      setFailed(false)
    } catch (err) {
      console.error('Devices.load', err instanceof ApiError ? err.problem : err)
      setFailed(true)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const end = async (device: MemberDevice) => {
    setConfirming(null)
    try {
      await del(`/member/devices/${device.id}`)
    } catch (err) {
      console.error('Devices.end', err instanceof ApiError ? err.problem : err)
    }
    // Ending the browser you are on is signing out of it: drop the local
    // capability snapshot, as the shell's own sign-out does, so the console
    // returns to sign-in instead of reloading a list it can no longer read.
    if (device.current) {
      clear()
      return
    }
    await load()
  }

  if (failed) return <Callout variant="gold" title={t.memberDevices.loadFailed}>{null}</Callout>
  if (!devices) return null

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-[20px] font-semibold text-text">{t.memberDevices.title}</h1>
        <p className="mt-1 text-[14px] text-text-muted">{t.memberDevices.intro}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {devices.map((device) => (
          <li key={device.id} className="flex items-center justify-between gap-4 rounded-card border border-hairline bg-surface p-4">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-text">
                {device.label}
                {device.current && (
                  <span className="ml-2 rounded-card bg-ground px-2 py-0.5 text-[12px] font-medium text-navy">{t.memberDevices.thisDevice}</span>
                )}
              </p>
              <p className="text-[13px] text-text-muted">
                {device.kind === 'mobile' ? t.memberDevices.kindMobile : t.memberDevices.kindWeb}
                {' · '}
                {t.memberDevices.lastActive.replace('{when}', formatDateTime(device.lastSeenAt, locale))}
              </p>
            </div>
            {confirming === device.id ? (
              <span className="flex shrink-0 gap-2">
                <Button variant="secondary" onClick={() => void end(device)}>{t.memberDevices.confirmEnd}</Button>
                <Button variant="quiet" onClick={() => setConfirming(null)}>{t.memberDevices.cancel}</Button>
              </span>
            ) : (
              <Button variant="secondary" onClick={() => setConfirming(device.id)}>
                {device.current ? t.memberDevices.signOutHere : t.memberDevices.signOutDevice}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default Devices
