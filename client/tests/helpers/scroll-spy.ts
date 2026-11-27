import { vi } from 'vitest'
import type { Mock } from 'vitest'
import { act, configure } from '@testing-library/react'

// These tests wait for a request, a render and then one animation frame, and the whole client
// suite runs in parallel jsdom workers: under load the default 1 s `waitFor` ran out once on a
// page that was merely slow. Importing this helper raises it for the files that use it only
// (vitest isolates modules per file).
configure({ asyncUtilTimeout: 4000 })

/**
 * A spy on `Element.prototype.scrollIntoView`, for the pages that bring an
 * outcome message into view (feature 041, `useReveal`).
 *
 * jsdom has no layout and no `scrollIntoView` at all, so there is nothing to
 * spy *on*: this defines one. A test then asks which elements the page tried
 * to reveal, in order, and with which options, which is the whole of what the
 * code under test decides. Whether a message that is already in view stays put
 * is the browser's `block: 'nearest'` behaviour and cannot be seen here; the
 * manual steps in specs/041-scroll-to-form-message/quickstart.md cover it.
 *
 * Call it in `beforeEach` and `restore()` in `afterEach`, so the prototype is
 * left as it was found (the hook's own "jsdom has none" test relies on that).
 */
export type ScrollSpy = {
  spy: Mock
  /** The elements `scrollIntoView` was called on, oldest first. */
  revealed(): Element[]
  /** The first argument of each call, oldest first. */
  options(): unknown[]
  restore(): void
}

export function installScrollSpy(): ScrollSpy {
  const proto = Element.prototype as unknown as { scrollIntoView?: unknown }
  const hadOwn = Object.prototype.hasOwnProperty.call(proto, 'scrollIntoView')
  const previous = proto.scrollIntoView
  const spy = vi.fn()
  proto.scrollIntoView = spy

  return {
    spy,
    revealed: () => spy.mock.contexts as Element[],
    options: () => spy.mock.calls.map((call) => call[0]),
    restore() {
      if (hadOwn) proto.scrollIntoView = previous
      else delete proto.scrollIntoView
    },
  }
}

/**
 * Two animation frames. `useReveal` moves one frame after the commit, so
 * "nothing was revealed" can only be asserted after waiting that long; without
 * it a counter-assertion would pass against a page that reveals a moment later.
 */
export const settle = () =>
  act(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
