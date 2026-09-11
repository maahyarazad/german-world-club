import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Hero from '../../src/components/Hero.jsx'
import siteConfig from '../../src/config/site.js'

describe('<Hero />', () => {
  it('renders the brand name as the page heading', () => {
    render(<Hero />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(within(h1).getByText(siteConfig.brandName)).toBeInTheDocument()
  })

  it('contains exactly one h1', () => {
    const { container } = render(<Hero />)
    expect(container.querySelectorAll('h1')).toHaveLength(1)
  })

  it('renders the parent organisation', () => {
    render(<Hero />)
    expect(screen.getByText(siteConfig.parentOrg)).toBeInTheDocument()
  })

  it('renders the tagline', () => {
    render(<Hero />)
    expect(screen.getByText(siteConfig.tagline)).toBeInTheDocument()
  })

  it('states explicitly that the site is pre-launch', () => {
    render(<Hero />)
    expect(screen.getByText(siteConfig.status)).toBeInTheDocument()
  })

  it('renders the brand mark with an accessible name', () => {
    render(<Hero />)
    expect(screen.getByRole('img', { name: /experts circle/i })).toBeInTheDocument()
  })

  it('uses no raster image, so LCP stays a text node', () => {
    const { container } = render(<Hero />)
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })
})
