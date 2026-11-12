import { renderRecord, PUBLIC_CACHE, VARY } from './application/render-record.ts'
import { renderLanding, LANDING_RECORD, LANDING_RECORD_EN, LANDING_ALTERNATES } from './application/landing.ts'
import { renderMarketplaceDiscovery } from './application/marketplace-discovery.ts'
import { renderReferralPage, appleAppSiteAssociation, androidAssetLinks } from './application/referral-landing.ts'
import { PROBLEMS } from '@gwc/contracts/errors'
import { forbidden } from '../../authz/require-permission.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { GwcApp } from '../../app.ts'

/**
 * Every handler here resolves a record or a landing shell through
 * `application/`, then shapes the HTML response (cache headers, content
 * language, CSP nonce). None of the record-resolution or template rules live
 * in this file.
 */
export function createPublicController(app: GwcApp, { origin, landingShell, landingShellEn }) {
  const renderRecordPage = (recordType, fixedSlug) => async (request: FastifyRequest, reply: FastifyReply) => {
    const { html, language } = await renderRecord(app, {
      recordType,
      slug: fixedSlug ?? request.params.slug,
      origin,
      nonce: reply.cspNonce?.style,
      signal: request.deadlineSignal,
    })

    return reply
      .code(200)
      .type('text/html; charset=utf-8')
      .header('cache-control', PUBLIC_CACHE)
      .header('vary', VARY)
      .header('content-language', language)
      .send(html)
  }

  const landingHandler = (shell, record) => async (request: FastifyRequest, reply: FastifyReply) => {
    reply
      .type('text/html; charset=utf-8')
      .header('cache-control', PUBLIC_CACHE)
      .header('vary', VARY)

    const html = renderLanding({ shell, record, origin, cspNonce: reply.cspNonce })
    return reply.send(html)
  }

  const marketplaceDiscovery = async (request: FastifyRequest, reply: FastifyReply) => {
    const html = await renderMarketplaceDiscovery(app, {
      origin, nonce: reply.cspNonce?.style, signal: request.deadlineSignal,
    })
    return reply
      .code(200)
      .type('text/html; charset=utf-8')
      .header('cache-control', PUBLIC_CACHE)
      .header('vary', VARY)
      .send(html)
  }

  // Feature 018. Not PUBLIC_CACHE: the page names a person and must stop
  // naming them the moment their link is disabled, so nothing may keep a copy.
  // No `vary`: the language is in the URL, not the headers.
  const referralLanding = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = request.params as { code: string }
    // The language is in the path (/r/<code>/en), never in a header.
    const lang = request.url.split('?')[0]!.endsWith('/en') ? 'en' : 'de'
    const { status, html } = await renderReferralPage(app, {
      code, lang, origin, nonce: reply.cspNonce?.style,
    })
    return reply
      .code(status)
      .type('text/html; charset=utf-8')
      .header('cache-control', 'private, no-store')
      // The URL carries the code; it must not travel onward in a Referer.
      .header('referrer-policy', 'no-referrer')
      .send(html)
  }

  const appleAppLinks = async (_request: FastifyRequest, reply: FastifyReply) =>
    reply.type('application/json').header('cache-control', 'public, max-age=3600')
      .send(appleAppSiteAssociation(app.env.APPLE_APP_ID))

  const androidAppLinks = async (_request: FastifyRequest, reply: FastifyReply) => {
    const fingerprints = app.env.ANDROID_APP_CERT_SHA256
    // Unconfigured is a 404, not an empty list: an empty file would tell
    // Android verification "this domain vouches for no app", and a failed
    // verification is remembered by the device far longer than a missing file.
    if (fingerprints.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'Not found.')
    return reply.type('application/json').header('cache-control', 'public, max-age=3600')
      .send(androidAssetLinks(app.env.ANDROID_APP_PACKAGE, fingerprints))
  }

  return {
    referralLanding,
    appleAppLinks,
    androidAppLinks,
    renderRecordPage,
    landing: landingHandler(landingShell, LANDING_RECORD),
    landingEn: landingHandler(landingShellEn, LANDING_RECORD_EN),
    marketplaceDiscovery,
  }
}

export { LANDING_ALTERNATES }
