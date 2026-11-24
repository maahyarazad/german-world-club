import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import type { MerchantOffer } from '@gwc/contracts/offers';

import { ApiError } from '@/api/client';
import { merchantApi } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, FormScreen, Loading, Message } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';

/**
 * A merchant's own offers (feature 035): every one, in any state, with publish
 * and withdraw. Publishing needs no approval and announces the offer to members
 * once. A refusal is logged to the console; the two a person cannot proceed
 * without understanding — no public name yet, a switched-off store — are shown
 * in words.
 */
export default function MyOffers() {
  const { t, formatDate } = useTranslations();
  const [offers, setOffers] = useState<MerchantOffer[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    merchantApi.offers().then((r) => setOffers(r.items), (e) => console.error('MyOffers.load', e instanceof ApiError ? e.problem : e));
  }, []));

  const act = async (offer: MerchantOffer, action: 'publish' | 'withdraw') => {
    setBusyId(offer.id);
    setMessage(null);
    try {
      const next = await merchantApi[action](offer.id);
      setOffers((current) => current?.map((o) => (o.id === next.id ? next : o)) ?? null);
    } catch (e) {
      console.error('MyOffers.act', e instanceof ApiError ? e.problem : e);
      const type = e instanceof ApiError ? e.type ?? '' : '';
      if (type.includes('profile-incomplete')) setMessage(t.merchant.offers.refusals.profileIncomplete);
      else if (type.includes('store-inactive')) setMessage(t.merchant.offers.refusals.storeInactive);
    } finally {
      setBusyId(null);
    }
  };

  if (!offers) return <Loading />;
  return (
    <FormScreen title={t.merchant.offers.title}>
      <Button label={t.merchant.offers.new} onPress={() => router.push({ pathname: '/my-offer/[id]' as never, params: { id: 'new' } })} />
      <Message text={message} />
      {offers.length === 0 ? <ThemedText themeColor="textSecondary">{t.merchant.offers.empty}</ThemedText> : null}
      {offers.map((offer) => (
        <Card key={offer.id}>
          <ThemedText type="smallBold">{offer.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t.merchant.offers.kinds[offer.benefit.kind]} · {formatDate(offer.validFrom)} – {formatDate(offer.validUntil)}
          </ThemedText>
          <ThemedText type="small">{t.merchant.offers.states[offer.state]}</ThemedText>
          <View style={{ gap: Spacing.two }}>
            <Button label={t.merchant.offers.edit} variant="secondary" onPress={() => router.push({ pathname: '/my-offer/[id]' as never, params: { id: offer.id } })} />
            {(offer.state === 'draft' || offer.state === 'withdrawn') ? (
              <Button label={t.merchant.offers.publish} loading={busyId === offer.id} onPress={() => void act(offer, 'publish')} />
            ) : null}
            {offer.state === 'published' ? (
              <Button label={t.merchant.offers.withdraw} variant="secondary" loading={busyId === offer.id} onPress={() => void act(offer, 'withdraw')} />
            ) : null}
          </View>
        </Card>
      ))}
    </FormScreen>
  );
}
