# Feature Specification: Persisted Server Errors and Mobile Development Logging

**Feature Branch**: `012-error-persistence`

**Created**: 2026-09-24

**Status**: Draft

**Input**: User description: "persist the server 500 errors in the database - add logging to console for the expo client application only in the development mode so I can debug the mobile application"

## Context: what already exists

- **Server**: an unexpected failure during a request reaches the one central error handler. The handler writes a single error-level log line (with the stack and the request id) to standard output and answers the client with a generic problem and the same request id. **Nothing is stored.** Once the process output scrolls away or the host rotates it, the fault is gone. There is no error table, the audit log records security and business events only, and the in-process counters do not count server faults and reset on restart.
- **Request ids**: the server adopts a client-supplied `x-request-id` as the request's own id when it is well-formed, and only generates one otherwise. So the id written to the logs, to `audit_log` and to error bodies is not guaranteed to be unique or time-ordered: any client can choose it, repeat it, or pick one that sorts anywhere.
- **Mobile app**: every request goes through one API client, which turns a failed answer into an error carrying the server's problem. The app writes **no console output at all**, so while developing on a phone the only clue to a failure is what the screen shows.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Look up a server fault by its request id (Priority: P1)

A member reports "something went wrong" and quotes the reference shown on the error screen (the request id). An operator, or the developer, looks that reference up and sees what failed: when, on which route, for which kind of caller, and the error's cause and stack. This works days later and after the server has restarted, without access to the host's log output.

**Why this priority**: This is the reason for the feature. Today the reference a member reads out leads nowhere once the log output is gone.

**Independent Test**: Make a route fail unexpectedly, restart the server, then look up the request id from the failed response. The stored record is there and names the route and the cause.

**Acceptance Scenarios**:

1. **Given** a request fails with an unexpected server fault, **When** the response is sent, **Then** a record exists carrying the same request id as the response, with the time, method, route pattern, status, error name, message and stack.
2. **Given** that record exists, **When** the server restarts, **Then** the record is still there.
3. **Given** a request is refused for an ordinary reason (validation, not found, permission, rate limit), **When** the response is sent, **Then** no record is stored.
4. **Given** the request carried a password, token, one-time code or contact detail, **When** its fault is recorded, **Then** none of those values appears anywhere in the record.

---

### User Story 2 - See the mobile app's traffic and failures in the development console (Priority: P1)

While running the mobile app in development, the developer sees in the Metro / developer console every request the app makes (method, path, status, duration and the server's request id) and every failure, including the server's problem type. They can match a failing screen to the exact server request and then to its stored server record (Story 1).

**Why this priority**: The user asked for this explicitly, to debug the mobile app. It is independent of Story 1 and delivers value alone.

**Independent Test**: Start the app in development mode, sign in and open a screen whose request fails. The console shows the request line, the status, the problem type and the request id. Build a release version, repeat, and the console shows nothing from the app.

**Acceptance Scenarios**:

1. **Given** the app runs in development mode, **When** it makes a request, **Then** one console line shows the method, the path, the status, the duration and the request id the server returned.
2. **Given** the app runs in development mode, **When** a request fails (server problem, network failure, or an error thrown in the app and not handled), **Then** the console shows it at error level, with the problem type or the error's message.
3. **Given** the app runs in development mode, **When** a request carries a bearer token, refresh token, password, one-time code or push token, **Then** none of those values appears in the console.
4. **Given** a release build (preview or production), **When** the same actions happen, **Then** the app writes nothing to the console. The logging is not merely hidden: it is absent from the build's behaviour.

---

### User Story 3 - Review recent server faults (Priority: P2)

A staff member responsible for the platform opens a read-only page in the staff console and sees recent server faults without a request id to start from, newest first, and can tell a single fault from the same fault repeating.

**Why this priority**: Useful once records exist, but Story 1 already makes a fault findable. This story is about noticing faults before anyone reports them.

**Independent Test**: Cause the same fault three times and a different one once. The review shows both faults, newest first, and the repeated one is recognisable as the same fault.

**Acceptance Scenarios**:

1. **Given** several faults have been recorded, **When** the review is opened, **Then** they are listed newest first, each showing time, route, status, error name and request id.
2. **Given** the same fault has happened repeatedly, **When** the review is opened, **Then** the occurrences can be recognised as one fault (a shared fingerprint).
3. **Given** a person without the required permission, **When** they try to open the review, **Then** they are refused, and the console does not show the section.
4. **Given** a staff member with the permission, **When** they enter a request id in the staff console, **Then** they see that fault's full record, or a clear "no fault recorded for this id".

---

### Edge Cases

- **A client sends its own request id.** The server still generates the request's id. The client's value is kept as a separate *client correlation id*: echoed back on its own header, shown next to the real id in the logs, and stored on a fault record. It can be used to find a support case, but it never replaces the server's id. A malformed value is dropped and not echoed.

- **The database itself is the cause.** A fault caused by the database being unreachable cannot be stored in that database. The client still receives its normal error response, just as quickly, and the fault still appears in the log output. Failing to store a record never changes the response or turns into a second error.
- **A flood of faults.** When a dependency fails and every request errors, recording must not become the extra load that deepens the outage. Recording is bounded: once a cap is reached, further occurrences within the window are counted rather than stored in full.
- **A very long message or stack.** Stored text is truncated to a fixed maximum, so one pathological error cannot make a huge record.
- **Faults outside a request** (scheduled jobs, startup). They are not "500 responses", so they are out of scope here. Job failures already have their own log line and counter.
- **Intentional refusals marked 5xx.** Load shedding, draining, an open circuit breaker and deadline expiry are deliberate, expected answers during degradation, not faults, and are not stored. They already have counters.
- **The mobile app is offline.** A request that never reaches the server is logged in development as a network failure, with no status or request id.
- **Mobile development logging on a physical device.** It appears in the same developer console as the app's other development output, with no extra tools needed.

## Requirements *(mandatory)*

### Functional Requirements

**Server fault records**

- **FR-001**: The system MUST store a durable record of every request that ends in an unexpected server fault (the generic "internal error" answer).
- **FR-002**: Each record MUST carry the request id the client received, the client correlation id when one was supplied (FR-018), the time, the HTTP method, the route pattern (not the raw URL with its query string), the status, the error's name and code, a message and stack truncated to a fixed maximum, and the kind of caller (anonymous, member, staff, organisation) with their internal id where authenticated.
- **FR-003**: A record MUST NOT contain request or response bodies, headers, cookies, query strings, credentials, tokens, one-time codes or member contact details. The same central redaction rules as the log output apply, so a field added later is covered without remembering to.
- **FR-004**: Recording MUST happen after the response has been decided, and a failure to record MUST NOT change the response's status, body, or timing beyond a small fixed bound. The fault MUST still be logged when recording fails.
- **FR-005**: Refusals that are not faults (4xx, and deliberate 503/504 answers from load shedding, draining, open breakers and deadlines) MUST NOT be stored.
- **FR-006**: Recording MUST be bounded under a burst. Beyond a fixed number of stored records per minute, further occurrences are counted rather than stored in full, and the count is visible.
- **FR-007**: Records MUST be kept for 30 days and then removed by a scheduled job that can be switched off individually, like every other job.
- **FR-008**: Each record MUST carry a fingerprint (the same error at the same place yields the same fingerprint), so repeats of one fault can be grouped.
- **FR-009**: Records MUST be readable by request id, and as a newest-first list, by whoever holds the permission defined in FR-010. Nobody else may read them.
- **FR-010**: Records MUST be reviewable on a read-only page in the staff console (a newest-first list, and lookup by request id), gated on a new staff permission that is granted by default only to superadmins. The page and its data are never indexed. No staff action edits or deletes a record. Only the retention job removes them.
- **FR-010a**: The console page MUST follow the console's existing language handling. All its interface strings exist in both German and English, while stored error messages and stacks are shown as recorded, untranslated.
- **FR-011**: Error responses and the log output MUST stay as they are today. The client still gets the generic problem with the request id, and the log line is unchanged.

**Request identity**

- **FR-017**: Every request's id MUST be generated by the server, unique and sortable by creation time. A value the client supplies MUST NOT become the request's id, the id in `audit_log`, the id in an error body, or the id a fault record is keyed on.
- **FR-018**: A well-formed client-supplied correlation id MUST be kept separately for that request: echoed back on a distinct response header, attached to every log line of that request next to the server's id, and stored on a fault record when one is written. A malformed value MUST be ignored entirely: not echoed, not logged, not stored.

**Mobile development logging**

> **Superseded 2026-09-25.** At the user's request, both clients now log with plain `console.log` / `console.error`, in every build, and show no refusal on screen (see `CLAUDE.md`, "Clients report failures to the console"). FR-012 to FR-016 below describe the development-only `devLog` design that was built and then replaced; FR-015 (silent release builds) and FR-016 (single guarded logger) no longer hold.


- **FR-012**: In development mode only, the mobile app MUST write one console line per API request, with method, path, status, duration and the server's request id.
- **FR-013**: In development mode only, the mobile app MUST write failed requests and unhandled errors to the console: server faults (5xx), network failures and unhandled errors at error level, and refusals (4xx) at warning level, since a refusal is usually the server saying no on purpose. A server problem is shown by its problem type and request id.
- **FR-014**: The mobile development logging MUST redact bearer and refresh tokens, passwords, one-time codes, push tokens and contact details. Request bodies are not printed in full.
- **FR-015**: In any non-development build, the mobile app MUST write nothing to the console. The development logging MUST NOT depend on a runtime setting that could be switched on in a release build.
- **FR-016**: The mobile development logging MUST go through a single logger. Screens and modules MUST NOT call the console directly, so the development-only guard and the redaction cannot be bypassed.

### Key Entities *(include if feature involves data)*

- **Server fault record**: one unexpected fault that ended a request. Holds the request id (the server-generated lookup key a member can quote, unique per record), the client correlation id if one was supplied, the time, the method, the route pattern, the status, the error name and code, the truncated message and stack, the caller kind and id, and the fingerprint. Kept for 30 days. Never edited after it is written.
- **Suppressed-occurrence count**: how many faults were counted but not stored in full during a burst, per minute window, so a flood is visible even though it was not recorded row by row.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of requests that end in an unexpected server fault, while the database is available and below the burst cap, can be looked up by their request id afterwards, including after a server restart.
- **SC-002**: No stored record contains a credential, token, one-time code, contact detail, request body or query string. Verified by an automated test that sends every sensitive field into a failing request.
- **SC-003**: When the database is unavailable, clients still receive their error response within the same time bound as without this feature, and no request fails because of recording.
- **SC-004**: A developer can go from a failing screen in the mobile app to the matching server record in under one minute, using only the development console and the request id it shows.
- **SC-005**: A release build of the mobile app writes zero lines to the console across a full sign-in and browse session.
- **SC-006**: Records older than 30 days are gone within one day of expiring.
- **SC-007**: No request id recorded anywhere (responses, logs, audit log, fault records) was chosen by a client. Verified by an automated test that sends a well-formed client id and finds it only in the correlation fields.

## Assumptions

- "500 errors" means unexpected server faults, i.e. the generic internal-error answer. Deliberate 503/504 answers during degradation are excluded (FR-005) because they are expected, already counted, and would flood the store during exactly the outage they describe.
- Storage is the platform's existing primary database. An external error-tracking service is out of scope. It could be added later alongside this without replacing it.
- The retention period is 30 days, long enough to answer a member's report after a weekend or holiday, and short enough that stack traces do not pile up.
- "Development mode" for the mobile app means a build running against the development bundler. Preview and production builds count as release builds.
- Mobile logging is console output only. Mobile errors are not sent to the server or stored in this feature.
- Faults in scheduled jobs and at startup are out of scope. They keep their existing log line and counter.
