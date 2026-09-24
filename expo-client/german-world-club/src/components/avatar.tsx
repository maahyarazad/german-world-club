import { Image } from 'expo-image';
import { View } from 'react-native';

import type { ThreadAuthor } from '@gwc/contracts/threads';

import { imageUrl } from '@/components/media-carousel';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

/** A round avatar, or the initial when there is none. */
export function Avatar({ author, size = 36, label }: {
  author: Pick<ThreadAuthor, 'displayName' | 'handle' | 'avatar'>; size?: number; label: string
}) {
  const theme = useTheme();
  if (author.avatar) {
    return <Image source={imageUrl(author.avatar, size * 3)} accessibilityLabel={label}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.backgroundElement }} />;
  }
  const initial = (author.displayName ?? author.handle ?? '?').trim().charAt(0).toUpperCase();
  return (
    <View accessible={false} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.tint, alignItems: 'center', justifyContent: 'center' }}>
      <ThemedText style={{ color: theme.background, fontWeight: '600', fontSize: size * 0.42 }}>{initial}</ThemedText>
    </View>
  );
}
