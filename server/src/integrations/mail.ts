import { createHash } from 'node:crypto'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { renderMail } from './mail-templates.ts'

/**
 * Mail over SMTP, through **nodemailer** (resilience.md §2).
 *
 * Declared fallback: **enqueue for later**. Nothing sends inside a request —
 * `app.enqueueMail` writes `mail_outbox` and the `mail.deliver` job calls
 * `send()` here — so a slow or down mail server delays a mail, never the
 * registration or reset that asked for it. A failed send stays in the outbox
 * with its error and retries with backoff (decorators/mail.ts).
 *
 * One transporter for the whole process, created on first use from
 * SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS: it keeps its connection
 * settings, and a server with no SMTP configured must still boot.
 */

/** Derived from the message's content, so a repeat is recognisably the same. */
export function messageId({ to, template, subjectKey }) {
  return createHash('sha256').update([to, template, subjectKey].join(':')).digest('hex').slice(0, 32)
}

export type SmtpSettings = {
  host?: string
  port?: number
  user?: string
  pass?: string
  /** The sender address; defaults to `user`. */
  from?: string
  /** CANONICAL_ORIGIN, for links in the mail (the password-reset link). */
  origin?: string
  /** Test seam: a ready transporter (e.g. nodemailer's jsonTransport). */
  transport?: Transporter
}

let shared: Transporter | null = null

export function createMailClient({ host, port = 587, user, pass, from, origin = '', transport }: SmtpSettings = {}) {
  const configured = Boolean(transport || host)
  const transporter = () => transport ?? (shared ??= nodemailer.createTransport({
    host,
    port,
    // 465 is TLS from the first byte; every other port upgrades with STARTTLS.
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
    // Inside the 10 s the mail breaker allows (config/budgets.ts), so a stuck
    // server fails the attempt instead of pinning the delivery job.
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 8_000,
  }))

  return {
    name: 'mail',
    configured,

    async send({ to, template, subjectKey, variables = {} }: {
      to: string; template: string; subjectKey: string; variables?: Record<string, unknown>
    }) {
      if (!configured) {
        // Thrown, so the outbox keeps the row and says why in last_error.
        throw new Error('SMTP is not configured (set SMTP_HOST)')
      }
      const id = messageId({ to, template, subjectKey })
      const { subject, text } = renderMail(template, variables, { origin })
      const info = await transporter().sendMail({
        from: from || user,
        to,
        subject,
        text,
        // The same id on a retry, so a mail whose acknowledgement was lost is
        // recognisable as a repeat by the receiving side.
        messageId: `<${id}@german-world-club>`,
      })
      return { delivered: true, messageId: id, providerId: info?.messageId ?? null }
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
