import PageHeader from '../components/ui/PageHeader'
import Callout from '../components/ui/Callout'
import { useCapabilities } from '../lib/capabilities'
import { useTranslations } from '../i18n/index'

type Role = 'owner' | 'manager' | 'staff'

/**
 * The organisation portal's landing page.
 *
 * Says what is true: who you are signed in as, for which organisation, and
 * that the portal's tools are not built yet. Everything shown comes from the
 * session snapshot the server resolved for this request — nothing is read
 * from the token, and nothing here decides what is allowed.
 */
export function OrganisationHome() {
  const t = useTranslations()
  const { snapshot } = useCapabilities()
  const organisationName = typeof snapshot?.organisationName === 'string' ? snapshot.organisationName : ''
  const role = snapshot?.role as Role | undefined

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={organisationName} />
      {role && t.organisationPortal.roles[role] ? (
        <p className="text-[13px] text-text-muted">
          {t.organisationPortal.role}: {t.organisationPortal.roles[role]}
        </p>
      ) : null}
      <Callout variant="neutral" title={t.console.notAvailable}>
        {t.organisationPortal.notBuiltHint}
      </Callout>
    </div>
  )
}

export default OrganisationHome
