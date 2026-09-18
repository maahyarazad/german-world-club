import { z } from 'zod'

/**
 * Environment configuration.
 *
 * Constitution (Technology & Security Baseline): "Configuration MUST be
 * validated at startup, and an invalid value MUST prevent boot rather than
 * degrade behaviour." So this module throws; it never falls back.
 */

const bool = z.enum(['true', 'false']).transform((v) => v === 'true')
const int = (d) => z.coerce.number().int().positive().default(d)

/**
 * TRUST_PROXY is the one setting where both directions of error are dangerous:
 *   too low  -> every request keys to the proxy's address, so per-address rate
 *               limits treat the whole internet as one client and do nothing
 *   `true`   -> a client can forge X-Forwarded-For and bypass every limit
 * It must equal the real number of proxy hops, which only the deployment knows.
 */
const trustProxy = z
  .string()
  .refine((v) => v === 'false' || /^\d+$/.test(v), {
    message: 'must be a hop count (e.g. "1") or "false" — never "true", which lets a client forge X-Forwarded-For',
  })
  .transform((v) => (v === 'false' ? false : Number(v)))

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: int(3000),
    LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().min(1).optional(),

    JWT_PRIVATE_KEY: z.string().optional(),
    JWT_PUBLIC_KEY: z.string().optional(),

    // Deployment preconditions — see the production refinement below.
    CANONICAL_ORIGIN: z.string().url().optional(),
    // Comma-separated allowlist for the mobile app and any separately-hosted
    // client. An allowlist rather than a wildcard, because these routes carry
    // credentials (http-conventions.md §3).
    CORS_ORIGINS: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined)),
    TRUST_PROXY: trustProxy.optional(),
    KEEP_ALIVE_TIMEOUT_MS: int(72000),

    REQUEST_TIMEOUT_MS: int(30000),
    CONNECTION_TIMEOUT_MS: int(35000),

    MEDIA_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    MEDIA_LOCAL_PATH: z.string().default('./var/media'),
    MEDIA_MAX_BYTES: int(26214400),
    MEDIA_MAX_PIXELS: int(50000000),
    // The per-account stored-byte quota (FR-063). A business quota, so it is
    // enforced through the transactional counter primitive, never the limiter.
    MEDIA_ACCOUNT_QUOTA_BYTES: int(1073741824),
    MEDIA_S3_BUCKET: z.string().optional(),
    MEDIA_S3_ENDPOINT: z.string().url().optional(),
    MEDIA_S3_REGION: z.string().default('us-east-1'),
    MEDIA_S3_ACCESS_KEY_ID: z.string().optional(),
    MEDIA_S3_SECRET_ACCESS_KEY: z.string().optional(),

    // --- SMSGlobal (OTP delivery, §6.2) ---------------------------------
    // Absent, OTP sends are logged and refused rather than silently skipped:
    // a second factor that quietly does not send is not a second factor.
    SMSGLOBAL_API_KEY: z.string().optional(),
    SMSGLOBAL_API_SECRET: z.string().optional(),
    SMSGLOBAL_ORIGIN: z.string().default('GWC'),

    // --- Push notifications ---------------------------------------------
    // Expo needs no server credential unless the project enables enhanced
    // security. FCM needs a service account; the private key is a secret and
    // is read from the environment, never from a JSON file in the repo.
    EXPO_ACCESS_TOKEN: z.string().optional(),
    FCM_PROJECT_ID: z.string().optional(),
    FCM_CLIENT_EMAIL: z.string().optional(),
    FCM_PRIVATE_KEY: z.string().optional(),
  })
  // Production has no safe default for the three settings that must agree with
  // infrastructure. Boot fails rather than guessing (plan.md Risk 4).
  .superRefine((v, ctx) => {
    if (v.NODE_ENV !== 'production') return
    for (const key of ['CANONICAL_ORIGIN', 'TRUST_PROXY', 'REDIS_URL', 'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY']) {
      if (v[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} has no safe default and must be set in production`,
        })
      }
    }
  })
  // connectionTimeout must outlast requestTimeout, or the socket closes before
  // the request-level timeout can produce its 408.
  .refine((v) => v.CONNECTION_TIMEOUT_MS > v.REQUEST_TIMEOUT_MS, {
    message: 'CONNECTION_TIMEOUT_MS must exceed REQUEST_TIMEOUT_MS',
    path: ['CONNECTION_TIMEOUT_MS'],
  })

export function loadEnv(source = process.env) {
  const result = schema.safeParse(source)
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`)
  }
  const env = result.data
  return Object.freeze({
    ...env,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    // Development convenience only; production already failed above if unset.
    canonicalOrigin: env.CANONICAL_ORIGIN ?? `http://localhost:${env.PORT}`,
    trustProxy: env.TRUST_PROXY ?? false,
  })
}

export { bool }
