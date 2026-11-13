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
