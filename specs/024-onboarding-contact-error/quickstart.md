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
