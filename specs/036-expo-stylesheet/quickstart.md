# Quickstart: verifying the StyleSheet conversion

Run from the repository root unless noted.

1. **Counts**: `cd expo-client/german-world-club && grep -rn "style={{" src | wc -l` — falls toward 0 as phases complete. Final result: only FR-003 exceptions, each with an `eslint-disable-next-line` and a reason.
2. **Types and lint**: `npx tsc --noEmit` and `npm run -w german-world-club lint`. Compare with the baseline in `research.md` R1; no new warning or error.
3. **Guard works**: add `<View style={{ flex: 1 }} />` anywhere; lint must report it. Remove it.
4. **Visual check, light and dark** (dev client on a phone or simulator; switch the OS appearance): Welcome → Sign in → Register (all fields, birthday row, chips) → Country → Waiting; Threads feed, a thread, compose; Marketplace list, new listing, messages; Events list and detail; Profile (edit, privacy, devices, notifications, activity); a merchant login: store, my offers, an offer.
5. **Nothing moved**: on each screen the spacing, alignment and colours match the same screen on the commit before this feature (`git stash` or a second build is the quickest comparison).
