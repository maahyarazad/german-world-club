# Quickstart: Validate Threads and Profiles

How to prove feature 010 works end to end. Shapes are in [contracts/](./contracts/), and
tables and rules are in [data-model.md](./data-model.md).

## Prerequisites

- A branch containing 009 and 010 (see research R1). **Back up the local `expo-client/`
  before switching from `main`**: it is ignored on `main` and tracked on 009.
- PostgreSQL and Redis via `docker-compose up -d`.
- `.env` with the three deployment preconditions (`server/README.md`).

```bash
npm install
npm run -w server migrate        # applies 026_profiles.sql, 027_threads_social.sql
npm run -w server seed:dev
npm run -w server seed:demo      # prints the credentials table
npm run -w server dev
npm run -w client dev
(cd expo-client/german-world-club && npx expo start)
```

## Automated gates (must be green)

```bash
npm run typecheck                           # SC-007: contracts, server, client, Expo
npm run -w server test -- threads profile   # feature suites
npm run -w server test -- authz/route-posture ops/  # posture + access matrix (SC-003)
npm run -w client test:i18n                 # SC-008
npm run -w server verify:seo                # /threads and /profile still gated, never indexed
```

SQL suites skip **loudly** without a database. A skip is not a pass for SC-004 and SC-005.

## Manual scenarios

Use two demo members, **A** and **B**, from the credentials table, plus one merchant owner,
one merchant `staff` user, and a staff account with `members.write` and
`threads_moderation`.

| # | Steps | Expected |
|---|---|---|
| 1 | A signs in on the **web**, opens Threads, composes | Handle prompt appears (demo members *have* handles; use a freshly `seed:dev` member to see it) |
| 2 | A posts text + 3 photos on the web | Post appears at the top of the feed. Network tab shows only variant URLs, each `<img>` has width/height |
| 3 | A opens the **app** | Same post and photos, same order (SC-001, web → mobile) |
| 4 | B, in the **app**, replies with a video and quotes A's post | On the web, A sees the reply (poster, no autoplay) and the quote. Counts: 1 reply, 1 quote (SC-001, mobile → web) |
| 5 | B writes `@<A's handle>` in a post | A's Activity badge shows 1. Opening Activity clears it on both faces |
| 6 | Staff hide A's original post with a reason | B's quote now shows "unavailable". Response JSON contains none of A's body text (SC-005) |
| 7 | A blocks B | B gets 404 for A's profile and posts. A follow in either direction is gone |
| 8 | Staff grant A *Influencer* with a reason | Badge on web and app. Audit log entry `member.designation.granted` |
| 9 | Merchant owner edits the public profile + uploads a logo | A sees it at `mitglied/organisationen/:slug` |
| 10 | Merchant `staff` user tries the same PATCH | 404 |
| 11 | Try to attach an asset uploaded by B to A's post (curl with A's cookie) | 404, and no post row created (SC-004) |
| 12 | Change A's handle twice | The second change is refused `422 handle-change-too-soon`. Old mentions still link to A |

## Performance (SC-006)

```bash
npm run -w server seed:perf -- --members 5000 --posts 50000   # added by this feature
npm run -w server bench:feed                                   # reports p95 for both scopes
```

The expected p95 for the first feed page is ≤ 300 ms. Check `EXPLAIN` for the `following`
scope. It must use `thread_posts_author_idx` and the follows PK, not a sequential scan.

## Known failures on base (recorded by T002, 2026-09-23)

Baseline taken on `010-threads-profile` immediately after branching from `main` (009 merged,
`f070a91`), before any 010 change:

- `npm run typecheck`: `packages/contracts` 0, `expo-client` 0, `client` 4, `server` 1198
  errors. These are the unfinished feature 007 migration. 010 must not raise any of these counts.
- `vitest run` against a scratch `gwc_test` database: 1190 passed, 3 failed, 133 skipped.
  All failures are in `tests/seed/*` (the demo-seed suites) and predate 010.
- Tests need `DATABASE_URL` pointing at a scratch database with credentials, e.g.
  `DATABASE_URL=postgres://postgres:postgres@localhost:5432/gwc_test`. `tests/setup.ts`
  defaults to a password-less URL, and a password-less URL fails SCRAM authentication.

## Measured (T099, 2026-09-23)

`seed:perf --members 5000 --posts 50000` (with 100 000 follows and about 100 000 likes) on a
local PostgreSQL 17 (Docker), 40 random viewers:

| Path | p95 | Budget | |
|---|---|---|---|
| feed (following), first page | 18.0 ms | 300 ms | OK |
| feed (for you), first page | 8.1 ms | 300 ms | OK |
| activity, first page | 6.3 ms | 150 ms | OK |
| activity unread | 2.0 ms | 150 ms | OK |

No index was added: none of the paths needed one at this size. Re-run after any change to
`VISIBLE_POST`, `POST_COLUMNS` or the Activity union. `bench:feed` exits non-zero when a path
exceeds its budget.
