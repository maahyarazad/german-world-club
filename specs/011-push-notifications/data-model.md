# Data Model: Push Notifications (011)

Two migrations: `server/migrations/028_push_outbox.sql` (everything below except the offer trigger) and `029_offer_push_trigger.sql` (the trigger, kept separate because the runner applies each filename once). It evolves the tables from `011_push_devices_and_campaigns.sql` rather than replacing them, so campaign history already sent is kept.

## push_devices (changed)

| Column | Type | Change | Notes |
|---|---|---|---|
| id | uuid PK | — | |
| member_id | uuid FK members | — | |
| token | text | **UNIQUE (token)** replaces UNIQUE (member_id, token) | A token belongs to one member (FR-004). Registration takes over the row. |
| provider | push_provider | — | The app always sends `expo`. |
| platform | push_platform | — | |
| enabled | boolean | — | The device-level "all off" switch. |
| **locale** | text NOT NULL DEFAULT 'de' CHECK (locale IN ('de','en')) | new | Chooses which text this device gets (R5). |
| **session_id** | uuid NULL | new | The session that registered it. Sign-out deletes by it (R3). No FK, because sessions are pruned. |
| **disabled_reason** | text NULL | new | `'unregistered'` when a provider reports a dead token (R6). Registering again clears it. |
| last_seen_at, created_at, updated_at | timestamptz | — | |

Migration step: before swapping the unique constraint, for each duplicate token keep the row with the newest `last_seen_at` and delete the rest.

## member_push_preferences (new)

| Column | Type | Notes |
|---|---|---|
| member_id | uuid PK FK members | |
| offers | boolean NOT NULL DEFAULT true | |
| broadcasts | boolean NOT NULL DEFAULT true | |
| updated_at | timestamptz NOT NULL DEFAULT now() | |

No row means both are on (R13). There's no DELETE route, so a member changes preferences but never removes them.

## push_notifications (renamed from push_campaigns, extended)

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| **kind** | push_kind ENUM ('rehearsal','broadcast','offer') NOT NULL | Replaces `is_test`, which is back-filled: true → rehearsal, false → broadcast. `is_test` stays as a generated column so existing history queries still work. |
| **status** | push_status ENUM ('queued','sending','done','partial','failed','cancelled') NOT NULL DEFAULT 'queued' | Existing rows become `done`. |
| **idempotency_key** | text NOT NULL UNIQUE | Staff: `clientRef`. Offer: `'offer:'||offer_id`. Back-filled: `'legacy:'||id`. |
| **payload_hash** | text NULL | sha256 of the canonical `{kind, de, en, destination}` for staff sends. The same key with a different hash → 409 `push/idempotency-conflict`. NULL for offer rows and back-filled rows. |
| title → **title_de**, body → **body_de** | text | Renamed. Length checks unchanged (1..65 / 1..240). |
| **title_en**, **body_en** | text | Same checks. Back-filled from the German text for history. |
| destination_type, destination_id, destination_label | text | CHECK destination_type IN DESTINATION_TYPES or NULL. |
| **offer_id** | uuid NULL FK offers | Set only for kind `offer`. CHECK `(kind = 'offer') = (offer_id IS NOT NULL)`. |
| **audience** | text NOT NULL | `'test'`, `'broadcasts'` or `'offers'`. Chooses the preference column applied (R13). |
| **not_before** | timestamptz NOT NULL DEFAULT now() | Offer: `greatest(now(), valid_from)`. |
| sent_by | uuid FK admin_users NULL | NULL for offer notifications. |
| **created_at** | timestamptz | The old `sent_at` becomes `created_at`. `sent_at` is now "first batch sent". |
| sent_at, **finished_at** | timestamptz NULL | |
| **lease_until** | timestamptz NULL | Claim held by the dispatcher (R1). |
| total_success, total_failure, expo_*, fcm_* | integer | Recomputed from deliveries at finish. |

Titles and bodies for kind `offer` are NULL until dispatch fills them. The CHECK is `kind = 'offer' OR (title_de IS NOT NULL AND …)`.

### State transitions

```
queued ──dispatch claims──▶ sending ──all deliveries terminal──▶ done      (no failures)
   │                           │                            ├──▶ partial   (some failed)
   │                           │                            └──▶ failed    (none delivered, ≥1 device)
   └──offer no longer published / expired at dispatch──▶ cancelled
```

`done`, `partial`, `failed` and `cancelled` are final. A trigger refuses any change away from a final state. An audience of 0 devices ends as `done` with zero totals.

## push_deliveries (renamed from push_campaign_recipients, extended)

| Column | Type | Notes |
|---|---|---|
| notification_id | uuid FK push_notifications ON DELETE CASCADE | |
| device_id | uuid FK push_devices **ON DELETE SET NULL** | |
| member_id | uuid | Kept after the device is gone. |
| ~~token~~ | — | **Dropped.** A token doesn't need copying into history (FR-029). Legacy rows lose it. |
| provider, platform | enums | Snapshot. |
| locale | text | Which text was sent. |
| **status** | push_delivery_status ENUM ('pending','sending','sent','delivered','failed','skipped') | `sending` = claimed and handed to the provider, outcome not yet saved. A `sending` row past its lease becomes `failed` / `outcome unknown` and is never resent (research R2). `sent` = the provider accepted it (ticket ok). `delivered` = the receipt confirmed it (Expo). `skipped` = no longer eligible when claimed (member locked, preference off, device disabled). |
| **attempts** | integer NOT NULL DEFAULT 0 | Up to 5 (R6). |
| **next_attempt_at** | timestamptz NOT NULL DEFAULT now() | Backoff. |
| **provider_ref** | text NULL | Expo ticket id, used for receipts. |
| error_message | text NULL | At most 500 characters, and never contains the token. |
| **updated_at** | timestamptz | |

PK/UNIQUE: **(notification_id, device_id)** replaces (campaign_id, token) (R2). Index on `(notification_id) WHERE status = 'pending'` and on `(provider_ref) WHERE status = 'sent'`.

## push_test_recipients (unchanged)

Adds and removes are now audited (`push_test_recipient_added` / `_removed`).

## offers (trigger only)

`offers_queue_push AFTER INSERT OR UPDATE OF state`. Behaviour is described in research R12. It honours `current_setting('gwc.suppress_offer_push', true) = 'on'` for the seeder.

## Audience query (for reference, not an implementation)

A device is eligible for notification *n* when all of these hold:
- the device is `enabled` and `disabled_reason IS NULL`
- the member is `status = 'active'`
- the member has no `membership_applications` row, or its status is `approved`
- *n*.audience = `test`: the member is in `push_test_recipients`
- *n*.audience = `broadcasts` / `offers`: `COALESCE(pref.broadcasts / pref.offers, true)`

This is evaluated at materialisation and again when each batch is claimed (edge case: status changes mid-broadcast). The query lives in one exported constant, `ELIGIBLE_DEVICE`, in `push/application/audience.ts`, following the `VISIBLE_POST` convention: `GET /push/audience`, materialisation and claim all use it.

## Jobs (job_definitions)

| Name | Schedule | Work |
|---|---|---|
| `push.deliver` | `* * * * *` | Sweep: dispatch due notifications and retry due deliveries (R1). |
| `push.receipts` | `*/15 * * * *` | Expo receipts. Disables dead devices (R6). |
| `push.prune-devices` | existing | Unchanged. |
