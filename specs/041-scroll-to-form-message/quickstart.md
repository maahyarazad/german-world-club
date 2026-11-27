# Quickstart: validating "bring the outcome of a save into view"

**Feature**: 041-scroll-to-form-message. Run from the repository root. The hook, the two ui components and the per-page behaviour are described in [contracts/ui-contract.md](./contracts/ui-contract.md); the reasons are in [research.md](./research.md).

## Automated

```bash
npm run -w client test                 # all client suites, including the new ones
npm run -w client test -- use-reveal outcome-reveal   # just this feature's
npx tsc --noEmit -p client             # types (the ref prop, the hook's generic); `npm run typecheck` runs every workspace
npm run -w client lint
npm run -w client test:i18n            # no string was added: the catalogues still agree
npm run -w client test:tokens          # no colour literal was added
```

What the new tests prove, each with its counter-assertion:

| Suite | Proves | Counter-assertion |
|---|---|---|
| `tests/lib/use-reveal.test.tsx` | The element is revealed with `block: 'nearest'` after the value changes to something truthy; a new object with the same text reveals again; `behavior` is `auto` under reduced motion and `smooth` otherwise; no `scrollIntoView` and no `matchMedia` (jsdom) is not an error | Not called on first render with no outcome, nor when the value goes to `null`, nor when it is unchanged across renders, nor after unmount |
| `tests/member/outcome-reveal.test.tsx` | Edit profile: the `FormMessage` "Saved." is the revealed element after a save returns. Marketplace: the "Saved" `Callout` is the *last* element revealed after the drawer closes | Not called on load, nor while the request is held; a refused save the page does not show reveals nothing |
| `tests/organisation/outcome-reveal.test.tsx` | Profile, Store (including a second save), Offer editor (update; a create navigates away and reveals nothing) | Same; and the stale-edit refusal on Store and Offer editor, and the Offers publish refusal, are revealed (User Story 3) |
| `tests/console/outcome-reveal.test.tsx` | Offer categories: the second save with the same text reveals again (its message stays mounted). Push: the "queued" notice is revealed | A `move` (which shows no message) reveals nothing |
| `tests/outcome-reveal-guard.test.ts` | Every file with `setMessage({ tone: 'success'` or `<FormMessage … tone="success"` calls `useReveal`, except the allow-listed `auth/PasswordReset.tsx`; the seven pages of FR-009 each call it | A fixture file with a success message and no hook fails the scan |

Existing suites must pass unchanged. They render these same pages under jsdom, which has no `scrollIntoView` or `matchMedia`; passing is the proof the guards work.

## Manual, in a real browser

jsdom cannot show layout, so "already in view means no move" and the drawer sequence are checked here once. Needs the dev stack with demo data (the server's credentials table lists a member, a merchant and a staff login):

```bash
npm run -w server dev
npm run -w server seed:demo
npm run -w client dev
```

Make the window short (about 500 px high) so the top of each page is out of view when you scroll, then for each row sign in as the account named, scroll down, make the change, press Save:

| # | Page | As | Change | Expect |
|---|---|---|---|---|
| 1 | Edit profile `/konsole/mitglied/profil/bearbeiten` | member | edit the bio, Save | page eases up to "Saved."; the Save button keeps keyboard focus |
| 2 | Marketplace (the member home, `/konsole/mitglied`), My listings | member | edit a listing, Save in the drawer | drawer closes; "Saved" callout is fully on screen (not above the fold) |
| 3 | Organisation profile (`…/profil` in the merchant portal) | merchant | change a field, Save | "Saved." in view |
| 4 | Store (`…/shop`) | merchant | add a gallery photo | "Saved." in view; do it again: in view again |
| 5 | Offer editor (`…/angebote/:id`, an existing offer) | merchant | change the title, Save | "Saved." in view |
| 6 | Offer categories (`/konsole/admin/angebotskategorien`) | admin | rename one, Save; rename another, Save | in view both times, though the text is the same |
| 7 | Push, Compose (`/konsole/admin/push`) | admin with `write` | send a rehearsal | the "queued" notice is in view |

Then the counter-checks:

- **No move when in view**: scroll to the very top, repeat row 1. The page does not move at all.
- **Reduced motion**: turn on "reduce motion" in the operating system, repeat row 1. The page jumps with no easing.
- **No move on load**: reload each page, with the message not yet shown. Nothing moves.
- **Focus**: after row 1, Tab once. Focus goes to the control after Save, not to the top of the page.
- **Refusal (User Story 3)**: on Store, open it in two tabs, save in one, then save a stale edit in the other. The conflict message is in view.
- **Nothing else changed**: the message looks as before (colour, text, place); no text in either language is new.

## Done when

All automated checks pass, the seven rows and the counter-checks behave as listed, and `CLAUDE.md` carries the paragraph under Conventions.
