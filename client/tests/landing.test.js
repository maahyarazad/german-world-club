import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import axe from 'axe-core'

/**
 * The public landing page.
 *
 * Asserted against the raw file rather than a rendered component, because the
 * property under test is that the FILE is the page. Constitution "Public
 * rendering" requires meaningful content in the initial response with no
 * JavaScript executed — link-preview bots and most non-Google crawlers run
 * none, and partner visibility is a sold deliverable. A test that mounted a
 * component would prove nothing about what those crawlers receive.
 */

const HTML = readFileSync(join(process.cwd(), 'index.html'), 'utf8')

/**
 * The parsed landing page.
 *
 * Named `page` rather than `document` deliberately: a module-scope `document`
 * shadows the global one, and the accessibility test below needs the real
 * global — axe reads `window` and the CSSOM off the node's owner document and
 * rejects a detached tree.
 */
let page

beforeAll(() => {
  // runScripts is deliberately omitted: this parses the file exactly as a
  // crawler that executes nothing would see it.
  page = new JSDOM(HTML).window.document
})

describe('the page renders without JavaScript', () => {
  it('references no script bundle at all', () => {
    expect(page.querySelectorAll('script')).toHaveLength(0)
  })

  it('needs no external stylesheet', () => {
    // An external sheet is a second round trip before the page is legible, and
    // with the old async-css swap it was a round trip that needed JavaScript.
    expect(page.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(0)
    expect(page.querySelector('style')).not.toBeNull()
  })

  it('carries its real content in the raw body', () => {
    expect(page.querySelector('h1')?.textContent).toMatch(/globales Vertrauensnetz/)
    expect(HTML.length).toBeGreaterThan(500)

    // Counter-assertion: an empty shell would satisfy "has an h1" if the h1 were
    // the only thing in it. The substance has to be there too.
    const text = page.body.textContent
    expect(text).toMatch(/Ask GWC/)
    expect(text).toMatch(/GWC PRIVATE CIRCLE/)
    expect(text).toMatch(/Pay-to-rank/)
  })

  it('is German, and says so', () => {
    expect(page.documentElement.lang).toBe('de')
    expect(page.querySelector('meta[property="og:locale"]')?.content).toBe('de_DE')
  })
})

describe('the content comes from the design document', () => {
  it('states the four Wertschleifen', () => {
    const text = page.body.textContent
    for (const loop of ['Ask GWC', 'Event', 'Vorteil', 'Partner']) {
      expect(text).toContain(loop)
    }
    expect(text).toMatch(/Frage → Lösung/)
    expect(text).toMatch(/Treffen → Beziehung/)
  })

  /**
   * The design document is explicit that the five tiers appear "exakt wie im
   * Masterplan" and are not to be replaced by invented prices. These are those
   * figures; if one changes here it should have changed in the masterplan
   * first.
   */
  it.each([
    ['GWC CONNECT', /kostenlos/],
    ['GWC MEMBER', /€150–€300/],
    ['GWC PREMIUM', /€600–€1\.200/],
    ['GWC EXECUTIVE', /€2\.500–€5\.000/],
    ['GWC PRIVATE CIRCLE', /€10\.000\+/],
  ])('states %s with the masterplan figure', (tier, amount) => {
    const text = page.body.textContent
    expect(text).toContain(tier)
    expect(text).toMatch(amount)
  })

  it('states the trust rules the document says are deliberately absent', () => {
    const text = page.body.textContent
    expect(text).toMatch(/Kein Pay-to-rank/)
    expect(text).toMatch(/Mitgliederdaten werden nicht verkauft/)
  })
})

describe('the login section reaches the console', () => {
  const hrefs = () => [...page.querySelectorAll('a')].map((a) => a.getAttribute('href'))

  it('offers a sign-in route', () => {
    expect(hrefs()).toContain('/konsole/anmelden')
    expect(page.querySelector('#anmeldung')).not.toBeNull()
  })

  it('offers password reset', () => {
    expect(hrefs()).toContain('/konsole/passwort')
  })

  it('explains that one sign-in serves every role', () => {
    // Collapse whitespace first: the source wraps at 100 columns, so a phrase
    // like "Corporate Club Partner" can straddle a newline in the raw text.
    const section = page.querySelector('#anmeldung').textContent.replace(/\s+/g, ' ')
    for (const role of ['Mitglieder', 'GWC-Team', 'Club Merchants', 'Corporate Club Partner']) {
      expect(section).toContain(role)
    }
  })

  /**
   * FR-002. Registration is unfinished, so the platform offers no way to start
   * one — and the landing page is where a "Jetzt Mitglied werden" button would
   * most naturally be added by someone who had not read this.
   */
  it('offers NO way to create an account', () => {
    for (const href of hrefs()) {
      expect(href).not.toMatch(/registr|sign-?up|anmeldung\/neu|bewerb/i)
    }
    expect(page.body.textContent).not.toMatch(/Konto erstellen|Jetzt Mitglied werden/i)
  })
})

describe('nothing of the previous brand survives', () => {
  it.each([
    ['Experts Circle', /experts\s*circle/i],
    ['German Emirates Club', /german\s*emirates/i],
    ['the old domain', /expertscircle/i],
  ])('contains no trace of %s', (_name, pattern) => {
    expect(HTML).not.toMatch(pattern)
  })

  it('names the German World Club instead', () => {
    // Counter-assertion for the three above: they would all pass against an
    // empty file.
    expect(HTML).toMatch(/German World Club/)
    expect(page.querySelector('link[rel="canonical"]')?.href).toMatch(/german-world-club/)
  })
})

describe('share metadata is complete and honest', () => {
  const meta = (selector) => page.querySelector(selector)?.content

  it('declares a title, description and canonical', () => {
    expect(page.title).toMatch(/German World Club/)
    expect(meta('meta[name="description"]')?.length).toBeGreaterThan(50)
    expect(page.querySelector('link[rel="canonical"]')).not.toBeNull()
  })

  it('declares the share image WITH its real dimensions', () => {
    // Explicit dimensions are required (FR-013), and they must be the file's
    // actual ones — gwc-logo.png is 844x578. Claiming 1200x630 because that is
    // what a share card wants renders stretched.
    expect(meta('meta[property="og:image"]')).toMatch(/gwc-logo\.png/)
    expect(meta('meta[property="og:image:width"]')).toBe('844')
    expect(meta('meta[property="og:image:height"]')).toBe('578')
    expect(meta('meta[property="og:image:alt"]')).toBeTruthy()
  })

  it('gives the logo explicit dimensions in the markup too', () => {
    const logo = page.querySelector('img[src="/gwc-logo.png"]')
    expect(logo.getAttribute('width')).toBe('844')
    expect(logo.getAttribute('height')).toBe('578')
    expect(logo.getAttribute('alt')).toBeTruthy()
  })
})

describe('the language control', () => {
  it('is a real link, not a script-driven toggle', () => {
    // This page runs no JavaScript. A toggle would simply not work.
    const link = page.querySelector('nav.lang a')
    expect(link).not.toBeNull()
    expect(link.getAttribute('href')).toBe('/en')
  })

  it('marks the current language with aria-current, not colour alone', () => {
    const current = page.querySelector('nav.lang [aria-current="true"]')
    expect(current.textContent.trim()).toBe('Deutsch')
  })

  it('names both languages, each in its own language', () => {
    const nav = page.querySelector('nav.lang').textContent
    expect(nav).toContain('Deutsch')
    expect(nav).toContain('English')
  })

  it('gives the control an accessible name', () => {
    expect(page.querySelector('nav.lang').getAttribute('aria-label')).toBeTruthy()
  })
})

describe('accessibility', () => {
  it('has zero WCAG 2.1 A/AA violations', async () => {
    // NOTE: jsdom has no layout engine, so axe reports `color-contrast` as
    // inconclusive rather than passing — the same caveat that applies to the
    // console component suite. Contrast is verified numerically in
    // tests/a11y/console-components.test.jsx, against the same token values
    // this page mirrors (and check-tokens.mjs proves it mirrors them).
    // axe works against the live document, not a detached one — it reads
    // window and the CSSOM off the node's owner document. So the page is
    // written into this test's own document and audited there.
    const parsed = new JSDOM(HTML).window.document
    document.documentElement.innerHTML = parsed.documentElement.innerHTML
    const results = await axe.run(document.body, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    })
    const summary = results.violations.map((v) => `${v.id}: ${v.help}`).join('\n  ')
    expect(results.violations, `Accessibility violations:\n  ${summary}`).toHaveLength(0)
  }, 20000)

  it('offers a skip link and one h1', () => {
    expect(page.querySelector('a.skip')).not.toBeNull()
    expect(page.querySelectorAll('h1')).toHaveLength(1)
  })

  it('gives the tier table a caption and row headers', () => {
    const table = page.querySelector('table.tiers')
    expect(table.querySelector('caption')).not.toBeNull()
    expect(table.querySelectorAll('tbody th[scope="row"]').length).toBe(5)
  })
})
