import { SEARCH_MAX_TERMS } from '@gwc/contracts/search'

/**
 * Turning a typed search into SQL predicates (feature 042, research R12).
 *
 * A search is its words: each must be found, in any of the given columns
 * (`title ILIKE '%word%' OR description ILIKE '%word%'`), and the words are ANDed. So
 * typing more narrows, "rad" finds "Fahrrad", and case does not matter.
 *
 * **What the caller must keep true:**
 *
 * - `columns` are SQL written in code (`'o.title'`), never anything from the request.
 *   Only the *values* are parameters; the predicate text never contains what was typed.
 * - The predicates are ANDed on **after** the visibility predicate, never as an `OR`
 *   branch of it: a search narrows what a requester may see, it cannot widen it.
 *
 * `%`, `_` and `\` typed by a person are matched as themselves (escaped), so a search for
 * "50%" finds "50%", not everything that starts with 50. Same idea as the staff title
 * filter in `marketplace/application/moderate.ts`, generalised.
 */

/** The words of a search: split on whitespace, repeats removed (case-insensitively), at most the cap. */
export function searchTerms(q?: string): string[] {
  if (!q) return []
  const seen = new Set<string>()
  const terms: string[] = []
  for (const term of q.split(/\s+/)) {
    if (!term) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    terms.push(term)
    // The route schema already refuses more; this keeps a caller that skipped it bounded.
    if (terms.length === SEARCH_MAX_TERMS) break
  }
  return terms
}

/** Escape the characters that mean something to LIKE, for use with `ESCAPE '\'`. */
export const escapeLike = (term: string) => term.replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * One predicate per word, each over every column, with the words pushed onto `params`
 * (so their placeholders continue the caller's numbering). Join the result with `AND`.
 * No search gives no predicates and leaves `params` alone.
 */
export function searchPredicates(q: string | undefined, columns: readonly string[], params: unknown[]): string[] {
  return searchTerms(q).map((term) => {
    params.push(`%${escapeLike(term)}%`)
    const placeholder = `$${params.length}`
    return `(${columns.map((column) => `${column} ILIKE ${placeholder} ESCAPE '\\'`).join(' OR ')})`
  })
}
