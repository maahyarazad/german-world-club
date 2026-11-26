import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Switch, View, StyleSheet } from 'react-native';

import { PROBLEMS } from '@gwc/contracts/errors';
import { CONTACT_METHODS, LISTING_MEDIA_MAX, MARKETPLACE_MODES, modesFor } from '@gwc/contracts/marketplace';
import type {
  CategoryDef, ContactMethod, MarketplaceCategory, MarketplaceMode, OwnListing, TermsResponse, VehicleFeature,
} from '@gwc/contracts/marketplace';

import { ApiError } from '@/api/client';
import { marketplaceApi } from '@/api/endpoints';
import { DatePartsField } from '@/components/date-parts-field';
import { ListingField } from '@/components/listing-field';
import { imageUrl } from '@/components/media-carousel';
import { ScreenLoader } from '@/components/screen-loader';
import { ThemedText } from '@/components/themed-text';
import { UploadProgress } from '@/components/upload-progress';
import { Button, Chip, FormScreen, Message, TextField, styles as uiStyles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useMediaUpload } from '@/hooks/use-media-upload';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';
import { pickMedia, type Picked } from '@/lib/pick-media';

type MediaStatus = 'pending' | 'uploading' | 'attached' | 'failed';
type Pending = Picked & { alt: string; status: MediaStatus };

const log = (where: string, e: unknown) => console.error(`ListingForm.${where}`, e instanceof ApiError ? e.problem : e);

/** What an edit needs to remember about the listing it loaded. */
type Existing = {
  version: string;
  state: string;
  canEdit: boolean;
  moderated: boolean;
  /** Whether it was live when loaded: `published` is sent only when the switch differs. */
  wasPublished: boolean;
  /** The expiry as the form shows it, so an untouched date is not re-sent (and rounded to midnight). */
  expiryAtLoad: string;
};

/**
 * A marketplace listing, new or being edited (features 017 and 037) — the web's
 * compose form on a screen that slides in from the right.
 *
 * One form for both, so the field list, the validation thresholds and the layout
 * are one definition (Principle I): `editId` set means edit that listing. The
 * rules are the server's — the fields come from `GET /marketplace/categories`,
 * what may be done comes from the flags the server sends (`canEdit`,
 * `moderated`), and the server re-checks every save whatever this showed.
 *
 * **Media go the opposite way round from a thread post:** the listing is saved
 * first and each file is uploaded and attached to it, in order, because the
 * marketplace attaches to an existing listing and the first one attached
 * represents it in the index. A file that fails is kept, with the listing's id,
 * so Retry attaches to that listing instead of creating a second one. Each file
 * goes up through `useMediaUpload('member')`, so the member sees the club's
 * loader with a percentage, covering the whole batch.
 *
 * **Publish** is a switch. A new listing starts on (the clarified default) and
 * an edit shows the listing's own state; `published` is sent only when the member
 * changed it. A listing staff disabled shows the switch off and unavailable.
 */
export function ListingForm({ editId = null }: { editId?: string | null }) {
  const { t, format } = useTranslations();
  const theme = useTheme();
  const editing = editId !== null;

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
  const [publish, setPublish] = useState(true);
  const [media, setMedia] = useState<Pending[]>([]);
  const [attachingTo, setAttachingTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Local checks only (alt text, photo permission, media count, partial upload,
  // a stale form) — a server refusal is logged, never held here (CLAUDE.md).
  const [error, setError] = useState<string | null>(null);

  // Edit mode. `stale` and `editFailed` are flags that change what is offered
  // (a reload, a retry), not stored refusals.
  const [existing, setExisting] = useState<Existing | null>(null);
  const [existingMedia, setExistingMedia] = useState<OwnListing['media']>([]);
  const [stale, setStale] = useState(false);
  const [editFailed, setEditFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Reload resets the failure flag here, in the handler, not inside the effect that fetches.
  const reload = () => { setEditFailed(false); setReloadKey((k) => k + 1); };

  const upload = useMediaUpload('member');
  const cancelled = useRef(false);

  useEffect(() => {
    marketplaceApi.categories().then((res) => {
      setCategories(res.categories);
      setVehicleFeatures(res.vehicleFeatures);
      // Start on the first category once they arrive — the web form shipped
      // with `category: ''` for a while and every publish failed validation.
      setCategory((current) => current || res.categories[0]?.category || '');
    }, (e) => { log('loadCategories', e); setLoadFailed(true); });
    // Editing needs no terms: they were accepted when the listing was posted.
    if (!editing) marketplaceApi.terms().then(setTerms, (e) => { log('loadTerms', e); setLoadFailed(true); });
  }, [editing]);

  useEffect(() => {
    if (!editId) return;
    let alive = true;
    marketplaceApi.mineOne(editId).then((l) => {
      if (!alive) return;
      setCategory(l.category);
      setMode(l.mode);
      setTitle(l.title);
      setBody(l.body);
      setContactMethod(l.contact?.method ?? 'platform_message');
      const expiry = l.expiresAt ? new Date(l.expiresAt).toISOString().slice(0, 10) : '';
      setExpiresAt(expiry);
      // The database returns every column of the detail row, nulls included; a
      // null is "not set", and sending it back would fail validation.
      setDetails(Object.fromEntries(Object.entries(l.details ?? {}).filter(([, v]) => v !== null && v !== undefined)));
      setFeatures(new Set(l.features ?? []));
      setPublish(l.state === 'active');
      setExistingMedia(l.media ?? []);
      setStale(false);
      setExisting({
        version: l.version, state: l.state, canEdit: l.canEdit, moderated: l.moderated,
        wasPublished: l.state === 'active', expiryAtLoad: expiry,
      });
    }, (e) => { if (alive) { log('loadListing', e); setEditFailed(true); } });
    return () => { alive = false; };
  }, [editId, reloadKey]);

  const activeDef = categories.find((c) => c.category === category);
  // The modes this category allows come from the server's definition (a member
  // may only REQUEST a job, feature 021) — display only; the server re-checks.
  const allowedModes: readonly MarketplaceMode[] = activeDef?.modes ?? MARKETPLACE_MODES;
  const onlyMode = allowedModes.length === 1;

  const chooseCategory = (next: MarketplaceCategory) => {
    // A field typed for one category means nothing in another, and the server
    // would refuse it as unknown.
    setCategory(next);
    setDetails({});
    setFeatures(new Set());
    // A mode the new category does not allow moves to the first it does, so
    // the form can always be sent (Offer becomes Request for Job).
    const modes = categories.find((c) => c.category === next)?.modes ?? modesFor(next);
    if (!modes.includes(mode)) setMode(modes[0] ?? 'request');
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
    const room = LISTING_MEDIA_MAX - existingMedia.length - media.length;
    if (room <= 0) return setError(format(t.marketplace.mediaTooMany, { max: LISTING_MEDIA_MAX }));
    const { denied, items, unsupported } = await pickMedia({ limit: room });
    if (denied) return setError(t.marketplace.photoPermission);
    // The accepted files are added either way; one that cannot be uploaded is named, not dropped silently.
    setError(unsupported.length > 0 ? t.upload.unsupportedFormat : null);
    setMedia((all) => [...all, ...items.map((i): Pending => ({ ...i, alt: '', status: 'pending' }))]);
  };

  const setStatus = (uri: string, status: MediaStatus) =>
    setMedia((all) => all.map((m) => (m.uri === uri ? { ...m, status } : m)));

  /** In the order shown; returns what failed, marked as failed. A cancel fails the rest. */
  const attachAll = async (listingId: string, items: readonly Pending[]) => {
    cancelled.current = false;
    const failed: Pending[] = [];
    for (const [index, item] of items.entries()) {
      if (cancelled.current) {
        setStatus(item.uri, 'failed');
        failed.push({ ...item, status: 'failed' });
        continue;
      }
      setStatus(item.uri, 'uploading');
      try {
        const asset = await upload.start(item, item.alt.trim(), { slot: [index, items.length] });
        if (!asset) throw new Error('upload did not finish');
        await marketplaceApi.attachMedia(listingId, asset.id);
        setStatus(item.uri, 'attached');
      } catch (e) {
        log('attachAll', e);
        setStatus(item.uri, 'failed');
        failed.push({ ...item, status: 'failed' });
      }
    }
    return failed;
  };

  const cancelUpload = useCallback(() => {
    cancelled.current = true;
    upload.cancel();
  }, [upload]);

  const finish = (failed: Pending[], listingId: string) => {
    if (failed.length === 0) {
      // The lists reload when they regain focus, so the change is there.
      router.back();
      return;
    }
    setMedia(failed);
    setAttachingTo(listingId);
    setError(editing ? t.marketplace.mediaFailedEdit : t.marketplace.mediaFailed);
    setBusy(false);
  };

  const submit = async () => {
    if (editing) return saveEdit();
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
        // Switched off saves a private draft; on (the default) goes live.
        publish,
      }));
    } catch (e) {
      log('submit', e);
      // Shown as well as logged: only reachable with a stale category list,
      // and the member cannot proceed without knowing why (CLAUDE.md).
      if (e instanceof ApiError && e.problem?.type === PROBLEMS.MARKETPLACE_MODE_NOT_ALLOWED.type) {
        setError(t.marketplace.jobOfferNote);
      }
      setBusy(false);
      return;
    }
    setAttachingTo(listingId);
    finish(await attachAll(listingId, media), listingId);
  };

  /**
   * Save an edit: one PATCH carries the fields, the expiry and the Publish
   * choice, so they succeed or fail together. `version` is the one this form was
   * loaded from; if the listing changed elsewhere the server says so (409) and
   * the member is offered a reload instead of an overwrite.
   */
  const saveEdit = async () => {
    if (!existing || !editId || !category) return;
    if (media.some((m) => !m.alt.trim())) return setError(t.marketplace.mediaAltMissing);
    setBusy(true);
    setError(null);
    try {
      const saved = await marketplaceApi.update(editId, {
        version: existing.version,
        title, body, category, details,
        ...(category === 'vehicle' ? { features: [...features] } : {}),
        contactMethod,
        // Only when the member changed it: re-sending an unchanged date would
        // round it to midnight and make the form look edited when it was not.
        ...(expiresAt !== existing.expiryAtLoad
          ? { expiresAt: expiresAt === '' ? null : new Date(expiresAt).toISOString() }
          : {}),
        ...(publish !== existing.wasPublished ? { published: publish } : {}),
      });
      setExisting({ ...existing, version: saved.version, state: saved.state, wasPublished: saved.state === 'active', expiryAtLoad: expiresAt });
    } catch (e) {
      log('saveEdit', e);
      if (e instanceof ApiError && e.problem?.type === PROBLEMS.CONFLICT.type) {
        // Shown as well as logged: the member cannot proceed without knowing the
        // form is out of date, and the reload is the way forward.
        setStale(true);
        setError(t.marketplace.conflict);
      } else if (e instanceof ApiError && e.problem?.type === PROBLEMS.MARKETPLACE_NOT_EDITABLE.type) {
        setError(t.marketplace.notEditable);
      } else if (e instanceof ApiError && e.problem?.type === PROBLEMS.MARKETPLACE_MODE_NOT_ALLOWED.type) {
        setError(t.marketplace.jobOfferNote);
      } else if (e instanceof ApiError && /expiresAt/.test(e.problem?.detail ?? '')) {
        setError(t.marketplace.expiryMustBeFuture);
      }
      setBusy(false);
      return;
    }
    // New photos go to the listing that now exists; the version does not move.
    finish(await attachAll(editId, media), editId);
  };

  const retry = async () => {
    const listingId = attachingTo ?? editId;
    if (!listingId) return;
    setBusy(true);
    setError(null);
    finish(await attachAll(listingId, media), listingId);
  };

  const removeExisting = async (assetId: string) => {
    if (!editId) return;
    setBusy(true);
    try {
      await marketplaceApi.detachMedia(editId, assetId);
      setExistingMedia((all) => all.filter((m) => m.assetId !== assetId));
    } catch (e) {
      log('removeExisting', e);
    } finally {
      setBusy(false);
    }
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

  // An edit waits for the listing before showing any field: nothing renders
  // empty and then jumps to the saved values.
  if (editing && editFailed) {
    return (
      <FormScreen>
        <Message tone="info" text={t.marketplace.editLoadFailed} />
        <Button label={t.marketplace.reload} variant="secondary" onPress={reload} />
      </FormScreen>
    );
  }
  if (editing && existing === null) return <ScreenLoader />;

  // Loaded AND equal — an unloaded terms record must not read as accepted.
  const termsAccepted = editing || (terms !== null && terms.acceptedVersion === terms.version);
  const ready = editing ? existing !== null && existing.canEdit && category !== '' : categories.length > 0 && terms !== null && category !== '';
  const canSubmit = !busy && ready && termsAccepted && title.trim().length >= 3 && body.trim().length >= 10 && !(editing && stale);
  // Once the listing exists, editing the new-listing form would edit nothing: only retry remains.
  const locked = busy || (!editing && attachingTo !== null) || (editing && !existing?.canEdit);
  const uploading = upload.state.phase === 'uploading' || upload.state.phase === 'processing';

  return (
    <FormScreen>
      {loadFailed ? <Message tone="info" text={t.marketplace.loadFailed} /> : null}
      {existing?.moderated ? <Message tone="info" text={t.marketplace.publishDisabledByStaff} /> : null}
      {existing && !existing.canEdit && !existing.moderated ? <Message tone="info" text={t.marketplace.notEditable} /> : null}

      <View style={styles.gapOne}>
        <ThemedText type="smallBold">{t.marketplace.category}</ThemedText>
        <View style={uiStyles.chips} accessibilityRole="radiogroup">
          {categories.map((c) => (
            <Chip key={c.category} label={t.marketplace.categories[c.category]} selected={category === c.category}
              onPress={() => !locked && chooseCategory(c.category)} />
          ))}
        </View>
      </View>

      <View style={styles.gapOne}>
        <ThemedText type="smallBold">{t.marketplace.mode}</ThemedText>
        <View style={uiStyles.chips} accessibilityRole="radiogroup">
          {allowedModes.map((m) => (
            <Chip key={m} label={t.marketplace.modes[m]} selected={mode === m} onPress={() => !locked && !editing && setMode(m)} />
          ))}
        </View>
        {onlyMode && !editing ? <ThemedText type="small" themeColor="textSecondary">{t.marketplace.jobOfferNote}</ThemedText> : null}
        {editing ? <ThemedText type="small" themeColor="textSecondary">{t.marketplace.modeLocked}</ThemedText> : null}
      </View>

      <TextField label={t.marketplace.titleField} value={title} onChangeText={setTitle} editable={!locked} />
      <TextField label={t.marketplace.body} value={body} onChangeText={setBody} editable={!locked}
        multiline style={styles.minHeight120TextAlignVerticalTop} />

      {activeDef?.fields.map((def) => (
        <ListingField key={`${category}:${def.key}`} def={def} value={details[def.key]} onChange={(v) => setDetail(def.key, v)} />
      ))}

      {category === 'vehicle' && vehicleFeatures.length > 0 ? (
        <View style={styles.gapOne}>
          <ThemedText type="smallBold">{t.marketplace.features}</ThemedText>
          <View style={uiStyles.chips}>
            {vehicleFeatures.map((f) => (
              <Chip key={f.key} label={f.key} selected={features.has(f.key)} onPress={() => !locked && toggleFeature(f.key)} />
            ))}
          </View>
        </View>
      ) : null}

      {editing && existingMedia.length > 0 ? (
        <View style={styles.gapTwo}>
          <ThemedText type="smallBold">{t.marketplace.mediaCurrent}</ThemedText>
          {existingMedia.map((m) => (
            <View key={m.assetId} style={styles.rowGapTwoItemsFlexstart}>
              <Image source={imageUrl(m, 160)} accessibilityLabel={m.alt} style={styles.width72Height72Radius8} contentFit="cover" />
              <View style={styles.flex1GapOne}>
                <ThemedText type="small">{m.alt}</ThemedText>
                {!locked ? (
                  <ThemedText type="small" themeColor="textSecondary" accessibilityRole="button"
                    onPress={() => removeExisting(m.assetId)}>
                    {t.marketplace.mediaRemove}
                  </ThemedText>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.gapTwo}>
        <ThemedText type="smallBold">{t.marketplace.media}</ThemedText>
        {media.map((item, index) => (
          <View key={item.uri} style={styles.rowGapTwoItemsFlexstart}>
            <Image source={item.uri} accessibilityLabel={item.alt} style={styles.width72Height72Radius8} contentFit="cover" />
            <View style={styles.flex1GapOne}>
              <TextField
                label={t.marketplace.mediaAlt}
                value={item.alt}
                maxLength={300}
                editable={!busy}
                onChangeText={(alt) => setMedia((all) => all.map((m, i) => (i === index ? { ...m, alt } : m)))}
              />
              <View style={[uiStyles.row, styles.justifySpacebetween]}>
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
        {uploading ? (
          // The club's loader with the whole-number percentage (feature 037, FR-020).
          <UploadProgress variant="spinner" state={upload.state} label={t.marketplace.media} onCancel={cancelUpload} />
        ) : null}
        {attachingTo === null || editing ? (
          <Button label={t.marketplace.mediaAdd} variant="secondary" onPress={addMedia}
            disabled={busy || locked || existingMedia.length + media.length >= LISTING_MEDIA_MAX} />
        ) : null}
      </View>

      <View style={styles.gapOne}>
        <ThemedText type="smallBold">{t.marketplace.contactMethod}</ThemedText>
        <View style={uiStyles.chips} accessibilityRole="radiogroup">
          {CONTACT_METHODS.map((m) => (
            <Chip key={m} label={t.marketplace.contactMethods[m]} selected={contactMethod === m}
              onPress={() => !locked && setContactMethod(m)} />
          ))}
        </View>
      </View>

      <DatePartsField label={t.marketplace.expiresAt} hint={t.marketplace.expiresAtHint} value={expiresAt} onChange={setExpiresAt} />

      {/* Publish (feature 037). On for a new listing; on an edit it shows the
          listing's own state. Display only: the server decides whether publishing
          is allowed and refuses a disabled listing. */}
      <View style={styles.rowSwitch}>
        <View style={styles.flex1GapOne}>
          <ThemedText type="smallBold">{t.marketplace.publish}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t.marketplace.publishHint}</ThemedText>
        </View>
        <Switch
          value={publish}
          onValueChange={setPublish}
          disabled={locked || (editing && !existing?.canEdit)}
          accessibilityLabel={t.marketplace.publish}
          trackColor={{ true: theme.tint }}
        />
      </View>

      {terms && !termsAccepted ? (
        <View style={styles.gapTwo}>
          <Message tone="info" text={t.marketplace.termsRequired} />
          <Button label={t.marketplace.acceptTerms} variant="secondary" onPress={acceptTerms} disabled={busy} />
        </View>
      ) : null}

      <Message text={error} />
      {stale ? <Button label={t.marketplace.reload} variant="secondary" onPress={reload} /> : null}

      {attachingTo !== null && !busy && !editing ? (
        <Button label={t.marketplace.mediaRetry} variant="secondary" onPress={retry} />
      ) : (
        <Button
          label={busy ? (editing ? t.marketplace.saving : t.marketplace.publishing) : editing ? t.marketplace.saveChanges : publish ? t.marketplace.submit : t.marketplace.saveDraft}
          onPress={submit}
          loading={busy}
          disabled={!canSubmit}
        />
      )}
      {editing && attachingTo !== null && !busy ? (
        <Button label={t.marketplace.mediaRetry} variant="secondary" onPress={retry} />
      ) : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  gapOne: { gap: Spacing.one },
  minHeight120TextAlignVerticalTop: { minHeight: 120, textAlignVertical: 'top' },
  gapTwo: { gap: Spacing.two },
  rowGapTwoItemsFlexstart: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  rowSwitch: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center', justifyContent: 'space-between' },
  width72Height72Radius8: { width: 72, height: 72, borderRadius: 8 },
  flex1GapOne: { flex: 1, gap: Spacing.one },
  justifySpacebetween: { justifyContent: 'space-between' },
});
