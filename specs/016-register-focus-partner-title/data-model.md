# Data model: Register focus chain and partner question marking

**No persisted data changes.** No migration, no table, no column, no contracts type.

The partner answer shape this feature relies on is unchanged and already restricted to Q2–Q5:

| Entity | Where | Fields | Rule |
|---|---|---|---|
| `PartnerAnswers` | `packages/contracts/src/profiling.ts` (`partnerAnswersSchema`) | `languages`, `qualificationLevel`, `occupation`, `yearlyIncomeRange` | No settling (Q1) or relationship (Q6) field exists |
| PATCH `partner` body | same file, `sharedPatchFields.partner` | same four, all optional | `.strict()`: any other key is a 400 |
| `member_profiling_partner` | `server/migrations/039_partner_no_settling.sql` | settling columns dropped | Final with parent, by trigger (feature 013) |
| Partner step ids | `ProfilingStepId` | `partner-languages`, `partner-qualification`, `partner-occupation`, `partner-income` | Emitted by `profilingSteps` only when Q6 has `partner` or `family` |

## Client-side additions (not persisted)

| Item | Where | Values |
|---|---|---|
| Theme token `accentText` | `expo-client/german-world-club/src/constants/theme.ts` | light `#856B1A` (5.10:1 on `#fff`), dark `#E0BD4A` (10.7:1 on `#0B0D10`) |
| Register focus order | `src/app/(public)/register.tsx` | Full name → Email → Password → Mobile → Day → Month → Year (end) |
