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
    // There is deliberately no account-creation link. Registration is out of
    // scope (FR-002) and client/tests/no-registration.test.jsx enforces that
    // no such affordance creeps back in — in either language.

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
        'This account is not fully set up yet. Setup happens in the mobile app; it is not '
        + 'currently available on the web.',

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
}

/** Guard against a module existing on the server with no label here. */
export function missingModuleLabels() {
  return MODULES.filter((module) => !en.modules[module])
}

export const t = en
