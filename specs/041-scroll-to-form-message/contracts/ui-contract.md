# UI contract: revealing an outcome

**Feature**: 041-scroll-to-form-message. This is the contract between the shared pieces and the pages that use them. There is no network contract: no endpoint, request or response changes.

## `useReveal` (`client/src/lib/useReveal.ts`, new)

```ts
function useReveal<T extends HTMLElement = HTMLElement>(outcome: unknown): RefObject<T | null>
```

- **Input**: `outcome`, the value the page already holds for the message it shows: the message object, the notice string, or `null`/`undefined`/`false` when there is none.
- **Returns**: a ref. The page passes it to the element that shows the message.
- **When it moves the page**: after a render in which `outcome` changed to a truthy value (compared with `Object.is`, so a new object counts as a change even with the same text), one animation frame later.
- **When it does not**: on the first render with no outcome; when `outcome` goes to a falsy value; when it is unchanged between renders; when the ref has no element by then (the message went away).
- **How it moves**: `ref.current.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior })`. `behavior` is `'smooth'`, or `'auto'` when the person prefers reduced motion or `matchMedia` is unavailable. The call is optional (`scrollIntoView?.()`), because jsdom has none.
- **Never**: moves focus, writes to the DOM, reads the message's text or tone, or calls the network.
- **Hook rules**: called unconditionally, before any early return in the page (Edit profile and the others return a loader before they render the message).

## `FormMessage` (`client/src/components/ui/Field.tsx`) and `Callout` (`client/src/components/ui/Callout.tsx`)

- Each takes one new optional prop, `ref?: Ref<HTMLDivElement>` (React 19: an ordinary prop on a function component, as `Button` documents), put on the root `div`.
- Each root gains the class `scroll-my-6`, which sets the gap `scrollIntoView` leaves. It changes nothing visible.
- Nothing else about either changes: markup, `role="alert"` on `FormMessage`, tones, text, and the props they have today.

## Pages (what each passes)

| Page | `useReveal(...)` argument | Ref goes to |
|---|---|---|
| `member/profile/EditProfile.tsx` | `message` | the `FormMessage` |
| `member/Marketplace.tsx` | `posted \|\| saved` | whichever `Callout` renders (never both) |
| `organisation/Profile.tsx` | `message` | the `FormMessage` |
| `organisation/Store.tsx` | `message` | the `FormMessage` |
| `organisation/OfferEditor.tsx` | `message` | the `FormMessage` |
| `console/admin/OfferCategories.tsx` | `message` | the `FormMessage` |
| `console/admin/Push.tsx` | `notice` | the `Callout` |
| `organisation/Offers.tsx` (User Story 3) | `message` | the `FormMessage` |

A page that adds a success message in this slot passes its state here and gives the ref to the message; `tests/outcome-reveal-guard.test.ts` fails the build if a file with a success-toned message does not call `useReveal`.

## Test helper (`client/tests/helpers/scroll-spy.ts`, new)

```ts
function installScrollSpy(): { spy: Mock; revealed(): Element[] }
```

Installs a spy on `Element.prototype.scrollIntoView` for one test (restored after), and returns the elements it was called on, in order, taken from the spy's `mock.contexts`.
