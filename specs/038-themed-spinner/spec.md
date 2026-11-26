# Feature Specification: A themed, growing-arc loader on the web and in the app

**Feature Branch**: `038-themed-spinner`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: "use the sample code I give to you and update the spinner for both expo and the web application and loaders and use the application theme for the colors (the progress and the text will remain the same, you only get the spinner from the code I give you)". The sample is saved beside this file as `loading-spinner.html`.

## Context

Feature 030 gave the web console and the app one loader: a faint ring with a short arc turning at a steady speed. This feature replaces how that figure is drawn and moves. The supplied sample is a ring with an arc that **grows and shrinks while it turns**, so it reads as "working" and not as a stuck wheel.

What does not change: the loader's sizes, where it appears (page loaders, screen loaders, buttons that wait), its accessibility semantics (hidden from assistive technology; the label belongs to the wrapper), the "Loading …" text, the delay before a loader appears, and the progress bars used for file uploads. Only the figure changes.

The sample is a web page with its own blue, grey and dark mode. Those colours are the sample's, not the club's. The loader keeps taking its colours from each platform's own theme.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The web console shows the new loader (Priority: P1)

Wherever the web console shows a loader (a page waiting for data, a list loading more, a button waiting for the server), it shows the new figure: a ring with an arc that grows, shrinks and turns.

**Why this priority**: it is the part the person asked for, on the surface they use most.

**Independent Test**: open any console page with its data request held open; the new loader shows. Press a button with its request held open; a small loader shows inside it.

**Acceptance Scenarios**:

1. **Given** a page waiting for data, **When** it opens, **Then** the loader shows a ring with an arc that visibly changes length while it turns.
2. **Given** a button waiting for the server, **When** it is pressed, **Then** a small loader shows inside it in the button's own text colour, and the button keeps its size.
3. **Given** the loader inside navy text, a white button, or a gold-accent button, **Then** it takes that colour from the club's theme and never from a fixed blue.

---

### User Story 2 - The app shows the same loader (Priority: P1)

Every screen, list and button in the app that shows a loader shows the same figure with the same timing, drawn with the app's own theme colours in both light and dark.

**Why this priority**: the two faces are meant to look like one product (feature 030). A loader that differs between them reads as a different product.

**Independent Test**: open a screen with its request held open on iOS and Android, in light and dark.

**Acceptance Scenarios**:

1. **Given** a screen waiting for data, **When** it opens, **Then** the same growing-and-shrinking arc shows, in the theme's tint colour.
2. **Given** the dark theme, **Then** the loader stays clearly visible against the background.
3. **Given** a button waiting for the server, **Then** a small loader shows in the colour the button already uses for its label.

---

### User Story 3 - It stays accessible and honours the person's settings (Priority: P2)

A person who has asked for reduced motion still sees that something is working, so the loader slows down and keeps a fixed arc length instead of freezing. A person using forced colours (high contrast) sees it in system colours. Screen readers hear nothing extra.

**Why this priority**: required for the loader to be correct, but not what was asked for first.

**Independent Test**: turn on reduced motion and, on the web, forced colours; open a loading page.

**Acceptance Scenarios**:

1. **Given** reduced motion, **Then** the loader turns slowly, about four times slower than normal, and its arc does not change length.
2. **Given** forced colours on the web, **Then** the arc and ring use the system's text and background colours.
3. **Given** a screen reader, **Then** the loader itself announces nothing; the page or button around it still announces that it is busy.

### Edge Cases

- A browser that cannot animate a custom angle property still shows a turning arc of fixed length, not a broken figure.
- A browser without `background-clip: border-area` still draws a hollow ring, by masking.
- The smallest size (inside a button) must stay legible: the ring is never thinner than 2 px.
- Many loaders on one screen must not slow scrolling.
- A screen that is hidden or backgrounded must not keep animating at a cost.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The loader on the web MUST be drawn as a ring with an arc whose length grows and shrinks while it turns, following the supplied sample's motion (a 1.5 s turn, a 3 s grow-and-shrink cycle).
- **FR-002**: The loader in the app MUST show the same figure and timing, drawn without any new native module.
- **FR-003**: The four sizes (14, 20, 32 and 48 px) and the places a loader is used MUST NOT change. Page loaders, screen loaders, button loaders and the grace period before a loader appears MUST keep working as they do.
- **FR-004**: Colours MUST come from each platform's theme. On the web the arc takes the colour of the text it sits in (navy by default, white inside a primary button) and the ring is a faint tint of it. In the app the arc takes `theme.tint`, or the colour a caller passes (a button's label colour). No colour from the sample (its blue, greys or its own dark mode) may appear.
- **FR-005**: Under reduced motion the loader MUST turn about four times slower (6 s a turn) with a fixed arc length, and MUST NOT stop.
- **FR-006**: Under forced colours on the web the loader MUST use system colours.
- **FR-007**: The loader MUST remain decorative: hidden from assistive technology and carrying no text; the label stays with its wrapper.
- **FR-008**: The loader's size and ring thickness MUST be one definition per platform that the stylesheet and the component cannot disagree about, enforced by a test on the web.
- **FR-009**: The web stylesheet MUST NOT contain a colour literal, so the build's colour-token check keeps passing.

### Key Entities

- **Loader**: the figure itself, in four sizes, on each platform.
- **Loader wrappers**: the page loader (web), the screen loader (app) and the button's loading state, which place and label it. They are unchanged.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On both platforms the arc visibly changes length across one 3 s cycle, from a short dash to more than two thirds of the ring and back.
- **SC-002**: No colour value from the sample appears in the web or app source; every colour traces to a theme token or `currentColor`.
- **SC-003**: No existing loader test, page, screen or button behaviour changes: the web and app typecheck, the web suite and the loading-state scan pass.
- **SC-004**: With reduced motion on, the loader is still moving (one turn in 6 s) and its arc length does not change.
- **SC-005**: Ten loaders on one screen keep the app's frame rate indistinguishable from none (all motion runs on the native driver).

## Assumptions

- "The progress and the text will remain the same" means the loader's accessibility role and label, the "Loading …" strings, and the upload progress bars stay as they are; only the spinner's drawing and motion come from the sample.
- Slowing under reduced motion, rather than stopping, is taken from the sample and replaces feature 030's "nothing rotates under reduced motion". A loading indicator is essential content, which WCAG 2.2.2 exempts from the pause/stop rule, and the sample's reasoning ("so users still know work is in progress") is kept.
- The web console is one theme, not a light and dark pair (`client/src/styles/theme.css`); the app has both and follows the device.
- Browsers old enough not to support registered custom properties fall back to a fixed-length turning arc.
