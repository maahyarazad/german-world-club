/**
 * The club's loader (feature 030), drawn from `main-loader.html`: a faint full
 * ring with one arc turning on it.
 *
 * Differences from the supplied file, each on purpose:
 *   - `fill="currentColor"`, so it takes the colour of the text it sits in
 *     (navy by default, white inside a primary button) instead of a fixed blue;
 *   - the size comes from the caller;
 *   - the arc turns by a CSS animation, not SMIL `animateTransform`. SMIL ignores
 *     `prefers-reduced-motion`; a class does not, so `motion-reduce:animate-none`
 *     can stop it. The ring and the still arc still read as a loader.
 *
 * It carries no text: the label belongs to whatever wraps it (`PageLoader`,
 * `Button`), so a screen reader hears it once.
 */
import { memo } from 'react'

export const SPINNER_SIZES = Object.freeze({ xs: 14, sm: 20, md: 32, lg: 48 } as const)
export type SpinnerSize = keyof typeof SPINNER_SIZES

export type SpinnerProps = { size?: SpinnerSize; className?: string }

export const Spinner = memo(({ size = 'md', className = 'text-navy' }: SpinnerProps) => {
  const px = SPINNER_SIZES[size]
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      data-spinner={size}
      className={`shrink-0 ${className}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12,1A11,11,0,1,0,23,12,11,11,0,0,0,12,1Zm0,19a8,8,0,1,1,8-8A8,8,0,0,1,12,20Z"
        opacity=".25"
      />
      <g
        data-spinner-arc=""
        className="animate-spin motion-reduce:animate-none"
        style={{ transformOrigin: '12px 12px', animationDuration: '750ms' }}
      >
        <path d="M10.72,19.9a8,8,0,0,1-6.5-9.79A7.77,7.77,0,0,1,10.4,4.16a8,8,0,0,1,9.49,6.52A1.54,1.54,0,0,0,21.38,12h.13a1.37,1.37,0,0,0,1.38-1.54,11,11,0,1,0-12.7,12.39A1.54,1.54,0,0,0,12,21.34h0A1.47,1.47,0,0,0,10.72,19.9Z" />
      </g>
    </svg>
  )
})

export default Spinner
