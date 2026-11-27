import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useMemo, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import type { MediaItem } from '@gwc/contracts/media';

import { API_URL } from '@/config';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

/**
 * A post's photos and videos (feature 010, US1).
 *
 * The server sends derivatives only, as paths; the app prefixes its API
 * origin. Every item keeps the source's aspect ratio, so the list does not
 * jump as images decode. A video shows its poster until tapped and then plays
 * MUTED: nothing in a feed makes sound on its own (FR-004).
 */

export const mediaUrl = (path: string) => (path.startsWith('http') ? path : `${API_URL}${path}`);

/** The smallest image variant at least `width` pixels wide, else the largest. */
export function imageUrl(item: MediaItem, width: number) {
  const images = item.variants.filter((v) => v.format !== 'webm');
  const pick = images.find((v) => v.width >= width) ?? images[images.length - 1];
  return mediaUrl(pick?.url ?? item.posterUrl ?? '');
}

function VideoItem({ item, width, height, active = true }: { item: MediaItem; width: number; height: number; active?: boolean }) {
  const { t } = useTranslations();
  const sized = useMemo(() => makeSized(width, height), [width, height]);
  const [playing, setPlaying] = useState(false);
  // A slide that is no longer the visible one stops its video, and does not resume by itself
  // when it is swiped back to (feature 042). Adjusted while rendering rather than in an effect.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setPlaying(false);
  }
  const source = item.variants.find((v) => v.variant === 'video');
  const player = useVideoPlayer(playing && source ? mediaUrl(source.url) : null, (p) => {
    p.muted = true;
    p.play();
  });
  if (playing && source) {
    return <VideoView player={player} nativeControls contentFit="cover" style={sized.box} />;
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t.threads.playVideo} onPress={() => setPlaying(true)}>
      <Image source={item.posterUrl ? mediaUrl(item.posterUrl) : undefined} accessibilityLabel={item.alt}
        style={sized.box} contentFit="cover" />
      <View style={styles.play} pointerEvents="none">
        <ThemedText style={styles.playIcon}>▶</ThemedText>
      </View>
    </Pressable>
  );
}

/**
 * One photo or video at a given size. Exported for the offer gallery
 * (`offer-gallery.tsx`), so poster-until-tapped, muted playback and the recycled-cell key
 * have one implementation. `active` (default true) is false for a slide that is not the
 * visible one, which stops a playing video.
 */
export function MediaSlide({ item, width, height, active = true }: { item: MediaItem; width: number; height: number; active?: boolean }) {
  const sized = useMemo(() => makeSized(width, height), [width, height]);
  // key: a recycled carousel cell must not keep the previous video playing.
  if (item.kind === 'video') return <VideoItem key={item.assetId} item={item} width={width} height={height} active={active} />;
  return (
    <Image
      source={imageUrl(item, width * 2)}
      accessibilityLabel={item.alt}
      style={sized.box}
      contentFit="cover"
      transition={120}
    />
  );
}

export function MediaCarousel({ media, inset = Spacing.three * 2 }: { media: readonly MediaItem[]; inset?: number }) {
  const themed = useThemedStyles(makeStyles);
  const { width: screen } = useWindowDimensions();
  if (media.length === 0) return null;
  const full = Math.min(screen - inset, 560);

  if (media.length === 1) {
    const item = media[0]!;
    const height = Math.min(full * (item.height / item.width), 480);
    return <View style={themed.bgBackgroundElementRadius12}><MediaSlide item={item} width={full} height={height} /></View>;
  }
  return <Strip media={media} cell={Math.round(full * 0.72)} />;
}

/** The scrolling row of several items. Its own component so its height can be a sheet made from `cell`. */
function Strip({ media, cell }: { media: readonly MediaItem[]; cell: number }) {
  const height = Math.round(cell * 1.25);
  const sized = useMemo(() => makeStrip(height), [height]);
  return (
    // A horizontal FlashList takes its height from the container, so it is given the tallest cell's.
    <View style={sized.row}>
      <FlashList
        horizontal
        data={media as MediaItem[]}
        keyExtractor={(m) => m.assetId}
        showsHorizontalScrollIndicator={false}
        snapToInterval={cell + Spacing.one}
        decelerationRate="fast"
        ItemSeparatorComponent={() => <View style={styles.widthOne} />}
        renderItem={({ item }) => <MediaSlide item={item} width={cell} height={height} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  play: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  playIcon: { fontSize: 28, color: '#fff' },
  radius12: { borderRadius: 12 },
  widthOne: { width: Spacing.one },
});

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    bgBackgroundElementRadius12: { backgroundColor: theme.backgroundElement, borderRadius: 12 },
  });

/**
 * A full-width, rounded image that keeps the file's own aspect ratio (a merchant's
 * gallery photo, an offer's thumbnail). The ratio is data, so the style is made per
 * ratio instead of being written inline in a list.
 */
export function WideImage({ item, width = 400 }: { item: MediaItem; width?: number }) {
  const ratio = useMemo(() => makeRatio(item.width / item.height), [item.width, item.height]);
  return <Image source={{ uri: imageUrl(item, width) }} accessibilityLabel={item.alt} style={ratio.image} />;
}

const makeRatio = (aspectRatio: number) =>
  StyleSheet.create({
    image: { width: '100%', borderRadius: 8, aspectRatio },
  });

const makeSized = (width: number, height: number) =>
  StyleSheet.create({
    box: { width, height, borderRadius: 12 },
  });

const makeStrip = (height: number) =>
  StyleSheet.create({
    row: { height },
  });
