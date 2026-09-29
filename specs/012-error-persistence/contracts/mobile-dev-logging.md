# Contract: Mobile Development Logging

**Feature**: 012-error-persistence | Module: `expo-client/german-world-club/src/lib/log.ts`

This is a development-time contract between the app and the developer reading the console. It is not a network interface. It fixes *what a line contains*, so the output can be relied on and checked.

---

## Guard

Every function exits immediately unless `__DEV__` is `true`. There is no runtime override. In a release bundle (`eas build` preview/production, or `npx expo start --no-dev --minify`) the bodies are dead code and are removed by the minifier.

## API

```ts
devLog.request({ method, path, status, ms, requestId })
devLog.failure({ method, path, status, ms, requestId, problemType })   // status/requestId null when offline
devLog.info(scope: string, message: string, fields?: Record<string, string | number | boolean | null>)
devLog.error(scope: string, error: unknown)
```

The `fields` values are primitives only: no objects, and so no accidental body or header dump.

## Line format

Every line starts with `[gwc]` so it can be filtered in the Metro terminal or DevTools.

| Event | Level | Example |
|---|---|---|
| Successful request | `console.log` | `[gwc] GET /member/events 200 84ms req=01J8Z3K2QX…` |
| Server problem | `console.warn` for 4xx, `console.error` for 5xx | `[gwc] POST /threads/posts 500 132ms req=01J8Z3M… type=https://…/problems/internal` |
| Network failure | `console.error` | `[gwc] GET /member/offers network-error 3012ms (Network request failed)` |
| Token refresh | `console.log` / `console.warn` | `[gwc] POST /auth/refresh 200 45ms` (never the body) |
| Unhandled JS error | `console.error` | `[gwc] unhandled TypeError: Cannot read properties of undefined (reading 'id')` followed by the stack |
| Scoped info | `console.log` | `[gwc] push registered token=ExponentPush…ab1]` (via `tokenPreview`) |

The `req=` value is the `x-request-id` the server returned, always a server-generated ULID. The app sends no id of its own, so no `x-client-request-id` appears. On a 5xx it is the key to look up in the console's **Fehlerprotokoll** page (`contracts/server-faults-api.md`).

## Never printed

- `authorization` header, access token, refresh token
- request and response bodies (passwords, one-time codes and contact details live there)
- query strings (stripped from `path`)
- full push tokens: only `tokenPreview(token)` (first 12 and last 4 characters), moved from the server into `@gwc/contracts/push` so app and server share one definition

## Enforcement

- `eslint.config.js` in the Expo app: `no-console: 'error'`, with an override for `src/lib/log.ts` only.
- `package.json`: `"test": "expo lint"`, so the root `npm test` fails on a direct `console.*` anywhere else.
