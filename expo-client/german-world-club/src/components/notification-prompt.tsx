import { Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

/**
 * The explanation shown before the OS permission prompt (feature 011, FR-002).
 *
 * The OS prompt can be shown once; a refusal there is final until the member
 * digs into system settings. So the app first says what notifications are for,
 * and lets the member decline *here*, where "Not now" costs nothing. Both
 * buttons record that the app asked, so it does not ask again on next launch.
 */
export function NotificationPrompt({ visible, onAllow, onNotNow }: {
  visible: boolean
  onAllow: () => void
  onNotNow: () => void
}) {
  const theme = useTheme();
  const { t } = useTranslations();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onNotNow}>
      <View style={[local.backdrop]}>
        <SafeAreaView edges={['bottom']} style={[local.sheet, { backgroundColor: theme.background }]}>
          <ThemedText type="subtitle">{t.notifications.promptTitle}</ThemedText>
          <ThemedText themeColor="textSecondary">{t.notifications.promptBody}</ThemedText>
          <View style={{ gap: Spacing.two }}>
            <Button label={t.notifications.allow} onPress={onAllow} />
            <Button label={t.notifications.notNow} onPress={onNotNow} variant="secondary" />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const local = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { padding: Spacing.four, gap: Spacing.three, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
});
