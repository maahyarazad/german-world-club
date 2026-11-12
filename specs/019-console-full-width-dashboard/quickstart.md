# Quickstart: validating the full-width dashboard layout

Layouts are in [contracts/ui-contract.md](./contracts/ui-contract.md).

## Automated

```bash
npm run -w client test        # includes no-narrow-pages and dashboard-page tests
npm run -w client test:i18n   # unchanged, must stay green
npx tsc --noEmit -p client
```

## In a browser (jsdom cannot measure layout)

```bash
npm run -w server dev && npm run -w client dev
```

Sign in as a member with posts and listings (`seed:demo` gives both), and as a staff member.
Use the browser's responsive mode.

| Width | Check |
|---|---|
| 320 / 768 px | Every page looks as it did on `main`: one column, divider rows, header above tabs. No horizontal scroll (SC-004, SC-005). |
| 1024 px | The sidebar sits beside the content. Threads and Activity show cards. A profile shows the header in a right-hand panel. No horizontal scroll. |
| 1440 px | The frame touches both edges (SC-001). The content area is used to at least 90% (SC-002). Threads has ≥ 2 columns. |
| 1920 px | Threads and Marketplace have ≥ 3 cards per row (SC-003). The admin dashboard's KPI tiles share one row. |
| 2560 px | Still no side bands. Cards add columns rather than stretching. A long post's lines stay short (SC-006). |

Also:
- With the keyboard on My profile, Tab reaches the profile header actions before the tabs (FR-008).
- Switch to English, then back to German: labels wrap, nothing overflows (FR-012).
- Zoom to 200% at 1440 px: the layout falls back to one column.
