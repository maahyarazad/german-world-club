import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * The club's loader (feature 030), the same figure as the web's `Spinner` and as
 * `main-loader.html`: a faint full ring with one arc turning on it.
 *
 * Built from `View` borders and `Animated`, not `react-native-svg`: that is a
 * native module, and adding one means a new EAS build (CLAUDE.md), which this
 * feature must not need. The ring is a static view at a quarter opacity; the arc
 * is a second view with only its top border coloured, turned by the native
 * driver so it never waits on the JS thread.
 *
 * Under the OS's reduce-motion setting nothing turns: the ring and the still arc
 * still read as a loader. It is hidden from accessibility on purpose — the
 * label belongs to `ScreenLoader` and `Button`, so a screen reader hears it once.
 */
export const SPINNER_SIZES = { xs: 14, sm: 20, md: 32, lg: 48 } as const;
export type SpinnerSize = keyof typeof SPINNER_SIZES;

/** True while the user has asked the OS to reduce motion; follows changes live. */
function useReduceMotion(): boolean {
    const [reduce, setReduce] = useState(false);
    useEffect(() => {
        let alive = true;
        AccessibilityInfo.isReduceMotionEnabled().then((on) => { if (alive) setReduce(on); }).catch(() => undefined);
        const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
        return () => { alive = false; subscription.remove(); };
    }, []);
    return reduce;
}

export function Spinner({ size = 'md', color }: { size?: SpinnerSize; color?: string }) {
    const theme = useTheme();
    const tint = color ?? theme.tint;
    const px = SPINNER_SIZES[size];
    const width = Math.max(2, px / 8);
    const reduce = useReduceMotion();
    const turn = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (reduce) {
            turn.setValue(0);
            return undefined;
        }
        const loop = Animated.loop(
            Animated.timing(turn, { toValue: 1, duration: 750, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }),
        );
        loop.start();
        return () => loop.stop();
    }, [reduce, turn]);

    const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
    const ring = { width: px, height: px, borderRadius: px / 2, borderWidth: width };

    return (
        <View
            style={{ width: px, height: px }}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
        >
            <View style={[StyleSheet.absoluteFill, ring, { borderColor: tint, opacity: 0.25 }]} />
            <Animated.View
                style={[StyleSheet.absoluteFill, ring, { borderColor: 'transparent', borderTopColor: tint, transform: [{ rotate }] }]}
            />
        </View>
    );
}
