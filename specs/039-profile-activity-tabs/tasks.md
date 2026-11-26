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

## Phase 7: The same header on every tab (US4, US5 and US6, added to this branch on request)

**Goal**: the header actions are behind three dots in a WhatsApp-style drop-down, and every screen of the five tabs has its title on the left and the club's emblem in the middle, without making the header taller. Spec: the addendum in [spec.md](./spec.md); design: the addendum in [plan.md](./plan.md).

**Independent test**: open each of the five tabs and one screen inside it: the title is at the left, the emblem is in the middle and the header is not taller than before. In Marketplace and Threads, tap the dots and choose a row.

All paths are under `expo-client/german-world-club/` unless they start with `specs/` or `CLAUDE.md`.

- [x] T011 [P] [US5] Make the logo asset: crop `assets/gwc-logo.png` (844 x 578, an opaque white background, the mark above a line of lettering) to the mark, flood-fill the outer white to transparent from the border so the rings' interior white stays, resize to 217 x 120 and save `assets/gwc-logo-header.png` (52 KB). Check it on a white and on a dark background at 3x header size. **Done: clean on both.**
- [x] T012 [P] Add `common.menu` ("More" / "Mehr") and `common.back` ("Back" / "Zurück") to `src/i18n/en.ts` and `src/i18n/de.ts`. (An earlier `marketplace.menu` and a `ModalScrim` constant in `src/constants/theme.ts` were removed: the menu is shared now and a drop-down is not dimmed.)
- [x] T013 [US5] Create `src/components/app-header.tsx`: `AppHeader` for the stack's `header` option, three columns (left and right equal, a fixed-width emblem between them), the title from `options.title` at 16 pt on one line with an ellipsis, the back button as a drawn chevron calling `navigation.goBack`, `options.headerRight` on the right, a bar of `HEADER_BAR_HEIGHT` (44 iOS, 56 Android) plus the top inset, the navigation theme's `card` and `border`, a 28 pt emblem. Export `HEADER_BAR_HEIGHT` and `renderAppHeader` (declared once, at module level).
- [x] T014 [US4] (First version, replaced by T027 to T030: a `Modal` and a hand-drawn card.) Create `src/components/header-menu.tsx`: `HeaderMenu({ items })` with `HeaderMenuItem = { key, label, href, dot? }`, a three-dots button (a vertical column on both platforms, as of T023) that carries a dot when any row has one, a native `Modal` (transparent, fade, `statusBarTranslucent`, a full-screen backdrop that dims nothing) and a card under the dots, closing on a row, on a tap outside and on the system back; on iOS the row's navigation waits for `onDismiss`; renders nothing for an empty list. No inline style objects.
- [x] T015 [US4] Marketplace: in `src/app/(member)/marketplace/_layout.tsx` set `screenOptions={{ header: renderAppHeader }}` and remove the small-title code and the `...smallTitle` spreads; in `src/app/(member)/marketplace/index.tsx` build `menuItems` (Messages with the unread dot; My listings and New listing only when `canPost`) and set `headerRight` to `<HeaderMenu items={menuItems} />`, deleting the two styles the old text buttons used.
- [x] T016 [US4] Threads: in `src/app/(member)/threads/_layout.tsx` set `screenOptions={{ header: renderAppHeader }}`; in `src/app/(member)/threads/index.tsx` replace the "New post" text button with `<HeaderMenu items={menuItems} />` whose one row is New post (`/threads/compose`), and delete its `colorTintWeight600` style and the imports it left unused.
- [x] T017 [P] [US6] Offers: in `src/app/(member)/offers/_layout.tsx` set `screenOptions={{ header: renderAppHeader }}` in place of `headerBackButtonDisplayMode`.
- [x] T018 [P] [US6] Events: in `src/app/(member)/events/_layout.tsx` set `screenOptions={{ header: renderAppHeader }}` in place of `headerBackButtonDisplayMode`.
- [x] T019 [P] [US6] Profile: in `src/app/(member)/profile/_layout.tsx` set `screenOptions={{ header: renderAppHeader }}` in place of `headerBackButtonDisplayMode`.
- [x] T020 [P] Verify: `npx tsc --noEmit` (clean) and `npx expo lint` on the touched files (no error in them; the two that remain are in files this change does not touch); an iOS bundle with `expo export`; and render the real header and menu through `react-native-web` in headless Chrome. **Result:** title left and emblem at the same centre on all seven variants (short, long German, back-only, Threads, Offers, with and without back); a long title cut with an ellipsis without moving the emblem; light and dark both fine; the drop-down opens under the dots, nothing dimmed, with its unread dot; a one-row menu works; and a tap on a row closes it and pushes `/marketplace/messages` or `/threads/compose`.
- [x] T021 [P] Update the note in `CLAUDE.md` (it says the Marketplace stack): every tab's stack draws its own header, why (iOS cannot left-align a native title), that the right-hand button is the screen's `headerRight`, and that `HeaderMenu` takes rows as data.
- [x] T023 [US4] Turn the dots 90 degrees: in `src/components/header-menu.tsx` make the `dots` style `flexDirection: 'column'` on both platforms (it was a row on iOS), and replace its comment.
- [x] T024 [US7] Make the Marketplace stack open every pushed screen the platform's way: in `src/app/(member)/marketplace/_layout.tsx` import `Platform`, add `PUSH_ANIMATION` (`'slide_from_right'` on Android below API 33, else `'default'`, with the comment saying why), pass it as `animation` in the stack's `screenOptions`, delete `animation: 'slide_from_right'` from `edit/[id]` and `new` (keep `presentation: 'card'`) and rewrite the two comments in that file that describe the old slide.
- [x] T025 [P] Verify: `npx tsc --noEmit` and `npx expo lint` on the touched files (clean); `npx expo export` for `ios` and for `android` (both succeed); the dots rendered in headless Chrome as a column; and the library's Android animation resources and `types.tsx` read to confirm what `default` and `slide_from_right` do on each platform (recorded in plan.md). The transition itself is not observed here.
- [x] T026 [P] Update the 039 spec and plan for US7 (FR-020, FR-021, SC-009, the two readings of the request, the 017 supersession), tasks.md, and one sentence in `CLAUDE.md`: a screen in this stack does not set its own `animation`.
- [x] T027 [US8] Create `src/components/header-menu-shared.tsx`: `HeaderMenuItem` (`key`, `label`, `href`, `dot?`), `HeaderMenuProps`, `openHeaderMenuItem(items, key)` (finds the row and `router.push`es its `href`), and `MenuDots({ unread })`, the three dots as a column with the red badge in the corner, a plain accessible view (`accessibilityRole="button"`, label `t.common.menu`, with a dot when there is news) and no `onPress`.
- [x] T028 [P] [US8] Create `src/components/header-menu.ios.tsx`: `HeaderMenu({ items })` as `Host matchContents ignoreSafeArea="all"` around SwiftUI's `Menu` from `@expo/ui/swift-ui`, its `label` an `RNHostView matchContents` around `MenuDots`, each row a `Button` (`label`, `onPress` pushes `href`), and for a row with news `systemImage="circle.fill"` and `modifiers={[tint(theme.danger)]}` from `@expo/ui/swift-ui/modifiers`; renders nothing for an empty list; re-exports `HeaderMenuItem`.
- [x] T029 [P] [US8] Create `src/components/header-menu.android.tsx`: `HeaderMenu({ items })` as `MenuView` from `@expo/ui/community/menu` with `actions` built from the rows (`id` the row's `key`, `title` the label with " •" appended when it has news) and `onPressAction` calling `openHeaderMenuItem`, `MenuDots` as its child (a plain view: `MenuView` wraps it in a `Pressable`); renders nothing for an empty list; re-exports `HeaderMenuItem`.
- [x] T030 [US8] Replace `src/components/header-menu.tsx` (the `Modal` version, with its offset maths, backdrop and `onDismiss` wait) by the fallback every other target resolves to and TypeScript reads: it re-exports `HeaderMenuItem` and `HeaderMenu`, which renders nothing, with a comment saying why (`@expo/ui` has no web menu and importing its native views would break a web bundle). The two callers (`marketplace/index.tsx`, `threads/index.tsx`) need no change.
- [x] T031 [P] Verify: `npx tsc --noEmit` (clean); `npx expo lint` on `src/components`, the Marketplace and Threads folders (no error in them; `handle-form.tsx` is the one that remains and is not touched); `npx expo export` for `ios` and for `android` (both succeed, both contain the menu code); and `MenuDots` rendered in headless Chrome (a column, with the badge, light and dark). The installed `@expo/ui` 57.0.20 source was read, because the two pages in the request are the SDK 58 docs. The native menus themselves are not seen.
- [x] T032 [P] Update the 039 spec (US8, FR-022, FR-023, three assumptions), the plan (item 2, rewritten, and its Verification) and `CLAUDE.md` (the sentence about `HeaderMenu`).
- [x] T033 [US8] Make the iPhone's label native: in `src/components/header-menu.ios.tsx` replace the `RNHostView` around `MenuDots` by SwiftUI's `Image` (`systemName="ellipsis"`, `size` 20, `color` the theme's tint) with `modifiers` `rotationEffect(90)`, `frame({ width: 40, height: 44 })` and `accessibilityLabel` (with " •" when there is news), put the `Host` in a fixed 40 x 44 `View` (a local `StyleSheet`), lay `MenuBadge` over it when there is news, and do not use `buttonStyle('plain')` (it would make only the dots' pixels tappable). Rewrite the doc comment to say why: the menu opened over the dots and the dots moved when tapped, and the hosted view was what both had in common.
- [x] T034 [US8] In `src/components/header-menu-shared.tsx` export `MENU_BUTTON` (`{ width: 40, height: 44 }`, used by the Android trigger's style and the iOS box) and `MenuBadge` (the red dot, `pointerEvents: 'none'`), and make `MenuDots` use `MenuBadge`.
- [x] T035 [P] Verify: `npx tsc --noEmit` (clean); `npx expo lint src/components` (no error in these files; `handle-form.tsx` is the one that remains and is not touched); `npx expo export` for `ios` and `android` (both succeed). The installed `@expo/ui` types were read for `Image`, `frame`, `rotationEffect` (degrees) and `accessibilityLabel`. A web search for the cause found nothing documented, so the fix is reasoned and not measured.
- [x] T036 [P] Update the 039 spec (scenario 6 of US8, FR-024, an assumption), the plan (the iOS bullet, with the reasons, and the note on Android) and the `CLAUDE.md` sentence about `MenuDots`.
- [x] T037 [US8] Use Entypo for the dots: add the dependency (`npx expo install @expo/vector-icons` in `expo-client/german-world-club`, which pins `^15.0.2` in `package.json` and updates the root `package-lock.json`); in `src/components/header-menu-shared.tsx` import `Entypo from '@expo/vector-icons/Entypo'`, replace the three hand-drawn circles in `MenuDots` by `<Entypo name="dots-three-vertical" size={22} color={theme.tint} />` (colour from `useTheme()`), delete the `DOT` constant, the `dots` style and the `dot` style, and call `Entypo.loadFont()` at module level with a `console.error('MenuDots.loadFont', error)` catch, because an icon font draws nothing until it has loaded. Leave `header-menu.ios.tsx` as it is.
- [x] T038 [P] Verify: the glyph name against the installed font map; `npx tsc --noEmit` (the glyph name is type-checked); `npx expo lint src/components`; `npx expo export` for `ios` and `android` (both succeed, and the Entypo font is in the bundle).
- [x] T039 [P] Update the 039 spec (two assumptions: each platform's own icon, and the new dependency), the plan (the `MenuDots` bullet and a note on the icon, the dependency and the option for one look on both platforms) and the `CLAUDE.md` sentence about `MenuDots`.
- [ ] T040 On an iPhone and an Android phone, on each of the five tabs: the header is the same height as before; the emblem is centred on every screen; where there are dots they open the drop-down under them, nothing is dimmed, and each row opens its screen (on iOS after the menu has closed); tap outside and system back close it; the edge-swipe and the back button return; a title that arrives late (a conversation, a member's profile) appears; German titles fit; the bar sits correctly under a notch; and the screens that open as an iOS sheet (Threads: new post and handle; Profile: edit and handle) show the header with no gap above it. Also: the dots are a column on both platforms; Messages, My listings and New listing open with the platform's push (iOS: standard push; Android 13+: a short slide with a fade; Android 12 or earlier: a slide from the right), look the same as opening a screen in the phone's Settings, and go back the same way. Also, on each phone: the dots open the system's own menu (iPhone: SwiftUI's, at the dots; Android: a Material drop-down under them, on screen although they are at the right edge); the Messages row shows its red dot on iPhone and "Messages •" on Android; a row opens its screen; a tap outside closes it; VoiceOver and TalkBack announce the dots as a button called "More"; and the development build has the menu at all (if a missing native view is reported, it was built from an older `@expo/ui` and needs a rebuild). **First, on the iPhone: the three dots do not move, jump or resize when tapped, and the menu opens under them and not over them (T033); and on Android, whether it shows the same two faults, which T033 did not change.** **Needs a device; not done here.**

**Checkpoint**: every tab's header is one tidy row, with a drop-down where a screen has actions.

---

## Phase 8: The same Entypo dots on the iPhone, with the menu opening below them (US8, sixth pass, added on request)

**Request**: "update `header-menu.ios.tsx` and use `<Entypo name="dots-three-vertical" size={ICON_SIZE} color={theme.tint} />` for the dots; also the menu should open below the dots."

**Goal**: the iPhone's three dots are the same Entypo icon Android already shows, and the system menu still opens under them, with the dots not moving.

**Why this is not a one-line swap**: T033 took the hosted React Native dots *out* of the menu's label because a hosted view is what made the menu open over the dots and made the dots move when tapped. Putting `MenuDots` back into `Menu`'s `label` (`RNHostView`) would bring both faults back. The way that gives both the Entypo icon and the native anchor is the one the plan already names and never built: draw the icon **outside** the menu, and lay a **transparent native `Menu`** under it as the tap target. The icon is then a plain React Native view over a fixed 40 x 44 box (exactly as `MenuBadge` already is), and the system anchors the menu to its own label, which is where the icon is.

**What `@expo/ui` 57.0.20 can and cannot do** (read in `node_modules/@expo/ui/build/swift-ui`, not from the SDK 58 docs):

- Present: `opacity(value)`, `contentShape(shapes.rectangle())` (so the whole frame takes taps, not only drawn pixels; T033's note that there is no `contentShape` modifier here was wrong for this version), `frame`, `accessibilityLabel`, `accessibilityHidden`.
- `hidden()` exists and **must not be used** for the label: a hidden SwiftUI view is not hit-tested, so the menu would never open. `opacity(0)` is not hidden: the view is still there, still tappable, still read by VoiceOver.
- **There is no placement option.** `Menu` takes only `label`, `systemImage`, `onPrimaryAction` and `children`; `menuStyle`, `menuIndicator` and `menuOrder` do not choose a side. The system opens the menu on the side with room, below the label for one in a top header. So "opens below the dots" is delivered by making the native label's frame exactly the dots' box with nothing hosted inside it, not by a flag; whether it does is only provable on a phone (T045).

**Independent test**: on an iPhone open Marketplace: the dots look the same as on Android; tap them; the system menu opens below them, they do not move, and choosing Messages opens Messages.

All paths are under `expo-client/german-world-club/` unless they start with `specs/` or `CLAUDE.md`.

- [x] T041 [US8] In `src/components/header-menu-shared.tsx` export `MenuIcon`: `function MenuIcon() { const theme = useTheme(); return <Entypo name="dots-three-vertical" size={ICON_SIZE} color={theme.tint} />; }`, with a short doc comment (the one drawing of the dots, used by both platforms). Make `MenuDots` render `<MenuIcon />` in place of its inline `<Entypo … />`, so Android's look and behaviour are unchanged. Keep `ICON_SIZE` and the module-level `Entypo.loadFont().catch(…)` exactly where they are: `header-menu.ios.tsx` already imports from this module, so the font now preloads on the iPhone too. Rewrite the last paragraph of `MenuDots`' doc comment, which says iOS "does not use it" and why: iOS now uses `MenuIcon` but not `MenuDots`, because it needs no accessibility element of its own (the native label under the icon is the accessible one, T042).
- [x] T042 [US8] In `src/components/header-menu.ios.tsx` (after T041). **Done, with one correction:** `StyleSheet.absoluteFillObject`, which step 2 names, does not exist in this React Native (0.86), and `tsc` said so; the `icon` style spells out `position: 'absolute'` and the four edges instead.
  1. **Label** — keep SwiftUI's `Image systemName="ellipsis"` as the `Menu`'s `label`, but make it an invisible, full-box tap target: drop its `size`, `color` and the `rotationEffect(90)` modifier, and set `modifiers={[opacity(0), frame({ width: MENU_BUTTON.width, height: MENU_BUTTON.height }), contentShape(shapes.rectangle()), accessibilityLabel(unread ? \`${t.common.menu} •\` : t.common.menu)]}`. Imports: add `contentShape`, `opacity`, `shapes` to the `@expo/ui/swift-ui/modifiers` import and remove `rotationEffect`. Do **not** use `hidden()`, and do **not** put a React Native view (`RNHostView`, `MenuDots`) inside the label: that is the T033 fault.
  2. **Icon** — inside the existing fixed 40 x 44 `box` `View`, after the `Host` (so it is drawn above it) and before `MenuBadge`, add `<View style={styles.icon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><MenuIcon /></View>`, importing `MenuIcon` from `@/components/header-menu-shared`. Add to the local `StyleSheet` `icon: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }` (the form `MenuBadge` uses), so the icon takes no touch and the tap reaches the native label under it, and so VoiceOver reads one element ("More"), not two. No inline style object.
  3. **Unchanged** — `Host matchContents ignoreSafeArea="all"`, the `Menu`'s rows (`Button`, `systemImage="circle.fill"` and `tint(theme.danger)` for a row with news, `router.push(item.href)`), the empty-list `return null`, the fixed `box`, `MenuBadge` and the `HeaderMenuItem` re-export.
  4. **Doc comment** — rewrite it: the picture is React Native (Entypo, the same as Android) and the control is native and invisible under it; the system menu is anchored to its own label, so it opens below the dots and nothing hosted is inside the label to move; why `opacity(0)` and not `hidden()`; why `contentShape` (the frame, not the glyph, takes the tap); and delete the sentence saying there is no `contentShape` modifier.
- [x] T043 [P] Verify, in `expo-client/german-world-club`: `npx tsc --noEmit` (clean: it type-checks `opacity`, `contentShape(shapes.rectangle())` and `MenuIcon`); `npx expo lint src/components` (no error in the touched files; `handle-form.tsx` is the one that remains and is not touched); `npx expo export --platform ios` and `--platform android` (both succeed; the Entypo font is in both). Then render the real `header-menu.ios.tsx` through `react-native-web` in headless Chrome with `@expo/ui/swift-ui` and `…/modifiers` stubbed (`Host`, `Menu`, `Image`, `Button` as plain elements that record their props) and check the **structure**: the icon's wrapper is after the `Host` in the 40 x 44 box, has `pointer-events: none` and is centred in it to within 1 px; the label stub received `opacity(0)`, a 40 x 44 `frame` and `contentShape`; the badge is present only when a row has `dot`; an empty list renders nothing. This shows the layering, not that a tap reaches the native label or where the menu opens; say so in the result, as T031 and T035 did. **Result:** `tsc --noEmit` clean (after the correction in T042); `expo lint` on the two touched files clean, and on `src/components` only the known `handle-form.tsx` error; `expo export` for `ios` and `android` both succeed and both contain the 66,200-byte `Entypo.ttf` (the installed font's size) and the `dots-three-vertical` glyph name. Render (real `header-menu.ios.tsx` and `header-menu-shared.tsx` through `react-native-web` in headless Chrome, with `@expo/ui`, the theme, strings, router and the Entypo font stubbed): the box is 40 x 44; the icon's wrapper covers the box exactly and comes after the `Host`; the glyph is centred to 0 px; the label stub received `opacity(0)`, `frame(40 x 44)`, `contentShape(rectangle)` and the label "More" ("More •" with news); the badge exists only for a row with news and takes no touch; an empty list renders nothing; and a tap at the centre and at both corners (2 px in) lands on the native label, not on the icon. **Counter-assertion:** with the icon's `pointer-events` class removed the same tap lands on the icon, and it returns to the label when restored (an inline `pointer-events: auto` does nothing, because `react-native-web` marks `none` as `!important`). **Not shown:** that UIKit gives the tap to the SwiftUI label, whether an `opacity(0)` label opens the menu, and which side the menu opens on (T045).
- [x] T044 [P] Update the docs to match: `specs/039-profile-activity-tabs/spec.md` (add US8 scenario 7: on an iPhone the dots are Entypo's `dots-three-vertical`, the same drawing as Android's, and the menu opens below them; add FR-025: the dots MUST be the same Entypo icon on both platforms, and on iPhone it MUST be a React Native view laid over, never inside, the native menu's label; rewrite the assumption that says iPhone uses the `ellipsis` symbol and "does not use Entypo", and add to the assumption about the first phone test that the follow-up request moved the iPhone to Entypo with a transparent native label, which is untested until T045); `specs/039-profile-activity-tabs/plan.md` (rewrite the iOS bullet of item 2, the label sentence and the "iPhone keeps its native `ellipsis` symbol… that has not been done" sentence of the icon note, and say `contentShape` exists in 57.0.20); and the `CLAUDE.md` sentence about the iOS label (the "On iOS the menu's label is a native SF Symbol" sentence): now the same Entypo icon, a React Native view over an invisible native `Image` that is the `Menu`'s label, still never hosted inside it with `RNHostView`.
- [ ] T045 On an iPhone (the development build must have `@expo/ui`'s `Menu`; see T040), in Marketplace and Threads, light and dark: the dots look like Android's; a tap on the **edge** of the 40 x 44 box, not only on the glyph, opens the menu; the dots do not move, jump or resize when tapped; **the menu opens below the dots and not over them**; the red badge is still at the corner and does not stop a tap; a row opens its screen after the menu closes; VoiceOver reads one button, "More" (and "More •" with news), never two. **If the menu does not open from the invisible label**, the cause is hit-testing: first try `opacity(0.01)` in place of `opacity(0)`; if that does not open it, restore T033's label with `git show b5e0059:expo-client/german-world-club/src/components/header-menu.ios.tsx` and report that one look on both platforms needs a native icon on Android instead (the plan's `@expo/ui/jetpack-compose` `IconButton` with the `more_vert` symbol). **If it opens but still covers the dots**, report which iOS version and whether the header was under a notch; there is no placement option to change in this version. **Needs a device; not done here.**

**Checkpoint**: the dots are one drawing on both platforms, and the iPhone's menu is still the system's own, anchored to the dots.

---

## Dependencies and order

```
T001 ─► T002 ─► T003 ─► T004 ─┬─► T005 (Profile) ─┐
                              └─► T006 ─► T007 ───┴─► T008, T009 ─► T010

Header (Phase 7), independent of the above:
T011, T012 ─► T013, T014 ─► T015, T016, T017, T018, T019 (a tab each) ─► T020, T021 ─► T040
T014 ─► T023;  T015 ─► T024  (dots, and how screens open)  ─► T025, T026 ─► T040
T027 ─► T028, T029 (one file per platform) ─► T030 ─► T031, T032 ─► T040  (the native menu)
T033 ─► T034 ─► T035, T036 ─► T040  (after the first phone test: the iPhone label is native)
T037 ─► T038, T039 ─► T040  (Android's dots are Entypo)
T041 ─► T042 ─┬─► T043 ─┐
              └─► T044 ─┴─► T045  (the iPhone's dots are Entypo too; the menu opens below them)
```

- T005 can only be released after T004: the posts must have a new home before the old one goes.
- T006 is done while T003 is written (it is the same file); T007 needs T003, T004 and T006.
- T015 to T019 each touch a different tab and need T013; T015 and T016 also need T014, because they are the two screens that have actions. T017 to T019 are one line each and can run together.

## Implementation strategy

1. **MVP = T001 to T005 together.** Moving is one change: adding the tabs to Activity without removing them from Profile would leave two lists, and removing them from Profile without adding them leaves none.
2. T006 and T007 keep the old behaviour honest; T008 to T010 are the gates.
3. **Phase 7: MVP = T011 to T015** (the Marketplace, the screen first asked for, with the header and the drop-down); T016 to T019 then give each other tab the same header, one tab at a time, so any one can be left out without breaking the rest. T020 and T021 are the gates; T022 needs a device.
4. **Phase 7, second pass: T023 and T024 are independent of each other** (a component, a layout) and can go in either order; T025 and T026 check and record them; T040 is the one thing that needs a device.
5. **Phase 7, third pass (the native menu): T027 first, because both platform files use it; T028 and T029 are separate files and can go together; T030 retires the `Modal` once both exist.** T031 and T032 check and record it; T040 is the one thing that needs a device, and the first thing it should settle is whether the installed development build has `@expo/ui`'s `Menu`.
6. **Phase 7, fourth pass (after the first phone test): T033 and T034 are one change in two files, and T033 needs the exports in T034, so do T034 first.** T035 and T036 check and record it. The Android menu is not touched; whether it needs the same treatment is the first Android question T040 should answer.
7. **Phase 7, fifth pass: T037 is one change (a dependency and one component), then T038 and T039.** It touches Android's trigger only; the iPhone's label stays the native symbol, so T040 should look at the two dots side by side.
8. **Phase 8, sixth pass (Entypo on the iPhone, the menu below): T041 first, because T042 imports `MenuIcon` from it; then T042, which is the whole change.** T043 and T044 are separate files and can go together. T045 is the one thing that needs a device, and it decides two things nobody can see from here: whether an invisible native label takes taps, and whether the system opens its menu below it. Android is not touched beyond `MenuDots` reading the icon from `MenuIcon`, so its look and behaviour must not change (T045 is for the iPhone; T040 still covers Android).
