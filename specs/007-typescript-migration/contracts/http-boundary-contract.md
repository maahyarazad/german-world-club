# Contract: The HTTP Boundary After Validation Removal

**Feature**: 007-typescript-migration

This is the contract that changes most, and the one a reviewer should read
before approving the removal. It states what the server guarantees about
requests and responses **after** this feature, so the guarantee is written down
somewhere other than in the absence of code.

## Requests

**Before**: 21 routes declared `schema.body`. Fastify parsed and rejected
malformed input with `400` before the handler ran.

**After**: no route declares a body schema. `request.body` is whatever JSON was
posted.

```ts
// The cast compiles. It is not checked.
const body = request.body as SignInRequest
```

### Guarantees that remain

| Guarantee | Mechanism | Status |
|---|---|---|
| Body is syntactically valid JSON | Fastify's content-type parser | **intact** |
| Body under the size limit | `@fastify/multipart` / body limit | **intact** |
| Caller is authenticated for the audience | `config.auth` + token verification | **intact** |
| Caller holds the permission | per-request resolution, `authz/` | **intact** |
| Caller owns the object | `guardOrganisationScope`, 404 not 403 | **intact** |
| Request is within its deadline | `12-deadline` | **intact** |
| Rate limits apply | `07-rate-limit` | **intact, conditional on `TRUST_PROXY` coercion (R7)** |
| Upload is the type it claims | magic-byte inspection in `media/validate.ts` | **intact** |
| **Body fields have the declared types** | `schema.body` | **REMOVED** |
| **Business bounds hold** (password ≥ 8, OTP 4 digits, limit ≤ 200) | schema refinements | **REMOVED unless individually preserved — see data-model.md §4** |

### The obligation this creates

Every handler reading `request.body` is now the first thing to see untrusted
input. Two rules follow, and they are the substance of this contract:

1. **A cast is not a check.** `as SignInRequest` asserts; it does not verify.
   Where a value is used in a way that a wrong type would make unsafe or
   incorrect — a length, a number in arithmetic, an index, a SQL parameter —
   the handler checks it explicitly.
2. **Values reaching SQL must be bounded by the handler.** The schemas used to
   do this. `campaignQuery.limit` is the worked example: query strings are
   strings, `.coerce` made it a number, `.max(200)` bounded it, `.default(50)`
   supplied it when absent, and it lands in a SQL `LIMIT` parameter
   (data-model.md §4b). All three are the handler's job now.

## Responses

**Before**: 31 responses were serialized through a schema — output shaped by
the contract, and compiled by `fast-json-stringify`.

**After**: handler return values are serialized by `JSON.stringify`.

| Guarantee | Status |
|---|---|
| Response is valid JSON | **intact** |
| Errors are RFC 9457 problem+json, clients branch on `type` | **intact** — error shaping is in the error handler, not in route schemas |
| Credentials and contact details never appear in logs | **intact** — central redaction in `01-logging.ts` |
| `cache-control: private, no-store` on every `/auth/*` response | **intact** — `onSend` hook, not a schema |
| Originals are never served; only declared derivatives | **intact** — delivery routing, not a schema |
| **Only declared fields leave the server** | **REMOVED** |

### The obligation this creates

**A `SELECT *` is now a disclosure.** With response schemas, a column added to
a table later could not reach a client, because the schema listed the fields.
That is the specific protection Constitution Principle VI names —"so a column
added later cannot leak" — and it is gone. The handler's query is now the last
line of defence.

Rule: **queries in `application/` name their columns explicitly.** No `SELECT *`
on any path that reaches a response. This is not a new rule invented here — it
is the old guarantee, relocated from a place where it was enforced to a place
where it is a convention.

## What did not change

`config.auth` is still mandatory on every route and the server still refuses to
boot without it. Of the four boot gates in CLAUDE.md, three survive: auth
posture, Σ(outbound budgets) < deadline, and declared dependency fallbacks.
Quotas remain in PostgreSQL under row lock. Authorization is still resolved per
request, never read from the token. Audience isolation and object guards are
unchanged.

## Contract assertions

1. A `POST /auth/sign-in` with `{"email": 12345, "password": []}` no longer
   returns `400` from validation. The test asserting the old behaviour must be
   retargeted to assert the new one, not deleted (SC-003, SC-008).
2. A route with no response schema boots (R8).
3. `grep -rn "SELECT \*" server/src/modules/*/application/` returns nothing.
4. `verify:seo` exits zero (SC-004).
5. `TRUST_PROXY=false` yields boolean `false`, not `"false"` (R7, SC-005).
6. Every preserved rule in data-model.md §4 has a test proving it still
   rejects. A preserved rule with no test is a rule that will be removed by the
   next person who reads the handler and sees no reason for the check.
