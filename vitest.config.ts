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
 * The plain run is not tight, and deliberately so. A timeout is there to catch a test that is
 * *stuck*, not one that is slower than somebody guessed — and this suite is 132 files run in
 * parallel, many of them balance tests that play several hundred matches to measure a bot. The
 * two heaviest take 2.1 seconds alone and 5.8 on a machine that is also building something, so
 * the five-second default failed them on load and passed them on quiet, which is the worst
 * behaviour a gate can have: it taught whoever saw it to re-run rather than to look. Thirty
 * seconds still fails a genuine hang inside a minute and stops reporting the machine's mood as
 * a code defect.
 */
const underCoverage = process.env.DUELBOX_COVERAGE === '1';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: underCoverage ? 120_000 : 30_000,
    coverage: {
      provider: 'v8',
      include: ['packages/engine/src/**/*.ts', 'packages/**/src/**/rules.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
      thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 },
    },
  },
});
