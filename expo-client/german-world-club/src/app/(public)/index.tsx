import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
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
        <ThemedText type="title" style={{ color: theme.onTint, fontSize: 40, lineHeight: 46 }}>{t.welcome.title}</ThemedText>
        <View style={[styles.rule, { backgroundColor: theme.accent }]} />
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
  rule: { width: 56, height: 4, borderRadius: 2 },
  actions: { gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
});
