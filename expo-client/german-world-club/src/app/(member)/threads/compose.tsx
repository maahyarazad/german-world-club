import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { PROBLEMS } from '@gwc/contracts/errors';
import { THREAD_MEDIA_MAX, THREAD_POST_MAX } from '@gwc/contracts/threads';
import type { ThreadPost } from '@gwc/contracts/threads';

import { ApiError } from '@/api/client';
import { threadsApi } from '@/api/endpoints';
import { QuoteEmbed } from '@/components/quote-embed';
import { ThemedText } from '@/components/themed-text';
import { Button, FormScreen, Message, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';
import { UploadProgress } from '@/components/upload-progress';
import { useMediaUpload } from '@/hooks/use-media-upload';
import { pickMedia, type Picked } from '@/lib/pick-media';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

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
  const themed = useThemedStyles(makeStyles);
  const { t, format } = useTranslations();
  const { replyToId, replyToName, quoteOfId } =
    useLocalSearchParams<{ replyToId?: string; replyToName?: string; quoteOfId?: string }>();
  const [body, setBody] = useState('');
  const [media, setMedia] = useState<Pending[]>([]);
  const [quoted, setQuoted] = useState<ThreadPost | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each file goes up through the same path as every member upload, so the member
  // sees the club's loader with one percentage for the whole batch (feature 037).
  const upload = useMediaUpload('member');
  const cancelled = useRef(false);

  useEffect(() => {
    if (quoteOfId) threadsApi.thread(quoteOfId).then((v) => setQuoted(v.post)).catch((e) => {
      console.error('Compose.loadQuoted', e instanceof ApiError ? e.problem : e);
      setQuoted(null);
    });
  }, [quoteOfId]);

  const add = async () => {
    const room = THREAD_MEDIA_MAX - media.length;
    if (room <= 0) return setError(format(t.threads.mediaTooMany, { max: THREAD_MEDIA_MAX }));
    const { denied, items, unsupported } = await pickMedia({ limit: room });
    if (denied) return setError(t.threads.photoPermission);
    // The accepted files are added either way; one that cannot be uploaded is named, not dropped silently.
    setError(unsupported.length > 0 ? t.upload.unsupportedFormat : null);
    setMedia([...media, ...items.map((i) => ({ ...i, alt: '' }))]);
  };

  const submit = async () => {
    // Alt text is required by the upload API (§10.1), on both platforms.
    if (media.some((m) => !m.alt.trim())) return setError(t.threads.mediaAltHint);
    setBusy(true);
    setError(null);
    cancelled.current = false;
    try {
      const ready: Pending[] = [];
      for (const [index, item] of media.entries()) {
        // Already uploaded on an earlier try: not sent twice.
        if (item.assetId) { ready.push(item); continue; }
        const asset = await upload.start(item, item.alt.trim(), { slot: [index, media.length] });
        // A failure or a cancel posts nothing, and the text and the chosen
        // media stay on screen for another try (FR-021). Files that did reach
        // the server keep their id, so a retry does not send them again.
        if (!asset) {
          setMedia(media.map((m, i) => ready[i] ?? m));
          return;
        }
        ready.push({ ...item, assetId: asset.id });
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
        style={styles.minHeight120TextAlignVerticalTop}
      />
      <View style={styles.itemsFlexend}>
        <ThemedText type="small" style={THREAD_POST_MAX - body.length < 20 ? themed.colorDanger : themed.colorTextSecondary}>
          {format(t.threads.counter, { count: body.length, max: THREAD_POST_MAX })}
        </ThemedText>
      </View>

      {media.length > 0 ? (
        <View style={styles.gapThree}>
          {media.map((item, index) => (
            <View key={item.uri} style={styles.rowGapTwoItemsFlexstart}>
              <Image source={item.uri} accessibilityLabel={item.alt} style={styles.width72Height72Radius8} contentFit="cover" />
              <View style={styles.flex1GapOne}>
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
      <UploadProgress variant="spinner" state={upload.state} label={t.threads.mediaLabel}
        onCancel={() => { cancelled.current = true; upload.cancel(); }} onRetry={submit} />
      <Message text={error} />
      <Button label={t.threads.post} onPress={submit} loading={busy} disabled={body.trim().length === 0 && media.length === 0} />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  minHeight120TextAlignVerticalTop: { minHeight: 120, textAlignVertical: 'top' },
  itemsFlexend: { alignItems: 'flex-end' },
  gapThree: { gap: Spacing.three },
  rowGapTwoItemsFlexstart: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  width72Height72Radius8: { width: 72, height: 72, borderRadius: 8 },
  flex1GapOne: { flex: 1, gap: Spacing.one },
});

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    colorDanger: { color: theme.danger },
    colorTextSecondary: { color: theme.textSecondary },
  });
