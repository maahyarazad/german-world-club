import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { profileApi } from '@/api/endpoints';
import { HandleForm } from '@/components/handle-form';
import { Loading } from '@/components/ui';

/** Choosing or changing your @handle from the profile (010 US3). */
export default function ProfileHandle() {
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  useEffect(() => { profileApi.me().then((p) => setCurrent(p.handle), () => setCurrent(null)); }, []);
  if (current === undefined) return <Loading />;
  return <HandleForm current={current} onSaved={() => router.back()} />;
}
