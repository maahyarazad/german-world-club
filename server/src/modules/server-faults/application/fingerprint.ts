import { createHash } from 'node:crypto'

/**
 * Which fault is this? (feature 012, research R5)
 *
 * The same bug must group together across deploys, so nothing that shifts on
 * an unrelated edit goes in: no line or column numbers, no message (messages
 * embed ids, and the scrub makes them lossy). What remains — the error's
 * identity, where the request was going, and the first frame of our own code —
 * separates "the same bug again" from "the same exception type thrown
 * somewhere else".
 */

type FingerprintInput = {
  errorName: string
  errorCode: string | null
  method: string
  route: string | null
  stack: string | null
}

const APP_ROOT = /^.*?[\\/]server[\\/]src[\\/]/

/**
 * The first stack frame inside `server/src/`, made relative and stripped of
 * `:line:col` — `at createPost (modules/threads/application/compose.ts)`.
 */
export function firstAppFrame(stack: string | null): string {
  if (!stack) return ''
  for (const raw of stack.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('at ') || !/[\\/]server[\\/]src[\\/]/.test(line)) continue
    return line
      .replace(/file:\/\//g, '')
      .replace(/\((.*)\)$/, (_, location) => `(${location.replace(APP_ROOT, '')})`)
      .replace(/^at (?!.*\()(.*)$/, (_, location) => `at ${location.replace(APP_ROOT, '')}`)
      .replace(/:\d+:\d+/g, '')
      .replace(/\\/g, '/')
  }
  return ''
}

export function fingerprintOf({ errorName, errorCode, method, route, stack }: FingerprintInput): string {
  const parts = [errorName, errorCode ?? '', method, route ?? '', firstAppFrame(stack)]
  return createHash('sha256').update(parts.join('|')).digest('hex')
}
