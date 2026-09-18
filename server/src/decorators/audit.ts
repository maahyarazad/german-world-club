import { createAuditWriter, createAuditReader } from '../ops/audit.ts'
import type { GwcApp } from '../app.ts'

/** The append-only audit log: `app.audit` writes, `app.auditLog` reads. */
export function registerAudit(app: GwcApp) {
  app.decorate('audit', createAuditWriter(app.pg))
  app.decorate('auditLog', createAuditReader(app.pg))
}
