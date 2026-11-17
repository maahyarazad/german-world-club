#!/usr/bin/env node
/**
 * Send one test OTP SMS through SMSGlobal, from this machine (feature 023).
 *
 * It uses the server's own code, not a copy: the country policy
 * (`integrations/sms-country-policy.ts`) decides first, exactly as
 * `app.sendOtp` does, then the real SMSGlobal client (`integrations/sms.ts`)
 * sends — same sender (SMSGLOBAL_ORIGIN, default "B P"), same message text,
 * same number normalisation. What SMSGlobal answers is printed in full.
 *
 * Credentials come from server/.env (SMSGLOBAL_API_KEY, SMSGLOBAL_API_SECRET,
 * SMSGLOBAL_ORIGIN). Nothing is written to the database and no server needs
 * to run. Every run sends a real SMS, which costs SMSGlobal credit.
 *
 * Usage, from the repo root:
 *   node --env-file=server/.env server/scripts/dev/send-test-otp.mjs +4915123456789
 * or from server/:
 *   node --env-file=.env scripts/dev/send-test-otp.mjs +4915123456789
 *
 * Options:
 *   --code 123456   send this code instead of a random one
 *   --force         send even when the club's country policy would refuse
 *                   the number (to test SMSGlobal itself)
 */
import { randomInt } from 'node:crypto'
import { createSmsClient, DEFAULT_ORIGIN } from '../../src/integrations/sms.ts'
import { createSmsCountryPolicy } from '../../src/integrations/sms-country-policy.ts'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const mobile = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--code')

if (!mobile) {
  console.error('Usage: node --env-file=server/.env server/scripts/dev/send-test-otp.mjs <mobile, e.g. +4915123456789> [--code 123456] [--force]')
  process.exit(2)
}

const {
  SMSGLOBAL_API_KEY: apiKey,
  SMSGLOBAL_API_SECRET: apiSecret,
  SMSGLOBAL_ORIGIN: origin,
  SMS_BLOCKED_COUNTRIES,
  SMS_ALLOWED_COUNTRIES,
} = process.env

if (!apiKey || !apiSecret) {
  console.error('SMSGLOBAL_API_KEY and SMSGLOBAL_API_SECRET are not set.')
  console.error('Run with --env-file pointing at server/.env (see the usage at the top of this file).')
  process.exit(2)
}

// 1. The country policy, as the gateway applies it.
const policy = createSmsCountryPolicy({ blockedOverride: SMS_BLOCKED_COUNTRIES, allowedFilter: SMS_ALLOWED_COUNTRIES })
const decision = policy.resolveDestination(mobile)
if (decision.allowed) {
  console.log(`Country policy: allowed (${decision.name ?? decision.dialingCode})`)
} else {
  console.log(`Country policy: REFUSED — ${decision.reason} (${decision.name ?? decision.dialingCode ?? 'unknown'})`)
  console.log('The server would answer 422 sms-destination-not-allowed and send nothing.')
  if (!flag('--force')) {
    console.log('Add --force to send anyway and test SMSGlobal itself.')
    process.exit(1)
  }
}

// 2. Send through the real client.
const code = option('--code') ?? String(randomInt(0, 1_000_000)).padStart(6, '0')
const sms = createSmsClient({ apiKey, apiSecret, origin })

console.log(`Sending code ${code} to ${decision.maskedDestination ?? mobile} from "${origin || DEFAULT_ORIGIN}" …`)
try {
  const result = await sms.sendCode({ mobile, code })
  console.log('SMSGlobal accepted it.')
  console.log(JSON.stringify(result.response, null, 2))
  process.exit(0)
} catch (error) {
  // The SDK rejects with SMSGlobal's own answer, e.g.
  // { statusCode: 400, data: { errors: { origin: ['Origin is invalid.'] } } }.
  console.error('SMSGlobal REFUSED or could not be reached — the server would answer 503 here.')
  if (error && typeof error === 'object' && ('statusCode' in error || 'data' in error)) {
    console.error(`Status: ${error.statusCode ?? 'n/a'}`)
    console.error(JSON.stringify(error.data ?? null, null, 2))
  } else {
    console.error(error)
  }
  process.exit(1)
}
