import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from '../../src/components/ui/Button'

/** Button `loading` (feature 030): disabled, busy, the loader over a label that keeps its place. */
describe('Button loading', () => {
  it('is disabled and busy, shows the loader, and ignores a click', () => {
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>Speichern</Button>)
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button.querySelector('svg[data-spinner="xs"]')).not.toBeNull()
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('keeps the label in the layout, hidden, so the button does not change size', () => {
    const { rerender } = render(<Button>Speichern</Button>)
    const idle = screen.getByRole('button')
    expect(idle.textContent).toBe('Speichern')
    rerender(<Button loading>Speichern</Button>)
    const busy = screen.getByRole('button')
    // The same text is still there (it sets the width), just invisible.
    expect(busy.textContent).toBe('Speichern')
    expect(busy.querySelector('.invisible')?.textContent).toBe('Speichern')
    // The loader is overlaid, not added to the flow.
    expect(busy.querySelector('.absolute svg')).not.toBeNull()
  })

  it('is a normal enabled button with no loader when not loading (counter-assertion)', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Speichern</Button>)
    const button = screen.getByRole('button')
    expect(button).toBeEnabled()
    expect(button).not.toHaveAttribute('aria-busy')
    expect(button.querySelector('svg')).toBeNull()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('stays disabled for its own reasons when it is not loading', () => {
    render(<Button disabled>Speichern</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy')
  })
})
