# Contract: Offer media and search, as both clients present them

**Feature**: 042-offer-media-and-search | This is the behaviour both the web client and the Expo app must satisfy. It restates no server rule; where a rule is the server's it says so.

## 1. The frame

- Every picture area for a merchant offer is **16:9**: `OFFER_MEDIA_ASPECT` from `@gwc/contracts/offers` (web `aspect-ratio`, app `aspectRatio`).
- Media fills the frame with `cover` cropping. Corner radius follows the surrounding cards.
- The frame is **as wide as its container**. The app measures the container (`onLayout`); it never subtracts a guessed inset from the window width.

## 2. Where a picture appears

| Surface | Web | App | Shows |
|---|---|---|---|
| Offers list card (member, merchant, partner, staff) | `offers/Offers.tsx` | `ClubOffersList` in `components/club-offers.tsx` | `thumbnail` (the main media; a video's still) or the fallback |
| Offer detail | `offers/OfferDetail.tsx` | `ClubOfferDetail` | the gallery (section 3), or the fallback |
| Merchant's own offer editor, media section | `organisation/OfferEditor.tsx` | `app/(organisation)/my-offer/[id].tsx` | each item in a 16:9 tile (app: thumbnails only, no main control; see spec Decision 6) |

Not changed: the store cover and store gallery, Threads, the marketplace listing detail, redemption lists.

## 3. The gallery (offer detail)

| Behaviour | Web | App |
|---|---|---|
| Paging | CSS scroll-snap: touch and trackpad swipe; previous/next buttons; clickable dots; Left/Right arrow keys on the focused track | horizontal `ScrollView`, `pagingEnabled`; one item per swipe |
| Width | the container's | the container's, via `onLayout` |
| Position | dots plus a text "n of N" for assistive tech; shown only when N >= 2 | dots, shown only when N >= 2; page from `onMomentumScrollEnd` |
| One item | no dots, no buttons | no dots |
| Zero items | the fallback in the same frame, no controls | same |
| Video | still picture (`posterUrl`) with a play control; pressing plays muted inline; leaving the item stops it | `VideoItem` from `media-carousel.tsx` (exported, reused): poster until tapped, muted, one player per item |
| Reduced motion | `motion-reduce:scroll-auto`, no smooth scrolling | the platform's own paging |
| Roles | `role="region"`, `aria-roledescription="carousel"`; slides `role="group"`, `aria-label="n of N"`; dots are buttons with `aria-current` | `accessibilityLabel` per item from the media's `alt` |
| Extra slot | `renderAction(item, index)` for the super admin's "Make main" (section 5) | none |

The app's `MediaCarousel` is **not** modified; it keeps serving Threads, quote embeds, marketplace listing detail and the store gallery.

## 4. The fallback

- Same artwork on both clients (`offer-fallback.webp`, 1672 x 941), bundled; no network request, so it also shows offline.
- Shown when: `thumbnail === null` (list), `media.length === 0` (detail), **or** the picture fails to load (`onError`).
- Web: `<img width="1672" height="941">` inside the 16:9 frame; alt text from the catalogue (`clubOffers.fallbackAlt`).
- App: `expo-image` with `source={require('../../assets/offer-fallback.webp')}`, `accessibilityLabel` from the catalogue; in lists `recyclingKey={item.id}` so a recycled cell never shows the previous offer's picture.
- It is **never** treated as offer data: the merchant editor still says "no media yet" for an offer with none.

## 5. Choosing the main media (web only)

| Where | Who sees the control | What it does |
|---|---|---|
| `OfferEditor` media tiles | the offer's merchant | leading tile shows a "Main" badge; every other tile has "Make main" -> `PUT /merchant/offers/:id/main-media`; the tile list is replaced from the response's `media` |
| `OfferDetail` with `kind="staff"`, on the current slide | accounts for which the capability snapshot says `isSuperadmin` | "Make main" -> `PUT /admin/offers/:id/main-media`; the gallery is replaced from the response |

Reaching it (FR-031): the staff merchant offers list and detail live at `/konsole/admin/angebote-entdecken` and `/konsole/admin/angebote-entdecken/:id`, the same segment merchants and partners use (`OFFERS_LIST_SEGMENT.staff` changes from `angebote` to `angebote-entdecken`). `/konsole/admin/angebote` stays the marketplace moderation page. The sidebar entry labelled `t.clubOffers.tabLabel` points at the new address, and `angebote/:id` redirects to `angebote-entdecken/:id` so an already-pasted detail link keeps working.

Showing the control follows the snapshot and is display only; the server re-checks (Principle I). A failure is logged with `console.error('<Component>.<function>', error instanceof ApiError ? error.problem : error)` and is not held in state, per the project's client-failure rule; the button's busy flag is the only state kept.

## 6. Search box

| Behaviour | Web | App |
|---|---|---|
| Surfaces | `offers/Offers.tsx` (all four account kinds), `member/Marketplace.tsx` browse view | `ClubOffersList`, `app/(member)/marketplace/index.tsx` |
| Control | `<input type="search">` with a visible label, clear affordance | `TextInput`, `returnKeyType="search"`, clear button, accessibility label |
| Sending | 300 ms after the last keystroke; send `q` only when the trimmed text is empty (no search) or >= `SEARCH_MIN_LENGTH` | same |
| Stale answers | `AbortController` per request; aborted answer ignored | `usePaged` generation guard (already present) |
| With filters | kept and re-applied when the category/mode changes | same |
| Placement | above the list, always mounted | **outside** the `listings.loading ? <Loading/> : <FlashList/>` ternary on Marketplace; in `ListHeaderComponent` (a stable element) on offers, with `keyboardShouldPersistTaps="handled"` |
| Empty result | a "No results for this search" message, distinct from the empty-collection message; clearing the box restores the list | same |
| Loading | the shared page loader until the first answer; never an empty message while loading | same |
| More pages | Offers: existing "Load more". Marketplace: **new** "Load more" using `nextCursor` | existing end-reached paging |
| Logging | the typed text is not logged; the app masks `q` in its request log lines (research R15) | same |

## 7. Strings (German and English, both clients)

New keys, names indicative (the implementation picks final names; parity is enforced by `i18n-parity.test.ts` on the web, and by the type of `en` against `de` in the app):

```text
clubOffers.fallbackAlt            clubOffers.gallery.{region,previous,next,slide,play}
clubOffers.search.{label,placeholder,clear,noResults}
clubOffers.makeMain               (staff, shown to super admins)
merchantOffers.{mainBadge,makeMain,mediaNone}
memberMarketplace.search.{label,placeholder,clear,noResults}     memberMarketplace.loadMore
```
