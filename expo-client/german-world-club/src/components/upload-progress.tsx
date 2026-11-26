import { View, StyleSheet } from 'react-native';

import { Spinner } from '@/components/spinner';
import { ThemedText } from '@/components/themed-text';
import { Button, Message } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import type { MediaUploadState } from '@/hooks/use-media-upload';
import { useTranslations } from '@/i18n';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

/**
 * Where an upload has got to, shown to the person (feature 035): a bar for the
 * bytes going up, "processing" while the server works, or the note that it did
 * not work with a retry. Renders nothing while idle. The same two phases, and
 * the same words, as the web console.
 *
 * `variant="spinner"` (feature 037) is the club's generic loader with the whole
 * number beside it, for the member screens that upload a photo or two: a
 * listing's photos, the avatar, Threads media. The merchant screens keep the bar.
 * With several files it also says which one is going up.
 */
export function UploadProgress({ state, label, onRetry, onCancel, variant = 'bar' }: {
  state: MediaUploadState;
  /** What is being uploaded; becomes the bar's accessible name. */
  label: string;
  onRetry?: () => void;
  onCancel?: () => void;
  variant?: 'bar' | 'spinner';
}) {
  const themed = useThemedStyles(makeStyles);
  const { t, format } = useTranslations();
  if (state.phase === 'idle') return null;

  if (state.phase === 'failed') {
    // A file of a kind the club does not accept cannot succeed on a second try,
    // so it is named for what it is and Retry is not offered (feature 037, FR-027).
    const unsupported = state.reason === 'unsupported-format';
    return (
      <View style={styles.gapTwo}>
        <Message text={unsupported ? t.upload.unsupportedFormat : t.upload.failed} />
        {onRetry && !unsupported ? <Button label={t.upload.retry} variant="secondary" onPress={onRetry} /> : null}
      </View>
    );
  }

  const fraction = state.phase === 'uploading' ? state.fraction : null;
  const percent = Math.round((fraction ?? 0) * 100);
  const slot = 'slot' in state ? state.slot : undefined;

  if (variant === 'spinner') {
    return (
      <View
        style={styles.gapOne}
        accessibilityLiveRegion="polite"
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityValue={fraction === null ? undefined : { min: 0, max: 100, now: percent }}>
        <View style={styles.rowCenter}>
          <Spinner size="md" />
          <View style={styles.gapOne}>
            <ThemedText type="smallBold">
              {state.phase === 'processing' ? t.upload.processing : fraction === null ? t.upload.uploading.replace(' {percent}', '') : format(t.upload.uploading, { percent: `${percent} %` })}
            </ThemedText>
            {slot && slot[1] > 1 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {format(t.upload.fileOf, { n: String(slot[0] + 1), total: String(slot[1]) })}
              </ThemedText>
            ) : null}
          </View>
        </View>
        {onCancel && state.phase === 'uploading' ? <Button label={t.upload.cancel} variant="secondary" onPress={onCancel} /> : null}
      </View>
    );
  }
  const bar = makeBar(fraction === null ? '100%' : `${percent}%`, fraction === null ? 0.4 : 1);
  return (
    <View style={styles.gapOne} accessibilityLiveRegion="polite">
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityValue={fraction === null ? undefined : { min: 0, max: 100, now: percent }}
        style={themed.viewHeight84}>
        {/* Indeterminate (a full, faint bar) while the server processes or the size is unknown. */}
        <View style={[themed.height8BgTint, bar.fill]} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {state.phase === 'processing' ? t.upload.processing : format(t.upload.uploading, { percent: `${percent} %` })}
      </ThemedText>
      {onCancel && state.phase === 'uploading' ? <Button label={t.upload.cancel} variant="secondary" onPress={onCancel} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gapTwo: { gap: Spacing.two },
  gapOne: { gap: Spacing.one },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    viewHeight84: { height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: theme.backgroundSelected },
    height8BgTint: { height: 8, backgroundColor: theme.tint },
  });

/** The bar's fill: its width and opacity are the upload's progress, so they are made per render of the bar. */
const makeBar = (width: `${number}%`, opacity: number) =>
  StyleSheet.create({
    fill: { width, opacity },
  });
