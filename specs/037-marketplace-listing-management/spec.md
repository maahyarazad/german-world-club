# Feature Specification: Marketplace Listing Management

**Feature Branch**: `037-marketplace-listing-management`

**Created**: 2026-11-25

**Status**: Draft

**Input**: User description: "members can post on the market place like the second hand stuff (Not merchant offers) - add feature where members can modify they offers and change them, also add publish check box so users can change it to public view (This should be added to both web application and Expo RN) - add to admin user dashboard a new feature so admin can view all the offers in the market place (not the merchant offers) and set them disable if anything goes wrong about that record"

## Context

Members already post second-hand and other classified listings (features 008, 017, 021). "Offers" in this request means these **member listings**, never merchant offers (feature 035). This feature closes three gaps: members cannot yet edit a listing from the web console or the app, they have no explicit publish control, and staff can only act on listings that someone has reported.

## Clarifications

### Session 2026-11-25

- Q: Should the Publish checkbox start checked or unchecked on the new-listing screen? → A: Checked. Saving publishes by default; unticking saves a private draft.
- Q: Which listings can staff disable? → A: Published and draft only. Expired, sold, filled and withdrawn listings are already off display and show no Disable action; staff can still remove one outright.
- Q: Should the owner see the reason staff gave when disabling? → A: No. The owner sees only "disabled by staff" with Publish off; the reason stays in the audit log and is never returned to members.
- Q: Should the staff page show a listing's disable history? → A: No. It shows current state, the state before it was disabled, and open reports; the who, when and why stay in the audit log.
- Q: Should a draft count toward the 20-listing limit? → A: Yes. A draft takes one of the member's 20 places, the same as a live listing; unlimited private drafts are not allowed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Edit my own listing (Priority: P1)

A member opens one of their listings on the web console or in the app, changes its title, description, price or other details, photos and contact preference, and saves. Other members then see the updated listing.

**Why this priority**: Fixing a typo, a price or a photo is the most common reason to return to a listing. Without it the only remedy is to withdraw and re-post.

**Independent Test**: Post a listing, edit its title and price on web, confirm the change on the app (and the reverse).

**Acceptance Scenarios**:

1. **Given** a member with a listing, **When** they change fields and save, **Then** the listing shows the new values to everyone who can see it and the old values appear nowhere.
2. **Given** a member editing, **When** they leave a required field empty or enter an invalid value, **Then** the save is refused, the field is marked, and the stored listing is unchanged.
3. **Given** a listing that belongs to another member, **When** a member tries to edit it, **Then** it behaves as if the listing does not exist.
4. **Given** a listing in a category that allows only "request" mode, **When** the member edits it, **Then** they cannot change it into a mode the category does not allow.
5. **Given** a listing that is sold, filled, withdrawn, expired or removed by staff, **When** the member opens it, **Then** editing is not offered and the reason is shown.

---

### User Story 2 - Publish or unpublish with a checkbox (Priority: P1)

When creating or editing a listing, the member sees a "Publish" checkbox. Checked means the listing is visible to other members; unchecked keeps it as a private draft only the member sees. The member can flip it at any time from the edit screen.

**Why this priority**: It lets members prepare a listing safely and take one off display temporarily without losing it.

**Independent Test**: Create a listing with the box unchecked and confirm no other member sees it; check the box and confirm it appears; uncheck and confirm it disappears.

**Acceptance Scenarios**:

1. **Given** a new listing where the member has unticked the box (it starts ticked), **When** the member saves, **Then** it is stored as a draft, listed only under the member's own listings, and absent from browse and search for others.
2. **Given** a draft, **When** the member checks Publish and saves, **Then** it becomes visible to other members immediately.
3. **Given** a published listing, **When** the member unchecks Publish and saves, **Then** it disappears for others on their next request, and conversations already started about it remain with their participants.
4. **Given** a listing hidden by staff, **When** the member views it, **Then** the Publish checkbox is disabled with an explanation, and the member cannot republish it.
5. **Given** the same listing on web and app, **When** the state changes on one, **Then** the other shows it identically.

---

### User Story 3 - Staff see every member listing and disable one (Priority: P2)

A staff member with marketplace moderation access opens a Marketplace listings page in the admin console. It lists all member listings (never merchant offers) with filters for state, category and owner, and a search. Opening one shows its content, current state, the state it was in before it was disabled, and any open reports. The staff member can disable a listing, with a required reason, and re-enable it later.

**Why this priority**: Today staff reach a listing only through a report. Staff need to find and stop a bad record on their own initiative.

**Independent Test**: Sign in as staff, find a draft and a published listing in the list, disable the published one with a reason, and confirm members no longer see it.

**Acceptance Scenarios**:

1. **Given** listings in several states, **When** staff open the page, **Then** all member listings appear, newest first, and no merchant offers.
2. **Given** the list, **When** staff filter by state, category or owner, or search by title, **Then** only matching listings appear.
3. **Given** a published listing, **When** staff disable it with a reason, **Then** it disappears from every member surface on the next request and an audit entry records who, when and why.
4. **Given** a disabled listing, **When** staff re-enable it with a reason, **Then** it returns to the state its owner left it in (published or draft), and it is not published if it was a draft.
5. **Given** a staff member without marketplace moderation access, **When** they request the page or its data, **Then** access is refused.
6. **Given** staff viewing a listing, **Then** they have no way to change what the member wrote.

### Edge Cases

- A member edits a listing while staff disable it: the member's save is refused with a clear message and nothing is overwritten.
- Two edits of the same listing from web and app at once: the second is told the listing changed and must reload, rather than silently overwriting.
- A listing with an active conversation is unpublished or disabled: existing conversations stay readable to participants; no new request can be sent.
- An expired listing is edited: the member may set a new expiry and publish it again, which returns it to the published state.
- A member has no handle or an incomplete profile: existing posting rules apply unchanged.
- Photos are removed or replaced during an edit: removed photos stop being served and the original upload is still never served.
- A list with thousands of listings: the staff page stays responsive through paging.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A member MUST be able to edit the title, description, category-specific details, features, photos, contact preference and expiry of their own listing on both the web console and the app.
- **FR-002**: Editing MUST apply the same validation as creating, including which modes a category allows.
- **FR-003**: Editing MUST be offered only while the listing is a draft, published, or expired. Sold, filled, withdrawn and staff-removed listings are not editable.
- **FR-004**: A listing belonging to another member MUST answer exactly like an absent listing, in status, body and headers.
- **FR-005**: The create and edit screens on web and app MUST show a "Publish" checkbox. On the new-listing screen it starts checked. Unchecked saves a draft; checked makes the listing visible to other members. On the edit screen it shows the listing's current state.
- **FR-006**: A member MUST be able to switch a listing between published and draft at any time from the edit screen on either platform.
- **FR-007**: A draft MUST be visible only to its owner and to staff. A draft counts toward the member's 20-listing limit exactly as a live listing does.
- **FR-008**: A listing disabled by staff MUST NOT be publishable by its owner, and the screen MUST say it was disabled by staff. It MUST NOT show or return the staff's reason.
- **FR-009**: Concurrent edits MUST NOT silently overwrite each other; the later one is told to reload.
- **FR-010**: The admin console MUST offer a listings page showing all member listings in every state, excluding merchant offers, paged, with filters for state, category and owner and a title search.
- **FR-011**: Staff MUST be able to disable a published or draft listing (no other state offers Disable) with a mandatory reason and re-enable it with a mandatory reason. Both MUST write an audit entry with actor, time, reason and the state before and after.
- **FR-012**: A disabled listing MUST disappear from browse, search, detail, the public aggregate counts and notifications on the next request.
- **FR-013**: Re-enabling MUST restore the state the owner had chosen and MUST NOT publish a draft.
- **FR-014**: Staff MUST NOT be able to change the content of a member's listing.
- **FR-015**: The listings page and its data MUST be limited to staff with marketplace moderation access.
- **FR-016**: Interface text for all new screens MUST exist in German and English on web and app.
- **FR-017**: The public `/marktplatz` page MUST continue to show aggregate counts only, and MUST NOT count drafts or disabled listings.
- **FR-018**: Existing listings MUST keep their current visibility after this feature ships.

### Key Entities

- **Member listing**: a classified post owned by one member, with content, photos, category, mode, optional expiry and a lifecycle state (draft, published, expired, sold, filled, withdrawn, disabled by staff).
- **Moderation entry**: a record of a staff disable or re-enable, with actor, reason, time and prior state.
- **Staff listing view**: the page's read-only projection of a listing, showing owner display name and listing facts but no member contact details.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member can change a listing's price or photo and see it live in under one minute, on web and on the app.
- **SC-002**: 100% of draft listings are invisible to other members across browse, search, detail and public counts.
- **SC-003**: A published listing becomes invisible to other members within 5 seconds of being unpublished or disabled.
- **SC-004**: Staff can find any listing and disable it in under 1 minute.
- **SC-005**: Every disable and re-enable has a recorded actor, reason and time (100% coverage).
- **SC-006**: A member can create a draft and publish it later on both platforms without leaving the edit flow.
- **SC-007**: No merchant offer ever appears on the staff listings page.

## Assumptions

- "Offers" means member marketplace listings; merchant offers (feature 035) are out of scope and keep their own flow.
- The existing states (draft, active, sold, filled, withdrawn, expired, hidden) cover this feature; "published" is the member-facing name for active, and "disabled" is the staff-facing name for hidden. No new lifecycle state is needed.
- The existing report-based moderation (hide, restore, remove, resolve) stays; the new page is an additional route to the same actions.
- Staff access reuses the existing marketplace moderation permission; no new permission is created.
- Any member may post, and by default every member may edit and publish or unpublish their own listings. There is no permission flag for it; ownership is the only gate. The rules from feature 021 (no new job offers) still apply to edits.
- Editing keeps the existing expiry rules, where no expiry means unlimited.
- Real-time updates are not required; screens show the change on next load or refresh.
- The web edit uses the same drawer as compose; the app uses a screen in the Marketplace tab.

## Addendum: Expo media upload bugs (added 2026-11-25)

Three shipped app flows fail to save media, and none shows how far an upload has got. They are bugs, not new capability, and they sit on this branch because the first of them is the same Marketplace posting flow this feature extends. The cause is not yet established (see `research.md` R11 once written).

### User Story 4 - Marketplace listing and its photos save from the app (Priority: P1)

A member posts a listing from the app with one or more photos or a video. The listing is stored, every chosen file is uploaded and attached, and they see the listing with its media.

**Independent Test**: post a listing with two photos on the app and open it on the web: both photos are there.

**Acceptance Scenarios**:

1. **Given** a member composing a listing with photos, **When** they post, **Then** the listing is saved and every photo is attached in the order shown.
2. **Given** an upload in progress, **When** bytes are going up, **Then** the generic loader shows with a whole-number percentage; once sent, it shows "Processing" until the server has finished.
3. **Given** two or more files, **When** they upload, **Then** the percentage covers the whole batch and the screen says which file is current.
4. **Given** a file fails or the member cancels, **When** it stops, **Then** the listing is kept, the failed files are marked, and Retry uploads only those.

### User Story 5 - Profile avatar updates from the app (Priority: P1)

A member chooses a new profile picture in the app. It uploads with progress and then shows everywhere their avatar appears.

**Independent Test**: change the avatar on the app and see it on the profile and on the web.

**Acceptance Scenarios**:

1. **Given** a member changing their avatar, **When** the upload runs, **Then** the loader shows the percentage and the controls are disabled.
2. **Given** a failed or cancelled upload, **When** it stops, **Then** the previous avatar is unchanged and Retry is offered.

### User Story 6 - Threads posts with media from the app (Priority: P1)

A member posts to Threads with photos or a video from the app. Each file uploads with progress, then the post is created.

**Independent Test**: post with two photos on the app and see both on the post, on the app and on the web.

**Acceptance Scenarios**:

1. **Given** a post with media, **When** the member posts, **Then** the files upload with the overall percentage and "File n of m", then the post appears with its media.
2. **Given** a failed or cancelled upload, **When** it stops, **Then** nothing is posted and the text and chosen media stay on screen for a retry.
3. **Given** a member with no handle, **When** they post, **Then** they are sent to choose one, as today.

### Additional Requirements

- **FR-019**: A photo or video chosen in the app for a listing, avatar or Threads post MUST be stored and linked when the member saves.
- **FR-020**: While a file uploads, the app MUST show the club's generic loader with the percentage received as a whole number, and "Processing" after the last byte until the server finishes.
- **FR-021**: A failed or cancelled upload MUST leave existing content unchanged (previous avatar, no half-made post) and offer Retry.
- **FR-022**: For several files, the percentage MUST cover the whole batch and the current file number MUST be shown.
- **FR-023**: The member MUST be able to cancel an upload that is in progress.
- **FR-024**: These fixes MUST NOT need a new native build of the app.

### Additional Success Criteria

- **SC-008**: A member can add a photo to a new listing, an avatar or a Threads post from the app and see it saved on the first attempt over a normal mobile connection.
- **SC-009**: The percentage appears within one second of the upload starting and reaches 100 % before "Processing" shows.
- **SC-010**: After a failed or cancelled upload, 100 % of attempts leave the previous avatar, listing or post state unchanged.

### User Story 7 - Photos taken on an iPhone upload (Priority: P1)

An iPhone saves photos as HEIC by default. A member picks one for a listing, an avatar, a Threads post, or (for a merchant) a store or offer, and it uploads like any other photo. If a file really cannot be accepted, the person is told which kind of file is the problem before it is sent, in words they can act on, and is never offered a Retry that cannot work.

**Why this priority**: it blocks the largest group of the app's users on the most common action. The server refused every such photo with a generic 400, which the app showed as a failed upload.

**Independent Test**: on an iPhone with the default camera format, take a photo and attach it to a new listing: it uploads and shows on the listing. Then pick a file of a kind the club does not accept (for example a TIFF) and see a message naming the problem, with no upload attempted.

**Acceptance Scenarios**:

1. **Given** an iPhone whose camera saves HEIC, **When** the member picks that photo in any upload screen, **Then** the app hands the server a JPEG and the upload succeeds.
2. **Given** a member on Android whose phone stored a HEIC, **When** they pick it, **Then** the app tells them before uploading that this kind of photo is not accepted, and attaches nothing.
3. **Given** the server refuses a file as an unsupported type, **When** the app shows it, **Then** the message names the file problem (not "the upload failed") and offers no Retry for that file.
4. **Given** several photos picked at once and one unsupported, **When** the member confirms, **Then** the supported ones are added and the unsupported one is named.

### Additional Requirements (US7)

- **FR-025**: The app MUST ask the operating system for the most compatible form of a picked photo, so an iPhone's HEIC reaches the server as JPEG, converted on the phone by the system's own licensed codec.
- **FR-026**: The list of media types the club accepts MUST have one definition shared by the server and every client, so a client cannot offer a type the server refuses.
- **FR-027**: A picked file of an unaccepted type MUST be named to the member before upload, and a server refusal of an unaccepted type MUST be shown as that, with no Retry.
- **FR-028**: The server's refusal of an unaccepted type MUST stay a typed problem a client can branch on, and MUST say which type it detected and which it accepts, as data and not as text to parse.
- **FR-029**: The server MUST NOT decode HEVC (HEIC) itself, and this fix MUST NOT need a new native build of the app.

### Additional Success Criteria (US7)

- **SC-011**: 100% of photos taken with an iPhone's default camera settings upload on the first attempt from every upload screen in the app.
- **SC-012**: A file of an unaccepted type is named to the member within one second of picking it, with no network request made.
