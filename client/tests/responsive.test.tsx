import { describe, it, expect, afterEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import LanguageSwitch from '../src/components/ui/LanguageSwitch'
import { LocaleProvider } from '../src/i18n/index'

/**
 * SC-011 — nothing introduces horizontal page scroll at 320px.
 *
 * Created here rather than in feature 003 (its T128 is still open), because the
 * language control is a new element in two already-crowded headers: the landing
 * masthead now carries a logo, a language control and a sign-in button, and the
 * console header carries a logo, a name, a language control and sign-out.
 *
 * READ THIS BEFORE TRUSTING IT: jsdom has no layout engine, so it cannot
 * measure overflow. These assertions are therefore about the *rules that
 * prevent* overflow — declared wrapping and no fixed widths — not about
 * measured pixels. Real overflow needs a browser; the quickstart says so.
 */

afterEach(() => vi.unstubAllGlobals())

const readPage = (file: string): Document =>
  new JSDOM(readFileSync(join(process.cwd(), file), 'utf8')).window.document

describe('the landing mastheads can wrap', () => {
  it.each([['index.html'], ['en.html']])('%s declares flex-wrap on the masthead', (file: string) => {
    const doc = readPage(file)
    const style = doc.querySelector('style')!.textContent
    // The masthead holds three things now. Without wrapping, the third one
    // pushes the page wider than the viewport on a phone.
    expect(style).toMatch(/\.masthead \.wrap \{[^}]*flex-wrap:\s*wrap/s)
  })

  it.each([['index.html'], ['en.html']])('%s keeps a 16px side gutter', (file: string) => {
    const style = readPage(file).querySelector('style')!.textContent
    expect(style).toMatch(/\.wrap \{[^}]*padding:\s*0 1rem/s)
  })

  it.each([['index.html'], ['en.html']])('%s sets no fixed pixel width anywhere', (file: string) => {
    const style = readPage(file).querySelector('style')!.textContent
    // `max-width` in rem is fine; a fixed `width: 900px` is not.
    expect(style).not.toMatch(/[^-]width:\s*\d{3,}px/)
  })

  it.each([['index.html'], ['en.html']])('%s declares a responsive viewport', (file: string) => {
    const meta = readPage(file).querySelector('meta[name="viewport"]')
    expect(meta?.getAttribute('content')).toMatch(/width=device-width/)
  })

  it.each([['index.html'], ['en.html']])('%s lets the tier table scroll rather than the page', (file: string) => {
    // A table is the one element that cannot wrap. It must carry its own
    // overflow or it widens the document.
    const doc = readPage(file)
    const style = doc.querySelector('style')!.textContent
    const table = doc.querySelector('table.tiers')
    expect(table).not.toBeNull()
    expect(style).toMatch(/\.tiers \{[^}]*width:\s*100%/s)
  })
})

describe('the console language control does not force a wide header', () => {
  it('renders inline with no intrinsic width', () => {
    const { container } = render(
      <LocaleProvider initialLocale="de">
        <LanguageSwitch />
      </LocaleProvider>,
    )
    const group = container.querySelector('[role="group"]')
    expect(group!.className).toMatch(/inline-flex/)
    expect(group!.className).not.toMatch(/\bw-\[?\d/)
  })

  it('keeps its labels short enough for a phone header', () => {
    const { container } = render(
      <LocaleProvider initialLocale="de">
        <LanguageSwitch />
      </LocaleProvider>,
    )
    // "Deutsch" and "English" — seven characters each. A control spelling out
    // "Deutsche Sprache" would not fit beside a logo and a sign-out button.
    for (const button of container.querySelectorAll('button')) {
      expect(button.textContent.length).toBeLessThanOrEqual(10)
    }
  })
})
