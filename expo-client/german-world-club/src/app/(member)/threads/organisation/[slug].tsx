import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import type { OrganisationPublicProfile } from '@gwc/contracts/profile';

import { profileApi } from '@/api/endpoints';
import { OrganisationCard } from '@/components/organisation-card';
import { Centered, FormScreen, Loading, Message } from '@/components/ui';
import { useTranslations } from '@/i18n';

/** A merchant's or partner's public face, as a member sees it (010 US4). */
export default function Organisation() {
  const { problemMessage } = useTranslations();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [org, setOrg] = useState<OrganisationPublicProfile | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { profileApi.organisationPublic(slug).then(setOrg, setError); }, [slug]);
  if (error) return <Centered><Message text={problemMessage(error)} /></Centered>;
  if (!org) return <Loading />;
  return (
    <FormScreen>
      <Stack.Screen options={{ title: org.displayName }} />
      <OrganisationCard org={org} />
    </FormScreen>
  );
}
