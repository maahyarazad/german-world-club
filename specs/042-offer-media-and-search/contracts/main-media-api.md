# Contract: Set an offer's main media

**Feature**: 042-offer-media-and-search | Types in `@gwc/contracts/offers`, problem type in `@gwc/contracts/errors`.

One application function, `setMainMedia` (`modules/offers/application/offer-media.ts`), behind two doors. A route has exactly one audience, so there are two routes, as with the club-offers mounts.

## Routes

| Method and path | Audience and posture | Scope of the offer lookup |
|---|---|---|
| `PUT /merchant/offers/:id/main-media` | `audience: 'merchant'`, `budget: 'member-write'`, rate bucket `write-heavy` | only offers of the principal's organisation; anything else is the standard 404, identical to an unknown id |
| `PUT /admin/offers/:id/main-media` | `audience: 'staff'`, `module: 'merchant_offers'`, `flag: 'edit'`, `budget: 'admin-write'`, rate bucket `admin-api` | any offer; **and** the handler refuses everyone whose resolved permissions are not `isSuperadmin` |

The staff route's handler check follows the dashboard figures precedent (`admin-dashboard/controller.ts`): the posture vocabulary has no "superadmin only", so the route declares the module and the handler narrows it. A refusal calls `app.auditDenial(request, { requiredPermission: 'superadmin', targetType: 'offer', targetId })` and answers 403 `insufficient-permission`.

## Request

```ts
export const setMainMediaRequestSchema = z.object({ assetId: z.string().uuid() })
export const offerIdParamSchema            // existing: { id: uuid }
```

## Response 200

```ts
export const offerMediaSchema = z.object({ media: z.array(mediaItemSchema) })
// The offer's ready items, in order; media[0] is now assetId.
```

The same shape from both doors, so one client call type serves the merchant editor and the staff page. Nothing else about the offer is returned or changed.

## Behaviour

1. Lock the offer row (`FOR UPDATE`); the same lock `PUT /merchant/offers/:id/media` takes, so the two cannot interleave.
2. `assetId` must be one of the offer's current `offer_media` rows, else **422 `offers/media-not-attached`**, and nothing is written.
3. Already first: 200, nothing written, no audit entry.
4. Otherwise move it to position 0; the others keep their relative order, positions are rewritten 0..n-1.
5. Audit entry in the same transaction: `action: 'offer_updated'`, `targetType: 'offer'`, `actorKind: 'merchant' | 'admin'`, `detail: { offerChange: { changed: ['mainMedia'], assetId } }`. `actorKind` is the `account_kind` database enum (`audit_log.actor_kind`), whose value for a staff account is `'admin'` (`request.principal.kind`), **not** `'staff'`, which is an audience name and would fail the insert. `offer-media.ts`'s `Actor` type, today `kind: 'merchant'`, widens to `'merchant' | 'admin'`.
6. `offers.updated_at` is **not** moved (same as `setOfferMedia`), so an open edit form is not made stale.

"Main" is then what `LEAD_OFFER_ASSET` returns (first *ready* item): the list card's `thumbnail` and `media[0]` on the detail.

## Errors

| Case | Status | Problem type |
|---|---|---|
| Not signed in, wrong audience | as the platform's standard | `unauthenticated` / audience refusal |
| Staff without `merchant_offers.edit` | 403 | `insufficient-permission` (from the posture gate) |
| Staff with the grant but not a super admin | 403 | `insufficient-permission` (from the handler), audited |
| Merchant, offer of another organisation, or unknown id | 404 | `not-found`, identical body and headers |
| `assetId` not on the offer | 422 | `offers/media-not-attached` (**new**, `OFFER_MEDIA_NOT_ATTACHED`) |
| `assetId` not a UUID | 400 | `validation-failed` |

```ts
// packages/contracts/src/errors.ts, next to OFFER_MEDIA_LIMIT
OFFER_MEDIA_NOT_ATTACHED: {
  type: `${BASE}/offers/media-not-attached`, title: 'That file is not part of this offer', status: 422,
},
```

## Authorization matrix rows to add (`server/tests/authz/matrix.test.ts`)

```text
{ name: 'main media (merchant)', url: '/merchant/offers/:id/main-media', probe: <uuid>, method: 'PUT', audience: 'merchant' }
{ name: 'main media (staff)',    url: '/admin/offers/:id/main-media',    probe: <uuid>, method: 'PUT', audience: 'staff', module: 'merchant_offers', flag: 'edit' }
```

No `anyStaff` exemption is needed or wanted: the staff route is module-gated.

## Client call shapes

```ts
// client/src/organisation/api.ts, on `merchantApi`, beside setOfferMedia
setMainMedia: (id: string, assetId: string) => put(`/merchant/offers/${id}/main-media`, { assetId }) as Promise<{ media: MediaItem[] }>

// client/src/offers/api.ts, a standalone export. NOT a member of the kind-generic
// `clubOffersApi(kind)`, which would put it on the member, merchant and partner
// objects where the route does not exist.
export const setOfferMainMediaAsStaff = (id: string, assetId: string) =>
  put(`/admin/offers/${id}/main-media`, { assetId }) as Promise<{ media: MediaItem[] }>
```

The app does not get a main-media call (spec Decision 6).
