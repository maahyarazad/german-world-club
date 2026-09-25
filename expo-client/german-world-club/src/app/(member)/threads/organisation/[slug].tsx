import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import type { OrganisationPublicProfile } from '@gwc/contracts/profile';

import { profileApi } from '@/api/endpoints';
import { OrganisationCard } from '@/components/organisation-card';
import { FormScreen, Loading } from '@/components/ui';
import { ApiError } from '@/api/client';

/** A merchant's or partner's public face, as a member sees it (010 US4). */
export default function Organisation() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [org, setOrg] = useState<OrganisationPublicProfile | null>(null);
  useEffect(() => { profileApi.organisationPublic(slug).then(setOrg, (e) => console.error('Organisation.load', e instanceof ApiError ? e.problem : e)); }, [slug]);
  if (!org) return <Loading />;
  return (
    <FormScreen>
      <Stack.Screen options={{ title: org.displayName }} />
      <OrganisationCard org={org} />
    </FormScreen>
  );
}
