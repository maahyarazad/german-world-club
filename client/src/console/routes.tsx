import type { ReactNode } from 'react'
import { Routes, Route, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'

import type { Snapshot } from '../lib/capabilities'
import { useCapabilities, STATUS, homeFor } from '../lib/capabilities'
import { useTranslations } from '../i18n/index'
import SignIn from '../auth/SignIn'
import PasswordReset from '../auth/PasswordReset'
import AdminLayout from './admin/AdminLayout'
import AdminDashboard from './AdminDashboard'
import Marketplace from './admin/Marketplace'
import MemberLayout from '../member/MemberLayout'
import MemberMarketplace from '../member/Marketplace'
import Feed from '../member/threads/Feed'
import PostView, { QuotesView, LikesView } from '../member/threads/PostView'
import Activity from '../member/threads/Activity'
import MyProfile from '../member/profile/MyProfile'
import EditProfile from '../member/profile/EditProfile'
import MemberProfile, { FollowList } from '../member/profile/MemberProfile'
import Privacy from '../member/profile/Privacy'
import Settings from '../member/profile/Settings'
import Roles from './admin/Roles'
import OrganisationView from '../member/profile/OrganisationView'
import OrganisationProfilePage from '../organisation/Profile'
import ThreadsModeration from './admin/Threads'
import Influencers from './admin/Influencers'
import Push from './admin/Push'
import ServerFaults from './admin/ServerFaults'
import OrganisationLayout from '../organisation/OrganisationLayout'
import OrganisationHome from '../organisation/OrganisationHome'
import StorePage from '../organisation/Store'
import MerchantReport from '../organisation/Report'
import AdminStores from './admin/Stores'
import AdminOfferCategories from './admin/OfferCategories'
import AdminRedemptionReport from './admin/RedemptionReport'
import ClubOffers from '../offers/Offers'
import ClubOfferDetail from '../offers/OfferDetail'
import ClubRedemptions from '../offers/Redemptions'
import type { OffersKind } from '../offers/api'
import OffersPage from '../organisation/Offers'
import OfferEditor from '../organisation/OfferEditor'
import Inbox from '../member/messages/Inbox'
import Conversation from '../member/messages/Conversation'
import Referrals from '../member/Referrals'
import AdminReferrals from './admin/Referrals'
import NotBuilt from './NotBuilt'
import Register from '../onboarding/Register'
import VerifyMobile from '../onboarding/VerifyMobile'
import Application from '../onboarding/Application'
import EmptyState from './EmptyState'
import Button from '../components/ui/Button'
import PageLoader from '../components/ui/PageLoader'

/**
 * The console's route table, separated from the mount.
 *
 * `konsole.tsx` calls `createRoot` at module scope, so anything importing it to
 * reach the routes would mount the whole app as a side effect. Keeping the
 * routes here makes them drivable inside a MemoryRouter — the same split the
 * server makes between `app.ts` (everything testable) and `server.ts` (listen).
 */

/** Sign-in, and the redirect to wherever this principal belongs. */
/**
 * The staff merchant-offer detail used to live at `angebote/:id`. The list moved to
 * `angebote-entdecken` (feature 042) because `angebote` is the marketplace moderation
 * page, so a link someone already pasted is sent to the new address.
 */
function StaffOfferRedirect() {
  const { id = '' } = useParams()
  return <Navigate to={`/konsole/admin/angebote-entdecken/${id}`} replace />
}

function SignInRoute() {
  const navigate = useNavigate()
  return (
    <SignIn
      onSignedIn={(snapshot: Snapshot | null) => navigate(homeFor(snapshot?.kind), { replace: true })}
      onResetPassword={() => navigate('/konsole/passwort')}
    />
  )
}

function PasswordResetRoute() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  // `hasTokenParam` distinguishes "no token in the link" from "not on the
  // confirm step at all". Without it, a truncated reset link — `?token=` with
  // nothing after it — would silently render the request form again, and the
  // user would keep asking for links that keep arriving broken.
  return (
    <PasswordReset
      token={params.get('token')}
      hasTokenParam={params.has('token')}
      onRequestNewLink={() => navigate('/konsole/passwort', { replace: true })}
    />
  )
}

/**
 * Where an unrecognised console path goes.
 *
 * Signed in, it returns to the principal's own home rather than the sign-in
 * screen. Sending an authenticated staff member to sign in reads as having been
 * logged out, and they then re-enter credentials for a session that was never
 * lost. Only a genuinely anonymous visitor gets the sign-in screen.
 *
 * Waits for the snapshot first: redirecting while it is still loading would be
 * guessing, and not guessing is what the capability gate exists for.
 */
function Elsewhere() {
  const { status, snapshot } = useCapabilities()

  if (status === STATUS.LOADING) return <PageLoader className="min-h-svh bg-ground" />
  if (status === STATUS.READY && snapshot) {
    return <Navigate to={homeFor(snapshot.kind)} replace />
  }
  if (status === STATUS.APPLICANT) return <Navigate to={APPLICATION_PATH} replace />
  return <Navigate to="/konsole/anmelden" replace />
}

/** Where an applicant with a session belongs until staff decide (feature 009). */
const APPLICATION_PATH = '/konsole/bewerbung'

/**
 * The application screen's own gate: only for somebody who IS an applicant.
 *
 * An approved member landing here goes home, and an anonymous visitor goes to
 * sign-in — the screen itself would only discover either after a request.
 */
function ApplicantOnly({ children }: { children?: ReactNode }) {
  const { status, snapshot } = useCapabilities()
  if (status === STATUS.LOADING) return <PageLoader className="min-h-svh bg-ground" />
  if (status === STATUS.APPLICANT) return children
  if (status === STATUS.READY && snapshot) return <Navigate to={homeFor(snapshot.kind)} replace />
  return <Navigate to="/konsole/anmelden" replace />
}

/**
 * The gate between "not signed in" and the console.
 *
 * Renders nothing of the console until the capability snapshot has arrived —
 * not a skeleton of the sidebar, not a guessed navigation. A console that
 * painted its chrome first would be showing a shape nobody had been granted.
 */
function Authenticated({ children }: { children?: ReactNode }) {
  const t = useTranslations()
  const { status, refresh } = useCapabilities()

  if (status === STATUS.LOADING) {
    return <PageLoader className="min-h-svh bg-ground" />
  }

  if (status === STATUS.ANONYMOUS) return <Navigate to="/konsole/anmelden" replace />

  // Signed in, application not yet approved: never the console, and never the
  // "could not load permissions" error either — nothing is broken.
  if (status === STATUS.APPLICANT) return <Navigate to={APPLICATION_PATH} replace />

  if (status === STATUS.FAILED) {
    // Never a hard-coded fallback navigation. A failed capability fetch is an
    // error state, not an invitation to guess (contracts/capability-api.md).
    return (
      <div className="min-h-svh bg-ground px-4 font-sans">
        <EmptyState title={t.console.capabilitiesFailedTitle}>
          <p>{t.console.capabilitiesFailedBody}</p>
          <Button className="mt-4" onClick={() => refresh()}>
            {t.console.retry}
          </Button>
        </EmptyState>
      </div>
    )
  }

  return children
}

export function ConsoleRoutes() {
  return (
    <Routes>
      <Route path="/konsole/anmelden" element={<SignInRoute />} />
      <Route path="/konsole/passwort" element={<PasswordResetRoute />} />

      {/* Onboarding, Phase 1 (feature 009) — the same steps as the app. Steps
          1–3 need no session; the application screen needs an applicant's. */}
      <Route path="/konsole/registrieren" element={<Register />} />
      <Route path="/konsole/registrieren/mobil" element={<VerifyMobile />} />
      <Route
        path={APPLICATION_PATH}
        element={
          <ApplicantOnly>
            <Application />
          </ApplicantOnly>
        }
      />

      <Route
        path="/konsole/admin"
        element={
          <Authenticated>
            <AdminLayout />
          </Authenticated>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="angebote" element={<Marketplace />} />
        <Route path="threads" element={<ThreadsModeration />} />
        <Route path="mitglieder" element={<Influencers />} />
        {/* Feature 011. Push.tsx wraps itself in RequireGrant mass_messages,
            like Marketplace does, so a direct URL gets "not available". */}
        <Route path="push" element={<Push />} />
        <Route path="fehlerprotokoll" element={<ServerFaults />} />
        {/* A staff member's OWN link needs no grant (every staff member earns,
            spec Q2); overseeing everybody's is the `referrals` module. */}
        <Route path="empfehlen" element={<Referrals basePath="/admin/referrals/me" />} />
        {/* Merchant offers (feature 035): staff browse and redeem as people, needing no grant. */}
        {/* Its own address, like a merchant's and a partner's: `angebote` is marketplace moderation above,
            and two siblings with one path meant this list could never be reached (feature 042). */}
        <Route path="angebote-entdecken" element={<ClubOffers kind="staff" />} />
        <Route path="angebote-entdecken/:id" element={<ClubOfferDetail kind="staff" />} />
        <Route path="angebote/:id" element={<StaffOfferRedirect />} />
        <Route path="einloesungen" element={<ClubRedemptions kind="staff" />} />
        {/* Wraps itself in RequireGrant referrals/read, like Push.tsx. */}
        <Route path="empfehlungen" element={<AdminReferrals />} />
        {/* Feature 028. Wraps itself in RequireGrant admins/read, like Push.tsx. */}
        <Route path="rollen" element={<Roles />} />
        {/* Merchant stores, categories and the platform report (feature 035). Each
            wraps itself in RequireGrant merchant_offers/read, like Push.tsx. */}
        <Route path="shops" element={<AdminStores />} />
        <Route path="angebotskategorien" element={<AdminOfferCategories />} />
        <Route path="einloesungs-bericht" element={<AdminRedemptionReport />} />
        {/* Keeps an admin area with no page yet inside the shell. Without this
            it fell through to the `*` below and redirected to sign-in, which
            reads as a logout on a session that is still perfectly valid. */}
        <Route path="*" element={<NotBuilt />} />
      </Route>

      <Route
        path="/konsole/mitglied"
        element={
          <Authenticated>
            <MemberLayout />
          </Authenticated>
        }
      >
        <Route index element={<MemberMarketplace />} />
        {/* Threads and profiles (feature 010). A member is addressed by
            handle or id under one segment — react-router matches whole
            segments, so `@handle` cannot be a route of its own. */}
        <Route path="threads" element={<Feed />} />
        <Route path="threads/:id" element={<PostView />} />
        <Route path="threads/:id/zitate" element={<QuotesView />} />
        <Route path="threads/:id/likes" element={<LikesView />} />
        <Route path="aktivitaet" element={<Activity />} />
        {/* Merchant offers (feature 035): any account may redeem; here, a member's. */}
        <Route path="angebote" element={<ClubOffers kind="member" />} />
        <Route path="angebote/:id" element={<ClubOfferDetail kind="member" />} />
        <Route path="einloesungen" element={<ClubRedemptions kind="member" />} />
        <Route path="profil" element={<MyProfile />} />
        <Route path="profil/bearbeiten" element={<EditProfile />} />
        <Route path="profil/privatsphaere" element={<Privacy />} />
        <Route path="profil/einstellungen" element={<Settings />} />
        {/* Feature 026 linked the session list here; keep old bookmarks working. */}
        <Route path="profil/geraete" element={<Navigate to="/konsole/mitglied/profil/einstellungen" replace />} />
        <Route path="mitglieder/:ref" element={<MemberProfile />} />
        <Route path="mitglieder/:ref/follower" element={<FollowList direction="followers" />} />
        <Route path="mitglieder/:ref/folgt" element={<FollowList direction="following" />} />
        <Route path="organisationen/:slug" element={<OrganisationView />} />
        {/* Feature 020: requests about listings and the replies to them. The
            message emails link to nachrichten/:id. */}
        <Route path="nachrichten" element={<Inbox />} />
        <Route path="nachrichten/:id" element={<Conversation />} />
        {/* Refer & earn (018): the same page on every face, told apart by the
            mount the server serves that principal's own referrals at. */}
        <Route path="empfehlen" element={<Referrals basePath="/referrals" />} />
        {/* Same reasoning as the admin area's `*`: an unbuilt member path must
            not fall through to the top-level `*` and read as a logout on a
            session that is still perfectly valid. */}
        <Route path="*" element={<NotBuilt />} />
      </Route>

      {/* The two organisation portals, at the homes HOME_FOR_KIND already
          names. Both are shells today; the nested `*` keeps an unbuilt path
          inside the portal rather than reading as a logout. */}
      {(['merchant', 'partner'] as const).map((kind) => (
        <Route
          key={kind}
          path={`/konsole/${kind}`}
          element={
            <Authenticated>
              <OrganisationLayout kind={kind} />
            </Authenticated>
          }
        >
          <Route index element={<OrganisationHome />} />
          <Route path="profil" element={<OrganisationProfilePage kind={kind} />} />
          <Route path="empfehlen" element={<Referrals basePath={`/referrals/${kind}`} />} />
          {/* Feature 035: a merchant's store and offers. A partner has neither, so
              for a partner these paths are as unbuilt as any other. */}
          {/* Any account may redeem merchant offers, a merchant's or partner's included. */}
          <Route path="angebote-entdecken" element={<ClubOffers kind={kind} />} />
          <Route path="angebote-entdecken/:id" element={<ClubOfferDetail kind={kind} />} />
          <Route path="einloesungen" element={<ClubRedemptions kind={kind} />} />
          {kind === 'merchant' && (
            <>
              <Route path="shop" element={<StorePage />} />
              <Route path="bericht" element={<MerchantReport />} />
              <Route path="angebote" element={<OffersPage />} />
              <Route path="angebote/neu" element={<OfferEditor />} />
              <Route path="angebote/:id" element={<OfferEditor />} />
            </>
          )}
          <Route path="*" element={<NotBuilt />} />
        </Route>
      ))}

      <Route path="/konsole" element={<Elsewhere />} />
      <Route path="*" element={<Elsewhere />} />
    </Routes>
  )
}

export default ConsoleRoutes
