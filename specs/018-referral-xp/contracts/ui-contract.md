# UI contract: Referral links and XP

What each face shows, where, and the behaviour that tests or review pin down. Every string
lives in the i18n catalogues (web `client/src/i18n/{de,en}.ts`, app `src/i18n/{de,en}.ts`), and
`test:i18n` fails on a missing key in either direction. Numbers and dates follow the active
locale. XP is shown as "1.200 XP" or "1,200 XP", **never with a currency symbol** (FR-016).

## Screens

| Face | Who | Where | Entry point |
|---|---|---|---|
| Web | member | `/konsole/mitglied/empfehlen` | Sidebar item "Empfehlen & verdienen" / "Refer & earn" |
| Web | merchant / partner user | `/konsole/{merchant,partner}/empfehlen` | `OrganisationLayout` navigation |
| Web | staff (own) | `/konsole/admin/empfehlen` | Admin sidebar, shown to every staff member |
| Web | staff (oversight) | `/konsole/admin/empfehlungen` | Admin sidebar, behind `RequireGrant module="referrals" flag="read"` |
| App | member | `(member)/profile/referrals` | Row on the profile screen (no sixth tab, R19) |
| App | merchant / partner user | `(organisation)/referrals` | Button on the organisation home screen |
| Web | prospective member | `/konsole/registrieren?ref=CODE` | The landing page |
| App | prospective member | `r/[code]` → `(public)/register` | A universal link / App Link, or `germanworldclub://r/CODE` |

## Refer & earn (all owner faces)

One shared layout:

1. **Your link**: the full URL and the formatted code (`ABCD-EFGH`). **Copy link** and
   **Copy code** on both faces, plus **Share** in the app (`Share.share`, link and a short
   message). After copying, the confirmation reads "Copied" for 2 s, as local state.
2. **Replace link**: behind a confirm dialog that says the old link stops working for new
   sign-ups and people already referred stay credited.
3. **XP balance**: one number, then the counts per stage.
4. **Your referrals**: a paged list showing name (R15), stage badge, and the date of the
   current stage. Empty state: "Nobody has signed up with your link yet".
5. **XP history**: a paged list of amount (+/−), reason ("Referral: Jana K.", or "Reversed:
   *{staff reason}*"), and date.

The stage badges map `registered → Registriert/Registered`, `approved → Bestätigt/Approved`,
`joined → Beigetreten/Joined` and `did_not_join → Nicht beigetreten/Did not join`.

**Errors**: following CLAUDE.md, a failed load logs
`console.error('Referrals.load', problem)` and shows the screen's existing "could not load"
state with a retry. Nothing a server refusal says is kept in state.

## Registration (both faces)

- An optional **Empfehlungscode / Referral code** field, prefilled from `?ref=` (web) or from the
  draft (app), editable and clearable.
- Clients normalise the code as it is typed, for display only (`formatReferralCode`). Nothing is
  validated against the server, and an invalid code produces **no message** (FR-006, R10).
- The field doesn't change anything else on the form, and doesn't change what the applicant
  sees after they submit.

## App deep link (`src/app/r/[code].tsx`)

- Signed out: write `referralCode` into the registration draft, then
  `router.replace('/(public)/register')`.
- Signed in (any session): `router.replace('/')`. The code is ignored, because an existing
  account can't be referred.
- A malformed code still opens Register with the field filled. The server decides.

## Staff oversight (web)

- **Owners**: a searchable table of name, kind, link state, number of referrals per stage, and
  XP balance.
- **Owner detail**: the same referral and XP lists as Refer & earn. **Disable link** and
  **Reverse** each open a dialog with a required reason (1–500 characters), shown only with
  `status`. Both buttons are hidden on the staff member's own record, and the server refuses
  them anyway.
- **XP rate**: the current rate and its history, plus **Change rate** (`edit`) with a required
  reason. The dialog says the change applies to new referrals only.
