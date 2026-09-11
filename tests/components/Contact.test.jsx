import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Contact from '../../src/components/Contact.jsx'
import siteConfig from '../../src/config/site.js'

const SOCIALS = [
  { id: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/company/example' },
  { id: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/example' },
]

/** Contract: contracts/component-api.md (T1–T5) */
describe('<Contact />', () => {
  it('T1: renders the mailto link unconditionally', () => {
    render(<Contact socials={[]} />)
    const link = screen.getByRole('link', { name: new RegExp(siteConfig.contactEmail, 'i') })
    expect(link).toHaveAttribute('href', `mailto:${siteConfig.contactEmail}`)
  })

  it('T2: renders no social block at all when socials is empty', () => {
    render(<Contact socials={[]} />)
    expect(screen.queryByTestId('social-links')).toBeNull()
  })

  it('T2: renders no empty container or placeholder when socials is empty', () => {
    const { container } = render(<Contact socials={[]} />)
    expect(container.querySelectorAll('svg')).toHaveLength(0)
    expect(container.textContent).not.toMatch(/follow us/i)
  })

  it('T2: renders a link per channel when socials is populated', () => {
    render(<Contact socials={SOCIALS} />)
    const list = within(screen.getByTestId('social-links'))
    SOCIALS.forEach((s) => expect(list.getByRole('link', { name: s.label })).toBeInTheDocument())
  })

  it('T3: opens external channels safely', () => {
    render(<Contact socials={SOCIALS} />)
    SOCIALS.forEach((s) => {
      const link = screen.getByRole('link', { name: s.label })
      expect(link).toHaveAttribute('href', s.url)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
      expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
    })
  })

  it('T4: names each link by its label and hides the icon from assistive tech', () => {
    const { container } = render(<Contact socials={SOCIALS} />)
    expect(screen.getByRole('link', { name: 'LinkedIn' })).toBeInTheDocument()
    container.querySelectorAll('[data-testid="social-links"] svg').forEach((svg) => {
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    })
  })

  it('T5: falls back to the text label for an unknown icon id', () => {
    render(<Contact socials={[{ id: 'nope', label: 'Unknown', url: 'https://example.com' }]} />)
    const link = screen.getByRole('link', { name: 'Unknown' })
    expect(link).toHaveTextContent('Unknown')
    expect(link.querySelector('svg')).toBeNull()
  })

  it('defaults to the configured socials when no prop is given', () => {
    render(<Contact />)
    // siteConfig ships an empty list, so no block should appear.
    expect(siteConfig.socials).toHaveLength(0)
    expect(screen.queryByTestId('social-links')).toBeNull()
  })

  it('exposes the section as an accessibly named region', () => {
    render(<Contact socials={[]} />)
    const heading = screen.getByRole('heading', { level: 2 })
    expect(screen.getByRole('region', { name: heading.textContent })).toBeInTheDocument()
  })
})
