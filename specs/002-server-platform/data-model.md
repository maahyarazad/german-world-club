# Data Model: Server Platform Foundation

**Feature**: `002-server-platform` | **Date**: 2026-09-15 | **Plan**: [plan.md](./plan.md)

Scope: the **platform layer only** — identity, authorization, sessions, audit, SEO metadata, and operations. The full member profile model of `BUSINESS_DESCRIPTION.md` §2 (events, partners, marketplace, Threads, messages, orders) belongs to later features. Where this model touches those entities it does so by reference, so the domain features can extend rather than restructure.

Conventions: `uuid` primary keys, `timestamptz` throughout, `snake_case`, soft-delete via status columns rather than row removal (§12.4). Every table carries `created_at` and `updated_at`.

**Enum types** created by the first migration, before any table references them: `member_status`, `account_kind`, `admin_module`, `approval_state`, `seo_record_type`, `asset_kind`, `asset_state`, `asset_variant`.

---

## 1. Identity

### `members`

The identity and access columns only. Profile, privacy, interests, and contact detail are §2's model and arrive with the member-profile feature.

| Field | Type | Rules |
|---|---|---|
| `id` | uuid PK | |
| `email` | citext UNIQUE NOT NULL | Required for sign-in; uniqueness is business-critical (§3.1 forbids inviting an email that already belongs to a member) |
| `email_confirmed_at` | timestamptz NULL | NULL ⇒ routed to profile completion, full access withheld (FR-011) |
| `password_hash` | text NULL | argon2id. NULL ⇒ no usable password; sign-in refused |
| `password_reset_required` | boolean NOT NULL DEFAULT false | Set true for legacy imports (R5); blocks sign-in until reset |
| `status` | member_status NOT NULL DEFAULT 'active' | See §1.1 |
| `status_changed_at` | timestamptz NOT NULL | Drives the inactivity job and staff reporting |
| `mobile` | text NULL | E.164. Required before mobile sign-in — FR-012's out-of-band code has nowhere to go without it, and §6.1 makes it a registration field |
| `mobile_verified_at` | timestamptz NULL | §6.1 verifies the number before email; NULL ⇒ OTP sign-in unavailable |
| `last_login_at` | timestamptz NULL | Input to the §3.2 inactivity cron |
| `inactivity_exempt` | boolean NOT NULL DEFAULT false | §3.2's "hidden"/exempt members are excluded from auto-deactivation |
| `email_bounce_count` | integer NOT NULL DEFAULT 0 | §8: 5+ bounces marks the address invalid |
| `email_suppressed` | boolean NOT NULL DEFAULT false | Suppresses further mail (§8); also suppresses bulk sends (§9) |

**Deliberately absent**: any column caching a membership package, tier, or discount. Entitlement is resolved from the card's validity window at point of use (FR-013, §12.2). A denormalised tier column is the exact mechanism by which a lapsed card would keep granting free events.

**Entitlement in this feature resolves to none.** No membership-card table is in scope, so `resolveEntitlement(memberId)` returns `null` and `GET /auth/me` reports `entitlement: null`. The resolver exists now, with its point-of-use contract fixed, so the card feature supplies a query rather than a new rule.

#### 1.1 `member_status` state machine (§3.2)

| From | To | Trigger | Sign-in allowed after? |
|---|---|---|---|
| — | `active` | Invitation accepted (§3.1) | Yes |
| `active` | `locked` | Staff action | No — must contact support |
| `active` | `inactive` | Inactivity cron, past the configured threshold, `inactivity_exempt = false` | No — must reset password to reactivate |
| `locked` | `active` | Staff action | Yes |
| `inactive` | `active` | Completed password reset | Yes |
| any | `ended` | Staff "end membership" | No |
| `ended` | any | **Not permitted** | — |

Row deletion is never permitted for `members` (§12.4, §3.2: "Full deletion of a member is deliberately not allowed"). Enforced by a `BEFORE DELETE` trigger that raises, so the rule survives an ad-hoc query as well as application code.

### `password_reset_tokens`

Storage for the single-use token in [auth-api.md](./contracts/auth-api.md) `POST /auth/password-reset/confirm`.

| Field | Type | Rules |
|---|---|---|
| `id` | uuid PK | |
| `account_id` / `account_kind` | uuid / account_kind | |
| `token_hash` | bytea NOT NULL UNIQUE | SHA-256 of a 256-bit random value; the plaintext is never stored |
| `issued_at` | timestamptz NOT NULL | |
| `expires_at` | timestamptz NOT NULL | 1 hour |
| `consumed_at` | timestamptz NULL | Single-use |

Consuming a token revokes **every** session for the account: the likely reason for a reset is that the previous credential is compromised.

### `admin_users`

| Field | Type | Rules |
|---|---|---|
| `id` | uuid PK | |
| `email` | citext UNIQUE NOT NULL | |
| `password_hash` | text NOT NULL | argon2id |
| `is_admin` | boolean NOT NULL DEFAULT false | Department admin (§11) |
| `is_superadmin` | boolean NOT NULL DEFAULT false | Full bypass of all module checks (FR-008) |
| `is_active` | boolean NOT NULL DEFAULT true | Inactive ⇒ sign-in refused |
| `created_by` | uuid FK → admin_users NULL | Audit lineage |

**Invariant**: at least one active superadmin must exist. Enforced by a trigger on update/delete, because a system with no superadmin cannot grant permissions to anyone and is unrecoverable without direct database access.

---

## 2. Authorization

### `admin_permissions`

The five-flag matrix of §11, one row per (admin, module).

| Field | Type | Rules |
|---|---|---|
| `admin_user_id` | uuid FK → admin_users | ON DELETE CASCADE |
| `module` | admin_module NOT NULL | Enum, see below |
| `can_read` | boolean NOT NULL DEFAULT false | |
| `can_write` | boolean NOT NULL DEFAULT false | Create |
| `can_edit` | boolean NOT NULL DEFAULT false | Modify existing |
| `can_delete` | boolean NOT NULL DEFAULT false | |
| `can_status` | boolean NOT NULL DEFAULT false | Enable/disable |
| PRIMARY KEY | `(admin_user_id, module)` | One row per pair |

`admin_module` enum, derived from §11's listed staff capabilities: `members`, `invitations`, `events`, `event_registrations`, `partners`, `partner_contracts`, `membership_orders`, `committees`, `threads_moderation`, `marketplace_moderation`, `support_tickets`, `newsletters`, `mass_messages`, `magazine`, `pages`, `seo`, `admins`, `settings`, `jobs`.

`seo` is a module in its own right, so §10.8's staff-editable SEO fields are grantable under the same five flags as any other content attribute — SEO editing becomes a staff privilege rather than a developer task.

**Absence is denial.** A missing row means no flags, never inherited or default access.

**Two-layer enforcement** (research R4):

- *Layer 1, module capability* — route declares `{ module, flag }`; the request passes if the principal is a superadmin or the corresponding flag is true.
- *Layer 2, object guard* — checked inside the handler against the loaded target row, within the transaction:

> **FR-009**: if the target of an operation on the `admins` module is itself an `is_admin` or `is_superadmin` account, only a superadmin may proceed — regardless of the caller's flags on that module.

This rule cannot be expressed as a route declaration because it depends on the target row, not the caller. It is the one privilege-escalation path in the model, and it has its own test file.

### Permission resolution and cache

A **permission snapshot** — `{ adminId, isAdmin, isSuperadmin, isActive, modules: {module: {read,write,edit,delete,status}} }` — is resolved per request from a cache with a **30 s TTL and explicit invalidation** on any write to `admin_permissions` or to an account's `is_active` / `is_admin` / `is_superadmin`.

Invalidation is the mechanism; the TTL is only a backstop. SC-003 requires a revoked permission to be refused on the target's *next* request, which a TTL alone cannot guarantee.

---

## 3. Sessions and credentials

### `sessions`

| Field | Type | Rules |
|---|---|---|
| `id` | uuid PK | The `sid` claim in the access token |
| `account_id` | uuid NOT NULL | References `members.id` or `admin_users.id` per `account_kind` |
| `account_kind` | account_kind NOT NULL | `member` \| `admin` — also the token audience (FR-003) |
| `device_id` | text NULL | Mobile device binding (§6.1, §12.6); NULL for web |
| `user_agent` | text NULL | Recorded for the audit trail, never for authorization |
| `ip_created` | inet NULL | |
| `created_at` | timestamptz NOT NULL | |
| `last_seen_at` | timestamptz NOT NULL | |
| `revoked_at` | timestamptz NULL | NULL ⇒ active |
| `revoked_reason` | text NULL | `superseded` \| `logout` \| `staff_action` \| `token_reuse` \| `status_change` |

**Single active session** (FR-004, §12.7) is a database constraint, not application logic:

```sql
CREATE UNIQUE INDEX one_active_session_per_account
  ON sessions (account_id, account_kind) WHERE revoked_at IS NULL;
```

A partial unique index makes two concurrent sign-ins a constraint violation the application handles deterministically, rather than a race whose winner depends on timing. Sign-in therefore runs as one transaction: revoke any active session (reason `superseded`), then insert the new one.

### `refresh_tokens`

| Field | Type | Rules |
|---|---|---|
| `id` | uuid PK | |
| `session_id` | uuid FK → sessions | ON DELETE CASCADE |
| `token_hash` | bytea NOT NULL UNIQUE | SHA-256 of a 256-bit random value. **The plaintext is never stored** |
| `parent_id` | uuid FK → refresh_tokens NULL | Rotation lineage |
| `issued_at` | timestamptz NOT NULL | |
| `expires_at` | timestamptz NOT NULL | 30 d web, 90 d mobile |
| `consumed_at` | timestamptz NULL | Single-use; non-NULL ⇒ already spent |

**Rotation and reuse detection** (FR-005):

| Presented token | Action |
|---|---|
| Unknown hash | Reject 401. No session exists to terminate |
| Found, `consumed_at IS NULL`, not expired, session active | Consume it, issue a new refresh token with `parent_id` set, mint a fresh access token |
| Found, `consumed_at IS NOT NULL` | **Replay.** Revoke the session (`token_reuse`), delete the whole lineage, write an audit record, reject 401 |
| Found but session `revoked_at IS NOT NULL` | Reject 401 |
| Expired | Reject 401 |

A replay is treated as compromise rather than as a retry: the legitimate holder and the attacker cannot be distinguished, so the safe action is to end the lineage and force re-authentication.

### Access token claims

```json
{ "sub": "<account uuid>", "sid": "<session uuid>",
  "aud": "member" | "admin", "typ": "access",
  "jti": "<ulid>", "iat": ..., "exp": "<iat + 600s>" }
```

Signed EdDSA (Ed25519). **No permission flags, no role matrix, no membership tier, no email.** `aud` is what makes FR-003 structural — a member token presented to a staff route fails audience verification before any handler runs.

### Revocation denylist (Redis, not PostgreSQL)

`SETEX denylist:sid:<session uuid> 600 1` on any revocation. Checked per request. Entries expire with the access-token lifetime, so the set stays proportional to recent revocations rather than to total sessions. This closes the 10-minute window from Risk 3 for sessions; permission changes never had that window, because authorization is not read from the token.

### `otp_challenges`

Mobile sign-in second factor (§6.2) and device approval (§6.1).

| Field | Type | Rules |
|---|---|---|
| `id` | uuid PK | |
| `account_id` / `account_kind` | uuid / account_kind | |
| `code_hash` | bytea NOT NULL | 4-digit code, hashed — short codes must not be readable from a database dump |
| `device_id` | text NOT NULL | Binds the challenge to the requesting device (§12.6) |
| `purpose` | text NOT NULL | `login` \| `device_approval` |
| `attempts` | integer NOT NULL DEFAULT 0 | Ceiling 5, then the challenge is invalidated (bucket `otp-verify`) |
| `expires_at` | timestamptz NOT NULL | 5 minutes |
| `consumed_at` | timestamptz NULL | Single-use |

A 4-digit code is only 10,000 possibilities, so the attempt ceiling and the 5-minute expiry — not the code's entropy — are what make it safe. Both are enforced server-side; §6.2's demo-account bypass is an explicit account flag, never an environment condition.

### `device_approvals`

§6.1: approval is tied to a device, and changing device invalidates it (§12.6).

| Field | Type | Rules |
|---|---|---|
| `member_id` | uuid FK → members | |
| `device_id` | text NOT NULL | |
| `state` | approval_state NOT NULL | `pending` \| `approved` \| `denied` |
| `denial_reason` | text NULL | §6.1 requires a reason on denial, emailed to the user |
| `reviewed_by` | uuid FK → admin_users NULL | |
| PRIMARY KEY | `(member_id, device_id)` | |

Sign-in from a device with no `approved` row routes to the waiting-for-approval flow rather than issuing tokens. Because the key includes `device_id`, a new device simply has no row — §12.6 falls out of the primary key instead of needing a separate invalidation step.

---

## 4. SEO and public content metadata

### `seo_metadata`

Staff-editable overrides (§10.8) attached polymorphically to any public content record. One row per record; absence means every value is derived from the content (FR-020).

| Field | Type | Rules |
|---|---|---|
| `id` | uuid PK | |
| `record_type` | seo_record_type NOT NULL | `page` \| `partner` \| `outlet` \| `event` \| `article` \| `committee` |
| `record_id` | uuid NOT NULL | |
| `slug` | citext NOT NULL | Human-readable, never a numeric id (FR-027). UNIQUE per `record_type` |
| `seo_title` | text NULL | Overrides the derived title |
| `meta_description` | text NULL | Overrides the derived description |
| `share_image_id` | uuid FK → assets NULL | Overrides the derived share image |
| `indexable` | boolean NOT NULL DEFAULT true | ANDed with the surface posture; the stricter wins |
| `language` | text NOT NULL DEFAULT 'de' | German-first (§10.7) |
| `translation_group_id` | uuid NULL | Groups language variants; drives reciprocal `hreflang` |
| `updated_at` | timestamptz NOT NULL | The real `lastmod` for the sitemap (FR-023) |
| UNIQUE | `(record_type, record_id)` | One override row per record |
| UNIQUE | `(record_type, slug)` | Slug collisions are a 500 waiting to happen |

See §4.1 for `assets` and `asset_variants`. `alt` is NOT NULL on `assets`, and `width`/`height` are recorded before the upload request completes, because FR-018 requires share images to emit explicit dimensions and alt text and §10.9 names unsized images as the most common cause of layout shift.

### 4.1 `assets` and `asset_variants`

`assets` is the uploaded original; `asset_variants` are the derivatives actually delivered (FR-055 to FR-062). Nothing references an original as a rendering path (FR-060).

**`assets`**

| Field | Type | Rules |
|---|---|---|
| `id` | uuid PK | |
| `kind` | asset_kind NOT NULL | `image` \| `video` |
| `mime` | text NOT NULL | Determined by **content inspection**, never the filename or client-declared type (FR-052) |
| `checksum` | bytea NOT NULL UNIQUE | SHA-256 of the stored bytes. Content-addressed, so two identical uploads store once |
| `bytes` | bigint NOT NULL | Original size |
| `width` / `height` | integer NOT NULL | Probed synchronously before the request completes (FR-055) |
| `duration_ms` | integer NULL | Video only |
| `alt` | text NOT NULL | Required — §10.1 calls out galleries needing alt text |
| `state` | asset_state NOT NULL | See §4.2 |
| `failure_reason` | text NULL | Non-NULL only in `failed`; a stuck `processing` row is a defect (FR-059) |
| `uploaded_by` / `uploader_kind` | uuid / account_kind | Drives the per-account quota (FR-063) |
| `storage_key` | text NOT NULL | Path in the storage driver, derived from `checksum` |

**`asset_variants`**

| Field | Type | Rules |
|---|---|---|
| `asset_id` | uuid FK → assets | ON DELETE CASCADE |
| `variant` | asset_variant NOT NULL | `thumb` \| `small` \| `medium` \| `large` \| `poster` \| `video` |
| `format` | text NOT NULL | `webp` \| `png` \| `jpeg` \| `webm` |
| `width` / `height` | integer NOT NULL | Actual output dimensions — **never** larger than the source (FR-056) |
| `bytes` | bigint NOT NULL | FR-061 |
| `storage_key` | text NOT NULL | Content-addressed ⇒ immutable ⇒ cacheable indefinitely (FR-062) |
| PRIMARY KEY | `(asset_id, variant, format)` | One row per size × format |

Breakpoints: `thumb` 160 px, `small` 400 px, `medium` 800 px, `large` 1600 px — width-capped, aspect preserved, **never upscaled**, so a 300 px source yields `thumb` and `small` only.

Formats: **WebP is primary.** The fallback is PNG when the source has an alpha channel and JPEG when it does not — PNG for photographic content is typically 5–10× larger than either, which would work against the whole purpose of the pipeline. Video is WebM plus a WebP `poster` frame.

#### 4.2 `asset_state` state machine

| From | To | Trigger |
|---|---|---|
| — | `ready` | Image upload: validated, stripped, probed, and all derivatives written inside the request budget |
| — | `processing` | Video upload: original stored and probed; derivatives queued (FR-059) |
| `processing` | `ready` | Derivative job completed |
| `processing` | `failed` | Derivative job failed or exceeded its budget; `failure_reason` set |
| `failed` | `processing` | Explicit retry |

`ready` is the only state a surface may render from. Nothing is recorded `ready` on a derivative-generation failure (FR-059, and Principle V's fail-explicit rule).

### Derived, not stored

Three things are **computed per request** rather than persisted, because §10.4 requires published state to match real state (FR-022, §12.14):

| Output | Computed from |
|---|---|
| `Event.eventStatus` / `offers.availability` | The event's live registration window and remaining capacity across all sources (§4) |
| `LocalBusiness` presence for a partner | `contract_start + duration + grace >= now` (§5) |
| Sitemap membership | `published AND indexable AND (partner ⇒ in contract)` |

Caching any of these is how an event gets advertised as available after registration closed — which §10.4 calls "both an SEO penalty and a factual misstatement to members."

### `legacy_redirects`

| Field | Type | Rules |
|---|---|---|
| `legacy_path` | text PK | Normalised: lowercase, no trailing slash, no query |
| `target_path` | text NOT NULL | |
| `status` | smallint NOT NULL DEFAULT 301 | 301 or 410 |
| `note` | text NULL | Why this mapping exists |

Populated from the club's legacy URL inventory (FR-029). The mechanism ships empty and tested, so arrival of the inventory is data entry rather than development.

### Surface posture table (code, not data)

`server/src/seo/surfaces.js` is the single encoding of §10.1's table. It drives three things at once: the route-posture registry, the generated `robots.txt`, and the `X-Robots-Tag` header. Held in code rather than in the database because it is a design decision reviewed in a pull request, not an operational setting — and because a startup gate depends on it.

| Surface | Public | Indexed |
|---|---|---|
| Landing / coming-soon / marketing | yes | yes |
| Magazine articles & news | yes | yes |
| Partner listing & outlet pages | yes | yes |
| Public event pages | yes | yes |
| Event recaps & galleries | yes | yes |
| Committee / about / legal | yes | yes |
| Member portal | no | **never** |
| Threads feed & posts | no | **never** |
| Real-time messaging | no | **never** |
| Marketplace listings | no | **never** |
| Event registration & checkout | no | **never** |
| Invitation / registration-code links | no | **never** |
| Staff admin console | no | **never** |

Gated surfaces are excluded by **both** access control and crawl directive (FR-025), because §10.1 notes that URL shapes leak through referrers and shared links regardless of whether the content is reachable.

---

## 5. Audit and operations

### `audit_log`

Append-only. Separate from application logs: log records rotate and belong to operators, whereas these are business evidence that must be queryable by staff and must survive rotation.

| Field | Type | Rules |
|---|---|---|
| `id` | bigserial PK | |
| `occurred_at` | timestamptz NOT NULL | |
| `request_id` | text NULL | Correlates to the application log (FR-047) |
| `actor_id` / `actor_kind` | uuid / account_kind NULL | NULL for anonymous attempts |
| `action` | text NOT NULL | `sign_in` \| `sign_in_refused` \| `permission_denied` \| `permission_changed` \| `session_revoked` \| `token_reuse` \| `status_changed` \| `seo_changed` |
| `target_type` / `target_id` | text / uuid NULL | The object acted on |
| `required_permission` | text NULL | FR-015: the module and flag that was required |
| `outcome` | text NOT NULL | `allowed` \| `denied` \| `error` |
| `detail` | jsonb NULL | **Never** credentials, tokens, OTPs, or contact details (FR-048) |

UPDATE and DELETE are revoked at the grant level for the application role, so append-only is enforced by the database rather than by convention.

### `job_runs`

§11 makes scheduled jobs admin-managed entities whose every run is logged.

| Field | Type | Rules |
|---|---|---|
| `id` | bigserial PK | |
| `job_name` | text NOT NULL | |
| `started_at` / `finished_at` | timestamptz / NULL | NULL finish ⇒ still running or crashed |
| `outcome` | text NULL | `success` \| `failure` \| `skipped` |
| `error` | text NULL | |
| `items_processed` | integer NULL | Bulk-send batch accounting (§9) |

### `job_definitions`

| Field | Type | Rules |
|---|---|---|
| `name` | text PK | |
| `schedule` | text NOT NULL | Cron expression |
| `enabled` | boolean NOT NULL DEFAULT true | §11: individually enableable/disableable |
| `last_run_at` | timestamptz NULL | |

Platform-layer jobs only for now — session and OTP cleanup, sitemap cache invalidation, denylist pruning. The §3.2 inactivity sweep, §7 birthday greetings, and §9 bulk-send pacing arrive with their own features and register against this table.

---

## 6. Runtime configuration (code, not database)

These are startup-validated code constants, not rows, because a wrong value must prevent boot rather than take effect silently.

| Config | Contents | Startup check |
|---|---|---|
| `budgets.js` | Per-route-class handler deadlines and per-dependency outbound budgets | **Σ outbound < route deadline < `requestTimeout`** (FR-033); startup fails otherwise |
| `rate-limits.js` | Named buckets: dimension, allowance, window, `skipOnError` | Every bucket must set `skipOnError` explicitly (FR-044) |
| `breakers.js` | Per dependency: timeout, threshold, reset, `errorFilter`, fallback | Every dependency must declare a fallback policy (FR-037) |
| `env.js` | Zod-validated environment | Production boot fails if `trustProxy` or the canonical origin is unset (Risk 4) |

---

## 7. Entity relationships

```text
members ──1:N── sessions ──1:N── refresh_tokens (lineage via parent_id)
   │               │
   │               └── at most ONE active per (account_id, account_kind)   [partial unique index]
   ├──1:N── otp_challenges        (per device, per purpose)
   └──1:N── device_approvals      (PK includes device_id ⇒ new device has no approval)

admin_users ──1:N── admin_permissions   (PK: admin_user_id + module; five flags)
      │                     ▲
      │                     └── snapshot cached 30s, invalidated on write
      └──1:N── sessions      (account_kind = 'admin'; separate token audience)

public content record ──0:1── seo_metadata ──0:1── assets ──1:N── asset_variants
        │                            │                   │
        │                            │                   └── state must be 'ready' to render;
        │                            │                       variants are content-addressed + immutable
        │                            │
        │                            └── translation_group_id ⇒ reciprocal hreflang
        └── structured data + sitemap membership: DERIVED per request, never stored

audit_log          — append-only; references actors and targets by id, no FK (records outlive rows)
job_definitions ──1:N── job_runs
```

## 8. Validation rules summary

| Rule | Source | Enforced by |
|---|---|---|
| One active session per account | §12.7, FR-004 | Partial unique index |
| A member row is never deleted | §12.4, §3.2 | `BEFORE DELETE` trigger |
| At least one active superadmin exists | §11 (recoverability) | Trigger on update/delete |
| Refresh token is single-use; replay kills the lineage | FR-005 | `consumed_at` + transaction |
| Refresh plaintext is never stored | R2 | Column is `bytea` of SHA-256 |
| No authorization or entitlement in tokens | FR-006, FR-013 | Claim schema; a test asserts the claim set |
| Absent permission row means denial | §11, FR-007 | Resolution returns all-false |
| Non-superadmin cannot touch an admin row | FR-009 | Object guard, in-transaction |
| Slugs are unique per record type | FR-027 | UNIQUE `(record_type, slug)` |
| Share images carry dimensions and alt text | FR-018 | NOT NULL on `assets` |
| Upload type comes from content, not filename | FR-052 | `mime` set by magic-byte inspection |
| A derivative is never upscaled | FR-056 | Generator clamps to source dimensions; asserted in tests |
| Every derivative records format, dimensions, bytes | FR-061 | NOT NULL on `asset_variants` |
| Identical uploads store once | §4.1 | UNIQUE on `assets.checksum` |
| Only a `ready` asset is rendered | FR-059, FR-060 | `asset_state`; surfaces filter on it |
| Reset token is single-use and expiring | U2 / auth-api | `consumed_at` + `expires_at` |
| Mobile number exists before OTP sign-in | FR-012 | `mobile_verified_at IS NOT NULL` gate |
| Indexability is the stricter of record flag and surface posture | FR-025 | `buildPageMeta` |
| Sitemap excludes lapsed partners | FR-023, SC-008 | Query predicate, not a staff action |
| Audit records are append-only | FR-015 | Revoked UPDATE/DELETE grants |
| Every bucket declares store-failure behaviour | FR-044 | Startup validation |
| Σ outbound budgets < route deadline | FR-033 | Startup assertion |
