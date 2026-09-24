# HTTP API: Push Notifications (011)

Types live in `@gwc/contracts/push` and `@gwc/contracts/offers` (Principle I). Errors are RFC 9457 problems, and clients branch on `type`. Every route declares `config.auth`, a budget and a rate-limit bucket.

## Member routes

All are `auth: { audience: 'member' }` **without** `onboarding: true`, so applicants who aren't approved are refused by 10-auth (R4).

### POST /push/devices — register or refresh this device (changed)

Budget `member-write`, bucket `write-heavy`.

```ts
// request: deviceRegistrationSchema
{ token: string; provider: 'expo' | 'fcm'; platform?: 'ios' | 'android'; locale: 'de' | 'en'; enabled?: boolean }
// 200: Device
{ id; provider; platform; locale; enabled; tokenPreview; lastSeenAt; createdAt }
```

- Upserts on `token`. A token held by another member moves to the caller. `session_id` is set to the caller's session and `disabled_reason` is cleared.
- `locale` is **new and required**, because the app always knows it.

### PATCH /push/devices/:id — change enabled / locale (new)

`{ enabled?: boolean; locale?: 'de'|'en' }` → `200 Device`. A device that isn't the caller's gets `404 not-found` (the ownership rule).

### GET /push/devices, DELETE /push/devices/:id

Unchanged. DELETE of another member's device returns `404`, the same as today.

### GET /push/preferences · PUT /push/preferences (new)

Budget `member-read` / `member-write`.

```ts
// 200 / PUT body
{ offers: boolean; broadcasts: boolean }
```

### GET /member/offers/:id (new, module `offers`)

Budget `member-read`, bucket `member-api`.

```ts
// 200: MemberOffer
{
  id: string; title: string; description: string | null
  benefit: { kind: 'percentage'|'fixed_amount'|'member_price'|'value_add'; value: number | null }
  regularPriceCents: number | null; memberPriceCents: number | null; currency: string
  validFrom: string; validUntil: string; conditions: string | null
  merchant: { displayName: string; slug: string; logo: ImageRef | null }
}
```

`404 not-found` unless `state = 'published'` and it is currently valid. The response is indistinguishable from an unknown id.

### POST /auth/sign-out (changed behaviour, same contract)

In the same transaction as the revocation, it deletes `push_devices WHERE session_id = <revoked session>` (R3).

## Staff routes

All are `auth: { audience: 'staff', module: 'mass_messages', flag }`.

### GET /push/audience?kind=broadcast|rehearsal (new) — flag `read`

`200 { members: number; devices: number }`. It uses the `ELIGIBLE_DEVICE` rule, so the number in the confirm dialog comes from the same query that sends (FR-016).

### POST /push/campaigns — broadcast (changed) — flag `write`

### POST /push/campaigns/preview — rehearsal (changed) — flag `write`

Budget **`admin-read`** (was `admin-report`), because no provider is called in the request (R7).

```ts
// request: campaignRequestSchema
{
  clientRef: string            // uuid, generated when the compose form opens (R2)
  de: { title: string; body: string }   // 1..65 / 1..240, trimmed
  en: { title: string; body: string }
  destination?: { type: DestinationType; id: string; label?: string }
}
// 202 (new) | 200 (same clientRef already accepted): Notification
{
  id; kind: 'rehearsal'|'broadcast'|'offer'; status: NotificationStatus
  createdAt; sentAt: string|null; finishedAt: string|null
  de: {title; body} | null; en: {title; body} | null
  destination: { type; id; label } | null
  sentBy: { id; displayName } | null
  totals: { pending; sent; delivered; failed; skipped }
}
```

- A rehearsal with an empty test list gets `409` problem type `push/no-test-recipients`, and nothing is created (acceptance scenario 3.7).
- The same `clientRef` with the same content → `200` with the existing notification. The same `clientRef` with **different** content → `409 push/idempotency-conflict`, and nothing is created. The console makes a new `clientRef` after every accepted send.
- Both routes write an audit entry (`push_rehearsal_queued` / `push_broadcast_queued`) when the request is accepted (FR-020).

### GET /push/campaigns?kind=&limit= — history (changed) — flag `read`

`200 { notifications: Notification[] }`. `kind` replaces `isTest`, and `isTest` is still accepted for one release.

### GET /push/campaigns/:id — one entry, for polling (new) — flag `read`

`200 Notification` | `404`.

### Test recipients (unchanged paths)

`GET /push/test-recipients` (read), `POST /push/test-recipients { memberId }` (edit), `DELETE /push/test-recipients/:id` (edit). Adds and removes are now audited. The console resolves a handle to a `memberId` through the existing `GET /admin/members/by-handle/:handle`.

## New problem types (`@gwc/contracts/errors`)

| type | status | when |
|---|---|---|
| `push/no-test-recipients` | 409 | Rehearsal with an empty test list |
| `push/idempotency-conflict` | 409 | `clientRef` already used for a different message |
