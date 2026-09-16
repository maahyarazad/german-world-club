// Test environment. Every value here is a development-only default; the real
// ones come from server/.env and are validated by src/config/env.js.
process.env.NODE_ENV ??= 'test'
process.env.LOG_LEVEL ??= 'silent'
process.env.DATABASE_URL ??= 'postgres://localhost:5432/gwc_test'
process.env.CANONICAL_ORIGIN ??= 'http://localhost'
process.env.TRUST_PROXY ??= '0'

// REDIS_URL is deliberately NOT defaulted. Unset, the redis plugin degrades to
// a per-process rate-limit store, which is equivalent in a single-process test
// run — so the suite exercises real limiter behaviour without requiring a
// second service. Set REDIS_URL to run the same suites against Redis.

// Deterministic Ed25519 test keypair. Generated for tests only — never used by
// any deployed environment, which reads its keys from the validated env.
process.env.JWT_PRIVATE_KEY ??= [
  '-----BEGIN PRIVATE KEY-----',
  'MC4CAQAwBQYDK2VwBCIEINTuctv5E1hK1bbY8fdp+K06/nwoy/HU++CXqI9EdVhC',
  '-----END PRIVATE KEY-----',
].join('\n')
process.env.JWT_PUBLIC_KEY ??= [
  '-----BEGIN PUBLIC KEY-----',
  'MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=',
  '-----END PUBLIC KEY-----',
].join('\n')
