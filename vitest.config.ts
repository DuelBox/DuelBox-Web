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
 *
 * The coverage timeout was 120 s and that was still not enough, which only became visible once
 * something actually ran `pnpm test:coverage` end to end (#56). `archery-master`'s two heaviest
 * bot-tier tests take **79 s and 41 s under coverage on a quiet machine** and **172 s and 159 s**
 * when the other 257 files are running beside them — so they passed alone and failed as timeouts
 * in the full run, and the whole run then produced no coverage report at all. That is the same
 * "passes on quiet, fails on load" trap the paragraph above is about, one order of magnitude up,
 * and CI runs this work four to five times slower again than a development machine.
 *
 * Ten minutes, therefore. It is a large number and it is meant to be: under instrumentation the
 * thing this timeout can still usefully catch is a test that is genuinely stuck, and the nightly
 * job's own `timeout-minutes` is what bounds the run.
 *
 * And even then the run still exited 1 with all 11,476 tests green and coverage at 99%, which is
 * the thing that would have made the new gate useless. The cause is not this suite: Vitest talks
 * to its workers over birpc, whose call timeout is **hard-coded at 60 s** and is not reachable
 * from any Vitest option (`createThreadsRpcOptions` passes no `timeout`, so birpc's own
 * `DEFAULT_TIMEOUT = 6e4` applies). A synchronous test body blocks its worker's event loop, so
 * any single test that runs longer than sixty seconds guarantees one
 * `[vitest-worker]: Timeout calling "onTaskUpdate"`, and Vitest sets `process.exitCode = 1` for
 * unhandled errors regardless of whether every test passed. Under coverage this suite has about
 * eight such tests; `archery-master`'s heaviest is 79 s alone on an idle machine, so it is not a
 * matter of a loaded machine and no timeout of ours can help.
 *
 * `dangerouslyIgnoreUnhandledErrors` is therefore set **for the coverage run only**, and the
 * word in its name is taken seriously. What it costs is that an unhandled rejection inside a test
 * would not fail *this* run. What makes that affordable is that it is not this run's job: the
 * push gate runs the identical 260 files through `pnpm test` with the flag off, so an unhandled
 * error still fails CI, on every commit, before this job ever sees the code. The nightly run is
 * here for the thresholds and nothing else.
 *
 * The real repair is upstream of both: the eight tests that take more than sixty seconds under
 * instrumentation should not. Until they are cheaper, this is what lets the gate report the
 * number it was written to report.
 */
const underCoverage = process.env.DUELBOX_COVERAGE === '1';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: underCoverage ? 600_000 : 30_000,
    dangerouslyIgnoreUnhandledErrors: underCoverage,
    coverage: {
      provider: 'v8',
      include: ['packages/engine/src/**/*.ts', 'packages/**/src/**/rules.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
      thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 },
      // Named rather than left to the default, because the nightly job uploads this exact
      // directory as its artefact and a silently-defaulted path is how an artefact ends up
      // empty. `html` is what somebody reads on the morning the gate goes red, `text` is
      // what the run log shows, and `json-summary` is the one a script can read.
      reportsDirectory: 'coverage',
      reporter: ['text', 'html', 'json-summary'],
    },
  },
});
