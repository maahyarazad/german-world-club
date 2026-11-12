import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { CONTACT_METHODS, LISTING_MEDIA_MAX, MARKETPLACE_MODES } from '@gwc/contracts/marketplace';
import type {
  CategoryDef, ContactMethod, MarketplaceCategory, MarketplaceMode, TermsResponse, VehicleFeature,
} from '@gwc/contracts/marketplace';

import { ApiError } from '@/api/client';
import { marketplaceApi } from '@/api/endpoints';
import { DatePartsField } from '@/components/date-parts-field';
import { ListingField } from '@/components/listing-field';
import { ThemedText } from '@/components/themed-text';
import { Button, Chip, FormScreen, Message, TextField, styles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';
import { pickMedia, uploadReady, type Picked } from '@/lib/pick-media';

type MediaStatus = 'pending' | 'uploading' | 'attached' | 'failed';
type Pending = Picked & { alt: string; status: MediaStatus };

const log = (where: string, e: unknown) => console.error(`MarketplaceCompose.${where}`, e instanceof ApiError ? e.problem : e);

/**
 * A new marketplace listing (feature 017, US3) — the web's compose form, on a
 * screen that slides in from the right (see _layout.tsx).
 *
 * The rules are the web's, and the server's before that: the fields come from
 * `GET /marketplace/categories`, posting needs `marketplace_post` (checked by
 * the server, whatever this screen showed), and the thresholds that enable
 * Publish are early feedback the server repeats.
 *
 * Media go the opposite way round from a thread post: the listing is created
 * first and each item is uploaded and attached to it, in order, because the
 * marketplace attaches to an existing listing and the first item attached
 * represents it in the index. An item that fails is kept, with the listing's
 * id, so Retry attaches to that listing instead of creating a second one.
 */
export default function NewListing() {
  const { t, format } = useTranslations();
  const [categories, setCategories] = useState<readonly CategoryDef[]>([]);
  const [vehicleFeatures, setVehicleFeatures] = useState<readonly VehicleFeature[]>([]);
  const [terms, setTerms] = useState<TermsResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const [category, setCategory] = useState<MarketplaceCategory | ''>('');
  const [mode, setMode] = useState<MarketplaceMode>('offer');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [details, setDetails] = useState<Record<string, unknown>>({});
  const [features, setFeatures] = useState<Set<string>>(new Set());
  const [contactMethod, setContactMethod] = useState<ContactMethod>('platform_message');
  const [expiresAt, setExpiresAt] = useState('');
  const [media, setMedia] = useState<Pending[]>([]);
  const [attachingTo, setAttachingTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Local checks only (alt text, photo permission, media count, partial
  // upload) — a server refusal is logged, never held here (CLAUDE.md).
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    marketplaceApi.categories().then((res) => {
      setCategories(res.categories);
      setVehicleFeatures(res.vehicleFeatures);
      // Start on the first category once they arrive — the web form shipped
      // with `category: ''` for a while and every publish failed validation.
      setCategory((current) => current || res.categories[0]?.category || '');
    }, (e) => { log('loadCategories', e); setLoadFailed(true); });
    marketplaceApi.terms().then(setTerms, (e) => { log('loadTerms', e); setLoadFailed(true); });
  }, []);

  const activeDef = categories.find((c) => c.category === category);

  const chooseCategory = (next: MarketplaceCategory) => {
    // A field typed for one category means nothing in another, and the server
    // would refuse it as unknown.
    setCategory(next);
    setDetails({});
    setFeatures(new Set());
  };

  const setDetail = (key: string, value: unknown) =>
    setDetails((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });

  const toggleFeature = (key: string) =>
    setFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const addMedia = async () => {
    const room = LISTING_MEDIA_MAX - media.length;
    if (room <= 0) return setError(format(t.marketplace.mediaTooMany, { max: LISTING_MEDIA_MAX }));
    const { denied, items } = await pickMedia({ limit: room });
    if (denied) return setError(t.marketplace.photoPermission);
    setError(null);
    setMedia((all) => [...all, ...items.map((i): Pending => ({ ...i, alt: '', status: 'pending' }))]);
  };

  const setStatus = (uri: string, status: MediaStatus) =>
    setMedia((all) => all.map((m) => (m.uri === uri ? { ...m, status } : m)));

  /** In the order shown; returns what failed, marked as failed. */
  const attachAll = async (listingId: string, items: readonly Pending[]) => {
    const failed: Pending[] = [];
    for (const item of items) {
      setStatus(item.uri, 'uploading');
      try {
        const assetId = await uploadReady(item, item.alt.trim());
        await marketplaceApi.attachMedia(listingId, assetId);
        setStatus(item.uri, 'attached');
      } catch (e) {
        log('attachAll', e);
        setStatus(item.uri, 'failed');
        failed.push({ ...item, status: 'failed' });
      }
    }
    return failed;
  };

  const finish = (failed: Pending[]) => {
    if (failed.length === 0) {
      // The list reloads when it regains focus, so the new listing is there.
      router.back();
      return;
    }
    setMedia(failed);
    setError(t.marketplace.mediaFailed);
    setBusy(false);
  };

  const submit = async () => {
    if (!terms || !category) return;
    // Alt text is required at ingest (§10.1); refusing here beats creating the
    // listing and then failing every upload.
    if (media.some((m) => !m.alt.trim())) return setError(t.marketplace.mediaAltMissing);
    setBusy(true);
    setError(null);
    let listingId: string;
    try {
      ({ id: listingId } = await marketplaceApi.create({
        category, mode, title, body, details,
        ...(category === 'vehicle' ? { features: [...features] } : {}),
        contactMethod,
        expiresAt: expiresAt === '' ? null : new Date(expiresAt).toISOString(),
        termsVersion: terms.version,
      }));
    } catch (e) {
      log('submit', e);
      setBusy(false);
      return;
    }
    setAttachingTo(listingId);
    finish(await attachAll(listingId, media));
  };

  const retry = async () => {
    if (!attachingTo) return;
    setBusy(true);
    setError(null);
    finish(await attachAll(attachingTo, media));
  };

  const acceptTerms = async () => {
    setBusy(true);
    try {
      setTerms(await marketplaceApi.acceptTerms());
    } catch (e) {
      log('acceptTerms', e);
    } finally {
      setBusy(false);
    }
  };

  // Loaded AND equal — an unloaded terms record must not read as accepted.
  const termsAccepted = terms !== null && terms.acceptedVersion === terms.version;
  const ready = categories.length > 0 && terms !== null && category !== '';
  const canPublish = !busy && ready && termsAccepted && title.trim().length >= 3 && body.trim().length >= 10;
  // Once the listing exists, editing it here would edit nothing: only retry remains.
  const locked = busy || attachingTo !== null;

  return (
    <FormScreen>
      {loadFailed ? <Message tone="info" text={t.marketplace.loadFailed} /> : null}

      <View style={{ gap: Spacing.one }}>
        <ThemedText type="smallBold">{t.marketplace.category}</ThemedText>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {categories.map((c) => (
            <Chip key={c.category} label={t.marketplace.categories[c.category]} selected={category === c.category}
              onPress={() => !locked && chooseCategory(c.category)} />
          ))}
        </View>
      </View>

      <View style={{ gap: Spacing.one }}>
        <ThemedText type="smallBold">{t.marketplace.mode}</ThemedText>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {MARKETPLACE_MODES.map((m) => (
            <Chip key={m} label={t.marketplace.modes[m]} selected={mode === m} onPress={() => !locked && setMode(m)} />
          ))}
        </View>
      </View>

      <TextField label={t.marketplace.titleField} value={title} onChangeText={setTitle} editable={!locked} />
      <TextField label={t.marketplace.body} value={body} onChangeText={setBody} editable={!locked}
        multiline style={{ minHeight: 120, textAlignVertical: 'top' }} />

      {activeDef?.fields.map((def) => (
        <ListingField key={`${category}:${def.key}`} def={def} value={details[def.key]} onChange={(v) => setDetail(def.key, v)} />
      ))}

      {category === 'vehicle' && vehicleFeatures.length > 0 ? (
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold">{t.marketplace.features}</ThemedText>
          <View style={styles.chips}>
            {vehicleFeatures.map((f) => (
              <Chip key={f.key} label={f.key} selected={features.has(f.key)} onPress={() => !locked && toggleFeature(f.key)} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: Spacing.two }}>
        <ThemedText type="smallBold">{t.marketplace.media}</ThemedText>
        {media.map((item, index) => (
          <View key={item.uri} style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' }}>
            <Image source={item.uri} accessibilityLabel={item.alt} style={{ width: 72, height: 72, borderRadius: 8 }} contentFit="cover" />
            <View style={{ flex: 1, gap: Spacing.one }}>
              <TextField
                label={t.marketplace.mediaAlt}
                value={item.alt}
                maxLength={300}
                editable={!busy}
                onChangeText={(alt) => setMedia((all) => all.map((m, i) => (i === index ? { ...m, alt } : m)))}
              />
              <View style={[styles.row, { justifyContent: 'space-between' }]}>
                <ThemedText type="small" themeColor="textSecondary">{t.marketplace.mediaStatus[item.status]}</ThemedText>
                {!busy ? (
                  <ThemedText type="small" themeColor="textSecondary" accessibilityRole="button"
                    onPress={() => setMedia((all) => all.filter((_, i) => i !== index))}>
                    {t.marketplace.mediaRemove}
                  </ThemedText>
                ) : null}
              </View>
            </View>
          </View>
        ))}
        {attachingTo === null ? (
          <Button label={t.marketplace.mediaAdd} variant="secondary" onPress={addMedia}
            disabled={busy || media.length >= LISTING_MEDIA_MAX} />
        ) : null}
      </View>

      <View style={{ gap: Spacing.one }}>
        <ThemedText type="smallBold">{t.marketplace.contactMethod}</ThemedText>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {CONTACT_METHODS.map((m) => (
            <Chip key={m} label={t.marketplace.contactMethods[m]} selected={contactMethod === m}
              onPress={() => !locked && setContactMethod(m)} />
          ))}
        </View>
      </View>

      <DatePartsField label={t.marketplace.expiresAt} hint={t.marketplace.expiresAtHint} value={expiresAt} onChange={setExpiresAt} />

      {terms && !termsAccepted ? (
        <View style={{ gap: Spacing.two }}>
          <Message tone="info" text={t.marketplace.termsRequired} />
          <Button label={t.marketplace.acceptTerms} variant="secondary" onPress={acceptTerms} disabled={busy} />
        </View>
      ) : null}

      <Message text={error} />

      {attachingTo !== null && !busy ? (
        <Button label={t.marketplace.mediaRetry} variant="secondary" onPress={retry} />
      ) : (
        <Button label={busy ? t.marketplace.publishing : t.marketplace.submit} onPress={submit} loading={busy} disabled={!canPublish} />
      )}
    </FormScreen>
  );
}
