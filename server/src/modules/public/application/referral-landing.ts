import { resolveActiveLink } from '../../referrals/application/codes.ts'
import { ownerDisplayName } from '../../referrals/application/owner-name.ts'
import { renderReferralLanding, renderReferralNotFound } from '../templates/referral.ts'
import type { LandingLang } from '../templates/referral.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * GET /r/:code (feature 018, research R8).
 *
 * Read live on every request (Principle III): a link disabled a second ago
 * must already answer 404, and its owner's name must not linger in a cache.
 * Every code that credits nobody — malformed, unknown, replaced, disabled,
 * owner no longer active — is the SAME 404, because `resolveActiveLink` does
 * not say which of those it was (FR-006, SC-006).
 */
export async function renderReferralPage(
  app: GwcApp,
  { code, lang, origin, nonce }: { code: string; lang: LandingLang; origin: string; nonce?: string },
): Promise<{ status: 200 | 404; html: string }> {
  const link = await resolveActiveLink(app.pg, code)
  if (!link) return { status: 404, html: renderReferralNotFound({ origin, lang, nonce }) }

  const owner = await ownerDisplayName(app.pg, link.ownerKind, link.ownerId)
  // The stored, normalised code — never the one typed into the URL, so the
  // page shows and links the canonical form whatever spelling arrived.
  const { rows } = await app.pg.query('SELECT code FROM referral_links WHERE id = $1', [link.linkId])
  return { status: 200, html: renderReferralLanding({ origin, code: String(rows[0].code), owner, lang, nonce }) }
}

/**
 * The two files an OS fetches to decide whether a tapped /r/ link may open the
 * app (research R9). Both claim /r/* and nothing else: the rest of the domain —
 * the landing page, partner pages, the magazine — must keep opening in the
 * browser.
 */
export function appleAppSiteAssociation(appId: string) {
  return {
    applinks: {
      details: [
        // iOS 13+ first, as Apple recommends; the older shape for the rest.
        { appIDs: [appId], components: [{ '/': '/r/*' }] },
        { appID: appId, paths: ['/r/*'] },
      ],
    },
  }
}

export function androidAssetLinks(packageName: string, fingerprints: readonly string[]) {
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: [...fingerprints] },
  }]
}
