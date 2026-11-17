# Feature Specification: Device sessions, without a separate device approval

**Feature Branch**: `026-device-sessions` (not yet created; 025 is the branch currently checked out)

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: "once a user gets authorized, the use should able to access mobile application as well as the web application, we do not check the device approval, it would be nice to have device session and store it in the database and show it in the settings of the user profile"

## Clarifications

### Session 2026-11-17

- Q: Should a phone sign-in ask for the SMS code every time, or only on a phone the member hasn't used before? → A: Only on a phone with no earlier session; a known phone signs in with the password alone.
- Q: When a member ends another device from the list, should that phone be forgotten (SMS code next time) or stay known? → A: Forgotten. Ending from the list forgets the phone; an ordinary sign-out on the phone itself keeps it known.
- Q: Should each web browser be its own entry in the list, or share one "Web" entry? → A: Each browser is its own entry, labelled from what it reports (e.g. "Chrome on macOS").
- Q: Should an unused device session end by itself, and after how long? → A: Yes, after 30 days with no activity.
- Q: Should phones staff already approved under the old per-device approval count as known phones? → A: Yes. Approved records become known phones; pending and denied records are ignored (they neither block nor trust).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An approved member uses the app and the web together (Priority: P1)

A member whose membership has been approved signs in on the web and on their phone, on any phone, and both work. Nobody has to approve the phone separately, and signing in on one does not sign them out of the other.

**Why this priority**: This is the reported failure. An approved member (for example the demo member) is told in the app that their "application is still being reviewed" while the web works. Today an unapproved phone is refused, and a single active session per account means a sign-in on one face ends the other.

**Independent Test**: With one approved member, sign in on the web, then on a phone never used before. Both stay signed in and both can open their own pages.

**Acceptance Scenarios**:

1. **Given** an approved member who has never used a given phone, **When** they sign in on it, **Then** they reach the app after the SMS code, with no wait for staff.
   1a. **Given** a phone that member has signed in on before, **When** they sign in again, **Then** the password alone is enough and no SMS code is sent.
2. **Given** that member is signed in on the web, **When** they sign in on their phone, **Then** the web session stays valid.
3. **Given** that member is signed in on the phone, **When** they sign in on the web, **Then** the phone session stays valid.
4. **Given** a member whose membership application is *not* approved, **When** they sign in on any face, **Then** the application gate behaves exactly as before.
5. **Given** a locked, inactive or ended member, **When** they sign in on any face, **Then** they are refused exactly as before.

---

### User Story 2 - A member sees where they are signed in (Priority: P2)

In the settings of their profile, on the web console and in the app, a member sees a list of their devices and sessions: what it is (web browser, or phone platform and model where known), when it was first used, when it was last active, and which one they are looking at now.

**Why this priority**: It is what makes dropping the separate approval acceptable. The member can see every place that has access.

**Independent Test**: Sign in on two devices, open settings on either, and see both, with the current one marked.

**Acceptance Scenarios**:

1. **Given** a member signed in on two devices, **When** they open the profile settings, **Then** both appear and the current one is marked.
2. **Given** a device that signed out or whose session ended, **When** the list is opened, **Then** it is not shown as active.
3. **Given** another member's devices, **When** this member asks for them by any means, **Then** nothing is revealed and the answer is the same as for an unknown device.

---

### User Story 3 - A member signs out a device they do not recognise (Priority: P3)

From the same list, the member ends any other session. That device is refused on its next request and has to sign in again.

**Why this priority**: Seeing an unknown device is only useful if it can be dealt with.

**Independent Test**: Sign in on two devices, end one from the other, and confirm the ended one is refused on its next request while the current one is not.

**Acceptance Scenarios**:

1. **Given** two active sessions, **When** the member ends the other one, **Then** its next request is refused, it disappears from the active list, and if it is a phone its next sign-in needs the SMS code again.
   1a. **Given** a phone that signed out by itself, **When** it signs in again, **Then** the password alone is enough (it stays known).
2. **Given** the member ends their current session from the list, **Then** it behaves as signing out.
3. **Given** a session id that is not theirs, **When** they try to end it, **Then** the answer is identical to an unknown id and nothing changes.

---

### Edge Cases

- A phone that signed itself out stays known and signs in with the password alone. A phone ended from the list is forgotten.
- Locking or ending a member, or a password reset, also forgets every phone, so the next sign-in on each needs the SMS code.
- Two browsers on one computer, or a private window: each is its own entry; a private window is a new entry every time.
- Many sign-ins from one phone: a phone appears once, not once per sign-in.
- Two sign-ins at the same moment on the same device: one entry, no error.
- A session unused for 30 days: ended and removed from the active list; the next sign-in on a known phone needs the password only.
- A stolen refresh token used after its session was ended: refused, as today.
- Locking or ending a member, or a password reset: every session of that member ends, on every device.
- An old sign-in with no device name recorded: shown with a generic label rather than hidden.
- A member whose phone was approved before release: signs in with the password alone. One whose phone was pending or denied: gets the SMS code, then is let in.
- Members who today hold a single active session: no sign-in is lost by the change.
- A member with an application still pending (onboarding sessions): not listed as a trusted device.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A member whose application is approved or absent MUST be able to sign in on a phone without any per-device staff approval.
- **FR-002**: The system MUST allow one member to be signed in on the web and on one or more phones at the same time, and a new sign-in MUST NOT end sessions on other devices.
- **FR-003**: A second sign-in on the *same* device MUST replace that device's earlier session, so one device is one entry. A phone is identified by its device identifier; a web browser by a per-browser identifier the system issues on first sign-in and the browser keeps. A browser that loses it (cleared data, private window) appears as a new entry.
- **FR-004**: The SMS code MUST be required on a phone the member has not signed in on before, and MUST NOT be required on a phone they have (password alone). "Signed in on before" is recorded per member and phone and survives that phone's session ending or being signed out, and is cleared only when the member ends that device from the list (FR-008).
- **FR-005**: Every refusal that exists today for locked, inactive, ended, denied or unapproved-application members MUST be unchanged, on every face.
- **FR-006**: The system MUST store, per device session: the member, whether it is web or mobile, a device identifier (issued per browser on the web, reported by the phone on mobile), a display name or platform, first-seen time, last-active time, and whether it has ended and why.
- **FR-006a**: A device session with no activity for 30 days MUST end by itself, and then stops appearing as active. A phone that expires this way stays known (it was not ended by the member).
- **FR-007**: A member MUST be able to list their own active device sessions in profile settings on the web and in the app, with the current one identified.
- **FR-008**: A member MUST be able to end any one of their other sessions; the ended device MUST be refused on its next request, and an ended phone MUST be forgotten, so its next sign-in needs the SMS code.
- **FR-009**: The list and the end action MUST reveal nothing about other members' sessions, and a session that is not the caller's MUST answer exactly like one that does not exist.
- **FR-010**: Ending sessions, a new device's first sign-in and any end by the member MUST leave an audit record.
- **FR-011**: The list MUST NOT expose IP addresses, tokens or session secrets; it MAY show approximate recency and a device label only.
- **FR-012**: Permissions MUST still be resolved on each request, so a revoked grant takes effect on the next request on every device.
- **FR-013**: Existing per-device approval records MUST be carried over at release: an *approved* record makes that phone known for that member (no SMS code on it), and *pending* or *denied* records MUST NOT lock a member out nor make a phone known.
- **FR-014**: The previous "this device is awaiting approval" notice MUST no longer be shown to approved members.

### Key Entities

- **Device session**: one signed-in device of one member. Has a kind (web or mobile), a device identifier, a label, first-seen and last-active times, and an ended state with reason.
- **Member**: owns many device sessions at once.
- **Device approval (existing)**: a per-device staff decision. After this feature it no longer gates sign-in for approved members.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An approved member can sign in on a phone they have never used and reach the app in the same attempt, with no wait for staff, in 100% of cases where their credentials and code are correct.
- **SC-002**: A sign-in on one device never ends a session on another device (0 unexpected sign-outs in the test suite and in a manual web-plus-phone run).
- **SC-003**: A member can find the device list from the profile in no more than two taps or clicks, and see every active device.
- **SC-004**: A session ended from the list is refused on that device's next request, within one request.
- **SC-005**: Members with an unapproved, denied, locked, inactive or ended status see exactly the refusals they see today.
- **SC-006**: No other member's device information is obtainable through the list or end actions.
- **SC-007**: No session shown as active has been idle for more than 30 days.

## Assumptions

- "Authorized" means the existing membership approval; the application gate and profiling gate are unchanged.
- The per-device approval step is removed as a *gate* for approved members. The SMS code is kept for a first sign-in on a phone only (clarified); this relaxes today's code-on-every-sign-in rule (§6.2), which the plan must update along with its tests.
- This **supersedes the open work on branch `025-device-approval-pending`**: the pending-approval notice and row it adds are no longer wanted. Whatever of 025 is not merged should be dropped rather than extended (a decision to confirm at planning time).
- This **reverses two stated platform rules**: one active session per account (§12.7) and a new phone needing its own approval (§12.6, spec 009). Both documents and their tests need updating at planning.
- No limit on the number of simultaneous devices is imposed in this version, but unused sessions end after 30 days.
- Staff and organisation accounts are out of scope; they keep their current session behaviour.
- Existing session data is reused where possible; the device label comes from what the client already reports.
