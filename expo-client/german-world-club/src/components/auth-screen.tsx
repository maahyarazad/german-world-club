import type { ReactNode } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';

/**
 * The layout of the three public screens a person meets before they are signed in:
 * sign-in, forgot-password and reset-password (feature 043, research R14 and R15).
 *
 * One component rather than three copies, so the club's logo, the spacing and above
 * all the buttons cannot drift apart: the logo comes first, then the fields and
 * messages (`children`), then the buttons (`actions`), stacked full width exactly as
 * the welcome screen stacks its two. A screen passes its buttons ONLY as `actions`
 * and only as the standard `Button` / `AsyncButton` (the main action primary, the
 * rest `variant="secondary"`); a text link or a hand-styled `Pressable` is how three
 * screens come to look like three different apps.
 *
 * It mirrors `FormScreen`'s structure on purpose (safe area on both edges, keyboard
 * avoidance, a scroll view that keeps taps working while the keyboard is open, the
 * form centred when there is room), so a screen that moves between the two keeps its
 * keyboard behaviour. `FormScreen` itself is untouched: registration, profile and
 * many other screens still use it. The background is transparent, so the club's
 * backdrop (`AppBackground`) shows through.
 */
export function AuthScreen({ title, subtitle, children, actions }: {
  title?: ReactNode;
  subtitle?: string;
  /** The fields and the messages, in order. */
  children?: ReactNode;
  /** The buttons: the main action first, then any others. */
  actions: ReactNode;
}) {
  const { t } = useTranslations();
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex1}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* The same emblem, in the same card, as the welcome screen draws. A plain View is not an
              accessibility element, so the logo is announced once, by its own label (the club's
              name), and the card is not a second stop. */}
          <View style={styles.logoCard}>
            <Image
              source={require('../../assets/gwc-compact-icon.png')}
              accessibilityLabel={t.welcome.title}
              resizeMode="contain"
              style={styles.logo}
            />
          </View>
          {title ? <ThemedText type="title" style={styles.title}>{title}</ThemedText> : null}
          {subtitle ? <ThemedText themeColor="textSecondary">{subtitle}</ThemedText> : null}
          {children}
          <View style={styles.actions}>{actions}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Transparent, so the backdrop drawn once behind the navigator shows through.
  screen: { flex: 1, backgroundColor: 'transparent' },
  flex1: { flex: 1 },
  // `FormScreen`'s `form` and `formCentered` values together: side and bottom padding,
  // the gap between fields, centred vertically when there is room.
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  // EXACTLY the welcome screen's `logoCard` and `logo` (app/(public)/index.tsx), so the club's
  // emblem is the same here as on the first screen. `gwc-compact-icon.png` has a transparent
  // background, so it needs no card behind it on the light or the dark backdrop (`gwc-logo.png`,
  // the opaque-white version, would have needed a white one). A test compares the two screens'
  // logo file and styles (client/tests/assets/expo-auth-screens.test.ts).
  logoCard: { backgroundColor: 'transparent', borderRadius: 16, alignItems: 'center' },
  // The aspect ratio keeps the image undistorted at any width, and a fixed height keeps it from
  // growing on a tablet.
  logo: { height: 130, aspectRatio: 844 / 578 },
  title: { fontSize: 30, lineHeight: 36 },
  // EXACTLY the welcome screen's `actions` (app/(public)/index.tsx): the buttons look
  // the same here because they are laid out the same. A test compares the two
  // (client/tests/assets/expo-auth-screens.test.ts), so a change to one fails.
  actions: { gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
});
