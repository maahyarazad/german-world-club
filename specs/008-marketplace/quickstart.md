# Quickstart: Validating the Marketplace

**Feature**: 008-marketplace | **Date**: 2026-09-21

How to prove the feature works, in the order the evidence is worth collecting.
Details live in [research.md](./research.md), [data-model.md](./data-model.md)
and [contracts/](./contracts/); this is the run guide.

## Prerequisites

- Node ≥ 22.18 — the server runs on native type stripping, no build step.
- PostgreSQL at `DATABASE_URL`. **The SQL suites skip loudly without it**, so a
  green run with no database is not a green run. Check for the
  `⚠ No usable PostgreSQL` banner before believing any result here.
- Redis for the rate-limit suites.
- `npm run -w server migrate` — `018_messaging.sql` and `019_marketplace.sql` applied.
- `npm run -w server seed:demo` — the corpus SC-009 requires.

```bash
DATABASE_URL='postgres://…/gwc_test' npm run -w server test
```

---

## Scenario 0 — Baseline before anything

```bash
npm test 2>&1 | tee /tmp/mkt-baseline.txt
npm run -w server verify:seo
```

**Expect**: a recorded pass/fail count per suite. The marketplace must not change
any of it, and `verify:seo` must stay at 0 — it crawls the real sitemap, and a
marketplace URL appearing there is the failure this feature most needs to avoid.

---

## Scenario 1 — The boot gate (proves FR-019, SC-008)

```bash
npm run -w server dev
```

**Expect**: the server boots.

Counter-check — delete `config.auth` from any one marketplace route and restart:

**Expect**: refuses to boot, naming that route. If it boots, Principle II has
stopped being enforced and every other result here is worth less.

---

## Scenario 2 — Posting requires the flag AND the terms (US1, FR-001, FR-002)

Two members: one with `marketplace_post`, one without.

| Actor | Action | Expect |
|---|---|---|
| with flag, terms accepted | create a vehicle listing | **201**, visible in the index |
| **without** flag | call `POST /marketplace/listings` directly | **403** `PERMISSION_REQUIRED` |
| with flag, terms **not** accepted | create | **400**, naming the terms |
| with flag | vehicle listing missing a vehicle-required field | **400**, naming the field |
| with flag | *the same payload* as `job` | **201** — the required set differs per category |

The second row is the point: the missing UI control is a courtesy, the server is
the control. Test the API directly, not the form.

---

## Scenario 3 — `limit` is the sharpest parameter here

```bash
curl -s "…/marketplace/listings?limit=1000000" | jq '.items | length'   # ≤ 50
curl -s "…/marketplace/listings"               | jq '.items | length'   # 20, not an error
```

And assert in the suite that `limit` reaches the application layer as a
**number**, not the string `"50"`.

**Why all three**: `specs/007-typescript-migration/data-model.md` §4b traced the
existing `campaignQuery.limit` from `request.query` into a SQL `LIMIT` and found
that removing its Zod schema without replacing the coercion produces three
regressions at once — a string instead of a number, `undefined` instead of the
default, and no upper bound. This is the second such parameter and Phase 6 will
delete its schema too. Bounding it is not enough; the coercion and the default
need their own assertions.

---

## Scenario 4 — Nothing is public, nothing is indexed (FR-020, SC-003)

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/marketplace/listings   # 401
curl -sI http://localhost:3000/marketplace/listings | grep -i x-robots-tag            # noindex
npm run -w server verify:seo                                                          # exit 0
```

**Expect**: 401 unauthenticated, `noindex` on every response, `verify:seo` clean
and the sitemap unchanged.

Counter-check: `seo/surfaces.ts` still declares `/marketplace` gated and
never-indexed. This feature continues that declaration; it does not add one.

---

## Scenario 5 — Ownership, and the 404 that matters (US3, FR-004, SC-006)

Two members, one listing each.

| Action | Expect |
|---|---|
| owner edits own | **200**, audited |
| other member edits it | **404** |
| other member GETs it by id | **404** |
| genuinely absent id | **404** |

**The assertion is that the last three are indistinguishable.** Compare status,
body and headers. A 403 would confirm the row exists and turn id-guessing into
enumeration — the `guardOrganisationScope` precedent, which answers 404 for
exactly this reason.

---

## Scenario 6 — Quota is 422 under real concurrency (FR-021, SC-005)

```bash
# fire N+1 creates simultaneously against a member at cap N
seq 1 20 | xargs -P 20 -I{} curl -s -o /dev/null -w '%{http_code}\n' -X POST …
```

**Expect**: exactly the remaining allowance succeed; the rest return **422**
`QUOTA_EXCEEDED`. Never 429 — a 429 means "retry and it will work", and a client
shown one for an exhausted quota retries forever.

**Expect**: the count in `db/counters.ts` matches the rows created, exactly. A
sequential test passes against a quota with no lock at all, which is the whole
reason this one is concurrent.

---

## Scenario 7 — Photos (FR-013, FR-014, SC-004)

| Action | Expect |
|---|---|
| attach an uploaded asset | 201; response URLs are **derivatives** |
| grep any response for the original path | nothing |
| two listings share a checksum, delete one | the other still renders |
| exceed stored-byte quota | 422 |

The third row is the one to get right: deleting a listing removes photo links,
never bytes. `media/routes` is the only place that decides whether bytes go.

---

## Scenario 8 — Moderation (US4, FR-016, FR-018, SC-007)

| Actor | Action | Expect |
|---|---|---|
| `marketplace_moderation:status` | hide with a reason | 200, gone from member index |
| `marketplace_moderation:read` only | hide | 403 |
| any staff | hide with **no** reason | 400 |
| the owner | `GET /marketplace/mine` | listing present, **marked hidden** |
| anyone | audit log | actor, target, reason recorded |

The fourth row is US4.4: a hidden listing must not silently vanish for its owner.

---

## Scenario 9 — Categories and features (contracts/listing-categories.md)

```bash
npm run -w client test:i18n     # catalogues agree, both directions
npm run -w client test:tokens
```

**Expect**: every vehicle-feature `key` has a label in **both** catalogues; no
label text is served by the API;
`tests/ops/no-server-localisation.test.ts` still passes — no response body varies
with `Accept-Language`.

**Expect**: no hard-coded field list anywhere in `client/src`. The compose form is
built from `GET /marketplace/categories`.

**Expect**: every `filterable: true` field has a backing index in
`018_marketplace.sql`. A filter with no index is a sequential scan that looks
fine until the corpus grows.

---

## Scenario 9b — Messaging: persist before notify (US5, FR-025, SC-011)

The ordering assertion is the one worth writing carefully.

```bash
# with the notification path deliberately failing
curl -s -X POST …/marketplace/listings/$ID/inquire -d '{"body":"Still available?"}'
```

**Expect**: the request may report the notification failed — and the message is
**in the database and readable by the owner** regardless.

**Why this way round**: the Technology Baseline requires a message to be
persisted before it is delivered, so a dropped connection never loses data. A
test that only checked the happy path would pass against an implementation that
notified inside the transaction, where a failed push rolls back a message the
sender was told was accepted. Break the notification deliberately; that is the
assertion.

| Action | Expect |
|---|---|
| member inquires | conversation exists, linked to the listing |
| owner replies | inquirer reads it on their next request — neither need be online |
| inspect any messaging response | **no email address, no phone number**, either party |
| non-participant opens the conversation | **404**, identical to one that does not exist |
| inquire on a withdrawn listing | **410** — and the existing conversation still reads |

The last row is FR-027: two people mid-negotiation must not lose the thread when
the seller marks something sold.

**429 vs 422, both in this feature**: message volume limiting is **429** — wait
and it works. The listing cap is **422** — retrying changes nothing until state
does. Assert both; flattening them together is the easy mistake.

---

## Scenario 9c — Expiry is optional, and unlimited is a choice (FR-028, SC-012)

```bash
npm run -w server runJob marketplace-expiry     # or trigger it however jobs run
```

| Listing | After the job |
|---|---|
| `expires_at` in the past | `expired` |
| `expires_at` in the future | still `active` |
| **`expires_at` NULL (unlimited)** | **still `active`** |

**The third row is the test.** The job's predicate is `expires_at IS NOT NULL AND
expires_at <= now()` — both halves. A job that forgot the null check would
silently expire every unlimited listing, and the happy-path test would not
notice. Assert the negative case.

Also: a member can clear an expiry back to unlimited on their own listing
(FR-030), and an expiry already past at publication is refused by a CHECK rather
than accepted and instantly expired.

---

## Scenario 9d — Three faces, one rule set (US6, FR-031, SC-013)

**Prerequisite** (R14): `expo-client/german-world-club` is in `workspaces`, has
`@gwc/contracts`, and authenticates with a bearer token. None of that exists
today — verify it before this scenario means anything.

```bash
node -e "const w=require('./package.json').workspaces; console.log(w.some(p=>p.includes('expo')))"   # true
```

| Check | Expect |
|---|---|
| same member, same filters, web vs mobile | identical result sets |
| member without `marketplace_post` posts from mobile | refused, exactly as on web |
| grep the Expo app for a redeclared listing shape | nothing — it imports `@gwc/contracts` |
| any marketplace URL, signed out, either face | **401** |

The third row is Principle I doing its job. A mobile client that redeclared the
shape is the divergence the shared package exists to prevent — and after feature
007 Phase 6 removes the runtime schemas, nothing would catch the drift at
runtime either.

---

## Scenario 10 — Seed spread (SC-009)

```bash
npm run -w server seed:demo
```

**Expect**: listings across **all four** categories, **both** modes and **every**
state — including some with an expiry and some unlimited, and at least one
conversation so the inbox is not empty on a fresh demo. Feature 005's rule: six identical published listings demonstrate nothing
about how visibility works.

**Expect**: history entries only where a seeded fact implies one, at that fact's
own timestamp — a `sold` listing carries the entry that sold it, stamped
`state_changed_at`. Nothing gets invented history.

**Expect**: `tests/seed/no-live-credentials.test.ts` still passes. Terms
acceptances are records, not credentials, and are seedable.

---

## Scenario 11 — Nothing else regressed

```bash
npm run typecheck
DATABASE_URL=… npm test
npm run -w server verify:seo
npm run -w client build
```

**Expect**: server test count is the baseline **plus** the marketplace suites.
Client unchanged except the moderation screen. `verify:seo` 0.

**Note**: `npm run typecheck` currently fails on feature 007's outstanding server
errors. Until that lands, the meaningful check is that the marketplace files add
**no new** ones — compare counts rather than expecting zero.

---

## Definition of done

| # | Scenario | Criterion |
|---|---|---|
| 1 | Boot gate | FR-019, SC-008 |
| 2 | Flag + terms + per-category required | SC-001 |
| 3 | `limit` coerced, defaulted, bounded | R8 |
| 4 | Nothing public or indexed | SC-003 |
| 5 | 404 indistinguishable from absent | SC-006 |
| 6 | Quota 422 under concurrency | SC-005 |
| 7 | Derivatives only; shared bytes survive | SC-004 |
| 8 | Moderation gated and audited | SC-007 |
| 9 | One category definition; labels client-side | Principle I |
| 9b | Persist before notify; no contact values | SC-010, SC-011 |
| 9c | Unlimited expiry survives the job | SC-012 |
| 9d | Web and mobile agree; nothing readable signed out | SC-013, SC-014 |
| 10 | Seed spans every state | SC-009 |
| 11 | No regression | — |

Scenarios **3, 5, 6, 9b and 9c** fail silently in production rather than loudly
in a suite:

- an unbounded `LIMIT` (3)
- an enumerable 403 where a 404 belongs (5)
- a quota without a row lock (6)
- a notification inside the transaction, losing messages only when pushes fail (9b)
- an expiry job missing its null check, quietly expiring every unlimited listing (9c)

Each looks fine on the happy path. None is optional.
