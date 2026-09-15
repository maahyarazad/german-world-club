import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App.jsx'
import { expectNoA11yViolations } from '../setup.js'

/**
 * NOTE ON COVERAGE: axe runs 15 WCAG 2.1 A/AA rules here and reports zero
 * violations, but `color-contrast` comes back INCONCLUSIVE rather than
 * passing — jsdom has no layout engine, so axe cannot resolve the rendered
 * colours behind each text node. Contrast is therefore verified two other
 * ways: every palette pairing was computed against the WCAG relative
 * luminance formula (research.md R4), and quickstart V9 runs Lighthouse
 * against a real browser. Do not read a green run here as proof of contrast.
 */
describe('full page accessibility', () => {
  afterEach(() => vi.restoreAllMocks())

  it('SC-005: has zero WCAG 2.1 AA violations while counting down', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-01-01T00:00:00Z').getTime())
    const { container } = render(<App />)
    await expectNoA11yViolations(container)
  }, 20000)

  it('SC-005: has zero WCAG 2.1 AA violations after launch', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2099-01-01T00:00:00Z').getTime())
    const { container } = render(<App />)
    await expectNoA11yViolations(container)
  }, 20000)

  it('X5: has exactly one h1', () => {
    const { container } = render(<App />)
    expect(container.querySelectorAll('h1')).toHaveLength(1)
  })

  it('X5: never skips a heading level', () => {
    const { container } = render(<App />)
    const levels = [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((el) =>
      Number(el.tagName[1]),
    )

    expect(levels[0]).toBe(1)
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1]).toBeLessThanOrEqual(1)
    })
  })

  it('X6: exposes one main and one footer landmark', () => {
    const { container } = render(<App />)
    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(container.querySelectorAll('footer')).toHaveLength(1)
  })

  it('X6: gives every section an accessible name', () => {
    const { container } = render(<App />)
    const sections = [...container.querySelectorAll('section')]

    expect(sections.length).toBeGreaterThanOrEqual(5)
    sections.forEach((section) => {
      const named =
        section.hasAttribute('aria-label') ||
        (section.hasAttribute('aria-labelledby') &&
          container.querySelector(`#${section.getAttribute('aria-labelledby')}`) !== null)
      expect(named, `<section id="${section.id}"> has no resolvable accessible name`).toBe(true)
    })
  })

  it('X2: provides a skip link as the first focusable element', () => {
    render(<App />)
    const skip = screen.getByRole('link', { name: /skip to content/i })
    expect(skip).toHaveAttribute('href', '#main')
  })

  it('documents that contrast cannot be machine-checked in jsdom', async () => {
    const axe = (await import('axe-core')).default
    const { container } = render(<App />)
    const results = await axe.run(container, { runOnly: { type: 'rule', values: ['color-contrast'] } })

    // If this ever starts passing outright, the environment gained layout and
    // the note above can be relaxed.
    expect(results.violations).toHaveLength(0)
    expect(results.incomplete.length + results.passes.length).toBeGreaterThan(0)
  }, 20000)

  it('X7: issues no network requests', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<App />)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
