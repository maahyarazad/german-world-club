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

## Addendum: the same header on every tab

### Why a custom header

The native header cannot do this on iOS: Expo Router's own documentation for `headerTitleAlign` says it is "not supported on iOS. It's always `center`". So each tab's stack uses the stack's supported `header` option, which replaces the native header with one drawn here. It draws what the native one drew (back button, title, hairline) at the same height, with the navigation theme's colours, and the edge-swipe back is unaffected because it belongs to the screen.

### Design

1. **`components/app-header.tsx`**: `AppHeader`, `HEADER_BAR_HEIGHT` and `renderAppHeader`, in three columns in one row. The left and right columns take equal flexible space and the emblem sits between them with a small gap, so it is centred whatever is in them (a fixed-width centre between two equal columns). The title is the screen's own `options.title`, 16 pt, one line, ellipsis. The right column renders the screen's `options.headerRight`. Height: `HEADER_BAR_HEIGHT` (44 iOS, 56 Android) plus the top inset; the emblem is 28 pt tall, so it cannot change the height. The back button is a chevron drawn from two borders of a rotated square, in the theme's tint (no icon font, no image). `renderAppHeader` is declared once so React sees the same function on every render.
2. **The three dots' menu is the platform's own, through `@expo/ui`.** `HeaderMenu({ items })` takes rows as data and has one file per platform, so a screen decides which rows its member may use and the menu knows nothing about Marketplace or Threads:
   - `components/header-menu-shared.tsx`: `HeaderMenuItem` (`key`, `label`, `href`, `dot?`), `MENU_BUTTON` (the 40 x 44 tap area), `MenuDots` (Android's trigger: Entypo's `dots-three-vertical` from `@expo/vector-icons` in the theme's tint, 22 pt in the 40 x 44 box, with the unread badge; a plain view with no `onPress`, because the menu's own tap handling goes around it; the font is preloaded with `Entypo.loadFont()` when the module is imported, because an icon font draws nothing until it has loaded), `MenuBadge` (the red dot, which takes no touch) and `openHeaderMenuItem`.
   - `components/header-menu.ios.tsx`: `Host matchContents ignoreSafeArea="all"` around SwiftUI's `Menu` from `@expo/ui/swift-ui`, inside a fixed 40 x 44 React Native box. The `label` is **native**: SwiftUI's `Image` of the `ellipsis` symbol (`size` 20, the theme's tint), turned 90 degrees by `rotationEffect(90)` so the dots are a column, in `frame(40 x 44)` so the tap area is the box, with an `accessibilityLabel`. Rows are `Button`s that `router.push`. A row with news has `systemImage="circle.fill"` and `tint(theme.danger)`: the system menu draws an item's symbol beside its label and honours `tint` for it and nothing else about an item's colour. The unread badge is **not** in the label: `MenuBadge` is laid over the box with `pointerEvents: 'none'`.
     - *Why the label is native (after the first phone test).* The first version put our React Native dots in the label through `RNHostView`, as the SwiftUI Menu page's "React Native label" example does. On a phone the menu opened **over** the dots and the dots **moved** when tapped. A hosted view is a UIKit view that SwiftUI sizes and lays out, and that the system animates the menu out of, so it is the one part that both faults have in common. A native label is the case SwiftUI's `Menu` is built for: the system knows its frame and opens the menu under it, and there is no hosted view to move. This is a reasoned fix, not a measured one: a web search found no documented cause, and it cannot be shown without a phone.
     - *Not `buttonStyle('plain')`.* The Menu page suggests it to keep a custom label as the whole trigger, but in SwiftUI that style makes only the drawn pixels tappable, which here would be three small dots, and this package has no `contentShape` modifier to widen it. The default style keeps the whole 40 x 44 frame tappable.
   - *The icon, and the dependency.* `@expo/vector-icons` (`^15.0.2`, installed 15.1.1 by `expo install`) is new to the app. It is JavaScript plus a font file and loads the font through `expo-font`, which the app already links, so it adds no native module and no build of its own. The glyph names were read from the installed font map (`dots-three-vertical` and `dots-three-horizontal` exist). iPhone keeps its native `ellipsis` symbol: the hosted-view fault above is why an Entypo view cannot be the label there. If one look on both platforms is wanted, the way to get it without hosting a view in the label is to draw the Entypo icon outside the menu and lay a transparent native `Menu` over it as the tap target; that has not been done, because how a transparent native label behaves for hit-testing and placement is untested.
   - `components/header-menu.android.tsx`: `MenuView` from `@expo/ui/community/menu` (the drop-in on the second page): a Compose `DropdownMenu` anchored to a `Pressable` it wraps around `MenuDots`, which is why `MenuDots` has no `onPress`. Rows are `actions` with the item's `key` as `id`, and `onPressAction` calls `openHeaderMenuItem`. An item's icon has to be an image source on Android (a string is an iOS symbol name and is ignored), so a row with news ends its label with a dot instead. Android is unchanged by the fix above: its trigger is still our dots, wrapped by `MenuView` in a `Pressable`, because nothing was reported there. If it shows the same faults, the next step is to stop using `MenuView` and build the trigger from `@expo/ui/jetpack-compose` directly (`DropdownMenu` with an `IconButton` and the `more_vert` Material symbol), which is a native icon like the iOS one.
   - `components/header-menu.tsx`: what any other target resolves to, and the file TypeScript reads for `@/components/header-menu`. It draws nothing: `@expo/ui` has no menu on the web, and importing its native views would stop a web bundle building.

   **What was read.** The two pages named in the request are the latest docs (SDK 58); the app is on SDK 57 with `@expo/ui` 57.0.20. So the installed package's source and types were read: `./community/menu` exists in 57.0.20, its iOS file is the SwiftUI `Menu` with an `RNHostView` label that the first page shows, and its Android file is the Compose `DropdownMenu`. `Host`, `Menu`, `Button`, `RNHostView` and the `tint` modifier were checked in the installed types.

   **Why not the first version's `Modal`.** It drew a card by hand, so it needed the offset maths (inset plus bar height) and `statusBarTranslucent` on Android to put the card in the right place, and on iOS a wait for the modal's `onDismiss` before a push. None of that is needed now: the system places the menu, and it is not a view controller the way React Native's `Modal` is, so a screen pushed from a row is not at risk of being dropped. The system menu also brings its own accessibility, its own animation and, on iOS 26, its glass.

   **Native build.** No new dependency: `@expo/ui` is in `package.json` from the app's first commit, so it is autolinked into every build, and the local `ios/` project has `ExpoUI 57.0.20`. A development build made from an earlier patch of it may lack `Menu` or `RNHostView`; that would need a rebuild, and the version on a phone cannot be seen from here.
3. **Each tab's `_layout.tsx`** (`threads`, `marketplace`, `offers`, `events`, `profile`): `screenOptions={{ header: renderAppHeader }}`, replacing `headerBackButtonDisplayMode: 'minimal'` (which only the native header reads) and, in Marketplace, the small-title code.
4. **`marketplace/index.tsx`** passes Messages, My listings and New listing as rows (the last two only when `canPost`); **`threads/index.tsx`** passes New post, and its tint-coloured text style is gone.
5. **`assets/gwc-logo-header.png`** (217 x 120, 52 KB): `gwc-logo.png` cropped to the mark, with the white background made transparent by flood fill from the border (the white inside the rings stays, as designed). Checked on light and dark.
6. **Strings**: `common.menu` ("More" / "Mehr") and `common.back` ("Back" / "Zurück"). No new colour constant: an earlier dim for the pop-up was removed with the dimming.

7. **`marketplace/_layout.tsx`: how a screen opens.** `PUSH_ANIMATION`, set once in the stack's `screenOptions.animation`, and the two per-screen `animation: 'slide_from_right'` (New listing, Edit listing) removed. What react-native-screens 4.26.2 does (read in `node_modules`, not assumed):
   - iOS: `default` is the navigation controller's push; `slide_from_right` resolves to it.
   - Android 13 and later: `default` is `rns_default_enter_in` for API 33, an alpha 0 to 1 over 83 ms after 50 ms and a translate from 10% to 0 horizontally, and the old screen translates 0 to -10%: Material's shared axis X, which is the transition in the request.
   - Android 12 and earlier: `default` is a zoom (scale 0.85 to 1 with a fade), not horizontal. So `PUSH_ANIMATION` is `slide_from_right` there, and `default` everywhere else.
   - `slide_from_right` (`rns_slide_in_from_right`) moves the whole width in the medium animation time and has no fade, so it was right for neither rule.
   This supersedes feature 017's R6 (`slide_from_right` for New listing). A transition of our own (a real shared axis on Android 12 and earlier) would be a custom Android animation resource: native code and a new build, which this branch does not do.

### Not in scope

`(organisation)` (merchant and partner), `(applicant)`, `(profiling)` and `(public)` are not tabs and keep their native headers.

### Verification

- **Types and lint**: `tsc --noEmit` is clean; lint has no error in a file this branch touched (the ones that remain are in files it does not touch, e.g. `handle-form.tsx` and `profile/devices.tsx`).
- **Bundles**: `expo export` succeeds for iOS and for Android, and both contain the `@expo/ui` menu code. That proves the platform files resolve and the imports exist in 57.0.20.
- **In a browser** (`react-native-web`, router theme, safe area and image stubbed): the header on seven variants (short, long German, back-only, Threads, Offers, with and without back), light and dark, title left and the emblem at the same centre, and the three dots as a column with the unread badge. A browser has no SwiftUI or Compose, so the menus themselves are not shown here.
- **Read, not run**: the installed `@expo/ui` 57.0.20 source for `Menu`, `Host`, `RNHostView`, `Button`, `tint` and `MenuView` (iOS and Android), and react-native-screens 4.26.2's Android animation resources for the transitions in item 7.
- **Not done here**: a real iPhone or Android phone. That means the native menus (look, placement, the red dot on a row, a tap on a row opening its screen), the transitions, the edge-swipe back, the bar under a notch and inside an iOS sheet (the Threads and Profile screens that open as `presentation: 'modal'`), and whether the installed development build has `Menu` and `RNHostView` at all.
