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
    // The way in for someone without an account (feature 009). Staff approval
    // gates membership, not an invitation — see specs/009-expo-client/spec.md.
    becomeMember: 'Mitglied werden',

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
        'Ihre Registrierung wurde nicht abgeschlossen. Registrieren Sie sich erneut mit derselben '
        + 'E-Mail-Adresse und demselben Passwort, um dort fortzufahren, wo Sie aufgehört haben.',

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

  /**
   * Onboarding, Phase 1 (feature 009): the same five steps as the mobile app.
   * `{target}` and `{length}` are filled by `fill()` in lib/format.
   */
  onboarding: {
    stepOf: 'Schritt {step} von 4',
    detailsTitle: 'Mitglied werden',
    detailsSubtitle: 'Erzählen Sie uns, wer Sie sind. Nach der Prüfung durch unser Team erhalten Sie Zugang.',
    fullName: 'Vollständiger Name',
    email: 'E-Mail-Adresse',
    password: 'Passwort',
    passwordHint: 'Mindestens 8 Zeichen.',
    mobile: 'Mobilnummer',
    mobileHint: 'Internationales Format, z. B. +49 151 12345678',
    birthday: 'Geburtstag',
    gender: 'Geschlecht',
    genders: {
      female: 'Weiblich',
      male: 'Männlich',
      diverse: 'Divers',
      prefer_not_to_say: 'Keine Angabe',
    },
    countryTitle: 'Wo leben Sie?',
    countrySubtitle: 'Wählen Sie Ihr hauptsächliches Wohnsitzland.',
    country: 'Wohnsitzland',
    countryPinned: 'Häufig gewählt',
    countryAll: 'Alle Länder',
    countryPlaceholder: 'Bitte wählen',
    back: 'Zurück',
    continue: 'Weiter',
    submit: 'Absenden',
    submitting: 'Wird gesendet …',
    haveAccount: 'Bereits ein Konto? Anmelden',
    mobileTitle: 'Mobilnummer bestätigen',
    mobileSubtitle: 'Wir haben einen 4-stelligen Code per SMS an {target} gesendet.',
    code: 'Code',
    verify: 'Bestätigen',
    verifying: 'Wird geprüft …',
    resend: 'Neuen Code senden',
    resent: 'Ein neuer Code ist unterwegs.',
    missingChallengeTitle: 'Registrierung unterbrochen',
    missingChallengeBody:
      'Diese Seite wurde neu geladen, bevor der Code eingegeben war. Starten Sie die Registrierung '
      + 'erneut mit denselben Angaben – Sie setzen dort fort, wo Sie aufgehört haben.',
    restart: 'Registrierung fortsetzen',
    emailTitle: 'E-Mail-Adresse bestätigen',
    emailSubtitle: 'Wir haben einen 6-stelligen Code an {target} gesendet.',
    emailSending: 'Der Code wird gesendet …',
    waitingTitle: 'Warten auf Freigabe',
    waitingBody:
      'Vielen Dank! Unser Team prüft Ihren Antrag. Sie erhalten eine E-Mail, sobald entschieden ist.',
    check: 'Erneut prüfen',
    deniedTitle: 'Antrag nicht angenommen',
    deniedBody: 'Es tut uns leid – Ihr Mitgliedsantrag wurde nicht angenommen.',
    reason: 'Begründung',
    signOut: 'Abmelden',
    errors: {
      fullName: 'Bitte geben Sie Ihren vollständigen Namen ein.',
      email: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
      password: 'Das Passwort muss mindestens 8 Zeichen lang sein.',
      mobile: 'Bitte im internationalen Format mit + am Anfang.',
      birthday: 'Bitte ein echtes Datum in der Vergangenheit eingeben.',
      gender: 'Bitte wählen Sie eine Option.',
      country: 'Bitte wählen Sie ein Land.',
      code: 'Bitte alle {length} Ziffern eingeben.',
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

  memberThreads: {
    tabLabel: 'Threads',
    title: 'Threads',
    subtitle: 'Was die Mitglieder gerade bewegt.',
    forYou: 'Für dich',
    following: 'Folge ich',
    compose: 'Neuer Beitrag',
    composeTitle: 'Neuer Beitrag',
    replyTitle: 'Antworten',
    quoteTitle: 'Zitieren',
    placeholder: 'Was gibt es Neues?',
    counter: '{count} / {max}',
    post: 'Posten',
    posting: 'Wird gepostet …',
    cancel: 'Abbrechen',
    addMedia: 'Fotos oder Videos',
    mediaAlt: 'Beschreibung (erforderlich)',
    mediaRemove: 'Entfernen',
    mediaTooMany: 'Ein Beitrag darf höchstens {max} Fotos oder Videos haben.',
    mediaUnsupported: 'Nur JPEG-, PNG-, WebP-, AVIF-, MP4-, WebM- und MOV-Dateien können hochgeladen werden.',
    mediaTooLarge: 'Eine der Dateien ist größer als 25 MB.',
    mediaAltMissing: 'Jedes Foto und Video braucht eine Beschreibung.',
    mediaUploading: 'Medien werden hochgeladen …',
    mediaFailed: 'Ein Foto oder Video konnte nicht hochgeladen werden.',
    empty: 'Noch keine Beiträge.',
    emptyFollowing: 'Folgen Sie Mitgliedern, um ihre Beiträge hier zu sehen.',
    loadMore: 'Mehr laden',
    loadFailed: 'Die Beiträge konnten nicht geladen werden.',
    retry: 'Erneut versuchen',
    reply: 'Antworten',
    like: 'Gefällt mir',
    unlike: 'Gefällt mir nicht mehr',
    repost: 'Teilen',
    unrepost: 'Nicht mehr teilen',
    quote: 'Zitieren',
    more: 'Mehr',
    report: 'Melden',
    reportReason: 'Warum melden Sie diesen Beitrag?',
    reported: 'Danke — der Beitrag wurde gemeldet.',
    delete: 'Löschen',
    deleteConfirm: 'Diesen Beitrag endgültig löschen?',
    repostedBy: '{name} hat geteilt',
    unavailable: 'Dieser Beitrag ist nicht mehr verfügbar.',
    replies: 'Antworten',
    noReplies: 'Noch keine Antworten.',
    inReplyTo: 'Antwort auf',
    quotes: 'Zitate',
    likes: 'Gefällt',
    back: 'Zurück',
    influencer: 'Influencer',
    playVideo: 'Video abspielen',
    counts: { replies: 'Antworten', likes: 'Gefällt mir', reposts: 'Geteilt', quotes: 'Zitate' },
  },

  memberActivity: {
    tabLabel: 'Aktivität',
    title: 'Aktivität',
    empty: 'Noch keine Aktivität.',
    kinds: {
      like: '{name} gefällt Ihr Beitrag',
      reply: '{name} hat geantwortet',
      quote: '{name} hat Ihren Beitrag zitiert',
      repost: '{name} hat Ihren Beitrag geteilt',
      mention: '{name} hat Sie erwähnt',
      follow: '{name} folgt Ihnen jetzt',
    },
  },

  memberProfile: {
    tabLabel: 'Profil',
    title: 'Profil',
    edit: 'Profil bearbeiten',
    editTitle: 'Profil bearbeiten',
    followers: 'Follower',
    followingCount: 'Folgt',
    follow: 'Folgen',
    unfollow: 'Nicht mehr folgen',
    tabs: { threads: 'Threads', replies: 'Antworten', media: 'Medien', reposts: 'Geteilt' },
    noHandle: 'Noch kein Benutzername',
    bio: 'Über mich',
    city: 'Stadt',
    links: 'Links',
    linkUrl: 'Adresse (https://…)',
    linkLabel: 'Bezeichnung (optional)',
    addLink: 'Link hinzufügen',
    removeLink: 'Entfernen',
    avatar: 'Profilbild',
    avatarChange: 'Profilbild ändern',
    avatarRemove: 'Profilbild entfernen',
    avatarAlt: 'Profilbild von {name}',
    displayNameHint: 'Namensänderungen laufen über einen Antrag an das GWC-Team.',
    save: 'Speichern',
    saved: 'Gespeichert.',
    handle: 'Benutzername',
    handleChange: 'Benutzername ändern',
    handleTitle: 'Benutzernamen wählen',
    handleIntro: 'Andere Mitglieder erwähnen Sie mit @Benutzername. Sie brauchen einen, um zu posten.',
    handleHint: '3–30 Kleinbuchstaben, Ziffern, Punkte oder Unterstriche; nicht mit einem Punkt beginnend oder endend.',
    handleAvailable: 'Verfügbar',
    handleTaken: 'Nicht verfügbar',
    handleNextChange: 'Nächste Änderung möglich ab {date}.',
    handleSave: 'Benutzernamen speichern',
    blocked: 'Sie haben dieses Mitglied blockiert.',
    block: 'Blockieren',
    unblock: 'Blockierung aufheben',
    mute: 'Stummschalten',
    unmute: 'Stummschaltung aufheben',
    blockConfirm: 'Blockieren? Sie sehen einander nicht mehr, und bestehendes Folgen endet.',
    privacy: 'Blockiert & stummgeschaltet',
    blockedList: 'Blockierte Mitglieder',
    mutedList: 'Stummgeschaltete Mitglieder',
    noneBlocked: 'Niemand blockiert.',
    noneMuted: 'Niemand stummgeschaltet.',
    followersTitle: 'Follower von {name}',
    followingTitle: '{name} folgt',
    notFound: 'Dieses Profil ist nicht verfügbar.',
  },

  organisationProfile: {
    tabLabel: 'Profil',
    title: 'Öffentliches Profil',
    intro: 'So sehen Mitglieder Ihre Organisation.',
    account: 'Ihr Konto',
    displayName: 'Anzeigename',
    about: 'Über uns',
    website: 'Website (https://…)',
    city: 'Stadt',
    logo: 'Logo',
    logoChange: 'Logo hochladen',
    logoAlt: 'Logo von {name}',
    save: 'Speichern',
    saved: 'Gespeichert.',
    readOnly: 'Nur Inhaber und Manager können das öffentliche Profil bearbeiten.',
    notPermitted: 'Diese Änderung ist für Ihr Konto nicht erlaubt.',
    empty: 'Noch kein öffentliches Profil.',
  },

  threadsModeration: {
    title: 'Thread-Moderation',
    subtitle: 'Gemeldete Beiträge prüfen, ausblenden, wiederherstellen oder entfernen.',
    queue: 'Offene Meldungen',
    empty: 'Keine offenen Meldungen.',
    post: 'Beitrag',
    postState: 'Beitragsstatus',
    reason: 'Meldegrund',
    reported: 'Gemeldet am',
    open: 'Öffnen',
    hide: 'Ausblenden',
    restore: 'Wiederherstellen',
    remove: 'Entfernen',
    upheld: 'Meldung bestätigen',
    dismissed: 'Meldung abweisen',
    reasonLabel: 'Begründung (für das Prüfprotokoll)',
    confirm: 'Bestätigen',
    cancel: 'Abbrechen',
    quotedPost: 'Zitierter Beitrag',
    states: { visible: 'Sichtbar', hidden: 'Ausgeblendet', removed: 'Entfernt', deleted: 'Vom Autor gelöscht' },
  },

  influencerAdmin: {
    title: 'Mitglieder',
    subtitle: 'Influencer-Status vergeben und entziehen.',
    search: 'Benutzername',
    find: 'Suchen',
    notFound: 'Kein Mitglied mit diesem Benutzernamen.',
    history: 'Verlauf',
    noHistory: 'Noch nie Influencer.',
    active: 'Aktiv',
    revoked: 'Entzogen',
    grant: 'Influencer-Status vergeben',
    revoke: 'Influencer-Status entziehen',
    reason: 'Begründung (für das Prüfprotokoll)',
    grantedOn: 'Vergeben am {date}',
    revokedOn: 'Entzogen am {date}',
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
