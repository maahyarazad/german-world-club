# Feature Specification: Reset a forgotten password in the app, by SMS code

**Feature Branch**: `043-expo-password-reset` (not yet created; see plan.md)

**Created**: 2026-11-27

**Status**: Draft

**Input**: User description: "Add reset password section to the Expo application in the Sign in screen. It searches using the email or phone and sends an OTP to the phone for resetting the password (ideally I do not want to change the database at all). Follow the web client application for the structure and add the reset password section there."

**Follow-up request (2026-11-27)**: "I've added `main-bg-dark-01.png` and `main-bg-light-01.png`, so update the Expo main background: dark for the dark theme and light for the light theme. Update the sign-in screen style and add the gwc-logo icon in there, and use the exact same buttons style there, and also for the forgot password and reset password screens."

## Context

A member who forgets their password has no way to recover it **inside the app**. The sign-in screen offers an email and a password and nothing else. The only recovery today is on the web (`/konsole/passwort`): type an email address, receive a link by email, open it, choose a new password. A member who is on their phone, and whose mobile number is what the club already uses as their second factor, has to leave the app, find a browser and wait for an email.

This feature adds the same journey to the app, using the member's **mobile number** as the proof: the person says who they are by email or by mobile number, the club texts a code to the number it already holds for that member, and the code plus a new password completes the reset. The structure follows the web: one step to ask, one step to choose the new password.

Two things shape everything below. First, **whether an address or a number belongs to a member is not a public fact** (the club is invite-only), so the app must answer the first step identically whether or not an account matches. Second, a code that is only meant to reset a password must **never** be usable to sign in or to do anything else.

## Decisions taken on the requester's behalf

The request left these open. Each has a reasonable default, so none blocks planning; the first one needs the requester's explicit agreement because it touches the one thing they asked to avoid.

1. **One small database change is unavoidable; nothing else changes.** The table that stores one-time codes only accepts four named purposes (sign-in, device approval, mobile verification, email verification) and refuses any other. A reset code needs its own purpose, so one rule on that table is widened to allow it. No table, column, index or row is added or changed. The alternatives that avoid even that are unsafe (research R1): reusing an existing purpose would let a reset code sign someone in without a password. **If the requester still wants no database change at all, say so and the plan falls back to a weaker design described in research R1.**
2. **Members only.** Only members have a mobile number on record. Staff, merchant and partner accounts have none, so they get no code; they keep using the email link on the web. The app's answer is the same either way.
3. **The code is six digits**, valid five minutes, five wrong guesses and it is dead, a new one can be requested after 60 seconds, and at most three codes per hour per mobile number. (Sign-in codes are four digits; a reset code is the key to an account, so it is longer, as the email verification code already is.)
4. **One screen to finish.** After asking, a second screen takes the code, the new password and its repeat together, like the web's "choose a new password" screen. There is no intermediate token for the app to hold.
5. **A number the club cannot text gets nothing, silently.** That is a number that was never verified, a member who is locked or has left, or a country the club does not text. The first-step answer stays the same, so no one can tell the difference.
6. **A reset ends every session of the account** (as on the web) and the app returns to sign-in with a notice. It does not sign the person in automatically.
7. **The web client is not changed.** It keeps its email link. The new server steps do not depend on which client calls them, so the web can adopt them later. (The one addition in its folder is two small guard tests for the app's look under `client/tests/assets/`, because the app has no test runner; no web client code changes.)
8. **The backdrop follows the device's light or dark setting**, using the two images supplied. The app has no light/dark switch of its own, so it follows the phone, and changes while the app is open. The supplied images are 4875 x 10550 pixels (about 2 MB each); the app ships **phone-sized copies** of them (1170 px wide, as it already does for the old backdrop), never the originals.
9. **No wash over the light art; the dark wash stays.** The new light art is cream with gold lines and the theme's text is already readable on it (measured: 16.6:1 for body text, 5.5:1 for secondary text), so the pale wash is removed. The new dark art is mid-grey, and on it secondary text would fail (2.4:1 without a wash, against a 4.5:1 minimum), so the dark wash stays at about the strength it has today (5.2:1 with it). Details in research R13.
10. **The logo is the welcome screen's emblem, in the welcome screen's card** (the requester's choice, research R14): the same transparent emblem on the same card, so the club looks the same on the first screen and on the three screens a person meets before signing in.
11. **"The exact same buttons" means the app's standard button, laid out as on the welcome screen.** Every action on the sign-in, forgot-password and reset-password screens is the standard `Button` (the main action as the primary one, any other action as the secondary one), stacked full width with the welcome screen's spacing and maximum width. There are no text links and no custom buttons. The welcome screen and the sign-in code screen are not changed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask for a code from the sign-in screen (Priority: P1)

A member who has forgotten their password taps "Forgot password?" on the sign-in screen. They choose whether to identify themselves by email or by mobile number, enter it, and ask for a code. The app says a code is on its way if an account matches, and moves to the next step. If an account matches, a text message with a six-digit code arrives on the member's mobile.

**Why this priority**: Without it nothing else is reachable. It is also where the club's privacy rule is easiest to break.

**Independent Test**: With a member who has a verified mobile number: ask by email, then ask by mobile number; each time a text arrives on that number and the screen moves on. Ask with an address no one uses: the screen moves on identically and no text is sent.

**Acceptance Scenarios**:

1. **Given** the sign-in screen, **When** a person looks at it, **Then** there is a "Forgot password?" action that opens the reset screen without signing in.
2. **Given** a member with a verified mobile number, **When** they ask using their email, **Then** a six-digit code is texted to that number and the app moves to the code screen.
3. **Given** the same member, **When** they ask using their mobile number (any common way of typing it, with the country chosen from the list), **Then** the same happens.
4. **Given** an email or number that matches no member, **When** someone asks, **Then** the app shows exactly what it shows for a member, and nothing is sent.
5. **Given** a member whose mobile number was never verified, who is locked or has left, or whose country the club does not text, **When** they ask, **Then** the app shows the same as for anyone, and nothing is sent.
6. **Given** a merchant, partner or staff email, **When** it is entered, **Then** the app behaves as for an unknown address (these accounts have no mobile number on record).
7. **Given** a person who has asked, **When** the code screen opens, **Then** it never states or hints whether an account matched, and does not show any part of a phone number.
8. **Given** an email that is empty or not an email, or a number that is not a possible mobile number, **When** the person asks, **Then** the screen says what is wrong with what they typed and sends nothing.

---

### User Story 2 - Enter the code and choose a new password (Priority: P1)

The person types the six-digit code, a new password and the new password again, and saves. The password is changed, every session on the account is ended, and the app returns to sign-in with a message that the password was changed.

**Why this priority**: It is the point of the feature.

**Independent Test**: Ask for a code as in story 1, enter it with a new password, then sign in with the new password (works) and with the old one (refused).

**Acceptance Scenarios**:

1. **Given** the code screen with the right code and two matching passwords of at least eight characters, **When** the person saves, **Then** the password is changed, the app goes to sign-in with a "password changed, please sign in" message, and the new password signs in.
2. **Given** the password was changed, **When** anyone uses the old password, **Then** it is refused; and every session the account had, on any device, is ended.
3. **Given** a member who was marked as needing a password reset, or who was inactive, **When** they complete a reset, **Then** they no longer need one, and an inactive member is active again (as the email reset already does).
4. **Given** a password shorter than eight characters, or two passwords that differ, **When** the person saves, **Then** the screen says so before anything is sent, and **no guess at the code is used up**.
5. **Given** a wrong code, **When** the person saves, **Then** they are told the code is not correct or has expired and may try again or ask for a new one; after five wrong tries the code no longer works, and the screen's message is the same one (the app does not say which, because telling them apart would reveal whether an account exists; research R17).
6. **Given** a code older than five minutes, **When** it is entered, **Then** the person gets the same "not correct or has expired" message and may ask for a new one.
7. **Given** a code that has already been used, **When** it is entered again, **Then** it is refused.
8. **Given** the reset code, **When** it is presented anywhere that signs a person in, verifies a mobile number, or confirms an email address, **Then** it is refused exactly like a wrong code. A reset code does nothing except reset the password it was sent for.
9. **Given** a code that was requested on one phone, **When** it is entered on another, **Then** it is refused like a wrong code.

---

### User Story 3 - Ask again, and cope with mistakes (Priority: P2)

A code does not arrive, expires, or is mistyped. The person can ask for another one after a short wait, go back and correct what they typed, or give up and return to sign-in, without ever learning whether an account exists.

**Why this priority**: Real phones lose messages. Without it, the feature works only on the happy path.

**Independent Test**: Ask for a code, wait out the 60 seconds, ask again: a new code arrives and the old one stops working. Ask four times within an hour for one number: the fourth is refused with a "too many requests" message.

**Acceptance Scenarios**:

1. **Given** the code screen, **When** 60 seconds have passed, **Then** the person can ask for a new code (the app asks again with what they typed), and the earlier code stops working.
2. **Given** a code was asked for less than 60 seconds ago, **When** the person looks at the screen, **Then** the button to ask again is disabled and shows how long to wait. (The wait is the app's; the server's protection is the hourly limit below, which applies the same to everyone; research R17.)
3. **Given** three codes were already sent to one number in the past hour, **When** a fourth is asked for, **Then** it is refused with a "too many attempts, try later" message, whichever way the person identifies themselves, and no text is sent.
4. **Given** an account that does not exist, **When** the same request is repeated more than the limit allows, **Then** it is refused the same way (the limit does not reveal which accounts exist).
5. **Given** the person is on the code screen, **When** they go back, **Then** they return to the ask screen with what they typed still there.
6. **Given** the phone has no connection, **When** the person asks or saves, **Then** they are told they are offline and can try again.
7. **Given** the text message provider is unavailable, **When** a member asks, **Then** the screen shows the same as always; the member can ask again after the wait. (Why this is silent is in research R5.)
8. **Given** the interface language is German or English, **When** any of these screens or messages is shown, **Then** it is in that language.

---

### User Story 4 - The backdrop follows light and dark mode (Priority: P2)

A person using the phone in light mode sees the club's light backdrop (cream with gold lines); in dark mode they see the dark one (grey with yellow lines). If they change the phone's appearance while the app is open, the backdrop changes with it. Text stays readable on both.

**Why this priority**: It is what the requester asked for first, and it changes every screen, but it does not block recovering a password, so it follows the two P1 stories.

**Independent Test**: On a phone, open the app in light mode, then switch the phone to dark mode in Settings and return to the app without restarting it: the backdrop changes from the light art to the dark art, and back.

**Acceptance Scenarios**:

1. **Given** light mode, **When** any screen that shows the backdrop is open, **Then** it shows the light artwork.
2. **Given** dark mode, **When** the same screen is open, **Then** it shows the dark artwork.
3. **Given** the app is open, **When** the phone's appearance is changed, **Then** the backdrop changes at once, without restarting the app or navigating.
4. **Given** either mode, **When** body text and secondary text are shown over the backdrop, **Then** each meets a contrast of at least 4.5:1 against it.
5. **Given** the app is installed, **When** its files are inspected, **Then** no backdrop image wider than 1242 pixels is included.
6. **Given** a long list scrolling over the backdrop in either mode, **When** the person scrolls, **Then** it scrolls as smoothly as before this change.

---

### User Story 5 - The sign-in, forgot-password and reset-password screens share the club's look (Priority: P2)

The three screens show the club's logo at the top and use the same buttons, laid out the same way as the welcome screen, so signing in and recovering a password feel like one part of the app.

**Why this priority**: The requester asked for it for these three screens, and the two new screens are built to this look from the start so they are not built twice. It does not block recovering a password.

**Independent Test**: Open the sign-in screen, tap "Forgot password?", ask for a code, and reach the code screen: the logo is in the same place and size on all three, and every button is the standard primary or secondary button with the same width, height, corner and spacing as on the welcome screen.

**Acceptance Scenarios**:

1. **Given** each of the three screens, **When** it opens, **Then** the club's logo is shown above the content, undistorted, not clipped, and the same size on all three, in light and in dark mode.
2. **Given** each screen, **When** its actions are shown, **Then** the main action is the standard primary button and any other action is the standard secondary button, stacked full width with the same gap and maximum width as the welcome screen's two buttons, and no action is a text link or a differently styled control.
3. **Given** the sign-in screen, **When** it is used, **Then** everything it did before still works: the notices (approval pending, profile incomplete, password reset required), the failures (wrong password, locked, too many attempts, offline), and moving on to the sign-in code screen.
4. **Given** a small phone with the keyboard open, **When** a field is focused, **Then** the field and the main button can be reached (the screen scrolls; nothing is hidden behind the keyboard).
5. **Given** a screen reader, **When** the logo is reached, **Then** it is announced as the club's name, and the logo is not announced twice.
6. **Given** the welcome screen and the sign-in code screen, **When** they are opened, **Then** they look as they did before this change.

---

### Edge Cases

- A person asks using the email of an account **and** that account's mobile is shared by no one else (mobile numbers are unique, so a number names at most one member).
- Two codes are outstanding for one member (asked twice): only the newest works.
- The member's status changes between asking and saving (they are locked in the meantime): the code is refused like a wrong one.
- A person types the number with spaces, dashes, a leading zero, or with their country code but no `+`: it is read the way the registration screen reads it.
- The same person asks for a code from the app while a reset email link from the web is also outstanding: both remain valid independently; using either ends all sessions.
- The member's mobile number has changed since they last signed in: the code goes to the number now on record.
- The code screen is left open past five minutes: saving then reports the same "not correct or has expired" message as a wrong code, deliberately.
- A reset is completed while the person is signed in on another device: that device is signed out on its next request.
- The phone's appearance is "automatic" and changes at sunset while a form is half filled in: the backdrop changes, the typed text stays.
- A very small phone (375 x 667) in German, where the longest label wraps: the logo, fields and buttons still fit by scrolling, and no button label is cut off.
- A phone in landscape or a tablet: the content keeps its maximum width and stays centred; the logo does not grow past its set size.
- The logo image fails to load: the screen still works; the card is simply empty (the logo is bundled in the app, so this should not happen).

## Requirements *(mandatory)*

### Functional Requirements

**Asking**

- **FR-001**: The sign-in screen MUST offer a "Forgot password?" action that opens a reset screen reachable without being signed in.
- **FR-002**: The reset screen MUST let the person identify themselves by email address or by mobile number, one at a time, the mobile number with the same country-aware input the registration screen uses.
- **FR-003**: Asking MUST send a six-digit code by text message to the mobile number on record for the matching member, and only when that member exists, has a verified mobile number, is active or inactive (not locked or ended), and lives in a country the club texts.
- **FR-004**: The answer to asking MUST be identical in status, body and timing-relevant content for a matching and a non-matching identifier, for an ineligible member, and for any text-sending failure. It MUST NOT contain, or depend on, a phone number, a name, or the existence of an account.
- **FR-005**: Asking MUST be refused with a "too many requests" answer once three codes have been sent to one number in an hour, and the same limit MUST apply to an identifier that matches nothing, so the limit is not a way to learn which accounts exist.
- **FR-006**: Asking again MUST end the previous code, and the new code MUST also be six digits. The app MUST NOT offer a new code for 60 seconds after one was sent, and says how long to wait. The server MUST NOT answer a resend of a reset challenge any differently from a resend of a challenge that does not exist.

**Completing**

- **FR-007**: Completing MUST take the code, the device's identity and a new password, and change the password only when the code is right for that member, that purpose and that device, unspent, unexpired and under five wrong tries.
- **FR-008**: A password that is too short (under 8) or too long (over 256 characters), or two that differ, MUST be rejected before the code is checked, so a typo in the password never uses up a guess at the code.
- **FR-009**: A wrong, expired, spent or foreign code, a code for another device or another purpose, an unknown code id and a code whose member is no longer eligible MUST all be refused **with one and the same answer**; wrong tries MUST be counted and the fifth MUST end the code, without the answer changing.
- **FR-010**: Completing MUST end every session of the account, clear any "must reset" flag, reactivate an inactive member, and be recorded in the audit log without the code or the password.
- **FR-011**: A reset code MUST be unusable at every other place a one-time code is accepted (sign-in, device approval, mobile verification, email confirmation), and a code issued for those purposes MUST be unusable to reset a password.

**Where it lives**

- **FR-012**: The new screens MUST follow the web client's two-step structure and the app's existing screens, controls and copy conventions, in German and English.
- **FR-013**: After a successful reset the app MUST return to sign-in with a message saying the password was changed, and MUST NOT sign the person in.
- **FR-014**: The change MUST add no table, column, index or row to the database. The only change is to allow one more purpose on the existing one-time-code table (decision 1).
- **FR-015**: The identifier, the code and the password MUST NOT appear in logs or console output, and the client MUST NOT keep a server refusal in state or show it as a pop-up, except where the person cannot proceed without knowing why (a wrong code, an expired code, too many requests, offline).
- **FR-016**: The email-link reset on the web MUST keep working exactly as it does now.

**Look and feel**

- **FR-017**: The app's backdrop MUST show the supplied light artwork in light mode and the supplied dark artwork in dark mode, following the device's appearance and changing while the app is open.
- **FR-018**: The backdrop images included in the app MUST be phone-sized copies (no wider than 1242 pixels and no larger than 1.5 MB each); the full-size originals MUST NOT be included or decoded.
- **FR-019**: Body text and secondary text MUST stay at least 4.5:1 against the backdrop in each mode, and any wash laid over the backdrop MUST be a valid colour (fully transparent when none is wanted).
- **FR-020**: The sign-in, forgot-password and reset-password screens MUST show the club's logo above their content, the same size and position on all three, undistorted, with the club's name as its accessible description.
- **FR-021**: On those three screens every action MUST be the app's standard button (the main action as the primary one, any other action as the secondary one), stacked full width with the same gap and maximum width as the welcome screen's buttons. No text link and no custom-styled button.
- **FR-022**: The three screens MUST get their logo, spacing and action layout from one shared layout, so they cannot drift apart.
- **FR-023**: The sign-in screen's existing behaviour MUST be unchanged by the restyle.
- **FR-024**: The welcome screen and the sign-in code screen MUST look and behave as they did before this change.

### Key Entities

- **Reset code**: a six-digit, single-use, five-minute code tied to one member, one device and the single purpose "reset password". It exists only as a salted digest in the existing one-time-code table.
- **Member (as identified)**: found by email or by mobile number. Only a member with a verified mobile number, active or inactive, in a country the club texts, can receive a code.
- **Session**: the member's signed-in states on the web and on any phones; all are ended by a completed reset.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member who forgot their password can sign in with a new one, using only the app and their phone, in under 3 minutes from tapping "Forgot password?".
- **SC-002**: For a matching and a non-matching identifier, the response status, body and headers are byte-identical in 100% of tested cases (including ineligible members and text-sending failures).
- **SC-003**: A reset code is accepted at exactly one place; in tests, 0 of the other one-time-code endpoints accept it, and it opens no session.
- **SC-004**: A guess at the code succeeds at most 5 times in a million per code, and at most 15 in a million per number per hour (six digits, five tries, three codes).
- **SC-005**: After a completed reset, 0 sessions of that account remain usable.
- **SC-006**: No code, password, identifier or phone number appears in server logs or app console output in a scan of a full test run.
- **SC-007**: No migration adds or alters any table, column, index or row; the database change is limited to one widened rule on the one-time-code table.
- **SC-008**: In both appearance modes, body text and secondary text are at least 4.5:1 against the shipped backdrop with its wash (measured on the shipped art: light 16.6:1 and 5.5:1, dark 11.0:1 and 5.2:1).
- **SC-009**: No backdrop image included in the app is wider than 1242 pixels or larger than 1.5 MB.
- **SC-010**: The logo's size and position, and each button's variant, size and spacing, are identical on the sign-in, forgot-password and reset-password screens, because they come from one shared layout.

## Assumptions

- A member's mobile number on record is the one they proved at registration (or at a later contact change), and it is the number the club already texts for sign-in codes.
- The text-message provider and the country policy are the club's existing ones; a country the club does not text for sign-in is not texted for a reset either.
- The app already has a stable identity for the phone (the same one sign-in uses), and a code is bound to it.
- The web client's wording for "choose a new password" is reused where it fits; the app uses the formal form of address like the rest of its German copy.
- Staff, merchant and partner accounts keep using the emailed link on the web; making that reachable from the app is a separate piece of work.
- The two supplied background images are final art; the phone-sized copies are made from them without changing their look.
- The device's light or dark setting is what chooses the theme: the app has no switch of its own.
- The requester's uncommitted edit to the light backdrop wash (an empty string) is the start of this work and is kept in spirit, with the wash given a valid value.

## Out of Scope

- A "send me a link by email instead" action in the app, and any reset for staff, merchant or partner accounts.
- Changing the web reset page, or adding the code step to it.
- Signing the person in automatically after a reset.
- Changing a mobile number, recovering an account whose number is lost, or any support-assisted recovery.
- Changing the sign-in code length or the existing OTP limits.
- Restyling the welcome screen, the registration steps, the sign-in code screen, or any screen after sign-in.
- An in-app light/dark switch, and changing any theme colour other than the backdrop's wash.
- Redrawing the logo or making a transparent version of it (open item 5 in plan.md).
