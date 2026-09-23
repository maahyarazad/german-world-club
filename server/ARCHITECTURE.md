# Server Architecture

This document explains how `server/src` is organized: which folder holds which concern, and how
that maps onto Fastify's own concepts (plugins, decorators, hooks). It exists so a developer
joining this codebase can find any endpoint's layers in minutes and learn Fastify's structure from
real files here rather than from scratch.

## Layers

Every HTTP-facing feature lives under `server/src/modules/<domain>/` (`auth`, `media`, `seo`,
`organisations`, `push`, `public`, and since feature 009 `onboarding`, `profile`, `events`, `threads`) and is split into three files/folders, in the order a request
actually flows through them:

```text
modules/<domain>/
├── routes.js          # Fastify wiring: path, method, schema, config.auth, config.produces
├── controller.js       # translates request → application call → reply; no business rules
└── application/         # the actual rule, one file per use case, framework-free
```

- **`routes.js`** declares *what exists*: the URL, the HTTP method, the request/response Zod
  schemas, and the access posture (`config.auth`) every route must state (`CLAUDE.md`'s "Four
  gates refuse to boot"). It never contains a database query or a business rule — only wiring to a
  `controller.js` function. Example: `modules/auth/routes.js` declares `POST /auth/sign-in` with
  its schema and posture, then hands the request straight to `controller.signIn`.
- **`controller.js`** is the seam between HTTP and the domain. It pulls plain values out of
  `request` (body, params, principal, deadline signal), calls one `application/` function with
  those values plus `app` (for `app.pg`, `app.audit`, `app.mintAccessToken`, etc.), and shapes the
  result back onto `reply` — status code, cookies, headers. A controller function is never more
  than a few lines of mapping; if it starts making a decision about *whether* something is allowed
  or *what* happens next, that decision belongs one layer down.
- **`application/`** holds the rule itself: what "sign in" means, what a media upload's quota check
  does, what the sitemap includes. These functions take `app` and plain data, never `request` or
  `reply` (a few pre-existing cross-cutting authz guards — `guardSeoEdit`, `guardOrganisationScope`
  — are the one exception, since they audit denials through the request id and are shared
  infrastructure this feature didn't introduce). They can be called and tested without an HTTP
  request in hand.

Two kinds of code sit outside this three-layer split, deliberately:

- **Shared, framework-free infrastructure** — `server/src/db/` (Postgres access, counters),
  `server/src/authz/` (permission resolution, object guards), `server/src/integrations/` (mail,
  SMS, payments, geocoding, the outbound HTTP client) — is *lib*, not a domain. Any module's
  `application/` code may import it; it never imports a domain back.
- **`server/src/ops/`** (`health.js`, `jobs.js`, `metrics.js`, `audit.js`) is kept flat, not split
  into routes/controller/application. Each file is already one narrow concern with no business
  rule worth extracting — forcing the same three-file ceremony onto a liveness check would add
  indirection with no navigability benefit, which is the actual goal of this layering (see
  `specs/006-server-clean-architecture/spec.md`, Success Criteria).
- **`server/src/seed/`** and **`server/src/scripts/`** are CLI entry points (`seed:demo`,
  `migrate`, `keys:generate`, …), never HTTP routes, and stay outside `modules/` for that reason.

## Fastify concepts in this repo

Fastify gives you three different ways to add behaviour to an app, and this codebase keeps each
one in its own place so you can tell them apart on sight:

- **A plugin** is anything registered with `app.register(...)`. It's how you add a self-contained
  piece of functionality — third-party (`@fastify/cors`, `@fastify/jwt`) or your own. This
  project's own bootstrap plugins live in **`server/src/plugins/`**, numbered `00` through `15`
  because — per `CLAUDE.md` — **the registration order is semantic and load-bearing**: correlation
  before logging, security headers before routes, rate limits before authentication (so an
  unauthenticated flood is cheap to refuse), authentication before authorization, deadlines before
  handlers. `server/src/plugins/07-rate-limit.js` is a plugin: it registers `@fastify/rate-limit`
  and decorates `app.bucket(...)`/`app.rateLimit(...)` for every route to use. Each domain's
  `routes.js` (e.g. `modules/auth/routes.js`) is *also* a plugin, in the Fastify sense — it's just
  registered after the numbered bootstrap, and it registers routes rather than infrastructure.
  This reorganization moved **where** those plugins live; it did not renumber or reorder the `00`–
  `15` sequence, which stays exactly as `CLAUDE.md` describes it.

- **A decorator** is anything added with `app.decorate(...)` (or `decorateRequest`/
  `decorateReply`), and it's how a plugin hands the rest of the app a value or a function to call
  later — `app.pg`, `app.mintAccessToken`, `app.sendOtp`. Most decorators in this codebase come
  from a plugin that also does other work (`app.breakers` from `13-breakers.js`, `app.guard` from
  `11-rbac.js`). The handful that were previously written inline in `server/src/app.js`, with no
  plugin of their own, now live in **`server/src/decorators/`** — one file per decorator, each
  exporting a `register*(app, ...)` function that `app.js` calls. `server/src/decorators/
  send-otp.js` is the clearest example: it decorates `app.sendOtp`, a function every other part of
  the app can call to deliver a one-time code, without any of them needing to know it runs behind
  an SMS circuit breaker.

- **A hook** is a function added with `app.addHook(...)` that Fastify calls automatically at a
  lifecycle point (`onRequest`, `preHandler`, `onSend`, `onError`, `onClose`, `onReady`, …) —
  Fastify's version of middleware. Most hooks in this codebase live inside the plugin or route
  file whose concern they serve (the CSRF check used to be the exception: it ran on every request
  but belonged to no plugin). It now lives in **`server/src/hooks/`** alongside the two other
  cross-cutting hooks that were inline in `app.js`: `server/src/hooks/csrf-on-request.js` (an
  `onRequest` hook that runs the double-submit CSRF check before any route handler), `shutdown.js`
  (an `onClose` hook that closes outbound HTTP dispatchers), and `budget-on-ready.js` (an
  `onReady` hook that asserts every route's outbound budget fits inside its deadline). A
  route-scoped hook — like `modules/auth/routes.js`'s `onSend` hook that stamps every `/auth/*`
  response `cache-control: no-store` — stays in that route file, because it only makes sense next
  to the routes it applies to.

In short: **plugins** are `server/src/plugins/*` (the numbered boot sequence) plus each domain's
own `routes.js`; **decorators** are `server/src/decorators/*` plus the ones declared inline inside
a plugin; **hooks** are `server/src/hooks/*` plus the ones declared inline inside a plugin or a
domain's `routes.js`. If you're not sure which a piece of code is, ask what Fastify API call
creates it — `register`, `decorate`, or `addHook` — and that's your answer.

## Adding a new endpoint

`server/src/modules/organisations/` is the smallest fully-migrated domain and the one to copy.
Adding a new endpoint means creating (or extending) exactly three things:

1. **`application/<use-case>.js`** — write the rule as a plain async function:
   `export async function doTheThing(app, { ...plainArgs }) { ... }`. It may read `app.pg`, call
   other decorators (`app.audit`, `app.mintAccessToken`, …), and call another domain's
   `application/` functions directly if it needs to — but it must never import another domain's
   `routes.js` or `controller.js`, and it never touches `request` or `reply` (see the exception
   above for the two pre-existing shared object guards).
2. **`controller.js`** — add one function that takes `(request, reply)`, pulls out the plain values
   your `application/` function needs, calls it, and turns the result into a `reply.send(...)`
   (with whatever status code, header, or cookie the response needs).
3. **`routes.js`** — add the `app.get`/`app.post`/etc. call: the path, `config.auth` (mandatory —
   an undeclared posture fails the startup gate), `schema.response` or `config.produces`
   (mandatory for the same reason), and pass your new controller function as the handler.

Copy `modules/organisations/application/get-organisation.js`,
`modules/organisations/controller.js`, and the relevant block of
`modules/organisations/routes.js` as a template — rename, and follow the same three-step shape. A
code reviewer can object to a PR that skips a layer (business logic written directly in a route
handler, or a route with no `config.auth`) the same way they'd object to a route with no schema:
it's not a style preference, it's the thing this reorganization exists to make visible in a diff.
