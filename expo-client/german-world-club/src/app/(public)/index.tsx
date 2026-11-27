import { router } from 'expo-router';
import { Image, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

export default function Welcome() {
  const themed = useThemedStyles(makeStyles);
  const { t, locale, setLocale } = useTranslations();
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.language}>
        <ThemedText
          accessibilityRole="button"
          onPress={() => setLocale(locale === 'de' ? 'en' : 'de')}
          style={styles.weight600}>
          {locale === 'de' ? 'English' : 'Deutsch'}
        </ThemedText>
      </View>
      <View style={styles.hero}>
        {/* The logo already carries the club's name, so no title text beside it.
            The screen shows the club's backdrop (AppBackground), like every other. */}
        <View style={styles.logoCard}>
          <Image
            source={require('../../../assets/gwc-compact-icon.png')}
            accessibilityLabel={t.welcome.title}
            resizeMode="contain"
            style={styles.logo}
          />
        </View>
        <View style={[styles.rule, themed.bgAccent]} />
        <ThemedText style={styles.tagline}>{t.welcome.tagline}</ThemedText>
      </View>
      <View style={styles.actions}>
        <Button label={t.welcome.join} onPress={() => router.push('/register')} variant="secondary" />
        <Button label={t.welcome.signIn} onPress={() => router.push('/sign-in')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  weight600: { fontWeight: '600' },
  tagline: { fontSize: 18, lineHeight: 26 },
  screen: { flex: 1, padding: Spacing.four, justifyContent: 'space-between' },
  language: { alignItems: 'flex-end' },
  hero: { gap: Spacing.three, maxWidth: MaxContentWidth },
  logoCard: { backgroundColor: 'transparent', borderRadius: 16, alignItems: 'center' },
  // The image is 844x578; the aspect ratio keeps it undistorted at any width.
  logo: { height: 130, aspectRatio: 844 / 578 },
  rule: { width: 56, height: 4, borderRadius: 2 },
  actions: { gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
});

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    bgAccent: { backgroundColor: theme.accent },
  });
