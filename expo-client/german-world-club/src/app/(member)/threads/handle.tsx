import { router } from 'expo-router';

import { HandleForm } from '@/components/handle-form';

/** Pushed from compose on `handle-required`; back to compose once one is chosen. */
export default function ChooseHandle() {
  return <HandleForm current={null} onSaved={() => router.back()} />;
}
