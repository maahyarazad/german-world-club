import AntDesign from '@expo/vector-icons/AntDesign';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { MENU_BUTTON } from '@/components/header-menu-shared';
import { useTheme } from '@/hooks/use-theme';

/** The icon's size, the same as the three dots'. The tap area around it is `MENU_BUTTON`. */
const ICON_SIZE = 22;

// An icon font draws nothing until it has loaded, and loads on first use: left to that, the
// icon would be missing the first time a header with this button is shown. Starting the load
// as this module is imported, which is at launch, has the font ready by then.
AntDesign.loadFont().catch((error) => console.error('HeaderIconButton.loadFont', error));

/**
 * A header's one action as a plain icon button, for a screen that has a single action. A
 * screen with several puts them behind the three dots (`HeaderMenu`); a drop-down for one
 * row is a tap more than the action needs, so Threads' "New post" is this instead. It sits
 * where the dots would: the same 40 x 44 tap area, the same size and the theme's tint.
 */
export function HeaderIconButton({
  name,
  label,
  onPress,
}: {
  name: ComponentProps<typeof AntDesign>['name'];
  /** What a screen reader says for the button; there is no visible text. */
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.button}>
      <AntDesign name={name} size={ICON_SIZE} color={theme.tint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { ...MENU_BUTTON, alignItems: 'center', justifyContent: 'center' },
});
