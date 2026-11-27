# Quickstart: proving Offer Media, Fallback and Search end to end

**Feature**: 042-offer-media-and-search | Contracts: [search](./contracts/search-api.md), [main media](./contracts/main-media-api.md), [UI](./contracts/offer-media-ui.md) | Data: [data-model.md](./data-model.md)

This is a validation guide. It says what to run and what you should see; the implementation belongs in `tasks.md`.

## 0. Prerequisites

- Node 22, PostgreSQL 17 reachable through `DATABASE_URL` in `server/.env`.
- **That `DATABASE_URL` must not be the production database.** `seed:demo` publishes passwords and development sign-in sends real SMS through the real provider (CLAUDE.md).
- The Expo development client you already have. **No new native module is added, so no new EAS build.**
- Install once: `npm install` at the repository root.

## 1. The database can create the extension (do this first)

```bash
psql "$DATABASE_URL" -c "SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name = 'pg_trgm';"
```

Expect one row. No row means the database image lacks the contrib package: stop and fix that before anything else, because the migration will (deliberately) fail rather than ship a slow search.

## 2. Migrate and check the four indexes

```bash
npm run -w server migrate
psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE indexname LIKE '%trgm%' ORDER BY 1;"
```

Expect `listings_body_trgm_idx`, `listings_title_trgm_idx`, `offers_description_trgm_idx`, `offers_title_trgm_idx`. Running `migrate` again prints `migrations: up to date`.

## 3. Data to look at

```bash
npm run -w server seed:demo          # prints a credentials table: a member, a merchant, a partner, a super admin, an ordinary staff account
npm run -w server dev                # API
npm run -w client dev                # web console
npm run -w expo-client/german-world-club start   # app
```

You need: a merchant with offers in four conditions (**no media**, **one picture**, **four pictures plus a video**, **a video still processing as its first item**), at least 60 active marketplace listings (one whose *description only* contains a distinctive word, positioned deep in the list), and a draft, a withdrawn and an expired offer, a switched-off store, and a hidden listing, each containing that same distinctive word.

## 4. Scenario A: the fallback (spec US2)

| Step | Web (`/konsole/mitglied/angebote`) | App (Offers tab) | Expect |
|---|---|---|---|
| Open the list as a member | the no-media offer's card | its card | the **club fallback artwork** in a 16:9 frame, same size as cards that have photos |
| Open that offer | detail page | detail screen | fallback in a 16:9 frame, **no dots, no arrows** |
| Sign in as the merchant, open the offer in the editor | media section | (editor) | it says there is **no media yet**; the fallback is not listed as a file |
| Break an image on purpose (web dev tools: block the derivative URL) | list card | n/a | the fallback replaces the broken picture |
| Switch language | list | list | the fallback's accessible description follows the language |
| Airplane mode, restart the app, open an offer with no media | n/a | detail | the fallback still appears |

## 5. Scenario B: the gallery fits and swipes (spec US1)

On the offer with four pictures and a video:

| Check | Where | Expect |
|---|---|---|
| Edges line up | app, phone portrait | the media's left and right edges are exactly those of the benefit card and description below it |
| Still true elsewhere | app, tablet / phone rotated | still equal; nothing is computed from the window width |
| Swipe | app | one item per swipe, a dot per item with the current one marked, 16:9 each |
| Video | app, web | still picture with a play control; plays muted when pressed; swiping away stops it |
| One picture only | app, web | no dots, no arrows |
| Web touch, mouse, keyboard | web | swipe on a touch screen; previous/next buttons; dots; Left/Right arrows when the gallery is focused |
| Reduced motion | web (OS setting on) | no sliding animation between items |
| Other screens unchanged | app | Threads posts, quote embeds, marketplace listing detail and the store gallery look **exactly as before** |

## 6. Scenario C: choosing the main media (spec US3)

1. As the **merchant**, web, open the offer with four pictures. Exactly one tile shows **Main**; the others show **Make main**.
2. Press Make main on the third tile. It gains the badge, the previous one loses it, and the tile order has the third first.
3. As a member, reload the list: the card shows the third picture; the detail's first slide is the third. Choose the **video** as main: the card shows the video's still picture.
4. Remove the main item: the next item is marked Main.
5. As the **super admin**, web, click the sidebar's **Merchant offers** tab. It must open the merchant offers list at `/konsole/admin/angebote-entdecken` (not the marketplace moderation page), and the **Marketplace** tab must still open moderation at `/konsole/admin/angebote`. Open the same offer from the list. A **Make main** control is on the current slide; using it changes what members see. On the staff redemptions page the "back" link returns to the merchant offers list.
6. Counter-checks (each must **fail** as stated):

```bash
# ordinary staff (holds merchant_offers.edit, not a super admin)  -> 403 insufficient-permission
curl -i -X PUT "$API/admin/offers/$OFFER/main-media" -H "authorization: Bearer $STAFF" -H 'content-type: application/json' -d "{\"assetId\":\"$ASSET\"}"
# another merchant's offer                                        -> 404 not-found, body and headers identical to an unknown id
curl -i -X PUT "$API/merchant/offers/$OTHERS_OFFER/main-media" -H "authorization: Bearer $MERCHANT" -H 'content-type: application/json' -d "{\"assetId\":\"$ASSET\"}"
# an asset that is not on the offer                               -> 422 offers/media-not-attached
curl -i -X PUT "$API/merchant/offers/$OFFER/main-media" -H "authorization: Bearer $MERCHANT" -H 'content-type: application/json' -d "{\"assetId\":\"$FOREIGN_ASSET\"}"
```

7. The processing-first case: the offer whose first item is a video still processing shows the **second** item on the card **and** first on the detail (they agree); when the video finishes, it leads.
8. Check the audit log has one `offer_updated` entry per change, with the actor, and none for a no-op repeat.

## 7. Scenario D: search (spec US4)

Run on **web and app**, on **Marketplace** and on **Merchant offers**.

| Search | Expect |
|---|---|
| the distinctive word that is only in the 45th listing's description | it appears (and the drafted, withdrawn, expired, switched-off-store and hidden records containing the same word **do not**) |
| `rad` against a title containing `Fahrrad`; then `RAD` | matches both times |
| two words | every result contains both |
| a word plus a category chip (offers) / category and mode (marketplace) | both constraints hold |
| `50%` and `a_b` | matched literally, not as wildcards |
| a term nothing matches | "No results for this search" (different from the empty-collection message); clear the box: the full list returns |
| type a 10-letter word at normal speed | at most 2 requests (watch the network panel or the server log) |
| type, change category, keep typing | the search is kept; an older answer never replaces a newer one |
| web Marketplace, a search with more than 20 hits | **Load more** reaches the rest |
| the staff mount (`/admin/club-offers?q=…`), merchant and partner mounts | same results rules |

Refusals:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $MEMBER" "$API/member/offers?q=a"                 # 400 (one character)
curl -s -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $MEMBER" "$API/member/offers?q=$(printf 'x%.0s' {1..81})"   # 400 (81 chars)
curl -s -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $MEMBER" "$API/member/offers?q=a1+b2+c3+d4+e5+f6+g7"          # 400 (7 words)
curl -s -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $MEMBER" "$API/member/offers?q="                              # 200, no search
curl -s -o /dev/null -w '%{http_code}\n'                                     "$API/marketplace/listings?q=rad"                    # 401: not a public route
curl -s -o /dev/null -w '%{http_code}\n'                                     "$API/marktplatz"                                    # 200, aggregate counts only, unchanged
```

### Privacy: the typed text is not logged

1. With the server running in development, search for `zzprivate-needle` on web and app.
2. `grep -c zzprivate-needle` over the server's log output must be **0**; the request lines show `?q=[redacted]`.
3. In the Expo/Metro console the `api GET /member/offers?...` lines show `q=[redacted]` (including the two older `path:` debug lines).

## 8. Performance (spec SC-006)

In a **scratch** database (never a shared one) load about 50,000 active listings and 5,000 published offers (extend `seed:perf`, which is development-only, or add `bench:search` beside `bench:feed`). Then:

```bash
psql "$SCRATCH_URL" -c "EXPLAIN (ANALYZE, BUFFERS) <the marketplace browse query with ILIKE '%rad%' on title OR body>;"
```

Expect a `Bitmap Index Scan` on the trigram indexes for a term of three or more characters, and first-page p95 under 300 ms for both a three-letter term (`rad`) and a **two-letter** term (`tv`, which the trigram index cannot answer alone, so this one is the hard case).

## 9. Automated checks

```bash
npm run typecheck                      # contracts, server, client, app: a renamed field is a type error everywhere
npm run lint
npm run -w @gwc/contracts test         # search bounds, empty string, term limits
npm run -w server test                 # SQL suites need a DB and skip loudly without one
npm run -w client test                 # gallery, picture fallback, search debounce and stale answers, main-media control, fallback parity
npm run -w client test:i18n            # German and English catalogues agree, in both directions
npm run -w client test:tokens          # no colour literal in new CSS
npm run -w server verify:seo           # crawl: nothing public changed, /marktplatz still aggregate-only
```

Tests that must exist (the counter-assertion is the half that proves the test is not vacuous):

| Suite | Asserts | Counter-assertion |
|---|---|---|
| `offers/search.test.ts` | title and description match, case, part of a word, all words, literals, four mounts, filters, paging | a draft, withdrawn, expired, switched-off-store offer containing the term is **absent** |
| `marketplace/search.test.ts` | title and body match; `q` is not a detail filter | a hidden listing and a locked member's listing are absent |
| `offers/lead-media.test.ts` | first ready item; `list.thumbnail` equals `detail.media[0]` | with a processing first item they still agree |
| `offers/main-media.test.ts` | merchant and super admin succeed; order; audit; idempotent; concurrent calls | plain staff 403, other merchant 404 identical to unknown id, foreign asset 422, nothing written in each |
| `ops/logging-redaction.test.ts` | `q` masked in the logged URL | other parameters still logged |
| `search/indexes.test.ts` | the four partial indexes exist | (fails if one is dropped) |
| `authz/matrix.test.ts` | two new rows | (existing posture gate) |
| `assets/fallback-parity.test.ts` | web and app fallback files are byte-identical | (fails on drift) |

The Expo app has no test runner; Sections 4 to 7 on a real device (iOS and Android) are its test.

## 10. Rolling back

- Code: revert the change; nothing else depends on it.
- Database: `DROP INDEX offers_title_trgm_idx, offers_description_trgm_idx, listings_title_trgm_idx, listings_body_trgm_idx;` (the extension may stay). No data was changed by this feature except the audited ordering of `offer_media` rows.
