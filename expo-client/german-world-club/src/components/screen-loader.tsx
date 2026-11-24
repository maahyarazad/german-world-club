import { Platform, StyleSheet, View } from 'react-native';

import { Spinner, type SpinnerSize } from '@/components/spinner';
import { useGrace } from '@/hooks/use-grace';
import { useTranslations } from '@/i18n';

/**
 * The loader for a whole screen or an area of one (feature 030): centred,
 * announced as a progress bar with a translated label, and silent for the first
 * `delayMs` so a fast response shows no flicker. Render it while the screen's data
 * is on its way and replace it with the content or the screen's own failure
 * state; it never decides about errors.
 */
export function ScreenLoader({ size = 'lg', label, delayMs = 150, flex = true }: {
    size?: SpinnerSize;
    label?: string;
    delayMs?: number;
    /** `false` for an in-place loader inside a list or card (no `flex: 1`, a little padding). */
    flex?: boolean;
}) {
    const { t } = useTranslations();
    const visible = useGrace(true, delayMs);
    if (!visible) return null;
    return (
        <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={label ?? t.common.loading}
            accessibilityLiveRegion={Platform.OS === 'android' ? 'polite' : undefined}
            style={flex ? styles.fill : styles.inline}
        >
            <Spinner size={size} />
        </View>
    );
}

const styles = StyleSheet.create({
    fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    inline: { alignItems: 'center', paddingVertical: 16 },
});
