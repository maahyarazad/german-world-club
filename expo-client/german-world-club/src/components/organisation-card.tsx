import { Image } from 'expo-image';
import { Linking, View, StyleSheet } from 'react-native';

import type { OrganisationPublicProfile } from '@gwc/contracts/profile';

import { imageUrl } from '@/components/media-carousel';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTranslations } from '@/i18n';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

/** An organisation's public profile: `organisation_profiles` only, never contract data. */
export function OrganisationCard({ org }: { org: OrganisationPublicProfile }) {
  const themed = useThemedStyles(makeStyles);
  const { t, format } = useTranslations();
  return (
    <View style={styles.gapTwo}>
      <View style={styles.rowItemsCenterGapThree}>
        {org.logo ? (
          <Image source={imageUrl(org.logo, 192)} accessibilityLabel={format(t.profile.avatarAlt, { name: org.displayName })}
            style={themed.imageWidth644} contentFit="contain" />
        ) : null}
        <View style={styles.flexShrink1}>
          <ThemedText type="subtitle">{org.displayName}</ThemedText>
          {org.city ? <ThemedText themeColor="textSecondary">{org.city}</ThemedText> : null}
        </View>
      </View>
      {org.about ? <ThemedText>{org.about}</ThemedText> : null}
      {org.website ? (
        <ThemedText style={themed.colorTint} accessibilityRole="link" onPress={() => void Linking.openURL(org.website!)}>
          {org.website.replace(/^https:\/\//, '')}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gapTwo: { gap: Spacing.two },
  rowItemsCenterGapThree: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  flexShrink1: { flexShrink: 1 },
});

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    imageWidth644: { width: 64, height: 64, borderRadius: 12, backgroundColor: theme.backgroundElement },
    colorTint: { color: theme.tint },
  });
