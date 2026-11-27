# Research: Bring the outcome of a save into view

**Feature**: 041-scroll-to-form-message | **Date**: 2026-11-27

All of this was read in the web client's source (`client/src`) and its test setup. Nothing was run in a browser yet; the one browser-only fact (R2) is checked by the manual steps in `quickstart.md`.

## R1. What the web client does today, form by form

Every write goes through `post`, `put`, `patch` or `upload` in `client/src/lib/api.ts` and the page waits for the answer. Of the 28 files that call them, these show an outcome the person has to see:

| # | Page (file) | State that holds the message | What sets it | Where it renders | Stays mounted between two saves? |
|---|---|---|---|---|---|
| 1 | Edit profile (`member/profile/EditProfile.tsx`) | `message` `{tone,text}` | `run` (PATCH/PUT bio, city, links, remove avatar) and `uploadAvatar` (POST `/media`, PUT avatar), both clear it first | `FormMessage` under the page header, above the first card | No (cleared first) |
| 2 | Marketplace (`member/Marketplace.tsx`) | `posted`, `saved` (booleans) | `onPosted({complete})` from the compose drawer: PATCH or POST `/marketplace/listings` | `Callout` under the page header, after the drawer has closed | No (both reset when the drawer opens) |
| 3 | Organisation profile (`organisation/Profile.tsx`) | `message` | `save` (PATCH `/profile/{kind}/public`), clears it first | `FormMessage` under the page header | No |
| 4 | Store (`organisation/Store.tsx`) | `message` | `run(fn, success)`: create store, cover, gallery add/remove, details; clears it first | `FormMessage` under the header and the deactivation notice | No |
| 5 | Offer editor (`organisation/OfferEditor.tsx`) | `message` | `save`, update only (PATCH), clears it first. A *create* navigates away and shows nothing | `FormMessage` under the header | No |
| 6 | Offer categories (`console/admin/OfferCategories.tsx`) | `message` | `save` (PATCH) and `add` (POST). **Does not clear it first.** `move` shows nothing | `FormMessage` under the header | **Yes**: a second save keeps the same object's text on screen |
| 7 | Push (`console/admin/Push.tsx`) | `notice` (string) | `send` (POST rehearsal or broadcast), clears it first | `Callout` between the form fields and the confirm panel, not at the top of the page | No |

Refusals shown in the same slot (User Story 3): Store and Offer editor (409 stale edit), Offer categories (409 taken slug), Edit profile and Organisation profile (a picture the page refuses before sending), and **Offers** (`organisation/Offers.tsx`, publish refused: profile incomplete, store inactive; it has `message` but no success message because the list updates in place).

Where the page scrolls: the console is one document. `ConsoleShell` is `min-h-svh` with a sticky sidebar only on wide screens (`lg:sticky`, left side), and its header is not sticky. There is no inner scroll container and no bar fixed over the content, so scrolling the window is right. (The Drawer and Modal are `<dialog>`s with their own scroll; none of the seven pages' messages is inside one.)

Forms that **confirm nothing on screen today** (not changed here, spec Assumptions): staff moderation in `console/admin/Marketplace.tsx`, `MarketplaceListings.tsx` and `Threads.tsx` (hide, restore, remove, resolve: the dialog closes and the table reloads), `Applications.tsx`, `Influencers.tsx`, `Referrals.tsx` (disable, reverse, rate), `Stores.tsx` (on/off), and on Edit profile the **handle change**: `HandleDialog` `onSaved` closes the dialog and adopts the profile, with no "Saved." although the same page shows one for every other save.

In-place confirmations (already where the person is looking): `member/ListingRequest.tsx` (the "sent" line replaces the button), `member/threads/PostCard.tsx` (`reported` note), `onboarding/VerifyMobile.tsx` (`resent` notice), `auth/PasswordReset.tsx` (success replaces the form).

## R2. How to move the page

**Decision**: `element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior })`.

**Rationale**: `nearest` is the whole of "only if it is not in view": an element already fully visible is not moved, an element above the viewport is brought to its top edge and one below to its bottom edge, with the least movement. That is FR-001 and FR-002 with no measuring code of our own, and it works for the seven pages whether the message is at the top (1 to 6) or mid-form (7).

**Alternatives considered**:
- `window.scrollTo({ top: 0 })`: moves a page whose message is already in view, and is wrong for the push page, whose notice is mid-form.
- `scrollIntoView({ block: 'start' })` / `'center'`: always moves, even when the message is in view (FR-002).
- Moving focus onto the message: steals focus from the Save button, which FR-006 forbids; `FormMessage` is already `role="alert"`, so it is announced without it.
- A fixed or sticky toast: changes the message, which the brief says to keep as it is.

## R3. What triggers it: a new outcome, not a mount

**Decision**: a small hook keyed on the value the page already holds. The effect runs when the value changes to something truthy. A page passes the state it already has: `message` (a new object on every `setMessage({...})`), `notice` (a string, set to `null` when a send starts), or `posted || saved`.

**Rationale**: scrolling on mount (inside `FormMessage`) would miss R1 row 6: Offer categories keeps the message mounted, so a second save with the same text never mounts anything. A value that changes catches it, because each `setMessage` call makes a new object. Marketplace's two booleans are reset when the drawer opens, so each success is a `false` to `true` change. Nothing in the hook looks at the text, so nothing about the message changes (FR-003).

**Alternatives considered**: a `key` bump at every call site (remounts the message, which restarts its screen-reader announcement and re-renders children for no reason); an event emitter or context (a second mechanism where props already carry the fact).

## R4. When it runs: one frame after the commit

**Decision**: the effect schedules `requestAnimationFrame` and cancels it in its cleanup.

**Rationale**: in Marketplace one commit sets `posted`/`saved` *and* closes the drawer. `Drawer` then closes the dialog and calls `returnFocusTo.current.focus()` in its own effect, and `focus()` scrolls the button into view by default. A layout effect or a plain effect would run before or among those and then be overtaken; one frame later the page has settled and the message's own move is the last one (FR-005). It is also after layout, so the message's position is known.

**Alternatives considered**: `useLayoutEffect` (runs first, then overtaken by the focus scroll); `setTimeout(0)` (works, not frame-aligned); `focus({ preventScroll: true })` in `Drawer` (changes a shared component for every caller to fix one page, and hides the focus move from keyboard users who may need it).

## R5. Reduced motion

**Decision**: `behavior: 'smooth'`, or `'auto'` when `window.matchMedia('(prefers-reduced-motion: reduce)').matches`, read at the moment of the move; `matchMedia` missing (jsdom) means `'auto'`.

**Rationale**: FR-007, and it follows the person's current setting. The alternative of `html { scroll-behavior: smooth }` with a reduce override would animate every scroll on every page (anchor links, focus, find in page), which is a much bigger change than asked.

## R6. Breathing room

**Decision**: `scroll-my-6` on the root of `FormMessage` and `Callout`.

**Rationale**: `scroll-margin` tells `scrollIntoView` to leave a gap, so a message brought to the top edge is not flush against the browser chrome. It has no effect on layout or colour, so the message looks as it does today (FR-003). It is a class, not an inline style, because the CSP allows styles by nonce only and utilities live in the nonce'd stylesheet. Tailwind v4 ships `scroll-my-*`.

## R7. How the page gives the hook its element

**Decision**: `useReveal` returns a ref; `FormMessage` and `Callout` take a `ref` prop and put it on their root. React 19 passes `ref` as an ordinary prop to a function component, as `Button` already documents (`Button.tsx`, "React 19 passes `ref` as a prop").

**Rationale**: the message is a component the page does not own the DOM node of. A ref prop is the smallest way in, and it adds no wrapper element (a wrapper `div` would sit in the page's `flex gap-6` column and change its spacing).

## R8. Success only, or the whole slot?

**Decision**: the hook reveals whatever the page puts in the slot, so refusals shown there (R1, User Story 3) are included. The hook never reads a tone.

**Rationale**: it is the same defect (an outcome off screen), and filtering to `tone === 'success'` would make every call site carry a condition. The client logs most failures to the console and shows none (`CLAUDE.md`), so the refusals that *are* shown are exactly the ones the person cannot proceed without knowing; they are the ones worth revealing. If the brief's literal "success only" is wanted, a call site passes `message?.tone === 'success' ? message : null`; no other code changes.

## R9. Keeping the next page from forgetting (FR-010)

**Decision**: a source-scan test in the manner of `tests/loading-states.test.tsx`: every `.tsx` under `client/src` that contains `setMessage({ tone: 'success'` or `<FormMessage … tone="success"` must call `useReveal` (the patterns are that narrow because `StatusPill` also has tones), except an allow-list with a reason per entry (`auth/PasswordReset.tsx`: the success replaces its own form, in view). A second assertion names the seven pages of R1 and requires each to call `useReveal`, which also covers the two that use `Callout` and not a success tone.

**Limit, stated plainly**: a new page that shows its success in a `Callout` and is not on the named list is not caught. The scan is a net for the common shape, not a proof.

## R10. Testing without a layout engine

jsdom has no layout, no `Element.prototype.scrollIntoView` and no `window.matchMedia`. So:
- The code calls `scrollIntoView` with an optional call, with a comment (as `Drawer` does for `showModal`). Without it, every existing test that now renders a message would throw.
- Tests install a spy on `Element.prototype.scrollIntoView` (a small helper in `tests/helpers`) and read the element it was called on from the spy's `mock.contexts`, so a test asserts *which* element was revealed and with which options.
- Each test has its counter-assertions, as the repo's convention requires: **not** called on first render, **not** called while the request is held, **not** called for a failure the page does not show, and called with the message element once the save returns.
- "Already in view means no move" is the browser's behaviour for `nearest`, which jsdom cannot show. It is checked in a real browser by the manual steps in `quickstart.md`.

## R11. Observed, not changed

`FormMessage` is `role="alert"`; `Callout` has no live-region role. So the Marketplace "Posted/Saved" and the push "queued" notices, which are `Callout`s, are not announced to a screen-reader user when they appear. The brief says to keep the message as it is, so this is left alone and recorded here as a likely follow-up (a one-attribute change on the call sites).
