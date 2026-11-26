# Quickstart: validating Marketplace Listing Management

This is a run and validation guide. Implementation detail belongs in `tasks.md`.

## Prerequisites

```bash
npm install
npm run -w server migrate        # applies 048_marketplace_listing_management.sql
npm run -w server seed:demo      # members, staff and a marketplace corpus; prints a credentials table
npm run -w server dev
npm run -w client dev            # web console
```

The app: follow the Expo SDK 57 docs in `expo-client/german-world-club/AGENTS.md`. No new native module is added, so an existing development build is enough.

Sign in with a member and a staff account from the `seed:demo` table (staff needs the `marketplace_moderation` grants; a superadmin has them). In development the SMS and email codes are printed in the server terminal.

## Automated checks

```bash
npm run -w server test -- tests/marketplace      # includes the new edit, publish, concurrency and staff suites
npm run -w client test                            # includes the loading-state scan and i18n parity
npm run -w client test:i18n                       # catalogues agree in both directions
npx tsc --noEmit -p packages/contracts && npx tsc --noEmit -p client
npm test                                          # every workspace, incl. expo-client lint (no inline styles)
npm run -w server verify:seo                      # /marktplatz still aggregate-only
npm run -w server test -- tests/media/app-upload-shape.test.ts   # a slow phone upload is accepted (bugs B1 to B3)
npm run -w server test -- tests/media/unsupported-type.test.ts   # HEIC is refused with a typed problem (bug B4)
npm -w packages/contracts exec vitest run                         # sniffImageType and the accepted types
```

The server DB suites read `DATABASE_URL`. Point them at a scratch database, not the dev one: they `TRUNCATE` members and listings.

The SQL suites skip loudly without a database; a skip is not a pass.

## Scenario 1: edit a listing (spec US1)

1. As member A, open Marketplace, then My listings, then pick an active listing and choose Edit (web drawer).
2. Change the title and price, save. Expected: saved, the list shows the new title.
3. As member B, find the listing in browse. Expected: new values, old ones nowhere.
4. On the app (member A), open the same listing in My listings. Expected: the same values. Change the price there. Expected: web shows it after reload.
5. As member B, call `PATCH /marketplace/listings/<A's id>`. Expected: 404 identical to an unknown id.
6. Mark A's listing sold, then open it. Expected: no Edit control; the API answers `409 marketplace/not-editable`.

## Scenario 2: Publish checkbox (spec US2)

1. As member A, create a listing with Publish unchecked, on web and again on the app. Expected: it appears under My listings as a draft.
2. As member B: it is absent from browse, search and its direct link, and `/marktplatz` counts do not include it.
3. Edit it, check Publish, save. Expected: B sees it on the next request and the public count rises by one.
4. Uncheck Publish, save. Expected: gone for B again; a conversation B already started about it is still readable.
5. Open the listing from the other platform with a stale form and save. Expected: `409 conflict`, "Listing changed, reload"; nothing overwritten.
6. Counter-check: an old client posting without `publish` still gets a visible listing.

## Scenario 3: staff browse and disable (spec US3)

1. As staff, open Admin, Marketplace, All listings. Expected: listings in every state, newest first, no merchant offers, no contact details.
2. Filter by state `draft`, by category, by owner, and search a title fragment. Expected: only matches.
3. Disable a published listing with a reason. Expected: member B no longer sees it on the next request; the owner sees it as disabled with the Publish control off and explained.
4. As the owner, try `PATCH` with `published: true`. Expected: `409 marketplace/not-editable`.
5. Enable it. Expected: back to `active`.
6. Disable a **draft**, then Enable. Expected: it returns as a draft, not published.
7. Sign in as staff without `marketplace_moderation` read. Expected: refused on the page and the endpoint.
8. Look in the audit log. Expected: an entry for each disable and enable with actor, time, reason, and the correct `statusFrom`/`statusTo`.

## Pass criteria

All commands above exit 0 and the three scenarios behave as written. These map to the spec's success criteria:

| Spec | Verified by |
|---|---|
| SC-001, SC-006 | Scenarios 1 and 2 on web and app |
| SC-002, SC-003 | Scenario 2 steps 2 to 4 and `publish.test.ts` |
| SC-004 | Scenario 3 steps 1 to 3 |
| SC-005 | Scenario 3 step 8 and `moderation-origin.test.ts` |
| SC-007 | `staff-listings.test.ts` (no merchant offer) |

## Scenario 4: listing photos save from the app (spec US4)

1. On the app, open Marketplace, then New listing. Fill the form, add two photos with a description each, leave **Publish** on, and tap Publish listing.
2. Expected: the club loader shows with a whole-number percentage ("Uploading … 42 %"), and "File 1 of 2", then "File 2 of 2". The percentage covers both files together and never goes backwards.
3. Expected: the screen closes; the listing is in the list; open it on the web: both photos are there, in order.
4. Repeat on a slow connection (airplane mode toggled mid-upload, or Network Link Conditioner at 3 Mbps). Expected: a photo that takes more than 8 seconds still saves; if one fails, the listing is kept, that photo is marked Failed, and Retry sends only it.
5. Tap Cancel during an upload. Expected: the listing is kept, the remaining photos are marked Failed, Retry uploads them.

## Scenario 5: the avatar updates from the app (spec US5)

1. Profile, Edit profile, Change profile picture, pick a photo.
2. Expected: the loader with a percentage next to the picture; Change and Remove are disabled while it runs.
3. Expected: the new picture shows in the header, on the profile and on the web.
4. Cancel mid-upload, or drop the connection. Expected: the old picture is untouched and Try again is offered.

## Scenario 6: Threads media post from the app (spec US6)

1. Threads, compose a post, add two photos with descriptions, Post.
2. Expected: the loader with one percentage for both ("File 1 of 2", then "File 2 of 2"), then the post appears with both photos, here and on the web.
3. Cancel mid-upload. Expected: nothing is posted; the text and both photos are still on screen.
4. Retry after a failure. Expected: photos that already reached the server are not sent again.

## Scenario 7: members edit with no special permission (clarification)

Sign in as a member with no permission flags (a plain `seed:demo` member). Expected: My listings and Edit are offered on web and app, and editing works. There is no setting that turns it on.

## Scenario 8: iPhone photos upload (spec US7, bug B4)

Needs an iPhone whose camera format is **High Efficiency** (Settings, Camera, Formats), which is the default, so photos are HEIC.

1. Take a photo, then in the app add it to a **new listing**, to your **avatar**, and to a **Threads post**. Expected: each uploads on the first try, the loader shows a percentage, and the photo shows on the web too (it arrives as JPEG).
2. Do the same as a **merchant** for the store cover, the gallery and an offer photo. Expected: the same.
3. Pick **three photos at once** for a listing, one of them a HEIC taken earlier. Expected: all three are added (this is the multi-select path that used to send raw HEIC).
4. On an **Android** phone that stored a HEIC (or a file picked from storage), or with a TIFF on either platform: Expected: before anything uploads, the message says that kind of file cannot be uploaded, names the formats that can, and for an iPhone points to Settings, Camera, Formats, Most Compatible. Nothing is added and no upload starts. A mixed pick adds the good photos and names the bad one.
5. Look in the server log for `upload refused: unsupported media type` while doing step 4 with a file renamed `.jpg` that is really HEIC. Expected: one line with `detectedType: "image/heic"` and a byte count, and no file name.
6. Counter-check on the **old** behaviour: with the picker's `preferredAssetRepresentationMode` removed in `src/lib/pick-media.ts`, steps 1 and 3 fail with the unsupported-format message. This proves the setting is what fixes it, not luck.
