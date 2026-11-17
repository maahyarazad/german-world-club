import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Spinner, SPINNER_SIZES } from '../../src/components/ui/Spinner'

/** The loader (feature 030, contracts/ui-contract.md): sizes, colour, motion. */
describe('Spinner', () => {
  it.each(Object.entries(SPINNER_SIZES))('draws the %s size at %i px', (size, px) => {
    const { container } = render(<Spinner size={size as keyof typeof SPINNER_SIZES} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe(String(px))
    expect(svg.getAttribute('height')).toBe(String(px))
  })

  it('has the four sizes in increasing order, so a page loader is larger than a button one', () => {
    expect(SPINNER_SIZES.xs).toBeLessThan(SPINNER_SIZES.sm)
    expect(SPINNER_SIZES.sm).toBeLessThan(SPINNER_SIZES.md)
    expect(SPINNER_SIZES.md).toBeLessThan(SPINNER_SIZES.lg)
  })

  it('is decorative: hidden from assistive technology and carrying no text', () => {
    const { container } = render(<Spinner />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(container.textContent).toBe('')
  })

  it('takes the colour of its text (currentColor), navy by default and overridable', () => {
    const { container, rerender } = render(<Spinner />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('fill')).toBe('currentColor')
    expect(svg.getAttribute('class')).toContain('text-navy')
    rerender(<Spinner className="text-current" />)
    expect(container.querySelector('svg')!.getAttribute('class')).toContain('text-current')
    expect(container.querySelector('svg')!.getAttribute('class')).not.toContain('text-navy')
  })

  it('draws the ring at a quarter opacity and turns only the arc', () => {
    const { container } = render(<Spinner />)
    const paths = container.querySelectorAll('path')
    expect(paths).toHaveLength(2)
    expect(paths[0]!.getAttribute('opacity')).toBe('.25')
    expect(paths[0]!.closest('[data-spinner-arc]')).toBeNull() // the ring stays still
    expect(paths[1]!.closest('[data-spinner-arc]')).not.toBeNull()
  })

  it('stops turning when the user asks for reduced motion (the class is what honours the setting)', () => {
    const { container } = render(<Spinner />)
    const arc = container.querySelector('[data-spinner-arc]')!
    expect(arc.getAttribute('class')).toContain('animate-spin')
    expect(arc.getAttribute('class')).toContain('motion-reduce:animate-none')
    expect((arc as SVGGElement).style.animationDuration).toBe('750ms')
  })
})
