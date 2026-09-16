import fp from 'fastify-plugin'
import swagger from '@fastify/swagger'
import { jsonSchemaTransform } from 'fastify-type-provider-zod'

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
 * The UI is deliberately not registered. This describes gated, member-facing
 * endpoints for an invite-only club, so an unauthenticated explorer on the
 * public origin would publish the entire shape of the admin surface — and
 * §10.1 already classifies `/api` as a gated, never-indexed surface.
 */
export default fp(
  async function openapi(app) {
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
      async (request, reply) => reply.send(app.swagger()),
    )
  },
  { name: 'openapi', dependencies: ['auth', 'rate-limit'] },
)
