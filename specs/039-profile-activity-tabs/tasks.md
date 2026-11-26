---

description: "Task list for moving the member's post tabs from Profile to Activity (feature 039)"
---

# Tasks: Your posts move from Profile to Activity (app)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

**Tests**: the app has no test runner, so there are no test files. Verification is typecheck, lint, a render of the real screen through `react-native-web` with the app's plumbing stubbed, and an iOS bundle export (see plan.md).

## Format: `- [ ] [ID] [P?] [Story] Description with file path`

- **[Story]**: US1 my posts are in Activity, US2 Profile no longer lists them, US3 Activity keeps working as it did

All paths are under `expo-client/german-world-club/src/` unless they start with `specs/` or `CLAUDE.md`.

## Notes that apply to every task

- No server, contract or web change (FR-010, SC-005).
- Styles in `StyleSheet.create`, never an inline object; strings in both catalogues (`i18n/en.ts`, `i18n/de.ts`); a failed request is logged with `console.error('<Component>.<function>', error instanceof ApiError ? error.problem : error)` and keeps no problem in state.
- Read the Expo SDK 57 docs before changing app code (`AGENTS.md`); this change uses only APIs the two screens already use.

---

## Phase 1: Setup

- [x] T001 Create branch `039-profile-activity-tabs` from `main` (separate from the 037 and 038 branches), and write `specs/039-profile-activity-tabs/spec.md` and `plan.md` after reading `app/(member)/profile/index.tsx`, `app/(member)/profile/activity.tsx`, `components/profile-header.tsx` (`TabChips`) and `app/(member)/threads/member/[id].tsx` (the same tabs and paged list for another member, the pattern to follow).

## Phase 2: Foundational

- [x] T002 Add `activity.tabInteractions` to `i18n/en.ts` ("Interactions") and `i18n/de.ts` ("Interaktionen"), inside the existing `activity` block. The four post-tab labels already exist as `profile.tabs.threads|replies|media|reposts` and are reused unchanged (FR-009).

---

## Phase 3: User Story 1 - My posts are in Activity (P1) MVP

**Goal**: five choices at the top of Activity; the four post tabs list the signed-in member's own posts.

**Independent test**: post a thread and a reply, open Profile, tap Activity, choose Threads and Replies: both are there; delete one and it disappears.

- [x] T003 [US1] In `app/(member)/profile/activity.tsx`, make `Activity()` a container: state `view` (`'interactions' | ProfileTab`, starting on `'interactions'`), a wrapping row of five `Chip`s (`VIEWS = ['interactions', ...PROFILE_TABS]`, labels `t.activity.tabInteractions` and `t.profile.tabs[tab]`) with `accessibilityRole="tablist"`, and a bounded `View` that shows `<Interactions />` or `<OwnPosts key={view} tab={view} />`.
- [x] T004 [US1] In the same file add `OwnPosts({ tab })`: the member id from `useSession()` (`state.principal.id`, no request), `usePaged` over `threadsApi.memberPosts(me, cursor, tab)`, a `FlashList` of `PostCard`s with `onChange` and `onRemoved` (delete) updating the list through `setItems`, `onEndReached` paging, pull-to-refresh, `t.common.empty` when empty, reload on regaining focus (skipped the first time, the `marketplace/index.tsx` pattern), and `<Loading />` while the id is unknown or the first page is loading.

**Checkpoint**: Activity shows the four tabs and the member's own posts.

---

## Phase 4: User Story 2 - Profile no longer lists my posts (P1)

**Goal**: Profile shows the header, contact details, settings, Activity button (with its unread count), language and sign out, and nothing about posts.

**Independent test**: open Profile with a member who has posts: no tabs, no posts, and no request for posts.

- [x] T005 [US2] In `app/(member)/profile/index.tsx` remove the `tab` and `posts` state, the focus effect that loaded the posts, the `<TabChips>` and the post list, and the imports they leave unused (`TabChips`, `PostCard`, `threadsApi`, `ProfileTab`, `ThreadPost`). Update the screen's doc comment to say the posts are in Activity now. Do **not** touch `components/profile-header.tsx` (`TabChips` is still used by `threads/member/[id].tsx`) or the Activity button and its unread count.

**Checkpoint**: Profile is shorter and makes one request fewer.

---

## Phase 5: User Story 3 - Activity keeps working as it did (P1)

**Goal**: the interactions feed is first, marks itself seen, refreshes and pages, exactly as before.

**Independent test**: with unread activity, open Activity: interactions first, unread count on Profile clears.

- [x] T006 [US3] Move the existing feed body into `function Interactions()` in `activity.tsx` unchanged (list, `markSeen` through `publishUnread(0)`, refresh, load more, the "No activity yet" text), so a reader can diff it against the old default export.
- [x] T007 [P] [US3] Verify, with the real `activity.tsx` rendered through `react-native-web` and stubs for `expo-router`, `@shopify/flash-list`, the session, `threadsApi` and the UI components, driven in headless Chrome over the DevTools protocol: it opens on Interactions and calls `markSeen` with the newest item; Threads, Replies, Media and Reposts each call `memberPosts(<own id>, null, <tab>)`; an empty tab shows the empty text; returning to Interactions reloads the feed. **Result:** all as intended; the five chips wrap onto two rows at 390 px wide.

**Checkpoint**: nothing the screen did before is lost.

---

## Phase 6: Polish

- [x] T008 [P] Run `npx tsc --noEmit` and `npx expo lint` on `activity.tsx` and `index.tsx` in `expo-client/german-world-club`. **Done: both clean.**
- [x] T009 [P] Add one sentence under "Activity is computed on read" in `CLAUDE.md` saying Activity is now where your own post tabs live and another member's profile keeps its own.
- [ ] T010 On an iPhone and an Android phone: Profile has no tabs; Activity opens on Interactions; each post tab lists posts; scroll a tab with more than one page of posts to its end and more load; delete a post and it goes; compose a post, come back, and it is in Threads; the German labels fit. **Needs a device; not done here.**

---

## Dependencies and order

```
T001 ─► T002 ─► T003 ─► T004 ─┬─► T005 (Profile) ─┐
                              └─► T006 ─► T007 ───┴─► T008, T009 ─► T010
```

- T005 can only be released after T004: the posts must have a new home before the old one goes.
- T006 is done while T003 is written (it is the same file); T007 needs T003, T004 and T006.

## Implementation strategy

1. **MVP = T001 to T005 together.** Moving is one change: adding the tabs to Activity without removing them from Profile would leave two lists, and removing them from Profile without adding them leaves none.
2. T006 and T007 keep the old behaviour honest; T008 to T010 are the gates.
