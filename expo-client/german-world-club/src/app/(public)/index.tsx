import { router } from 'expo-router';
import { Image, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

export default function Welcome() {
  const theme = useTheme();
  const { t, locale, setLocale } = useTranslations();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.tint }]}>
      <View style={styles.language}>
        <ThemedText
          accessibilityRole="button"
          onPress={() => setLocale(locale === 'de' ? 'en' : 'de')}
          style={{ color: theme.onTint, fontWeight: '600' }}>
          {locale === 'de' ? 'English' : 'Deutsch'}
        </ThemedText>
      </View>
      <View style={styles.hero}>
        {/* The logo already carries the club's name, so no title text beside it.
            It is an opaque white image, hence the white card on the tinted screen. */}
        <View style={styles.logoCard}>
          <Image
            source={require('../../../assets/splash-icon.png')}
            accessibilityLabel={t.welcome.title}
            resizeMode="contain"
            style={styles.logo}
          />
        </View>
        <View style={[styles.rule, { backgroundColor: theme.background }]} />
        <ThemedText style={{ color: theme.onTint, fontSize: 18, lineHeight: 26 }}>{t.welcome.tagline}</ThemedText>
      </View>
      <View style={styles.actions}>
        <Button label={t.welcome.join} onPress={() => router.push('/register')} variant="secondary" />
        <Button label={t.welcome.signIn} onPress={() => router.push('/sign-in')} style={{ borderWidth: 1, borderColor: theme.onTint }} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: Spacing.four, justifyContent: 'space-between' },
  language: { alignItems: 'flex-end' },
  hero: { gap: Spacing.three, maxWidth: MaxContentWidth },
  logoCard: { backgroundColor: 'transparent', borderRadius: 16, padding: Spacing.three, alignItems: 'center' },
  // The image is 844x578; the aspect ratio keeps it undistorted at any width.
  logo: { height: 220, aspectRatio: 844 / 578 },
  rule: { width: 56, height: 4, borderRadius: 2 },
  actions: { gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
});
