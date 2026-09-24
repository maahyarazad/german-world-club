import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { Listing } from '@gwc/contracts/marketplace';
import type { MediaItem } from '@gwc/contracts/media';

import { marketplaceApi } from '@/api/endpoints';
import { MediaCarousel } from '@/components/media-carousel';
import { ThemedText } from '@/components/themed-text';
import { Centered, FormScreen, Loading, Message } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';

/**
 * A marketplace listing, read-only — where a listing notification lands
 * (feature 011, US2). No edit or contact actions in this feature; the
 * marketplace itself is not in the app yet. A listing that is gone, hidden or
 * not the member's to see answers 404, shown as "no longer available".
 */
export default function ListingScreen() {
  const { t, format, formatMoney, problemMessage } = useTranslations();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    marketplaceApi.listing(id).then(setListing, setError);
  }, [id]);

  if (error && !listing) return <Centered><Message text={problemMessage(error)} /></Centered>;
  if (!listing) return <Loading />;

  // The server sends each listing photo as a delivered MediaItem (derivatives
  // only), while `Listing.media` in @gwc/contracts still names the older
  // ListingMedia shape. The cast is the one place that drift is crossed; the
  // contract should be corrected rather than a local type declared here.
  const media = listing.media as unknown as readonly MediaItem[];
  const priceMinor = listing.details.price_minor;
  const currency = listing.details.currency;
  const price = typeof priceMinor === 'number' && typeof currency === 'string' ? formatMoney(priceMinor, currency) : null;

  return (
    <FormScreen title={listing.title}>
      <Stack.Screen options={{ title: '' }} />
      {media.length > 0 ? <MediaCarousel media={media} /> : null}
      {price ? (
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold">{t.listing.price}</ThemedText>
          <ThemedText type="subtitle">{price}</ThemedText>
        </View>
      ) : null}
      <ThemedText>{listing.body}</ThemedText>
      {listing.owner?.displayName ? (
        <ThemedText type="small" themeColor="textSecondary">{format(t.listing.by, { name: listing.owner.displayName })}</ThemedText>
      ) : null}
    </FormScreen>
  );
}
