import { z } from 'zod'

/**
 * The bounds on a text search (feature 042), for the offers lists and the
 * marketplace list. Defined once so the server's route schemas and both clients
 * cannot disagree about them: a client uses them to decide when a search is worth
 * sending, the server re-checks every request.
 *
 * Empty (or only spaces) means "no search", not an error, so a client that clears
 * its box can send `q=` and get the whole list. One character is refused: it
 * matches nearly everything and no index can serve it. The ceiling on length and
 * on the number of words bounds the work a single request can ask for.
 */
export const SEARCH_MIN_LENGTH = 2
export const SEARCH_MAX_LENGTH = 80
export const SEARCH_MAX_TERMS = 6

export const searchQuerySchema = z
  .string()
  .trim()
  .max(SEARCH_MAX_LENGTH)
  .refine((v) => v === '' || v.length >= SEARCH_MIN_LENGTH, `at least ${SEARCH_MIN_LENGTH} characters`)
  .refine((v) => v.split(/\s+/).filter(Boolean).length <= SEARCH_MAX_TERMS, `at most ${SEARCH_MAX_TERMS} words`)
  .optional()

export type SearchQuery = z.infer<typeof searchQuerySchema>
