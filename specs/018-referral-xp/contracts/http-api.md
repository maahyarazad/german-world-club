# HTTP contract: Referral links and XP

Every shape comes from `@gwc/contracts/referrals` (data-model.md). Every error is RFC 9457
problem+json with an existing problem type, so **no new problem types** are added. Clients branch
on `type`.

## 1. Public

### `GET /r/:code`: referral landing page (HTML, no JavaScript)

| | |
|---|---|
| Posture | `{ audience: 'public' }`, budget `public-page`, bucket `public-read` |
| Surface | `referral-landing` (`/r`): public, **not indexed** (`X-Robots-Tag: noindex`), not in the sitemap, not disallowed |
| Headers | `cache-control: private, no-store`, `referrer-policy: no-referrer` |

| Case | Status | Body |
|---|---|---|
| Active link, owner active | `200` | Referrer name (R8), formatted code, **Register on the web** → `/konsole/registrieren?ref=CODE`, **Open in the app** → `germanworldclub://r/CODE`, store links. OG title "*{name}* invites you to German World Club". |
| Unknown, retired, disabled, owner locked/ended/inactive | `404` | One identical page for all four: "This invitation link is no longer valid", plus a registration link **without** a code |

The input is normalised first (R7): `/r/abcd-efgh` and `/r/ABCDEFGH` are the same link. A
`:code` that doesn't normalise is the `404` case.

### `GET /.well-known/apple-app-site-association` and `GET /.well-known/assetlinks.json`

Public, not indexed (surface `app-links`), `content-type: application/json`, `cache-control:
public, max-age=3600`. Both cover the path `/r/*` only (R9). `assetlinks.json` answers `404`
while `ANDROID_APP_CERT_SHA256` is unset.

### `POST /onboarding/register` (changed)

The body gains `referralCode?: string`. The response is **unchanged in every case**: valid,
invalid, retired, disabled, self-referral or absent all get the same `202` shape (FR-006,
R3). Effect: sets `membership_applications.pending_referral_link_id` to the resolved active link,
or to NULL.

### `POST /onboarding/verify-mobile` (changed)

The response is unchanged. Effect, in the transaction that sets `mobile_verified_at` (R1–R4):

1. If the pending link is still active and its owner active, and it is not a self-referral,
   insert the `referrals` row and the `award` entry at the rate in force, each
   `ON CONFLICT DO NOTHING`.
2. Otherwise write nothing. Audit `referral_refused` with its reason.

## 2. Owner routes: same handlers, one mount per audience (R13)

`{prefix}` is `/referrals` (member), `/referrals/merchant`, `/referrals/partner`, or
`/admin/referrals/me` (staff, `anyStaff: true`). Applicants who are not approved or not profiled
are refused on the member mount by the existing 10-auth gates.

| Method & path | Bucket | Response |
|---|---|---|
| `GET {prefix}` | member-api / admin-api | `200 referralSummary`. **Creates the active link on first call** (FR-001, US1 scenario 3). Idempotent under concurrency through the partial unique index: a lost insert re-reads. |
| `POST {prefix}/link/replace` | write-heavy | `200 referralSummary` with the new link. The old link is `retired`. Body: none. |
| `GET {prefix}/referrals?cursor=` | member-api / admin-api | `200 page<referral>`, newest first, 50 per page |
| `GET {prefix}/xp?cursor=` | member-api / admin-api | `200 page<xpEntry>`, newest first, 50 per page |

Owner responses carry **no** email, mobile, birthday, country, denial reason or profiling field
of the referee (FR-018, R15). That is asserted by a test.

## 3. Staff oversight (`module: 'referrals'`)

| Method & path | Flag | Body | Response / refusals |
|---|---|---|---|
| `GET /admin/referrals/owners?kind=&q=&cursor=` | read | | `200 page<staffReferralOwner>`, ordered by referral count descending |
| `GET /admin/referrals/owners/:kind/:id` | read | | `200 { owner: staffReferralOwner, referrals: page<referral>, xp: page<xpEntry> }`. Unknown owner → `404 not-found` |
| `POST /admin/referrals/links/:linkId/disable` | status | `{ reason }` | `200`. Already not active → `409 conflict`. Own link → `403 forbidden` (R12). |
| `POST /admin/referrals/xp/:entryId/reverse` | status | `{ reason }` | `200 xpEntry` (the reversal). Already reversed, or the entry is itself a reversal → `409 conflict`. Own entry → `403 forbidden`. |
| `GET /admin/referrals/xp-rate` | read | | `200 { current: xpRate, history: xpRate[] }` (the 50 most recent) |
| `PUT /admin/referrals/xp-rate` | edit | `{ xp, reason }` | `200 xpRate`. A new row. Earlier awards are unchanged (FR-013). |

All of these are budget `admin-read` and bucket `admin-api`. Each write is audited with its
reason (R17). In staff views, the referee is shown with the same restricted fields as in owner
views. A staff member who needs the applicant's contact details opens the application through
the existing `members` module, under its own grant.

## 4. Postures and surfaces added

```text
surfaces.ts   + referral-landing  /r            public  noindex
              + app-links         /.well-known  public  noindex
              + referrals         /referrals    gated   noindex
```

The boot gate (route with no `config.auth`) and `tests/authz/route-posture.test.ts` cover every
new route. The access matrix test adds each route × each principal kind.
