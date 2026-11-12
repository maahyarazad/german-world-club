import { formatReferralCode } from '@gwc/contracts/referrals'
import { escape, renderPage } from './layout.ts'

/**
 * The referral landing page (feature 018, research R8): what a tapped
 * https://<host>/r/CODE shows when the app does not take the link itself.
 *
 * Server-rendered and script-free, like every public page: WhatsApp, iMessage
 * and Telegram fetch it to build a preview and run no JavaScript, so a
 * client-rendered page would share as an empty card.
 *
 * One language per URL, switched by link (`/r/<code>` and `/r/<code>/en`),
 * never by the Accept-Language header — the same rule as `/` and `/en`. A path
 * rather than `?lang=en`, because the canonical-origin plugin strips query
 * parameters it does not know from every public URL (and lower-cases the path,
 * which is why the code appears in lower case in every URL here).
 *
 * Never indexed: the `robots` meta says so here, and the `referral-landing`
 * surface stamps `X-Robots-Tag` on the response.
 */

export type LandingLang = 'de' | 'en'

const COPY = {
  de: {
    invitesYou: (name: string) => `${name} lädt dich in den German World Club ein`,
    team: 'Das Team des German World Club lädt dich ein',
    anonymous: 'Du wurdest in den German World Club eingeladen',
    intro: 'Der Club für deutschsprachige Expats. Registriere dich mit diesem Code, damit deine Einladung zählt.',
    code: 'Dein Einladungscode',
    web: 'Im Browser registrieren',
    app: 'In der App öffnen',
    appHint: 'Du hast die App schon? Öffne den Link dort, oder gib den Code bei der Registrierung ein.',
    otherLanguage: 'English',
    notFoundTitle: 'Dieser Einladungslink ist nicht mehr gültig',
    notFoundBody: 'Du kannst dich trotzdem beim German World Club registrieren.',
    register: 'Zur Registrierung',
    description: 'Eine persönliche Einladung in den German World Club.',
  },
  en: {
    invitesYou: (name: string) => `${name} invites you to German World Club`,
    team: 'The German World Club team invites you',
    anonymous: 'You have been invited to German World Club',
    intro: 'The club for German-speaking expats. Register with this code so your invitation counts.',
    code: 'Your invitation code',
    web: 'Register in the browser',
    app: 'Open in the app',
    appHint: 'Already have the app? Open the link there, or enter the code when you register.',
    otherLanguage: 'Deutsch',
    notFoundTitle: 'This invitation link is no longer valid',
    notFoundBody: 'You can still register with German World Club.',
    register: 'Go to registration',
    description: 'A personal invitation to German World Club.',
  },
} as const

/** The app's URL scheme (app.config.js `scheme`): the fallback when the OS did not hand the https link over. */
export const APP_SCHEME = 'germanworldclub'

function pageMeta({ lang, title, description, url }: { lang: LandingLang; title: string; description: string; url: string }) {
  return {
    lang,
    title,
    description,
    robots: 'noindex,nofollow',
    canonical: url,
    alternates: [],
    og: {
      type: 'website',
      siteName: 'German World Club',
      title,
      description,
      url,
      locale: lang === 'de' ? 'de_DE' : 'en_GB',
    },
    twitter: { card: 'summary', title, description, image: undefined },
    // No JSON-LD: a per-person invitation is not structured content about
    // anything, and the page is not meant to be understood by a search engine.
    jsonLd: [],
  }
}

export function renderReferralLanding(
  { origin, code, owner, lang, nonce }:
    { origin: string; code: string; owner: { name: string | null; team: boolean }; lang: LandingLang; nonce?: string },
) {
  const c = COPY[lang]
  const heading = owner.team ? c.team : owner.name ? c.invitesYou(owner.name) : c.anonymous
  const path = `/r/${code.toLowerCase()}`
  const url = `${origin}${lang === 'de' ? path : `${path}/en`}`
  // /konsole is gated, so the canonical-origin plugin leaves its query alone.
  const registerUrl = `/konsole/registrieren?ref=${encodeURIComponent(code)}`
  const appUrl = `${APP_SCHEME}://r/${code}`
  const switchUrl = lang === 'de' ? `${path}/en` : path

  const body = `
<p><a href="${escape(switchUrl)}" hreflang="${lang === 'de' ? 'en' : 'de'}">${escape(c.otherLanguage)}</a></p>
<h1>${escape(heading)}</h1>
<p>${escape(c.intro)}</p>
<h2>${escape(c.code)}</h2>
<p><strong>${escape(formatReferralCode(code))}</strong></p>
<p><a href="${escape(registerUrl)}">${escape(c.web)}</a></p>
<p><a href="${escape(appUrl)}">${escape(c.app)}</a></p>
<p>${escape(c.appHint)}</p>
`.trim()

  return renderPage({ pageMeta: pageMeta({ lang, title: heading, description: c.description, url }), body, nonce })
}

/**
 * One page for every code that credits nobody — unknown, replaced, disabled,
 * owner locked. It must not vary with the code in any way (FR-006, SC-006), so
 * it carries none: not in the body, not in the canonical, not in a link.
 */
export function renderReferralNotFound({ origin, lang, nonce }: { origin: string; lang: LandingLang; nonce?: string }) {
  const c = COPY[lang]
  const body = `
<h1>${escape(c.notFoundTitle)}</h1>
<p>${escape(c.notFoundBody)}</p>
<p><a href="/konsole/registrieren">${escape(c.register)}</a></p>
`.trim()
  return renderPage({
    pageMeta: pageMeta({ lang, title: c.notFoundTitle, description: c.notFoundBody, url: `${origin}/` }),
    body,
    nonce,
  })
}
