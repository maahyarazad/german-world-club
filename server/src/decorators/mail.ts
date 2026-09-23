import { messageId } from '../integrations/mail.ts'
import { query } from '../db/query.ts'
import type { PoolClient } from 'pg'
import type { GwcApp } from '../app.ts'

/**
 * Outbound mail, through the outbox (migrations/021_mail_outbox.sql).
 *
 * `enqueueMail` writes a row; the `mail.deliver` job (ops/jobs.ts) sends it.
 * Nothing sends inline, because mail is in no route's budget — a member must
 * not watch a spinner while a mail server negotiates TLS, and a busy mail
 * server must not fail the registration that wanted to send the mail.
 *
 * Templates are keys, not text. The server emits no localised prose (see
 * CLAUDE.md); the mail service renders the template in the recipient's
 * language, exactly as the console translates problem types.
 */

type MailMessage = {
  to: string
  template: string
  subjectKey: string
  variables?: Record<string, unknown>
}

/** How long a failed delivery waits, by attempt. Capped: mail is patient, not abandoned. */
export const retryDelaySeconds = (attempts: number) => Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1))

export function registerMail(app: GwcApp) {
  app.decorate('enqueueMail', async (message: MailMessage, { client, signal }: { client?: PoolClient; signal?: AbortSignal } = {}) => {
    const id = messageId(message)
    const sql = `INSERT INTO mail_outbox (message_id, to_address, template, variables)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (message_id) DO NOTHING`
    const params = [id, message.to, message.template, JSON.stringify(message.variables ?? {})]
    if (client) await client.query(sql, params)
    else await query(app.pg, sql, params, { signal })

    // Development only, and on purpose: the mail integration has no real
    // provider on a laptop, so without this nobody can finish onboarding
    // locally. It is the same bargain `seed:demo` makes by printing passwords —
    // acceptable exactly because it cannot happen anywhere real.
    if (app.env.NODE_ENV === 'development') {
      app.log.info({ to: message.to, template: message.template, variables: message.variables }, 'mail queued (development: contents logged)')
    }
  })

  app.decorate('sendResetMail', async ({ email, token }: { email: string; token: string }) => {
    await app.enqueueMail({
      to: email,
      template: 'auth.password-reset',
      // The token is unique per request, so two resets are two mails.
      subjectKey: token.slice(0, 16),
      variables: { token },
    })
  })
}

type MailClient = {
  send(message: MailMessage & { variables: Record<string, unknown> }, opts?: { signal?: AbortSignal }): Promise<unknown>
}

/** How long a claimed row is left alone, so a crashed run does not strand it. */
const LEASE_SECONDS = 300

/**
 * Drain what is due. Called by the `mail.deliver` job.
 *
 * Rows are *claimed* — their next attempt pushed out by a lease — in one short
 * statement, then sent outside any transaction. Holding a transaction open
 * across fifty network round trips would pin a connection for minutes. The
 * lease is also what makes a crash safe: an unfinished row simply becomes due
 * again when it lapses. `SKIP LOCKED` lets two instances drain concurrently
 * without claiming the same row, and the provider receives the same
 * idempotency key on a retry, so a delivery whose acknowledgement was lost is
 * not sent twice either.
 */
export async function deliverDueMail(app: GwcApp, { batchSize = 50 } = {}) {
  const { rows } = await app.pg.query(
    `UPDATE mail_outbox SET next_attempt_at = now() + make_interval(secs => $2)
      WHERE id IN (SELECT id FROM mail_outbox
                    WHERE sent_at IS NULL AND next_attempt_at <= now()
                    ORDER BY next_attempt_at
                    LIMIT $1
                    FOR UPDATE SKIP LOCKED)
      RETURNING id, message_id, to_address, template, variables, attempts`,
    [batchSize, LEASE_SECONDS],
  )

  const mail = app.integrations.mail as MailClient
  let delivered = 0
  for (const row of rows) {
    try {
      await app.breakers.mail!.run((signal) => mail.send({
        to: row.to_address,
        template: row.template,
        subjectKey: row.message_id,
        variables: row.variables,
      }, { signal }))
      await app.pg.query(
        `UPDATE mail_outbox SET sent_at = now(), variables = '{}'::jsonb, last_error = NULL WHERE id = $1`,
        [row.id],
      )
      delivered += 1
    } catch (err) {
      const attempts = row.attempts + 1
      await app.pg.query(
        `UPDATE mail_outbox
            SET attempts = $2, last_error = $3,
                next_attempt_at = now() + make_interval(secs => $4)
          WHERE id = $1`,
        [row.id, attempts, String((err as Error)?.message ?? err).slice(0, 500), retryDelaySeconds(attempts)],
      )
    }
  }
  return { itemsProcessed: delivered }
}
