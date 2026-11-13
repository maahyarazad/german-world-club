# Quickstart: validating member posting without job offers

Contracts: [contracts/http-and-ui.md](./contracts/http-and-ui.md). Trigger and seed:
[data-model.md](./data-model.md).

## Setup

```bash
npm run -w server migrate          # applies 042_member_marketplace_posting.sql
npm run -w server seed:demo
npm run -w server dev
npm run -w client dev
```

## Automated

```bash
DATABASE_URL=postgres://…/gwc_test npm run -w server test -- marketplace authz
npm run -w packages/contracts test
npm run -w client test && npm run -w client test:i18n
npx tsc --noEmit -p client && npx tsc --noEmit -p expo-client/german-world-club
```

## By hand

1. **Anyone can post.** Sign in as a demo member who never had `marketplace_post`. Marketplace
   shows **New listing**. Post a general offer. It appears for a second member.
2. **Terms still apply.** As a member who hasn't accepted the current terms, New listing asks
   for them first.
3. **No job offer in the form.** In the compose drawer, pick Job. Only Request is offered, and
   the note explains why. With Offer selected first, switching to Job moves the mode to Request.
4. **Job request works.** Publish a job request. It's listed under Job, Request.
5. **Refused directly.** `POST /marketplace/listings` with `category: job, mode: offer` →
   `422 …/marketplace/mode-not-allowed`, and no new row. Editing a general offer into Job →
   the same 422, and the listing is unchanged.
6. **Legacy job offers wind down.** For an existing job offer (from an earlier seed run, or a
   test fixture), its owner can mark it filled or withdraw it, and moderation can hide and
   restore it.
7. **Not members.** A merchant or partner login still can't post a member listing.
8. **App.** Repeat 1, 3 and 4 in the app.
9. **`/auth/me`** no longer lists `marketplace_post`.
