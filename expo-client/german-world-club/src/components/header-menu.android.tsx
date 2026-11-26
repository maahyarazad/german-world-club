import { MenuView, type MenuAction, type MenuComponentRef } from '@expo/ui/community/menu';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { HEADER_BAR_HEIGHT } from '@/components/app-header';
import {
  MENU_BUTTON,
  MenuDots,
  openHeaderMenuItem,
  type HeaderMenuItem,
  type HeaderMenuProps,
} from '@/components/header-menu-shared';

export type { HeaderMenuItem };

/**
 * The header's three dots on Android (feature 040): `MenuView`, the drop-in menu from
 * `@expo/ui/community/menu`, which draws a Material `DropdownMenu` (Jetpack Compose). So the
 * drop-down is Android's own, with the page behind it left as it is, and Compose keeps it on
 * screen when the dots are at the right edge.
 *
 * Compose opens a `DropdownMenu` at the bottom edge of its anchor, and `MenuView`'s anchor is
 * its child, at the child's own size (`MenuView.android.tsx`). With the dots as the child the
 * menu started at the dots' bottom edge, a few points above the header's (the dots' box is
 * 44 points in a 56-point bar). So the anchor is not the dots: it is a strip along the bottom
 * edge of a slot as tall as the bar, and the menu opens at the header's bottom edge, with the
 * dots, the emblem and the title uncovered. The dots are an ordinary button beside it that
 * asks the menu to open with `ref.show()`. That call exists on Android only (on iOS it does
 * nothing, which is why the iPhone is handled differently: `header-menu.ios.tsx`).
 *
 * The strip has a width as well as a height: the anchor is its child at its own size, Compose
 * lines the menu up with the anchor's edges, and a child with a height only would be zero
 * wide. `MenuView` also wraps the strip in a `Pressable` of its own, so a tap on that 1 dp
 * line opens the menu too, which is harmless.
 *
 * The actions are data; choosing one reports its `id` (the row's `key`) through
 * `onPressAction`, and `openHeaderMenuItem` finds the row and opens its screen.
 *
 * A Material item is a label and an optional icon, and the icon has to be an image
 * source (a string is an iOS symbol name, and ignored here), so a row with news says so
 * in its label ("Messages •") instead of with a drawn dot. The menu follows the device's
 * light or dark setting, which is also what the app follows.
 */
export function HeaderMenu({ items }: HeaderMenuProps) {
  const menuRef = useRef<MenuComponentRef>(null);
  if (items.length === 0) return null;

  const actions: MenuAction[] = items.map((item) => ({
    id: item.key,
    title: item.dot ? `${item.label} •` : item.label,
  }));

  return (
    <View style={styles.slot}>
      <MenuDots unread={items.some((item) => item.dot)} onPress={() => menuRef.current?.show()} />
      <MenuView
        ref={menuRef}
        actions={actions}
        onPressAction={({ nativeEvent }) => openHeaderMenuItem(items, nativeEvent.event)}
        style={styles.anchor}>
        <View style={styles.anchorFill} />
      </MenuView>
    </View>
  );
}

const styles = StyleSheet.create({
  // As tall as the bar, so the slot's bottom edge is the header's bottom edge.
  slot: { width: MENU_BUTTON.width, height: HEADER_BAR_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  anchor: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  // The anchor itself: as wide as the dots' box, so the menu lines up with it, and 1 dp tall.
  anchorFill: { width: MENU_BUTTON.width, height: 1 },
});
