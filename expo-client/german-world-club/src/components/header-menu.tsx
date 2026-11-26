import type { HeaderMenuItem, HeaderMenuProps } from '@/components/header-menu-shared';

export type { HeaderMenuItem };

/**
 * The header's three dots (feature 039) have one file per platform: `header-menu.ios.tsx`
 * (SwiftUI `Menu`) and `header-menu.android.tsx` (the Material drop-down), each through
 * `@expo/ui`. This one is what any other target resolves to, and it is also the file
 * TypeScript reads for `@/components/header-menu`, so it holds the shared signature.
 *
 * It draws nothing: `@expo/ui` has no menu for the web, and importing its native views
 * here would stop a web bundle from building. The app is a phone app, and the web
 * surface is the web console (`client/`), not this.
 */
export function HeaderMenu(props: HeaderMenuProps): null {
  void props;
  return null;
}
