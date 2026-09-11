import siteConfig from '../config/site.js'

/** Icon symbols available in public/icons.svg. */
const KNOWN_ICONS = new Set(['linkedin', 'instagram', 'x'])

/**
 * Contact routes and social channels.
 *
 * A channel the club does not operate is omitted rather than rendered as a
 * dead link, so an empty list produces no social block at all (FR-010).
 *
 * Contract: specs/001-coming-soon-revamp/contracts/component-api.md (T1–T5)
 */
function Contact({ socials = siteConfig.socials }) {
  const channels = Array.isArray(socials) ? socials : []

  return (
    <section
      id="contact"
      aria-labelledby="contact-heading"
      className="bg-brand-ink px-5 py-24 sm:px-8 sm:py-32"
    >
      <div className="mx-auto max-w-5xl">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-brand-gold">
          Get in touch
        </p>

        <h2
          id="contact-heading"
          className="mt-4 max-w-2xl font-display text-[clamp(1.9rem,5vw,3rem)] font-medium leading-tight text-brand-cream"
        >
          Speak to us before we open
        </h2>

        <p className="mt-6 max-w-xl text-base leading-relaxed text-brand-blush/85">
          If you would like to join as a member, or to be considered as an expert, write to us
          and we will reply personally.
        </p>

        <a
          href={`mailto:${siteConfig.contactEmail}`}
          className="mt-8 inline-block font-display text-xl text-brand-cream underline decoration-brand-gold/50 underline-offset-[6px] transition-colors hover:decoration-brand-gold sm:text-2xl"
        >
          {siteConfig.contactEmail}
        </a>

        {channels.length > 0 && (
          <ul data-testid="social-links" className="mt-12 flex flex-wrap items-center gap-3">
            {channels.map((channel) => {
              const hasIcon = KNOWN_ICONS.has(channel.id)
              return (
                <li key={channel.id}>
                  <a
                    href={channel.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={channel.label}
                    className="inline-flex items-center gap-2 rounded-full border border-brand-blush/20 px-4 py-2.5 text-sm text-brand-blush transition-colors hover:border-brand-gold/50 hover:text-brand-cream"
                  >
                    {hasIcon ? (
                      <svg aria-hidden="true" className="h-4 w-4" focusable="false">
                        <use href={`/icons.svg#${channel.id}-icon`} />
                      </svg>
                    ) : null}
                    {channel.label}
                  </a>
                </li>
              )
            })}
          </ul>
        )}

        <div className="rule-gold mt-16 h-px w-full" aria-hidden="true" />

        <p className="mt-8 text-xs text-brand-blush/60">
          © {new Date().getFullYear()} {siteConfig.parentOrg}. {siteConfig.domain}
        </p>
      </div>
    </section>
  )
}

export default Contact
