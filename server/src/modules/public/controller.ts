import { renderRecord, PUBLIC_CACHE, VARY } from './application/render-record.ts'
import { renderLanding, LANDING_RECORD, LANDING_RECORD_EN, LANDING_ALTERNATES } from './application/landing.ts'
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

    const html = renderLanding({ shell, record, origin, nonce: reply.cspNonce?.style })
    return reply.send(html)
  }

  return {
    renderRecordPage,
    landing: landingHandler(landingShell, LANDING_RECORD),
    landingEn: landingHandler(landingShellEn, LANDING_RECORD_EN),
  }
}

export { LANDING_ALTERNATES }
