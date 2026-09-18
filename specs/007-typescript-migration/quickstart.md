# Quickstart: Validating the TypeScript Migration

**Feature**: 007-typescript-migration | **Date**: 2026-09-18

How to prove this feature works, in the order the evidence is worth collecting.
Each scenario states what it proves and what failure looks like. Details live in
[research.md](./research.md), [data-model.md](./data-model.md) and
[contracts/](./contracts/); this file is the run guide.

## Prerequisites

- Node ≥ 22.18 (this machine: **v22.23.2**). Below 22.18, type stripping is
  flagged or absent and nothing here runs. Check with `node -v`.
- PostgreSQL reachable at `DATABASE_URL`. The SQL suites skip loudly without
  it, so a green run with no database is not a green run.
- Redis for the rate-limit suites.
- `npm install` at the root after `typescript` and `typescript-eslint` are
  added.

## Scenario 0 — Baseline, before touching anything

Capture what currently passes. Without this, "every test that passed before
still passes" (SC-003) is unmeasurable.

```bash
npm test 2>&1 | tee /tmp/baseline-tests.txt
npm run -w server verify:seo 2>&1 | tee /tmp/baseline-seo.txt
grep -c "" /tmp/baseline-tests.txt
```

**Expect**: a recorded pass/fail count per suite. Keep both files.

---

## Scenario 1 — The runtime accepts TypeScript (proves R1)

```bash
node -e 'console.log(process.version)'
printf 'const x: number = 42\nconsole.log("ok", x)\n' > /tmp/probe.ts && node /tmp/probe.ts
```

**Expect**: `ok 42`, with no flags and no dependencies.

**If it fails**: the Node version is below 22.18 and the whole no-build-step
approach (R1) is unavailable. Stop and revisit — the fallback is a `tsc` build,
which changes all eleven server npm scripts.

---

## Scenario 2 — Import specifiers resolve (proves R2, the top mechanical risk)

The one that breaks a migration silently. Run it after the first server files
are converted, not at the end.

```bash
npm run -w server dev
```

**Expect**: the server boots and serves.

**If it fails with `ERR_MODULE_NOT_FOUND`** naming a `.js` path that no longer
exists, a rename landed without its importers' specifier rewrite. All 404 server
specifiers change `.js` → `.ts`, in the same commit as the rename.

Audit at any point:

```bash
grep -rn "from '\..*\.js'" server/src server/tests packages/contracts/src | wc -l
```

**Expect**: `404` before conversion, `0` after.

---

## Scenario 3 — Type checking is real (proves SC-002, FR-002)

```bash
npx tsc --noEmit -p .
```

**Expect**: exit 0.

Three counter-checks, because a passing type check proves nothing if it is
checking nothing. Each should **fail**:

```bash
# (a) the checker sees test files — see contracts/tsconfig-contract.md
echo 'const n: number = "not a number"' >> server/tests/setup.ts && npx tsc --noEmit -p .

# (b) non-erasable syntax is caught at compile time, not at runtime
echo 'enum E { A }' >> server/src/app.ts && npx tsc --noEmit -p .

# (c) a contract rename propagates to every caller — the point of US2
# rename one field in packages/contracts/src/auth.ts, then:
npx tsc --noEmit -p .
```

**Expect**: (a) and (b) fail with type errors; (c) names every consuming file.
Revert all three. If (a) passes, `tests/**` is missing from `include` and 92
test files are unchecked.

Then confirm the checking was not bought with suppressions:

```bash
grep -rn "@ts-ignore\|@ts-expect-error\|: any\|as any" server/src client/src packages/contracts/src | wc -l
```

**Expect**: a number you are willing to defend, line by line. This is where a
large migration goes wrong — not in type errors, but in silencing them.

---

## Scenario 4 — No JavaScript remains (proves SC-001, FR-006)

```bash
find server/src server/tests client/src client/tests client/scripts \
     packages/contracts/src -name '*.js' -o -name '*.jsx'
grep -rn '"allowJs"' server/tsconfig.json client/tsconfig.json packages/contracts/tsconfig.json
```

**Expect**: both empty. `allowJs` is permitted mid-migration and must be gone
from the final commit, or a new `.js` file reappears unnoticed.

---

## Scenario 5 — Behaviour is unchanged (proves SC-003)

```bash
npm test 2>&1 | tee /tmp/after-tests.txt
diff <(grep -E "✓|✗|passed|failed" /tmp/baseline-tests.txt) \
     <(grep -E "✓|✗|passed|failed" /tmp/after-tests.txt)
```

**Expect**: differences **only** for suites on the itemised retarget list. An
aggregate count is not enough — SC-003 requires the list to name each one, and
a deleted test is the cheapest way to make this scenario pass dishonestly.

Suites known to need retargeting (they import `zod` today):

- `server/tests/authz/route-posture.test.js`
- `server/tests/http/error-envelope.test.js`
- `server/tests/ops/logging-redaction.test.js`
- `server/tests/ops/openapi-ui.test.js` — its subject is withdrawn (R9)

---

## Scenario 6 — Environment coercion survived (proves R7, SC-005)

**The highest-risk check in the feature.** Run it after `config/env.ts` is
rewritten, before anything else depends on it.

```bash
TRUST_PROXY=false PORT=3000 node -e '
  const { loadEnv } = await import("./server/src/config/env.ts")
  const env = loadEnv(process.env)
  console.log("trustProxy:", env.trustProxy, typeof env.trustProxy)
  console.log("PORT:", env.PORT, typeof env.PORT)
' --input-type=module
```

**Expect**: `trustProxy: false boolean` and `PORT: 3000 number`.

**If `trustProxy` prints `false string`**, stop. `"false"` is truthy, Fastify
will trust `X-Forwarded-For` from any client, and every per-address rate limit —
including the sign-in limiter — becomes forgeable. This failure does not
announce itself; the server boots and serves traffic normally.

Then the production preconditions:

```bash
NODE_ENV=production node server/src/server.ts    # no CANONICAL_ORIGIN etc.
```

**Expect**: a refusal naming the missing settings — or, if the plan accepted
the regression, a boot. Either way the observed behaviour must match what the
constitutional amendment says (R14).

---

## Scenario 7 — Zod is gone (proves SC-006, FR-009)

```bash
grep -rn "from 'zod'\|fastify-type-provider-zod" server/src server/tests \
        client/src packages/contracts/src
grep -n '"zod"' server/package.json packages/contracts/package.json
```

**Expect**: all empty.

---

## Scenario 8 — The boot gate changed deliberately (proves R8)

```bash
npm run -w server dev
```

**Expect**: boots with no response schemas anywhere.

Counter-check — remove `config.auth` from any one route and restart:

**Expect**: refuses to boot, naming that route. This proves the gate was
*amended*, not disabled. If it boots, Principle II has been lost as collateral
damage and the plan's Constitution Check is wrong.

---

## Scenario 9 — The preserved rules still reject (proves data-model.md §4)

For each of the 33 rules, a request that used to be rejected must still be
rejected. The four worth running first:

| Rule | Request | Expect |
|---|---|---|
| password ≥ 8 (§4a #1) | sign-in with `"password": ""` | rejected |
| OTP 4 digits (§4a #4) | verify-otp with `"code": "abc"` | rejected |
| pagination ≤ 200 (§4b #13) | `GET /push/campaigns?limit=1000000` | ≤ 200 rows |
| pagination default (§4b #13) | `GET /push/campaigns` with no `limit` | 50 rows, not an error |

**If the last two fail**, `limit` is reaching SQL as a string or as `undefined`
(data-model.md §4b).

---

## Scenario 10 — Public surface intact (proves SC-004, Principle III)

```bash
npm run -w server verify:seo
diff /tmp/baseline-seo.txt <(npm run -w server verify:seo 2>&1)
npm run -w client build
npm run -w client test:i18n
```

**Expect**: `verify:seo` exits 0 with output matching the baseline; the build
emits `index.html`, `en.html` and `konsole.html`; the i18n catalogues agree.

Then the one thing no automated check covers: open `index.html` and `en.html`
with JavaScript disabled in the browser.

**Expect**: both render completely. They carry their content and styles inline
and pull in no bundle, so a regression here means the conversion touched
something it should not have.

---

## Scenario 11 — Governance matches reality (proves SC-007, FR-016)

```bash
grep -n "Version.*:" .specify/memory/constitution.md
```

**Expect**: `2.0.0` or higher, and an amendment naming all three downgraded
MUSTs with what replaces each (R14). Then read
`.specify/memory/constitution.md` and `CLAUDE.md` with no access to the diff
and state which runtime protections the platform no longer has.

**Expect**: the answer is derivable from the documents alone. If it is not, the
next feature's Constitution Check is performed against a description of a
system that no longer exists.

---

## Definition of done

| # | Scenario | Criterion |
|---|---|---|
| 1 | Runtime accepts TS | R1 |
| 2 | Specifiers resolve | R2 |
| 3 | Type check real, no suppressions | SC-002 |
| 4 | No `.js` remains | SC-001 |
| 5 | Tests match baseline, exceptions itemised | SC-003 |
| 6 | Env coercion survived | SC-005 |
| 7 | Zod gone | SC-006 |
| 8 | Gate amended, auth half intact | R8 |
| 9 | 33 preserved rules still reject | SC-008 |
| 10 | SEO, build, i18n, no-JS pages intact | SC-004 |
| 11 | Constitution amended | SC-007 |

Scenarios 6 and 9 are the ones that fail silently in production rather than
loudly in CI. Neither is optional.
