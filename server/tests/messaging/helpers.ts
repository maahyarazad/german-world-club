import { poster, seedListing, TERMS } from '../marketplace/helpers.ts'
import type { Pool } from 'pg'
import type { GwcApp } from '../../src/app.ts'

/**
 * Corpus helpers for the messaging suites.
 *
 * Built on the marketplace helpers because every conversation this feature
 * creates has a listing as its subject — a messaging fixture that invented its
 * own subject would be testing a path the application never takes.
 */

export { poster, seedListing, TERMS }

/**
 * The response shapes these suites read.
 *
 * Declared once here rather than annotated at each `.map` callback: with the
 * response schemas gone (constitution 2.0.0), `response.json()` is `any`, and
 * fourteen inline annotations would be fourteen places to update when the
 * payload changes. These names are also the assertion that the payload carries
 * display identity and nothing else — there is deliberately no `email` or
 * `mobile` field to reach for.
 */
export type TestMessage = {
  id: string
  conversationId: string
  senderId: string
  body: string
  createdAt: string
}

export type TestParticipant = {
  memberId: string
  displayName: string | null
  status: string
  lastReadAt: string | null
}

export type TestConversation = {
  id: string
  subjectType: string
  subjectId: string | null
  lastMessageAt: string
  unreadCount?: number
}

/** Wipe messaging between tests. Conversations cascade to participants and messages. */
export async function resetMessaging(pool: Pool) {
  await pool.query('TRUNCATE conversations CASCADE')
}

/** POST an inquiry about a listing, as a member. */
export function inquire(
  app: GwcApp,
  headers: Record<string, string>,
  listingId: string,
  body = 'Is this still available?',
) {
  return app.inject({
    method: 'POST',
    url: `/marketplace/listings/${listingId}/inquire`,
    headers,
    payload: { body },
  })
}

/** Reply into an existing conversation. */
export function reply(
  app: GwcApp,
  headers: Record<string, string>,
  conversationId: string,
  body = 'Yes, it is.',
) {
  return app.inject({
    method: 'POST',
    url: `/messages/conversations/${conversationId}/messages`,
    headers,
    payload: { body },
  })
}

export function readConversation(
  app: GwcApp,
  headers: Record<string, string>,
  conversationId: string,
  qs = '',
) {
  return app.inject({
    method: 'GET',
    url: `/messages/conversations/${conversationId}${qs}`,
    headers,
  })
}

export function inbox(app: GwcApp, headers: Record<string, string>, qs = '') {
  return app.inject({ method: 'GET', url: `/messages/conversations${qs}`, headers })
}
