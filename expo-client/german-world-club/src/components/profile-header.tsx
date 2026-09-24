import { router } from 'expo-router';
import { Linking, View } from 'react-native';

import type { ProfileLink } from '@gwc/contracts/profile';
import type { MediaItem } from '@gwc/contracts/media';
import { PROFILE_TABS } from '@gwc/contracts/threads';
import type { ProfileTab } from '@gwc/contracts/threads';

import { Avatar } from '@/components/avatar';
import { countryName } from '@/components/country-picker';
import { ThemedText } from '@/components/themed-text';
import { Chip, styles } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

export type HeaderProfile = {
  id: string
  displayName: string | null
  handle: string | null
  avatar: MediaItem | null
  bio: string | null
  city: string | null
  countryOfResidence: string | null
  links: ProfileLink[]
  isInfluencer: boolean
  followers: number
  following: number
};

/** A member's header, the same for your own profile and anybody else's (010 US3/US4). */
export function ProfileHeader({ profile, children }: { profile: HeaderProfile; children?: React.ReactNode }) {
  const theme = useTheme();
  const { t, locale, format } = useTranslations();
  const name = profile.displayName ?? '';
  const people = (kind: 'followers' | 'following') =>
    router.push({ pathname: '/threads/people/[id]', params: { id: profile.id, kind } });
  return (
    <View style={{ padding: Spacing.four, gap: Spacing.two }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.three }}>
        <View style={{ flexShrink: 1, gap: 2 }}>
          <ThemedText type="title" style={{ fontSize: 26, lineHeight: 32 }}>{name}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {profile.handle ? `@${profile.handle}` : t.profile.noHandle}
            {profile.isInfluencer ? `  · ${t.threads.influencer}` : ''}
          </ThemedText>
        </View>
        <Avatar author={profile} size={64} label={format(t.profile.avatarAlt, { name })} />
      </View>
      {profile.bio ? <ThemedText>{profile.bio}</ThemedText> : null}
      {profile.city || profile.countryOfResidence ? (
        <ThemedText themeColor="textSecondary">
          {[profile.city, countryName(profile.countryOfResidence, locale)].filter(Boolean).join(', ')}
        </ThemedText>
      ) : null}
      {profile.links.map((link) => (
        // https only, enforced by the server; opened in the system browser.
        <ThemedText key={link.url} style={{ color: theme.tint }} accessibilityRole="link" onPress={() => void Linking.openURL(link.url)}>
          {link.label ?? link.url.replace(/^https:\/\//, '')}
        </ThemedText>
      ))}
      <View style={styles.row}>
        <ThemedText type="smallBold" onPress={() => people('followers')}>{profile.followers}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" onPress={() => people('followers')}>{t.profile.followers}</ThemedText>
        <ThemedText type="smallBold" onPress={() => people('following')}>{profile.following}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" onPress={() => people('following')}>{t.profile.following}</ThemedText>
      </View>
      {children}
    </View>
  );
}

/** The four post tabs (FR-008). */
export function TabChips({ tab, onChange }: { tab: ProfileTab; onChange: (tab: ProfileTab) => void }) {
  const { t } = useTranslations();
  return (
    <View style={[styles.chips, { paddingHorizontal: Spacing.four }]} accessibilityRole="tablist">
      {PROFILE_TABS.map((value) => (
        <Chip key={value} label={t.profile.tabs[value]} selected={tab === value} onPress={() => onChange(value)} />
      ))}
    </View>
  );
}
