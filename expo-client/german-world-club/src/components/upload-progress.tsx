import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Message } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import type { MediaUploadState } from '@/hooks/use-media-upload';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

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
  const theme = useTheme();
  const { t, format } = useTranslations();
  if (state.phase === 'idle') return null;

  if (state.phase === 'failed') {
    return (
      <View style={{ gap: Spacing.two }}>
        <Message text={t.upload.failed} />
        {onRetry ? <Button label={t.upload.retry} variant="secondary" onPress={onRetry} /> : null}
      </View>
    );
  }

  const fraction = state.phase === 'uploading' ? state.fraction : null;
  const percent = Math.round((fraction ?? 0) * 100);
  return (
    <View style={{ gap: Spacing.one }} accessibilityLiveRegion="polite">
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityValue={fraction === null ? undefined : { min: 0, max: 100, now: percent }}
        style={{ height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: theme.backgroundSelected }}>
        {/* Indeterminate (a full, faint bar) while the server processes or the size is unknown. */}
        <View style={{ height: 8, width: fraction === null ? '100%' : `${percent}%`, backgroundColor: theme.tint, opacity: fraction === null ? 0.4 : 1 }} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {state.phase === 'processing' ? t.upload.processing : format(t.upload.uploading, { percent: `${percent} %` })}
      </ThemedText>
      {onCancel && state.phase === 'uploading' ? <Button label={t.upload.cancel} variant="secondary" onPress={onCancel} /> : null}
    </View>
  );
}
