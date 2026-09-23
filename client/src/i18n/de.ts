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

  organisationPortal: {
    home: 'Übersicht',
    role: 'Ihre Rolle',
    roles: { owner: 'Inhaber', manager: 'Manager', staff: 'Mitarbeiter' },
    notBuiltHint:
      'Sie sind für Ihre Organisation angemeldet. Die Funktionen des Portals sind noch nicht '
      + 'freigeschaltet — Ihr GWC-Ansprechpartner informiert Sie, sobald sie bereitstehen.',
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
  /**
   * Vehicle feature labels, keyed by the catalogue `key`.
   *
   * The server never sends these words — it sends keys, and
   * tests/ops/no-server-localisation asserts no response body varies with
   * Accept-Language. A feature added to the catalogue with a label here and
   * not in the other catalogue fails `npm run -w client test:i18n`.
   */
  vehicleFeatures: {
    air_conditioning: 'Klimaanlage',
    climate_control: 'Klimaautomatik',
    heated_seats: 'Sitzheizung',
    ventilated_seats: 'Sitzbelüftung',
    leather_seats: 'Ledersitze',
    electric_seats: 'Elektrische Sitze',
    memory_seats: 'Sitzmemory',
    heated_steering_wheel: 'Lenkradheizung',
    panoramic_roof: 'Panoramadach',
    sunroof: 'Schiebedach',
    keyless_entry: 'Keyless Entry',
    keyless_start: 'Keyless Start',
    power_tailgate: 'Elektrische Heckklappe',
    tinted_windows: 'Getönte Scheiben',
    abs: 'ABS',
    esp: 'ESP',
    airbags_front: 'Frontairbags',
    airbags_side: 'Seitenairbags',
    airbags_curtain: 'Kopfairbags',
    lane_assist: 'Spurhalteassistent',
    blind_spot_monitor: 'Totwinkel-Assistent',
    adaptive_cruise_control: 'Adaptiver Tempomat',
    emergency_braking: 'Notbremsassistent',
    parking_sensors_front: 'Einparkhilfe vorne',
    parking_sensors_rear: 'Einparkhilfe hinten',
    reversing_camera: 'Rückfahrkamera',
    camera_360: '360°-Kamera',
    tyre_pressure_monitor: 'Reifendruckkontrolle',
    isofix: 'Isofix',
    navigation: 'Navigationssystem',
    bluetooth: 'Bluetooth',
    apple_carplay: 'Apple CarPlay',
    android_auto: 'Android Auto',
    dab_radio: 'DAB-Radio',
    premium_sound: 'Premium-Soundsystem',
    wireless_charging: 'Induktives Laden',
    head_up_display: 'Head-up-Display',
    usb_c_ports: 'USB-C-Anschlüsse',
    all_wheel_drive: 'Allradantrieb',
    tow_bar: 'Anhängerkupplung',
    roof_rails: 'Dachreling',
    alloy_wheels: 'Alufelgen',
    winter_tyres: 'Winterreifen',
    spare_wheel: 'Ersatzrad',
  },
  vehicleFeatureGroups: {
    comfort: 'Komfort',
    safety: 'Sicherheit',
    media: 'Multimedia',
    drivetrain: 'Antrieb & Ausstattung',
  },
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

  memberMarketplace: {
    tabLabel: 'Marktplatz',
    title: 'Marktplatz',
    subtitle: 'Anzeigen von Mitgliedern für Mitglieder — kein Zahlungsverkehr, nur der Kontakt.',
    composeTitle: 'Neue Anzeige',
    browseTitle: 'Anzeigen durchsuchen',
    category: 'Kategorie',
    mode: 'Art',
    titleField: 'Titel',
    body: 'Beschreibung',
    features: 'Ausstattung',
    contactMethod: 'Kontaktweg',
    expiresAt: 'Läuft ab am',
    expiresAtHint: 'Leer lassen für unbegrenzte Laufzeit.',
    termsRequired: 'Die aktuellen Marktplatz-Bedingungen müssen vor dem Veröffentlichen akzeptiert werden.',
    acceptTerms: 'Bedingungen akzeptieren',
    submit: 'Anzeige veröffentlichen',
    posted: 'Anzeige veröffentlicht.',
    empty: 'Keine Anzeigen gefunden.',
    allCategories: 'Alle Kategorien',
    allModes: 'Alle Arten',
    selectPlaceholder: 'Bitte wählen',
    contactUnavailable: 'Kontakt derzeit nicht verfügbar.',
    loadFailed: 'Das Formular konnte nicht geladen werden. Bitte laden Sie die Seite neu.',
    media: 'Fotos und Video',
    mediaHint: 'JPEG, PNG, WebP, AVIF, MP4, WebM oder MOV, je bis 25 MB und bis zu 20 pro Anzeige. Die erste Datei repräsentiert die Anzeige.',
    mediaAlt: 'Beschreiben Sie diese Datei (erforderlich)',
    mediaRemove: 'Entfernen',
    mediaAltMissing: 'Jedes Foto und Video braucht eine Beschreibung.',
    mediaTooLarge: 'Eine der Dateien ist größer als 25 MB.',
    mediaTooMany: 'Eine Anzeige darf höchstens 20 Mediendateien haben.',
    publishing: 'Wird veröffentlicht …',
    mediaDrop: 'Fotos oder Videos hierher ziehen, oder',
    mediaChoose: 'Dateien auswählen',
    mediaCover: 'Titelbild',
    mediaMakeCover: 'Als Titelbild',
    mediaMoveEarlier: 'Nach vorne',
    mediaMoveLater: 'Nach hinten',
    mediaUnsupported: 'Nur JPEG-, PNG-, WebP-, AVIF-, MP4-, WebM- und MOV-Dateien können hochgeladen werden.',
    mediaRetry: 'Fehlgeschlagene Medien erneut versuchen',
    mediaStatus: {
      pending: 'Wartet',
      uploading: 'Wird hochgeladen …',
      processing: 'Video wird verarbeitet …',
      attached: 'Angehängt',
      failed: 'Fehlgeschlagen',
    },
    mediaFailed: 'Die Anzeige wurde veröffentlicht, aber einige Medien konnten nicht angehängt werden. Sie können sie später erneut hinzufügen.',
    categories: {
      vehicle: 'Fahrzeug',
      property: 'Immobilie',
      job: 'Job',
      general: 'Sonstiges',
    },
    modes: {
      offer: 'Angebot',
      request: 'Gesuch',
    },
    contactMethods: {
      platform_message: 'Nachricht über die Plattform',
      email_relay: 'E-Mail-Weiterleitung',
      phone: 'Telefon',
    },
  },

  marketplaceModeration: {
    title: 'Marktplatz-Moderation',
    subtitle: 'Gemeldete Anzeigen prüfen, ausblenden, wiederherstellen oder entfernen.',
    queue: 'Meldungen',
    empty: 'Keine offenen Meldungen.',
    listing: 'Anzeige',
    listingState: 'Anzeigenstatus',
    reason: 'Meldegrund',
    reportState: 'Meldestatus',
    reported: 'Gemeldet am',
    actions: 'Aktionen',
    hide: 'Ausblenden',
    restore: 'Wiederherstellen',
    remove: 'Entfernen',
    upheld: 'Meldung bestätigen',
    dismissed: 'Meldung abweisen',
    confirmTitle: 'Aktion bestätigen',
    reasonLabel: 'Begründung (für das Prüfprotokoll)',
    confirm: 'Bestätigen',
    cancel: 'Abbrechen',
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
