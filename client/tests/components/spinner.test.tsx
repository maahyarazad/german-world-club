import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { Spinner, SPINNER_SIZES, SPINNER_THICKNESS } from '../../src/components/ui/Spinner'

/**
 * The loader (features 030 and 038, specs/038-themed-spinner): sizes, colour, motion.
 *
 * The figure is drawn by `styles/spinner.css`, which jsdom does not apply, so the
 * component half asserts the markup and the stylesheet half READS the file: sizes,
 * colours and the reduced-motion rules are what keep the figure honest, and a test
 * that never looked at them would pass against a stylesheet that was empty.
 */
const css = readFileSync(resolve(import.meta.dirname, '../../src/styles/spinner.css'), 'utf8')

/** The declarations inside the `{ }` of the first rule whose selector contains `selector`. */
const block = (selector: string, from = 0): string => {
  const at = css.indexOf(selector, from)
  if (at < 0) throw new Error(`no rule for ${selector}`)
  const open = css.indexOf('{', at)
  return css.slice(open + 1, css.indexOf('}', open))
}

/** The `@media (...)` block's whole body, including nested rules. */
const media = (query: string): string => {
  const at = css.indexOf(`@media (${query})`)
  if (at < 0) throw new Error(`no @media (${query})`)
  const open = css.indexOf('{', at)
  let depth = 1
  let i = open + 1
  while (depth > 0 && i < css.length) {
    if (css[i] === '{') depth += 1
    if (css[i] === '}') depth -= 1
    i += 1
  }
  return css.slice(open + 1, i - 1)
}

describe('Spinner', () => {
  it.each(Object.entries(SPINNER_SIZES))('marks the %s size, and the stylesheet draws it at %i px', (size, px) => {
    const { container } = render(<Spinner size={size as keyof typeof SPINNER_SIZES} />)
    const el = container.querySelector('[data-spinner]')!
    expect(el.getAttribute('data-spinner')).toBe(size)
    expect(el.className).toContain('gwc-spinner')
    // The component's numbers and the stylesheet's cannot drift apart.
    const rule = block(`.gwc-spinner[data-spinner="${size}"]`)
    expect(rule).toContain(`--gwc-size: ${px}px`)
    expect(rule).toContain(`--gwc-thickness: ${SPINNER_THICKNESS[size as keyof typeof SPINNER_THICKNESS]}px`)
  })

  it('has the four sizes in increasing order, so a page loader is larger than a button one', () => {
    expect(SPINNER_SIZES.xs).toBeLessThan(SPINNER_SIZES.sm)
    expect(SPINNER_SIZES.sm).toBeLessThan(SPINNER_SIZES.md)
    expect(SPINNER_SIZES.md).toBeLessThan(SPINNER_SIZES.lg)
  })

  it('keeps the ring at one twelfth of the size and never under 2 px, so the smallest stays legible', () => {
    for (const [size, px] of Object.entries(SPINNER_SIZES)) {
      const thickness = SPINNER_THICKNESS[size as keyof typeof SPINNER_THICKNESS]
      expect(thickness).toBeGreaterThanOrEqual(2)
      expect(Math.abs(thickness - px / 12)).toBeLessThanOrEqual(1)
    }
  })

  it('is decorative: hidden from assistive technology and carrying no text', () => {
    const { container } = render(<Spinner />)
    const el = container.querySelector('[data-spinner]')!
    expect(el).toHaveAttribute('aria-hidden', 'true')
    expect(el).not.toHaveAttribute('role')
    expect(container.textContent).toBe('')
  })

  it('takes the colour of its text, navy by default and overridable', () => {
    const { container, rerender } = render(<Spinner />)
    expect(container.querySelector('[data-spinner]')!.className).toContain('text-navy')
    rerender(<Spinner className="text-current" />)
    const el = container.querySelector('[data-spinner]')!
    expect(el.className).toContain('text-current')
    expect(el.className).not.toContain('text-navy')
    expect(el.className).toContain('gwc-spinner') // overriding the colour keeps the figure
  })
})

describe('spinner.css', () => {
  it('colours the arc with currentColor and the ring with a faint tint of it', () => {
    const rule = block('.gwc-spinner {')
    expect(rule).toContain('--gwc-spinner-color: currentColor')
    expect(rule).toMatch(/--gwc-track-color: color-mix\(in srgb, currentColor 25%, transparent\)/)
  })

  it('defines no colour of its own: none of the sample\'s blue, greys or dark mode survived', () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(withoutComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(withoutComments).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch|lab)\(/)
    expect(withoutComments).not.toContain('prefers-color-scheme')
    // The only named colours are the system's, in forced-colours mode, where the page's own are removed.
    const named = withoutComments.match(/\b(?:CanvasText|Canvas|GrayText|Highlight)\b/g) ?? []
    expect(named.sort()).toEqual(['Canvas', 'CanvasText'])
    expect(media('forced-colors: active')).toContain('CanvasText')
  })

  it('grows and shrinks the arc while it turns: the sample\'s motion', () => {
    expect(css).toMatch(/@property --gwc-arc-start\s*{[^}]*<angle>/)
    expect(css).toMatch(/@property --gwc-arc-end\s*{[^}]*<angle>/)
    expect(block('.gwc-spinner {')).toMatch(/conic-gradient\(/)
    expect(block('.gwc-spinner {')).toMatch(/gwc-spinner-turn var\(--gwc-turn\) linear infinite var\(--gwc-dash-animation, \)/)
    expect(block('.gwc-spinner {')).toContain('--gwc-turn: 1.5s')
    expect(css).toMatch(/initial-value:\s*,\s*gwc-spinner-dash 3s ease-in-out infinite/)
    // 3 degrees, to 258 (100 to 358), and back to 3: a dot, most of the ring, a dot.
    const dash = css.slice(css.indexOf('@keyframes gwc-spinner-dash'))
    expect(dash).toMatch(/from\s*{[^}]*--gwc-arc-end:\s*3deg/)
    expect(dash).toMatch(/50%\s*{[^}]*--gwc-arc-start:\s*100deg;[^}]*--gwc-arc-end:\s*358deg/)
    expect(dash).toMatch(/to\s*{[^}]*--gwc-arc-start:\s*360deg;[^}]*--gwc-arc-end:\s*363deg/)
  })

  it('slows down under reduced motion and keeps a fixed arc, but never stops', () => {
    const reduced = media('prefers-reduced-motion: reduce')
    expect(reduced).toContain('--gwc-turn: 6s')
    expect(reduced).toMatch(/--gwc-dash-animation:\s*;/) // the grow-and-shrink is detached
    expect(reduced).toContain('--gwc-arc-end: 158deg')
    // The counter-assertion: nothing in the file halts the turn.
    expect(css).not.toMatch(/animation:\s*none/)
    expect(css).not.toMatch(/animation-play-state/)
    expect(reduced).not.toMatch(/(?:^|[\s;{])animation(?:-[a-z-]+)?\s*:/) // no animation property of its own
  })

  it('hollows the middle with border-area clipping, and with a mask where that is not supported', () => {
    expect(css).toMatch(/@supports \(background-clip: border-area\)\s*{[^}]*background-clip: border-area/)
    expect(css).toMatch(/@supports not \(background-clip: border-area\)\s*{[\s\S]*?mask-image: radial-gradient\(/)
  })

  it('opts out of forced colours so the figure is not stripped to nothing', () => {
    expect(media('forced-colors: active')).toContain('forced-color-adjust: none')
  })
})
