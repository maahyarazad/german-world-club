import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { PROBLEMS } from '@gwc/contracts/errors';
import { MESSAGE_MAX } from '@gwc/contracts/messaging';
import type { ConversationView, Message as ChatMessage } from '@gwc/contracts/messaging';

import { ApiError } from '@/api/client';
import { messagingApi } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, FormScreen, Loading, Message, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';
import { useSession } from '@/session/session';

/**
 * One conversation about a listing (feature 020, US3): the messages in order,
 * the member's own on the right, and a reply box. Opening it marks it read on
 * the server. Still answerable after the listing has closed (008 FR-027).
 */
export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, format, formatDate } = useTranslations();
  const { state } = useSession();
  const me = state.status === 'member' ? state.principal.id : null;

  const [view, setView] = useState<ConversationView | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [missing, setMissing] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [slowDown, setSlowDown] = useState(false);

  const load = useCallback(() => {
    messagingApi.read(id, null).then((v) => {
      setView(v);
      // Newest first from the server; oldest first on screen.
      setMessages([...v.messages].reverse());
    }, (e) => {
      console.error('Conversation.load', e instanceof ApiError ? e.problem : e);
      if (e instanceof ApiError && e.problem?.type === PROBLEMS.NOT_FOUND.type) setMissing(true);
    });
  }, [id]);
  useEffect(load, [load]);

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setSlowDown(false);
    try {
      const sent = await messagingApi.reply(id, text);
      setMessages((current) => [...current, sent]);
      setBody('');
    } catch (e) {
      console.error('Conversation.send', e instanceof ApiError ? e.problem : e);
      setSlowDown(e instanceof ApiError && e.problem?.type === PROBLEMS.RATE_LIMITED.type);
    } finally {
      setBusy(false);
    }
  };

  if (missing) return <FormScreen><ThemedText>{t.messages.notFound}</ThemedText></FormScreen>;
  if (!view) return <Loading />;

  const title = view.conversation.subject.title;
  return (
    <FormScreen subtitle={title ? format(t.messages.about, { title }) : t.messages.listingGone}>
      <Stack.Screen options={{ title: view.conversation.counterpart?.displayName ?? t.messages.title }} />
      {messages.map((m) => {
        const mine = m.senderId === me;
        return (
          <View key={m.id} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
            <View style={{ maxWidth: '85%' }}>
              <Card>
                <ThemedText>{m.body}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {mine ? t.messages.you : view.conversation.counterpart?.displayName ?? ''} · {formatDate(m.createdAt, true)}
                </ThemedText>
              </Card>
            </View>
          </View>
        );
      })}
      <View style={{ gap: Spacing.two }}>
        <TextField label={t.messages.replyPlaceholder} value={body} onChangeText={setBody}
          multiline maxLength={MESSAGE_MAX} style={{ minHeight: 80, textAlignVertical: 'top' }} />
        <Message text={slowDown ? t.requests.slowDown : null} />
        <Button label={t.messages.send} onPress={() => void send()} loading={busy} disabled={!body.trim()} />
      </View>
    </FormScreen>
  );
}
