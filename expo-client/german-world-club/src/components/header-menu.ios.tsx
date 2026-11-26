import { Button, Host, Image, Menu } from '@expo/ui/swift-ui';
import { accessibilityLabel, contentShape, frame, opacity, shapes, tint } from '@expo/ui/swift-ui/modifiers';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  MENU_BUTTON,
  MenuBadge,
  MenuIcon,
  type HeaderMenuItem,
  type HeaderMenuProps,
} from '@/components/header-menu-shared';
import { useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/i18n';

export type { HeaderMenuItem };

/**
 * How far, in points, the invisible native label reaches below the dots' box and so below the
 * header, so that the system may anchor its menu lower (feature 040, the one native-only
 * attempt for the iPhone). 12 is the spec's cap (FR-007): the part that lies over the page
 * takes taps, so it stays small. **`0` is exactly the behaviour before the attempt**, which is
 * how it is taken back out if a phone shows the menu still opens over the dots.
 */
const ANCHOR_EXTENSION = 12;

/**
 * The header's three dots on iOS (feature 039): SwiftUI's own `Menu`, through
 * `@expo/ui/swift-ui`, so the drop-down is the system's — its look, its animation, its
 * accessibility and, on iOS 26, its glass — and not one drawn here.
 *
 * What you see and what you tap are two layers in one fixed box (`MENU_BUTTON`, 40 x 44):
 * the picture is React Native, `MenuIcon`, the same Entypo dots Android draws; the control is
 * native and invisible, under it. The `Menu`'s label is an SF Symbol at `opacity(0)`, framed
 * to the whole box, so the system knows exactly where its label is and opens the menu from
 * there, and nothing in the label is ours to be sized, laid out or moved.
 * That is the point of the split. The label used to be our own dots hosted inside it
 * (`RNHostView`), and that is what went wrong on a phone: the menu opened over the dots, and
 * the dots moved when tapped. A hosted view is a UIKit view that SwiftUI sizes and, when the
 * menu opens, animates the menu out of. The icon is laid over the menu instead, as the
 * unread badge is, so it is not inside anything SwiftUI measures.
 *
 * Three details that matter. The label is `opacity(0)` and never `hidden()`: a hidden
 * SwiftUI view is not hit-tested, so the menu would not open, whereas a transparent one is
 * still there, still tappable and still read by VoiceOver. It has `contentShape` as well, so
 * the whole frame takes the tap and not only the pixels of a symbol nobody can see. And the
 * icon and the badge are `pointerEvents: 'none'`, so a tap goes through them to the native
 * label; the icon is also hidden from VoiceOver, so the dots are read once, from the native
 * label ("More", with a dot when a row has news), and not twice.
 *
 * There is no option in `@expo/ui` for which side of the label the menu opens on, or for
 * opening it by code on iOS, so the only thing controlled here is the anchor. On a phone the
 * menu opened over the dots when the label was exactly their box (feature 039, T045). Feature
 * 040 makes one native-only attempt: the label is `ANCHOR_EXTENSION` points taller than the
 * box, reaching below the header, so the system may anchor its menu lower. The extension
 * draws nothing (the label is invisible) and the header's layout does not change (the box is
 * fixed; the host overflows it at the bottom), but it takes taps where it overlaps the page,
 * which is why it is capped. Whether the system then opens the menu below the dots or still
 * over them can only be seen on a phone; `ANCHOR_EXTENSION = 0` is the behaviour before.
 * There is no `overflow` style here on purpose: the default, visible, is what lets the
 * overflow take touches, and the wrapper the stack puts a header in (`zIndex: 1`) does not
 * clip it (`specs/040-menu-below-header/research.md` D2).
 *
 * A row is a `Button`. The system menu runs `onPress` as it closes, and it is not a view
 * controller the way React Native's `Modal` is, so a screen pushed from it is not at risk
 * of being dropped. A row with news carries a small red dot, as a `circle.fill` symbol: the
 * system menu draws an item's symbol beside its label and honours `tint` for it, and
 * nothing else about an item's colour. `ignoreSafeArea="all"` keeps the host from adding the
 * safe area to a view in a header that has already allowed for it; it is what Expo's own
 * `MenuView` passes.
 */
export function HeaderMenu({ items }: HeaderMenuProps) {
  const theme = useTheme();
  const { t } = useTranslations();
  if (items.length === 0) return null;
  const unread = items.some((item) => item.dot);

  return (
    <View style={styles.box}>
      <Host matchContents ignoreSafeArea="all">
        <Menu
          label={
            <Image
              systemName="ellipsis"
              modifiers={[
                opacity(0),
                frame({ width: MENU_BUTTON.width, height: MENU_BUTTON.height + ANCHOR_EXTENSION }),
                contentShape(shapes.rectangle()),
                accessibilityLabel(unread ? `${t.common.menu} •` : t.common.menu),
              ]}
            />
          }>
          {items.map((item) => (
            <Button
              key={item.key}
              label={item.label}
              systemImage={item.dot ? 'circle.fill' : undefined}
              modifiers={item.dot ? [tint(theme.danger)] : undefined}
              onPress={() => router.push(item.href)}
            />
          ))}
        </Menu>
      </Host>
      <View style={styles.icon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <MenuIcon />
      </View>
      {unread ? <MenuBadge /> : null}
    </View>
  );
}

// A fixed box the native menu sits in and the icon and badge are laid over: its size does not
// depend on what the host measures (the host is `ANCHOR_EXTENSION` taller and overflows it at
// the bottom), so nothing about the dots can move when the menu opens.
const styles = StyleSheet.create({
  box: MENU_BUTTON,
  // Edges spelled out: this React Native has no `StyleSheet.absoluteFillObject`.
  icon: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' },
});
