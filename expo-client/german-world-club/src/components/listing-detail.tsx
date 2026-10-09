import { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { Listing } from '@gwc/contracts/marketplace';
import type { MediaItem } from '@gwc/contracts/media';

import { ApiError } from '@/api/client';
import { marketplaceApi } from '@/api/endpoints';
import { MediaCarousel } from '@/components/media-carousel';
import { ThemedText } from '@/components/themed-text';
import { FormScreen, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';

/**
 * A marketplace listing, read-only. Rendered by two stacks — the Marketplace
 * tab (feature 017) and Activity, where a listing notification lands (feature
 * 011) — because native tabs cannot share a screen, and a second copy of this
 * would drift. No edit or contact actions: messaging is not in the app yet.
 * A listing that is gone, hidden or not the member's to see answers 404 and
 * stays on the spinner rather than showing a stale copy.
 */
export function ListingDetail({ id }: { id: string }) {
  const { t, format, formatMoney } = useTranslations();
  const [listing, setListing] = useState<Listing | null>(null);

  useEffect(() => {
    marketplaceApi.listing(id).then(setListing, (e) => console.error('ListingDetail.load', e instanceof ApiError ? e.problem : e));
  }, [id]);

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
