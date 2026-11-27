import { Image } from 'expo-image';
import { useMemo } from 'react';
import { StyleSheet, View, useColorScheme } from 'react-native';

import { BackdropScrim } from '@/constants/theme';

/**
 * One copy per colour scheme (feature 043, research R12): cream with gold lines by day,
 * slate with yellow lines by night. Metro needs literal paths, hence an object rather than
 * a computed name.
 *
 * Both are 1170 px wide, made from the supplied art (`main-bg-light-01.png` and
 * `main-bg-dark-01.png`, 4875x10550 each). Never load those: decoding one costs about
 * 205 MB of pixels on a phone for no visible gain, and client/tests/assets/expo-backdrop.test.ts
 * fails the build for it. Both copies are bundled but only the one shown is decoded.
 */
const BACKDROPS = {
  light: require('../../assets/main-bg-light-phone.png'),
  dark: require('../../assets/main-bg-dark-phone.png'),
} as const;

/**
 * The club's backdrop, drawn once behind the whole navigator so every screen shows
 * it (the screens themselves are transparent). It follows the phone's light or dark
 * setting, and changes while the app is open: `useColorScheme` re-renders this when
 * the person switches, with no restart and no navigation. There is no in-app switch,
 * and an unspecified scheme is light, as in `useTheme`.
 *
 * The wash over it (`BackdropScrim`) is none by day and a darkening one by night,
 * because that is what keeps the theme's text readable on each (measured, R13).
 */
export function AppBackground() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const scrim = useMemo(() => makeScrim(BackdropScrim[scheme]), [scheme]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image
        source={BACKDROPS[scheme]}
        contentFit="cover"
        contentPosition="top"
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, scrim.wash]} />
    </View>
  );
}

const makeScrim = (backgroundColor: string) => StyleSheet.create({ wash: { backgroundColor } });
