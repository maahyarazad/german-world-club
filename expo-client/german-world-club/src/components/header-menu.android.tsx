import { MenuView, type MenuAction } from '@expo/ui/community/menu';

import {
  MenuDots,
  openHeaderMenuItem,
  type HeaderMenuItem,
  type HeaderMenuProps,
} from '@/components/header-menu-shared';

export type { HeaderMenuItem };

/**
 * The header's three dots on Android (feature 039): `MenuView`, the drop-in menu from
 * `@expo/ui/community/menu`, which draws a Material `DropdownMenu` (Jetpack Compose)
 * anchored to the dots. So the drop-down is Android's own, under the dots, with the
 * page behind it left as it is, and Compose places it so it stays on screen when the
 * dots are at the right edge.
 *
 * `MenuView` wraps its trigger in a `Pressable` of its own that opens the menu, so the
 * dots here are a plain view: an `onPress` on them would never fire. The actions are
 * data; choosing one reports its `id` (the row's `key`) through `onPressAction`, and
 * `openHeaderMenuItem` finds the row and opens its screen.
 *
 * A Material item is a label and an optional icon, and the icon has to be an image
 * source (a string is an iOS symbol name, and ignored here), so a row with news says so
 * in its label ("Messages •") instead of with a drawn dot. The menu follows the device's
 * light or dark setting, which is also what the app follows.
 */
export function HeaderMenu({ items }: HeaderMenuProps) {
  if (items.length === 0) return null;

  const actions: MenuAction[] = items.map((item) => ({
    id: item.key,
    title: item.dot ? `${item.label} •` : item.label,
  }));

  return (
    <MenuView actions={actions} onPressAction={({ nativeEvent }) => openHeaderMenuItem(items, nativeEvent.event)}>
      <MenuDots unread={items.some((item) => item.dot)} />
    </MenuView>
  );
}
