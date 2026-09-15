import siteConfig from '../config/site.js'

/** What the Experts Circle will offer, as scannable points rather than prose. */
function Offering() {
  return (
    <section
      id="offering"
      aria-labelledby="offering-heading"
      className="bg-brand-ink px-5 py-24 sm:px-8 sm:py-32"
    >
      <div className="mx-auto max-w-5xl">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-brand-gold">
          What is coming
        </p>

        <h2
          id="offering-heading"
          className="mt-4 max-w-2xl font-display text-[clamp(1.9rem,5vw,3rem)] font-medium leading-tight text-brand-cream"
        >
          A network built on introductions, not directories
        </h2>

        <ul className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2">
          {siteConfig.offerings.map((offering, index) => (
            <li key={offering.id} className="border-t border-brand-blush/15 pt-6">
              <span
                aria-hidden="true"
                className="font-display text-sm tabular-nums text-brand-gold/80"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-3 font-display text-xl font-medium text-brand-cream sm:text-2xl">
                {offering.title}
              </h3>
              <p className="mt-3 text-[0.95rem] leading-relaxed text-brand-blush/85">
                {offering.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export default Offering
