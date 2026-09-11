import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Offering from '../../src/components/Offering.jsx'
import siteConfig from '../../src/config/site.js'

describe('<Offering />', () => {
  it('renders every configured offering', () => {
    render(<Offering />)
    siteConfig.offerings.forEach((offering) => {
      expect(screen.getByText(offering.title)).toBeInTheDocument()
      expect(screen.getByText(offering.body)).toBeInTheDocument()
    })
  })

  it('renders one h3 per offering beneath a single h2 section heading', () => {
    const { container } = render(<Offering />)
    expect(container.querySelectorAll('h2')).toHaveLength(1)
    expect(container.querySelectorAll('h3')).toHaveLength(siteConfig.offerings.length)
  })

  it('never skips a heading level (no h1, no h4)', () => {
    const { container } = render(<Offering />)
    expect(container.querySelectorAll('h1, h4, h5, h6')).toHaveLength(0)
  })

  it('exposes the section as a region named by its own heading', () => {
    render(<Offering />)
    const heading = screen.getByRole('heading', { level: 2 })
    expect(screen.getByRole('region', { name: heading.textContent })).toBeInTheDocument()
  })

  it('renders whatever the array holds rather than a fixed count', () => {
    const { container } = render(<Offering />)
    expect(container.querySelectorAll('h3').length).toBe(siteConfig.offerings.length)
    expect(siteConfig.offerings.length).toBeGreaterThanOrEqual(3)
  })
})
