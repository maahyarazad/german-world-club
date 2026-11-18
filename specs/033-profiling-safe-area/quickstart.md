# Quickstart: validating the safe-area fix

## Prerequisites

An iPhone simulator with a notch or Dynamic Island (e.g. iPhone 16), one without (iPhone SE), and an Android emulator with a camera cut-out. Run the app with `npx expo start` from `expo-client/german-world-club` against a **throwaway** API, never the production database. Use a demo applicant that has reached profiling.

## Checks

1. `npx tsc --noEmit` in `expo-client/german-world-club`: clean.
2. **Profiling, each screen** (each question, the information screens, review, outcome) on all three devices: the title is fully readable and starts below the clock, signal and Wi-Fi indicators. (SC-001)
3. iPhone SE: no large blank band above the first line. (SC-002)
4. Header screens: register and country (steps 1 and 2), verify email, a member screen such as Profile and Threads show **no larger gap** above the first line than before. (SC-004)
5. `waiting` and the referral-link screen: clear of the indicators; the loading screen stays centred. (SC-003)
6. Bottom edge and keyboard: the last button clears the home indicator or navigation bar; open the keyboard on a text question, and the focused field stays visible. (SC-005)
7. Dark and light appearance, rotate the phone, and a large text size: content stays clear of the bar.

8. **Lists (US3)**: `grep -rn FlatList src` finds nothing. On each of the 11 lists (activity, marketplace, messages, threads feed, thread replies, a member's posts, quotes, people, events, media carousel, country picker): fast scroll without blank gaps, pull to refresh, page to the end, like or hide a post and only that row changes, the profile header stays on top, the carousel snaps, a picked country shows its tick.

Record anything that fails under Findings in `tasks.md`.
