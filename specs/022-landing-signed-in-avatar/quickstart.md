# Quickstart: the landing page for a signed-in visitor

## Automated

```bash
DATABASE_URL=postgres://…/gwc_test npm run -w server test -- seo authz
```

## By hand

1. `npm run -w server dev` and `npm run -w client dev`. Open `/` signed out: "Anmelden" as today.
2. Sign in at `/konsole/anmelden` as a member with a profile picture, then open `/`. The picture
   is top right and links to your console. The sign-in section says "Zur Konsole".
3. `/en`: the same in English.
4. A member without a picture, and a staff login: initials.
5. Response headers (DevTools): `cache-control: private, no-store` when signed in, and the old
   value signed out.
6. Sign out, then open `/`: "Anmelden" again.
7. View source: no `<script>`.

## Walkthrough record (2026-11-13)

Not walked in a browser yet (T016 open). `tests/seo/landing-viewer.test.ts` covers steps 2–7:
- the avatar and initials, and the `/en` labels;
- headers, with `private, no-store` and `Vary: Cookie` signed in, and public caching unchanged
  anonymously;
- revoked, garbage and expired cookies, and locked, pending and suspended accounts, all
  anonymous;
- escaping, and no `<script>`;
- the anonymous body is byte-for-byte the shell.

`verify:seo` wasn't run, because it needs a running server. The crawl is anonymous, so it sees
the unchanged page.
