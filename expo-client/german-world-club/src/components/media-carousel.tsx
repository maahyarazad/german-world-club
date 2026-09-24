import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import type { MediaItem } from '@gwc/contracts/media';

import { API_URL } from '@/config';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

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

function VideoItem({ item, width, height }: { item: MediaItem; width: number; height: number }) {
  const { t } = useTranslations();
  const [playing, setPlaying] = useState(false);
  const source = item.variants.find((v) => v.variant === 'video');
  const player = useVideoPlayer(playing && source ? mediaUrl(source.url) : null, (p) => {
    p.muted = true;
    p.play();
  });
  if (playing && source) {
    return <VideoView player={player} nativeControls contentFit="cover" style={{ width, height, borderRadius: 12 }} />;
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t.threads.playVideo} onPress={() => setPlaying(true)}>
      <Image source={item.posterUrl ? mediaUrl(item.posterUrl) : undefined} accessibilityLabel={item.alt}
        style={{ width, height, borderRadius: 12 }} contentFit="cover" />
      <View style={styles.play} pointerEvents="none">
        <ThemedText style={styles.playIcon}>▶</ThemedText>
      </View>
    </Pressable>
  );
}

function Item({ item, width, height }: { item: MediaItem; width: number; height: number }) {
  if (item.kind === 'video') return <VideoItem item={item} width={width} height={height} />;
  return (
    <Image
      source={imageUrl(item, width * 2)}
      accessibilityLabel={item.alt}
      style={{ width, height, borderRadius: 12 }}
      contentFit="cover"
      transition={120}
    />
  );
}

export function MediaCarousel({ media, inset = Spacing.three * 2 }: { media: readonly MediaItem[]; inset?: number }) {
  const theme = useTheme();
  const { width: screen } = useWindowDimensions();
  if (media.length === 0) return null;
  const full = Math.min(screen - inset, 560);

  if (media.length === 1) {
    const item = media[0]!;
    const height = Math.min(full * (item.height / item.width), 480);
    return <View style={{ backgroundColor: theme.backgroundElement, borderRadius: 12 }}><Item item={item} width={full} height={height} /></View>;
  }
  const cell = Math.round(full * 0.72);
  return (
    <FlatList
      horizontal
      data={media as MediaItem[]}
      keyExtractor={(m) => m.assetId}
      showsHorizontalScrollIndicator={false}
      snapToInterval={cell + Spacing.one}
      decelerationRate="fast"
      ItemSeparatorComponent={() => <View style={{ width: Spacing.one }} />}
      renderItem={({ item }) => <Item item={item} width={cell} height={Math.round(cell * 1.25)} />}
    />
  );
}

const styles = StyleSheet.create({
  play: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  playIcon: { fontSize: 28, color: '#fff' },
});
