import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import About from '../../src/components/About.jsx'
import siteConfig from '../../src/config/site.js'

describe('<About />', () => {
  it('renders every about paragraph', () => {
    render(<About />)
    siteConfig.about.forEach((paragraph) => {
      expect(screen.getByText(paragraph)).toBeInTheDocument()
    })
  })

  it('names the parent organisation', () => {
    render(<About />)
    expect(screen.getAllByText(new RegExp(siteConfig.parentOrg, 'i')).length).toBeGreaterThan(0)
  })

  it('uses a single h2 and skips no heading level', () => {
    const { container } = render(<About />)
    expect(container.querySelectorAll('h2')).toHaveLength(1)
    expect(container.querySelectorAll('h1, h4, h5, h6')).toHaveLength(0)
  })

  it('exposes the section as an accessibly named region', () => {
    render(<About />)
    expect(screen.getByRole('region', { name: /about|club/i })).toBeInTheDocument()
  })
})
