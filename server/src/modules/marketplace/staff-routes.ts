import fp from 'fastify-plugin'
import { z } from 'zod'
import { MARKETPLACE_CATEGORIES, MARKETPLACE_MODES, MARKETPLACE_STATES } from '@gwc/contracts/marketplace'
import { createMarketplaceStaffController } from './staff-controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Staff moderation of the marketplace (US4, contracts/moderation-api.md).
 *
 * Gated on the **existing** `marketplace_moderation` module — this feature
 * adds no permission, it fills a hole the matrix already has.
 *
 * `write` and `edit` are used by NOTHING in this file, on purpose. §11 keeps
 * the matrix uniform across modules, and a reader who finds only `read`,
 * `status` and `delete` here should see that as a decision, not an
 * oversight: staff moderating a classified must not become staff editing
 * what a member said (`tests/marketplace/moderation.test.ts`'s counter-
 * assertion is exactly this).
 *
 * `/admin` is already gated and never-indexed in `seo/surfaces.ts`, so the
 * crawl posture is inherited rather than declared again here.
 */
export default fp(
  async function marketplaceStaffRoutes(app: GwcApp) {
    const controller = createMarketplaceStaffController(app)

    const listingResponseSchema = z.object({
      id: z.string(),
      ownerId: z.string(),
      ownerDisplayName: z.union([z.string(), z.null()]),
      category: z.string(),
      mode: z.string(),
      title: z.string(),
      body: z.string(),
      state: z.string(),
      contactMethod: z.string(),
      createdAt: z.union([z.string(), z.date()]),
      publishedAt: z.union([z.string(), z.date(), z.null()]),
      expiresAt: z.union([z.string(), z.date(), z.null()]),
      stateChangedAt: z.union([z.string(), z.date()]),
      // Feature 037. Declared, because Zod's serializer drops any key an object
      // schema does not list — a field added to the handler alone is never sent.
      hiddenFromState: z.union([z.enum(['draft', 'active']), z.null()]),
      openReports: z.number(),
    })

    const staffRowSchema = z.object({
      id: z.string(),
      title: z.string(),
      category: z.enum(MARKETPLACE_CATEGORIES),
      mode: z.enum(MARKETPLACE_MODES),
      state: z.enum(MARKETPLACE_STATES),
      hiddenFromState: z.union([z.enum(['draft', 'active']), z.null()]),
      owner: z.object({ id: z.string(), displayName: z.union([z.string(), z.null()]) }),
      createdAt: z.union([z.string(), z.date()]),
      publishedAt: z.union([z.string(), z.date(), z.null()]),
      expiresAt: z.union([z.string(), z.date(), z.null()]),
      stateChangedAt: z.union([z.string(), z.date()]),
      openReports: z.number(),
    })

    const stateChangeResponseSchema = z.object({
      id: z.string(), state: z.string(), stateChangedAt: z.union([z.string(), z.date()]),
    })

    const reasonBody = z.object({ reason: z.string().trim().min(3).max(2000) })

    app.get(
      '/admin/marketplace/reports',
      {
        config: {
          auth: { audience: 'staff', module: 'marketplace_moderation', flag: 'read' },
          budget: 'admin-read', rateLimit: app.bucket('admin-api'),
        },
        onRequest: app.guard,
        schema: {
          querystring: z.object({ state: z.enum(['open', 'upheld', 'dismissed']).optional() }),
          response: {
            200: z.object({
              items: z.array(z.object({
                id: z.string(),
                listingId: z.string(),
                reporterId: z.string(),
                reason: z.string(),
                state: z.string(),
                createdAt: z.union([z.string(), z.date()]),
                resolvedAt: z.union([z.string(), z.date(), z.null()]),
                resolvedBy: z.union([z.string(), z.null()]),
                listingTitle: z.string(),
                listingState: z.string(),
              })),
            }),
          },
        },
      },
      controller.reports,
    )

    // Every member listing in every state (feature 037). Read-only, on the
    // existing `read` flag: staff can find a record, not rewrite it. Merchant
    // offers are other tables and cannot appear.
    app.get(
      '/admin/marketplace/listings',
      {
        config: {
          auth: { audience: 'staff', module: 'marketplace_moderation', flag: 'read' },
          budget: 'admin-read', rateLimit: app.bucket('admin-api'),
        },
        onRequest: app.guard,
        schema: {
          // `limit` is unbounded here and bounded in the handler, like browse:
          // a `.max()` would answer 400 today and 200 once the schema goes.
          querystring: z.object({
            state: z.enum(MARKETPLACE_STATES).optional(),
            category: z.enum(MARKETPLACE_CATEGORIES).optional(),
            ownerId: z.string().uuid().optional(),
            q: z.string().max(100).optional(),
            cursor: z.string().optional(),
            limit: z.unknown().optional(),
          }),
          response: {
            200: z.object({ items: z.array(staffRowSchema), nextCursor: z.union([z.string(), z.null()]) }),
          },
        },
      },
      controller.listings,
    )

    app.get(
      '/admin/marketplace/listings/:id',
      {
        config: {
          auth: { audience: 'staff', module: 'marketplace_moderation', flag: 'read' },
          budget: 'admin-read', rateLimit: app.bucket('admin-api'),
        },
        onRequest: app.guard,
        schema: { params: z.object({ id: z.string().uuid() }), response: { 200: listingResponseSchema } },
      },
      controller.getListing,
    )

    app.post(
      '/admin/marketplace/listings/:id/hide',
      {
        config: {
          auth: { audience: 'staff', module: 'marketplace_moderation', flag: 'status' },
          budget: 'admin-read', rateLimit: app.bucket('admin-api'),
        },
        onRequest: app.guard,
        schema: {
          params: z.object({ id: z.string().uuid() }), body: reasonBody,
          response: { 200: stateChangeResponseSchema },
        },
      },
      controller.hide,
    )

    app.post(
      '/admin/marketplace/listings/:id/restore',
      {
        config: {
          auth: { audience: 'staff', module: 'marketplace_moderation', flag: 'status' },
          budget: 'admin-read', rateLimit: app.bucket('admin-api'),
        },
        onRequest: app.guard,
        schema: {
          params: z.object({ id: z.string().uuid() }), body: reasonBody,
          response: { 200: stateChangeResponseSchema },
        },
      },
      controller.restore,
    )

    app.delete(
      '/admin/marketplace/listings/:id',
      {
        config: {
          auth: { audience: 'staff', module: 'marketplace_moderation', flag: 'delete' },
          budget: 'admin-read', rateLimit: app.bucket('admin-api'),
        },
        onRequest: app.guard,
        schema: {
          params: z.object({ id: z.string().uuid() }), body: reasonBody,
          response: { 200: z.object({ id: z.string(), removed: z.boolean() }) },
        },
      },
      controller.remove,
    )

    app.post(
      '/admin/marketplace/reports/:id/resolve',
      {
        config: {
          auth: { audience: 'staff', module: 'marketplace_moderation', flag: 'status' },
          budget: 'admin-read', rateLimit: app.bucket('admin-api'),
        },
        onRequest: app.guard,
        schema: {
          params: z.object({ id: z.string().uuid() }),
          body: z.object({
            outcome: z.enum(['upheld', 'dismissed']),
            reason: z.string().trim().min(3).max(2000),
          }),
          response: { 200: z.object({ id: z.string(), listingId: z.string(), state: z.string() }) },
        },
      },
      controller.resolveReport,
    )
  },
  { name: 'marketplace-staff-routes', dependencies: ['auth', 'rate-limit'] },
)
