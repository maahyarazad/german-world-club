import { useState } from 'react';
import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

import {
  SETTLING_STATUSES, QUALIFICATION_LEVELS, OCCUPATIONS, DESIRED_WORK_TYPES, FUTURE_WORK_PRIORITIES,
  YEARLY_INCOME_RANGES, RELATIONSHIP_TAGS, KID_AGE_RANGES, MAX_KIDS, LANGUAGES, INDUSTRIES,
  WORKING_DURATIONS, BUSINESS_ACTIVITIES,
} from '@gwc/contracts/profiling';
import type { ProfilingStepId, RelationshipTag, KidAgeRange } from '@gwc/contracts/profiling';

import { ThemedText } from '@/components/themed-text';
import { Button, Chip, FormScreen, TextField, styles } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { CitiesStep, PlacePicker } from './cities';
import { fill, splitTemplate } from './types';
import type { StepCtx } from './types';

function Frame({ ctx, title, subtitle, children }: { ctx: StepCtx; title: ReactNode; subtitle?: string; children: ReactNode }) {
  return (
    <FormScreen title={title} subtitle={subtitle}>
      {children}
      {ctx.back && <Button label={ctx.copy.back} variant="secondary" disabled={ctx.busy} onPress={ctx.back} />}
    </FormScreen>
  );
}

/** A single choice: picking an option saves it and moves on; the saved one is selected. */
function Choice({ ctx, title, subtitle, options, selected, onPick }: {
  ctx: StepCtx; title: ReactNode; subtitle?: string; options: { value: string; label: string }[]
  selected: string | null; onPick: (value: string) => void;
}) {
  return (
    <Frame ctx={ctx} title={title} subtitle={subtitle}>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {options.map((o) => (
          <Chip key={o.value} label={o.label} selected={selected === o.value} onPress={() => { if (!ctx.busy) onPick(o.value); }} />
        ))}
      </View>
    </Frame>
  );
}

function Multi({ ctx, title, subtitle, options, initial, onToggle, onContinue, search }: {
  ctx: StepCtx; title: ReactNode; subtitle?: string; options: { value: string; label: string }[]; initial: string[]
  onToggle?: (current: string[], value: string) => string[]; onContinue: (values: string[]) => void
  search?: string;
}) {
  const [values, setValues] = useState<string[]>(initial);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = search ? options.filter((o) => !needle || o.label.toLowerCase().includes(needle)) : options;
  const toggle = (value: string) => setValues((current) => (
    onToggle ? onToggle(current, value)
      : current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
  ));
  return (
    <Frame ctx={ctx} title={title} subtitle={subtitle}>
      {search && <TextField label={search} value={query} onChangeText={setQuery} autoCorrect={false} />}
      <View style={styles.chips} accessibilityRole="radiogroup">
        {shown.map((o) => (
          <Chip key={o.value} label={o.label} selected={values.includes(o.value)} onPress={() => toggle(o.value)} />
        ))}
      </View>
      <Button
        label={ctx.busy ? ctx.copy.submitting : ctx.copy.continue}
        disabled={ctx.busy || values.length === 0}
        onPress={() => onContinue(values)}
      />
    </Frame>
  );
}

function Text({ ctx, title, initial, onContinue }: {
  ctx: StepCtx; title: string; initial: string; onContinue: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Frame ctx={ctx} title={title}>
      <TextField label={title} value={value} onChangeText={setValue} autoFocus />
      <Button
        label={ctx.busy ? ctx.copy.submitting : ctx.copy.continue}
        disabled={ctx.busy || !value.trim()}
        onPress={() => onContinue(value.trim())}
      />
    </Frame>
  );
}

function Kids({ ctx }: { ctx: StepCtx }) {
  const { copy } = ctx;
  const [ages, setAges] = useState<(KidAgeRange | null)[]>(ctx.answers.kids);
  const setCount = (raw: string) => {
    const n = Math.max(0, Math.min(MAX_KIDS, Math.floor(Number(raw) || 0)));
    // Keep the ranges already picked by position; new kids start unpicked.
    setAges((current) => Array.from({ length: n }, (_, i) => current[i] ?? null));
  };
  const complete = ages.length > 0 && ages.every((a) => a !== null);
  return (
    <Frame ctx={ctx} title={copy.kidsCountTitle}>
      <TextField
        label={copy.kidsCountTitle}
        value={ages.length === 0 ? '' : String(ages.length)}
        onChangeText={setCount}
        keyboardType="number-pad"
      />
      {ages.map((age, index) => (
        <View key={index} style={{ gap: 8 }}>
          <ThemedText themeColor="textSecondary">{fill(copy.kidAgeTitle, { n: index + 1 })}</ThemedText>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {KID_AGE_RANGES.map((range) => (
              <Chip
                key={range}
                label={copy.kidAgeOptions[range]}
                selected={age === range}
                onPress={() => setAges((current) => current.map((a, i) => (i === index ? range : a)))}
              />
            ))}
          </View>
        </View>
      ))}
      <Button
        label={ctx.busy ? copy.submitting : copy.continue}
        disabled={ctx.busy || !complete}
        onPress={() => ctx.save({ kids: ages })}
      />
    </Frame>
  );
}

const labelled = (values: readonly string[], labels: Record<string, string>) =>
  values.map((value) => ({ value, label: labels[value] ?? value }));

/**
 * One screen per step id. Partner steps are the German Q2–Q5 (never Q1, settling,
 * nor Q6), as `profilingSteps` lists them, writing under `partner` — the same
 * components, so the two cannot drift apart.
 */
export function StepView({ step, ctx }: { step: Exclude<ProfilingStepId, 'review'>; ctx: StepCtx }) {
  const { copy, answers } = ctx;
  const theme = useTheme();
  const partner = step.startsWith('partner-');
  const base = partner ? step.slice('partner-'.length) : step;
  const subject = partner ? answers.partner : answers;
  // Only the partnerTitle text is gold, so the four partner questions are not
  // mistaken for the member's own Q2–Q5. Nested RN Text inherits the title's
  // size and stays one accessible heading; ThemedText would reset the size.
  const [before, after] = splitTemplate(copy.partnerTitle, 'question');
  const gold = { color: theme.accentText };
  const title = (own: string): ReactNode => (partner
    ? <>{before ? <RNText style={gold}>{before}</RNText> : null}{own}{after ? <RNText style={gold}>{after}</RNText> : null}</>
    : own);
  const put = (field: string, value: unknown) => ctx.save(partner ? { partner: { [field]: value } } : { [field]: value });

  switch (base) {
    case 'settling':
      return <Choice ctx={ctx} title={copy.settlingTitle} subtitle={copy.settlingSubtitle}
        options={labelled(SETTLING_STATUSES, copy.settlingOptions)} selected={answers.settlingStatus ?? null}
        onPick={(v) => ctx.save({ settlingStatus: v })} />;
    case 'settling-info':
      return (
        <Frame ctx={ctx} title={copy.settlingTitle}>
          <ThemedText themeColor="textSecondary">{copy.settlingInfo}</ThemedText>
          <Button label={copy.continue} disabled={ctx.busy} onPress={ctx.next} />
        </Frame>
      );
    case 'settling-place':
      return <PlacePicker ctx={ctx} title={copy.settlingPlaceTitle} onBack={ctx.back}
        initial={answers.settlingCountry ? { country: answers.settlingCountry, city: answers.settlingCity ?? '' } : null}
        onDone={(slot) => ctx.save({ settlingCountry: slot.country, settlingCity: slot.city })} />;
    case 'settling-work':
      return <Choice ctx={ctx} title={copy.workingDurationTitle}
        options={labelled(WORKING_DURATIONS, copy.workingDurationOptions)} selected={answers.settlingWorkDuration ?? null}
        onPick={(v) => ctx.save({ settlingWorkDuration: v })} />;
    case 'languages':
      return <Multi ctx={ctx} title={title(copy.languagesTitle)} subtitle={copy.languagesSubtitle} search={copy.languagesSearch}
        options={LANGUAGES.map((l) => ({ value: l.code, label: l.en }))} initial={subject?.languages ?? []}
        onContinue={(languages) => put('languages', languages)} />;
    case 'income':
      return <Choice ctx={ctx} title={title(copy.incomeTitle)}
        options={labelled(YEARLY_INCOME_RANGES, copy.incomeOptions)} selected={subject?.yearlyIncomeRange ?? null}
        onPick={(v) => put('yearlyIncomeRange', v)} />;
    case 'qualification':
      return <Choice ctx={ctx} title={title(copy.qualificationTitle)}
        options={labelled(QUALIFICATION_LEVELS, copy.qualificationOptions)} selected={subject?.qualificationLevel ?? null}
        onPick={(v) => put('qualificationLevel', v)} />;
    case 'occupation':
      return <Choice ctx={ctx} title={title(copy.occupationTitle)}
        options={labelled(OCCUPATIONS, copy.occupationOptions)} selected={subject?.occupation ?? null}
        onPick={(v) => put('occupation', v)} />;
    case 'cities':
      return <CitiesStep ctx={ctx} />;
    case 'relationship':
      return <Multi ctx={ctx} title={copy.relationshipTitle} subtitle={copy.relationshipSubtitle}
        options={labelled(RELATIONSHIP_TAGS, copy.relationshipOptions)} initial={answers.relationshipStatus ?? []}
        // "Single" is exclusive: choosing it clears the rest, choosing anything else clears it.
        onToggle={(current, value) => (value === 'single'
          ? (current.includes('single') ? [] : ['single'])
          : (current.includes(value) ? current.filter((v) => v !== value) : [...current.filter((v) => v !== 'single'), value]))}
        onContinue={(tags) => ctx.save({ relationshipStatus: tags as RelationshipTag[] })} />;
    case 'kids':
      return <Kids ctx={ctx} />;
    case 'work-type':
      return <Choice ctx={ctx} title={copy.desiredWorkTitle}
        options={labelled(DESIRED_WORK_TYPES, copy.desiredWorkOptions)} selected={answers.desiredWorkType}
        onPick={(v) => ctx.save({ desiredWorkType: v })} />;
    case 'work-industry':
      // A fixed list, shown as the app's chip picker (the same idiom as the designated-city list).
      return <Choice ctx={ctx} title={copy.futureWorkSectorTitle}
        options={labelled(INDUSTRIES, copy.industryOptions)} selected={answers.futureWorkSector}
        onPick={(v) => ctx.save({ futureWorkSector: v })} />;
    case 'work-offering':
      return <Text ctx={ctx} title={copy.futureWorkOfferingTitle} initial={answers.futureWorkOffering ?? ''}
        onContinue={(v) => ctx.save({ futureWorkOffering: v })} />;
    case 'work-idea':
      return <Text ctx={ctx} title={copy.futureWorkIdeaTitle}
        initial={answers.futureWorkIdea ?? ''} onContinue={(v) => ctx.save({ futureWorkIdea: v })} />;
    case 'work-ready':
      return <Choice ctx={ctx} title={copy.futureWorkReadyTitle}
        options={[{ value: 'yes', label: copy.futureWorkReadyOptions.yes }, { value: 'no', label: copy.futureWorkReadyOptions.no }]}
        selected={answers.futureWorkReady === null ? null : answers.futureWorkReady ? 'yes' : 'no'}
        onPick={(v) => ctx.save({ futureWorkReady: v === 'yes' })} />;
    case 'work-priorities':
      return <Multi ctx={ctx} title={copy.futureWorkPrioritiesTitle}
        options={labelled(FUTURE_WORK_PRIORITIES, copy.futureWorkPrioritiesOptions)} initial={answers.futureWorkPriorities ?? []}
        onContinue={(v) => ctx.save({ futureWorkPriorities: v })} />;
    case 'work-activities':
      return <Multi ctx={ctx} title={copy.productServiceTitle}
        options={labelled(BUSINESS_ACTIVITIES, copy.businessActivityOptions)} initial={answers.futureWorkBusinessActivities ?? []}
        onContinue={(v) => ctx.save({ futureWorkBusinessActivities: v })} />;
    default:
      return null;
  }
}
