import fp from 'fastify-plugin'
import { z } from 'zod'
import {
  offerCategoryListSchema, offerCategorySchema, createOfferCategoryRequestSchema, updateOfferCategoryRequestSchema,
} from '@gwc/contracts/offers'
import { listAllCategories, createCategory, updateCategory } from './application/admin.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Staff management of offer categories (feature 035): schema, posture and wiring.
 *
 *   GET   /admin/offer-categories        every category, hidden ones included, with its offer count   read
 *   POST  /admin/offer-categories        add one                                                        write
 *   PATCH /admin/offer-categories/:id    rename, reorder, hide or show                                  edit
 *
 * There is deliberately no DELETE route: a category is hidden, never removed,
 * and one with offers cannot be deleted at all. `delete` and `status` are unused
 * on this module's categories on purpose.
 */
export default fp(
  async function offerCategoryStaffRoutes(app: GwcApp) {
    const idParam = z.object({ id: z.string().uuid() })
    const actor = (request: GwcRequest) => ({ id: String(request.principal!.id), requestId: request.id })
    const posture = (flag: 'read' | 'write' | 'edit') => ({
      auth: { audience: 'staff', module: 'merchant_offers', flag },
      budget: flag === 'read' ? 'admin-read' : 'admin-write',
      rateLimit: app.bucket('admin-api'),
    }) as const

    app.get('/admin/offer-categories', {
      config: posture('read'), onRequest: app.guard, schema: { response: { 200: offerCategoryListSchema } },
    }, async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await listAllCategories(app, { signal: request.deadlineSignal })))

    app.post('/admin/offer-categories', {
      config: posture('write'), onRequest: app.guard,
      schema: { body: createOfferCategoryRequestSchema, response: { 201: offerCategorySchema } },
    }, async (request: GwcRequest, reply: GwcReply) => {
      const body = request.body as { slug: string; nameDe: string; nameEn: string }
      return reply.code(201).send(await createCategory(app, { ...body, actor: actor(request) }))
    })

    app.patch('/admin/offer-categories/:id', {
      config: posture('edit'), onRequest: app.guard,
      schema: { params: idParam, body: updateOfferCategoryRequestSchema, response: { 200: offerCategorySchema } },
    }, async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await updateCategory(app, {
        id: (request.params as { id: string }).id,
        changes: request.body as Parameters<typeof updateCategory>[1]['changes'],
        actor: actor(request),
      })))
  },
  { name: 'offer-category-staff-routes', dependencies: ['auth', 'rate-limit'] },
)
