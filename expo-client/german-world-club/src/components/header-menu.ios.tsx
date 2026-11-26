import { Button, Host, Image, Menu } from '@expo/ui/swift-ui';
import { accessibilityLabel, frame, rotationEffect, tint } from '@expo/ui/swift-ui/modifiers';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { MENU_BUTTON, MenuBadge, type HeaderMenuItem, type HeaderMenuProps } from '@/components/header-menu-shared';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

export type { HeaderMenuItem };

/**
 * The header's three dots on iOS (feature 039): SwiftUI's own `Menu`, through
 * `@expo/ui/swift-ui`, so the drop-down is the system's — its look, its animation, its
 * accessibility and, on iOS 26, its glass — and not one drawn here.
 *
 * The label is drawn by SwiftUI too: the `ellipsis` symbol, turned 90 degrees so the dots
 * are a column, in a fixed frame the size of the tap area. It used to be our React Native
 * dots hosted inside the label (`RNHostView`), and that is what went wrong on a phone: the
 * menu opened over the dots, and the dots moved when tapped. A hosted view is a UIKit view
 * that SwiftUI sizes, lays out and, when the menu opens, animates the menu out of; with
 * the label native, the system knows exactly where it is and opens the menu under it, as it
 * does for any `Menu`, and there is no hosted view to move.
 *
 * Two things this deliberately does not do. It does not set `buttonStyle('plain')`: that
 * style makes only the drawn pixels tappable, and these are three small dots, so the frame
 * around them would not take taps (there is no `contentShape` modifier here to widen it).
 * And the unread badge is not in the label: it is a React Native view laid over the menu in
 * a fixed box, with `pointerEvents: 'none'`, so it takes no touch and is not measured.
 *
 * A row is a `Button`. The system menu runs `onPress` as it closes, and it is not a view
 * controller the way React Native's `Modal` is, so a screen pushed from it is not at risk
 * of being dropped. A row with news carries a small red dot, as a `circle.fill` symbol: the
 * system menu draws an item's symbol beside its label and honours `tint` for it, and
 * nothing else about an item's colour. `ignoreSafeArea="all"` keeps the host from adding the
 * safe area to a view in a header that has already allowed for it; it is what Expo's own
 * `MenuView` passes.
 */
export function HeaderMenu({ items }: HeaderMenuProps) {
  const theme = useTheme();
  const { t } = useTranslations();
  if (items.length === 0) return null;
  const unread = items.some((item) => item.dot);

  return (
    <View style={styles.box}>
      <Host matchContents ignoreSafeArea="all">
        <Menu
          label={
            <Image
              systemName="ellipsis"
              size={20}
              color={theme.tint}
              modifiers={[
                rotationEffect(90),
                frame({ width: MENU_BUTTON.width, height: MENU_BUTTON.height }),
                accessibilityLabel(unread ? `${t.common.menu} •` : t.common.menu),
              ]}
            />
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
      {unread ? <MenuBadge /> : null}
    </View>
  );
}

// A fixed box the native menu sits in and the badge is laid over: its size does not depend on
// what the host measures, so nothing about the dots can move when the menu opens.
const styles = StyleSheet.create({ box: MENU_BUTTON });
