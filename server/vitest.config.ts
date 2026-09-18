import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: './tests/setup.ts',
    globalSetup: './tests/global-setup.ts',
    // Suites touching Postgres share one scratch database, so they must not
    // race each other. Everything else is fast enough that a single fork is
    // not the bottleneck.
    pool: 'forks',
    // Vitest 5: former poolOptions are top-level. Suites touching Postgres
    // share one scratch database, so they must not race each other.
    maxWorkers: 1,
    minWorkers: 1,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/scripts/**'],
    },
  },
})
