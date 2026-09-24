# Contract: UI Surfaces (web member area + Expo app)

Both faces call the same API (Principle I). Web uses httpOnly cookies and mobile uses
bearer tokens. The authorization **outcome** is identical. Strings come from the i18n
catalogues through `useTranslations()` (web) or the app's catalogue (mobile). No component
imports a catalogue directly.

Capability data (`canEdit`, `isMine`, `isInfluencer`) decides what is **displayed**. The
server re-checks every action.

## Screens

| Screen | Web route (`/konsole/…`) | Expo route (`src/app/…`) | Who | Story |
|---|---|---|---|---|
| Feed (For you / Following) | `mitglied/threads` | `(member)/threads/index.tsx` | member | US1 |
| Compose (text, ≤ 10 media, quote) | modal over feed | `(member)/threads/compose.tsx` | member | US1, US2 |
| Post + replies | `mitglied/threads/:id` | `(member)/threads/[id].tsx` | member | US2 |
| Quotes / likes of a post | `mitglied/threads/:id/zitate`, `…/likes` | `(member)/threads/quotes/[id].tsx`, `(member)/threads/people/[id].tsx?kind=likes` | member | US2 |
| Activity | `mitglied/aktivitaet` | `(member)/activity/index.tsx` (tab, native badge) | member | US5 |
| My profile (tabs) | `mitglied/profil` | `(member)/profile/index.tsx` | member | US3 |
| Edit profile (handle, avatar, bio, links) | `mitglied/profil/bearbeiten` | `(member)/profile/edit.tsx` | member | US3 |
| Member profile (tabs) | `mitglied/mitglieder/:ref` (`:ref` is a handle or an id; react-router matches whole segments, so `@handle` cannot be its own route) | `(member)/threads/member/[id].tsx` | member | US4 |
| Followers / following | `mitglied/mitglieder/:ref/follower`, `…/folgt` | `(member)/threads/people/[id].tsx?kind=followers\|following` (also post likers, `kind=likes`) | member | US4 |
| Organisation profile (read) | `mitglied/organisationen/:slug` | `(member)/threads/organisation/[slug].tsx` | member | US4 |
| Own organisation profile (view/edit) | `merchant/profil`, `partner/profil` | `(organisation)/public-profile.tsx` (not `profile`: it would collide with the member tab's `/profile`) | merchant, partner | US3 |
| Blocked / muted lists | `mitglied/profil/privatsphaere` | `(member)/profile/privacy.tsx` | member | US8 |
| Influencer grant/revoke | `admin/mitglieder` (find by handle, then history and grant/revoke) | — (staff are web-only) | staff | US6 |
| Threads moderation | `admin/threads` | — | staff | US7 |

## Components shared in behaviour (not code) across faces

| Component | Web | Expo | Rules |
|---|---|---|---|
| Post card | `client/src/member/threads/PostCard.tsx` | `src/components/post-card.tsx` (extend) | Avatar + name + handle + influencer badge; body with mention spans from `mentions`; media grid (1: full, 2–4: grid, 5–10: horizontal carousel); quote embed or the "unavailable" tombstone; like/reply/repost/quote counts from the server |
| Media | `client/src/member/threads/MediaGrid.tsx` | `src/components/media-carousel.tsx` | `width`/`height` always set (no layout shift); `<img srcset>` / `expo-image` from variants; video shows the poster and plays **muted** on user action (web) or on visibility (mobile) |
| Composer | `client/src/member/threads/Composer.tsx` reuses `member/MediaPicker.tsx` (008) | `compose.tsx` with `expo-image-picker` | Upload each file first (`POST /media`), wait for `ready`, then post with asset ids. Alt text is required by the upload API. Character counter at 500 from `THREAD_POST_MAX` |
| Handle gate | a modal on first compose | a screen pushed on first compose | Triggered by `422 handle-required`, not by client inference |

## Navigation

- Web member tabs (`MemberLayout.tsx`): **Threads · Aktivität (badge) · Marktplatz · Profil**.
- Expo `(member)` tabs: **Threads · Activity (badge) · Events · Profile**. The marketplace
  stays where 008/009 put it.
- Web merchant/partner consoles gain **Profil**. The Expo `(organisation)` group gains a
  Profile screen.
- The activity badge polls `GET /threads/activity/unread` on focus and every 60 s while
  visible. There is no push in 010.
