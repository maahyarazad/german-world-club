import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import type { OrganisationPublicProfile } from '@gwc/contracts/profile'
import { get } from '../../lib/api'
import Callout from '../../components/ui/Callout'
import { fill } from '../../lib/format'
import { useTranslations } from '../../i18n/index'
import { smallestUrl } from '../threads/MediaGrid'

/** A merchant's or partner's public face, as a member sees it (US4, FR-015). */
export function OrganisationView() {
  const t = useTranslations()
  const { slug } = useParams()
  const [org, setOrg] = useState<OrganisationPublicProfile | null>(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    void get(`/profile/organisations/${encodeURIComponent(slug ?? '')}`)
      .then((o) => setOrg(o as OrganisationPublicProfile)).catch(() => setMissing(true))
  }, [slug])
  if (missing) return <Callout variant="neutral" title={t.memberProfile.notFound}>{null}</Callout>
  if (!org) return null
  return <OrganisationCard org={org} />
}

export function OrganisationCard({ org }: { org: OrganisationPublicProfile }) {
  const t = useTranslations()
  return (
    <article className="mx-auto flex w-full max-w-2xl flex-col gap-3">
      <div className="flex items-center gap-4">
        {org.logo && (
          <img src={smallestUrl(org.logo, 160)} alt={fill(t.organisationProfile.logoAlt, { name: org.displayName })}
            width={80} height={80} className="h-20 w-20 rounded-card bg-ground object-contain" />
        )}
        <div>
          <h1 className="text-[22px] font-semibold text-text">{org.displayName}</h1>
          {org.city && <p className="text-[13px] text-text-muted">{org.city}</p>}
        </div>
      </div>
      {org.about && <p className="whitespace-pre-wrap text-[14px] text-text">{org.about}</p>}
      {org.website && (
        <a href={org.website} target="_blank" rel="noopener noreferrer nofollow" className="text-[13px] text-navy hover:underline">
          {org.website.replace(/^https:\/\//, '')}
        </a>
      )}
    </article>
  )
}

export default OrganisationView
