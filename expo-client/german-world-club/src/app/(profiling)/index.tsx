import { useCallback, useEffect, useState } from 'react';
import { BackHandler, View } from 'react-native';

import { profilingSteps, profilingMissing } from '@gwc/contracts/profiling';
import type { ProfilingStatus, ProfilingStepId } from '@gwc/contracts/profiling';
import { PROBLEMS } from '@gwc/contracts/errors';

import { ThemedText } from '@/components/themed-text';
import { Button, Centered, FormScreen, Loading } from '@/components/ui';
import { StepView } from '@/components/profiling/steps';
import { stepTitle, stepSummary } from '@/components/profiling/summary';
import { useTranslations } from '@/i18n';
import { useSession } from '@/session/session';
import { profilingApi } from '@/api/endpoints';
import { ApiError } from '@/api/client';

type Answerable = Exclude<ProfilingStepId, 'review'>;

/**
 * Onboarding Phase 2 (feature 013), on the app. Mirrors the web console's
 * `Profiling.tsx`: which questions apply, their order and what is still
 * unanswered come from `profilingSteps` / `profilingMissing` in @gwc/contracts
 * (the same functions the server's submit check uses). Answers are saved as
 * they are given and stay changeable — Back, or "Change" on the review — until
 * the member submits.
 */
export default function ProfilingScreen() {
  const { t, locale } = useTranslations();
  const copy = t.profiling;
  const { state, refreshProfiling } = useSession();
  const [snapshot, setSnapshot] = useState<ProfilingStatus | null>(
    state.status === 'profiling' ? state.profiling : null,
  );
  const [step, setStep] = useState<ProfilingStepId>(
    state.status === 'profiling'
      ? profilingMissing(state.profiling.branch, state.profiling.answers)[0] ?? 'review'
      : 'review',
  );
  // True while a "Change" from the review is in progress: saving returns to the review.
  const [fromReview, setFromReview] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const loaded = await profilingApi.status();
      setSnapshot(loaded);
      setStep(profilingMissing(loaded.branch, loaded.answers)[0] ?? 'review');
    } catch (e) {
      console.error('ProfilingScreen.load', e instanceof ApiError ? e.problem : e);
    }
  }, []);

  useEffect(() => { if (!snapshot) void load(); }, [snapshot, load]);

  const save = useCallback(async (body: Parameters<typeof profilingApi.save>[0]) => {
    setBusy(true);
    try {
      const next = await profilingApi.save(body);
      setSnapshot(next);
      if (fromReview) {
        // A change can make new questions apply (another Q7 path, say): answer those first.
        const missing = profilingMissing(next.branch, next.answers);
        setStep(missing[0] ?? 'review');
        if (missing.length === 0) setFromReview(false);
      } else {
        const steps = profilingSteps(next.branch, next.answers);
        setStep(steps[steps.indexOf(step) + 1] ?? 'review');
      }
    } catch (e) {
      console.error('ProfilingScreen.save', e instanceof ApiError ? e.problem : e);
    } finally {
      setBusy(false);
    }
  }, [fromReview, step]);

  const submit = useCallback(async () => {
    setBusy(true);
    try {
      const done = await profilingApi.complete();
      setSnapshot(done);
      if (done.branch === 'germany') await refreshProfiling(done);
    } catch (e) {
      console.error('ProfilingScreen.submit', e instanceof ApiError ? e.problem : e);
      if (e instanceof ApiError && e.problem?.type === PROBLEMS.PROFILING_ANSWERS_MISSING.type) {
        // The server disagrees that everything is answered: take the member to what it is missing.
        await load();
      }
    } finally {
      setBusy(false);
    }
  }, [refreshProfiling, load]);

  const steps = snapshot ? profilingSteps(snapshot.branch, snapshot.answers) : [];
  const onReview = snapshot !== null && (step === 'review' || !steps.includes(step));
  const index = steps.indexOf(step);
  const back: (() => void) | null = onReview
    ? null
    : fromReview
      ? () => { setFromReview(false); setStep('review'); }
      : index > 0 ? () => setStep(steps[index - 1] ?? 'review') : null;
  const answerable = steps.filter((s): s is Answerable => s !== 'review');
  const reviewBack = onReview && answerable.length > 0
    ? () => setStep(answerable[answerable.length - 1] ?? 'review')
    : null;

  // Android's hardware Back walks the questions instead of leaving the flow;
  // on the first question it does what it always did.
  useEffect(() => {
    const handler = reviewBack ?? back;
    if (!handler) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!busy) handler();
      return true;
    });
    return () => subscription.remove();
  });

  if (!snapshot) return <Loading />;

  // A completed elsewhere-branch outcome stays on screen until the member
  // continues — the germany branch has no outcome message, so refreshProfiling
  // above already moved the session on to 'member' by the time this would render.
  if (snapshot.completed && snapshot.branch === 'elsewhere') {
    const outcome = snapshot.outcome === 'gwc_city_match'
      ? { title: copy.matchTitle, body: copy.matchBody }
      : { title: copy.meetingTitle, body: copy.meetingBody };
    return (
      <Centered>
        <ThemedText type="title" style={{ textAlign: 'center' }}>{outcome.title}</ThemedText>
        <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>{outcome.body}</ThemedText>
        <Button label={copy.continueToApp} onPress={() => refreshProfiling(snapshot)} />
      </Centered>
    );
  }

  if (snapshot.completed) return <Loading />; // germany: transitioning to 'member'

  if (onReview) {
    const missing = profilingMissing(snapshot.branch, snapshot.answers);
    return (
      <FormScreen title={copy.reviewTitle} subtitle={copy.reviewSubtitle}>
        {answerable.map((s) => (
          <View key={s} style={{ gap: 4 }}>
            <ThemedText themeColor="textSecondary">{stepTitle(s, copy, snapshot.answers)}</ThemedText>
            <ThemedText>{stepSummary(s, copy, snapshot.answers)}</ThemedText>
            <Button
              label={copy.change}
              variant="secondary"
              disabled={busy}
              onPress={() => { setFromReview(true); setStep(s); }}
            />
          </View>
        ))}
        <Button
          label={busy ? copy.submitting : copy.submit}
          loading={busy}
          disabled={busy || missing.length > 0}
          onPress={submit}
        />
        {reviewBack && <Button label={copy.back} variant="secondary" disabled={busy} onPress={reviewBack} />}
      </FormScreen>
    );
  }

  return (
    <StepView
      key={step}
      step={step as Answerable}
      ctx={{ copy, locale, answers: snapshot.answers, busy, save: (body) => { void save(body); }, back }}
    />
  );
}
