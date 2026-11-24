import { useMemo } from 'react';

import { useTheme } from '@/hooks/use-theme';

export type AppTheme = ReturnType<typeof useTheme>;

/**
 * The `StyleSheet.create` styles that depend on the theme.
 *
 * `StyleSheet.create` runs once, when the module loads, so it cannot see whether
 * the phone is in light or dark mode, and reading the colour scheme at module
 * scope would freeze it at start-up. The factory runs inside this hook instead and
 * is called again only when the theme changes, so a screen still follows a switch
 * of appearance.
 *
 * The factory returns the `StyleSheet.create({ … })` call itself, which keeps the
 * literal types (`flexDirection: 'row'`) that a plain object would widen to `string`.
 * Declare it at module scope — `const makeStyles = (theme: AppTheme) => StyleSheet.create({ … })` —
 * never as an inline arrow: a new function each render would defeat the memo.
 */
export function useThemedStyles<T>(factory: (theme: AppTheme) => T): T {
  const theme = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `factory` is a module-level function (see above), so it is stable by contract.
  return useMemo(() => factory(theme), [theme]);
}
