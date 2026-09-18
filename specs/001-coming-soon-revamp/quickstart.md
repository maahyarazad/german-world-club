# Quickstart: Validating the Experts Circle Coming-Soon Experience

**Feature**: `001-coming-soon-revamp` | **Date**: 2026-09-11

How to run and prove this feature works end to end. Implementation detail belongs in `tasks.md`; this document is the validation guide.

## Prerequisites

| Requirement | Version | Verified in this environment |
|---|---|---|
| Node.js | ≥ 20 | 22.23.2 ✓ |
| npm | ≥ 10 | 10.9.8 ✓ |
| Chrome/Chromium | current | for Lighthouse and the responsive sweep |

> **Before you start**: this project has **no git repository initialised**, and Phase A deletes `src/assets/bg/*.jpg`, `hero.png`, `react.svg`, and `vite.svg`. Those deletions are unrecoverable. Run `git init && git add -A && git commit -m "baseline"` first. (`sample-html.html` independently preserves the original design with its images base64-embedded.)

## Setup

```bash
npm install
npm install tailwindcss@^4.3.3 @tailwindcss/vite@^4.3.3
npm install -D vitest@^4 @testing-library/react@^17 @testing-library/jest-dom jsdom vitest-axe
```

Optional — override the launch date without editing source:

```bash
echo 'VITE_LAUNCH_DATE=2026-12-01T09:00:00+04:00' > .env.local
```

## Run

```bash
npm run dev        # dev server with HMR
npm run build      # production build → dist/
npm run preview    # serve the production build
npm test           # Vitest suite
npm run lint       # ESLint
```

---

## Validation scenarios

Each scenario maps to a user story and its success criteria. See [spec.md](./spec.md) for full acceptance scenarios and [contracts/](./contracts/) for the guarantees under test.

### V1 — Visitor understands what is coming *(US1, P1)*

```bash
npm run dev
```

Open the dev server URL.

**Expect**: brand name, tagline, and an explicit pre-launch status all visible **without scrolling**. Scrolling reveals the offering, countdown, about, and contact sections in that order. No Vite cube logo, no purple `#863bff`, no "WELCOME" raster bands anywhere.

**Fails if**: the page still shows the bare domain as its only content, or any section is unreachable because `body { overflow: hidden }` survived.

*Covers SC-001. Contract: `<Hero />`, `<Offering />`, `<About />`.*

### V2 — Responsive across all supported widths *(US1, FR-008)*

In DevTools device toolbar, step through **320 / 375 / 768 / 1024 / 1280 / 1920 / 2560 px**.

**Expect**: no horizontal scrollbar at any width; no clipped or overlapping text; the offering grid reflows from 1 column to multi-column; body copy stays within a comfortable measure at 2560 px rather than stretching edge to edge.

Quick check for the classic failure — paste in the console:

```js
document.documentElement.scrollWidth <= document.documentElement.clientWidth
```

**Expect** `true` at every width.

**Fails if**: the viewport meta tag is missing from `index.html` — the current file has none, so mobile will render at desktop width regardless of CSS (contract D6).

*Covers SC-002. Contract: X1.*

### V3 — Countdown counts down *(US2, P2)*

With a **future** `launchDate` configured, watch the countdown section for ~5 seconds.

**Expect**: days / hours / minutes / seconds with unit labels, the seconds value decrementing once per second, and no layout jitter as digits change (tabular numerals).

**Drift check**: switch to another tab for ~60 seconds, then return. **Expect** the displayed time to be correct for the current wall clock — not 60 seconds behind. This is what guarantee H2 protects.

*Covers SC-006. Contract: `<Countdown />` N1, H1, H2.*

### V4 — Countdown degrades after launch *(US2, FR-005)*

```bash
VITE_LAUNCH_DATE=2020-01-01T00:00:00+04:00 npm run dev
```

**Expect**: a launch message in place of the digits. **No negative numbers, no `NaN`, no zero-padded garbage.**

Then try an unparseable value:

```bash
VITE_LAUNCH_DATE=not-a-date npm run dev
```

**Expect**: the module falls back to its default date and the page renders normally — never `Invalid Date` on screen.

*Covers SC-006. Contract: L2, L3, N2, C3.*

### V5 — Contact and social routes *(US3, P3)*

**With `socials: []`** (the shipping default until the club supplies channels):

**Expect**: the contact email renders as a working `mailto:` link. **No social block at all** — no empty container, no placeholder icons, no dead links.

**With `socials` populated**: each link opens the correct channel in a new tab. Confirm in DevTools that every one carries `rel="noopener noreferrer"`.

*Covers FR-009, FR-010. Contract: T1–T5.*

### V6 — Keyboard and screen-reader access *(US3, FR-011)*

Press `Tab` from the top of the page.

**Expect**: every interactive element reachable in visual order, each with a **visible** focus indicator; no focus trap; no element reachable only by mouse.

With VoiceOver (`Cmd+F5`) on the countdown: **expect** a readable summary of the remaining time, updating at **day** granularity — **not** an announcement every second (guarantee N3).

*Covers SC-008. Contract: X2, X5, X6, N3.*

### V7 — Reduced motion *(FR-013)*

Enable **System Settings → Accessibility → Display → Reduce motion** (macOS), then reload.

**Expect**: no digit flip or fade transitions, no decorative animation — but the countdown **numbers still update**. They are information, not decoration.

*Contract: N4.*

### V8 — Automated accessibility gate

```bash
npm test
```

**Expect**: all tests pass, including the `vitest-axe` assertion of **zero** WCAG 2.1 AA violations.

Also expect coverage of the countdown edge cases from [data-model.md](./data-model.md): future date, exact boundary, past date, sub-minute remainder, and unparseable input.

*Covers SC-005, SC-006.*

### V9 — Performance, SEO, and bundle budget

```bash
npm run build && npm run preview
```

Run Lighthouse against the preview URL in an incognito window, mobile preset.

| Metric | Target | Criterion |
|---|---|---|
| Performance | ≥ 95 | SC-003 |
| Accessibility | ≥ 95 | SC-003 |
| Best Practices | ≥ 95 | SC-003 |
| SEO | ≥ 95 | SC-003 |
| LCP (simulated 4G) | < 2.0 s | SC-004 |

Bundle budget:

```bash
npm run build
find dist/assets -name '*.js' -o -name '*.css' | xargs -I{} sh -c 'printf "%s  " {}; gzip -c {} | wc -c'
```

**Expect**: combined gzipped total **under 150 KB** (SC-007). Reference budget from research R9 — React + ReactDOM ≈ 45 KB, Tailwind CSS ≈ 5–10 KB, app code < 10 KB.

### V10 — Metadata

View source on the production build (`view-source:` on the preview URL).

**Expect**: `lang="en"`, a viewport meta tag, a descriptive `<title>` naming the brand rather than the bare domain, a meta description, Open Graph tags with a resolving `og:image`, `twitter:card`, and `theme-color` set to the brand maroon.

Paste the preview URL into a link-preview debugger and confirm the card renders.

*Covers FR-014, SC-003. Contract: D1–D6.*

---

## Acceptance checklist

| # | Criterion | Scenario |
|---|---|---|
| SC-001 | Visitor grasps org, offering, and pre-launch status in 10 s | V1 |
| SC-002 | No horizontal scroll or clipping, 320–2560 px | V2 |
| SC-003 | Lighthouse ≥ 95 on all four categories | V9, V10 |
| SC-004 | LCP < 2.0 s on simulated 4G | V9 |
| SC-005 | Zero automated WCAG 2.1 AA violations | V6, V8 |
| SC-006 | Countdown correct, and degrades once the date passes | V3, V4, V8 |
| SC-007 | Bundle < 150 KB gzipped | V9 |
| SC-008 | Every interactive element keyboard-operable | V6 |

## Known limitations at validation time

1. **Placeholder content.** Launch date, contact address, social URLs, and body copy are placeholders until the club supplies real values. V1 and V5 validate *behaviour*, not the accuracy of the copy.
2. **Placeholder brand mark.** `BrandMark.jsx` is a typographic monogram, not an official logo — the repo contains none. Swapping in a real logo touches one file.
3. **JavaScript disabled ⇒ blank page.** Inherent to a client-rendered SPA; accepted in the spec. Static meta tags keep link previews and search results informative.
4. **Lighthouse is manual.** Not wired into `npm test`. Run it before any deploy.
