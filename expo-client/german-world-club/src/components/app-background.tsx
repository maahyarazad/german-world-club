import { Image } from 'expo-image';
import { useMemo } from 'react';
import { StyleSheet, View, useColorScheme } from 'react-native';

import { BackdropScrim } from '@/constants/theme';

/**
 * The club's backdrop, drawn once behind the whole navigator so every screen shows
 * it (the screens themselves are transparent). `main-bg-phone.png` is a 1170 px
 * wide copy of `main-bg.png`: the original is 4875x10550, and decoding that on a
 * phone costs hundreds of megabytes for no visible gain.
 *
 * The art is one mid-grey in both colour schemes, so a scrim keeps the theme's
 * text readable on it: dark over it at night, a pale wash by day.
 */
export function AppBackground() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const scrim = useMemo(() => makeScrim(BackdropScrim[scheme]), [scheme]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image
        source={require('../../assets/main-bg-phone.png')}
        contentFit="cover"
        contentPosition="top"
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, scrim.wash]} />
    </View>
  );
}

const makeScrim = (backgroundColor: string) => StyleSheet.create({ wash: { backgroundColor } });
