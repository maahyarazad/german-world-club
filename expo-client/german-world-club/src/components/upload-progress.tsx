import { View, StyleSheet } from 'react-native';

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
 */
export function UploadProgress({ state, label, onRetry, onCancel }: {
  state: MediaUploadState;
  /** What is being uploaded; becomes the bar's accessible name. */
  label: string;
  onRetry?: () => void;
  onCancel?: () => void;
}) {
  const themed = useThemedStyles(makeStyles);
  const { t, format } = useTranslations();
  if (state.phase === 'idle') return null;

  if (state.phase === 'failed') {
    return (
      <View style={styles.gapTwo}>
        <Message text={t.upload.failed} />
        {onRetry ? <Button label={t.upload.retry} variant="secondary" onPress={onRetry} /> : null}
      </View>
    );
  }

  const fraction = state.phase === 'uploading' ? state.fraction : null;
  const percent = Math.round((fraction ?? 0) * 100);
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
