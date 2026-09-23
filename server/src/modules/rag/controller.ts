import { PROBLEMS } from '@gwc/contracts/errors'
import { ask, RagNotConfiguredError } from './application/ask.ts'
import type { Pool } from 'pg'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'

/** Request and reply shaping only; the rule lives in `application/ask.ts`. */
export function createRagController(app: GwcApp, pool: Pool) {
  return {
    ask: async (request: GwcRequest, reply: GwcReply) => {
      const { prompt } = request.body as { prompt: string }

      try {
        const result = await ask(app, pool, {
          question: prompt,
          signal: request.deadlineSignal,
        })
        return reply.send(result)
      } catch (err) {
        if (err instanceof RagNotConfiguredError) {
          // 503 with the variable named in the log: this is an operator error,
          // and a generic 500 would send someone reading application logs for
          // a missing environment variable. The response stays vague because
          // the route is public — naming internals to an anonymous caller is
          // how a configuration gap becomes reconnaissance.
          app.log.error({ err }, 'RAG endpoint is not configured')
          return reply.code(PROBLEMS.SERVICE_UNAVAILABLE.status).send({
            ...PROBLEMS.SERVICE_UNAVAILABLE,
            detail: 'The answering service is not configured on this deployment.',
            instance: request.url,
          })
        }
        throw err
      }
    },
  }
}
