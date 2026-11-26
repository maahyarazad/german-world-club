import { Button, Host, Menu, RNHostView } from '@expo/ui/swift-ui';
import { tint } from '@expo/ui/swift-ui/modifiers';
import { router } from 'expo-router';

import { MenuDots, type HeaderMenuItem, type HeaderMenuProps } from '@/components/header-menu-shared';
import { useTheme } from '@/hooks/use-theme';

export type { HeaderMenuItem };

/**
 * The header's three dots on iOS (feature 039): SwiftUI's own `Menu`, through
 * `@expo/ui/swift-ui`, so the drop-down is the system's — its look, its animation, its
 * accessibility and, on iOS 26, its glass — and not one drawn here.
 *
 * The label is our three dots, a React Native view hosted in SwiftUI by `RNHostView`
 * (`matchContents`: the host is as big as the dots), which is the "React Native label"
 * the Menu page shows. It is a plain view with no `onPress`: SwiftUI's `Menu` opens on a
 * tap itself. `ignoreSafeArea="all"` keeps the host from adding the safe area to a view
 * that sits in a header that has already allowed for it; it is what `MenuView` in
 * `@expo/ui/community/menu` passes too, and that is Expo's own use of this same Menu.
 *
 * A row is a `Button`. The system menu runs `onPress` as it closes, and it is not a view
 * controller the way React Native's `Modal` is, so a screen pushed from it is not at risk
 * of being dropped: the wait for `onDismiss` the old `Modal` needed is gone.
 *
 * A row with news carries a small red dot, as a `circle.fill` symbol. The system menu
 * draws an item's symbol beside its label and honours `tint` for it, and nothing else about
 * an item's colour, which is why the dot is the symbol and not coloured text.
 */
export function HeaderMenu({ items }: HeaderMenuProps) {
  const theme = useTheme();
  if (items.length === 0) return null;

  return (
    <Host matchContents ignoreSafeArea="all">
      <Menu
        label={
          <RNHostView matchContents>
            <MenuDots unread={items.some((item) => item.dot)} />
          </RNHostView>
        }>
        {items.map((item) => (
          <Button
            key={item.key}
            label={item.label}
            systemImage={item.dot ? 'circle.fill' : undefined}
            modifiers={item.dot ? [tint(theme.danger)] : undefined}
            onPress={() => router.push(item.href)}
          />
        ))}
      </Menu>
    </Host>
  );
}
