import { scheduleMessageMail } from '../modules/messaging/application/notify-mail.ts'
import type { GwcApp } from '../app.ts'

/**
 * `app.notifyMessage`: email the other participant about a new message
 * (feature 020). The slot feature 008 left for exactly this — it is called by
 * `notifyAfterCommit`, after the message is committed, and a failure in it is
 * logged and swallowed, never turned into a failed request.
 *
 * A decorator, so a suite can replace or remove it (persist-before-notify does).
 */
export function registerMessageMail(app: GwcApp) {
  app.decorate('notifyMessage', (event: { conversationId: string; messageId: string; recipientIds: string[] }) =>
    scheduleMessageMail(app, event))
}
