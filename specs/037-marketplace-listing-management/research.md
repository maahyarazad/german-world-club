# Research: Marketplace Listing Management

Findings are from reading the current code, not from outside sources. No external research was needed.

## What already exists (so we do not rebuild it)

- `PATCH /marketplace/listings/:id` edits fields and category-specific details, owner-only, 404 for anyone else. **It never checks the listing's state**, so today a `hidden`, `sold` or `withdrawn` listing can be edited by its owner.
- `POST /marketplace/listings/:id/state` moves `active` to `sold` / `filled` / `withdrawn`, and nothing else. It refuses `active`, `draft`, `hidden` and `expired`.
- `createListing` always inserts `state = 'active'` with `published_at = now()`. The `draft` enum value and the `CHECK (state <> 'active' OR published_at IS NOT NULL)` exist but nothing writes a draft.
- `hideListing` works only from `active`. `restoreListing` always returns to `active`.
- The `marketplace_no_new_job_offer` trigger already refuses `draft` to `active` for a job offer.
- Staff routes (`/admin/marketplace/*`) are gated on module `marketplace_moderation` (`read`, `status`, `delete`). There is no list endpoint; staff reach a listing from a report.
- Neither client calls `GET /marketplace/mine`. Neither has an own-listings or edit screen.
- Media is attached after the listing exists, through `POST /marketplace/listings/:id/media` and `DELETE …/media/:assetId`.

## Decisions

### R1. No new lifecycle state

- **Decision**: "Published" is `active`. "Unpublished" is `draft`. "Disabled" is `hidden`.
- **Rationale**: the three states already exist in the enum, indexes (`WHERE state = 'active'`), browse, expiry job, summary counts and the job-offer trigger. Every one of those already treats non-`active` as invisible, which is exactly what spec FR-007, FR-012 and FR-017 need.
- **Alternatives**: a separate `is_published` boolean. Rejected: it would create two ways to be invisible and every read would need a second predicate. That is how a hidden post comes back through a side door.

### R2. Publish checkbox on create is `publish`, default `true`

- **Decision**: `CreateListingRequest.publish?: boolean`. Omitted means `true`. `false` inserts `state = 'draft'` and `published_at = NULL`.
- **Rationale**: every existing client and test posts without the field and expects an immediately visible listing (FR-018). The new forms send it explicitly.
- **Alternatives**: default `false`. Rejected: it silently changes behaviour for old app builds still in the field.
- **Notes**: a draft counts against the 20-listing quota, as today's reservation happens at insert. A member cannot park unlimited drafts.

### R3. The checkbox is a field of the edit request, not a separate endpoint

- **Decision**: `PATCH /marketplace/listings/:id` accepts `published?: boolean` and a required `version`. Field changes and the publish change commit in one transaction and bump `version` once.
- **Rationale**: on the form the checkbox is saved together with the fields. Two requests could leave a listing with the new text published and the old flag, or the reverse, if one failed. One transaction removes that.
- **Alternatives**: a `POST …/publication` endpoint. Rejected for that reason. `OWNER_TRANSITIONS` also stays terminal-only, which is its documented invariant ("a sold listing is not re-posted").
- **Rules**:
  - `draft` to `active`: set `published_at = COALESCE(published_at, now())` and `state_changed_at`; refuse if `expires_at` is in the past (the member must pick a new expiry in the same save).
  - `active` to `draft`: allowed; existing conversations stay (messages reference the listing softly).
  - `expired` plus `published: true` plus a valid new expiry (or null): back to `active`.
  - `hidden`: `published` is refused (spec FR-008).
- **Audit**: publish and unpublish write `marketplace_listing_state_changed` with `statusFrom`/`statusTo`, after commit, as `transitionState` already does. Plain field edits are not audited, as today.

### R4. Which states are editable

- **Decision**: `draft`, `active`, `expired`. A new `EDITABLE_STATES` constant in `@gwc/contracts/marketplace`. Any other state answers `409 marketplace/not-editable`.
- **Rationale**: spec FR-003. Sold, filled and withdrawn are terminal ("a new listing is posted instead"). `hidden` belongs to staff.
- **Existing gap closed**: the current PATCH has no state check at all. This is a behaviour change for the three terminal states and for `hidden`; it is the intended one, and the test pins it.
- **Ownership first**: not-yours and absent stay one 404. The 409 is only ever seen by the real owner.

### R5. Concurrency: version token = `updated_at` at microsecond precision

- **Decision**: reuse feature 028's pattern. `version` is `updated_at` formatted by the database (a JS `Date` keeps only milliseconds). The edit loads the row `FOR UPDATE`, compares, and a mismatch is `409 CONFLICT` with a message telling the member to reload.
- **Rationale**: it already exists and is understood; the 028 notes explain why ms precision is not enough.
- **Media**: attach and detach do **not** bump the version. Each is its own atomic operation on a different table, and a media change is not a field overwrite. Bumping would make the form stale after every photo.
- **Alternatives**: last write wins. Rejected by spec FR-009 and the "two devices" edge case.

### R6. Staff disable = existing hide, extended

- **Decision**: keep `POST /admin/marketplace/listings/:id/hide|restore`. Hide now accepts `draft` or `active`. Add `hidden_from_state` so restore returns to where the owner left it, and a draft is never published by a restore (spec FR-013).
- **Legacy rows**: existing `hidden` rows have `hidden_from_state = NULL`; restore treats NULL as `active`, which is what they did before.
- **Rationale**: the same endpoints, permission (`status`), audit actions and tests keep working. The word "Disable" is a label only.
- **Alternatives**: a new `disabled` state. Rejected: duplicates `hidden`, which already means "moderation took it off display and the owner can see why".
- **Hide of `expired`/terminal states** stays refused: they are already not visible.

### R7. Staff browser = one new GET, keyset-paged

- **Decision**: `GET /admin/marketplace/listings?state=&category=&ownerId=&q=&cursor=&limit=` on `marketplace_moderation.read`. Order `created_at DESC, id DESC`. Returns explicit columns and the owner's display name; never email, phone, legal name or the contact value.
- **Rationale**: matches the browse pagination style; no OFFSET so it stays flat at 50k rows. Merchant offers live in their own tables, so they cannot appear. `q` is a case-insensitive substring on title, with `%`/`_` escaped; at this scale a seq-scan filter on an already-narrowed page set is acceptable, so no trigram index is added now.
- **Index**: one partial-free index on `(created_at DESC, id DESC)` already exists for `active`; the staff list covers all states, so a plain `(created_at DESC, id DESC)` index is added.
- **History**: the spec's "content and history" is met by showing `stateChangedAt`, the current state, the origin state and the listing's reports. The moderation reason lives in the audit log, whose viewer is a different permission. The page does not read it. If staff want the reason inline, that is a follow-up needing a column, not this feature.

### R8. Owner read of a listing in any state

- **Decision**: new `GET /marketplace/mine/:id` returning the full listing (details, features, media, `version`, `canEdit`, `canPublish`, `moderated`) for the owner in any state; 404 otherwise.
- **Rationale**: `GET /marketplace/listings/:id` is the visibility rule (active only); widening it for owners would put a second branch in the one place that must stay simple. The edit form needs a full prefill, and `/marketplace/mine` returns summaries only.
- **`moderated`**: a boolean, true when state is `hidden`. The owner is told it was taken down, never by whom or why from this route.

### R9. UI approach

- **Web**: extend `ComposeListing` with an edit mode (prefill, `version`, Publish checkbox) in the existing right-edge drawer, and add a "My listings" tab. Staff get an "All listings" tab beside the report queue in `console/admin/Marketplace.tsx`.
- **App**: add `marketplace/mine.tsx` and `marketplace/edit/[id].tsx`; `new.tsx` gains a Publish switch. Edit reuses `listing-field.tsx` and `date-parts-field.tsx`. Reading the SDK 57 docs (AGENTS.md) is a precondition for writing any Expo code in tasks.
- **Rules to follow**: `useThemedStyles`/`StyleSheet.create`, `ScreenLoader`/`PageLoader` while loading (never a false empty list), `useAction` for submit, `console.error('<Component>.<fn>', error instanceof ApiError ? error.problem : error)` on failure with no error state, strings in both catalogues.
- **Native**: no new package, no config change, so no new EAS build.

### R10. Tests that must exist

Behaviour, with counter-assertions:

- A draft is absent from browse, detail, `/marktplatz` counts and the sitemap; publishing it makes all four show it, and unpublishing removes it again.
- Another member's PATCH or `mine/:id` is a 404 identical to an unknown id (status, body, headers).
- Each non-editable state answers 409; `draft`, `active` and `expired` succeed.
- Stale `version` is 409 and writes nothing; a fresh one succeeds.
- Hide from a draft, then restore, returns a draft and never an active listing; a legacy `hidden_from_state IS NULL` row restores to `active`.
- Staff list never contains a merchant offer, an email, a phone, or the contact value.
- A staff member without `marketplace_moderation.read` is refused; the authz matrix exemption list is updated.
- Publishing a legacy draft job offer is still refused with `mode-not-allowed`.

### R11. Why Expo media uploads fail (bugs B1 to B3)

**Observed.** A new listing's photos, the profile avatar and Threads media all go through `uploadReady()` → `mediaApi.upload()` → `api()` in the app, one multipart `POST /media`. None showed progress, and none saved for members.

**Reproduced on the server (T054, `server/tests/media/app-upload-shape.test.ts`).** Two separate things were checked:

1. **The shape the app sends is fine.** An `alt` field first and a `file` part named `IMG_0001.jpg`, with no extension, or `.HEIC` on JPEG bytes: all 201 and `ready`. The same body with no `alt` is refused. So the form is not the cause.
2. **The time is.** The same upload sent over a real socket, in 12 chunks 800 ms apart (about 9.6 s, a phone on a modest uplink), was answered **503** at 8.09 s. `app.inject` delivers a body instantly, which is why no existing test could have seen it.

**Why (T055).** `plugins/12-deadline.ts` starts the `media-upload` deadline in the `onRequest` hook, when the headers arrive, and races the handler against it. A multipart body is read inside the handler, so the 8 000 ms budget included the whole upload and not just the processing after it. A phone photo (a few MB, up to 25 MB allowed) on a mobile uplink needs longer than 8 s, so the server answered 503 before the file had finished arriving, and the app showed "it does not save".

**Why merchants were not hit.** A merchant's photo is held to 1 MiB and the merchant screens pick at `quality: 0.6`, so it arrives within 8 s. That is also why feature 035's upload progress was built and tested on the merchant path without this showing up.

**Decision.** Raise `media-upload` to 25 000 ms in `server/src/config/budgets.ts`, under the 30 s `requestTimeout` the boot gate requires (Σ outbound 6 250 ms < 25 000 < 30 000), and keep that request timeout as the ceiling on a stalled client. The test pins both the number and the slow upload.

**Rationale.** It is the confirmed cause, it is one number with a stated bound, and it needs no client release to start working for installed builds.

**Alternatives considered.**
- *Lower the photo quality in the app only.* Does not help installed builds, and a 25 MB video would still time out.
- *Remove the deadline for uploads.* A stalled client could then hold a worker indefinitely; Principle V requires a bound.
- *Raise `REQUEST_TIMEOUT_MS`.* A deployment precondition with a documented reason (`server/README.md`); not changed here. Files that cannot arrive in 30 s are still refused.

**Not verified.** T053 (reproducing on a device or simulator) was not done: this session had no device. The client's plain-`fetch` path is therefore not proven faulty on its own. The app still moves to `XMLHttpRequest` for member uploads, because progress cannot be reported through `fetch`, and the merchant screens already use it.

### R12. iPhone photos (HEIC) refused with 400 (bug B4)

**Observed.** On an iPhone the app uploaded photos that the server refused with `400 unsupported-media-type` ("Files of type image/heic are not accepted"). The app showed a generic "the upload failed" with a Retry that could never work.

**Verified, not assumed.**

1. **Why the app sent HEIC.** `expo-image-picker` 57.0.19 (`node_modules/expo-image-picker/ios`): every pick here takes the `PHPickerViewController` path (`launchImagePicker` uses it whenever editing is off), and the native default of `preferredAssetRepresentationMode` is `.current`, "do not transcode". The type docs say the default is `Automatic`, and the JS layer sets none, so the docs and the native code disagree. In that path a HEIC comes back as `rawData` with a `.heic` extension (`ImageUtils.readDataAndFileExtension`, `case UTType.heic`), and the `quality: 0.9` the app passes is ignored for it. Only a cropped pick (the store cover, which uses `allowsEditing`) goes through the older picker, which re-encodes to JPEG, so the cover worked and nothing else did.
2. **Why the server cannot convert it.** `sharp` 0.35.4 (libvips 8.18.6, libheif 1.23.2) lists only `.avif` as a HEIF input. On a real HEIC (Apple's `Mac Blue.heic`, 6016×6016) `sharp(...).metadata()` succeeds but decoding fails: `heif: Decoder plugin generated an error: Unspecified`. The prebuilt libheif has an AV1 decoder (AVIF) and no HEVC decoder. `file-type` does detect it, as `image/heic`, which is why the refusal names the type.
3. **A detection quirk worth knowing.** `file-type` reads an `ftyp` box with major brand `heif` as `video/mp4`; a HEIF still uses `mif1`. Fixtures must use `heic` or `mif1`.

**Decision: convert at the source, refuse early and clearly, keep the server strict.** Four layers, each doing one job:

| Layer | What | Why this layer |
|---|---|---|
| Client, primary | `pickMedia` asks for `preferredAssetRepresentationMode: Compatible`, so iOS converts HEIC to JPEG (and HEVC video to H.264) on the phone before the app sees it. | The phone's own, licensed codec does the work. Nothing new is shipped, no server CPU is spent on untrusted HEVC, and the upload is smaller. It is a JS option on a native module already in the build, so **no new EAS build**. |
| Client, guard | A file still labelled HEIC/HEIF is checked against its own first 32 bytes (`sniffImageType`, `expo-file-system`, already compiled into the app as a dependency of `expo`). If the bytes are really JPEG/PNG/WebP/AVIF the file is accepted and renamed; if they are HEIC it is named to the member before any upload. | A label can be wrong in both directions. Without the check, a photo the system already converted but still named `.heic` would be blocked by the guard meant to help. It also covers Android phones that store HEIC and files picked from storage. |
| Client, net | An upload the server still refuses as `unsupported-media-type` becomes `failed` with `reason: 'unsupported-format'`: its own message and no Retry. | The server decides from bytes and can disagree with a label. A second try of the same file cannot work, so offering one is a lie. |
| Server | Stays strict (Principle VI: validate by content, bounded decode). The refusal is still `unsupported-media-type`, 400, and now carries `detectedType` and `acceptedTypes` as RFC 9457 extension members, plus one structured log line per refused type. | A client is told what to do from data, not from parsing English. The log makes "every iPhone is suddenly refused" a visible count instead of a mystery. |
| Contracts | `ACCEPTED_MEDIA_TYPES` and `isAcceptedMediaType` are the one list the server validates against and both clients use; the web picker's hand-copied array is gone. | A client offering a type the server refuses is exactly the divergence Principle I exists to prevent, and it is how the app came to send HEIC at all: it had no list. |

**Alternatives considered.**
- *Decode HEIC on the server.* Needs an HEVC decoder: either a custom libvips/libheif build or a WASM one (`heic-convert`/`libheif-js`). HEVC carries patent-licensing exposure that an enterprise would have to clear, the decoder is LGPL, and it means CPU-heavy decoding of untrusted input inside a request with a 25 s budget (it would want a worker thread or the job queue). It would also be a second, parallel way to normalise images next to `sharp`. Revisit only if a client that cannot convert at the source becomes important (a web upload of a raw HEIC, a partner integration) **and** legal has cleared HEVC; then decode in the job queue and keep the strict synchronous path.
- *`expo-image-manipulator` to convert in the app.* It is a native module, so it forces a new EAS build for every installed copy, to do what `Compatible` already does for free.
- *Telling members to switch their camera to "Most Compatible".* It only affects future photos and is a support burden. It stays as a hint in the message, never as the fix.
- *Answering 415 instead of 400.* 415 is the more exact status, but `UNSUPPORTED_MEDIA_TYPE` is an existing, tested public contract (status 400) and clients branch on its `type`, not its status. Changing it is a separate, deliberate contract change; the new extension members give the precision without it.
- *Sniffing every pick.* Unnecessary: only labels in the HEIF family are doubtful, and the server remains the final judge of everything else.

**Not verified.** No iPhone was available, so `Compatible` was not exercised on a device (T088). The native code shows what `.current` does; it does not show which type identifier the item provider reports after a `Compatible` transcode. That is why the guard checks bytes instead of trusting the extension: whichever way the module labels a converted file, the guard classifies it correctly.
