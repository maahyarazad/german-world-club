import BrandMark from './BrandMark.jsx'
import siteConfig from '../config/site.js'

/**
 * Above-the-fold identity: who this is, what it is, and that it hasn't opened.
 *
 * The background is layered CSS gradients rather than an image, so the largest
 * contentful paint is a text node and nothing depends on a raster loading
 * before the page is readable.
 */
function Hero() {
  return (
    <section
      id="hero"
      aria-label="Introduction"
      className="surface-hero relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-5 py-20 text-center sm:px-8"
    >
      {/* Decorative only — never carries meaning. */}
      <div
        aria-hidden="true"
        className="animate-glow pointer-events-none absolute -top-40 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-brand-crimson/25 blur-[110px]"
      />

      <div className="animate-fade-up relative flex max-w-3xl flex-col items-center">
        <BrandMark size={84} className="text-brand-gold" />

        <p className="mt-8 text-[0.7rem] font-semibold uppercase tracking-[0.32em] text-brand-blush sm:text-xs">
          {siteConfig.parentOrg}
        </p>

        <h1 className="mt-5 font-display text-[clamp(2.5rem,11vw,5.5rem)] font-medium leading-[1.05] tracking-tight text-brand-cream">
          {siteConfig.brandName}
        </h1>

        <div className="rule-gold mt-8 h-px w-32" aria-hidden="true" />

        <p className="mt-8 max-w-xl text-balance text-base leading-relaxed text-brand-blush sm:text-lg">
          {siteConfig.tagline}
        </p>

        <p className="mt-10 inline-flex items-center gap-2.5 rounded-full border border-brand-gold/40 bg-brand-ink/40 px-5 py-2.5 text-xs font-medium uppercase tracking-[0.18em] text-brand-gold backdrop-blur-sm sm:text-sm">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full bg-brand-gold"
          />
          {siteConfig.status}
        </p>
      </div>

      <a
        href="#offering"
        className="absolute bottom-8 text-xs uppercase tracking-[0.22em] text-brand-blush/70 transition-colors hover:text-brand-cream"
      >
        Read on
        <span aria-hidden="true" className="mt-1.5 block text-center text-base leading-none">
          ↓
        </span>
      </a>
    </section>
  )
}

export default Hero
