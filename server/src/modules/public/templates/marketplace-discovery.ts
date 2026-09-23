import { escape } from './layout.ts'
import type { MarketplaceCategory } from '@gwc/contracts/marketplace'

/**
 * The body for `/marktplatz` (US7, FR-034, FR-035).
 *
 * No listing ever appears here — no id, title, photo, price or owner. Only
 * `summary` reaches this function, and `summary` is aggregate counts by
 * construction (`application/summary.ts` never selects a column that could
 * identify one). There is nothing in this file's inputs a stricter template
 * could accidentally leak.
 */

/** German labels for the four categories. Display copy, not a branching value. */
const CATEGORY_LABELS: Record<MarketplaceCategory, string> = {
  vehicle: 'Fahrzeuge',
  property: 'Immobilien',
  job: 'Jobs',
  general: 'Sonstiges',
}

export function marketplaceDiscoveryBody(
  summary: { total: number; byCategory: Record<MarketplaceCategory, number> },
): string {
  const rows = (Object.keys(CATEGORY_LABELS) as MarketplaceCategory[])
    .map((category) => `<dt>${escape(CATEGORY_LABELS[category])}</dt><dd>${escape(summary.byCategory[category] ?? 0)}</dd>`)
    .join('\n')

  return `
<h1>Marktplatz</h1>
<p>
  Anzeigen von Mitgliedern für Mitglieder — Fahrzeuge, Immobilien, Jobs und
  Sonstiges. Keine Zahlungsabwicklung, kein Treuhandservice: eine Anzeige endet
  damit, dass sich zwei Mitglieder über die Plattform austauschen.
</p>
<p>
  Derzeit <strong>${escape(summary.total)}</strong> aktive ${summary.total === 1 ? 'Anzeige' : 'Anzeigen'} in vier Kategorien:
</p>
<dl>
${rows}
</dl>
<h2>Mitglied werden</h2>
<p>
  Der Marktplatz steht angemeldeten Mitgliedern offen. Einzelne Anzeigen sind
  hier bewusst nicht sichtbar — sie sind Mitgliedern vorbehalten, unabhängig
  davon, wer diese Seite liest.
</p>
`.trim()
}
