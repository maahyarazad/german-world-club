import siteConfig from '../config/site.js'

/**
 * Context on the club behind the network.
 *
 * Rendered on the cream surface: this is the longest prose on the page, so it
 * sits on the highest-contrast pairing in the palette (ink on cream, 18.19:1).
 */
function About() {
  return (
    <section
      id="about"
      aria-labelledby="about-heading"
      className="bg-brand-cream px-5 py-24 text-brand-ink sm:px-8 sm:py-32"
    >
      <div className="mx-auto max-w-5xl sm:grid sm:grid-cols-[minmax(0,18rem)_1fr] sm:gap-16">
        <div>
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-brand-red">
            About
          </p>
          <h2
            id="about-heading"
            className="mt-4 font-display text-[clamp(1.9rem,5vw,2.75rem)] font-medium leading-tight text-balance"
          >
            {siteConfig.parentOrg}
          </h2>
        </div>

        <div className="mt-8 max-w-[65ch] space-y-6 sm:mt-2">
          {siteConfig.about.map((paragraph) => (
            <p key={paragraph.slice(0, 32)} className="text-base leading-relaxed sm:text-lg">
              {paragraph}
            </p>
          ))}
        </div>
      </div>
    </section>
  )
}

export default About
