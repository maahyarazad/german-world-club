# German World Club — mobile app

Expo SDK 57 (React Native 0.86, Expo Router, React Compiler). It is an npm workspace of the
platform monorepo and imports `@gwc/contracts` directly, so a field renamed on the server is
a type error here.

## Run it

```bash
# from the repo root: install once for every workspace
npm install

# the API (see server/README.md for its preconditions)
npm run -w server migrate && npm run -w server dev

# the app
cd expo-client/german-world-club
npx expo start            # then i / a for a simulator, or scan with a dev build
```

The app calls the API on the machine running Metro, port 3000. Set `EXPO_PUBLIC_API_URL` to
point it anywhere else.

**Onboarding needs SMS.** The server refuses to register anyone when SMSGlobal is not
configured (`SMSGLOBAL_API_KEY`/`SECRET` in `server/.env`), on purpose: a verification code
that is never sent is not a verification. Email codes do not need a provider in development:
with `NODE_ENV=development` the server logs queued mail, code included.

## Checks

```bash
npm run typecheck          # tsc, strict, typed routes
npx expo export --platform ios   # proves Metro can bundle the workspace
```

## Layout

```
src/app/                   Expo Router. One route group per audience, guarded by Stack.Protected:
  (public)/                signed out: welcome, sign-in (+ SMS code), register → country → verify mobile
  (applicant)/             onboarding session: verify email, waiting / denied
  (member)/                approved member: native tabs — threads, events, profile
  (organisation)/          merchant or partner: their profile
src/api/                   the one HTTP client (bearer, single-flight refresh, problem+json) and typed endpoints
src/session/               who is signed in and where they belong; tokens in SecureStore
src/i18n/                  en/de catalogues; `de` is typed against `en`, so a missing key fails tsc
src/components/            UI primitives, post card, country picker
src/data/countries.ts      generated ISO 3166 list with English and German names
```

Rules this app keeps, and why, are in the comments next to them. The short version:

- Screens branch on a problem's `type`, never on its `detail`. The server emits no localised
  text, and `src/i18n` translates problem types.
- The guards are UX, not security. The server re-checks everything.
- Prices shown are the server's current phase price. The amount a member pays is whatever the
  server computed at registration time, never a client-side total.
