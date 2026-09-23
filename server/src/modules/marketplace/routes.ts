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

    const mediaItemSchema = z.object({
      assetId: z.string(),
      kind: z.string(),
      position: z.number(),
      alt: z.string(),
      width: z.number(),
      height: z.number(),
      durationMs: z.union([z.number(), z.null()]),
      variants: z.array(z.object({
        variant: z.string(), format: z.string(), width: z.number(), url: z.string(),
      })),
      // FR-040: what the index renders for a video. Null for a photo.
      posterUrl: z.union([z.string(), z.null()]),
    })

    const listingResponseSchema = z.object({
      id: z.string(),
      category: z.enum(MARKETPLACE_CATEGORIES),
      mode: z.enum(MARKETPLACE_MODES),
      title: z.string(),
      body: z.string(),
      state: z.string(),
      contactMethod: z.string(),
      // T066/R9 — a resolved PREFERENCE, never a value. Without a slot in this
      // schema the field is computed and then silently stripped: the response
      // serializer here is Zod's own `parse`, which drops any key an object
      // schema does not declare. This is the fix for exactly that.
      contact: z.object({
        method: z.string(),
        available: z.boolean(),
        via: z.union([z.string(), z.null()]),
      }),
      createdAt: z.union([z.string(), z.date()]),
      publishedAt: z.union([z.string(), z.date(), z.null()]),
      expiresAt: z.union([z.string(), z.date(), z.null()]),
      media: z.array(mediaItemSchema).default([]),
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

    // ---- Browsing -----------------------------------------------------------
    //
    // No `requires`: reading the marketplace is not gated on being able to
    // post to it. Only creating a listing needs the per-member flag.

    const listingWithDetailsSchema = listingResponseSchema.extend({
      owner: z.object({ id: z.string(), displayName: z.union([z.string(), z.null()]) }).optional(),
      details: z.record(z.string(), z.unknown()).optional(),
    })

    app.get(
      '/marketplace/listings',
      {
        config: { auth: { audience: 'member' }, budget: 'marketplace' },
        onRequest: app.guard,
        schema: {
          /**
           * `limit` is deliberately UNBOUNDED here and bounded in the handler.
           *
           * Not an oversight. Feature 007 Phase 6 deletes this schema, and a
           * `.max(50)` here would mean `?limit=1000000` answers 400 today and
           * 200-with-50-items afterwards — a silent behaviour change at the
           * exact moment nobody is looking at this route. Bounding in
           * `controller.boundedLimit` makes the two sides of that removal
           * identical, which is the point of doing it there.
           */
          querystring: z.object({
            category: z.enum(MARKETPLACE_CATEGORIES).optional(),
            mode: z.enum(MARKETPLACE_MODES).optional(),
            cursor: z.string().optional(),
            limit: z.unknown().optional(),
          }).loose(),
          response: {
            200: z.object({
              items: z.array(listingWithDetailsSchema),
              nextCursor: z.union([z.string(), z.null()]),
            }),
          },
        },
      },
      controller.browse,
    )

    app.get(
      '/marketplace/listings/:id',
      {
        config: { auth: { audience: 'member' }, budget: 'marketplace' },
        onRequest: app.guard,
        schema: {
          params: z.object({ id: z.string().uuid() }),
          response: { 200: listingWithDetailsSchema },
        },
      },
      controller.findOne,
    )

    // ---- Managing your own listings (US3) ------------------------------------
    //
    // No `requires: 'marketplace_post'` on any of these four. That flag gates
    // making a NEW listing postable; owning ones you already have is not a
    // second privilege — a member whose flag was later revoked must still be
    // able to withdraw or edit what they posted while they held it.

    app.patch(
      '/marketplace/listings/:id',
      {
        config: { auth: { audience: 'member' }, budget: 'marketplace', rateLimit: app.bucket('write-heavy') },
        onRequest: app.guard,
        schema: {
          params: z.object({ id: z.string().uuid() }),
          // Every field optional: PATCH edits what is sent, not a full
          // replacement. `details`/`category` are validated together against
          // the FINAL category in application/manage.ts.
          body: z.object({
            title: z.string().trim().min(3).max(140).optional(),
            body: z.string().trim().min(10).max(8000).optional(),
            category: z.enum(MARKETPLACE_CATEGORIES).optional(),
            details: z.record(z.string(), z.unknown()).optional(),
            features: z.array(z.string()).max(60).optional(),
            contactMethod: z.enum(CONTACT_METHODS).optional(),
            // Present-and-null clears it back to unlimited; absent leaves it
            // untouched. Zod's `.optional()` on a nullable field is what makes
            // "not sent" and "sent as null" two different things on the wire,
            // which is exactly the distinction FR-030 needs.
            expiresAt: z.union([z.string(), z.null()]).optional(),
          }),
          response: { 200: listingResponseSchema },
        },
      },
      controller.edit,
    )

    app.post(
      '/marketplace/listings/:id/state',
      {
        config: { auth: { audience: 'member' }, budget: 'marketplace', rateLimit: app.bucket('write-heavy') },
        onRequest: app.guard,
        schema: {
          params: z.object({ id: z.string().uuid() }),
          // `active`/`draft`/`hidden`/`expired` are refused by application/
          // manage.ts, not by this enum — the refusal has to distinguish "not
          // a state a member may request" from "not reachable from here right
          // now", and only the loaded row knows which.
          body: z.object({ state: z.enum(['sold', 'filled', 'withdrawn']) }),
          response: {
            200: z.object({
              id: z.string(),
              state: z.string(),
              stateChangedAt: z.union([z.string(), z.date()]),
            }),
          },
        },
      },
      controller.setState,
    )

    app.get(
      '/marketplace/mine',
      {
        config: { auth: { audience: 'member' }, budget: 'marketplace' },
        onRequest: app.guard,
        schema: {
          // No `details`/`media` here: this is the owner's management list,
          // not the public-facing card the index renders. A dedicated GET
          // /marketplace/listings/:id already carries those for one listing.
          response: { 200: z.object({ items: z.array(listingResponseSchema) }) },
        },
      },
      controller.mine,
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

    // ---- Enquiry ------------------------------------------------------------
    //
    // Under `/marketplace` because the listing is the resource it acts on and
    // the guard it needs — the listing must be inquirable. What it produces is
    // a conversation, which `modules/messaging` owns from then on.
    //
    // No `requires: 'marketplace_post'`: contacting a seller is not selling.
    // Gating it on the posting flag would mean only sellers could buy.

    app.post(
      '/marketplace/listings/:id/inquire',
      {
        config: {
          auth: { audience: 'member' },
          budget: 'messaging',
          rateLimit: app.bucket('messages'),
        },
        onRequest: app.guard,
        schema: {
          params: z.object({ id: z.string() }),
          body: z.object({ body: z.string().trim().min(1).max(4000) }),
          response: {
            201: z.object({
              conversationId: z.string(),
              created: z.boolean(),
              message: z.object({
                id: z.string(),
                conversationId: z.string(),
                senderId: z.string(),
                body: z.string(),
                createdAt: z.union([z.string(), z.date()]),
              }),
            }),
          },
        },
      },
      controller.inquire,
    )

    // ---- Reporting (US4) ------------------------------------------------------
    //
    // Member-side half of moderation: any member may report any listing, once
    // per listing while their report is open. The staff half — the queue and
    // the actions it enables — lives in `staff-routes.ts`, gated on the
    // existing `marketplace_moderation` module rather than anything declared
    // here.

    app.post(
      '/marketplace/listings/:id/report',
      {
        config: { auth: { audience: 'member' }, budget: 'marketplace', rateLimit: app.bucket('write-heavy') },
        onRequest: app.guard,
        schema: {
          params: z.object({ id: z.string().uuid() }),
          body: z.object({ reason: z.string().trim().min(3).max(2000) }),
          response: { 201: z.object({ id: z.string(), state: z.string() }) },
        },
      },
      controller.report,
    )

    // ---- Media --------------------------------------------------------------
    //
    // A link, not an upload. `POST /media` did the inspection, the metadata
    // strip and the derivation; these two routes only say which assets belong
    // to which listing, and in what order. `requires: 'marketplace_post'`
    // because attaching media to a listing is part of posting one.

    const mediaLinkSchema = z.object({
      listingId: z.string(),
      assetId: z.string(),
      position: z.number(),
    })

    app.post(
      '/marketplace/listings/:id/media',
      {
        config: {
          auth: { audience: 'member', requires: 'marketplace_post' },
          budget: 'marketplace',
          rateLimit: app.bucket('write-heavy'),
        },
        onRequest: app.guard,
        schema: {
          params: z.object({ id: z.string() }),
          body: z.object({ assetId: z.string() }),
          response: { 201: mediaLinkSchema },
        },
      },
      controller.attachMedia,
    )

    app.delete(
      '/marketplace/listings/:id/media/:assetId',
      {
        config: {
          auth: { audience: 'member', requires: 'marketplace_post' },
          budget: 'marketplace',
          rateLimit: app.bucket('write-heavy'),
        },
        onRequest: app.guard,
        schema: {
          params: z.object({ id: z.string(), assetId: z.string() }),
          // `deleted` describes the LINK. The bytes are `modules/media`'s to
          // decide about, and another listing may share the checksum.
          response: { 200: z.object({ assetId: z.string(), deleted: z.boolean() }) },
        },
      },
      controller.detachMedia,
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

    // ---- Public aggregate counts (US7) ---------------------------------------
    //
    // The one route in this file that is `audience: 'public'` and carries no
    // `onRequest: app.guard` — public routes elsewhere in the codebase (the
    // media derivative delivery route) skip the guard chain the same way.
    // `/marketplace` itself stays gated and never-indexed; this is a SEPARATE
    // surface (`/marktplatz`, declared in seo/surfaces.ts) that answers with
    // counts only, never a listing (FR-034, FR-035, FR-037).

    app.get(
      '/marketplace/summary',
      {
        config: { auth: { audience: 'public' }, budget: 'public-page', rateLimit: app.bucket('public-read') },
        schema: {
          response: {
            200: z.object({
              total: z.number(),
              byCategory: z.record(z.enum(MARKETPLACE_CATEGORIES), z.number()),
            }),
          },
        },
      },
      controller.summary,
    )
  },
  { name: 'marketplace-routes', dependencies: ['auth', 'rate-limit'] },
)
