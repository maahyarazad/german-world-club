# Feature Specification: Superadmin dashboard numbers, and Roles & permissions

**Feature Branch**: `028-superadmin-dashboard-roles` (not yet created; branch from `main`)

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: "in the Super Admin panel at the dashboard, instead of the list of granted areas, view the number of current active users, number of requests, number of merchants, number of listings, etc. Implement the Roles & permissions (Not available yet) for the super admin so he can view all the roles and upgrade the rules if that does not break the database rules, otherwise it should be disabled with a tooltip to explain why it is disabled."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The dashboard shows the state of the club in numbers (Priority: P1)

A superadmin opens the Admin Panel and sees how the club stands: how many members are active, how many membership applications are waiting, how many merchants and partners are active, how many marketplace listings are live, how many requests about listings were made, how many reports are open, how many events are coming up, and how many staff accounts are active. These replace the four tiles about granted areas and the long list of areas.

**Why this priority**: It is what the superadmin sees first, and it is the first thing asked for. It needs no new permission model.

**Independent Test**: Seed a known population, sign in as a superadmin, and compare every number on the dashboard with a count of the underlying records.

**Acceptance Scenarios**:

1. **Given** a superadmin, **When** they open the Admin Panel, **Then** they see the numbers listed above, each with a label, and the "granted areas" tiles and list are gone.
2. **Given** members who are locked, inactive or ended, **When** the dashboard is shown, **Then** only active members are counted as active.
3. **Given** an applicant whose application is waiting for staff, **When** the dashboard is shown, **Then** they are counted under waiting applications and not under active members.
4. **Given** a staff member who is not a superadmin, **When** they open the Admin Panel, **Then** they still see their own areas as before and no club-wide numbers, and asking for the numbers directly is refused.
5. **Given** the numbers cannot be loaded, **Then** the dashboard shows that they are unavailable instead of showing zeroes.

---

### User Story 2 - A superadmin sees every staff account and what it may do (Priority: P1)

Under Roles & permissions the superadmin sees every staff account with its role (superadmin, administrator, staff), whether it is active, and the grid of what it may do in each area (read, create, edit, delete, change status). The entry stops being marked "Not available yet" for them.

**Why this priority**: The Roles & permissions area is empty today, and viewing is the safe half of the request.

**Independent Test**: Create staff of each role with different grants, open the page as a superadmin, and check that each account and each grant is shown correctly, and that no password or secret is in the page.

**Acceptance Scenarios**:

1. **Given** several staff accounts, **When** a superadmin opens Roles & permissions, **Then** each is listed with role, active state, and its grants per area.
2. **Given** an area an account has no grant for, **Then** it shows no permissions for that area (absence is denial, as everywhere else).
3. **Given** a non-superadmin, **When** they open the page, **Then** they cannot see or change administrators, even if they hold a grant on this area.

---

### User Story 3 - A superadmin changes roles and permissions, and is told when they cannot (Priority: P2)

The superadmin can change an account's grants, promote or demote an account between roles, and activate or deactivate it. A change that the platform's rules forbid is not hidden: its control is disabled and a tooltip says why. The rules are the ones the platform already enforces: the last active superadmin cannot be demoted or deactivated, and nobody can demote or deactivate their own account. A change takes effect on the account's next request.

**Why this priority**: It is the second half of the request, and it carries the risk (locking the club out of its own administration), so it comes after viewing.

**Independent Test**: As a superadmin, change another account's grants and see it act on its next request; then try to demote the last superadmin, and your own account, and see both disabled with a reason and refused if forced.

**Acceptance Scenarios**:

1. **Given** a staff account, **When** the superadmin grants it "read" and "change status" on an area, **Then** the account can use exactly those on its next request and an audit entry records who changed what, from what, to what.
2. **Given** the only active superadmin, **When** the page is shown, **Then** the controls to demote or deactivate them are disabled with a tooltip saying at least one active superadmin must remain.
3. **Given** the signed-in superadmin's own row, **Then** the controls to demote or deactivate themselves are disabled with a tooltip saying why.
4. **Given** a change the page allows, **When** another change has made it invalid in the meantime (for example two superadmins demoting each other at once), **Then** the system refuses it with a clear message and the club still has an active superadmin.
5. **Given** an account promoted to superadmin, **Then** its per-area grants no longer apply (a superadmin bypasses them) and the page says so instead of letting the grid suggest otherwise.
6. **Given** an account that is deactivated, **Then** its sessions stop working at its next request and it can be activated again later.

---

### Edge Cases

- A page showing a stale view: the superadmin deactivates an account that someone else has just changed; the system must refuse or show the conflict, never overwrite silently.
- Two superadmins edit the same account at the same time.
- A grant on an area that exists in the permission list but has no working pages yet ("Not available yet"): it can still be granted.
- Removing every flag of an area from an account: the area disappears from that account's list (absence is denial).
- The staff list is long: it must stay usable and show a loading and an empty state.
- A numbers request fails part-way (one count fails): the dashboard shows which number is unavailable.
- An account with no display name: shown by email.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: For a superadmin, the Admin Panel dashboard MUST show these numbers: active members, membership applications waiting for staff, active merchants, active partners, live marketplace listings, requests about listings in the last 30 days, open reports (marketplace and threads together), upcoming events, and active staff accounts. The granted-areas tiles and the list of areas MUST NOT be shown to a superadmin.
- **FR-002**: Every number MUST come from the same record the rest of the platform treats as the truth for that thing (for example, "active member" is a member whose status is active), and MUST be computed on the server.
- **FR-003**: A staff member who is not a superadmin MUST keep the existing dashboard, and a request for the club-wide numbers MUST be refused for them.
- **FR-004**: A number that cannot be computed MUST be shown as unavailable, never as zero.
- **FR-005**: The Roles & permissions area MUST be available to a superadmin and MUST list every staff account with role, active state and per-area grants.
- **FR-006**: Roles MUST be derived from existing account attributes (superadmin, administrator, staff); this feature MUST NOT introduce a separate role table (the permission matrix is preserved as is).
- **FR-007**: A superadmin MUST be able to change an account's per-area grants, role, and active state, one account at a time.
- **FR-008**: The system MUST compute, on the server and for each account and each possible change, whether the change is allowed and, when it is not, a reason code; the page MUST disable the control and show a tooltip for that reason. The page MUST NOT decide this itself.
- **FR-009**: The system MUST refuse, whatever the page shows: demoting or deactivating the last active superadmin; demoting or deactivating one's own account; any change to an administrator or superadmin by someone who is not a superadmin.
- **FR-010**: Every change MUST be audited with who, which account, and the before and after of what changed.
- **FR-011**: A change MUST take effect on the account's next request, with no wait for a session or token to expire.
- **FR-012**: A concurrent or stale change MUST be refused with an explanation, never silently overwrite another change, and MUST NOT be able to leave the club without an active superadmin.
- **FR-013**: The page MUST NOT expose password hashes, session secrets or anything that lets one account act as another.
- **FR-014**: Creating or deleting staff accounts is out of scope; this feature changes existing accounts only.
- **FR-015**: All text MUST be available in German and English, and the server MUST send reason codes, not translated sentences.

### Key Entities

- **Staff account**: a person who signs in to the Admin Panel; has a role, an active state, and grants.
- **Role**: superadmin, administrator or staff, derived from the account's attributes.
- **Grant**: for one account and one area, which of read, create, edit, delete, change status are allowed. No row means none.
- **Dashboard figure**: a named count with a label, computed on the server.
- **Constraint**: a rule that forbids a particular change to a particular account, with a reason code.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A superadmin sees all nine figures within 2 seconds of opening the Admin Panel, and each equals the count of the records it describes in the test population.
- **SC-002**: 100% of staff accounts are listed with correct role and grants, and no secret appears anywhere in what the page receives.
- **SC-003**: A grant change is in effect on the account's next request (0 requests later than the change are served under the old grant).
- **SC-004**: In every attempt to leave the club with no active superadmin, by any route, the attempt fails and an active superadmin remains (0 successes).
- **SC-005**: Every control that cannot be used has a tooltip with the reason, and every one that can be used succeeds when used (no control is disabled without a reason, none is enabled and then refused for a known rule).
- **SC-006**: A non-superadmin cannot read the numbers or change any administrator (0 successes), including by holding a grant on the Roles & permissions area.
- **SC-007**: Every change leaves an audit entry stating who, what and before/after.

## Assumptions

- "Requests" is read as requests about marketplace listings (one conversation per member per listing, last 30 days) and, separately, membership applications waiting for staff; both are shown and labelled so neither is mistaken for the other. Say if you meant only one.
- "Merchants" means active merchant organisations; partners are shown beside them.
- "View all the roles" means all staff accounts with their grants: the platform has no role table, only the three-level account attribute and the per-area grid, and §11 says the grid is preserved as is.
- "Upgrade the rules" means changing grants and roles. Editing the rules of the system itself (the list of areas, which pages exist) is out of scope.
- Granting an area that has no working pages yet is allowed.
- The existing dashboard stays for staff who are not superadmins.
- The existing rules (last active superadmin, self-demotion, only a superadmin manages administrators) are the complete list of "database rules" for this feature; new ones are not added.
