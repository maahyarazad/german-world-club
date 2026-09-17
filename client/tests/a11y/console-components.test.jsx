import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expectNoA11yViolations } from '../setup.js'

import Card from '../../src/components/ui/Card.jsx'
import KpiTile, { KpiRow } from '../../src/components/ui/KpiTile.jsx'
import StatusPill from '../../src/components/ui/StatusPill.jsx'
import Callout from '../../src/components/ui/Callout.jsx'
import Button from '../../src/components/ui/Button.jsx'
import DataTable from '../../src/components/ui/DataTable.jsx'
import PageHeader from '../../src/components/ui/PageHeader.jsx'

/**
 * SC-006 — zero accessibility violations, on light surfaces and dark chrome.
 *
 * READ THIS BEFORE TRUSTING A GREEN RUN: jsdom has no layout engine, so
 * axe-core cannot resolve rendered colours and reports `color-contrast` as
 * INCONCLUSIVE rather than passing. The same caveat is documented in
 * tests/a11y/page.test.jsx for feature 001.
 *
 * Contrast is therefore verified separately and numerically, in the second
 * describe below, straight from the token values in theme.css. That is the
 * assertion that actually holds the line on FR-011 — not the axe run.
 */

describe('every console component is structurally accessible', () => {
  it('Card', async () => {
    const { container } = render(<Card title="Mitgliederprüfung">Inhalt</Card>)
    await expectNoA11yViolations(container)
  })

  it('KPI row', async () => {
    const { container } = render(
      <KpiRow>
        <KpiTile value="24" caption="offene Anträge" />
        <KpiTile value="7" caption="Inhalte in Prüfung" />
      </KpiRow>,
    )
    await expectNoA11yViolations(container)
  })

  it('StatusPill carries its word, not just its colour', async () => {
    const { container, getByText } = render(<StatusPill tone="success">freigegeben</StatusPill>)
    // The substantive assertion: a reader who cannot separate the tints still
    // reads the status, because the word is always there.
    expect(getByText('freigegeben')).toBeInTheDocument()
    await expectNoA11yViolations(container)
  })

  it('Callout', async () => {
    const { container } = render(
      <Callout variant="gold" title="Publishing-Flow">
        Entwurf → Prüfung → Freigabe
      </Callout>,
    )
    await expectNoA11yViolations(container)
  })

  it('Callout, emphatic on dark chrome', async () => {
    const { container } = render(
      <Callout variant="emphatic" title="Keine Mitgliedschaft.">
        Das Unternehmen kauft Recruitment-, Kommunikations- und Employee-Access-Leistungen.
      </Callout>,
    )
    await expectNoA11yViolations(container)
  })

  it('Button, all variants', async () => {
    const { container } = render(
      <div>
        <Button variant="primary">Zur Freigabe einreichen</Button>
        <Button variant="accent">Neues Angebot</Button>
        <Button variant="secondary">Abmelden</Button>
        <Button variant="primary" disabled>
          Wird gesendet
        </Button>
      </div>,
    )
    await expectNoA11yViolations(container)
  })

  it('DataTable', async () => {
    const { container } = render(
      <DataTable
        caption="Merchant-Angebote"
        columns={[
          { key: 'name', header: 'Angebot' },
          { key: 'status', header: 'Status' },
        ]}
        rows={[{ id: '1', name: '25% Dinner', status: 'in Prüfung' }]}
      />,
    )
    await expectNoA11yViolations(container)
  })

  it('DataTable, empty', async () => {
    const { container } = render(
      <DataTable columns={[{ key: 'name', header: 'Angebot' }]} rows={[]} />,
    )
    await expectNoA11yViolations(container)
  })

  it('PageHeader', async () => {
    const { container } = render(
      <PageHeader title="Admin Panel" subtitle="Zentrale Qualitätskontrolle" />,
    )
    await expectNoA11yViolations(container)
  })
})

/**
 * FR-011 — contrast, computed rather than assumed.
 *
 * Values are read out of theme.css so this cannot drift from the tokens: change
 * a token to something unreadable and this suite fails, which is the whole
 * point. The pairings are the ones the components actually produce.
 */
describe('every token pairing meets WCAG 2.2 AA', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/theme.css'), 'utf8')

  const token = (name) => {
    const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))
    if (!match) throw new Error(`token --color-${name} not found in theme.css`)
    return match[1]
  }

  /** WCAG relative luminance. */
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  const ratio = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
    return (x + 0.05) / (y + 0.05)
  }

  // [foreground, background, minimum]. 4.5 for body text, 3.0 for large text
  // (the 26px page title and the 28px KPI numeral both qualify as large).
  const PAIRINGS = [
    ['text', 'surface', 4.5],
    ['text', 'ground', 4.5],
    ['text-muted', 'surface', 4.5],
    ['text-muted', 'ground', 4.5],
    ['navy', 'surface', 4.5],
    ['navy', 'ground', 4.5],
    ['accent-fg', 'surface', 4.5],
    ['accent-fg', 'tint-gold', 4.5],
    ['tint-success-fg', 'tint-success', 4.5],
    ['tint-info-fg', 'tint-info', 4.5],
    ['tint-danger-fg', 'tint-danger', 4.5],
    ['tint-gold-fg', 'tint-gold', 4.5],
    // Dark chrome — the sidebar and the emphatic callout.
    ['text-on-dark', 'ink', 4.5],
    ['text-on-dark-muted', 'ink', 4.5],
    ['text-on-dark', 'navy', 4.5],
    ['accent', 'ink', 3.0],
    // Button fills carrying labels.
    ['text-on-dark', 'navy-2', 4.5],
    ['ink', 'accent', 4.5],
  ]

  it.each(PAIRINGS)('%s on %s reaches %s:1', (foreground, background, minimum) => {
    const measured = ratio(token(foreground), token(background))
    expect(measured, `${foreground} on ${background} is ${measured.toFixed(2)}:1`).toBeGreaterThanOrEqual(minimum)
  })

  /**
   * The counter-assertion that keeps the gold rule honest.
   *
   * --color-accent (#D49626) is 2.4:1 on white. It MUST NOT be used as text
   * there, which is why the token set carries a separate --color-accent-fg. If
   * this ever starts passing, someone has lightened the surface or darkened the
   * accent, and the two tokens should be reconsidered together rather than the
   * distinction quietly dropped.
   */
  it('CONFIRMS gold is unreadable as text on white — hence accent-fg exists', () => {
    expect(ratio(token('accent'), token('surface'))).toBeLessThan(4.5)
    expect(ratio(token('accent-fg'), token('surface'))).toBeGreaterThanOrEqual(4.5)
  })
})
