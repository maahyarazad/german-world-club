import { createHash } from 'node:crypto'
import { requestDependency } from './http-client.js'

/**
 * Mail (resilience.md §2).
 *
 * Declared fallback: **enqueue for later**, keyed by message id. Mail is the
 * one dependency where deferring is genuinely correct — nobody expects an
 * invoice or a notification to arrive in the same second, so an outage should
 * delay delivery rather than fail the action that triggered it.
 *
 * `mail` appears in no route's `calls` list in config/budgets.js, deliberately.
 * Invoice and notification mail is enqueued, never sent inside the request:
 * checkout's budget could not accommodate both a payment call and an SMTP
 * round trip, and a member should not watch a spinner while a mail server
 * negotiates TLS.
 *
 * The queue key is what makes the retry safe. Without it, a retry after
 * recovery sends the same invoice twice.
 */

/** Derived from the message's content, so a repeat is recognisably the same. */
export function messageId({ to, template, subjectKey }) {
  return createHash('sha256').update([to, template, subjectKey].join(':')).digest('hex').slice(0, 32)
}

export function createMailClient({ baseUrl = 'https://mail.invalid', send = requestDependency } = {}) {
  return {
    name: 'mail',

    async send({ to, template, subjectKey, variables = {} }, { signal } = {}) {
      const id = messageId({ to, template, subjectKey })
      const response = await send('mail', `${baseUrl}/messages`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', 'idempotency-key': id },
        body: JSON.stringify({ to, template, variables }),
      })
      await response.body.text().catch(() => '')
      return { delivered: true, messageId: id }
    },
  }
}

/**
 * The declared unavailable behaviour: accept it for later delivery.
 *
 * Returns rather than throws, because the caller's action succeeded — only the
 * notification is deferred. Throwing here would fail a member's registration
 * because a mail server was busy.
 */
export function mailDeferred(message) {
  return { delivered: false, deferred: true, messageId: messageId(message) }
}
