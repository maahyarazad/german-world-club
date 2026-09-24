import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { MemberOffer } from '@gwc/contracts/offers';

import { offersApi } from '@/api/endpoints';
import { imageUrl } from '@/components/media-carousel';
import { ThemedText } from '@/components/themed-text';
import { Card, Centered, FormScreen, Loading, Message } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';

/**
 * One member offer — where an offer notification lands (feature 011, US2/US4).
 *
 * Minimal on purpose: there is no offer list in the app yet, only the screen a
 * deep link needs. The server answers 404 for anything not published and
 * currently valid, and that answer is shown as "no longer available", the same
 * state an event that has gone away shows.
 */
export default function OfferScreen() {
  const { t, format, formatDate, formatMoney, problemMessage } = useTranslations();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [offer, setOffer] = useState<MemberOffer | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    offersApi.detail(id).then(setOffer, setError);
  }, [id]);

  if (error && !offer) return <Centered><Message text={problemMessage(error)} /></Centered>;
  if (!offer) return <Loading />;

  const money = (cents: number | null) => (cents === null ? null : formatMoney(cents, offer.currency));
  const benefit = (() => {
    const { kind, value } = offer.benefit;
    if (kind === 'percentage' && value !== null) return format(t.offer.percentage, { value });
    if (kind === 'fixed_amount' && value !== null) return format(t.offer.fixedAmount, { value: formatMoney(Math.round(value * 100), offer.currency) });
    if (kind === 'value_add') return t.offer.valueAdd;
    return money(offer.memberPriceCents);
  })();

  return (
    <FormScreen title={offer.title}>
      <Stack.Screen options={{ title: '' }} />
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push({ pathname: '/(member)/threads/organisation/[slug]', params: { slug: offer.merchant.slug } })}
        style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
        {offer.merchant.logo ? (
          <Image source={{ uri: imageUrl(offer.merchant.logo, 96) }} style={{ width: 40, height: 40, borderRadius: 8 }}
            accessibilityLabel={offer.merchant.logo.alt} />
        ) : null}
        <View>
          <ThemedText type="small" themeColor="textSecondary">{t.offer.merchant}</ThemedText>
          <ThemedText type="smallBold">{offer.merchant.displayName}</ThemedText>
        </View>
      </Pressable>

      {benefit ? (
        <Card>
          <ThemedText type="smallBold">{t.offer.benefit}</ThemedText>
          <ThemedText type="subtitle">{benefit}</ThemedText>
          {offer.regularPriceCents !== null ? (
            <ThemedText themeColor="textSecondary">{t.offer.regularPrice}: {money(offer.regularPriceCents)}</ThemedText>
          ) : null}
          {offer.memberPriceCents !== null ? (
            <ThemedText>{t.offer.memberPrice}: {money(offer.memberPriceCents)}</ThemedText>
          ) : null}
        </Card>
      ) : null}

      {offer.description ? <ThemedText>{offer.description}</ThemedText> : null}
      <ThemedText type="small" themeColor="textSecondary">
        {format(t.offer.valid, { from: formatDate(offer.validFrom), until: formatDate(offer.validUntil) })}
      </ThemedText>
      {offer.conditions ? (
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold">{t.offer.conditions}</ThemedText>
          <ThemedText>{offer.conditions}</ThemedText>
        </View>
      ) : null}
    </FormScreen>
  );
}
