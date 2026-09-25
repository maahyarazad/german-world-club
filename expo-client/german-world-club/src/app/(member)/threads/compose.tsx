import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { PROBLEMS } from '@gwc/contracts/errors';
import { THREAD_MEDIA_MAX, THREAD_POST_MAX } from '@gwc/contracts/threads';
import type { ThreadPost } from '@gwc/contracts/threads';

import { ApiError } from '@/api/client';
import { threadsApi } from '@/api/endpoints';
import { QuoteEmbed } from '@/components/quote-embed';
import { ThemedText } from '@/components/themed-text';
import { Button, FormScreen, Message, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';
import { pickMedia, uploadReady, type Picked } from '@/lib/pick-media';

type Pending = Picked & { alt: string; assetId?: string };

/**
 * A new post, a reply (`replyToId`) or a quote (`quoteOfId`), with up to ten
 * photos or videos (010 US1/US2).
 *
 * Media is uploaded first and the post created once every item is ready: the
 * server creates a post and its media in one transaction and never attaches
 * media later (research R4). The limits here are early feedback; the server
 * re-checks all of them.
 */
export default function Compose() {
  const theme = useTheme();
  const { t, format } = useTranslations();
  const { replyToId, replyToName, quoteOfId } =
    useLocalSearchParams<{ replyToId?: string; replyToName?: string; quoteOfId?: string }>();
  const [body, setBody] = useState('');
  const [media, setMedia] = useState<Pending[]>([]);
  const [quoted, setQuoted] = useState<ThreadPost | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (quoteOfId) threadsApi.thread(quoteOfId).then((v) => setQuoted(v.post)).catch((e) => {
      console.error('Compose.loadQuoted', e instanceof ApiError ? e.problem : e);
      setQuoted(null);
    });
  }, [quoteOfId]);

  const add = async () => {
    const room = THREAD_MEDIA_MAX - media.length;
    if (room <= 0) return setError(format(t.threads.mediaTooMany, { max: THREAD_MEDIA_MAX }));
    const { denied, items } = await pickMedia({ limit: room });
    if (denied) return setError(t.threads.photoPermission);
    setError(null);
    setMedia([...media, ...items.map((i) => ({ ...i, alt: '' }))]);
  };

  const submit = async () => {
    // Alt text is required by the upload API (§10.1), on both platforms.
    if (media.some((m) => !m.alt.trim())) return setError(t.threads.mediaAltHint);
    setBusy(true);
    setError(null);
    try {
      const ready: Pending[] = [];
      if (media.length > 0) setStatus(t.threads.uploading);
      for (const item of media) {
        ready.push({ ...item, assetId: item.assetId ?? await uploadReady(item, item.alt.trim()) });
      }
      setMedia(ready);
      await threadsApi.create({
        body: body.trim(),
        ...(replyToId ? { replyToId } : {}),
        ...(quoteOfId ? { quoteOfId } : {}),
        media: ready.map((m) => ({ assetId: m.assetId! })),
      });
      router.back();
    } catch (e) {
      if (e instanceof ApiError && e.type === PROBLEMS.HANDLE_REQUIRED.type) {
        // The server's answer, not a local guess: choose a handle, then post again.
        router.push('/threads/handle');
      } else {
        console.error('Compose.submit', e instanceof ApiError ? e.problem : e);
      }
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  const subtitle = replyToId ? format(t.threads.replyTo, { name: replyToName || '—' }) : quoteOfId ? t.threads.quoteTitle : undefined;

  return (
    <FormScreen subtitle={subtitle}>
      <TextField
        label={t.threads.compose}
        placeholder={t.threads.placeholder}
        value={body}
        onChangeText={setBody}
        multiline
        autoFocus
        maxLength={THREAD_POST_MAX}
        style={{ minHeight: 120, textAlignVertical: 'top' }}
      />
      <View style={{ alignItems: 'flex-end' }}>
        <ThemedText type="small" style={{ color: THREAD_POST_MAX - body.length < 20 ? theme.danger : theme.textSecondary }}>
          {format(t.threads.counter, { count: body.length, max: THREAD_POST_MAX })}
        </ThemedText>
      </View>

      {media.length > 0 ? (
        <View style={{ gap: Spacing.three }}>
          {media.map((item, index) => (
            <View key={item.uri} style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' }}>
              <Image source={item.uri} accessibilityLabel={item.alt} style={{ width: 72, height: 72, borderRadius: 8 }} contentFit="cover" />
              <View style={{ flex: 1, gap: Spacing.one }}>
                <TextField
                  label={t.threads.mediaAlt}
                  value={item.alt}
                  maxLength={300}
                  onChangeText={(alt) => setMedia((all) => all.map((m, i) => (i === index ? { ...m, alt } : m)))}
                />
                <ThemedText type="small" themeColor="textSecondary" accessibilityRole="button"
                  onPress={() => setMedia(media.filter((_, i) => i !== index))}>
                  {t.threads.mediaRemove}
                </ThemedText>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {quoted ? <QuoteEmbed quoted={{ unavailable: false, post: { ...quoted, quoteOfId: null } }} /> : null}

      <Button label={t.threads.addMedia} variant="secondary" onPress={add} disabled={busy || media.length >= THREAD_MEDIA_MAX} />
      {status ? <ThemedText type="small" themeColor="textSecondary">{status}</ThemedText> : null}
      <Message text={error} />
      <Button label={t.threads.post} onPress={submit} loading={busy} disabled={body.trim().length === 0 && media.length === 0} />
    </FormScreen>
  );
}
