import { MODULES } from '@gwc/contracts/permissions'

/**
 * Every German string the console renders.
 *
 * Kept out of components not because a second language is planned — the design
 * document names none, and a framework for one language is cost without
 * benefit (research R10) — but because that is what makes adding one cheap if
 * it ever is. A string inline in JSX is a string nobody can find.
 */

export const de = {
  brand: {
    name: 'German World Club',
    short: 'GWC',
    logoAlt: 'German World Club',
  },

  signIn: {
    title: 'Anmeldung',
    subtitle: 'Zugang zur GWC-Konsole',
    email: 'E-Mail-Adresse',
    password: 'Passwort',
    submit: 'Anmelden',
    submitting: 'Wird angemeldet …',
    forgotPassword: 'Passwort vergessen?',
    emailRequired: 'Bitte geben Sie Ihre E-Mail-Adresse ein.',
    passwordRequired: 'Bitte geben Sie Ihr Passwort ein.',
    // There is deliberately no "Konto erstellen" link. Registration is out of
    // scope (FR-002) and client/tests/no-registration.test.jsx enforces that
    // no such affordance creeps back in.

    /**
     * POST /auth/sign-in answers with one of five outcomes, and four of them
     * are a 200 that carries no session. Each needs its own explanation and its
     * own next step; a console that treated every 200 as success would leave
     * the user watching a page that never loads.
     */
    outcomes: {
      passwordResetRequiredTitle: 'Passwort muss zurückgesetzt werden',
      passwordResetRequiredBody:
        'Für dieses Konto liegt kein nutzbares Passwort vor. Setzen Sie es zurück, um fortzufahren.',
      passwordResetRequiredAction: 'Passwort jetzt zurücksetzen',

      profileIncompleteTitle: 'E-Mail-Adresse nicht bestätigt',
      profileIncompleteBody:
        'Dieses Konto ist noch nicht vollständig eingerichtet. Die Einrichtung erfolgt in der '
        + 'mobilen App; im Web ist sie derzeit nicht verfügbar.',

      approvalPendingTitle: 'Freigabe ausstehend',
      approvalPendingBody:
        'Dieser Zugang wartet noch auf die Freigabe durch das GWC-Team.',

      otpRequiredTitle: 'Bestätigung erforderlich',
      otpRequiredBody:
        'Für diese Anmeldung ist ein Einmalcode nötig. Bitte verwenden Sie die mobile App.',

      unknownTitle: 'Anmeldung nicht abgeschlossen',
      unknownBody: 'Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.',
    },
  },

  passwordReset: {
    requestTitle: 'Passwort zurücksetzen',
    requestSubtitle: 'Wir senden Ihnen einen Link, falls ein Konto zu dieser Adresse gehört.',
    requestSubmit: 'Link anfordern',
    // Deliberately unconditional: the server answers 202 whether or not the
    // account exists, and the console must not narrow that into an answer.
    requestDone: 'Falls ein Konto zu dieser Adresse gehört, ist der Link unterwegs.',
    requestDoneHint: 'Der Link ist eine Stunde gültig und kann nur einmal verwendet werden.',
    confirmTitle: 'Neues Passwort setzen',
    confirmSubtitle: 'Wählen Sie ein neues Passwort für Ihr Konto.',
    newPassword: 'Neues Passwort',
    repeatPassword: 'Neues Passwort wiederholen',
    confirmSubmit: 'Passwort speichern',
    confirmDone: 'Das Passwort wurde gespeichert. Sie können sich jetzt anmelden.',
    // A completed reset revokes every session — that is the point of one, since
    // the likely reason for a reset is that the old credential is compromised.
    confirmDoneHint: 'Alle bestehenden Sitzungen dieses Kontos wurden beendet.',
    backToSignIn: 'Zurück zur Anmeldung',
    emailRequired: 'Bitte geben Sie Ihre E-Mail-Adresse ein.',
    // The server enforces this; stating it here saves a round trip, and the
    // server still refuses a short password if this check is bypassed.
    tooShort: 'Das Passwort muss mindestens 8 Zeichen lang sein.',
    mismatch: 'Die beiden Passwörter stimmen nicht überein.',
    missingTokenTitle: 'Link unvollständig',
    missingTokenBody:
      'Dieser Link enthält kein Rücksetz-Token. Bitte fordern Sie einen neuen Link an.',
    requestNewLink: 'Neuen Link anfordern',
  },

  console: {
    signOut: 'Abmelden',
    loading: 'Wird geladen …',
    notAvailable: 'Noch nicht verfügbar',
    notAvailableHint: 'Dieser Bereich ist für Ihre Rolle freigegeben, steht aber noch nicht bereit.',
    noGrantsTitle: 'Keine Bereiche freigegeben',
    noGrantsBody:
      'Ihrem Konto ist derzeit kein Bereich zugewiesen. Wenden Sie sich an eine Administratorin oder einen Administrator, um Rechte zu erhalten.',
    capabilitiesFailedTitle: 'Berechtigungen konnten nicht geladen werden',
    capabilitiesFailedBody:
      'Ohne Berechtigungen kann die Navigation nicht aufgebaut werden. Bitte laden Sie die Seite neu.',
    reload: 'Neu laden',
    retry: 'Erneut versuchen',
    readOnly: 'Nur Lesezugriff',
  },

  adminDashboard: {
    subtitle:
      'Zentrale Qualitätskontrolle für Mitglieder, Merchants, Partner, Experten, Inhalte und Beschwerden',
    grantedAreas: 'freigegebene Bereiche',
    usableAreas: 'davon nutzbar',
    pendingAreas: 'noch nicht verfügbar',
    superadmin: 'Superadmin',
    yes: 'Ja',
    no: 'Nein',
    yourAreas: 'Ihre Bereiche',
    governanceTitle: 'Governance ist Produktbestandteil',
    governanceBody:
      'GWC darf nicht nur Technik bereitstellen. Der zentrale operative Layer schützt die Marke vor '
      + 'Spam, Pay-to-play, schlechten Merchants und unzuverlässigen Experten.',
  },

  portals: {
    staff: 'Admin Panel',
    merchant: 'Club Merchant Portal',
    partner: 'Corporate Club Partner Portal',
    member: 'Mitgliederbereich',
  },

  /**
   * Sidebar labels, one per permission module.
   *
   * Keyed by the module names from @gwc/contracts/permissions, so a module
   * renamed on the server surfaces here as a missing label rather than as a
   * sidebar entry that quietly disappears.
   */
  modules: {
    members: 'Mitglieder',
    invitations: 'Einladungen',
    events: 'Events',
    event_registrations: 'Anmeldungen',
    partners: 'Partner-Inhalte',
    partner_contracts: 'Partnerverträge',
    membership_orders: 'Billing',
    committees: 'Gremien',
    threads_moderation: 'Thread-Moderation',
    marketplace_moderation: 'Merchant-Angebote',
    support_tickets: 'Beschwerden',
    newsletters: 'Newsletter',
    mass_messages: 'Push-Kampagnen',
    magazine: 'Magazin',
    pages: 'Seiten',
    seo: 'SEO',
    admins: 'Rollen & Rechte',
    settings: 'Einstellungen',
    jobs: 'Jobs',
  },

  flags: {
    read: 'lesen',
    write: 'anlegen',
    edit: 'bearbeiten',
    delete: 'löschen',
    status: 'Status ändern',
  },
}

/**
 * Guard against a module existing on the server with no label here.
 *
 * Thrown at import time in development rather than rendered as `undefined` in
 * a sidebar, which is the failure mode this would otherwise have.
 */
export function missingModuleLabels() {
  return MODULES.filter((module) => !de.modules[module])
}

export const t = de
