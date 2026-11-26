import { Image } from 'expo-image';
import { useTheme as useNavigationTheme, type NativeStackHeaderProps } from 'expo-router';
import { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';
import { useTranslations } from '@/i18n';

/**
 * The height of the bar below the status bar: the platform's own, 44 on iOS and 56 on
 * Android, so replacing the native header does not change how tall it is.
 */
export const HEADER_BAR_HEIGHT = Platform.select({ ios: 44, default: 56 });

/** The logo is shorter than the bar (44 at the least), so it never changes the bar's height. */
const LOGO_HEIGHT = 34;
// The emblem is 296 x 194 (`assets/gwc-logo-header.png`): the whole lockup, the mark, the
// golden line and "GERMAN WORLD CLUB" under it, cropped from `assets/react-logo@3x.png` (the
// club's logo under a template file name) at its own resolution. Its background is transparent,
// and so are the insides of the two rings, so the header's colour shows through them: white on
// the light header, dark on the dark one. The mark is 81% of the lockup's height, so 34 keeps it
// about the 28 it was when the emblem was the mark alone; the lettering is small at this size,
// as a logo's would be.
const LOGO_WIDTH = Math.round((LOGO_HEIGHT * 296) / 194);
const LOGO_GAP = Spacing.two;

/**
 * The header of every tab's stack (feature 039): the screen's title on the LEFT, the
 * club's emblem in the MIDDLE, and whatever the screen puts in `headerRight` on the
 * right (the three-dots menu, where a screen has actions).
 *
 * It replaces the native header through the stack's `header` option, because the native
 * one cannot do this on iOS: its title is always centred there (`headerTitleAlign` is
 * "not supported on iOS"). So it draws what the native one drew — a back button, a
 * title, a hairline under the bar — at the same height, with the same colours from the
 * navigation theme, and keeps the edge-swipe back, which belongs to the screen and not
 * to the header.
 *
 * The three columns are what keep the emblem in the middle: the left and the right
 * both take half of what the emblem leaves, so it is centred whatever the title is, and
 * a long title is cut with an ellipsis instead of pushing it aside. The title is the
 * screen's own `title` option, so a screen that sets it late (a conversation, once it
 * has loaded) is shown as it arrives.
 *
 * A stack opts in with `screenOptions={{ header: renderAppHeader }}`, and every tab's
 * layout does. A stack that forgets still works, with the native header, so nothing
 * fails to tell you: look at each tab when a stack is added.
 */
export function AppHeader({ options, back, navigation }: NativeStackHeaderProps) {
  const theme = useTheme();
  const themed = useThemedStyles(makeStyles);
  const navigationTheme = useNavigationTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslations();

  const bar = useMemo(
    () => makeBar(navigationTheme.colors.card, navigationTheme.colors.border, insets.top),
    [navigationTheme.colors.card, navigationTheme.colors.border, insets.top],
  );
  const title = options.title ?? '';
  const right = options.headerRight?.({ tintColor: theme.tint, canGoBack: Boolean(back) });

  return (
    <View style={bar.container}>
      <View style={styles.row}>
        <View style={styles.left}>
          {back ? (
            <Pressable
              onPress={navigation.goBack}
              accessibilityRole="button"
              accessibilityLabel={t.common.back}
              hitSlop={8}
              style={styles.backButton}>
              <View style={themed.chevron} />
            </Pressable>
          ) : null}
          {title ? (
            <ThemedText style={styles.title} numberOfLines={1} accessibilityRole="header">
              {title}
            </ThemedText>
          ) : null}
        </View>
        <Image
          source={require('../../assets/gwc-logo-header.png')}
          contentFit="contain"
          accessibilityLabel={t.welcome.title}
          style={styles.logo}
        />
        <View style={styles.right}>{right}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: HEADER_BAR_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three },
  // Equal columns either side of the emblem, so it is centred whatever the title is.
  left: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  right: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  logo: { width: LOGO_WIDTH, height: LOGO_HEIGHT, marginHorizontal: LOGO_GAP },
  backButton: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flexShrink: 1, fontSize: 16, lineHeight: 22, fontWeight: '600' },
});

/** The bar: the navigation theme's own card and border, as the native header used. */
const makeBar = (backgroundColor: ColorValue, borderColor: ColorValue, top: number) =>
  StyleSheet.create({
    container: { paddingTop: top, backgroundColor, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: borderColor },
  });

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    // A chevron drawn from two borders of a square, turned: no icon font, no image, and
    // it takes the theme's tint like the buttons beside it.
    chevron: {
      width: 12,
      height: 12,
      marginLeft: 4,
      borderLeftWidth: 2.5,
      borderBottomWidth: 2.5,
      borderColor: theme.tint,
      transform: [{ rotate: '45deg' }],
    },
  });

/**
 * The stack's `header` option. A function declared once, so React sees the same one on
 * every render and does not remount the header of a screen that is already showing.
 */
export const renderAppHeader = (props: NativeStackHeaderProps) => <AppHeader {...props} />;
