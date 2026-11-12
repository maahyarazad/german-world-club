# Quickstart: validating Referral links and XP

How to show the feature works end to end. Shapes are in [contracts/http-api.md](./contracts/http-api.md)
and tables in [data-model.md](./data-model.md). Neither is repeated here.

## Prerequisites

```bash
npm run -w server migrate        # applies 040_referrals.sql
npm run -w server seed:dev       # the six fixed @test.invalid accounts
npm run -w server dev
npm run -w client dev
```

Mail and SMS codes are logged in development (CLAUDE.md), so every onboarding step can be
finished from the terminal.

For the app's link handling you need a **development build** with the new `associatedDomains`,
`intentFilters` and `expo-clipboard`. Expo Go and an over-the-air update are not enough (R9).
Set `EXPO_PUBLIC_LINK_HOST` to the host the server serves the `.well-known` files on.

## Automated checks

```bash
npm run -w server test -- referrals          # the new suites below
npm run -w server test -- onboarding         # register/verify-mobile unchanged without a code
npm run -w server test -- authz seo ops      # posture matrix, surfaces, PII scan
npm run -w client test && npm run -w client test:i18n
npx -w expo-client/german-world-club tsc --noEmit && npm run -w expo-client/german-world-club lint
```

The server suites to expect, each with a counter-assertion so they can't pass against a server
that does nothing:

| Suite | Asserts | Counter-assertion |
|---|---|---|
| `referrals/attribution.test.ts` | a code at register plus verify-mobile gives one referral and one award at the current rate | the same flow **without** a code gives no referral |
| `referrals/unverified.test.ts` | register with a code but never verify gives nothing | after verify, the referral exists |
| `referrals/exactly-once.test.ts` | 10 concurrent verify-mobile calls give 1 referral and 1 award | the counts are exactly 1, not ≥ 1 |
| `referrals/invalid-codes.test.ts` | unknown, retired, disabled and locked-owner codes give a byte-identical `/r/` 404 and identical register responses | an active code gives `200` |
| `referrals/self-referral.test.ts` | a staff or organisation owner's own email gives no referral, plus an audit `referral_refused` | another email gives a referral |
| `referrals/ledger-immutable.test.ts` | `UPDATE` / `DELETE` on `xp_entries`, `referrals` and `referral_xp_rates` is refused in raw SQL | `INSERT` succeeds |
| `referrals/balance.test.ts` | balance = Σ entries after award, reversal and rate change | the earlier award keeps its old amount |
| `referrals/staff.test.ts` | reverse once → 200, twice → 409, own entry → 403, no grant → 403 | the grant holder on someone else's entry succeeds |
| `referrals/no-pii.test.ts` | no owner or staff referral response contains email, mobile, birthday, country or denial reason | the referee's display name *is* present |
| `referrals/applicant-refused.test.ts` | an unapproved or unprofiled applicant gets refused on `GET /referrals` | an approved, profiled member gets `200` |

## Manual walkthrough (about 15 minutes)

1. **Get a link (web)**: sign in as the fixed member account and open **Refer & earn**. A link
   and a code appear. Reload: they are the same.
2. **Same link in the app**: sign in on the app as the same member, then **Profile → Refer &
   earn**. It shows the same code. Tap **Share** and the share sheet opens.
3. **Landing page**: open the link in a private window. You get `200` with the member's name, and
   **View source** shows the content with no script required. Check the response headers for
   `X-Robots-Tag: noindex`. Change one character of the code: you get the `404` page.
4. **Register on the web**: follow **Register on the web**. The code is prefilled. Register a new
   applicant with `primaryLanguage: german`, then take the SMS code from the server log and
   verify. The member's **Refer & earn** now shows the person as **Registered** and the balance
   at +100 XP.
5. **Register in the app**: on a device with the development build, tap the link in Notes or
   Messages. The app opens on Register with the code filled. Finish registration and verify the
   mobile. A second referral appears.
6. **Stages**: approve applicant 1 in **Admin → Bewerbungen** (or wait for auto-approval), then
   finish profiling as them. Their stage goes **Approved → Joined**, and the balance doesn't
   change. Deny applicant 2: the stage shows **Did not join**, with no reason, and the XP stays.
7. **Staff controls**: as a staff member with `referrals` `status`, reverse applicant 2's award
   with a reason. The member's balance drops by 100, and both entries appear in the history. Try
   to reverse it again and you get a conflict. Disable the member's link, then open it: you get
   the same `404` page as step 3's altered code.
8. **Rate**: with `edit`, set the rate to 150. Repeat step 4 with a new link and a new applicant:
   the new award is 150 and the old ones stay 100.
9. **Languages**: switch the console and the app to English and repeat step 1. Every label is
   translated and the XP number follows the locale.
