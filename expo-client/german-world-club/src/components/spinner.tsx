import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * The club's loader (features 030 and 038), the same figure as the web's
 * `Spinner` (`client/src/styles/spinner.css`, drawn from
 * `specs/038-themed-spinner/loading-spinner.html`): a faint ring with an arc that
 * grows and shrinks while it turns.
 *
 * The web draws that arc with a conic gradient whose two ends are animated. React
 * Native has no conic gradient and `react-native-svg` is a native module, so a new
 * EAS build (CLAUDE.md), which this must not need. The arc is built from views
 * and transforms instead, and every motion runs on the native driver:
 *
 *   - the arc covers `[0, L]` degrees of a frame, measured clockwise from the top.
 *     That frame is turned by the arc's tail `T`, so the arc ends up at `[T, T+L]`;
 *   - `L` is made from two half-rings. Each half owns half the circle (a clipping
 *     view with `overflow: hidden`) and holds a ring whose top and right borders are
 *     coloured, a 180° arc spanning `[r - 45, r + 135]` for a rotation `r`. The
 *     right half shows `[0, 180]` and the left `[180, 360]`, so turning each ring
 *     reveals more or less of its half. `r = L - 135` clipped to each half's range
 *     (see `RIGHT` and `LEFT`);
 *   - one value, `dash`, runs 0 to 1 over 3 s in two eased halves, exactly the
 *     sample's keyframes: tail 0, 100, 360 degrees; head 3, 358, 363 degrees; so the
 *     arc runs from a 3° dot to 258° and back. A second value turns the whole thing
 *     once every 1.5 s.
 *
 * The numbers were checked against the keyframes at 101 points: the arc covers
 * exactly `[0, L]` every time. No colour is written here: the arc is the theme's
 * tint (or the colour a caller passes) and the ring is a quarter-strength tint of
 * the same, as before.
 *
 * Under the OS's reduce-motion setting it turns slowly (6 s) with a fixed 158° arc
 * instead of stopping, as the sample does: a loader that stands still reads as
 * hung. It is hidden from accessibility on purpose; the label belongs to
 * `ScreenLoader` and `Button`, so a screen reader hears it once.
 */
export const SPINNER_SIZES = { xs: 14, sm: 20, md: 32, lg: 48 } as const;
export type SpinnerSize = keyof typeof SPINNER_SIZES;

/** The ring's thickness for each size, the same as the web's: 1/12 of the size, never under 2. */
export const SPINNER_THICKNESS = { xs: 2, sm: 2, md: 3, lg: 4 } as const;

const TURN_MS = 1500;
const TURN_REDUCED_MS = 6000;
const DASH_HALF_MS = 1500;
/** The arc length kept under reduced motion, the sample's own. */
const FIXED_ARC = 158;

// `L` (arc length) is 3° at the start of a cycle, 258° at its middle and 3° again at
// its end. It crosses 180° at these two points, which is where each half-ring
// changes from "growing" to "full" and back, so they are interpolation stops.
const CROSS_UP = 177 / 510;
const CROSS_DOWN = 333 / 510;
const STOPS = [0, CROSS_UP, 0.5, CROSS_DOWN, 1];
/**
 * The left half-ring has nothing to show while the arc is shorter than 180°, and
 * its coloured arc then sits exactly on the clip's edges, where anti-aliasing leaks
 * hairlines onto the ring. So it is not drawn at all until it is needed: opacity 0
 * outside `CROSS_UP..CROSS_DOWN`, with a ramp too short to see.
 */
const EDGE = 0.0005;
const LEFT_STOPS = [0, CROSS_UP, CROSS_UP + EDGE, CROSS_DOWN - EDGE, CROSS_DOWN, 1];
const LEFT_OPACITY = [0, 0, 1, 1, 0, 0];
/** Rotation (degrees) of the ring in the right half: `clamp(L, 0, 180) - 135`. */
const RIGHT = [-132, 45, 45, 45, -132];
/** Rotation of the ring in the left half: `clamp(L, 180, 360) - 135`. */
const LEFT = [45, 45, 123, 45, 45];
/** The arc's tail, which turns the frame the two halves sit in. */
const TAIL = [0, 100, 360];

const deg = (values: number[]) => values.map((v) => `${v}deg`);

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
    const reduce = useReduceMotion();
    // Lazy state, not a ref read during render: the values live as long as the component.
    const [turn] = useState(() => new Animated.Value(0));
    const [dash] = useState(() => new Animated.Value(0));
    const nativeDriver = Platform.OS !== 'web';

    useEffect(() => {
        turn.setValue(0);
        const turning = Animated.loop(
            Animated.timing(turn, {
                toValue: 1,
                duration: reduce ? TURN_REDUCED_MS : TURN_MS,
                easing: Easing.linear,
                useNativeDriver: nativeDriver,
            }),
        );
        turning.start();

        // `ease-in-out` is the sample's `cubic-bezier(.42, 0, .58, 1)`, applied to each
        // half of the cycle separately, as CSS applies it between keyframes.
        const ease = Easing.bezier(0.42, 0, 0.58, 1);
        dash.setValue(0);
        const dashing = reduce
            ? null
            : Animated.loop(
                  Animated.sequence([
                      Animated.timing(dash, { toValue: 0.5, duration: DASH_HALF_MS, easing: ease, useNativeDriver: nativeDriver }),
                      Animated.timing(dash, { toValue: 1, duration: DASH_HALF_MS, easing: ease, useNativeDriver: nativeDriver }),
                  ]),
              );
        dashing?.start();

        return () => {
            turning.stop();
            dashing?.stop();
        };
    }, [reduce, turn, dash, nativeDriver]);

    // Built once per value, not on every render: each `interpolate` is a node on the
    // native side.
    const motion = useMemo(
        () => ({
            turn: { transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] },
            tail: { transform: [{ rotate: dash.interpolate({ inputRange: [0, 0.5, 1], outputRange: deg(TAIL) }) }] },
            right: { transform: [{ rotate: dash.interpolate({ inputRange: STOPS, outputRange: deg(RIGHT) }) }] },
            left: {
                opacity: dash.interpolate({ inputRange: LEFT_STOPS, outputRange: LEFT_OPACITY }),
                transform: [{ rotate: dash.interpolate({ inputRange: STOPS, outputRange: deg(LEFT) }) }],
            },
        }),
        [turn, dash],
    );

    // Size, thickness and colour are props, so the sheet is made per set of them.
    const sized = useMemo(() => makeSized(px, SPINNER_THICKNESS[size], tint), [px, size, tint]);
    // Under reduced motion the arc keeps one length and does not move relative to the
    // frame: `FIXED_ARC` is 158°, so the right half's ring is turned `158 - 135 = 23°`
    // and the left half is not drawn.
    const still = useMemo(() => ({ right: { transform: [{ rotate: `${FIXED_ARC - 135}deg` }] } }), []);

    return (
        <View style={sized.box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Animated.View style={[sized.box, motion.turn]}>
                {/* The ring: always there, a quarter of the arc's strength. */}
                <View style={[StyleSheet.absoluteFill, sized.track]} />
                {/* The frame the arc is drawn in, turned by the arc's tail. */}
                <Animated.View style={[StyleSheet.absoluteFill, reduce ? undefined : motion.tail]}>
                    <View style={sized.clipRight}>
                        <Animated.View style={[sized.ringInRight, reduce ? still.right : motion.right]} />
                    </View>
                    {/* Under reduced motion the arc is under 180°, so the left half has nothing to draw. */}
                    {reduce ? null : (
                        <View style={sized.clipLeft}>
                            <Animated.View style={[sized.ringInLeft, motion.left]} />
                        </View>
                    )}
                </Animated.View>
            </Animated.View>
        </View>
    );
}

const makeSized = (px: number, thickness: number, tint: string) => {
    const half = px / 2;
    // A ring whose top and right borders are coloured: a 180° arc from -45° to 135°.
    const ring = {
        width: px,
        height: px,
        borderRadius: half,
        borderWidth: thickness,
        borderColor: 'transparent',
        borderTopColor: tint,
        borderRightColor: tint,
    } as const;
    return StyleSheet.create({
        box: { width: px, height: px },
        track: { borderRadius: half, borderWidth: thickness, borderColor: tint, opacity: 0.25 },
        // Each half is a clip of the circle; the ring inside is placed so its centre is the circle's.
        clipRight: { position: 'absolute', top: 0, left: half, width: half, height: px, overflow: 'hidden' },
        clipLeft: { position: 'absolute', top: 0, left: 0, width: half, height: px, overflow: 'hidden' },
        ringInRight: { ...ring, position: 'absolute', top: 0, left: -half },
        ringInLeft: { ...ring, position: 'absolute', top: 0, left: 0 },
    });
};
