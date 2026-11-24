import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { RefreshControl, ScrollView, View } from 'react-native';

import type { BenefitKind, BrowseCategory, MemberOffer, OfferListItem } from '@gwc/contracts/offers';
import type { Redemption } from '@gwc/contracts/redemptions';

import { ApiError } from '@/api/client';
import { clubOffersApi, type ClubOffersKind } from '@/api/endpoints';
import { imageUrl, MediaCarousel } from '@/components/media-carousel';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, FormScreen, Loading, Message } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { usePaged } from '@/hooks/use-paged';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

/**
 * Merchant offers on the phone (feature 035), shared by every account that has
 * the app: members, and merchant and partner users. The only thing that differs
 * is the mount the server gives each audience, so the screens take a `kind`.
 *
 * They show what the server says is visible and decide nothing: a sold-out offer
 * is shown as sold out, one in a switched-off store is simply not in the list,
 * and lists carry a thumbnail, never the original upload.
 */

function useBenefit() {
  const { t, format, formatMoney, locale } = useTranslations();
  return (benefit: { kind: BenefitKind; value: number | null }, currency: string) => {
    const template = t.clubOffers.benefits[benefit.kind];
    if (benefit.value === null) return template;
    const value = benefit.kind === 'percentage'
      ? new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB').format(benefit.value)
      : formatMoney(Math.round(benefit.value * 100), currency);
    return format(template, { value });
  };
}

export function ClubOffersList({ kind, detailPath, redemptionsPath }: { kind: ClubOffersKind; detailPath: string; redemptionsPath: string }) {
  const theme = useTheme();
  const { t, formatDate, locale } = useTranslations();
  const benefit = useBenefit();
  const [api] = useState(() => clubOffersApi(kind));
  const [categories, setCategories] = useState<BrowseCategory[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);

  useEffect(() => {
    api.categories().then((r) => setCategories(r.items), (e) => console.error('ClubOffersList.categories', e instanceof ApiError ? e.problem : e));
  }, [api]);

  const fetchPage = useCallback((cursor: string | null) => api.list(categoryId, cursor), [api, categoryId]);
  const list = usePaged<OfferListItem>(fetchPage, [categoryId]);

  return (
    <FlashList
      style={{ backgroundColor: theme.background }}
      data={list.items}
      keyExtractor={(o) => o.id}
      onEndReached={list.loadMore}
      refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => list.reload(true)} />}
      ListHeaderComponent={
        <View style={{ gap: Spacing.two, padding: Spacing.three }}>
          <ThemedText themeColor="textSecondary">{t.clubOffers.intro}</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
            <Chip label={t.clubOffers.allCategories} selected={categoryId === null} onPress={() => setCategoryId(null)} />
            {categories.map((c) => (
              <Chip key={c.id} label={`${locale === 'de' ? c.nameDe : c.nameEn} (${c.offerCount})`} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
            ))}
          </ScrollView>
          <Button label={t.clubOffers.myRedemptions} variant="secondary" onPress={() => router.push(redemptionsPath as never)} />
        </View>
      }
      ListEmptyComponent={
        // The loader while the page has not heard back; the empty message only once it has.
        list.loading ? <Loading /> : <ThemedText themeColor="textSecondary" style={{ padding: Spacing.four, textAlign: 'center' }}>{t.clubOffers.empty}</ThemedText>
      }
      renderItem={({ item }) => (
        <View style={{ paddingHorizontal: Spacing.three, paddingBottom: Spacing.two }}>
          <Card onPress={() => router.push({ pathname: detailPath as never, params: { id: item.id } })}>
            {item.thumbnail ? (
              <Image source={{ uri: imageUrl(item.thumbnail, 400) }} accessibilityLabel={item.thumbnail.alt}
                style={{ width: '100%', aspectRatio: item.thumbnail.width / item.thumbnail.height, borderRadius: 8 }} />
            ) : null}
            <ThemedText type="smallBold">{item.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{item.merchant.displayName}</ThemedText>
            <ThemedText>{benefit(item.benefit, item.currency)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{t.clubOffers.validUntil.replace('{date}', formatDate(item.validUntil))}</ThemedText>
            {item.soldOut ? <ThemedText type="smallBold" themeColor="textSecondary">{t.clubOffers.soldOut}</ThemedText> : null}
          </Card>
        </View>
      )}
    />
  );
}

/**
 * One offer, and redeeming it. The request id is made once and reused until the
 * server has answered: a double tap or a retry after a lost response carries the
 * same one, and the server answers a repeat with the original — so this screen
 * can never turn a retry into a second redemption.
 */
export function ClubOfferDetail({ kind, id }: { kind: ClubOffersKind; id: string }) {
  const { t, format, formatDate, formatMoney } = useTranslations();
  const benefit = useBenefit();
  const [api] = useState(() => clubOffersApi(kind));
  const [offer, setOffer] = useState<MemberOffer | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Redemption | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Empty until the first press; made then, so nothing impure runs during render.
  const requestId = useRef('');
  const sending = useRef(false);

  useEffect(() => {
    api.detail(id).then(setOffer, (e) => { console.error('ClubOfferDetail.load', e instanceof ApiError ? e.problem : e); setOffer(null); });
  }, [api, id]);

  const redeem = async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setRefusal(null);
    if (!requestId.current) requestId.current = Crypto.randomUUID();
    try {
      setDone(await api.redeem(id, requestId.current));
      requestId.current = '';
    } catch (e) {
      console.error('ClubOfferDetail.redeem', e instanceof ApiError ? e.problem : e);
      if (e instanceof ApiError) {
        // The server answered, so the next attempt is a new request.
        requestId.current = '';
        const type = e.type ?? '';
        setRefusal(
          type.includes('sold-out') ? t.clubOffers.refusals.soldOut
            : type.includes('per-person-limit') ? t.clubOffers.refusals.perPersonLimit
              : type.includes('own-offer') ? t.clubOffers.refusals.ownOffer
                : e.status === 404 ? t.clubOffers.unavailable : null,
        );
      }
      // A network failure keeps the same request id, so pressing again is a retry.
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  if (offer === undefined) return <Loading />;
  if (offer === null) return <FormScreen title={t.clubOffers.unavailable}>{null}</FormScreen>;

  const money = (cents: number | null) => (cents === null ? null : formatMoney(cents, offer.currency));
  return (
    <FormScreen title={offer.title} subtitle={offer.merchant.displayName}>
      {offer.media.length > 0 ? <MediaCarousel media={offer.media} /> : null}
      <Card>
        <ThemedText type="subtitle">{benefit(offer.benefit, offer.currency)}</ThemedText>
        {offer.regularPriceCents !== null ? <ThemedText themeColor="textSecondary">{money(offer.regularPriceCents)}</ThemedText> : null}
        {offer.memberPriceCents !== null ? <ThemedText type="smallBold">{money(offer.memberPriceCents)}</ThemedText> : null}
      </Card>
      {offer.description ? <ThemedText>{offer.description}</ThemedText> : null}
      <ThemedText type="small" themeColor="textSecondary">{t.clubOffers.validUntil.replace('{date}', formatDate(offer.validUntil))}</ThemedText>
      {offer.perPersonLimit !== null ? (
        <ThemedText type="small" themeColor="textSecondary">{format(t.clubOffers.perPerson, { count: offer.perPersonLimit })}</ThemedText>
      ) : null}
      {offer.conditions ? (
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold">{t.clubOffers.conditions}</ThemedText>
          <ThemedText>{offer.conditions}</ThemedText>
        </View>
      ) : null}
      <Message text={refusal} />
      {done ? (
        <Card>
          <ThemedText type="smallBold">{t.clubOffers.redeemed}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t.clubOffers.reference}</ThemedText>
          <ThemedText type="subtitle">{done.reference}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t.clubOffers.showAtStore}</ThemedText>
        </Card>
      ) : (
        <Button label={t.clubOffers.redeem} loading={busy} onPress={() => void redeem()} />
      )}
    </FormScreen>
  );
}

/** What this account has redeemed, with the reference to show at the store. */
export function ClubRedemptions({ kind }: { kind: ClubOffersKind }) {
  const theme = useTheme();
  const { t, format, formatDate } = useTranslations();
  const [api] = useState(() => clubOffersApi(kind));
  const fetchPage = useCallback((cursor: string | null) => api.mine(cursor), [api]);
  const list = usePaged<Redemption>(fetchPage, []);

  if (list.loading) return <Loading />;
  return (
    <FlashList
      style={{ backgroundColor: theme.background }}
      data={list.items}
      keyExtractor={(r) => r.id}
      onEndReached={list.loadMore}
      refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => list.reload(true)} />}
      ListEmptyComponent={<ThemedText themeColor="textSecondary" style={{ padding: Spacing.four, textAlign: 'center' }}>{t.clubOffers.noRedemptions}</ThemedText>}
      renderItem={({ item }) => (
        <View style={{ paddingHorizontal: Spacing.three, paddingTop: Spacing.two }}>
          <Card>
            <ThemedText type="smallBold">{item.offerTitle}</ThemedText>
            {item.merchantName ? <ThemedText type="small" themeColor="textSecondary">{item.merchantName}</ThemedText> : null}
            <ThemedText type="small" themeColor="textSecondary">{format(t.clubOffers.redeemedOn, { date: formatDate(item.redeemedAt, true) })}</ThemedText>
            <ThemedText type="subtitle">{item.reference}</ThemedText>
          </Card>
        </View>
      )}
    />
  );
}
