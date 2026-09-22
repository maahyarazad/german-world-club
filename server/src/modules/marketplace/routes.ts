import fp from 'fastify-plugin'
import { z } from 'zod'
import {
  MARKETPLACE_CATEGORIES, MARKETPLACE_MODES, CONTACT_METHODS,
} from '@gwc/contracts/marketplace'
import { createMarketplaceController } from './controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Member marketplace endpoints (§7, feature 008): schema, access posture and
 * wiring only. The rules live in `application/`.
 *
 * **Every route declares `config.auth`** — the onReady gate in 11-rbac refuses
 * to boot otherwise (Principle II), and it is the gate that survived
 * constitution 2.0.0.
 *
 * **Posting declares `requires: 'marketplace_post'`.** That is §7's explicit
 * per-member permission flag, and `plugins/10-auth.ts` already resolves it from
 * server-held state per request and audits the denial. Declaring it here rather
 * than checking it in the handler means making the marketplace postable is an
 * affirmative act that shows up in a diff.
 *
 * **Members only.** `audience: 'member'` is the whole of FR-038: organisations
 * sell through `offers` (§5), and staff do not sell at all — moderating a
 * market you trade in is a conflict of interest.
 */
export default fp(
  async function marketplaceRoutes(app: GwcApp) {
    const controller = createMarketplaceController(app)

    const createListingSchema = z.object({
      category: z.enum(MARKETPLACE_CATEGORIES),
      mode: z.enum(MARKETPLACE_MODES),
      title: z.string().trim().min(3).max(140),
      body: z.string().trim().min(10).max(8000),
      // Shape checked per category by `categories.ts`, which is the half that
      // survives Phase 6.
      details: z.record(z.string(), z.unknown()).default({}),
      features: z.array(z.string()).max(60).default([]),
      contactMethod: z.enum(CONTACT_METHODS).default('platform_message'),
      // Null or absent means unlimited — a first-class choice (FR-028).
      expiresAt: z.union([z.string(), z.null()]).optional(),
      termsVersion: z.string().min(1),
    })

    const listingResponseSchema = z.object({
      id: z.string(),
      category: z.enum(MARKETPLACE_CATEGORIES),
      mode: z.enum(MARKETPLACE_MODES),
      title: z.string(),
      body: z.string(),
      state: z.string(),
      contactMethod: z.string(),
      createdAt: z.union([z.string(), z.date()]),
      publishedAt: z.union([z.string(), z.date(), z.null()]),
      expiresAt: z.union([z.string(), z.date(), z.null()]),
    })

    // ---- Posting ------------------------------------------------------------

    app.post(
      '/marketplace/listings',
      {
        config: {
          auth: { audience: 'member', requires: 'marketplace_post' },
          budget: 'marketplace',
          rateLimit: app.bucket('write-heavy'),
        },
        onRequest: app.guard,
        schema: { body: createListingSchema, response: { 201: listingResponseSchema } },
      },
      controller.create,
    )

    // ---- Terms --------------------------------------------------------------
    //
    // No `requires` here: a member must be able to READ and ACCEPT the terms
    // before they can hold the flag that posting needs. Gating acceptance on
    // the posting permission would be a loop.

    const termsSchema = z.object({
      version: z.string(),
      acceptedVersion: z.union([z.string(), z.null()]),
    })

    app.get(
      '/marketplace/terms',
      {
        config: { auth: { audience: 'member' }, budget: 'marketplace' },
        onRequest: app.guard,
        schema: { response: { 200: termsSchema } },
      },
      controller.terms,
    )

    app.post(
      '/marketplace/terms/accept',
      {
        config: { auth: { audience: 'member' }, budget: 'marketplace' },
        onRequest: app.guard,
        schema: { response: { 200: termsSchema } },
      },
      controller.acceptTerms,
    )

    // ---- Category definitions and the live feature catalogue ----------------

    app.get(
      '/marketplace/categories',
      {
        config: { auth: { audience: 'member' }, budget: 'marketplace' },
        onRequest: app.guard,
        schema: {
          response: {
            200: z.object({
              categories: z.array(z.unknown()),
              vehicleFeatures: z.array(
                z.object({ key: z.string(), group: z.string(), position: z.number() }),
              ),
            }),
          },
        },
      },
      controller.categories,
    )
  },
  { name: 'marketplace-routes', dependencies: ['auth', 'rate-limit'] },
)
