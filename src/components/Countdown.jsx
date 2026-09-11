import { useCountdown } from '../hooks/useCountdown.js'
import siteConfig from '../config/site.js'

const pad = (n) => String(n).padStart(2, '0')

/**
 * Live countdown to the configured launch moment.
 *
 * The digits change every second, which is useful to look at and hostile to
 * listen to. They are therefore hidden from assistive technology, and a
 * separate summary carries the value at day granularity instead.
 *
 * Contract: specs/001-coming-soon-revamp/contracts/component-api.md (N1–N5)
 */
function Countdown({ launchDate = siteConfig.launchDate }) {
  const { days, hours, minutes, seconds, hasLaunched } = useCountdown(launchDate)

  const units = [
    { label: 'Days', value: days },
    { label: 'Hours', value: hours },
    { label: 'Minutes', value: minutes },
    { label: 'Seconds', value: seconds },
  ]

  return (
    <section
      id="countdown"
      aria-labelledby="countdown-heading"
      className="surface-countdown px-5 py-24 text-center sm:px-8 sm:py-32"
    >
      <div className="mx-auto max-w-3xl">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-brand-gold">
          {hasLaunched ? 'We are live' : 'Counting down'}
        </p>

        <h2
          id="countdown-heading"
          className="mt-4 font-display text-[clamp(1.75rem,5vw,2.75rem)] font-medium leading-tight text-brand-cream"
        >
          {hasLaunched ? 'The Experts Circle is now open' : 'Opening in'}
        </h2>

        {hasLaunched ? (
          <p className="mt-8 text-base leading-relaxed text-brand-blush sm:text-lg">
            Thank you for waiting. The network is open to members — get in touch and we will
            introduce you.
          </p>
        ) : (
          <>
            <ul
              data-testid="countdown-digits"
              aria-hidden="true"
              className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-5"
            >
              {units.map((unit) => (
                <li
                  key={unit.label}
                  className="rounded-xl border border-brand-gold/25 bg-brand-ink/45 px-3 py-6 backdrop-blur-sm"
                >
                  {/* `motion-safe:` gates the transition on the visitor's
                      motion preference. The value itself always updates — it
                      is information, not decoration (FR-013, N4). */}
                  <span className="block font-display text-[clamp(2.25rem,8vw,3.5rem)] font-medium leading-none tabular-nums text-brand-gold motion-safe:transition-opacity motion-safe:duration-300">
                    {pad(unit.value)}
                  </span>
                  <span className="mt-3 block text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-brand-blush/80">
                    {unit.label}
                  </span>
                </li>
              ))}
            </ul>

            {/* Announced at day granularity: a per-second live region would
                flood the accessibility tree with no benefit to the listener. */}
            <p data-testid="countdown-summary" aria-live="polite" className="sr-only">
              {days === 1 ? '1 day' : `${days} days`} until launch.
            </p>
          </>
        )}
      </div>
    </section>
  )
}

export default Countdown
