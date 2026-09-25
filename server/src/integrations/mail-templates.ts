/**
 * The text of every mail the server sends, by template key.
 *
 * Rendered here because SMTP has no templates: whatever nodemailer is handed is
 * what arrives. Each mail is German first, then English, because a member has
 * no stored language preference to choose by — and it matches the club, whose
 * console defaults to German.
 *
 * Plain text only. Mail is read on phones and in clients that strip HTML, and
 * a code or a link is all any of these carry.
 */

import { EMAIL_CODE_TTL_SECONDS } from '@gwc/contracts/onboarding'
import { PASSWORD_RESET_TTL_SECONDS } from '@gwc/contracts/auth'

// From the same constants the server enforces, so a mail can never promise a
// lifetime the code or link does not have.
const CODE_MINUTES = Math.round(EMAIL_CODE_TTL_SECONDS / 60)
const RESET_MINUTES = Math.round(PASSWORD_RESET_TTL_SECONDS / 60)

type Variables = Record<string, unknown>
type Rendered = { subject: string; text: string }

const str = (value: unknown) => (value === undefined || value === null ? '' : String(value))
const greeting = (name: unknown, de: boolean) =>
  str(name) ? (de ? `Hallo ${str(name)},` : `Hello ${str(name)},`) : (de ? 'Hallo,' : 'Hello,')
const both = (de: string, en: string) => `${de}\n\n———\n\n${en}\n`

export function renderMail(template: string, variables: Variables, { origin }: { origin: string }): Rendered {
  switch (template) {
    case 'onboarding.email-code':
      return {
        subject: `${str(variables.code)} – Ihr Bestätigungscode / your confirmation code`,
        text: both(
          `${greeting(variables.name, true)}\n\nIhr Code zur Bestätigung Ihrer E-Mail-Adresse lautet:\n\n    ${str(variables.code)}\n\nEr ist ${CODE_MINUTES} Minuten gültig. Falls Sie keinen Code angefordert haben, können Sie diese Nachricht ignorieren.\n\nGerman World Club`,
          `${greeting(variables.name, false)}\n\nYour code to confirm your email address is:\n\n    ${str(variables.code)}\n\nIt is valid for ${CODE_MINUTES} minutes. If you did not ask for a code, you can ignore this message.\n\nGerman World Club`,
        ),
      }

    case 'auth.password-reset': {
      const link = `${origin}/konsole/passwort?token=${encodeURIComponent(str(variables.token))}`
      return {
        subject: 'Passwort zurücksetzen / Reset your password',
        text: both(
          `Hallo,\n\nüber den folgenden Link legen Sie ein neues Passwort fest:\n\n${link}\n\nDer Link ist ${RESET_MINUTES} Minuten gültig und nur einmal verwendbar. Alle angemeldeten Sitzungen werden dabei beendet. Falls Sie das nicht angefordert haben, ignorieren Sie diese Nachricht – Ihr Passwort bleibt unverändert.\n\nGerman World Club`,
          `Hello,\n\nUse the following link to set a new password:\n\n${link}\n\nThe link is valid for ${RESET_MINUTES} minutes and works once. Every signed-in session is ended when you use it. If you did not ask for this, ignore this message – your password stays as it is.\n\nGerman World Club`,
        ),
      }
    }

    case 'onboarding.address-in-use':
      return {
        subject: 'Registrierung mit Ihrer E-Mail-Adresse / Registration with your email address',
        text: both(
          `Hallo,\n\nsoeben wurde versucht, mit dieser E-Mail-Adresse eine Mitgliedschaft zu beantragen. Für diese Adresse besteht bereits ein Konto.\n\nWaren Sie das, melden Sie sich einfach an – bei vergessenem Passwort über „Passwort vergessen?“. Waren Sie es nicht, müssen Sie nichts tun.\n\nGerman World Club`,
          `Hello,\n\nSomeone just tried to apply for membership with this email address. An account already exists for it.\n\nIf that was you, simply sign in – use "Forgot password?" if you need to. If it was not you, there is nothing to do.\n\nGerman World Club`,
        ),
      }

    case 'onboarding.approved':
      return {
        subject: 'Willkommen im German World Club / Welcome to the German World Club',
        text: both(
          `${greeting(variables.name, true)}\n\nIhre Mitgliedschaft wurde bestätigt. Sie können sich jetzt in der App und unter ${origin}/konsole anmelden.\n\nGerman World Club`,
          `${greeting(variables.name, false)}\n\nYour membership has been approved. You can now sign in in the app and at ${origin}/konsole.\n\nGerman World Club`,
        ),
      }

    case 'onboarding.denied': {
      const reason = str(variables.reason)
      return {
        subject: 'Ihr Mitgliedsantrag / Your membership application',
        text: both(
          `${greeting(variables.name, true)}\n\nIhr Mitgliedsantrag wurde leider nicht angenommen.${reason ? `\n\nBegründung: ${reason}` : ''}\n\nGerman World Club`,
          `${greeting(variables.name, false)}\n\nUnfortunately, your membership application was not accepted.${reason ? `\n\nReason: ${reason}` : ''}\n\nGerman World Club`,
        ),
      }
    }

    default:
      // A template with no text is a bug, not a mail to send half-empty: the
      // outbox keeps the row, records this as its last error, and retries.
      throw new Error(`no mail text for template "${template}"`)
  }
}
