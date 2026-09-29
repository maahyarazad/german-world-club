import { z } from 'zod'
import { PROBLEMS } from '@gwc/contracts/errors'
import { buildApp } from '../../src/app.ts'
import type { BuildAppOptions, GwcApp } from '../../src/app.ts'

/**
 * An app with probe routes for every way a request can end badly (feature 012).
 *
 * `/probe/boom/:id` is the one unexpected fault; everything else is a refusal
 * or a deliberate 5xx that must NOT leave a record.
 */
export async function buildFaultApp(options: BuildAppOptions = {}) {
  const app = await buildApp(options)
  // The boot gate still requires a response schema on every route.
  const ok = { 200: z.object({ ok: z.boolean() }) }
  const posture = { config: { auth: { audience: 'public' as const } }, schema: { response: ok } }
  const withStatus = (status: number, problem?: unknown) =>
    Object.assign(new Error(`refused with ${status}`), { statusCode: status, ...(problem ? { problem } : {}) })

  app.get('/probe/boom/:id', posture, async () => {
    throw new Error('boom')
  })
  app.get('/probe/secret', posture, async () => {
    throw Object.assign(
      new Error(
        'lookup failed for anna.schmidt@example.de at +49 151 2345-6789 with ' +
        'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlLXZhbHVl and ' +
        'a3f9c2e81b7d4056a3f9c2e81b7d4056a3f9c2e8',
      ),
      { code: 'E_PROBE', detail: 'Key (email)=(anna.schmidt@example.de) already exists' },
    )
  })
  app.post('/probe/secret-body', posture, async () => {
    throw new Error('failed while saving the form')
  })
  app.get('/probe/refused/:status', posture, async (request) => {
    throw withStatus(Number((request.params as { status: string }).status))
  })
  app.get('/probe/validated', { ...posture, schema: { response: ok, querystring: z.object({ n: z.coerce.number().int() }) } },
    async () => ({ ok: true }))
  app.get('/probe/deadline', posture, async () => {
    throw withStatus(503, PROBLEMS.REQUEST_DEADLINE_EXCEEDED)
  })
  app.get('/probe/breaker-open', posture, async () => {
    throw withStatus(503)
  })
  return app
}

/** Wait until every recorder insert started so far has settled. */
export async function settled(app: GwcApp) {
  await (app.recordServerFault as unknown as { drain(): Promise<void> }).drain()
}

export const faultRows = (app: GwcApp) =>
  app.pg.query(
    `SELECT request_id, client_request_id, method, route, status, error_name, error_code,
            message, stack, principal_kind, principal_id, fingerprint, instance_id
       FROM server_faults ORDER BY occurred_at, id`,
  ).then((r) => r.rows)
