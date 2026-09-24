import { Image } from 'expo-image';
import { Linking, View } from 'react-native';

import type { OrganisationPublicProfile } from '@gwc/contracts/profile';

import { imageUrl } from '@/components/media-carousel';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

/** An organisation's public profile: `organisation_profiles` only, never contract data. */
export function OrganisationCard({ org }: { org: OrganisationPublicProfile }) {
  const theme = useTheme();
  const { t, format } = useTranslations();
  return (
    <View style={{ gap: Spacing.two }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
        {org.logo ? (
          <Image source={imageUrl(org.logo, 192)} accessibilityLabel={format(t.profile.avatarAlt, { name: org.displayName })}
            style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: theme.backgroundElement }} contentFit="contain" />
        ) : null}
        <View style={{ flexShrink: 1 }}>
          <ThemedText type="subtitle">{org.displayName}</ThemedText>
          {org.city ? <ThemedText themeColor="textSecondary">{org.city}</ThemedText> : null}
        </View>
      </View>
      {org.about ? <ThemedText>{org.about}</ThemedText> : null}
      {org.website ? (
        <ThemedText style={{ color: theme.tint }} accessibilityRole="link" onPress={() => void Linking.openURL(org.website!)}>
          {org.website.replace(/^https:\/\//, '')}
        </ThemedText>
      ) : null}
    </View>
  );
}
