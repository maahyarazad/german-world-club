import fp from 'fastify-plugin'
import { z } from 'zod'
import { createSeoStaffController } from './staff-controller.js'

const recordTypeSchema = z.enum(['page', 'partner', 'outlet', 'event', 'article', 'committee'])

const seoPatchSchema = z.object({
  slug: z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase hyphenated slug').optional(),
  seoTitle: z.string().max(200).nullable().optional(),
  metaDescription: z.string().max(400).nullable().optional(),
  shareImageId: z.string().uuid().nullable().optional(),
  indexable: z.boolean().optional(),
  language: z.enum(['de', 'en']).optional(),
  published: z.boolean().optional(),
})

const seoRecordSchema = z.object({
  recordType: recordTypeSchema,
  recordId: z.string().uuid(),
  slug: z.string(),
  seoTitle: z.string().nullable(),
  metaDescription: z.string().nullable(),
  shareImageId: z.string().uuid().nullable(),
  indexable: z.boolean(),
  language: z.string(),
  published: z.boolean(),
  updatedAt: z.string(),
  redirectCreated: z.string().nullable(),
})

/**
 * Staff-editable SEO fields (§10.8, FR-020, FR-021): schema, access posture,
 * and wiring to `staff-controller.js` only. See `application/staff-edit.js`
 * for the dual-permission check and the automatic 301 on a slug change.
 */
export default fp(
  async function seoStaffRoutes(app) {
    const controller = createSeoStaffController(app)
    const params = z.object({ recordType: recordTypeSchema, recordId: z.string().uuid() })

    app.get(
      '/admin/seo/:recordType/:recordId',
      {
        config: { auth: { audience: 'staff', module: 'seo', flag: 'read' }, budget: 'admin-read', rateLimit: app.bucket('admin-api') },
        onRequest: app.guard,
        schema: { params, response: { 200: seoRecordSchema } },
      },
      controller.read,
    )

    app.patch(
      '/admin/seo/:recordType/:recordId',
      {
        config: { auth: { audience: 'staff', module: 'seo', flag: 'edit' }, budget: 'admin-read', rateLimit: app.bucket('admin-api') },
        onRequest: app.guard,
        schema: { params, body: seoPatchSchema, response: { 200: seoRecordSchema } },
      },
      controller.update,
    )
  },
  { name: 'seo-staff-routes', dependencies: ['auth', 'rate-limit', 'legacy-redirects'] },
)
