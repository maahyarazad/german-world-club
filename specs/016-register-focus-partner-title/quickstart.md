# Quickstart: validating feature 016

## Prerequisites

- `npm install` at the repo root (workspaces include the Expo app and `@gwc/contracts`).
- For the device checks, a dev server: `npm run -w server dev`, a seeded DB (`seed:dev`), and the
  Expo app running on an iOS simulator **and** an Android emulator (`npx expo start` in
  `expo-client/german-world-club`).

## Automated checks

```bash
npm run -w expo-client/german-world-club typecheck   # ref/ReactNode prop changes compile
npm run -w expo-client/german-world-club lint
npm test -w packages/contracts                       # profiling-steps: partner block is Q2–Q5, never settling
npm run -w server test -- profiling/settling         # partner settling keys refused (400); needs DB
npm test -w client -- onboarding/profiling           # web: partner starts at languages
npm run -w client test:i18n                          # no catalogue keys added or removed
```

Expected: all green with no test edits. The partner-Q1 guarantee was already covered before this
feature (research R1). A failure in the last three means this feature changed behaviour it
should not have.

## Manual: Register focus (US1)

1. Open Register. Tap Full name and type. Press return. **Email is focused and the keyboard stays up.**
2. Continue with return through Password → Mobile (Android: return on the phone pad) → Day.
3. Type `07` in Day. **Focus jumps to Month.** Type `03`. **Focus jumps to Year.**
4. Type a year and press done. **The keyboard closes, and no validation errors appear.**
5. Counter-check: on iOS, Mobile shows no return key. Tapping Day is expected (research R5).

## Manual: partner heading (US2, US3)

1. Sign in as an approved, unprofiled German applicant. Answer Q1–Q5, and select **Partner** at Q6.
2. The next four screens are languages, qualification, occupation and income. Each heading reads
   "**Your partner:** <question>", with only "Your partner:" in gold.
3. Counter-check: the member's own Q2–Q5 headings before Q6 show **no** gold.
4. Switch the device to dark mode. The gold label is still legible.
5. Switch the app to German. The label "Ihre Partnerschaft:" is gold.
6. No settling question ("Do you already know where you'll settle?") appears after Q6. Repeat
   on the web console at `/konsole` to confirm the same order there.
7. With VoiceOver/TalkBack on, the heading is read as one phrase.
