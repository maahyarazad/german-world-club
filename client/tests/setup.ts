import '@testing-library/jest-dom/vitest'
import axe from 'axe-core'
import { expect } from 'vitest'

/**
 * Runs axe-core against a container and asserts zero WCAG 2.1 A/AA violations.
 * Used in place of `vitest-axe`, whose only stable release (0.1.0) is long
 * unmaintained; axe-core is the engine that package wraps.
 */
export async function expectNoA11yViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  })

  const summary = results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.html).join('\n    ')}`)
    .join('\n  ')

  expect(results.violations, `Accessibility violations found:\n  ${summary}`).toHaveLength(0)
}
