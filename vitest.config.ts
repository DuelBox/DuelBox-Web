import { defineConfig } from 'vitest/config';

/**
 * Coverage instrumentation is slow enough to change what the suite means.
 *
 * v8 coverage slows a searching bot by several times over, and the suite is full of tests
 * that play thousands of simulated steps to measure a bot or prove a match terminates.
 * Under `--coverage` a dozen of them ran past Vitest's five-second default and failed as
 * timeouts — so `pnpm test:coverage` had never once completed, and the coverage gate issue
 * #6 asks for was unrunnable. Nothing failed on a normal run, so nobody looked.
 *
 * The plain run keeps the tight default: a test that takes five seconds without
 * instrumentation is a test worth noticing.
 */
const underCoverage = process.env.DUELBOX_COVERAGE === '1';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: underCoverage ? 120_000 : 5_000,
    coverage: {
      provider: 'v8',
      include: ['packages/engine/src/**/*.ts', 'packages/**/src/**/rules.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
      thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 },
    },
  },
});
