import { useEffect, useState } from 'react';

/**
 * `value`, but only once it has stopped changing for `ms` (feature 042).
 *
 * A search box sends nothing while the person is still typing: a ten-letter word is one
 * request after the pause, not ten. The delay is UI timing, not a business rule, so it lives
 * here and not in the shared contract. Same behaviour as the web client's hook.
 */
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
