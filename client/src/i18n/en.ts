import { MODULES } from '@gwc/contracts/permissions'

/**
 * Every English string the console renders.
 *
 * Built from `de.js` and kept in lockstep with it: `scripts/check-i18n.mjs`
 * fails the build on any key present in one catalogue and not the other, in
 * either direction. That check is the whole reason a second language is safe
 * to add — a missing translation is otherwise invisible until someone switches
 * language on the one screen that uses it.
 *
 * Product nouns, tier names and membership amounts are deliberately identical
 * to the German catalogue. The design document fixes them, and repeating them
 * here rather than splitting them into a shared module means the parity check
 * covers them too.
 */

export const en = {
  brand: {
    name: 'German World Club',
    short: 'GWC',
    logoAlt: 'German World Club',
  },

  signIn: {
    title: 'Sign in',
    subtitle: 'Access to the GWC console',
    email: 'Email address',
    password: 'Password',
    submit: 'Sign in',
    submitting: 'Signing in …',
    forgotPassword: 'Forgotten your password?',
    emailRequired: 'Please enter your email address.',
    passwordRequired: 'Please enter your password.',
    // The way in for someone without an account (feature 009). Staff approval
    // gates membership, not an invitation — see specs/009-expo-client/spec.md.
    becomeMember: 'Become a member',

    /**
     * POST /auth/sign-in answers with one of five outcomes, and four of them
     * are a 200 that carries no session. Each needs its own explanation and its
     * own next step; a console that treated every 200 as success would leave
     * the user watching a page that never loads.
     */
    outcomes: {
      passwordResetRequiredTitle: 'Password must be reset',
      passwordResetRequiredBody:
        'This account has no usable password. Reset it to continue.',
      passwordResetRequiredAction: 'Reset password now',

      profileIncompleteTitle: 'Email address not confirmed',
      profileIncompleteBody:
        'Your registration was not finished. Register again with the same email address and '
        + 'password to continue where you left off.',

      approvalPendingTitle: 'Approval pending',
      approvalPendingBody:
        'This access is still waiting for approval by the GWC team.',

      otpRequiredTitle: 'Confirmation required',
      otpRequiredBody:
        'This sign-in needs a one-time code. Please use the mobile app.',

      unknownTitle: 'Sign-in not completed',
      unknownBody: 'Sign-in could not be completed. Please try again.',
    },
  },

  /**
   * Onboarding, Phase 1 (feature 009): the same five steps as the mobile app.
   * `{target}` and `{length}` are filled by `fill()` in lib/format.
   */
  onboarding: {
    stepOf: 'Step {step} of 4',
    detailsTitle: 'Become a member',
    detailsSubtitle: 'Tell us who you are. You get access once our team has reviewed your application.',
    fullName: 'Full name',
    email: 'Email address',
    password: 'Password',
    passwordHint: 'At least 8 characters.',
    mobile: 'Mobile number',
    mobileHint: 'International format, e.g. +49 151 12345678',
    birthday: 'Birthday',
    gender: 'Gender',
    genders: {
      female: 'Female',
      male: 'Male',
      diverse: 'Diverse',
      prefer_not_to_say: 'Prefer not to say',
    },
    countryTitle: 'Where do you live?',
    countrySubtitle: 'Choose your primary country of residence.',
    country: 'Country of residence',
    countryPinned: 'Frequently chosen',
    countryAll: 'All countries',
    countryPlaceholder: 'Please choose',
    back: 'Back',
    continue: 'Continue',
    submit: 'Submit',
    submitting: 'Submitting …',
    haveAccount: 'Already have an account? Sign in',
    mobileTitle: 'Verify your mobile number',
    mobileSubtitle: 'We sent a 4-digit code by SMS to {target}.',
    code: 'Code',
    verify: 'Verify',
    verifying: 'Checking …',
    resend: 'Send a new code',
    resent: 'A new code is on its way.',
    missingChallengeTitle: 'Registration interrupted',
    missingChallengeBody:
      'This page was reloaded before the code was entered. Start the registration again with the '
      + 'same details — you will continue where you left off.',
    restart: 'Continue registration',
    emailTitle: 'Verify your email address',
    emailSubtitle: 'We sent a 6-digit code to {target}.',
    emailSending: 'Sending the code …',
    waitingTitle: 'Waiting for approval',
    waitingBody:
      'Thank you! Our team is reviewing your application. You will receive an email as soon as it is decided.',
    check: 'Check again',
    deniedTitle: 'Application not approved',
    deniedBody: 'We are sorry — your membership application was not approved.',
    reason: 'Reason',
    signOut: 'Sign out',
    errors: {
      fullName: 'Please enter your full name.',
      email: 'Please enter a valid email address.',
      password: 'The password must be at least 8 characters long.',
      mobile: 'Use international format, starting with +.',
      birthday: 'Please enter a real date in the past.',
      gender: 'Please choose one.',
      country: 'Please choose a country.',
      code: 'Enter all {length} digits.',
    },
  },

  passwordReset: {
    requestTitle: 'Reset password',
    requestSubtitle: 'We will send you a link if an account belongs to this address.',
    requestSubmit: 'Request link',
    // Deliberately unconditional: the server answers 202 whether or not the
    // account exists, and the console must not narrow that into an answer.
    requestDone: 'If an account belongs to this address, the link is on its way.',
    requestDoneHint: 'The link is valid for one hour and can only be used once.',
    confirmTitle: 'Set a new password',
    confirmSubtitle: 'Choose a new password for your account.',
    newPassword: 'New password',
    repeatPassword: 'Repeat new password',
    confirmSubmit: 'Save password',
    confirmDone: 'Your password has been saved. You can sign in now.',
    // A completed reset revokes every session — that is the point of one, since
    // the likely reason for a reset is that the old credential is compromised.
    confirmDoneHint: 'All existing sessions for this account have been ended.',
    backToSignIn: 'Back to sign-in',
    emailRequired: 'Please enter your email address.',
    // The server enforces this; stating it here saves a round trip, and the
    // server still refuses a short password if this check is bypassed.
    tooShort: 'The password must be at least 8 characters long.',
    mismatch: 'The two passwords do not match.',
    missingTokenTitle: 'Incomplete link',
    missingTokenBody:
      'This link carries no reset token. Please request a new link.',
    requestNewLink: 'Request a new link',
  },

  console: {
    signOut: 'Sign out',
    loading: 'Loading …',
    notAvailable: 'Not available yet',
    notAvailableHint: 'This area is granted to your role but is not ready yet.',
    noGrantsTitle: 'No areas granted',
    noGrantsBody:
      'No area is currently assigned to your account. Contact an administrator to be granted permissions.',
    capabilitiesFailedTitle: 'Permissions could not be loaded',
    capabilitiesFailedBody:
      'Navigation cannot be built without permissions. Please reload the page.',
    reload: 'Reload',
    retry: 'Try again',
    readOnly: 'Read-only',
  },

  adminDashboard: {
    subtitle:
      'Central quality control for members, merchants, partners, experts, content and complaints',
    grantedAreas: 'granted areas',
    usableAreas: 'of those usable',
    pendingAreas: 'not available yet',
    superadmin: 'Superadmin',
    yes: 'Yes',
    no: 'No',
    yourAreas: 'Your areas',
    governanceTitle: 'Governance is part of the product',
    governanceBody:
      'GWC must not merely provide technology. The central operating layer protects the brand from '
      + 'spam, pay-to-play, poor merchants and unreliable experts.',
  },

  organisationPortal: {
    home: 'Overview',
    role: 'Your role',
    roles: { owner: 'Owner', manager: 'Manager', staff: 'Staff' },
    notBuiltHint:
      'You are signed in to your organisation. The tools in this portal are not built yet — '
      + 'your GWC contact will let you know when they are.',
  },

  portals: {
    staff: 'Admin Panel',
    merchant: 'Club Merchant Portal',
    partner: 'Corporate Club Partner Portal',
    member: 'Member area',
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
    air_conditioning: 'Air conditioning',
    climate_control: 'Climate control',
    heated_seats: 'Heated seats',
    ventilated_seats: 'Ventilated seats',
    leather_seats: 'Leather seats',
    electric_seats: 'Electric seats',
    memory_seats: 'Seat memory',
    heated_steering_wheel: 'Heated steering wheel',
    panoramic_roof: 'Panoramic roof',
    sunroof: 'Sunroof',
    keyless_entry: 'Keyless entry',
    keyless_start: 'Keyless start',
    power_tailgate: 'Power tailgate',
    tinted_windows: 'Tinted windows',
    abs: 'ABS',
    esp: 'ESP',
    airbags_front: 'Front airbags',
    airbags_side: 'Side airbags',
    airbags_curtain: 'Curtain airbags',
    lane_assist: 'Lane assist',
    blind_spot_monitor: 'Blind-spot monitor',
    adaptive_cruise_control: 'Adaptive cruise control',
    emergency_braking: 'Emergency braking',
    parking_sensors_front: 'Front parking sensors',
    parking_sensors_rear: 'Rear parking sensors',
    reversing_camera: 'Reversing camera',
    camera_360: '360° camera',
    tyre_pressure_monitor: 'Tyre pressure monitor',
    isofix: 'Isofix',
    navigation: 'Navigation',
    bluetooth: 'Bluetooth',
    apple_carplay: 'Apple CarPlay',
    android_auto: 'Android Auto',
    dab_radio: 'DAB radio',
    premium_sound: 'Premium sound system',
    wireless_charging: 'Wireless charging',
    head_up_display: 'Head-up display',
    usb_c_ports: 'USB-C ports',
    all_wheel_drive: 'All-wheel drive',
    tow_bar: 'Tow bar',
    roof_rails: 'Roof rails',
    alloy_wheels: 'Alloy wheels',
    winter_tyres: 'Winter tyres',
    spare_wheel: 'Spare wheel',
  },
  vehicleFeatureGroups: {
    comfort: 'Comfort',
    safety: 'Safety',
    media: 'Media',
    drivetrain: 'Drivetrain & equipment',
  },
  modules: {
    members: 'Members',
    invitations: 'Invitations',
    events: 'Events',
    event_registrations: 'Registrations',
    partners: 'Partner content',
    partner_contracts: 'Partner contracts',
    membership_orders: 'Billing',
    committees: 'Committees',
    threads_moderation: 'Thread moderation',
    marketplace_moderation: 'Merchant offers',
    support_tickets: 'Complaints',
    newsletters: 'Newsletters',
    mass_messages: 'Push campaigns',
    magazine: 'Magazine',
    pages: 'Pages',
    seo: 'SEO',
    admins: 'Roles & permissions',
    settings: 'Settings',
    jobs: 'Jobs',
  },

  flags: {
    read: 'read',
    write: 'create',
    edit: 'edit',
    delete: 'delete',
    status: 'change status',
  },

  memberMarketplace: {
    tabLabel: 'Marketplace',
    title: 'Marketplace',
    subtitle: 'Listings from members, for members — no payment, just the contact.',
    composeTitle: 'New listing',
    browseTitle: 'Browse listings',
    category: 'Category',
    mode: 'Mode',
    titleField: 'Title',
    body: 'Description',
    features: 'Features',
    contactMethod: 'Contact method',
    expiresAt: 'Expires on',
    expiresAtHint: 'Leave empty for no expiry.',
    termsRequired: 'The current marketplace terms must be accepted before publishing.',
    acceptTerms: 'Accept terms',
    submit: 'Publish listing',
    posted: 'Listing published.',
    empty: 'No listings found.',
    allCategories: 'All categories',
    allModes: 'All modes',
    selectPlaceholder: 'Please select',
    contactUnavailable: 'Contact currently unavailable.',
    loadFailed: 'The form could not be loaded. Please reload the page.',
    media: 'Photos and video',
    mediaHint: 'JPEG, PNG, WebP, AVIF, MP4, WebM or MOV, up to 25 MB each and 20 per listing. The first one represents the listing.',
    mediaAlt: 'Describe this file (required)',
    mediaRemove: 'Remove',
    mediaAltMissing: 'Every photo and video needs a description.',
    mediaTooLarge: 'One of the files is larger than 25 MB.',
    mediaTooMany: 'A listing may carry at most 20 media files.',
    publishing: 'Publishing …',
    mediaDrop: 'Drag photos or videos here, or',
    mediaChoose: 'Choose files',
    mediaCover: 'Cover',
    mediaMakeCover: 'Make cover',
    mediaMoveEarlier: 'Move earlier',
    mediaMoveLater: 'Move later',
    mediaUnsupported: 'Only JPEG, PNG, WebP, AVIF, MP4, WebM and MOV files can be uploaded.',
    mediaRetry: 'Retry failed media',
    mediaStatus: {
      pending: 'Waiting',
      uploading: 'Uploading …',
      processing: 'Processing video …',
      attached: 'Attached',
      failed: 'Failed',
    },
    mediaFailed: 'The listing was published, but some media could not be attached. You can add them again later.',
    categories: {
      vehicle: 'Vehicle',
      property: 'Property',
      job: 'Job',
      general: 'General',
    },
    modes: {
      offer: 'Offer',
      request: 'Request',
    },
    contactMethods: {
      platform_message: 'Message via the platform',
      email_relay: 'Email relay',
      phone: 'Phone',
    },
  },

  marketplaceModeration: {
    title: 'Marketplace moderation',
    subtitle: 'Review reported listings: hide, restore or remove them.',
    queue: 'Reports',
    empty: 'No open reports.',
    listing: 'Listing',
    listingState: 'Listing state',
    reason: 'Report reason',
    reportState: 'Report state',
    reported: 'Reported at',
    actions: 'Actions',
    hide: 'Hide',
    restore: 'Restore',
    remove: 'Remove',
    upheld: 'Uphold report',
    dismissed: 'Dismiss report',
    confirmTitle: 'Confirm action',
    reasonLabel: 'Reason (for the audit log)',
    confirm: 'Confirm',
    cancel: 'Cancel',
  },
}

/** Guard against a module existing on the server with no label here. */
export function missingModuleLabels() {
  return MODULES.filter((module) => !en.modules[module])
}

export const t = en
