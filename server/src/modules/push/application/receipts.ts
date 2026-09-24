import type { PushTransport } from '../providers.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * Expo push receipts (feature 011, research R6).
 *
 * An Expo *ticket* only says Expo accepted the message. The *receipt*, ready
 * some minutes later, says whether Apple or Google did — and that is where an
 * uninstalled app usually shows up as `DeviceNotRegistered`. Without this job a
 * dead device would keep being sent to until the 180-day prune removed it,
 * and every broadcast would carry the same failures (SC-007).
 *
 * The window is Expo's: receipts are not ready before about 15 minutes, and
 * Expo keeps them for 24 hours. A ticket older than that is simply left `sent`.
 */
export const RECEIPT_MIN_AGE_MINUTES = 15
export const RECEIPT_MAX_AGE_HOURS = 24

export async function checkReceipts(app: GwcApp, { transport }: { transport: PushTransport }) {
  const { rows } = await app.pg.query(
    `SELECT id, provider_ref, device_id
       FROM push_deliveries
      WHERE status = 'sent'
        AND provider = 'expo'
        AND provider_ref IS NOT NULL
        AND updated_at < now() - make_interval(mins => $1)
        AND updated_at > now() - make_interval(hours => $2)
      ORDER BY updated_at
      LIMIT 10000`,
    [RECEIPT_MIN_AGE_MINUTES, RECEIPT_MAX_AGE_HOURS],
  )
  if (rows.length === 0) return { itemsProcessed: 0 }

  const receipts = await transport.receipts(rows.map((r) => String(r.provider_ref)))

  const delivered: string[] = []
  const failed: { id: string; error: string }[] = []
  const dead: string[] = []
  for (const row of rows) {
    const receipt = receipts[String(row.provider_ref)]
    // Not ready yet, or already expired at Expo: leave it for the next run.
    if (!receipt) continue
    if (receipt.status === 'ok') {
      delivered.push(String(row.id))
    } else {
      failed.push({ id: String(row.id), error: receipt.error })
      if (receipt.permanent && row.device_id) dead.push(String(row.device_id))
    }
  }

  if (delivered.length > 0) {
    await app.pg.query(
      `UPDATE push_deliveries SET status = 'delivered', updated_at = now()
        WHERE id = ANY($1::uuid[]) AND status = 'sent'`,
      [delivered],
    )
  }
  if (failed.length > 0) {
    await app.pg.query(
      `UPDATE push_deliveries dl SET status = 'failed', error_message = f.error, updated_at = now()
         FROM unnest($1::uuid[], $2::text[]) AS f(id, error)
        WHERE dl.id = f.id AND dl.status = 'sent'`,
      [failed.map((f) => f.id), failed.map((f) => f.error)],
    )
  }
  if (dead.length > 0) {
    await app.pg.query(
      `UPDATE push_devices SET disabled_reason = 'unregistered', updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [dead],
    )
  }

  return { itemsProcessed: delivered.length + failed.length }
}
