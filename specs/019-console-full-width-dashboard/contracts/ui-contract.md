# UI contract: console layout below and at/above `lg` (1024 px)

Below `lg`, every row reads "unchanged" (FR-002). Breakpoints are Tailwind defaults:
`lg` = 1024 px, `xl` = 1280 px, `2xl` = 1536 px.

| Surface | Below `lg` | `lg` and up |
|---|---|---|
| `ConsoleShell` frame | unchanged | full width, no `max-w`; `main` padding `px-6`, `xl:px-8` |
| `KpiRow` | 1 → 2 columns | `repeat(auto-fit, minmax(12rem, 1fr))` |
| Threads feed (`Feed`) | one column of divider rows | `DashboardPage`; posts in `CardGrid` as cards |
| Post view / quotes / likes (`PostView`) | one column | `DashboardPage`; the post spans the full width, replies and quotes in `CardGrid`; likes (`AuthorList`) in `CardGrid` |
| Activity | one column of divider rows | `DashboardPage`; entries in `CardGrid` as cards |
| My profile, member profile | header above tabs | `DashboardPage`, `aside` = `ProfileHeader` (sticky, right column, 20 rem / 24 rem at `2xl`); tabs and posts in the main column with `CardGrid` |
| Followers / following (`FollowList`) | one column | full width, people in `CardGrid` |
| Organisation view | header above details | `DashboardPage`, `aside` = header |
| Edit profile | one column of fields | `DashboardPage`; fields `lg:grid-cols-2`, long text fields spanning both |
| Privacy | blocked list, then muted list | the two lists side by side (`lg:grid-cols-2`) |
| Member Marketplace | one column of listing rows | listings in `CardGrid` |
| Admin pages | unchanged | unchanged, already full width of the frame |
| `AuthCard`, onboarding, `EmptyState`, `Drawer`, `Modal`, `Composer` | unchanged | unchanged (FR-011) |

Invariants for every row:

- **DOM order is today's order** (FR-008). The aside moves visually through grid placement only.
- **Running text sits in `ReadableText`** (`max-w-[75ch]`), never wider (FR-007, SC-006).
- **No `mx-auto max-w-*` page wrapper** outside the allowlist in research R6, as enforced by
  `client/tests/no-narrow-pages.test.ts`.
- **No inline `style`**, because the CSP is nonce-only for styles.
