import { router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

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

const DOT = 4;

/**
 * What the header shows for the menu: three dots in a column, with a red dot at the corner
 * when a row has news. It is only a picture. Opening the menu is the platform menu's own
 * tap handling around it (`header-menu.ios.tsx`, `header-menu.android.tsx`), so it has no
 * `onPress` of its own: a second handler here would fight the menu's.
 */
export function MenuDots({ unread }: { unread: boolean }) {
  const themed = useThemedStyles(makeStyles);
  const { t } = useTranslations();
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={unread ? `${t.common.menu} •` : t.common.menu}
      style={styles.button}>
      <View style={styles.dots}>
        <View style={themed.dot} />
        <View style={themed.dot} />
        <View style={themed.dot} />
      </View>
      {unread ? <View style={themed.badge} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  // A column on both platforms, as WhatsApp draws it. (The first version drew a row on iOS.)
  dots: { flexDirection: 'column', gap: DOT },
});

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    dot: { width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: theme.tint },
    badge: { position: 'absolute', top: 6, right: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: theme.danger },
  });
