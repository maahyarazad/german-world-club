import { useCallback, useEffect, useId, useState } from 'react'
import { FLAGS, MODULES } from '@gwc/contracts/permissions'
import type { Flag, Module } from '@gwc/contracts/permissions'
import { ADMIN_ROLES } from '@gwc/contracts/admin'
import type { AdminAccount, AdminRole, ChangeConstraint, UpdateAdminRequest } from '@gwc/contracts/admin'
import { PROBLEMS } from '@gwc/contracts/errors'
import { adminApi, ApiError } from '../../lib/api'
import PageHeader from '../../components/ui/PageHeader'
import Card from '../../components/ui/Card'
import Callout from '../../components/ui/Callout'
import Button from '../../components/ui/Button'
import RequireGrant from '../RequireGrant'
import { useTranslations } from '../../i18n/index'
import PageLoader from '../../components/ui/PageLoader'

/**
 * Roles & permissions (feature 028).
 *
 * The page renders what the server says and decides nothing: which accounts
 * exist, what each may do, and — through `constraints` — which change is not
 * allowed and why. A control the server says is not allowed is DISABLED and its
 * reason is a tooltip; the server still refuses a forced request. A refusal is
 * logged to the console, not shown (CLAUDE.md); the state kept is only what
 * changes behaviour (the draft being edited, and "changed elsewhere").
 */
export function Roles() {
  const t = useTranslations()
  return (
    <RequireGrant
      module="admins"
      flag="read"
      fallback={<Callout variant="neutral" title={t.console.notAvailable}>{t.console.notAvailableHint}</Callout>}
    >
      <RolesPage />
    </RequireGrant>
  )
}

function RolesPage() {
  const t = useTranslations()
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [changedElsewhere, setChangedElsewhere] = useState<string | null>(null)
  // Bumped on a conflict so every draft is thrown away even if the version came back the same.
  const [epoch, setEpoch] = useState(0)

  const load = useCallback(async () => {
    try {
      setAccounts((await adminApi.list()).admins)
      setFailed(false)
    } catch (error) {
      console.error('Roles.load', error instanceof ApiError ? error.problem : error)
      setFailed(true)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const saved = (account: AdminAccount) => {
    setChangedElsewhere(null)
    setAccounts((all) => all?.map((a) => (a.id === account.id ? account : a)) ?? all)
  }
  // Another superadmin changed it first: show the current state and say so.
  const conflict = async (account: AdminAccount) => {
    setChangedElsewhere(account.id)
    setEpoch((n) => n + 1)
    await load()
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.adminRoles.title} subtitle={t.adminRoles.subtitle} />
      {failed && <Callout variant="gold" title={t.adminRoles.loadFailed}>{null}</Callout>}
      {accounts === null && !failed && <PageLoader />}
      {accounts && accounts.length === 0 && <Callout variant="neutral" title={t.adminRoles.empty}>{null}</Callout>}
      {accounts && accounts.map((account) => (
        <AccountCard
          // The version and the epoch are part of the key so a reload after a conflict resets the draft.
          key={`${account.id}:${account.version}:${epoch}`}
          account={account}
          notice={changedElsewhere === account.id}
          onSaved={saved}
          onConflict={conflict}
        />
      ))}
    </div>
  )
}

type Flags = Record<Flag, boolean>
type Grants = Partial<Record<Module, Flags>>
const NO_FLAGS: Flags = { read: false, write: false, edit: false, delete: false, status: false }
const anyFlag = (flags: Flags) => FLAGS.some((f) => flags[f])
const sameFlags = (a: Flags, b: Flags) => FLAGS.every((f) => a[f] === b[f])

/**
 * A control the server says is not allowed: disabled, with the reason as a
 * tooltip. The tooltip is on a WRAPPER because a disabled control does not
 * receive pointer events in every browser, and the reason is also rendered as
 * visually hidden text and tied in with `aria-describedby`, so a screen reader
 * hears it and a keyboard user is not left with a dead control.
 */
function Guarded({ constraint, children }: { constraint: ChangeConstraint; children: (disabled: boolean) => React.ReactNode }) {
  const t = useTranslations()
  const id = useId()
  if (constraint.allowed) return <>{children(false)}</>
  const reason = t.adminRoles.blockers[constraint.reason]
  return (
    <span title={reason} aria-describedby={id} className="inline-flex">
      {children(true)}
      <span id={id} className="sr-only">{reason}</span>
    </span>
  )
}

function AccountCard({ account, notice, onSaved, onConflict }: {
  account: AdminAccount
  notice: boolean
  onSaved: (account: AdminAccount) => void
  onConflict: (account: AdminAccount) => Promise<void>
}) {
  const t = useTranslations()
  const [role, setRole] = useState<AdminRole>(account.role)
  const [isActive, setIsActive] = useState(account.isActive)
  const [grants, setGrants] = useState<Grants>(account.grants as Grants)
  const [adding, setAdding] = useState('')
  const [saving, setSaving] = useState(false)

  const areas = (Object.keys(grants) as Module[]).sort((a, b) => MODULES.indexOf(a) - MODULES.indexOf(b))
  const available = MODULES.filter((m) => !(m in grants))

  // Only what changed goes to the server; an area ticked back to its old value is not a change.
  const changedAreas = MODULES.filter((m) => !sameFlags(grants[m] ?? NO_FLAGS, (account.grants as Grants)[m] ?? NO_FLAGS))
  const body: Omit<UpdateAdminRequest, 'version'> = {
    ...(role !== account.role ? { role } : {}),
    ...(isActive !== account.isActive ? { isActive } : {}),
    ...(changedAreas.length > 0
      ? { grants: Object.fromEntries(changedAreas.map((m) => [m, grants[m] ?? NO_FLAGS])) as Grants }
      : {}),
  }
  const dirty = Object.keys(body).length > 0

  const toggle = (module: Module, flag: Flag) =>
    setGrants((g) => ({ ...g, [module]: { ...(g[module] ?? NO_FLAGS), [flag]: !(g[module] ?? NO_FLAGS)[flag] } }))

  const save = async () => {
    setSaving(true)
    try {
      onSaved(await adminApi.update(account.id, { version: account.version, ...body }))
    } catch (error) {
      console.error('Roles.save', error instanceof ApiError ? error.problem : error)
      if (error instanceof ApiError && error.problem?.type === PROBLEMS.CONFLICT.type) await onConflict(account)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card
      title={account.displayName ?? account.email}
      actions={
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-[12px]">
          {account.current && <span className="rounded-card bg-ground px-2 py-0.5 font-medium text-navy">{t.adminRoles.you}</span>}
          <span className="rounded-card bg-ground px-2 py-0.5 font-medium text-navy">{t.adminRoles.roles[account.role]}</span>
          <span className="text-text-muted">{account.isActive ? t.adminRoles.active : t.adminRoles.inactive}</span>
        </span>
      }
    >
      {account.displayName && <p className="mb-3 text-[13px] text-text-muted">{account.email}</p>}
      {notice && <p role="status" className="mb-3 text-[13px] text-navy">{t.adminRoles.changedElsewhere}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-4 text-[13px]">
        <Guarded constraint={account.constraints.changeRole}>
          {(disabled) => (
            <label className="flex items-center gap-2">
              <span className="text-text-muted">{t.adminRoles.roleLabel}</span>
              <select
                className="rounded-card border border-hairline bg-surface px-2 py-1"
                value={role} disabled={disabled}
                onChange={(event) => setRole(event.target.value as AdminRole)}
              >
                {ADMIN_ROLES.map((r) => <option key={r} value={r}>{t.adminRoles.roles[r]}</option>)}
              </select>
            </label>
          )}
        </Guarded>
        <Guarded constraint={account.constraints.setActive}>
          {(disabled) => (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={isActive} disabled={disabled} onChange={(event) => setIsActive(event.target.checked)} />
              <span>{t.adminRoles.active}</span>
            </label>
          )}
        </Guarded>
      </div>

      {role === 'superadmin' && <p className="mb-3 text-[12px] text-text-muted">{t.adminRoles.superadminBypass}</p>}

      {areas.length === 0 ? (
        <p className="text-[13px] text-text-muted">{t.adminRoles.noGrants}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {areas.map((module) => (
            <li key={module} className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline-2 pb-2 last:border-b-0">
              <span className="text-[13px] font-medium text-text">{t.modules[module] ?? module}</span>
              <Guarded constraint={account.constraints.editGrants}>
                {(disabled) => (
                  <span className="flex flex-wrap gap-3 text-[12px] text-text-muted">
                    {FLAGS.map((flag) => (
                      <label key={flag} className="flex items-center gap-1">
                        <input
                          type="checkbox" disabled={disabled}
                          checked={(grants[module] ?? NO_FLAGS)[flag]}
                          onChange={() => toggle(module, flag)}
                        />
                        {t.flags[flag]}
                      </label>
                    ))}
                  </span>
                )}
              </Guarded>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Guarded constraint={account.constraints.editGrants}>
          {(disabled) => (
            <label className="flex items-center gap-2 text-[13px]">
              <span className="text-text-muted">{t.adminRoles.addArea}</span>
              <select
                className="rounded-card border border-hairline bg-surface px-2 py-1"
                value={adding} disabled={disabled || available.length === 0}
                onChange={(event) => {
                  const module = event.target.value as Module
                  setAdding('')
                  if (module) setGrants((g) => ({ ...g, [module]: { ...NO_FLAGS, read: true } }))
                }}
              >
                <option value="">—</option>
                {available.map((m) => <option key={m} value={m}>{t.modules[m] ?? m}</option>)}
              </select>
            </label>
          )}
        </Guarded>
        <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>{t.adminRoles.save}</Button>
      </div>
    </Card>
  )
}

export default Roles
