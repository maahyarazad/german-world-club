import { Stack } from 'expo-router';

/**
 * Onboarding Phase 2 (feature 013): approved, but profiling is not finished.
 * One screen, like `(applicant)/waiting.tsx` — the questionnaire itself
 * manages which question is showing, the same way the web console's
 * `Profiling.tsx` does, rather than one expo-router route per question.
 */
export default function ProfilingLayout() {
  return (
    <Stack screenOptions={{ headerBackVisible: false, gestureEnabled: false, headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
