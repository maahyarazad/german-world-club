import type { Href } from 'expo-router';

import { resolveDestination } from '@gwc/contracts/push';

/**
 * A notification's `data` → an expo-router Href, or null for "stay put".
 *
 * Deliberately no mapping here. The table lives in `@gwc/contracts/push`
 * (`DESTINATION_ROUTES`), typed as a Record over every destination type and
 * tested there, because this workspace has no test runner (analysis U2). An
 * untested second copy here is how a new destination opens the wrong screen.
 */
export function toHref(data: Record<string, unknown> | null | undefined): Href | null {
  const resolved = resolveDestination(data);
  if (!resolved) return null;
  return { pathname: resolved.pathname, params: resolved.params } as Href;
}
