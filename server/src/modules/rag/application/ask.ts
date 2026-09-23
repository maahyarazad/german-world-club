import pg from 'pg'
import type { Pool } from 'pg'
import type { GwcApp } from '../../../app.ts'

/**
 * Retrieval-augmented answering over `docs_embeddings`, via pgai.
 *
 * Both halves run **inside PostgreSQL**: `ai.ollama_embed` embeds the question
 * and `ai.anthropic_generate` answers it. Nothing is embedded or generated in
 * Node, so the chunks never make a round trip out of the database and back.
 *
 * The retrieval is a nearest-neighbour scan under `<=>` (cosine distance) over
 * the question's embedding, and the top K chunks become the only context the
 * model is given.
 */

/** How many chunks are retrieved. More context is not automatically better. */
export const TOP_K = 5

/**
 * The prompt is pinned here rather than accepted from the caller.
 *
 * This endpoint is public and unauthenticated, so the caller controls `$1` and
 * nothing else. If the instruction travelled in the request body, anyone could
 * replace "answer only from the context" with something else and use the club's
 * Anthropic credit as a general-purpose model.
 *
 * `$1` appears twice — once to embed, once in the prompt — and is a bound
 * parameter both times. It is never concatenated into the SQL.
 */
const RAG_SQL = `
WITH ctx AS (
  SELECT string_agg(chunk, E'\\n\\n') AS context
  FROM (
    SELECT chunk
    FROM docs_embeddings
    ORDER BY embedding <=> ai.ollama_embed($2::text, $1::text)
    LIMIT ${TOP_K}
  ) top
)
SELECT
  (SELECT context FROM ctx) AS context,
  ai.anthropic_generate(
    $3,
    jsonb_build_array(
      jsonb_build_object('role','user','content',
        'Answer using ONLY the context below. If the answer is not there, say you do not know.'
        || E'\\n\\nContext:\\n' || (SELECT context FROM ctx)
        || E'\\n\\nQuestion: ' || $1)
    )
  ) -> 'content' -> 0 ->> 'text' AS answer;
`

/** Raised when the deployment has not been given what pgai needs. */
export class RagNotConfiguredError extends Error {
  constructor(missing: string) {
    super(`${missing} is not set, so the RAG endpoint cannot reach its model provider.`)
    this.name = 'RagNotConfiguredError'
  }
}

/**
 * A pool of its own, not `app.pg`.
 *
 * The embeddings live in whichever database pgai was installed into, which is
 * not necessarily the application's. Pointing this at `app.pg` would work on
 * one machine and fail with "relation docs_embeddings does not exist" on the
 * next, which is the kind of difference that should be configuration rather
 * than luck.
 *
 * The provider credentials are passed as session GUCs through `options`, so
 * they are set once per connection by the server rather than being written
 * into the database's own configuration — where every superuser query could
 * read them back.
 */
export function createRagPool(app: GwcApp): Pool {
  const { RAG_DATABASE_URL, DATABASE_URL, ANTHROPIC_API_KEY, OLLAMA_HOST } = app.env

  const options = [
    ANTHROPIC_API_KEY ? `-c ai.anthropic_api_key=${ANTHROPIC_API_KEY}` : null,
    `-c ai.ollama_host=${OLLAMA_HOST}`,
  ].filter(Boolean).join(' ')

  return new pg.Pool({
    connectionString: RAG_DATABASE_URL ?? DATABASE_URL,
    options,
    // Small: each connection holds a model call open for seconds, so a large
    // pool buys queueing rather than throughput, and hides overload instead of
    // surfacing it as a 429.
    max: 4,
  })
}

export type RagAnswer = {
  answer: string
  /** Whether anything was retrieved at all. A caller can tell "no documents indexed" from "no answer". */
  grounded: boolean
}

export async function ask(
  app: GwcApp,
  pool: Pool,
  { question, signal }: { question: string; signal?: AbortSignal },
): Promise<RagAnswer> {
  if (!app.env.ANTHROPIC_API_KEY) throw new RagNotConfiguredError('ANTHROPIC_API_KEY')

  const client = await pool.connect()
  let onAbort: (() => void) | undefined
  try {
    const { rows } = await new Promise<{ rows: { answer: string | null; context: string | null }[] }>(
      (resolve, reject) => {
        // Destroying the connection is what actually cancels the in-flight
        // statement — and here that statement is an outbound model call, so
        // abandoning the caller without cancelling would leave it running and
        // billable. Same reasoning as db/query.ts.
        onAbort = () => {
          client.release(new Error('rag query aborted'))
          reject(signal?.reason ?? new Error('aborted'))
        }
        if (signal?.aborted) return onAbort()
        signal?.addEventListener('abort', onAbort, { once: true })
        client.query(RAG_SQL, [question, app.env.RAG_EMBED_MODEL, app.env.RAG_MODEL])
          .then(resolve, reject)
      },
    )

    const row = rows[0]
    return {
      answer: row?.answer ?? 'I do not know.',
      grounded: Boolean(row?.context),
    }
  } catch (err){
    console.error(`ask: ${err.message}`)
  } 
  finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort)
    if (!signal?.aborted) client.release()
  }
}
