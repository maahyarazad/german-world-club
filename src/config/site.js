/**
 * Single source of truth for everything the coming-soon page says.
 *
 * Contract: specs/001-coming-soon-revamp/contracts/site-config.md
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PLACEHOLDER CONTENT — the club must supply real values before public launch.
 * Every field marked `PLACEHOLDER` below is a stand-in. No real contact address
 * or social URL has been invented: the email uses the IANA-reserved example.com
 * domain, and `socials` ships empty so no dead links are rendered.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Fallback launch date. ISO 8601 with an explicit Gulf Standard Time offset.
 *  The offset is mandatory: a bare date parses as UTC and an offset-less
 *  datetime parses as local time, so either would show a different countdown
 *  in Dubai than in Berlin. */
const DEFAULT_LAUNCH_DATE = '2026-12-01T09:00:00+04:00' // PLACEHOLDER — club to confirm

/**
 * Resolves the launch date, preferring VITE_LAUNCH_DATE when it parses.
 * Never returns a value that would render as "Invalid Date" (guarantee C3).
 */
function resolveLaunchDate() {
  const override = import.meta.env?.VITE_LAUNCH_DATE

  if (typeof override === 'string' && override.trim() !== '') {
    if (!Number.isNaN(new Date(override).getTime())) return override
    console.warn(
      `[site.config] VITE_LAUNCH_DATE ("${override}") is not a valid date. ` +
        `Falling back to ${DEFAULT_LAUNCH_DATE}.`,
    )
  }

  return DEFAULT_LAUNCH_DATE
}

export const siteConfig = Object.freeze({
  brandName: 'Experts Circle',
  parentOrg: 'German Emirates Club',
  domain: 'expertscircle.german-emirates-club.com',

  tagline: 'A private network of German and Emirati specialists — opening soon.',

  status: 'Launching soon',

  description:
    'Experts Circle is a private network by the German Emirates Club, connecting ' +
    'members with vetted specialists across law, finance, engineering and trade in ' +
    'Germany and the United Arab Emirates.',

  launchDate: resolveLaunchDate(),

  // PLACEHOLDER copy — club to review and replace.
  offerings: Object.freeze([
    Object.freeze({
      id: 'network',
      title: 'A vetted network',
      body: 'Specialists in law, finance, engineering and trade, each one known to the club and accountable to it.',
    }),
    Object.freeze({
      id: 'introductions',
      title: 'Personal introductions',
      body: 'No directories to search. Tell us what you need and we introduce you to the right person directly.',
    }),
    Object.freeze({
      id: 'briefings',
      title: 'Members’ briefings',
      body: 'Regular, practical briefings on regulation, market entry and cross-border practice in both countries.',
    }),
    Object.freeze({
      id: 'counsel',
      title: 'Counsel you can place',
      body: 'Every expert is introduced with their background, their track record and the limits of their remit.',
    }),
  ]),

  // PLACEHOLDER copy — club to review and replace.
  about: Object.freeze([
    'The German Emirates Club has spent years building a bridge between German and ' +
      'Emirati business — a place where introductions are made carefully and reputations ' +
      'are held to account.',
    'Experts Circle extends that work. It gathers the specialists our members already ' +
      'rely on into one network, so that finding the right counsel is a matter of asking ' +
      'rather than searching. We are preparing it now and will open it to members shortly.',
  ]),

  // PLACEHOLDER — club to supply the real address.
  // Uses the IANA-reserved example.com domain so no mail can reach a real inbox.
  contactEmail: 'hello@example.com',

  /**
   * Channels the club actually operates. Intentionally EMPTY: no confirmed
   * URLs have been supplied, and FR-010 requires omitting a channel rather
   * than rendering a dead link. The Contact section renders no social block
   * at all while this is empty.
   *
   * To enable, add entries whose `id` matches a <symbol id="{id}-icon"> in
   * public/icons.svg — e.g.
   *   { id: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/company/…' }
   */
  socials: Object.freeze([]),
})

export default siteConfig
