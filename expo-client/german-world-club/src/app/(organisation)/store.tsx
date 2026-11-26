import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { MAX_STORE_MEDIA } from '@gwc/contracts/media';
import type { Store } from '@gwc/contracts/stores';

import { ApiError } from '@/api/client';
import { merchantApi } from '@/api/endpoints';
import { imageUrl, WideImage } from '@/components/media-carousel';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, FormScreen, Loading, Message, TextField } from '@/components/ui';
import { UploadProgress } from '@/components/upload-progress';
import { Spacing } from '@/constants/theme';
import { useMediaUpload } from '@/hooks/use-media-upload';
import { useTranslations } from '@/i18n';
import { checkPicked } from '@/lib/media-limits';
import type { LimitCheck } from '@/lib/media-limits';
import { pickMedia } from '@/lib/pick-media';

/**
 * A merchant's store (feature 035): the wide cover across the top, a gallery of
 * at most ten photos or videos, a description and opening hours.
 *
 * Name and logo are the organisation's public profile and are edited there. State
 * is only what changes behaviour — the store, the form, a busy flag and the local
 * checks a person must be told about (a file over its limit, a cover that is not
 * wide). A server refusal is logged to the console, with one exception shown in
 * words: a stale edit, because nothing else explains why a save did nothing.
 */
export default function StoreScreen() {
  const { t, format } = useTranslations();
  // undefined = loading, null = the organisation has no store yet.
  const [store, setStore] = useState<Store | null | undefined>(undefined);
  const [form, setForm] = useState({ description: '', openingHours: '' });
  const [message, setMessage] = useState<{ text: string; tone: 'danger' | 'success' } | null>(null);
  const [busy, setBusy] = useState(false);
  const cover = useMediaUpload('merchant');
  const gallery = useMediaUpload('merchant');

  const adopt = useCallback((s: Store) => {
    setStore(s);
    setForm({ description: s.description ?? '', openingHours: s.openingHours ?? '' });
  }, []);

  useEffect(() => {
    merchantApi.store().then(adopt, (e) => {
      if (e instanceof ApiError && e.status === 404) { setStore(null); return; }
      console.error('StoreScreen.load', e instanceof ApiError ? e.problem : e);
    });
  }, [adopt]);

  const limitText = (check: LimitCheck) => ({
    ok: null,
    'image-too-large': t.merchant.limits.imageTooLarge,
    'video-too-large': t.merchant.limits.videoTooLarge,
    'not-an-image': t.merchant.limits.notAnImage,
    'not-wide': t.merchant.limits.notWide,
  })[check];

  const run = async (fn: () => Promise<Store>) => {
    setBusy(true);
    setMessage(null);
    try {
      adopt(await fn());
      setMessage({ text: t.merchant.saved, tone: 'success' });
    } catch (e) {
      console.error('StoreScreen.run', e instanceof ApiError ? e.problem : e);
      if (e instanceof ApiError && e.status === 409) setMessage({ text: t.merchant.conflict, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  /** Free a file nothing uses any more. Quiet: a refusal means something still uses it. */
  const release = (assetId: string | undefined) => {
    if (assetId) merchantApi.deleteFile(assetId).catch(() => undefined);
  };

  const chooseCover = async () => {
    if (!store) return;
    // The picker's own editor crops to 16:9, and a lower quality keeps a photo under 1 MB.
    const { denied, items, unsupported } = await pickMedia({ limit: 1, videos: false, aspect: [16, 9], quality: 0.6 });
    if (denied) return setMessage({ text: t.merchant.limits.permission, tone: 'danger' });
    const [item] = items;
    if (!item) {
      if (unsupported.length > 0) setMessage({ text: t.upload.unsupportedFormat, tone: 'danger' });
      return;
    }
    const text = limitText(checkPicked(item, { cover: true }));
    if (text) return setMessage({ text, tone: 'danger' });
    setMessage(null);
    const asset = await cover.start(item, `${store.displayName ?? ''} — ${t.merchant.cover}`);
    if (!asset) return;
    const previous = store.cover?.assetId;
    await run(() => merchantApi.setCover(asset.id));
    if (previous && previous !== asset.id) release(previous);
  };

  const addToGallery = async () => {
    if (!store) return;
    const { denied, items, unsupported } = await pickMedia({ limit: 1, videos: true, quality: 0.6 });
    if (denied) return setMessage({ text: t.merchant.limits.permission, tone: 'danger' });
    const [item] = items;
    if (!item) {
      if (unsupported.length > 0) setMessage({ text: t.upload.unsupportedFormat, tone: 'danger' });
      return;
    }
    const text = limitText(checkPicked(item));
    if (text) return setMessage({ text, tone: 'danger' });
    setMessage(null);
    const asset = await gallery.start(item, `${t.merchant.gallery} ${store.media.length + 1}`);
    if (!asset) return;
    await run(() => merchantApi.setStoreMedia([...store.media.map((m) => m.assetId), asset.id]));
  };

  if (store === undefined) return <Loading />;
  if (store === null) {
    return (
      <FormScreen title={t.merchant.storeEntry}>
        <ThemedText>{t.merchant.noStore}</ThemedText>
        <Button label={t.merchant.createStore} loading={busy} onPress={() => void run(() => merchantApi.createStore({}))} />
        <Message text={message?.text} tone={message?.tone} />
      </FormScreen>
    );
  }

  const full = store.media.length >= MAX_STORE_MEDIA;
  const uploading = (s: { phase: string }) => s.phase === 'uploading' || s.phase === 'processing';
  return (
    <FormScreen title={store.displayName ?? t.merchant.storeEntry}>
      {!store.active ? (
        <Card>
          <ThemedText type="smallBold">{t.merchant.deactivatedTitle}</ThemedText>
          <ThemedText>{t.merchant.deactivatedBody}</ThemedText>
        </Card>
      ) : null}
      <Message text={message?.text} tone={message?.tone} />

      <View style={styles.gapTwo}>
        <ThemedText type="smallBold">{t.merchant.cover}</ThemedText>
        {store.cover ? (
          <Image source={{ uri: imageUrl(store.cover, 800) }} accessibilityLabel={store.cover.alt}
            style={styles.width100pctAspectRatioRadius8} />
        ) : <ThemedText type="small" themeColor="textSecondary">{t.merchant.coverHint}</ThemedText>}
        <Button label={t.merchant.coverChoose} variant="secondary" disabled={busy || uploading(cover.state)} onPress={() => void chooseCover()} />
        {store.cover ? (
          <Button label={t.merchant.coverRemove} variant="secondary" disabled={busy} onPress={() => {
            const previous = store.cover?.assetId;
            void run(() => merchantApi.setCover(null)).then(() => release(previous));
          }} />
        ) : null}
        <UploadProgress state={cover.state} label={t.merchant.cover} onCancel={cover.cancel} />
      </View>

      <TextField label={t.merchant.description} value={form.description} multiline maxLength={2000}
        onChangeText={(description) => setForm({ ...form, description })} />
      <TextField label={t.merchant.openingHours} value={form.openingHours} multiline maxLength={500}
        onChangeText={(openingHours) => setForm({ ...form, openingHours })} />
      <Button label={t.merchant.save} loading={busy} onPress={() => void run(() => merchantApi.updateStore({
        version: store.version,
        description: form.description.trim() || null,
        openingHours: form.openingHours.trim() || null,
      }))} />

      <View style={styles.gapTwo}>
        <ThemedText type="smallBold">{t.merchant.gallery}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{format(t.merchant.galleryHint, { max: MAX_STORE_MEDIA })}</ThemedText>
        {store.media.map((item) => (
          <View key={item.assetId} style={styles.gapOne}>
            <WideImage item={item} />
            <Button label={t.merchant.galleryRemove} variant="secondary" disabled={busy} onPress={() => {
              void run(() => merchantApi.setStoreMedia(store.media.filter((m) => m.assetId !== item.assetId).map((m) => m.assetId)))
                .then(() => release(item.assetId));
            }} />
          </View>
        ))}
        <Button label={t.merchant.galleryAdd} variant="secondary" disabled={busy || full || uploading(gallery.state)} onPress={() => void addToGallery()} />
        {full ? <ThemedText type="small" themeColor="textSecondary">{format(t.merchant.galleryFull, { max: MAX_STORE_MEDIA })}</ThemedText> : null}
        <UploadProgress state={gallery.state} label={t.merchant.gallery} onCancel={gallery.cancel} />
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  gapTwo: { gap: Spacing.two },
  width100pctAspectRatioRadius8: { width: '100%', aspectRatio: 16 / 9, borderRadius: 8 },
  gapOne: { gap: Spacing.one },
  width100pctRadius8: { width: '100%', borderRadius: 8 },
});
