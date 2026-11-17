# Quickstart and runbook: 024

## Automated

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/gwc_test npm run -w server migrate
DATABASE_URL=postgres://postgres:postgres@localhost:5432/gwc_test npm run -w server test -- ops/sessions-expire onboarding
npm run -w client test
```

## On the server (`dedi10021`): why "Bad Gateway"

1. **Is Node running?** `pm2 status` (or `systemctl status <unit>`, whichever started it). The
   last line of `gwd_node.log` is `SIGTERM … shutting down`.
2. **Did it refuse to boot?** Boot refusals go to stderr, not `gwd_node.log`:
   - `pm2 logs --err --lines 100`, or the pm2 error file (`~/.pm2/logs/*-error.log`).
   - Look for `Invalid environment configuration`, a route-budget message
     (`route class … Σ outbound … >= deadline`), `has no fallback`, or a migration error.
3. **What did the proxy see?** The nginx error log at the time of the attempt (for example
   `/var/log/nginx/error.log`): `connect() failed (111: Connection refused)` means Node was down,
   and `upstream timed out` means a request outlived `proxy_read_timeout`, which must be above
   20 s now that SMS routes may take that long.
4. **After deploying this branch:**
   - `npm run -w server migrate` (applies `043`);
   - restart;
   - confirm the next `sessions.expire` line says `job finished`;
   - try register step 2.

## Record (2026-11-16)

- `tests/ops/sessions-expire.test.ts` reproduced the production error exactly
  (`sessions_revoked_reason_check`, on a partner session) before migration 043, and passes after
  it. Migrate is idempotent.
- `tests/lib/api-gateway.test.ts` and the step-2 test: a proxy 502, 503 or 504 reads as
  service-unavailable, never "Bad Gateway". A real problem answered with 503 keeps its type.
- Full suites: server 1915 pass. Besides the 7 known failures on `main`,
  `referrals/balance` failed once under full-suite load and passed 3 of 3 alone (unrelated to
  this work). Client 466 pass; one full run showed a single intermittent failure that did not
  reproduce in two reruns.
- Still open: T008, T009 and T011 need access to `dedi10021`.
