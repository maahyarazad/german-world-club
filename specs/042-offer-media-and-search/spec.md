# Feature Specification: Offer Media Gallery, Fallback Image and Search

**Feature Branch**: `042-offer-media-and-search` (not yet created; see plan.md)

**Created**: 2026-11-27

**Status**: Draft

**Input**: User description: "I placed the file `eo_fallback.webp` in the root folder. It is the fallback image for merchant offer records in both the web application and the mobile application (Expo RN). All web components and RN components use a 16:9 aspect ratio, and if an offer has no photo, this fallback image is shown. In the Web Application for Merchant Role, and Super Admin: the merchant or super admin can select an image or video for the main offer (the upfront view). In the Expo application, when the user opens an offer: each offer therefore has a main image or video. First, fix the Expo application (Merchant Offer => ClubOfferDetail) so the media width matches the other components below it (the default aspect ratio is 16:9). The media should be swipeable so the user can see the other images or videos. Apply the same behavior to the web application. Add global server-side search (text search within the title and description) for the marketplace and the merchant offers, in both the Expo and web applications."

## Context

Merchant offers (feature 035) already carry up to ten images and videos in an order, and the first one "leads". Marketplace listings (features 008, 017, 021, 037) are the members' classifieds. Five things are wrong or missing today:

- An offer with no photo shows **nothing** where the picture should be, on lists and on the detail page, in both clients.
- On the phone, the media on an offer's detail page does not line up with the cards and text below it: a single photo takes the file's own shape, and several photos appear as a strip of narrower, taller tiles. On the web, the media is a static grid with no way to page through it.
- A merchant cannot see or choose which of their media is the **main** one (the one shown on the list card and first on the detail page); it is simply whichever was added first. Staff cannot influence it at all.
- Nothing can be searched. The offers lists have only category filters, and the web marketplace shows only the **first page** of listings with no way to reach the rest.
- **Staff cannot reach the club offers list in the web console.** The staff sidebar has two tabs, "Marketplace" (moderation) and "Merchant offers", that both point at the same address, and the console opens the moderation page for it. A super admin therefore has no working way to get from the console to a merchant offer, which the main-media request needs. (Merchants and partners already avoid this clash by giving their browsing page its own address.)

"Offers" in the search request means **both** merchant offers and member marketplace listings. They are separate surfaces and each gets its own search.

## Decisions taken on the requester's behalf

The request left these open. Each has a reasonable default, so none blocks planning; each is easy to reverse if the requester disagrees.

1. **"Global" means complete, not combined.** A search covers every record the person is allowed to see, on the server, not just the page already loaded. Each surface (Marketplace, Merchant offers) has its own search box; there is no single box that searches both at once.
2. **What is searched:** the title and the description of an offer; the title and the description text of a listing. Not the merchant's name, not conditions, not category names.
3. **How it matches:** not case-sensitive, matches part of a word ("rad" finds "Fahrrad"), and every word the person typed must appear somewhere in the title or description. At least two characters are needed.
4. **Order of results:** newest first, the same order as the unsearched list.
5. **Super admin's reach:** a super admin chooses the main media from the files **already on** the offer. They do not upload, remove or reorder a merchant's files.
6. **Where the main-media choice lives:** the web application, for merchants and for a super admin. The phone's merchant editor is not changed to add it (the server rule is shared, so adding it later is small).
7. **Fallback scope:** every place an offer's picture is shown, for every kind of account (member, merchant, partner, staff), in both clients. It also replaces a picture that fails to load.
8. **Out of scope:** the staff marketplace listing page keeps its title-only filter; public pages and the public marketplace summary get no search; redemption lists do not show pictures today and are unchanged.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Offer media fits the page and can be swiped (Priority: P1)

A person opens an offer on their phone. The offer's pictures and videos fill exactly the width of the content below them, in a 16:9 frame, and they swipe sideways to see the rest. The same on the web.

**Why this priority**: The requester named this the first issue to fix. Today the media does not match the width of the content below it, which is visible on every offer.

**Independent Test**: Open an offer with four pictures on a phone, on a tablet and on the web. The media's left and right edges line up with the benefit card and description beneath it, and swiping (or arrows and dots on the web) reaches all four.

**Acceptance Scenarios**:

1. **Given** an offer with several images or videos, **When** a person opens it on a phone, **Then** the media area is exactly as wide as the content below it, is 16:9, and swiping moves one item at a time.
2. **Given** a different screen width or orientation (tablet, rotated phone, narrow web window), **When** the offer is open, **Then** the media still matches the width of the content below it.
3. **Given** an offer with several items, **When** it is shown, **Then** the person can tell which item they are on and how many there are.
4. **Given** an offer with exactly one item, **When** it is shown, **Then** there is no position indicator and no paging controls.
5. **Given** the item on screen is a video, **When** it is shown, **Then** it appears as its still picture with a play control; pressing play plays it without sound; moving to another item stops it.
6. **Given** the web application, **When** a person uses touch, mouse or keyboard, **Then** each can page through the items, and a person who prefers reduced motion sees no sliding animation.

---

### User Story 2 - An offer with no photo shows the club's fallback image (Priority: P1)

Wherever an offer's picture belongs, an offer without one shows the club's fallback image in the same 16:9 frame, so lists and detail pages look complete and consistent.

**Why this priority**: It affects every photo-less offer on every list and detail page, in both clients, and it makes the 16:9 rule meaningful.

**Independent Test**: Create an offer with no media. Open the offers list and the offer on the phone and on the web; each shows the fallback in a 16:9 frame. Add a photo; the photo replaces it.

**Acceptance Scenarios**:

1. **Given** an offer with no media, **When** it appears on a list card, **Then** the fallback image fills the card's 16:9 picture area.
2. **Given** an offer with no media, **When** its detail page opens, **Then** the fallback image is shown in the media area at 16:9 with no paging controls.
3. **Given** an offer whose picture fails to load, **When** it is shown, **Then** the fallback image appears instead of an empty box.
4. **Given** an offer whose only video is still being processed, **When** it is shown, **Then** it is treated as having no media and shows the fallback until the video is ready.
5. **Given** a merchant editing an offer with no media, **When** they open the media section, **Then** it says there is no media yet; the fallback is never presented as one of the offer's files and is never sent as offer data.
6. **Given** either interface language, **When** the fallback is shown, **Then** its description for screen readers is in that language.

---

### User Story 3 - Merchant or super admin chooses the main media (Priority: P2)

On the web, a merchant picks which of their offer's images or videos is the main one. A super admin can do the same for any offer. The main media is what the list card shows and what the detail page shows first.

**Why this priority**: Merchants currently cannot control the first impression of their offer, and cannot even see which item leads. It is below the two display fixes because the offer is already shown correctly once those land.

**Independent Test**: As a merchant, open an offer with three pictures, mark the third as main, then open the member offers list and the offer: the third is on the card and is the first item in the gallery. Repeat as a super admin from the club offers page.

**Acceptance Scenarios**:

1. **Given** a merchant editing their own offer with several items, **When** they look at its media, **Then** exactly one item is marked as the main one.
2. **Given** that merchant, **When** they choose another item as main, **Then** it is marked, the previous one is not, and members see it first on the card and in the gallery on their next load.
3. **Given** the chosen main item is a video, **When** the list card is shown, **Then** the card shows that video's still picture.
4. **Given** the main item is removed, **When** the merchant saves, **Then** the next item becomes the main one automatically.
5. **Given** a super admin in the staff console, **When** they open the "Merchant offers" tab and then an offer, **Then** the merchant offers list opens (not the marketplace moderation page) and the offer opens from it; **and when** they choose a different item as main, **then** the change takes effect the same way as a merchant's. The "Marketplace" tab still opens the moderation page.
6. **Given** a member, a partner, a merchant viewing another merchant's offer, or staff who are not super admins, **When** they try to change an offer's main media, **Then** it is refused, and for another merchant's offer it looks exactly like an offer that does not exist.
7. **Given** any change of the main media, **When** it is saved, **Then** an audit entry records who changed which offer.
8. **Given** two changes made at nearly the same moment, **When** both are saved, **Then** the later one wins and the offer is never left with a missing or duplicated item.
9. **Given** an item that does not belong to the offer, **When** it is submitted as main, **Then** it is refused with a specific, explainable reason and nothing changes.

---

### User Story 4 - Search the marketplace and the merchant offers (Priority: P2)

On the web and on the phone, a person types in a search box on the Marketplace or on the Merchant offers list, and the list narrows to the records whose title or description contain what they typed, from the whole collection, not just what has loaded.

**Why this priority**: People cannot find things beyond the first screen of results. It is independent of the media work and can ship separately.

**Independent Test**: With 60 active listings, search for a word that appears only in the description of the 45th. It appears, on web and phone. Clear the box and the full list returns.

**Acceptance Scenarios**:

1. **Given** more records than fit on one page, **When** a person searches for a word, **Then** every matching record they may see is reachable, including ones that would have been far down the unsearched list.
2. **Given** a search for "rad", **When** a title contains "Fahrrad", **Then** it matches; and capitalisation of what was typed does not matter.
3. **Given** a search for two words, **When** results are shown, **Then** every result contains both words somewhere in its title or description.
4. **Given** a category (offers) or a category and a mode (marketplace) is already selected, **When** the person searches, **Then** the results satisfy both the search and the selection.
5. **Given** a search that matches nothing, **When** the result is empty, **Then** the message says nothing matched the search, which is different from the message for an empty collection; clearing the search restores the full list.
6. **Given** records the person may not see (a draft, a withdrawn or expired offer, an offer from a switched-off store, a hidden listing, a listing from a locked member), **When** their text matches what was typed, **Then** they still do not appear in any result.
7. **Given** a person types quickly, **When** they pause, **Then** one search is sent for what they typed, and an older answer never replaces a newer one.
8. **Given** a person types `50%` or `a_b`, **When** the search runs, **Then** those characters are matched literally.
9. **Given** the web Marketplace, **When** there are more results than one page, **Then** the person can load the next page.
10. **Given** any search, **When** it reaches the server, **Then** the typed text is not written to the server's logs or to the app's console output.
11. **Given** a single character, an over-long text or too many words, **When** it is sent, **Then** the server refuses it with a validation error; an empty box is simply "no search".

---

### Edge Cases

- An offer has ten media items and the main one is changed: still ten, order otherwise unchanged.
- The main item is a video that is still processing: the card and the gallery both skip it and use the first ready item, and agree with each other; when it becomes ready it appears first.
- An offer has only unready media: shown as having no media.
- The category counts beside the offers category chips describe the whole visible catalogue and are not narrowed by the search.
- A search term that is the name of a merchant but not in the title or description does not match (Decision 2).
- Very long words, accented characters and mixed-language text are matched as typed; accents are not folded (searching "Cafe" does not find "Café").
- A person changes the category while a search is active: the search is kept and re-applied.
- A search is sent while the previous one is still running: the earlier answer is discarded.
- The offer's detail is opened from a push notification: the gallery and fallback behave as from the list.
- The phone is offline when the fallback is needed: it is part of the app and appears without a network request.

## Requirements *(mandatory)*

### Functional Requirements

**Media display**

- **FR-001**: Every picture area for a merchant offer, in both clients, MUST use a 16:9 frame.
- **FR-002**: On an offer's detail page, the media area MUST be exactly as wide as the content below it, on every screen width and orientation.
- **FR-003**: The media area MUST let the person page through all of the offer's items one at a time, by touch on the phone and the web, and by mouse and keyboard on the web.
- **FR-004**: With two or more items the media area MUST show which item is current and how many there are; with one item it MUST show neither.
- **FR-005**: A video MUST show its still picture first and play without sound only when the person asks; leaving the item MUST stop it.
- **FR-006**: Under a reduced-motion preference the web gallery MUST NOT animate between items.
- **FR-007**: The list cards for offers MUST show the offer's main media at 16:9 (a video's still picture for a video).

**Fallback**

- **FR-008**: Where an offer has no usable media, or its picture fails to load, every place that shows an offer's picture MUST show the club's fallback image instead, at 16:9, in both clients, for every kind of account.
- **FR-009**: The fallback MUST be bundled with each client so that it appears without a network request.
- **FR-010**: The server MUST NOT represent the fallback as offer data: an offer without media MUST still report no media, so editors and other consumers can tell.
- **FR-011**: The fallback MUST have a description for screen readers in the active interface language.

**Main media**

- **FR-012**: An offer's main media MUST be defined once, on the server, as its first ready item in its order; the list card, the detail page and any other place that shows a lead picture MUST agree.
- **FR-013**: A merchant MUST be able, on the web, to choose which of their own offer's items is the main one, and the editor MUST show which one it is.
- **FR-014**: A super admin MUST be able, on the web, to choose the main item of any offer from the files already on it. No other staff account and no other kind of account can.
- **FR-015**: Choosing a main item MUST move that item to the front without changing the relative order of the rest, atomically, and MUST be idempotent when it already leads.
- **FR-016**: Another merchant's offer MUST answer exactly like an offer that does not exist; an item that is not on the offer MUST be refused with a specific reason.
- **FR-017**: Each change of the main media MUST be recorded in the audit log with the actor and the offer.
- **FR-018**: The choice of main media MUST NOT require changing the offer's other fields and MUST NOT make a merchant's open edit form out of date.
- **FR-031**: Every staff account MUST be able to reach the merchant offers list, and from it any offer, from the staff console's navigation, at an address of its own; the marketplace moderation page MUST keep its address and keep opening from its own tab. The "back" link on the staff redemptions page MUST return to the merchant offers list.

**Search**

- **FR-019**: The marketplace listings list and the merchant offers list MUST accept a text search, evaluated on the server across the entire set of records the requester may see, in all four account kinds that browse offers (member, merchant, partner, staff) and for members on the marketplace.
- **FR-020**: A search MUST match the title or the description of a record, case-insensitively and on part of a word, and a record MUST match only if every typed word is found in its title or description.
- **FR-021**: A search MUST be combined with the filters already in use and MUST NOT change the list's ordering or paging.
- **FR-022**: A search MUST NEVER return, or reveal the existence of, a record the requester could not see without it.
- **FR-023**: A search text of fewer than two characters (after trimming), more than 80 characters, or more than six words MUST be refused as a validation error; an empty search MUST behave as no search.
- **FR-024**: `%`, `_` and `\` typed in a search MUST be matched literally.
- **FR-025**: The typed text MUST NOT appear in the server's logs or in the app's console output.
- **FR-026**: Both clients MUST wait for the person to pause typing before searching, MUST ignore a superseded answer, and MUST show a distinct "no results for this search" message.
- **FR-027**: The web Marketplace MUST let the person load every page of results (it currently shows only the first).
- **FR-028**: Searching MUST NOT be offered on any public (signed-out) page.

**Parity**

- **FR-029**: Every new interface string MUST exist in German and English in both clients.
- **FR-030**: The 16:9 ratio, the search length limits and the rule that "no usable media means fallback" MUST each be defined in one shared place that the server and both clients use, not restated per client.

### Key Entities

- **Offer media set**: the ordered list of up to ten images and videos attached to a merchant offer. Its first *ready* item is the **main media**. Processing or failed items are not shown to members.
- **Fallback image**: the club's fixed picture (1672 x 941, WebP) shown for an offer with no usable media. It belongs to the clients, not to any offer, and is never stored as offer data.
- **Search text**: what a person typed to narrow a list. It is split into words; it is user content and is treated as private.
- **Main-media change**: an audited act by a merchant (own offers) or a super admin (any offer) that moves one existing item to the front of an offer's set.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the offer detail page, the media area's width differs from the width of the content below it by 0 pixels on a phone, a tablet, a rotated phone and a narrow web window.
- **SC-002**: 100% of offer pictures, on lists and detail pages in both clients, are 16:9; 0 offers show an empty picture area.
- **SC-003**: A person can reach any item of a ten-item offer with at most nine swipes, and always knows their position.
- **SC-004**: A merchant can change the main media of an offer in under 10 seconds from opening its editor, and members see the change on their next load of the list.
- **SC-005**: A person finds a listing or offer that is 100 or more records down the unsearched list in under 15 seconds, including typing.
- **SC-006**: A search returns its first page in under 300 ms (95th percentile) with 50,000 marketplace listings and 5,000 offers.
- **SC-007**: 0 results ever include a record the requester could not see in the unsearched list (verified for every non-visible state).
- **SC-008**: 0 search texts appear in server logs or app console output in a scan of a full test run.
- **SC-009**: Typing a 10-letter word at normal speed produces at most 2 search requests.

## Assumptions

- Merchants and super admins use the web console; the phone's merchant editor keeps adding, removing and viewing media as it does today, with its thumbnails brought to 16:9 for consistency.
- The fallback image the requester placed at the repository root is final artwork and is not to be redrawn or recompressed.
- Marketplace listing descriptions are the "body" text members write; offers' descriptions are the merchant's description field.
- The category counts on the offers chips are not required to follow the search.
- The existing request budgets and rate limits are sufficient for searching; search is an ordinary read.
- The platform's database can enable the standard text-matching extension that ships with PostgreSQL (research.md R11). If it cannot, the change fails to install rather than shipping a search that is silently slow.

## Out of Scope

- A single search box across marketplace and offers together; relevance ranking; spelling tolerance; accent folding; searching merchant names, conditions or categories.
- Uploading, removing or reordering a merchant's media as staff.
- A main-media control in the phone's merchant editor.
- Search on the staff marketplace page, on public pages and on redemption lists.
- Any change to how media is uploaded, stored, resized or limited.
