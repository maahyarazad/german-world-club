import { createAuditWriter, createAuditReader } from '../ops/audit.js'

/** The append-only audit log: `app.audit` writes, `app.auditLog` reads. */
export function registerAudit(app) {
  app.decorate('audit', createAuditWriter(app.pg))
  app.decorate('auditLog', createAuditReader(app.pg))
}
