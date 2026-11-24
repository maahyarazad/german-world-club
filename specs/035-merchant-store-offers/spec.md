# Feature Specification: Merchant Stores, Categorised Offers and Redemption Reports

**Feature Branch**: `035-merchant-store-offers`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "The merchant user type from an organisation can create offers (cuisine, restaurant, clinic, and so on; a discount, a freebie, or buy-one-get-one) and organise their store, like a store marketplace. Each offer can carry a set of images or videos (maximum 10); the server creates a thumbnail and the mobile app uses it. Show upload progress when uploading and organising the store. Each merchant has only one store. An admin can deactivate a store at any moment by setting its active flag to false/0. Add upload progress to the partner profile update. Add a carousel of partners and merchants to the web landing page only. Add a Merchant offers section to the Expo mobile app and the web application; any type of user can redeem an offer, but must be active. The merchant sees a report of redemptions in their dashboard, and so does the super admin. The list of redeemed items appears in each individual dashboard. Each offer sits under a category, the admin sees and manages all categories, and a generic set of categories is provided."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A merchant sets up their store and publishes categorised offers (Priority: P1)

A merchant user, signed in for their organisation, opens their store for the first time and fills in its public face: name, description, logo, cover and the places it trades from. They then create offers. Each offer has a title, a description, a type (a discount, a freebie, or buy-one-get-one), a validity period, optional conditions and an optional redemption limit, and it sits under exactly one category chosen from the list the club provides. They attach up to 10 images or videos to the offer. The merchant can reorder the media, choose which item leads, and edit or withdraw the offer later. The store itself has a wide cover image across the top, like a LinkedIn or Facebook cover, and a gallery of up to 10 photos or videos. Photos must be under 1 MB and videos under 5 MB. Publishing an offer notifies members once, and only once.

**Why this priority**: Without a store and offers there is nothing for members to redeem and nothing to report. Everything else depends on this.

**Independent Test**: Sign in as a merchant user, create the store, create one offer under a category with three images and one video, publish it, and confirm that a member can see it with its thumbnail.

**Acceptance Scenarios**:

1. **Given** a merchant organisation with no store, **When** its user creates a store, **Then** the store exists and is active, and a second attempt to create another store for the same organisation is refused.
2. **Given** a store, **When** the merchant creates an offer without choosing a category, **Then** the offer is refused and the missing category is named.
3. **Given** an offer with 10 media items, **When** the merchant tries to add an 11th, **Then** it is refused and the offer is unchanged.
4. **Given** an offer with images and videos, **When** a member views it, **Then** the member sees generated thumbnails and optimised versions, and never the original upload.
5. **Given** a published offer, **When** the merchant withdraws it, **Then** members no longer see it, and redemptions already made remain in the reports.
6. **Given** one merchant, **When** they try to read or change another merchant's store or offer, **Then** the answer is indistinguishable from the item not existing.
7. **Given** a merchant choosing a store cover, **When** they pick an image that is not wide (about 16:9), **Then** it is refused with the reason, and the previous cover stays.
8. **Given** a store gallery with 10 items, **When** the merchant tries to add an 11th, **Then** it is refused and the gallery is unchanged.
9. **Given** a merchant uploading a photo of 1 MB or more, or a video of 5 MB or more, **When** the upload reaches the server, **Then** it is refused with the limit named, and nothing is stored.
10. **Given** a draft offer, **When** the merchant publishes it, **Then** members who receive offer notifications are notified once; **and when** the offer is withdrawn and published again, **Then** nobody is notified a second time.

---

### User Story 2 - A user browses and redeems merchant offers on web and in the app (Priority: P1)

An active user (a member, a staff member, or a merchant or partner user) opens a new "Merchant offers" section, in the web application and in the mobile app. They can browse by category, open an offer to see its media, terms and store, and redeem it. A redemption produces a reference the user can show at the store, and the offer's remaining count drops by one. The user can see the list of what they have redeemed.

**Why this priority**: Redemption is the point of the whole feature and the data every report is built from.

**Independent Test**: As an active user, browse to an offer through its category, redeem it, and see it in "My redemptions" with a reference; redeem again where the offer allows only one per person and confirm it is refused.

**Acceptance Scenarios**:

1. **Given** an active user and a published, in-date offer from an active store, **When** they redeem it, **Then** a redemption with a unique reference is recorded and appears in their redeemed list.
2. **Given** a retried or double-submitted redemption, **When** it reaches the server twice, **Then** exactly one redemption exists.
3. **Given** an offer whose remaining count is zero, expired, withdrawn, or whose store is deactivated, **When** a user tries to redeem it, **Then** it is refused with a reason, and nothing is recorded.
4. **Given** an account that is locked, inactive, ended, or an applicant not yet approved, **When** it tries to browse or redeem, **Then** it is refused.
7. **Given** a merchant user, **When** they try to redeem an offer of their own organisation, **Then** it is refused; **and when** they redeem another merchant's offer, **Then** it succeeds.
5. **Given** the last remaining unit and two users redeeming at the same moment, **When** both submit, **Then** exactly one succeeds.
6. **Given** a deactivated store, **When** any user browses, **Then** neither the store nor its offers appear.

---

### User Story 3 - Merchants and the super admin see redemption reports (Priority: P2)

A merchant opens their dashboard and sees every redemption of their own offers: which offer, which category, when, the reference, and totals per offer and per period. The super admin sees the same report across all merchants and can narrow it by merchant, category and period. Each individual dashboard also lists the redeemed items that belong to it: a user's own redemptions in their account, a merchant's redemptions across their store, and the admin's across the platform.

**Why this priority**: It turns redemptions into something merchants can act on and the club can account for. It needs redemptions to exist first.

**Independent Test**: Make three redemptions across two merchants. Each merchant sees only their own; the super admin sees all three and filters down to one merchant.

**Acceptance Scenarios**:

1. **Given** redemptions across two merchants, **When** merchant A opens their report, **Then** only A's redemptions appear, and B's are not discoverable by any means.
2. **Given** the same data, **When** the super admin opens the report, **Then** every redemption appears, and filters by merchant, category and date range narrow it.
3. **Given** a report with many rows, **When** it loads, **Then** it is paged and shows totals for the whole filtered set, not only the visible page.
4. **Given** a report, **When** it is shown to a merchant or admin, **Then** it contains no more of the redeeming person than they need (a display name or handle and the reference, with no contact details).
5. **Given** a staff member who is not a super admin, **When** they request the platform report, **Then** they are refused.

---

### User Story 4 - The admin manages categories and can deactivate any store (Priority: P2)

Staff with the right permission see all categories, with the number of offers in each, and can add, rename, reorder, and hide categories. A generic starter set ships with the feature. An admin can switch any store off at any moment by setting its active flag to false (or 0), and back on again. The change is audited, takes effect on the next request, and hides the store and its offers from every user while keeping its data and history intact.

**Why this priority**: It is the club's control over quality and safety. It matters once merchants are live.

**Independent Test**: Deactivate a store that has a published offer; confirm that the offer disappears for users and can no longer be redeemed, that the merchant still sees their own data with a notice, and that reactivation restores everything.

**Acceptance Scenarios**:

1. **Given** an active store, **When** an authorised admin sets its active flag to false, **Then** the store and its offers are hidden from users at once and redemption is refused.
2. **Given** a deactivated store, **When** its merchant signs in, **Then** they can still see their store and reports, are told it is deactivated, and cannot publish new offers.
3. **Given** a category that has offers, **When** an admin hides it, **Then** its offers stay under it and remain visible and redeemable, and the category is no longer offered to merchants for new offers. Deleting a category that has offers is refused.
4. **Given** a merchant or ordinary user, **When** they try to manage categories or deactivate a store, **Then** they are refused.
5. **Given** any deactivation, reactivation or category change, **When** it completes, **Then** an audit entry records who did it and what changed.

---

### User Story 5 - Uploads show progress, including the partner profile (Priority: P3)

When a merchant uploads offer media or store images, they see progress as a fraction while the file is sent, and then a "processing" state while thumbnails are being made. The same progress is shown when a partner updates their profile and uploads a logo. A failed or cancelled upload tells the person it did not complete and leaves the previous content untouched.

**Why this priority**: Videos and ten-item sets are large; without feedback people retry and create duplicates. It improves the experience but does not block the rest.

**Independent Test**: Upload a large video on a throttled connection and see progress advance to completion, then a processing state, then the thumbnail.

**Acceptance Scenarios**:

1. **Given** a file being uploaded, **When** bytes are sent, **Then** the person sees progress advance, and then a distinct processing state until the thumbnail is ready.
2. **Given** an interrupted upload, **When** it fails, **Then** the person sees that it failed, can retry, and no half-attached media appears on the offer.
3. **Given** a partner updating their profile with a new logo, **When** the logo uploads, **Then** the same progress and processing states are shown.

---

### User Story 6 - The public landing page shows a carousel of partners and merchants (Priority: P3)

Visitors to the public landing page on the web (not in the app) see a carousel of the club's partners and active merchants: logo and name, linking to the partner's or merchant's public page where one exists. The carousel works without scripts, is readable by search engines, and shows only organisations that have chosen to be public and are active.

**Why this priority**: It is marketing value for the club and its counterparties, independent of the member flows.

**Independent Test**: Load the landing page with scripts disabled and see the carousel with active, public partners and merchants; deactivate one store and confirm it disappears.

**Acceptance Scenarios**:

1. **Given** active public partners and merchants, **When** a visitor opens the landing page, **Then** they appear in the carousel in both languages' pages.
2. **Given** a deactivated store, **When** the landing page is next served, **Then** that merchant is absent.
3. **Given** no eligible organisations, **When** the page is served, **Then** the section is omitted rather than shown empty.
4. **Given** the carousel, **When** it is served, **Then** it exposes only public display fields (name, logo, link), never contract data such as legal name or fee tier.

---

### Edge Cases

- A merchant organisation with several user accounts: all share the one store, and an edit made after another user's is not silently overwritten.
- A video that cannot be processed, an unsupported file type or an oversized file is refused with a reason, and does not count toward the 10.
- Removing media that is the lead item promotes the next item; removing the last item leaves a valid offer without media.
- An offer's validity ends while a user is viewing it: redemption is refused at the moment of the attempt.
- A buy-one-get-one or freebie offer has no price: reports must still total redemptions correctly and not invent a monetary saving.
- A category is hidden while offers sit under it: those offers keep it.
- A merchant organisation is ended or locked: its store behaves as deactivated.
- A user redeems the same offer again where the offer allows one per person: refused, with a clear reason.
- Redeeming with no connection, then retrying later: exactly one redemption results.
- Two publish requests for the same offer at the same moment, or a withdraw followed by a publish: one notification in total.
- An offer published with a start date in the future: the notification is held until the offer starts, and is dropped if the offer is no longer visible by then.
- A merchant replaces media: the replaced files are not served any more, and the merchant can delete files that no offer or store uses, which frees their storage.
- A video just under 5 MB that fails processing: it is not shown and does not count toward the 10.

## Requirements *(mandatory)*

### Functional Requirements

**Store**

- **FR-001**: Each merchant organisation MUST have at most one store, and the rule MUST hold under concurrent attempts.
- **FR-002**: A merchant user MUST be able to create and edit their store's public profile (name, description, logo, cover image, places, and opening hours) and arrange its offers in a display order.
- **FR-003**: A store MUST have an active flag, true when created. Only an authorised admin can change it, and it can be set to false (or 0) and back at any moment.
- **FR-004**: A deactivated store, and an ended or locked merchant organisation, MUST be hidden from every user surface, including its offers and the landing carousel. Redemption of its offers MUST be refused.
- **FR-005**: A deactivated store MUST keep its data, media and redemption history, and its merchant MUST still see them with a notice, but MUST NOT publish new offers.

**Offers and categories**

- **FR-006**: A merchant MUST be able to create, edit, publish, withdraw and delete-while-draft their own offers only.
- **FR-007**: An offer MUST have a type of discount (percentage or fixed amount), freebie, or buy-one-get-one, a validity period, and optional conditions and redemption limit (including unlimited).
- **FR-008**: An offer MUST be a real advantage; one that is not cheaper than its regular price is refused, as today.
- **FR-009**: Every offer MUST sit under exactly one category, and an offer without one cannot be saved as published.
- **FR-036**: When an offer becomes published for the first time, the members who receive offer notifications MUST be notified, and only once. Withdrawing and publishing again, a repeated or simultaneous publish request, and a retry MUST NOT notify again. An offer with a future start date is announced when it starts.
- **FR-010**: The system MUST ship a generic starter set of categories covering at least: Cuisine and Restaurants, Health and Clinics, Beauty and Wellness, Shopping, Travel and Leisure, Services, Education, and Other.
- **FR-011**: Authorised staff MUST be able to see all categories with their offer counts, and to add, rename, reorder, and hide them. A category in use MUST NOT be deletable. Hiding a category MUST NOT hide or alter its existing offers.
- **FR-012**: Merchants MUST be able to choose only from visible categories. Users MUST be able to browse and filter offers by category.

**Media**

- **FR-013**: An offer MUST accept a set of images and videos totalling at most 10 items, with order and a lead item. The limit MUST be enforced by the server, not only by the client.
- **FR-032**: A store MUST have one cover image shown across the top. The cover MUST be an image in a wide shape (about 16:9, landscape); the server refuses any other shape and keeps the previous cover.
- **FR-033**: A store MUST accept a gallery of at most 10 photos or videos, with order, enforced by the server.
- **FR-034**: Everything a merchant uploads (cover, store gallery, offer media, logo) MUST be refused when a photo is 1 MB or larger or a video is 5 MB or larger. The server decides, and the clients check first so people learn the limit before uploading.
- **FR-035**: A merchant MUST be able to delete a file they uploaded when no offer or store uses it, which releases its storage. A file still in use is refused with a reason.
- **FR-014**: The server MUST generate a thumbnail and optimised versions for every item. Clients, including the mobile app, MUST use the thumbnail in lists and MUST NOT be sent the original upload.
- **FR-015**: Media for an offer MUST be attached only through its owning merchant, and an item that fails processing MUST NOT appear on the offer.

**Redemption**

- **FR-016**: An active account of any kind (member, staff, merchant user or partner user) MUST be able to redeem a published, in-date offer from an active store, and receive a unique reference.
- **FR-017**: Redemption MUST be exact under concurrency: remaining units are never oversold, and a retried request produces one redemption.
- **FR-018**: An account that is locked, inactive, ended or not yet approved MUST be refused, and a merchant user MUST be refused redemption of their own organisation's offers.
- **FR-019**: Each offer MUST be able to state a per-person limit, and the system MUST enforce it.
- **FR-020**: Each user MUST be able to see their own redeemed items.

**Reports**

- **FR-021**: A merchant MUST see a report of redemptions of their own offers, with the offer, category, time and reference, totals per offer and per period, and filters by offer, category and date range.
- **FR-022**: The super admin MUST see the same report across all merchants, additionally filterable by merchant. No other staff member sees it unless it is granted explicitly.
- **FR-023**: A report MUST be paged, with totals covering the full filtered set, and MUST show the redeeming account only by display name or handle, kind of account (for example member or staff) and reference.
- **FR-024**: A merchant MUST NOT be able to discover another merchant's offers, redemptions or store through any report or route.

**Uploads**

- **FR-025**: Every upload in store and offer management, and in the partner profile update, MUST show progress while sending and a separate processing state afterwards, on both web and mobile.
- **FR-026**: A failed or cancelled upload MUST leave the previous content untouched and allow a retry.

**Landing and surfaces**

- **FR-027**: The web landing pages (both languages) MUST show a carousel of active, public partners and merchants. It MUST work without scripts, be omitted when empty, and expose public display fields only.
- **FR-028**: The mobile app MUST NOT show the carousel.
- **FR-029**: A "Merchant offers" section MUST exist on web and in the app, with browse by category, offer detail, redeem, and a list of one's redemptions, in both interface languages.

**Cross-cutting**

- **FR-030**: Deactivation, reactivation, category changes, offer publishing and withdrawal MUST write audit entries, and no one may edit an audit entry.
- **FR-031**: Redemption history MUST be immutable. A correction is a new entry, not an edit.

### Key Entities

- **Store**: a merchant organisation's public storefront. Exactly one per organisation, with a name, description, images, places, opening hours, an active flag and a display order for its offers.
- **Offer**: a benefit published by a store: type, title, description, validity, conditions, optional limits, one category, and up to 10 ordered media items.
- **Offer Category**: a named group, managed by staff, with an order and a visible flag. A generic starter set ships with the feature.
- **Store Media Item**: a photo or video in a store's gallery, with order and generated thumbnail; at most 10 per store. The store's cover is one wide image, kept separately from the gallery.
- **Offer Media Item**: an image or video attached to an offer, with order, lead flag, thumbnail and optimised versions.
- **Redemption**: an immutable record that an account (of any kind) redeemed an offer at a time, with a unique reference.
- **Redemption Report**: a filtered, paged, totalled view over redemptions, scoped to a merchant or the whole platform.
- **Landing Carousel Entry**: the public projection of an active partner or merchant: name, logo, link.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A merchant can create their store, and publish a first offer with media under a category, in under 10 minutes without help.
- **SC-002**: An active user can find an offer by category and redeem it in under 1 minute.
- **SC-003**: Under 100 simultaneous attempts at the last remaining unit, exactly one redemption succeeds and none is oversold.
- **SC-004**: After an admin deactivates a store, 100% of its offers vanish from user views and are refused for redemption by the next request.
- **SC-005**: 100% of attempts to read or change another merchant's store, offer or report are indistinguishable from "not found".
- **SC-006**: No offer ever has more than 10 media items, and no response ever contains an original upload.
- **SC-007**: A merchant's report and the super admin's report agree: the admin's totals equal the sum of the merchants' totals for the same period.
- **SC-008**: Every upload shows progress within 1 second of starting, and a failed upload leaves the previous content intact in 100% of cases.
- **SC-010**: Publishing an offer results in exactly one notification record, however many times it is published, withdrawn, retried or published concurrently.
- **SC-011**: 100% of photos of 1 MB or more, videos of 5 MB or more, covers that are not wide, and eleventh gallery items are refused, and none of them is stored.
- **SC-009**: The landing page carousel appears for visitors with scripts disabled, and a deactivated merchant is absent from the landing page within 5 minutes.

## Assumptions

- **Existing foundations are reused.** Offers, redemptions and redemption feedback, merchant locations, the media pipeline with derivatives, and organisation profiles already exist (features 003, 010 and 011). This feature adds the store, categories, the media set, redemption surfaces for users, the reports and the landing carousel, rather than replacing them.
- **"Cuisine, restaurant, clinic"** are categories in the starter set, not separate kinds of merchant. A merchant organisation is still a merchant.
- **One store per merchant organisation**, shared by all of its users, not one per user.
- **Deactivation** is an administrative update of the store's active flag to false (or 0), available to staff with the right permission on stores and audited; the API shape is a planning decision.
- **Hidden categories** keep their existing offers visible, so an admin's housekeeping never silently removes live offers.
- **Merchants publish directly** (decided by the repository owner on 2026-11-23): there is no staff approval step. The club's controls are category management, withdrawal and store deactivation. The `pending` and `rejected` states stay in the data but this feature does not use them.
- **The notification on publishing is the existing offer announcement**: it goes to the members who already receive offer notifications, on their eligible devices, once per offer, as feature 011 defines. This feature makes sure merchant publishing reuses it and never queues a second one.
- **The store cover is landscape 16:9** (confirmed by the repository owner on 2026-11-23; an earlier note said "9:16", which was a mistake). The ratio is one constant, with a small tolerance.
- **"Less than 1 MB / 5 MB"** means under 1 MiB (1,048,576 bytes) and under 5 MiB (5,242,880 bytes). The caps apply to what merchant accounts upload; member and partner uploads keep the existing 25 MB ceiling.
- **The store cover is separate from the 10-item gallery**, so choosing a cover does not use up one of the ten.
- **Storage allowance is unchanged**: per-file caps bound growth, and deleting unused files lets a merchant free space. The per-uploader allowance stays as it is today.
- **A merchant is not a member.** Merchant users reach the dashboards with their organisation audience, and the club's rule of separate audiences stands.
- **Mobile offers use thumbnails** already generated by the media pipeline, and no change to native configuration is expected.
- **Redemption is a recorded claim with a reference** that the user shows at the store. The store does not verify it in the app in this feature.
- **No payments are taken.** Reports count redemptions, and show an estimated saving only where the offer has prices.
- **Who may redeem**: every kind of signed-in account — member, staff, merchant user and partner user — provided the account is active (decided by the repository owner on 2026-11-23). Redemptions today belong only to members, so the redemption record must be able to name any of these accounts.
- **A merchant cannot redeem their own organisation's offers**, so a merchant's report cannot be inflated by its own staff. This is the one exception to "any account".
