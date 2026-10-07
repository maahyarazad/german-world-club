# Feature Specification: Register field focus chain and partner question marking

**Feature Branch**: `016-register-focus-partner-title`
**Created**: 2026-10-06
**Status**: Draft
**Input**: "On the Register.tsx in the Expo RN application use useRef so when user hits
enter the next field comes in focus — in the Partner Question section which is in StepView
in the steps.tsx use the gold color only for partnerTitle text so user can understand these
questions are related to the partner — make sure partner does not get the Q1
(`PFQ -->|Yes| PART[["Partner questionnaire: German Q2–Q5, without the relationship and
family-status question"]]`) — check the web application as well for this."

> Written alongside `/speckit-plan` because no spec existed for this request. It records
> the request as given; it does not add requirements beyond it.

## User Scenarios & Testing

### User Story 1 — Move through Register with the keyboard (P1)

An applicant filling in the app's Register screen presses the keyboard's return/next key
and lands in the next field, without reaching for the screen.

**Acceptance**:

1. **Given** focus in Full name, **When** return is pressed, **Then** Email is focused and the
   keyboard stays up.
2. Email → Password → Mobile → Day → Month → Year, in that order.
3. **Given** focus in Year, **When** return/done is pressed, **Then** the keyboard closes
   (the remaining inputs are chips, which take no keyboard focus).
4. **Given** a numeric keyboard with no return key (iOS number pad), **When** Day or Month
   reaches its full length, **Then** focus moves to the next date field.

### User Story 2 — See which questions are about the partner (P1)

A member who picked Partner or Family at Q6 sees the four partner questions with the
partner part of the heading ("Your partner:" / "Ihre Partnerschaft:") in gold, so they are
not mistaken for a repeat of the member's own Q2–Q5.

**Acceptance**:

1. **Given** a partner step, **Then** only the `partnerTitle` text is gold; the question itself
   keeps the normal title colour.
2. **Given** any non-partner step, **Then** no gold appears in the title.
3. The gold is legible in both colour schemes.

### User Story 3 — The partner is never asked Q1 (P1)

Per the business description, the partner questionnaire is German Q2–Q5 only, with no
settling question (Q1) and no relationship/family question (Q6), on both pathways and in
both clients.

**Acceptance**:

1. **Given** Q6 includes Partner or Family, **Then** the steps after Q6 (and kids) are exactly
   partner languages, qualification, occupation, income.
2. A `partner` body carrying a settling field is refused by the server (400).
3. Holds for the Expo app and the web console.

## Requirements

- **FR-001**: Register (Expo) MUST chain focus through its text inputs on submit, in visual
  order, keeping the keyboard open between fields.
- **FR-002**: The last text input (Year) MUST close the keyboard on submit and MUST NOT submit
  the form (gender, language and age confirmation are still to be chosen).
- **FR-003**: Day and Month MUST advance focus on reaching two digits.
- **FR-004**: On Expo partner steps the `partnerTitle` portion of the heading MUST render in
  a text-legible gold (≥ 4.5:1 against the screen background in each scheme); the question
  part MUST keep the default title colour.
- **FR-005**: The partner MUST NOT be offered Q1 (settling) or Q6 on either client, and the
  server MUST refuse settling fields under `partner`.
- **FR-006**: The screen-reader name of a partner heading MUST stay the full
  "Your partner: <question>" string.

## Success Criteria

- **SC-001**: Register can be completed from Full name to Year using only the keyboard's
  return/next key (Android) or return plus auto-advance (iOS).
- **SC-002**: Every partner step shows a gold partner label and no other step does.
- **SC-003**: Contract, server and web tests asserting "no partner settling" pass.
