import { query } from '../../../db/query.ts'
import { loadMediaItems } from '../../media/application/media-items.ts'
import { escape } from '../templates/layout.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * The partners and merchants carousel on the landing pages (feature 035,
 * research R9): the club's active partners and merchants, by name and logo.
 *
 * Public, so it shows the public face and nothing else — the display name from
 * `organisation_profiles` and a logo derivative. No legal name, no fee tier, no
 * contract date, no store contents, and no offer: those are members-only
 * content, and a page a search engine reads must not carry them (Principle VI).
 *
 * Read live on every render, so a partner whose contract ended or a merchant
 * whose store staff switched off is gone from the next page served; the page's
 * public cache (a few minutes) is what bounds how long a copy may linger.
 *
 * Who appears:
 *  - an ACTIVE partner with a public name;
 *  - an ACTIVE merchant with a public name whose store is switched on.
 * A partner is linked only when it has a published public page of its own
 * (`seo_metadata`), because a link to a page that answers 404 is worse than no
 * link. A merchant is never linked: its store and offers are members-only.
 */

export type CarouselEntry = {
  name: string
  kind: 'partner' | 'merchant'
  /** A page path, only for a partner that has a published public page. */
  href: string | null
  logo: { url: string; width: number; height: number } | null
}

/** Enough to be a strip, not a wall. */
const LIMIT = 24
/** The logo is drawn about 120 CSS px wide; 240 covers a 2x screen without fetching a hero. */
const LOGO_MIN_WIDTH = 240

export async function loadCarousel(app: GwcApp, { signal }: { signal?: AbortSignal } = {}): Promise<CarouselEntry[]> {
  const { rows } = await query(
    app.pg,
    `SELECT org.kind, org.slug, op.display_name, op.logo_asset_id,
            EXISTS (SELECT 1 FROM seo_metadata sm
                     WHERE sm.record_type = 'partner' AND sm.slug = org.slug::text AND sm.published) AS has_page
       FROM organisations org
       JOIN organisation_profiles op ON op.organisation_id = org.id
      WHERE org.status = 'active'
        AND btrim(op.display_name) <> ''
        AND (org.kind = 'partner'
             OR EXISTS (SELECT 1 FROM stores st WHERE st.organisation_id = org.id AND st.active))
      ORDER BY (org.kind = 'partner') DESC, lower(op.display_name), org.id
      LIMIT ${LIMIT}`,
    [],
    { signal },
  )

  const items = await loadMediaItems(app.pg, rows.filter((r) => r.logo_asset_id).map((r) => String(r.logo_asset_id)))
  return rows.map((r): CarouselEntry => {
    const item = r.logo_asset_id ? items.get(String(r.logo_asset_id)) : null
    // Still images only, smallest that is big enough; webp first.
    const rank = (format: string) => ['webp', 'jpeg', 'png'].indexOf(format)
    const variants = [...(item?.variants ?? [])]
      .filter((v) => rank(v.format) >= 0)
      .sort((a, b) => a.width - b.width || rank(a.format) - rank(b.format))
    const chosen = variants.find((v) => v.width >= LOGO_MIN_WIDTH) ?? variants[variants.length - 1]
    return {
      name: String(r.display_name).trim(),
      kind: r.kind,
      href: r.kind === 'partner' && r.has_page ? `/partners/${encodeURIComponent(String(r.slug))}` : null,
      logo: chosen ? { url: chosen.url, width: chosen.width, height: chosen.height } : null,
    }
  })
}

export const CAROUSEL_LABELS = Object.freeze({
  de: { heading: 'Unsere Partner und Händler', label: 'Im Club' },
  en: { heading: 'Our partners and merchants', label: 'In the club' },
})

/**
 * The section for the `<!--gwc:partners-->` slot, or an empty string when there
 * is nobody to show: an empty heading over nothing would be a page advertising
 * something that is not there (Principle III). Every value is escaped. No script.
 */
export function renderCarousel(entries: readonly CarouselEntry[], language: 'de' | 'en' = 'de'): string {
  if (entries.length === 0) return ''
  const { heading, label } = CAROUSEL_LABELS[language] ?? CAROUSEL_LABELS.de

  const items = entries.map((e) => {
    const face = e.logo
      // Decorative: the name beside it already says who it is.
      ? `<img src="${escape(e.logo.url)}" alt="" width="${e.logo.width}" height="${e.logo.height}" loading="lazy">`
      : ''
    const inner = `${face}<span class="partner-name">${escape(e.name)}</span>`
    return e.href
      ? `<li><a class="partner-card" href="${escape(e.href)}">${inner}</a></li>`
      : `<li><span class="partner-card">${inner}</span></li>`
  }).join('')

  return `<section id="partner" class="partners" aria-labelledby="partners-heading">
        <div class="wrap">
          <p class="label">${escape(label)}</p>
          <h2 id="partners-heading">${escape(heading)}</h2>
          <ul class="partners-track" role="list">${items}</ul>
        </div>
      </section>`
}
