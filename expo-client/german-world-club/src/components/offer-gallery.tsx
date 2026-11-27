import { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import type { MediaItem } from '@gwc/contracts/media';

import { MediaSlide } from '@/components/media-carousel';
import { OFFER_ASPECT_RATIO, OfferPicture } from '@/components/offer-picture';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

/**
 * An offer's images and videos, one 16:9 slide at a time (feature 042, US1).
 *
 * **It is exactly as wide as the column it sits in.** It measures its own container
 * (`onLayout`) and never subtracts a guessed inset from the window width: that is what
 * made the old offer media (`MediaCarousel`) a different width from the cards below it,
 * because the screen pads its content by one amount and the carousel assumed another,
 * and a tablet's window is wider than the content column. The same measurement also
 * fixes a rotation, where `onLayout` fires again.
 *
 * Paging is a horizontal `ScrollView` with `pagingEnabled`: at most ten items, so
 * virtualising buys nothing, and FlashList's own `pagingEnabled` is not documented.
 * `MediaCarousel` is left alone: Threads, quote embeds, listing detail and the store
 * gallery depend on its native aspect ratios.
 *
 * No media shows the club's fallback in the same frame, with no dots. One item shows
 * no dots either. A video is `MediaSlide`'s: still picture until tapped, muted, one
 * player per slide, and `active` stops it when its slide is left.
 */
export function OfferGallery({ media }: { media: readonly MediaItem[] }) {
  const themed = useThemedStyles(makeStyles);
  const { t, format } = useTranslations();
  const scroller = useRef<ScrollView>(null);
  const pageRef = useRef(0);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);

  const height = Math.round(width / OFFER_ASPECT_RATIO);
  const sized = useMemo(() => makeSized(width, height), [width, height]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setWidth(next);
    // After a rotation the scroll offset is still in the old pixels: put the page back.
    if (next > 0) requestAnimationFrame(() => scroller.current?.scrollTo({ x: pageRef.current * next, animated: false }));
  }, []);

  const onMomentumEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width === 0) return;
    const next = Math.max(0, Math.min(media.length - 1, Math.round(event.nativeEvent.contentOffset.x / width)));
    pageRef.current = next;
    setPage(next);
  }, [width, media.length]);

  if (media.length === 0) return <OfferPicture item={null} />;

  const paged = media.length > 1;
  return (
    <View onLayout={onLayout} style={themed.container}>
      {width > 0 ? (
        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumEnd}
          style={sized.scroller}
        >
          {media.map((item, index) => (
            <View key={item.assetId} style={sized.page}>
              <MediaSlide item={item} width={width} height={height} active={index === page} />
            </View>
          ))}
        </ScrollView>
      ) : (
        // Until the width is known: an empty frame in the right shape, so nothing jumps.
        <View style={themed.placeholder} />
      )}
      {paged ? (
        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel={format(t.clubOffers.gallery.position, { n: page + 1, total: media.length })}
          style={themed.dots}
        >
          {media.map((item, index) => (
            <View key={item.assetId} style={[themed.dot, index === page && themed.dotActive]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    container: { width: '100%', gap: Spacing.two },
    placeholder: { width: '100%', aspectRatio: OFFER_ASPECT_RATIO, borderRadius: 12, backgroundColor: theme.backgroundElement },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.two },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.backgroundSelected },
    dotActive: { backgroundColor: theme.tint },
  });

const makeSized = (width: number, height: number) =>
  StyleSheet.create({
    scroller: { width, height, borderRadius: 12 },
    page: { width, height },
  });
