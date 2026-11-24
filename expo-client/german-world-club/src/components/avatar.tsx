import { Image } from 'expo-image';
import { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';

import type { ThreadAuthor } from '@gwc/contracts/threads';

import { imageUrl } from '@/components/media-carousel';
import { ThemedText } from '@/components/themed-text';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

/** A round avatar, or the initial when there is none. */
export function Avatar({ author, size = 36, label }: {
  author: Pick<ThreadAuthor, 'displayName' | 'handle' | 'avatar'>; size?: number; label: string
}) {
  const themed = useThemedStyles(makeStyles);
  // The size is a prop, so these styles are made per size (and only when it changes).
  const sized = useMemo(() => makeSized(size), [size]);
  if (author.avatar) {
    return <Image source={imageUrl(author.avatar, size * 3)} accessibilityLabel={label}
      style={[themed.bgBackgroundElement, sized.circle]} />;
  }
  const initial = (author.displayName ?? author.handle ?? '?').trim().charAt(0).toUpperCase();
  return (
    <View accessible={false} style={[themed.bgTintItemsCenterJustifyCenter, sized.circle]}>
      <ThemedText style={[themed.colorBackgroundWeight600, sized.initial]}>{initial}</ThemedText>
    </View>
  );
}

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    bgBackgroundElement: { backgroundColor: theme.backgroundElement },
    bgTintItemsCenterJustifyCenter: { backgroundColor: theme.tint, alignItems: 'center', justifyContent: 'center' },
    colorBackgroundWeight600: { color: theme.background, fontWeight: '600' },
  });

const makeSized = (size: number) =>
  StyleSheet.create({
    circle: { width: size, height: size, borderRadius: size / 2 },
    initial: { fontSize: size * 0.42 },
  });
