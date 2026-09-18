import { buildPageMeta } from '../../seo/build-page-meta.ts'
import { documentsFor, isContractLive } from '../../seo/structured-data.ts'
import { renderPage } from '../templates/layout.ts'
import { partnerBody } from '../templates/partner.ts'
import { outletBody } from '../templates/outlet.ts'
import { eventBody } from '../templates/event.ts'
import { articleBody } from '../templates/article.ts'
import { legalBody } from '../templates/legal.ts'

const BODIES = {
  partner: partnerBody,
  outlet: outletBody,
  event: eventBody,
  article: articleBody,
  committee: legalBody,
  page: legalBody,
}

/** Public content caching, per seo-delivery.md §8. */
export const PUBLIC_CACHE = 'public, max-age=300, stale-while-revalidate=86400'

/**
 * `Vary: Accept-Language` is load-bearing with §10.7's multilingual pages:
 * without it a shared cache can serve the German page to an English request.
 */
export const VARY = 'Accept-Encoding, Accept-Language'

/**
 * Render one record, or throw a real 404.
 *
 * `disposition` is FR-031: a partner past its contract plus grace is, by
 * default, **retained but not indexed** — the page keeps working for anyone
 * holding the link while the listing stops being advertised, which is what
 * the sponsor stopped paying for.
 */
export async function renderRecord(app, { recordType, slug, origin, nonce, signal }) {
  const now = new Date()
  const record = await app.contentSource.find(recordType, slug, { signal })
  if (!record) throw app.httpErrors.notFound('No such page.')

  // An unpublished record is not a page yet: it 404s rather than leaking a
  // draft, and that is indistinguishable from "never existed" by design.
  if (!record.published) throw app.httpErrors.notFound('No such page.')

  const active = recordType === 'partner' || recordType === 'outlet' ? isContractLive(record, now) : true

  const alternates = await app.contentSource.alternates(record, { signal })
  const pageMeta = buildPageMeta(
    // A lapsed listing stops being indexable without a staff action.
    { ...record, indexable: record.indexable && active },
    { origin, alternates, surfaceAuth: { audience: 'public' } },
  )
  pageMeta.jsonLd = documentsFor(origin, record, now)

  const body = (BODIES[recordType] ?? legalBody)(record, { active, now })

  return { html: renderPage({ pageMeta, body, nonce }), language: pageMeta.lang }
}
