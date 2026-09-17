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
    // There is deliberately no "Konto erstellen" link. Registration is out of
    // scope (FR-002) and client/tests/no-registration.test.jsx enforces that
    // no such affordance creeps back in.
  },

  passwordReset: {
    requestTitle: 'Passwort zurücksetzen',
    requestSubtitle: 'Wir senden Ihnen einen Link, falls ein Konto zu dieser Adresse gehört.',
    requestSubmit: 'Link anfordern',
    // Deliberately unconditional: the server answers 202 whether or not the
    // account exists, and the console must not narrow that into an answer.
    requestDone: 'Falls ein Konto zu dieser Adresse gehört, ist der Link unterwegs.',
    confirmTitle: 'Neues Passwort setzen',
    newPassword: 'Neues Passwort',
    confirmSubmit: 'Passwort speichern',
    confirmDone: 'Das Passwort wurde gespeichert. Sie können sich jetzt anmelden.',
    backToSignIn: 'Zurück zur Anmeldung',
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
