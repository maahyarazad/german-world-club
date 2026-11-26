# Implementation Plan: Your posts move from Profile to Activity (app)

**Branch**: `039-profile-activity-tabs` | **Date**: 2026-11-26 | **Spec**: [spec.md](./spec.md)

## Summary

Two screens in the app change and nothing else does. The Profile screen loses the four post tabs and the list under them; the Activity screen gains five choices at its top (Interactions, which is today's feed and stays the default, and the four post tabs) and a paged list of the member's own posts for the four. The same endpoints, the same cards, the same strings for the four tab names. No server, contract or web change.

## Technical Context

**Language/Version**: TypeScript (strict), React Native 0.86, Expo SDK 57, Expo Router.

**Primary Dependencies**: none added. Reused: `usePaged` (cursor paging), `PostCard`, `Chip`, `FlashList`, `useSession`, `threadsApi.memberPosts`, `PROFILE_TABS` from `@gwc/contracts/threads`.

**Storage**: N/A. **Testing**: the app has no test runner (`lint` and `typecheck` only); see Verification.

**Constraints**: styles in `StyleSheet.create` (no inline style objects); strings in both catalogues; a list that has not received its data shows the loader, never a false "empty" message; a failed request is logged with `console.error` and stores no problem state (CLAUDE.md).

## Constitution Check

No principle is touched: no route, response, outbound call, persistence, media or crawl surface. Principle I holds trivially: which posts a member may see is still the server's answer to the same request, and the app does not re-derive it.

## Design

1. **Activity becomes a container.** `Activity()` holds one piece of state, the selected view, and renders the chips and the body: `Interactions` (the existing list, moved into a function of its own, unchanged) or `OwnPosts` for a post tab.
2. **`OwnPosts` mirrors `threads/member/[id].tsx`**, which already does exactly this for another member (`usePaged` over `memberPosts`, `PostCard` rows). Differences: the id is the signed-in member's, read from the session as other screens do (`state.principal.id`), so there is no extra request; and `onRemoved` is passed, because you can delete your own posts.
3. **A fresh list per tab** (`key={view}`), so one tab's posts can never show under another tab's name, and each tab starts at its top.
4. **Reload when you return** (compose, open a post, delete), skipped on the first focus, using the pattern `marketplace/index.tsx` already uses. Profile reloaded on every focus; this keeps that.
5. **Loader, never a false empty**: while the member's id is unknown or the first page is on its way, the loader shows.
6. **`TabChips` is not reused** because it renders only the four tabs and the other member's profile still uses it unchanged. Activity draws its own row of five `Chip`s with the same container style.
7. **Profile loses**: the tab state, the posts state, the focus effect that loaded them, `TabChips`, `PostCard`, the `threadsApi` import and the two contract types.
8. **Label**: the first choice is "Interactions" / "Interaktionen" (`activity.tabInteractions`), not "Activity" (the screen's own title) and not "Notifications" (push notifications are a different record).

## Verification

- `npx tsc --noEmit` and `npx expo lint` on the two screens.
- The real `activity.tsx` rendered through `react-native-web` with only the app's plumbing stubbed (router, session, API), driven in headless Chrome: it opens on Interactions and marks it seen; each tab requests `memberPosts(<own id>, null, <tab>)`; an empty tab says so; switching back reloads the feed.
- An iOS bundle exported with `expo export` (resolution and Hermes compile).
- Not done here: a real device, paging past the first page (the stub list cannot fire `onEndReached`), and the focus reload.

## Project Structure

```text
specs/039-profile-activity-tabs/{spec.md, plan.md, tasks.md}

expo-client/german-world-club/src/
├── app/(member)/profile/activity.tsx   # container + Interactions + OwnPosts
├── app/(member)/profile/index.tsx      # tabs and posts removed
└── i18n/{en,de}.ts                     # activity.tabInteractions

CLAUDE.md                               # one sentence under "Activity is computed on read"
```

No new file in `src`: the two screens already exist, and the one new component (`OwnPosts`) is private to the Activity screen.
