# Quickstart: validating the Marketplace "New listing" panel

Behaviour is pinned in [contracts/ui-contract.md](./contracts/ui-contract.md). This guide
says how to see it.

## Prerequisites

```bash
npm run -w server migrate
npm run -w server seed:demo        # development only
npm run -w server dev
npm run -w client dev              # web
cd expo-client/german-world-club && npx expo start   # app (dev client)
```

Accounts (password `demo-member`):

- **Can post**: `demo.nomobile@demo.invalid`, which has `marketplace_post` in the current
  local seed. The flag is random per seed, so confirm with
  `SELECT email FROM members WHERE (permissions->>'marketplace_post')::boolean AND status = 'active'`.
- **Cannot post**: `demo.active@demo.invalid`, which has no flag in the current local seed.
  Confirm the same way.

## Automated checks

```bash
npm run -w client test             # marketplace.test.tsx, marketplace-compose.test.tsx, drawer test
npm run -w client test:i18n        # new web keys in de and en
npm run -w server test -- marketplace   # LISTING_MEDIA_MAX import; media cap unchanged
npm run -w expo-client/german-world-club typecheck   # contracts types + de/en catalogue parity
npm run -w expo-client/german-world-club lint
```

Expected: all green. The web suites must include the counter-assertion that a member without
`marketplace_post` gets **no** New listing button, not a disabled one.

## Web scenarios (`/konsole/mitglied`)

1. As the poster at 1280×800: the header shows **New listing** at the top right, and the first
   listing is visible without scrolling (SC-001).
2. Press New listing: the panel slides in from the right and the page dims. Tab cycles inside
   the panel.
3. Type a title, press Escape, and reopen: the title is still there. Focus returned to the
   button on close.
4. Publish with one photo and alt text: the panel closes, "Listing published." shows, and the
   listing tops the list.
5. Turn on reduced motion (OS setting or DevTools rendering emulation) and open the panel: it
   appears without sliding.
6. Narrow the window to 375 px: the panel is full width and there is no horizontal scroll.
7. As the non-poster: there is no button. `POST /marketplace/listings` from DevTools still
   returns 403 (server unchanged).

## App scenarios

1. The tab bar reads Threads, Marketplace, Activity, Events, Profile.
2. Apply the same category and mode filters on the app and the web for the same member: the
   lists match (SC-003).
3. As the poster, tap **New listing** (top right). On **Android** the screen slides in from
   the right (`slide_from_right`). On iOS it is the standard push from the right. Hardware
   back or the swipe closes it.
4. Add a photo, leave its description empty, and publish: the alt-text message appears and
   nothing is sent (no `api POST /marketplace/listings` line in the Metro log).
5. Publish properly: you return to the list and the new listing is there.
6. Revoke the flag
   (`UPDATE members SET permissions = permissions - 'marketplace_post' WHERE email = '…'`),
   switch tabs and come back: the button is gone.
7. Open a listing from the list, and open one from an Activity notification: both show the same
   detail screen.

## Strings

New keys, each in both catalogues:

- **Web** (`client/src/i18n/{de,en}.ts`, `memberMarketplace`): `newListing`, `close`.
- **App** (`src/i18n/{en,de}.ts`): `tabs.marketplace`, and a `marketplace` namespace mirroring
  the web's `memberMarketplace` compose and browse keys that the app uses (titles, field
  labels, categories, modes, contact methods, terms, media, publishing, empty, load-failed),
  plus `newListing`.
