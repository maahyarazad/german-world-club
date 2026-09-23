import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { THREAD_POST_MAX } from '@gwc/contracts/threads';

import { threadsApi } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { Button, FormScreen, Message, TextField } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

/** A new post, or a reply when opened with `replyToId`. */
export default function Compose() {
  const theme = useTheme();
  const { t, format, problemMessage } = useTranslations();
  const { replyToId, replyToName } = useLocalSearchParams<{ replyToId?: string; replyToName?: string }>();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = THREAD_POST_MAX - body.length;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await threadsApi.create(body.trim(), replyToId || undefined);
      router.back();
    } catch (e) {
      setError(problemMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScreen subtitle={replyToId ? format(t.threads.replyTo, { name: replyToName || '—' }) : undefined}>
      <TextField
        label={t.threads.compose}
        placeholder={t.threads.placeholder}
        value={body}
        onChangeText={setBody}
        multiline
        autoFocus
        maxLength={THREAD_POST_MAX}
        style={{ minHeight: 140, textAlignVertical: 'top' }}
      />
      <View style={{ alignItems: 'flex-end' }}>
        <ThemedText type="small" style={{ color: remaining < 20 ? theme.danger : theme.textSecondary }}>{remaining}</ThemedText>
      </View>
      <Message text={error} />
      <Button label={t.threads.post} onPress={submit} loading={busy} disabled={body.trim().length === 0} />
    </FormScreen>
  );
}
