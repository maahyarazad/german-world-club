import { renderPage } from '../templates/layout.ts'
import { marketplaceDiscoveryBody } from '../templates/marketplace-discovery.ts'
import { getMarketplaceSummary } from '../../marketplace/application/summary.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * The public marketplace discovery page (US7).
 *
 * Built directly, not through `render-record.ts`: that pipeline resolves a
 * content-source RECORD (a partner, an event, a page), and this page is not
 * one — it has no slug, no content-source entry and nothing a member authored.
 * `buildPageMeta` exists for records; this hand-builds the same `pageMeta`
 * shape `renderHead` expects, which is the smaller and more honest option than
 * bending a record-shaped resolver around a page that isn't a record.
 *
 * Indexed and public (FR-034) — the opposite posture of `/marketplace`, which
 * stays gated and never-indexed. `getMarketplaceSummary` is the only place
 * either surface reads from, so the two can never disagree about the numbers.
 */
export async function renderMarketplaceDiscovery(
  app: GwcApp,
  { origin, nonce, signal }: { origin: string; nonce?: string; signal?: AbortSignal },
): Promise<string> {
  const summary = await getMarketplaceSummary(app, { signal })

  const title = 'Marktplatz — German World Club'
  const description = 'Anzeigen von Mitgliedern für Mitglieder: Fahrzeuge, Immobilien, Jobs und mehr.'
  const url = `${origin}/marktplatz`

  const pageMeta = {
    lang: 'de',
    title,
    description,
    robots: 'index,follow',
    canonical: url,
    alternates: [],
    og: {
      type: 'website',
      siteName: 'German World Club',
      title,
      description,
      url,
      locale: 'de_DE',
    },
    twitter: {
      card: 'summary',
      title,
      description,
      image: undefined,
    },
    jsonLd: [],
  }

  return renderPage({ pageMeta, body: marketplaceDiscoveryBody(summary), nonce })
}
