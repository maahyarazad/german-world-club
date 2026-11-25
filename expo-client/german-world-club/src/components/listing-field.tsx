import { Switch, View, StyleSheet } from 'react-native';

import type { FieldDef } from '@gwc/contracts/marketplace';

import { DatePartsField } from '@/components/date-parts-field';
import { ThemedText } from '@/components/themed-text';
import { Chip, TextField, styles as uiStyles } from '@/components/ui';
import { Spacing } from '@/constants/theme';

/**
 * One category-specific field of the compose form, rendered from the server's
 * `FieldDef` (`GET /marketplace/categories`) — never from a list in the app,
 * so a field added on the server needs no app release. The label is the key,
 * exactly as the web's DetailField shows it.
 *
 * Numbers are sent as typed strings, as the web sends them: the server coerces
 * with `Number()` and owns the validation (server marketplace/categories.ts).
 */
export function ListingField({ def, value, onChange }: {
  def: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = `${def.key}${def.required ? ' *' : ''}`;

  if (def.kind === 'boolean') {
    return (
      <View style={[uiStyles.row, styles.justifySpacebetween]}>
        <ThemedText>{label}</ThemedText>
        <Switch accessibilityLabel={label} value={Boolean(value)} onValueChange={onChange} />
      </View>
    );
  }

  if (def.kind === 'enum') {
    return (
      <View style={styles.gapOne}>
        <ThemedText type="smallBold">{label}</ThemedText>
        <View style={uiStyles.chips} accessibilityRole="radiogroup">
          {(def.options ?? []).map((option) => (
            // Tapping the chosen option again clears it — the app's "please select".
            <Chip key={option} label={option} selected={value === option}
              onPress={() => onChange(value === option ? undefined : option)} />
          ))}
        </View>
      </View>
    );
  }

  if (def.kind === 'date') {
    return <DatePartsField label={label} value={typeof value === 'string' ? value : ''}
      onChange={(iso) => onChange(iso === '' ? undefined : iso)} />;
  }

  const numeric = def.kind === 'integer' || def.kind === 'decimal' || def.kind === 'money';
  return (
    <TextField
      label={label}
      value={value === undefined || value === null ? '' : String(value)}
      keyboardType={def.kind === 'integer' ? 'number-pad' : numeric ? 'decimal-pad' : 'default'}
      onChangeText={(text) => onChange(text === '' ? undefined : text)}
    />
  );
}

const styles = StyleSheet.create({
  justifySpacebetween: { justifyContent: 'space-between' },
  gapOne: { gap: Spacing.one },
});
