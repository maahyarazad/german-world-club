import fp from 'fastify-plugin'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { jsonSchemaTransform } from 'fastify-type-provider-zod'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { GwcApp } from '../app.ts'

/**
 * OpenAPI, generated from the shared Zod schemas (T196).
 *
 * The document is *derived*, never written. A hand-maintained API description
 * is a third place the contract lives — after the server and the clients — and
 * it is the one nothing breaks when it drifts, so it drifts first and quietly.
 * Because `fastify-type-provider-zod` already compiles those same schemas for
 * request validation and response serialization, the document and the runtime
 * cannot disagree: they are the same objects.
 *
 * The UI is registered, but gated (T206-T223). The reason it was withheld
 * originally still stands — this describes gated, member-facing endpoints for
 * an invite-only club, so an unauthenticated explorer on the public origin
 * would publish the entire shape of the admin surface — so it is mounted under
 * `/admin`, behind the same `settings.read` posture as the document itself.
 * §10.1 already classifies `/admin` as gated and never-indexed, which is what
 * keeps `X-Robots-Tag: noindex` and the `robots.txt` disallow correct for the
 * docs without a second declaration.
 *
 * In development — and only there — a second, unauthenticated copy is mounted
 * at `/swagger-ui`, because on a laptop the gated one costs a staff account, a
 * grant and a token before you can read your own API. The argument above is
 * about a public origin serving real members, which a development process is
 * not. The exemption is a registration that never happens rather than a check
 * inside a handler, so the shipping posture has no branch in it.
 */
/** Where the docs UI is mounted. Under `/admin` so §10.1's posture applies. */
const DOCS_PREFIX = '/admin/docs'

/**
 * Where the *unguarded* copy is mounted, in development only.
 *
 * A second mount rather than a relaxed posture on the first: the gated one
 * keeps its `settings.read` declaration verbatim in every environment, so
 * nothing about production behaviour depends on reading an `if` correctly.
 * This one exists, or it does not exist at all.
 */
const DEV_DOCS_PREFIX = '/swagger-ui'

/**
 * One posture for the docs and the document they render. `settings.read` is
 * the module a staff member needs to see how the system is configured; the UI
 * shows strictly nothing the JSON does not.
 */
const DOCS_AUTH = Object.freeze({ audience: 'staff', module: 'settings', flag: 'read' })

export default fp(
  async function openapi(app: GwcApp) {
    await app.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'German World Club Platform API',
          description:
            'One API serving the member web client, the mobile app and the staff console. ' +
            'Errors are RFC 9457 problem+json; clients branch on `type`, never on `detail`.',
          version: '1.0.0',
        },
        servers: [{ url: app.env.canonicalOrigin }],
        components: {
          securitySchemes: {
            bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
            // The browser face uses a cookie; the mobile face uses a bearer.
            // One verification path serves both, so both are described.
            cookie: { type: 'apiKey', in: 'cookie', name: 'gwc_at' },
          },
        },
        tags: [
          { name: 'auth', description: 'Sign-in, OTP, refresh, password reset' },
          { name: 'media', description: 'Upload, derivatives, content-addressed delivery' },
          { name: 'push', description: 'Device registration and staff broadcasts' },
          { name: 'admin', description: 'Staff-gated administration' },
          { name: 'public', description: 'Publicly crawlable content' },
          { name: 'ops', description: 'Health and readiness' },
        ],
      },
      transform: jsonSchemaTransform,
    })

    /**
     * Tag and annotate each route from the posture it already declares, rather
     * than from a second set of annotations someone has to remember to add.
     * The access posture is the single source for both.
     */
    app.addHook('onRoute', (route) => {
      const auth = route.config?.auth
      if (!auth || route.schema?.hide) return

      const [prefix] = route.url.split('/').filter(Boolean)
      const tag = { auth: 'auth', media: 'media', push: 'push', admin: 'admin', health: 'ops' }[prefix] ?? 'public'

      route.schema = {
        ...route.schema,
        tags: route.schema?.tags ?? [tag],
        security: auth.audience === 'public' ? [] : [{ bearer: [] }, { cookie: [] }],
        description:
          route.schema?.description ??
          (auth.audience === 'staff'
            ? `Requires \`${auth.flag}\` on the \`${auth.module}\` module.`
            : auth.audience === 'member'
              ? 'Requires an authenticated member.'
              : undefined),
      }
    })

    /**
     * The document as JSON, on a staff-gated route.
     *
     * Gated rather than public for the reason above: the shape of the admin API
     * is not something an invite-only club publishes. `settings.read` is the
     * module a staff member needs to see how the system is configured.
     */
    /**
     * The docs UI, mounted under `/admin` and gated like everything else there.
     *
     * Registered inside an *encapsulated* scope, which is what makes the two
     * startup gates satisfiable. `@fastify/swagger-ui` registers six routes of
     * its own plus a `@fastify/static` subtree, and declares a posture for none
     * of them — so a bare `app.register(swaggerUi)` does not produce an
     * unguarded docs page, it produces a server that refuses to boot. The scope
     * gives us one place to declare the posture for all of them at once, which
     * is the mechanism `11-rbac.js` defers its judgement for.
     */
    await app.register(async function docsUi(scope) {
      /**
       * Declare the posture for every route swagger-ui registers, including the
       * ones @fastify/static generates. Written here rather than passed as
       * options because the library exposes no way to set `config` per route.
       */
      scope.addHook('onRoute', (route) => {
        route.config = {
          ...route.config,
          auth: DOCS_AUTH,
          budget: 'admin-read',
          rateLimit: app.bucket('admin-api'),
          // swagger-ui already sets `schema.hide` on its own routes, which
          // satisfies the response half of the gate. The static subtree does
          // not, and it is bytes rather than a document either way.
          produces: route.url === DOCS_PREFIX ? 'text/html' : 'binary',
        }
      })

      /**
       * Enforce it, as a scope-level hook rather than through swagger-ui's own
       * `uiHooks`.
       *
       * `uiHooks` are spread onto the six routes the library declares by hand
       * and are **not** passed to the `@fastify/static` registration that
       * serves the bundle — so using them would authenticate the HTML page and
       * leave `/admin/docs/static/*` open. A scope hook covers every route in
       * the subtree, including the ones a future version of the library adds.
       */
      for (const hook of [].concat(app.guard)) scope.addHook('onRequest', hook)

      /**
       * The bucket, attached explicitly rather than through `config.rateLimit`.
       *
       * @fastify/rate-limit reads that config in its own `onRoute` hook, and
       * that hook is registered at the root context long before this scope
       * exists — so it runs *first* and sees a config the hook above has not
       * written yet. Declaring the bucket in `config` alone therefore produces
       * no limiter at all, silently: the route answers, with no `ratelimit-*`
       * headers and no counting. The config stamp above is still required,
       * because the shared `keyGenerator` and the refusal metric both read the
       * bucket name from it at request time; this line is what actually counts.
       *
       * `preHandler` rather than `onRequest` because `admin-api` is keyed by
       * account, which does not exist until the guard above has run.
       */
      scope.addHook('preHandler', app.rateLimit(app.bucket('admin-api')))

      await scope.register(swaggerUi, {
        routePrefix: DOCS_PREFIX,
        /**
         * swagger-ui ships its own CSP as an `onSend` hook confined to this
         * scope, overriding helmet's global policy for these routes only. It
         * is hash-based and needs no `unsafe-inline`: the bundle externalises
         * its scripts, so `static/csp.json` carries empty hash lists and the
         * resulting policy is barely wider than the global one.
         */
        staticCSP: true,
        uiConfig: {
          // A shared staff workstation must not retain a pasted token.
          persistAuthorization: false,
          deepLinking: true,
          tryItOutEnabled: true,
          // The schema list is long and would otherwise bury the operations.
          defaultModelsExpandDepth: -1,
          // Cookie-carrying "try it out" requests: the browser face is the
          // cookie, and same-origin is the only transport that works from a
          // document. Bearer tokens do not ride along on a page load.
          withCredentials: true,
        },
      })
    })

    /**
     * The same UI, unauthenticated, at `/swagger-ui` — development only.
     *
     * Registering it costs a developer nothing to reach and a reviewer nothing
     * to audit, because the guard is the *registration*, not a check inside a
     * handler: outside `NODE_ENV=development` these routes are never added to
     * the router at all, so there is no posture to get wrong, no header to
     * forget and no test that can pass against a production build by accident.
     * `development` exactly, not `!isProduction`: `test` is a CI environment
     * that should exercise the shipping posture, and staging runs as
     * production.
     *
     * Its own encapsulated scope, for the reason the gated mount has one — and
     * additionally because `@fastify/swagger-ui` is `fastify-plugin`-wrapped
     * and decorates `swaggerCSP`. Two registrations under one context would be
     * a duplicate decorator and a boot failure; as siblings, each decorates its
     * own scope.
     */
    if (app.env.NODE_ENV === 'development') {
      await app.register(async function devDocsUi(scope) {
        scope.addHook('onRoute', (route) => {
          route.config = {
            ...route.config,
            // The affirmative act Principle II asks for. It is confined to a
            // branch that cannot be taken in production, and it shows up in a
            // diff like any other public declaration.
            auth: { audience: 'public' },
            budget: 'public-page',
            rateLimit: app.bucket('public-read'),
            produces: route.url === DEV_DOCS_PREFIX ? 'text/html' : 'binary',
          }
        })

        /**
         * Counted, even unauthenticated. `public-read` is IP-keyed, so unlike
         * the gated mount the limiter can run at `onRequest` — there is no
         * principal to wait for. Attached explicitly for the same reason as
         * above: @fastify/rate-limit read `config.rateLimit` in its own
         * root-level `onRoute` hook before this scope existed.
         */
        scope.addHook('onRequest', app.rateLimit(app.bucket('public-read')))

        await scope.register(swaggerUi, {
          routePrefix: DEV_DOCS_PREFIX,
          staticCSP: true,
          uiConfig: {
            // A local machine, a throwaway token: remembering it between
            // reloads is the whole convenience of the dev mount.
            persistAuthorization: true,
            deepLinking: true,
            tryItOutEnabled: true,
            defaultModelsExpandDepth: -1,
            withCredentials: true,
          },
        })
      })
    }

    app.get(
      '/admin/openapi.json',
      {
        config: {
          auth: { audience: 'staff', module: 'settings', flag: 'read' },
          budget: 'admin-read',
          rateLimit: app.bucket('admin-api'),
        },
        onRequest: app.guard,
        // No response schema: the document's own shape is OpenAPI's, and
        // serializing it through a Zod schema would only describe it twice.
        schema: { hide: true },
      },
      async (request: FastifyRequest, reply: FastifyReply) => reply.send(app.swagger()),
    )
  },
  { name: 'openapi', dependencies: ['auth', 'rate-limit'] },
)
