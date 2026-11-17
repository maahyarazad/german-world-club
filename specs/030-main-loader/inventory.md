# Inventory: where the loader is used (feature 030)

Built during implementation from `grep` over `client/src` and `expo-client/german-world-club/src` for files that call the API, then checked file by file. "Page" is a load before first content; "Button" is a request-sending button; "In place" is a reload or load-more with content already on screen.

## Web console (`client/src`)

| Area | Page loader | Button loading | Notes |
|---|---|---|---|
| Shell / routing | `console/routes.tsx` (`Authenticated`, `Elsewhere`, `ApplicantOnly`), `onboarding/{Application,Profiling}.tsx` | `console/ConsoleShell.tsx` sign-out (`AsyncButton`) | |
| Auth | n/a | `auth/{SignIn,PasswordReset}.tsx` submits | the sign-in refusal stays shown (documented exception) |
| Staff | `AdminDashboard` (figures), `admin/{Roles,Applications,Marketplace,Threads,ServerFaults,Push,Referrals}.tsx` | Approve/Deny (`Applications`), confirm (`Marketplace`, `Threads`, `Referrals`), Save (`Roles`), Send/Rehearse/Add/Remove (`Push`), Find/Change (`Influencers`), Look up/Older/Open (`ServerFaults`) | pages that showed a false "empty" while loading now use a `loaded` flag |
| Member profile | `profile/{MyProfile,MemberProfile,OrganisationView,EditProfile,Devices}.tsx` | Save, handle, follow/mute/block (only the clicked one), Terminate (per row), Unblock/Unmute | |
| Member social | `threads/{PostList,Activity,PostView}.tsx`, `messages/{Inbox,Conversation}.tsx`, `Marketplace.tsx`, `Referrals.tsx` | Post, Send, Report, Accept terms, Publish, Replace link, Load more (`PostList`) | |
| Onboarding / organisation | `onboarding/*`, `organisation/Profile.tsx` | Continue/Verify/Save/Submit; Resend (`AsyncButton`); Save (`organisation/Profile`) | |

**Deliberately without a loader**: like/repost toggles in `PostCard` (optimistic, pressed-state buttons, no wait to show), avatar and media pickers (they show real upload progress), and buttons that only open or close a dialog, go back or cancel. The profiling `steps.tsx` buttons are disabled by the shared `busy` but the request is the page-level `save`, whose Continue button is `loading` where it owns the state.

## App (`expo-client/german-world-club/src`)

- `components/ui.tsx` `Loading` (used by ~20 screens: activity, offers, marketplace, messages, profile, handle, threads, organisation, profiling, listing detail, referrals, cities) now renders the shared `ScreenLoader`; `Button` `loading` draws the shared `Spinner`; `AsyncButton` added.
- New: `profile/devices.tsx` (page loader and per-row terminate), `profile/privacy.tsx` (per-list loader), `referrals-view.tsx` (list loaders), `events/[id].tsx` (cancel), resend and sign-out buttons in `(public)/{sign-in-code,verify-mobile}`, `(applicant)/{verify-email,waiting}`, `(member)/profile/edit.tsx` (links), `profiling/cities.tsx` (continue).
- Already had `loading={busy}` (now the new spinner): sign-in, register, verify, compose, request, send message, save profile, handle form, event register.
- `ActivityIndicator` is no longer used anywhere in the app.
