# Contract: Backdrop, logo and buttons on the public auth screens

**Feature**: 043-expo-password-reset | Spec US4 and US5, FR-017 to FR-024 | Research R12 to R16. Presentation only: no server, API or database behaviour changes.

## 1. The backdrop (US4)

| Piece | Rule |
|---|---|
| Source art (kept, not bundled) | `assets/main-bg-light-01.png`, `assets/main-bg-dark-01.png`: 4875 x 10550, about 2.1 MB each. The old `main_bg.png` and `main-bg-phone.png` stay in the repository and become unreferenced. |
| Shipped copies (new) | `assets/main-bg-light-phone.png`, `assets/main-bg-dark-phone.png`: **1170 px wide** (about 1170 x 2532), each **no wider than 1242 px and no larger than 1.5 MB** |
| Component | `src/components/app-background.tsx`: both copies are `require`d at module scope; the one drawn is chosen by `useColorScheme()` (imported from `@/hooks/use-color-scheme`, as `useTheme` does); `contentFit="cover"`, `contentPosition="top"`, absolute fill, `pointerEvents="none"`, as today |
| Live switch | the component re-renders when the device's appearance changes; no restart, no navigation |
| Where it is drawn | once, behind the whole navigator (`app/_layout.tsx`), unchanged: every transparent screen shows it |
| Wash | `BackdropScrim` in `src/constants/theme.ts`: `light: 'transparent'`, `dark: 'rgba(0, 0, 0, 0.5)'` |

### Contrast the wash must preserve (measured, research R13)

| Mode | Art background | Wash | Body text | Secondary text | Required |
|---|---|---|---|---|---|
| Light | `#FFF5E6` | none | 16.6:1 | 5.5:1 | each at least 4.5:1 |
| Dark | `#60646C` | black 0.50 | 11.0:1 | 5.2:1 | each at least 4.5:1 |

Rule: the dark wash must not go below about **0.45** black without recolouring `textSecondary`. A wash is always a valid colour; "no wash" is `'transparent'`, never `''`.

## 2. The logo (US5)

The requester's choice (research R14): the welcome screen's emblem, in the welcome screen's card.

| Piece | Rule |
|---|---|
| File | the club's emblem with a **transparent** background (`assets/gwc-compact-icon.png` at the time of writing; it was `splash-icon.png`): **the same file `app/(public)/index.tsx` draws**, which the guard test enforces whatever the file is |
| Card | a `View` with exactly the welcome screen's `logoCard`: `backgroundColor: 'transparent'`, `borderRadius: 16`, `padding: Spacing.three`, `alignItems: 'center'` |
| Image | exactly the welcome screen's `logo`: `height: 220`, `aspectRatio: 844 / 578`, `resizeMode="contain"` |
| Accessibility | one accessible element: the image with `accessibilityLabel={t.welcome.title}` (the club's name); the card is a plain `View`, so it is not a second stop |
| Same on all three | one size and one position on the sign-in, forgot-password and reset-password screens, because the card lives in the shared layout, not in each screen |
| Not changed | the welcome screen keeps drawing it as it does today |

## 3. The shared layout: `AuthScreen`

`src/components/auth-screen.tsx` exports `AuthScreen({ title?, subtitle?, children, actions })`:

```text
SafeAreaView (top, bottom)                       background transparent: the backdrop shows through
└─ KeyboardAvoidingView (ios: padding)
   └─ ScrollView (keyboardShouldPersistTaps="handled",
                  contentContainer: centred when there is room, paddingHorizontal Spacing.four)
      ├─ logo card                               section 2
      ├─ title      (optional, ThemedText "title")
      ├─ subtitle   (optional, ThemedText secondary)
      ├─ children                                fields and <Message>s; gap Spacing.three; width 100%; maxWidth MaxContentWidth; centred
      └─ actions                                 the buttons; section 4
```

It mirrors `FormScreen` (`components/ui.tsx`) in structure and spacing, so a screen that moves from one to the other keeps its keyboard behaviour. `FormScreen` itself is **not** changed (registration, profile and other screens still use it).

## 4. The buttons (US5)

The `actions` block has exactly the welcome screen's `actions` style values: `gap: Spacing.three`, `width: '100%'`, `maxWidth: MaxContentWidth`, `alignSelf: 'center'`.

| Rule | Detail |
|---|---|
| Component | only `Button` (or `AsyncButton`, which renders `Button`) from `@/components/ui`; **no** `Pressable`, `TouchableOpacity`, text link or custom-styled control as an action |
| Variants | the main action is the primary (default) variant; any other action is `variant="secondary"`; `danger` is not used |
| Order | main action first, then the others, top to bottom |
| States | loading and disabled exactly as `Button` already shows them |

Per screen:

| Screen | Primary | Secondary |
|---|---|---|
| Sign in (`app/(public)/sign-in.tsx`) | "Sign in" (`t.signIn.submit`), `variant="primary"` written out (it is the default) | "Forgot password?" (`t.passwordReset.forgotLink`) |
| Forgot password (`forgot-password.tsx`) | "Code anfordern" (`t.passwordReset.submitRequest`) | none |
| Reset password (`reset-password.tsx`) | "Passwort speichern" (`t.passwordReset.submitConfirm`) | "Neuen Code senden" (`t.passwordReset.resend`, an `AsyncButton`) |

## 5. What stays the same

- Sign-in's logic, notices, failures and routing to `sign-in-code`.
- The welcome screen, the registration steps and `sign-in-code.tsx`.
- Every theme colour other than the backdrop's light wash.

## 6. Checks

| Check | How |
|---|---|
| Copies exist, are small, and are the ones used | `client/tests/assets/expo-backdrop.test.ts` (vitest reading the Expo files) |
| Wash values are valid and keep the floor | the same file |
| The three screens use the shared layout and only standard buttons | `client/tests/assets/expo-auth-screens.test.ts` |
| Light and dark, live switch, small phone with keyboard, screen reader | the device scenarios in quickstart section 11 (the app has no test runner) |
