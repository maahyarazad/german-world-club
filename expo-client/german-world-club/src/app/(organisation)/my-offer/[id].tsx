import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { MAX_OFFER_MEDIA, NEW_OFFER_KINDS } from '@gwc/contracts/offers';
import type { CreateOfferRequest, MerchantOffer, OfferCategory } from '@gwc/contracts/offers';

import { ApiError } from '@/api/client';
import { merchantApi } from '@/api/endpoints';
import { DatePartsField } from '@/components/date-parts-field';
import { WideImage } from '@/components/media-carousel';
import { ThemedText } from '@/components/themed-text';
import { Button, Chip, FormScreen, Loading, Message, TextField } from '@/components/ui';
import { UploadProgress } from '@/components/upload-progress';
import { Spacing } from '@/constants/theme';
import { useMediaUpload } from '@/hooks/use-media-upload';
import { useTranslations } from '@/i18n';
import { checkPicked } from '@/lib/media-limits';
import { pickMedia } from '@/lib/pick-media';

type Form = {
  title: string; description: string; categoryId: string; benefitKind: string
  benefitValue: string; regularPrice: string; memberPrice: string
  validFrom: string; validUntil: string; conditions: string; remaining: string; perPerson: string
};
const EMPTY: Form = {
  title: '', description: '', categoryId: '', benefitKind: 'percentage', benefitValue: '', regularPrice: '', memberPrice: '',
  validFrom: '', validUntil: '', conditions: '', remaining: '', perPerson: '1',
};
const isoDate = (iso: string) => iso.slice(0, 10);
const intOrNull = (v: string) => (v.trim() === '' ? null : Math.round(Number(v)));
const numberOrNull = (v: string) => (v.trim() === '' ? null : Number(v));
const fromOffer = (o: MerchantOffer): Form => ({
  title: o.title, description: o.description ?? '', categoryId: o.categoryId, benefitKind: o.benefit.kind,
  benefitValue: o.benefit.value === null ? '' : String(o.benefit.value),
  regularPrice: o.regularPriceCents === null ? '' : String(o.regularPriceCents),
  memberPrice: o.memberPriceCents === null ? '' : String(o.memberPriceCents),
  validFrom: isoDate(o.validFrom), validUntil: isoDate(o.validUntil), conditions: o.conditions ?? '',
  remaining: o.remaining === null ? '' : String(o.remaining), perPerson: o.perPersonLimit === null ? '' : String(o.perPersonLimit),
});

/**
 * Creating or editing one offer on the phone (feature 035). The category list
 * comes from the server; the dates are entered as day, month and year (the app
 * has no date-picker module, and adding one would mean a new build); prices are
 * in cents, as the server stores them. Images and videos can be added once the
 * offer exists, at most ten, each under its merchant limit.
 */
export default function OfferEditor() {
  const { t, format, locale } = useTranslations();
  const { id } = useLocalSearchParams<{ id: string }>();
  const creating = id === 'new';
  const [offer, setOffer] = useState<MerchantOffer | null>(null);
  const [categories, setCategories] = useState<OfferCategory[] | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(!creating);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'danger' | 'success' } | null>(null);
  const upload = useMediaUpload('merchant');

  useEffect(() => {
    merchantApi.categories().then((r) => setCategories(r.items), (e) => console.error('OfferEditor.categories', e instanceof ApiError ? e.problem : e));
  }, []);
  useEffect(() => {
    if (creating) return;
    merchantApi.offers().then((r) => {
      const found = r.items.find((o) => o.id === id);
      if (found) { setOffer(found); setForm(fromOffer(found)); }
    }, (e) => console.error('OfferEditor.load', e instanceof ApiError ? e.problem : e)).finally(() => setLoading(false));
  }, [creating, id]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const noValue = form.benefitKind === 'freebie' || form.benefitKind === 'bogo';

  const body = (): CreateOfferRequest => ({
    title: form.title.trim(),
    description: form.description.trim() || null,
    categoryId: form.categoryId || null,
    benefitKind: form.benefitKind as CreateOfferRequest['benefitKind'],
    benefitValue: noValue ? null : numberOrNull(form.benefitValue),
    regularPriceCents: noValue ? null : intOrNull(form.regularPrice),
    memberPriceCents: noValue ? null : intOrNull(form.memberPrice),
    // The start of the first day and the end of the last: a date, not a time.
    validFrom: new Date(`${form.validFrom}T00:00:00`).toISOString(),
    validUntil: new Date(`${form.validUntil}T23:59:59`).toISOString(),
    conditions: form.conditions.trim() || null,
    remaining: intOrNull(form.remaining),
    perPersonLimit: intOrNull(form.perPerson),
  });

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (creating) {
        const created = await merchantApi.createOffer(body());
        router.replace({ pathname: '/my-offer/[id]' as never, params: { id: created.id } });
        return;
      }
      setOffer(await merchantApi.updateOffer(offer!.id, { ...body(), version: offer!.version }));
      setMessage({ text: t.merchant.saved, tone: 'success' });
    } catch (e) {
      console.error('OfferEditor.save', e instanceof ApiError ? e.problem : e);
      if (e instanceof ApiError && e.status === 409) setMessage({ text: t.merchant.conflict, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const setMedia = async (assetIds: string[]) => {
    if (!offer) return;
    setBusy(true);
    try {
      setOffer(await merchantApi.setOfferMedia(offer.id, assetIds));
    } catch (e) {
      console.error('OfferEditor.setMedia', e instanceof ApiError ? e.problem : e);
    } finally {
      setBusy(false);
    }
  };

  const addMedia = async () => {
    if (!offer) return;
    const { denied, items } = await pickMedia({ limit: 1, videos: true, quality: 0.6 });
    if (denied) return setMessage({ text: t.merchant.limits.permission, tone: 'danger' });
    const [item] = items;
    if (!item) return;
    const check = checkPicked(item);
    if (check !== 'ok') {
      return setMessage({ text: check === 'video-too-large' ? t.merchant.limits.videoTooLarge : t.merchant.limits.imageTooLarge, tone: 'danger' });
    }
    setMessage(null);
    const asset = await upload.start(item, `${offer.title} ${offer.media.length + 1}`);
    if (asset) await setMedia([...offer.media.map((m) => m.assetId), asset.id]);
  };

  if (loading || !categories) return <Loading />;
  const canSave = form.title.trim() !== '' && form.categoryId !== '' && form.validFrom !== '' && form.validUntil !== '';
  const uploading = upload.state.phase === 'uploading' || upload.state.phase === 'processing';

  return (
    <FormScreen title={creating ? t.merchant.offers.new : t.merchant.offers.edit}>
      <Message text={message?.text} tone={message?.tone} />
      <TextField label={t.merchant.offers.fieldTitle} value={form.title} maxLength={160} onChangeText={(v) => set('title', v)} />
      <TextField label={t.merchant.offers.fieldDescription} value={form.description} multiline maxLength={4000} onChangeText={(v) => set('description', v)} />

      <ThemedText type="smallBold">{t.merchant.offers.category}</ThemedText>
      <View style={styles.rowFlexWrapWrapGapTwo}>
        {categories.map((c) => (
          <Chip key={c.id} label={locale === 'de' ? c.nameDe : c.nameEn} selected={form.categoryId === c.id} onPress={() => set('categoryId', c.id)} />
        ))}
      </View>

      <ThemedText type="smallBold">{t.merchant.offers.kind}</ThemedText>
      <View style={styles.rowFlexWrapWrapGapTwo}>
        {NEW_OFFER_KINDS.map((k) => (
          <Chip key={k} label={t.merchant.offers.kinds[k]} selected={form.benefitKind === k} onPress={() => set('benefitKind', k)} />
        ))}
      </View>

      {!noValue ? (
        <>
          <TextField label={t.merchant.offers.value} value={form.benefitValue} keyboardType="decimal-pad" onChangeText={(v) => set('benefitValue', v)} />
          <TextField label={t.merchant.offers.regularPrice} value={form.regularPrice} keyboardType="number-pad" onChangeText={(v) => set('regularPrice', v)} />
          <TextField label={t.merchant.offers.memberPrice} value={form.memberPrice} keyboardType="number-pad" onChangeText={(v) => set('memberPrice', v)} />
        </>
      ) : null}

      <DatePartsField label={t.merchant.offers.validFrom} value={form.validFrom} onChange={(v) => set('validFrom', v)} />
      <DatePartsField label={t.merchant.offers.validUntil} value={form.validUntil} onChange={(v) => set('validUntil', v)} />
      <TextField label={t.merchant.offers.remaining} hint={t.merchant.offers.unlimitedHint} value={form.remaining} keyboardType="number-pad" onChangeText={(v) => set('remaining', v)} />
      <TextField label={t.merchant.offers.perPerson} hint={t.merchant.offers.unlimitedHint} value={form.perPerson} keyboardType="number-pad" onChangeText={(v) => set('perPerson', v)} />
      <TextField label={t.merchant.offers.conditions} value={form.conditions} multiline maxLength={2000} onChangeText={(v) => set('conditions', v)} />
      <Button label={t.merchant.save} loading={busy} disabled={!canSave} onPress={() => void save()} />

      <ThemedText type="smallBold">{t.merchant.offers.media}</ThemedText>
      {!offer ? <ThemedText themeColor="textSecondary">{t.merchant.offers.saveFirst}</ThemedText> : (
        <View style={styles.gapTwo}>
          <ThemedText type="small" themeColor="textSecondary">{format(t.merchant.offers.mediaHint, { max: MAX_OFFER_MEDIA })}</ThemedText>
          {offer.media.map((item) => (
            <View key={item.assetId} style={styles.gapOne}>
              <WideImage item={item} />
              <Button label={t.merchant.galleryRemove} variant="secondary" disabled={busy} onPress={() => {
                void setMedia(offer.media.filter((m) => m.assetId !== item.assetId).map((m) => m.assetId))
                  .then(() => merchantApi.deleteFile(item.assetId).catch(() => undefined));
              }} />
            </View>
          ))}
          <Button label={t.merchant.galleryAdd} variant="secondary" disabled={busy || uploading || offer.media.length >= MAX_OFFER_MEDIA} onPress={() => void addMedia()} />
          <UploadProgress state={upload.state} label={t.merchant.offers.media} onCancel={upload.cancel} />
        </View>
      )}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  rowFlexWrapWrapGapTwo: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  gapTwo: { gap: Spacing.two },
  gapOne: { gap: Spacing.one },
  width100pctRadius8: { width: '100%', borderRadius: 8 },
});
