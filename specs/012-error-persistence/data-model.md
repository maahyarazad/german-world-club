# Data Model: Persisted Server Errors and Mobile Development Logging

**Feature**: 012-error-persistence | **Migration**: `server/migrations/030_server_faults.sql`

The mobile logging stores nothing. Everything here is server-side.

---

## 1. `server_faults`

One unexpected server fault that ended a request (spec: *Server fault record*). Written only by `app.recordServerFault`. Never updated. Deleted only after 30 days.

| Column | Type | Null | Rule |
|---|---|---|---|
| `id` | `uuid` | no | `DEFAULT gen_random_uuid()`, primary key |
| `occurred_at` | `timestamptz` | no | `DEFAULT now()` |
| `request_id` | `text` | no | Server-generated ULID (research R10), `CHECK (request_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$')`, **`UNIQUE`**: a request ends in at most one fault, and no client can choose the id. |
| `client_request_id` | `text` | yes | The client's correlation id if one was supplied and well-formed, `CHECK (client_request_id ~ '^[A-Za-z0-9_-]{8,64}$')`. Not unique. |
| `method` | `text` | no | `CHECK (length(method) <= 10)` |
| `route` | `text` | yes | Route **pattern**, `CHECK (length(route) <= 300)`. `NULL` when no route matched. Never a raw URL. |
| `status` | `smallint` | no | `CHECK (status BETWEEN 500 AND 599)` |
| `error_name` | `text` | no | `CHECK (length(error_name) <= 100)` |
| `error_code` | `text` | yes | `CHECK (length(error_code) <= 100)` |
| `message` | `text` | no | Scrubbed, `CHECK (length(message) <= 2000)` |
| `stack` | `text` | yes | Scrubbed, `CHECK (length(stack) <= 8000)` |
| `principal_kind` | `text` | yes | `CHECK (principal_kind IN ('member','admin','merchant','partner'))`. `NULL` = anonymous. |
| `principal_id` | `text` | yes | `CHECK ((principal_kind IS NULL) = (principal_id IS NULL))` |
| `fingerprint` | `char(64)` | no | Hex SHA-256, `CHECK (fingerprint ~ '^[0-9a-f]{64}$')` |
| `instance_id` | `text` | no | Hostname plus pid of the recording process, `CHECK (length(instance_id) <= 200)` |

**Indexes**
- `(occurred_at DESC, id DESC)`: the newest-first list and its keyset cursor
- `UNIQUE (request_id)`: lookup by request id (Story 1)
- `(client_request_id) WHERE client_request_id IS NOT NULL`: support correlation by the client's id
- `(fingerprint, occurred_at DESC)`: grouping and filtering by fingerprint (Story 3)

**Invariants, enforced in the database** (Principle IV)
- `server_faults_immutable`: a `BEFORE UPDATE` trigger raises `server fault records are never edited`.
- `server_faults_retention_floor`: a `BEFORE DELETE` trigger raises unless `OLD.occurred_at < now() - interval '30 days'`. The retention job is therefore the *only* thing that can delete, and it can only delete expired rows, even through an ad-hoc query.
- No member, organisation, contact or content column exists. `principal_id` is an opaque internal id with no foreign key, like `sessions.account_id`, so a record outlives the account it names without cascading.

**Lifecycle**: `inserted → (≥ 30 days) → deleted by server-faults.prune`. There are no other states.

---

## 2. `server_fault_suppressions`

How many faults were counted but not stored in full, per instance per minute (spec: *Suppressed-occurrence count*, FR-006).

| Column | Type | Null | Rule |
|---|---|---|---|
| `minute` | `timestamptz` | no | Truncated to the minute, `CHECK (minute = date_trunc('minute', minute))` |
| `instance_id` | `text` | no | As above |
| `suppressed` | `integer` | no | `CHECK (suppressed > 0)` |

**Primary key**: `(minute, instance_id)`. A retried flush uses `ON CONFLICT … DO UPDATE SET suppressed = server_fault_suppressions.suppressed + EXCLUDED.suppressed`, so a flush can never double-count. Principle IV's *deterministic reference* is the key itself.

The same retention as `server_faults` (same prune job, same 30-day delete floor trigger). Updates are allowed only through that upsert. The immutability trigger is **not** applied here, because the row *is* a counter.

---

## 3. Permission module

- `admin_module` enum: `ALTER TYPE admin_module ADD VALUE IF NOT EXISTS 'server_faults'`.
- `packages/contracts/src/permissions.ts`: `'server_faults'` appended to `MODULES`.
- No grant rows are inserted. Superadmins pass through `authz/permissions.ts`. Anyone else needs an explicit `read` grant from the permission editor.
- Flags used: `read` only.

---

## 4. In-process state (not persisted)

`createServerFaultRecorder` (in `server/src/decorators/server-faults.ts`) holds, per process:

| Field | Meaning |
|---|---|
| `windowMinute` | The minute currently being counted |
| `storedThisMinute` | Records stored in `windowMinute`. Compared against `SERVER_FAULTS_PER_MINUTE`. |
| `suppressedThisMinute` | Occurrences counted but not stored |
| `inFlight` | Pending inserts, capped at 2 |

When the minute rolls over, a non-zero `suppressedThisMinute` is flushed as one `server_fault_suppressions` upsert, and the counters reset. `app.metrics.serverFaults` mirrors `stored`, `suppressed` and `failed` totals for the lifetime of the process.

---

## 5. Seed and test manifests

- `server_faults` and `server_fault_suppressions` are **never seeded**. The consistent-history rule allows history only where a seeded fact implies it, and no seeded fact implies a fault. They are filed under `HISTORY` in `server/src/seed/tables.ts`, following feature 011's `push_notifications` precedent: the history rule gives them no rows because no seeded fact implies a fault. `NEVER_SEEDED` is reserved for live credentials, and `tests/seed/no-live-credentials.test.ts` enforces that. `tests/seed/table-manifest.test.ts` covers them.
- The test reset truncates both tables. The retention trigger's delete floor applies to `DELETE`, not `TRUNCATE`, and that difference is intentional and commented in the migration.

---

## 6. Configuration

| Variable | Default | Rule |
|---|---|---|
| `SERVER_FAULTS_PER_MINUTE` | `60` | Positive integer (`int(60)` in `config/env.ts`). Per instance. |
