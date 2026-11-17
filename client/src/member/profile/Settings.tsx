import { useTranslations } from '../../i18n/index'
import { ActiveSessions } from './Devices'

/**
 * Settings, in the member's profile (feature 027).
 *
 * One section today — where the member is signed in — and each section gets its
 * own heading so a later one (notifications, language) slots in beside it
 * without restructuring. The sessions themselves are rendered, and ended, by
 * `ActiveSessions`; the server decides every rule about them.
 */
export function Settings() {
  const t = useTranslations()
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <h1 className="text-[22px] font-semibold text-text">{t.memberSettings.title}</h1>
      <section aria-labelledby="settings-sessions" className="flex flex-col gap-3">
        <div>
          <h2 id="settings-sessions" className="text-[18px] font-semibold text-text">{t.memberSettings.sessionsHeading}</h2>
          <p className="mt-1 text-[14px] text-text-muted">{t.memberSettings.sessionsIntro}</p>
        </div>
        <ActiveSessions />
      </section>
    </div>
  )
}

export default Settings
