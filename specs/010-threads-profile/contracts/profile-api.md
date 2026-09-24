# Contract: Profile API (010 deltas over 009)

Types live in `packages/contracts/src/profile.ts`. Routes are under the gated, never-indexed
`/profile` surface (unchanged). Staff designation routes are under `/admin`.

A route's audience is part of its posture and cannot be two things (009), so organisation
routes exist once per audience (`merchant`, `partner`).

---

## Shapes

```ts
type ProfileLink = { url: string; label: string | null }   // https only, ≤ 200 / ≤ 40

type MemberProfile = {            // own profile — 009 fields kept, plus:
  handle: string | null
  handleChangeableAt: string | null   // when the 30-day window opens; null = now
  avatar: MediaItem | null
  links: ProfileLink[]
  isInfluencer: boolean
}

type PublicMemberProfile = {      // 009 fields kept, plus:
  // 404 when THEY block you. When YOU block them the profile still opens
  // (isBlocked: true) so you can unblock; their posts and tabs do not.
  handle: string | null
  avatar: MediaItem | null
  links: ProfileLink[]
  isInfluencer: boolean
  isBlocked: boolean              // I block them
  isMuted: boolean
  // never: email, mobile, birthday (FR-016)
}

type OrganisationPublicProfile = {
  slug: string
  kind: 'merchant' | 'partner'
  displayName: string
  about: string | null
  website: string | null
  city: string | null
  logo: MediaItem | null
  // never: legal_name, fee_tier, contract_*, counts — R11
}

type OrganisationProfile = {      // 009 own-org shape, plus:
  publicProfile: OrganisationPublicProfile | null
  canEdit: boolean                // owner|manager — display only, server re-checks
}

type SetHandleRequest = { handle: string }
type SetAvatarRequest = { assetId: string | null }        // null clears
type SetLinksRequest  = { links: ProfileLink[] }          // ≤ 3, replaces all
type UpdateOrganisationProfileRequest = {
  displayName?: string; about?: string | null; website?: string | null; city?: string | null
  logoAssetId?: string | null
}

type Designation = {
  designation: 'influencer'
  grantedAt: string; grantedBy: string; grantReason: string
  revokedAt: string | null; revokedBy: string | null; revokeReason: string | null
}
```

`RESERVED_HANDLES` and `HANDLE_PATTERN` are exported constants, used by the web and Expo
forms for inline hints. The server is the enforcement point (Principle I).

---

## Member routes (`audience: 'member'`)

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/profile/me` | CHANGED | widened shape |
| PATCH | `/profile/me` | KEPT | bio, city, gender, country |
| PUT | `/profile/me/handle` | **NEW** | `200 MemberProfile`. `400 validation-failed` for format/reserved/taken, with `errors: [{ path: 'handle' }]`; `409 handle-change-too-soon` inside 30 days |
| GET | `/profile/handles/:handle/available` | **NEW** | `{ available: boolean }`. Rate-limited `member-api`; same answer for taken and reserved |
| PUT | `/profile/me/avatar` | **NEW** | asset must be the caller's, `ready`, `kind = image`, otherwise `404`/`400` as in threads. Stored in `member_avatars`, not on `members` |
| PUT | `/profile/me/links` | **NEW** | replaces all, one transaction |
| GET | `/profile/members/:id` | CHANGED | widened shape. `404` when not visible or blocked either direction |
| GET | `/profile/handles/:handle` | **NEW** | same body and same `404` rule as by id |
| GET | `/profile/organisations/:slug` | **NEW** | `OrganisationPublicProfile`. `404` unless `status = 'active'` **and** a public profile exists |

## Organisation routes (one per audience: `merchant`, `partner`)

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/profile/{merchant,partner}` | CHANGED | widened shape |
| PATCH | `/profile/{merchant,partner}/public` | **NEW** | owner/manager only; `staff` role → `404`. Upserts `organisation_profiles` |
| POST | `/media/{merchant,partner}` | **NEW** | The logo upload: the same handler and limits as `POST /media`, one registration per audience because `POST /media` is member-only. The PATCH above links it via `logoAssetId`, which must be an image uploaded by someone in the same organisation |

## Staff routes

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/members/:id/designations` | `members.read` | history, newest first |
| POST | `/admin/members/:id/designations/influencer` | `members.write` | `{ reason }`. `200` idempotent; audit `member.designation.granted` |
| DELETE | `/admin/members/:id/designations/influencer` | `members.write` | `{ reason }` in body. `404` when none active; audit `member.designation.revoked` |

## Access matrix (SC-003)

Every cell that is not 2xx, 401 or 404 is **403**: an audience mismatch is a valid
credential for the wrong interface (`plugins/10-auth.ts`), and missing staff flags are 403.

| Principal | `/profile/me*`, `/profile/members/*`, `/profile/handles/*`, `/profile/organisations/*` | `/profile/merchant*` | `/profile/partner*` | `/admin/members/:id/designations*` |
|---|---|---|---|---|
| anonymous | 401 | 401 | 401 | 401 |
| member / influencer | 2xx | 403 | 403 | 403 |
| merchant (owner/manager) | 403 | 2xx | 403 | 403 |
| merchant (`staff` role) | 403 | GET 2xx, PATCH **404** | 403 | 403 |
| partner | 403 | 403 | as merchant | 403 |
| staff with `members.read` only | 403 | 403 | 403 | GET 2xx, POST/DELETE 403 |
| staff with `members.write` | 403 | 403 | 403 | 2xx |
