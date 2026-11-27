import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import type { MediaItem } from '@gwc/contracts/media';
import { OFFER_MEDIA_ASPECT } from '@gwc/contracts/offers';

import { imageUrl } from '@/components/media-carousel';
import { useTranslations } from '@/i18n';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

/**
 * An offer's picture in the club's 16:9 frame (feature 042, US2).
 *
 * `item` is what the server sent: `null` (a list card) or no item means the offer
 * has no usable media. The server says so on purpose instead of sending a
 * stand-in (Principle III), so what to draw instead is this component's only
 * decision: the club's fallback, which is bundled with the app, so it appears
 * at once and offline. A picture that fails to load gets the fallback too,
 * instead of an empty box.
 *
 * The ratio is the shared contract's (`OFFER_MEDIA_ASPECT`), the same number the
 * web client uses.
 */

const FALLBACK = require('../../assets/offer-fallback.webp');

/** width / height of the offer frame, for the gallery's own sizing. */
export const OFFER_ASPECT_RATIO = OFFER_MEDIA_ASPECT.width / OFFER_MEDIA_ASPECT.height;

/**
 * Whether the item has anything to draw. `imageUrl()` cannot tell us: for an item
 * with no variants and no poster it still returns the API origin, a non-empty
 * string that is not a picture.
 */
function hasPicture(item: MediaItem) {
  return item.variants.some((v) => v.format !== 'webm') || Boolean(item.posterUrl);
}

export function OfferPicture({ item, width = 640, recyclingKey }: {
  item: MediaItem | null | undefined;
  /** The smallest variant at least this wide (in pixels) is used. */
  width?: number;
  /** In a recycling list: a changed key blanks the cell instead of flashing the previous offer's picture. */
  recyclingKey?: string;
}) {
  const themed = useThemedStyles(makeStyles);
  const { t } = useTranslations();
  // Remembered per asset, so a recycled card showing another offer is tried afresh.
  const [failedAsset, setFailedAsset] = useState<string | null>(null);

  const own = item && hasPicture(item) && failedAsset !== item.assetId ? item : null;

  return (
    <Image
      source={own ? { uri: imageUrl(own, width) } : FALLBACK}
      accessibilityLabel={own ? own.alt : t.clubOffers.fallbackAlt}
      contentFit="cover"
      recyclingKey={recyclingKey}
      onError={() => { if (item) setFailedAsset(item.assetId); }}
      style={themed.frame}
    />
  );
}

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    frame: { width: '100%', aspectRatio: OFFER_ASPECT_RATIO, borderRadius: 8, backgroundColor: theme.backgroundElement },
  });
