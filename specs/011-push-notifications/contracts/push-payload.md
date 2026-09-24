# Push Payload & Deep-Link Contract (011)

What arrives on the phone. The server builds it in the dispatcher, and the app reads it in `NotificationRouter`. The shared constants are in `@gwc/contracts/push`.

## Destination types

```ts
export const DESTINATION_TYPES = ['offer', 'listing', 'thread_post', 'event', 'partner', 'article', 'none'] as const
export type DestinationType = typeof DESTINATION_TYPES[number]
```

`offer`, `listing` and `thread_post` are new. `article` stays for history, but the app has no screen for it (research R10).

| type | `id` is | Mobile route |
|---|---|---|
| offer | offer uuid | `/(member)/activity/offer/[id]` |
| listing | listing uuid | `/(member)/activity/listing/[id]` |
| thread_post | post uuid | `/(member)/threads/[id]` |
| event | event uuid | `/(member)/events/[id]` |
| partner | organisation **slug** | `/(member)/threads/organisation/[slug]` |
| article, none | — | no navigation |

## Message sent to Expo

```jsonc
{
  "to": "ExponentPushToken[…]",
  "title": "<title in the device's locale>",
  "body": "<body in the device's locale>",
  "sound": "default",
  "channelId": "default",
  "data": {                       // every value is a string (normalizeData)
    "v": "1",                     // payload version; the app ignores versions it doesn't know
    "nid": "<notification uuid>", // for dedupe and support
    "type": "<DestinationType>",
    "id": "<destination id or ''>"
  }
}
```

`data` never contains member data, tokens or offer prices.

## Offer text template

```ts
export const OFFER_PUSH_TEMPLATE = {
  de: { title: 'Neues Angebot: {merchant}', body: '{title}' },
  en: { title: 'New offer: {merchant}',     body: '{title}' },
} as const
```

The rendered text is trimmed to 65 and 240 characters with an ellipsis. This is the only place the server truncates rather than refuses, because the offer title is merchant-authored and already accepted.

## App behaviour

1. Tap received (cold start: `useLastNotificationResponse`; warm: `addNotificationResponseReceivedListener`). Ignored if `nid` has already been handled.
2. `v !== '1'`, an unknown `type`, or `none`/`article`: no navigation.
3. Session `loading`: wait. `signedOut`/`applicant`/`organisation`: hold the destination and replay it once the state becomes `member`, then drop it.
4. `router.push(toHref(resolveDestination(data)))`. `resolveDestination` and `DESTINATION_ROUTES` are exported from `@gwc/contracts/push` and tested there. The screen loads through the normal API, and a 404 shows the existing "not available" state.
