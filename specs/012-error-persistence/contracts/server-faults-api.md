# Contract: Server Faults Staff API

**Feature**: 012-error-persistence | Types: `packages/contracts/src/server-faults.ts` (exported as `@gwc/contracts/server-faults`)

Both routes are staff-only, read-only, and served under `/admin`. That prefix is already gated and never indexed (`seo/surfaces.ts`), so there is no new crawl posture to declare.

| Posture | Value |
|---|---|
| `config.auth` | `{ audience: 'staff', module: 'server_faults', flag: 'read' }` |
| `config.budget` | `'admin-read'` |
| `config.rateLimit` | `app.bucket('admin-api')` |
| `onRequest` | `app.guard` |

---

## Shared type

```ts
export type ServerFault = {
  id: string
  occurredAt: string          // ISO 8601
  requestId: string           // server-generated ULID
  clientRequestId: string | null  // client correlation id, if supplied
  method: string
  route: string | null        // pattern, e.g. "/member/events/:id"
  status: number              // 500–599
  errorName: string
  errorCode: string | null
  message: string             // scrubbed, ≤ 2000
  stack: string | null        // scrubbed, ≤ 8000
  principalKind: 'member' | 'admin' | 'merchant' | 'partner' | null
  principalId: string | null
  fingerprint: string         // 64 hex chars
}
```

The list returns `ServerFaultSummary`, which is `ServerFault` without `stack`, to keep the page light. The lookup returns the full `ServerFault`.

---

## `GET /admin/server-faults`

Newest first, keyset-paginated.

**Query**

| Param | Type | Rule |
|---|---|---|
| `before` | string | Optional opaque cursor from a previous `nextCursor` |
| `fingerprint` | string | Optional, `^[0-9a-f]{64}$`. Only this fault's occurrences. |
| `clientRequestId` | string | Optional, `CLIENT_REQUEST_ID` shape. Only faults whose request carried this client correlation id. |
| `limit` | integer | Optional, 1–100, default 50 |

**200**

```ts
{
  items: ServerFaultSummary[]
  nextCursor: string | null                 // null = no older rows
  suppressedLast24h: number                 // Σ server_fault_suppressions.suppressed, last 24 h
}
```

**Errors**: `401 unauthenticated`, `403 insufficient-permission` (no `server_faults.read`), `400 validation-failed` (bad cursor, fingerprint, clientRequestId or limit), `429 rate-limited`.

---

## `GET /admin/server-faults/by-request/:requestId`

**Params**: `requestId` matching `REQUEST_ID` from `@gwc/contracts/request-id` (a ULID). A client correlation id is **not** accepted here; use the list's `clientRequestId` filter instead.

**200**: `{ item: ServerFault }`. Exactly one, because request ids are server-generated and unique (research R10).

**404 `not-found`**: no record has this request id. The body is the ordinary `NOT_FOUND` problem, identical to any absent resource. It does **not** say whether the request existed and succeeded, and it does not distinguish "expired by retention" from "never failed".

**Errors**: as above.

---

## Not provided, deliberately

- No `POST`, `PATCH`, `PUT` or `DELETE`. Records are never edited, and only the retention job removes them (FR-010). The `write`, `edit`, `delete` and `status` flags on `server_faults` are unused, and the access-control matrix test asserts that each non-`GET` method on these paths answers `404`.
- No member, merchant or partner access. The audience check refuses those tokens before permissions are resolved.

---

## Console page

`/konsole/admin/fehlerprotokoll`: sidebar entry `{ to: '/konsole/admin/fehlerprotokoll', module: 'server_faults' }`, hidden without the grant, like every module entry.

- **Lookup box**: enter a request id (ULID). It shows the full record, or the translated "no fault recorded for this id" message on a `404`. A value that is not a ULID but has the client-id shape is searched as a client correlation id through the list's `clientRequestId` filter instead.
- **List**: time (in the locale's format), method, route, status, error name, request id and a short fingerprint. "Load older" follows `nextCursor`. Clicking a fingerprint filters to it.
- **Suppression banner** when `suppressedLast24h > 0`.
- All labels are in `client/src/i18n/{de,en}.ts` (parity enforced by `test:i18n`). `message` and `stack` are shown verbatim in a monospace block and never translated. They are server English, the same rule as problem `detail`.
