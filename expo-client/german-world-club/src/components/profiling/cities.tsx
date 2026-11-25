import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CitySlot, CitiesResponse } from '@gwc/contracts/profiling';

import { ThemedText } from '@/components/themed-text';
import { Button, Chip, FormScreen, Loading, TextField, styles as uiStyles } from '@/components/ui';
import { CountryPicker, countryName } from '@/components/country-picker';
import { Spacing } from '@/constants/theme';
import { profilingApi } from '@/api/endpoints';
import { ApiError } from '@/api/client';
import type { StepCtx } from './types';
import { useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

/**
 * One (country, city) pair, in two screens: the country from the full picker,
 * then the city. For a country the club's lists cover the city is picked from
 * them (typing filters); for any other country it is free text. The API says
 * which with `listed`.
 */
export function PlacePicker({ ctx, title, initial, onDone, onBack }: {
  ctx: StepCtx; title: string; initial: CitySlot | null
  onDone: (slot: CitySlot) => void
  /** Leaves the picker; null when there is nowhere to go back to. */
  onBack: (() => void) | null
}) {
  const themed = useThemedStyles(makeStyles);
  const { copy, locale, busy } = ctx;
  const [country, setCountry] = useState(initial?.country ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [stage, setStage] = useState<'country' | 'city'>(initial?.country ? 'city' : 'country');
  const [known, setKnown] = useState<CitiesResponse | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (stage !== 'city' || !country) return;
    let current = true;
    profilingApi.cities(country)
      .then((response) => { if (current) setKnown(response); })
      .catch((e) => {
        console.error('PlacePicker.cities', e instanceof ApiError ? e.problem : e);
        if (current) setKnown({ listed: false, cities: [] });
      });
    return () => { current = false; };
  }, [stage, country]);

  const back = stage === 'city' ? () => setStage('country') : onBack;
  const backButton = back ? <Button label={copy.back} variant="secondary" disabled={busy} onPress={back} /> : null;

  if (stage === 'country') {
    // A full-flex picker, not `Centered` (which shrinks children and would
    // collapse the list) — the same wrapper (public)/country.tsx uses.
    return (
      <SafeAreaView edges={['bottom']} style={themed.flex1Clear}>
        <View style={styles.flex1PaddingFourGapThree}>
          <ThemedText type="title" style={styles.font30Line36}>{title}</ThemedText>
          <CountryPicker
            selected={country}
            onSelect={(code) => {
              // A different country makes the city saved under the old one meaningless.
              if (code !== country) { setCity(''); setKnown(null); }
              setCountry(code);
              setStage('city');
            }}
          />
          {backButton}
        </View>
      </SafeAreaView>
    );
  }

  if (known === null) return <Loading />;

  const needle = query.trim().toLowerCase();
  return (
    <FormScreen title={title} subtitle={countryName(country, locale)}>
      {known.listed ? (
        <>
          <TextField label={copy.cityPlaceholder} value={query} onChangeText={setQuery} autoCorrect={false} />
          <View style={uiStyles.chips} accessibilityRole="radiogroup">
            {known.cities.filter((c) => !needle || c.toLowerCase().includes(needle)).map((c) => (
              <Chip key={c} label={c} selected={city.toLowerCase() === c.toLowerCase()} onPress={() => { if (!busy) onDone({ country, city: c }); }} />
            ))}
          </View>
        </>
      ) : (
        <>
          <TextField label={copy.cityPlaceholder} value={city} onChangeText={setCity} autoFocus />
          <Button label={copy.continue} loading={busy} disabled={!city.trim()} onPress={() => onDone({ country, city: city.trim() })} />
        </>
      )}
      {backButton}
    </FormScreen>
  );
}

/**
 * The elsewhere branch's nearest-city step: one primary city, then up to two
 * optional secondaries, saved together. Starts from what is already saved, and
 * Back walks the sub-steps before it leaves the step.
 */
export function CitiesStep({ ctx }: { ctx: StepCtx }) {
  const { copy, busy } = ctx;
  const saved = ctx.answers.primaryCity;
  const [stage, setStage] = useState<'primary' | 'ask-secondary' | 'secondary'>(saved ? 'ask-secondary' : 'primary');
  const [primary, setPrimary] = useState<CitySlot | null>(saved);
  const [secondary, setSecondary] = useState<CitySlot[]>(ctx.answers.secondaryCities);

  if (stage === 'primary') {
    return (
      <PlacePicker
        ctx={ctx} title={copy.primaryCityTitle} initial={primary} onBack={ctx.back}
        onDone={(slot) => { setPrimary(slot); setStage('ask-secondary'); }}
      />
    );
  }

  if (stage === 'secondary') {
    return (
      <PlacePicker
        ctx={ctx} title={copy.secondaryCityTitle} initial={null} onBack={() => setStage('ask-secondary')}
        onDone={(slot) => { setSecondary((current) => [...current, slot]); setStage('ask-secondary'); }}
      />
    );
  }

  return (
    <FormScreen title={copy.addSecondaryTitle}>
      {primary ? <ThemedText>{`${primary.city} (${primary.country})`}</ThemedText> : null}
      {secondary.map((c, i) => (
        <ThemedText key={i} themeColor="textSecondary">{`${c.city} (${c.country})`}</ThemedText>
      ))}
      {secondary.length > 0 && <Button label={copy.change} variant="secondary" onPress={() => setSecondary([])} />}
      {secondary.length < 2 && (
        <Button label={copy.addSecondaryYes} variant="secondary" onPress={() => setStage('secondary')} />
      )}
      <Button
        label={busy ? copy.submitting : copy.addSecondaryNo}
        loading={busy}
        disabled={!primary}
        onPress={() => primary && ctx.save({ primaryCity: primary, secondaryCities: secondary })}
      />
      <Button label={copy.back} variant="secondary" disabled={busy} onPress={() => setStage('primary')} />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  flex1PaddingFourGapThree: { flex: 1, padding: Spacing.four, gap: Spacing.three },
  font30Line36: { fontSize: 30, lineHeight: 36 },
});

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    flex1Clear: { flex: 1, backgroundColor: 'transparent' },
  });
