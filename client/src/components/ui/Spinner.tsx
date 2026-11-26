/**
 * The club's loader (features 030 and 038): a ring with an arc that grows and
 * shrinks while it turns. The figure and its motion are CSS, in
 * `styles/spinner.css`, drawn from `specs/038-themed-spinner/loading-spinner.html`.
 *
 * Decisions kept from feature 030, each on purpose:
 *   - the arc is `currentColor`, so it takes the colour of the text it sits in
 *     (navy by default, white inside a primary button) instead of a fixed blue,
 *     and the ring is a faint tint of the same. The colours come from the club's
 *     theme and none are written here or in the stylesheet;
 *   - the size comes from the caller;
 *   - it is decorative and carries no text: the label belongs to whatever wraps
 *     it (`PageLoader`, `Button`), so a screen reader hears it once.
 *
 * What changed in 038: it is a `<span>` styled by CSS instead of an SVG turned by
 * a utility class, so the arc can change length, and under reduced motion it
 * slows down instead of stopping (see spinner.css for why).
 */
import { memo } from 'react'

export const SPINNER_SIZES = Object.freeze({ xs: 14, sm: 20, md: 32, lg: 48 } as const)
export type SpinnerSize = keyof typeof SPINNER_SIZES

/**
 * The ring's thickness in px for each size: 1/12 of the size, never under 2 px so
 * the smallest, inside a button, stays legible. Mirrors `spinner.css`; a test
 * reads that file and fails if the two disagree.
 */
export const SPINNER_THICKNESS = Object.freeze({ xs: 2, sm: 2, md: 3, lg: 4 } as const)

export type SpinnerProps = { size?: SpinnerSize; className?: string }

export const Spinner = memo(({ size = 'md', className = 'text-navy' }: SpinnerProps) => (
  <span aria-hidden="true" data-spinner={size} className={`gwc-spinner ${className}`} />
))

export default Spinner
