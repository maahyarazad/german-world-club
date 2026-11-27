import { LogController } from 'fastify'

/**
 * Logging and redaction (FR-048).
 *
 * Redaction is a data-protection control, not tidiness: the club holds member
 * PII. The paths below are configured once at logger construction so they apply
 * to code not yet written — doing it per call site fails on the first forgotten
 * one.
 */

export const REDACT_PATHS = Object.freeze([
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.newPassword',
  'req.body.code',
  'req.body.otp',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.email',
  'req.body.mobile',
  'req.body.billing',
  // Wildcards matter more than the `req.body.*` paths above: an application
  // log call nests the body under its own key (`{ body }`), so only these
  // catch it. The suite that found this gap is tests/ops/logging-redaction.
  '*.password',
  '*.newPassword',
  '*.refreshToken',
  '*.accessToken',
  '*.token',
  '*.otp',
  '*.code',
  '*.email',
  '*.mobile',
  '*.phone',
  '*.code_hash',
  '*.token_hash',
  '*.password_hash',
])

/**
 * The request URL with the typed text of a search hidden (feature 042, research R15).
 *
 * The `req` serializer logs the URL with its query string, so a person who searches for a
 * name, an email address or a phone number would have it written to every request log line.
 * `REDACT_PATHS` cannot help: it protects keys, not the inside of a string. So the value of
 * `q` is masked here, centrally, and holds for routes not yet written. Every other parameter
 * is kept: a mask that ate the whole query string would hide the category a failing request used.
 *
 * Exact name only (`q`, not `query` or `qq`).
 */
export function maskSearchQuery(url: string): string {
  if (typeof url !== 'string') return url
  const at = url.indexOf('?')
  if (at < 0) return url
  return `${url.slice(0, at)}?${url.slice(at + 1).replace(/(^|&)q=[^&]*/g, '$1q=[redacted]')}`
}

/**
 * Fastify 5.12 deprecates the top-level `disableRequestLogging` /
 * `requestIdLogLabel` options in favour of a LogController. Note that despite
 * the TypeScript signature naming a class, the runtime requires an *instance*.
 */
export class GwcLogController extends LogController {
  constructor(options = {}) {
    super({ requestIdLogLabel: 'requestId', disableRequestLogging: false, ...options })
  }
}

export function loggerOptions(env) {
  if (env.LOG_LEVEL === 'silent') return false
  return {
    level: env.LOG_LEVEL,
    redact: { paths: [...REDACT_PATHS], censor: '[redacted]' },
    // Serializers keep whole objects (which may carry PII) out of log lines;
    // only the named fields are emitted.
    serializers: {
      req: (req) => ({ method: req.method, url: maskSearchQuery(req.url), routeUrl: req.routeOptions?.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    ...(env.isProduction ? {} : { transport: { target: 'pino/file', options: { destination: 1 } } }),
  }
}
