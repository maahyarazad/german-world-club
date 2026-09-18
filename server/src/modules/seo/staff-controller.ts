import { readSeoRecord, updateSeoRecord, toResponse } from './application/staff-edit.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { GwcApp } from '../../app.ts'

export function createSeoStaffController(app: GwcApp) {
  return {
    read: async (request: FastifyRequest, reply: FastifyReply) => {
      const { recordType, recordId } = request.params
      const row = await readSeoRecord(app, request, { recordType, recordId, permissions: request.permissions })
      return reply.send(toResponse(row))
    },

    update: async (request: FastifyRequest, reply: FastifyReply) => {
      const { recordType, recordId } = request.params
      const { row, redirectCreated } = await updateSeoRecord(app, request, {
        recordType, recordId,
        patch: request.body,
        permissions: request.permissions,
        principal: request.principal,
        requestId: request.id,
      })
      return reply.send(toResponse(row, redirectCreated))
    },
  }
}
