import Entypo from '@expo/vector-icons/Entypo';
import { router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';
import { useTranslations } from '@/i18n';

export type HeaderMenuItem = {
  key: string;
  label: string;
  href: Href;
  /** News in this row (unread messages): the row and the three dots both say so. */
  dot?: boolean;
};

export type HeaderMenuProps = { items: HeaderMenuItem[] };

/** Opens the screen of the row that was chosen. A key that matches no row does nothing. */
export function openHeaderMenuItem(items: HeaderMenuItem[], key: string) {
  const item = items.find((candidate) => candidate.key === key);
  if (item) router.push(item.href);
}

/** The icon's size. The tap area around it is `MENU_BUTTON`, so the icon can be small. */
const ICON_SIZE = 22;

// An icon font draws nothing until it has loaded, and loads on first use: left to that, the
// dots would be missing the first time a header with a menu is shown. Starting the load as
// this module is imported, which is at launch, has the font ready by then.
Entypo.loadFont().catch((error) => console.error('MenuDots.loadFont', error));

/** The tap area of the three dots, the same on both platforms. */
export const MENU_BUTTON = { width: 40, height: 44 };

/**
 * What the header shows for the menu on Android: Entypo's vertical three dots, from
 * `@expo/vector-icons`, in the theme's tint, with a red dot at the corner when a row has
 * news. It is only a picture. Opening the menu is the platform menu's own tap handling
 * around it (`header-menu.android.tsx`), so it has no `onPress` of its own: a second
 * handler here would fight the menu's.
 *
 * iOS does not use it: there the label has to be drawn by SwiftUI itself, not a React
 * Native view hosted inside the menu, which is what made the menu open over the dots and
 * the dots move (`header-menu.ios.tsx`).
 */
export function MenuDots({ unread }: { unread: boolean }) {
  const theme = useTheme();
  const { t } = useTranslations();
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={unread ? `${t.common.menu} •` : t.common.menu}
      style={styles.button}>
      <Entypo name="dots-three-vertical" size={ICON_SIZE} color={theme.tint} />
      {unread ? <MenuBadge /> : null}
    </View>
  );
}

/**
 * The red dot in the corner of the three dots when a row has news. It takes no touches
 * (`pointerEvents: 'none'`), so it can sit over a menu's label without being what is
 * tapped or what the system measures.
 */
export function MenuBadge() {
  const themed = useThemedStyles(makeStyles);
  return <View style={themed.badge} />;
}

const styles = StyleSheet.create({
  button: { ...MENU_BUTTON, alignItems: 'center', justifyContent: 'center' },
});

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    badge: { position: 'absolute', top: 6, right: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: theme.danger, pointerEvents: 'none' },
  });
