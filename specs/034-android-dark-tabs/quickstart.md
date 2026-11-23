# Quickstart: validate 034

Prerequisites: Android emulator or phone (13+), repo dependencies installed, a member account (`npm run -w server seed:demo` prints credentials).

1. **Typecheck**: `npm run -w expo-client/german-world-club typecheck` → no errors.
2. **Reproduce first (before the change)**: run the app on Android, set the system to dark, sign in as a member → only the current tab visible. Confirms R1.
3. **After the change, dark**: all five tabs show icon + label; the current one has the indicator pill and brighter colour. Tap each; the previous tab stays visible.
4. **Light**: switch the system to light without restarting → five tabs visible (FR-004).
5. **Badge**: with unread activity, the Activity badge shows; 100+ shows `99+`.
6. **Edge**: largest system font, German and English labels, gesture and 3-button navigation → nothing clipped or covered.
7. **iOS**: compare the bar in both themes with the previous build → identical (FR-006).
8. **Contrast**: values in research.md R2 hold; recheck if a colour token changes.
