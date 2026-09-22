# Contract: Marketplace Moderation API

**Feature**: 008-marketplace

Staff-audience. Gated on the **existing** `marketplace_moderation` module — this
feature adds no permission, it fills a hole the matrix already has.

## Posture

```ts
config: { auth: { audience: 'staff', module: 'marketplace_moderation', flag: 'read' } }
```

The five flags mean what they mean everywhere else:

| Flag | Grants |
|---|---|
| `read` | see the report queue and any listing, including hidden |
| `status` | hide a listing, restore it, resolve a report |
| `delete` | remove a listing outright |
| `write` / `edit` | unused here — staff do not author or rewrite member listings |

`write` and `edit` are listed as unused **on purpose**. §11 keeps the matrix
uniform across modules, and a reader who finds only three flags used should see
that it was a decision rather than an oversight. Staff moderating a classified
must not become staff editing what a member said.

## Endpoints

| Method | Path | Flag |
|---|---|---|
| `GET` | `/admin/marketplace/reports` | `read` |
| `GET` | `/admin/marketplace/listings/:id` | `read` |
| `POST` | `/admin/marketplace/listings/:id/hide` | `status` |
| `POST` | `/admin/marketplace/listings/:id/restore` | `status` |
| `DELETE` | `/admin/marketplace/listings/:id` | `delete` |
| `POST` | `/admin/marketplace/reports/:id/resolve` | `status` |

`/admin` is already classified gated and never-indexed in `seo/surfaces.ts`, so
the crawl posture is inherited rather than declared again.

## Audit

**Every** action writes to the append-only audit log via `app.audit`, with actor,
target and reason. Not convention — the log is append-only by revoked grant
(Principle IV), and CLAUDE.md calls it the one table nobody may edit.

A hide or remove **requires** a reason. Moderation without a recorded reason is
indistinguishable from a mistake six months later, and §8 makes moderation an
obligation rather than a courtesy.

## Visibility to the owner

A hidden listing stays visible to its owner at `GET /marketplace/mine`, **marked
hidden**. It does not silently vanish (spec US4.4). A member who cannot tell the
difference between "hidden by staff" and "I deleted it by accident" files a
support ticket, which §8 is trying to avoid.

The moderation *reason* is not necessarily shown to the owner — what staff record
for the audit log and what the member is told are two decisions, and this contract
only fixes the first.

## Assertions

1. `marketplace_moderation:status` can hide; `read` alone cannot.
2. Every action appears in the audit log with actor, target and reason.
3. A hide with no reason is refused.
4. A hidden listing is absent from the member index and present, marked, in the
   owner's own list.
5. Staff cannot edit a member's listing body through any endpoint here.
