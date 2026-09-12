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

/**
 * Leave the main thread a core on CI, because it is the one that cannot be starved.
 *
 * `verify` began failing with **every one of its 355 test files passing** and
 * `Error: [vitest-worker]: Timeout calling "onTaskUpdate"`. Vitest sets
 * `process.exitCode = 1` for an unhandled error whatever the results say, so the job went
 * red on a suite that had just gone green — and `deploy.yml` fires on a *successful* CI
 * run, so nothing reached visitors either.
 *
 * It is not a slow test. The comment above describes the case where one test body blocks
 * its worker past birpc's hard-coded sixty seconds, and that is not what is happening:
 * measured across the whole suite, **no single test case exceeds thirty seconds**, and the
 * four slowest *files* are 134 s, 97 s, 56 s and 47 s of many short cases each.
 *
 * What is starved is the main thread. It runs the Vite transform, the collection and every
 * worker's `onTaskUpdate`, and Vitest's default asks for one worker per core minus one —
 * so on a four-core runner three workers and the main thread contend for four cores while
 * 1,176 seconds of test bodies are pushed through in 488 seconds of wall clock. A worker's
 * report then waits on a main thread that is busy, and sixty seconds is not a long time to
 * wait when the queue is that deep.
 *
 * Two workers on CI leaves the main thread room to answer. The cost is wall clock and it is
 * bounded: `verify` has a fifteen-minute budget and was using eight.
 *
 * Not `dangerouslyIgnoreUnhandledErrors`. That flag is set for the coverage run and its
 * justification is written above: the push gate runs the identical files with it OFF, so a
 * real unhandled rejection still fails CI on every commit. Turning it on here would delete
 * that sentence's meaning and silence the next genuine one.
 */
const onCi = process.env.CI === 'true' || process.env.CI === '1';

/** Set by `pnpm test:allocation`, the only way the rule 5 benchmark is run. */
const runAllocation = process.env.DUELBOX_ALLOCATION === '1';

/**
 * Lifts the balance sweep's exclusion below, so the measurement that justifies it can be
 * taken again. Nothing in CI sets it; it exists because a number quoted in a comment that
 * nobody can reproduce is the shape this repository keeps getting caught by.
 */
const runBalanceUnderCoverage = process.env.DUELBOX_BALANCE_COVERAGE === '1';

/**
 * V8's internal optimisation controls, for the one file that cannot work without them.
 *
 * `packages/engine/src/allocation.test.ts` is the rule 5 guard: it measures bytes allocated
 * per call and fails a path that allocates on the step path. Every number it takes is a
 * measurement of *optimised* code, and it used to ask for that by running fifty thousand
 * warm-up iterations and assuming V8 had obliged. V8's promotion is advisory and happens on
 * a background thread, so on a busy or slow machine it sometimes had not — and the
 * interpreter boxes every non-Smi double it passes, so an allocation-free path measured
 * before promotion reads as exactly one boxed double per call.
 *
 * Sixteen bytes. Which is the number that file fails on, in a message accusing the code.
 * `verify` went red on `Impact.strike` at 16.000 B/call and
 * `LockstepSession.beginStep remote pair` at 15.954, three attempts each, for two paths
 * that measure 0.000 in isolation and 0.000 again under twelve spinning cores. Nothing
 * allocated; the runner had not promoted them.
 *
 * With this flag the file can assert the precondition instead of hoping for it — force the
 * promotion, read the optimisation status back, and fail on the *environment* when the
 * engine will not compile the closure. Without it that check throws with an explanation, on
 * purpose: a rule 5 guard that silently cannot tell an allocation from an unpromoted
 * closure is worse than no guard, because it is believed.
 *
 * Applied to both pool implementations rather than only the default, so `--pool=threads`
 * does not quietly lose it. It reaches the worker processes only; nothing this flag enables
 * is used outside that one file, and it changes no behaviour that is not asked for by name.
 */
const NATIVES = ['--allow-natives-syntax'];

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    /**
     * The rule 5 benchmark, which is a measurement rather than a test and cannot share a
     * machine with 363 other files.
     *
     * It counts bytes allocated per call by reading `used_heap_size` around a window of
     * iterations, and it takes the median of nine such windows. Every one of those windows is
     * shared with whatever else is running: another worker's scavenge inside a window makes it
     * read low, another worker's allocation makes it read high, and on the four-core runner
     * this repository uses — with two vitest workers and three e2e shards beside them — the
     * same unchanged case has been measured at **0, 16, 32 and 40 bytes per call on
     * consecutive runs**. 40 is "an object" in this file's own vocabulary. It is not.
     *
     * Two attempts to make it survive that are recorded in the file and neither was enough: a
     * retry over medians (three attempts, lowest wins) and a ceiling widened to admit one
     * boxed double, which is as far as it can be widened before it stops catching the objects,
     * arrays, closures and strings rule 5 is actually about.
     *
     * So it moves to the nightly, on one worker, which is where this repository already puts
     * the two other things that need a quiet machine to mean anything — the deep balance
     * sample and the coverage gate. `nightly.yml` carries the same note and the trade:
     * a per-frame allocation can now merge green and is caught the next morning. That is worse
     * than catching it at the gate and much better than a gate that fails at random, because a
     * gate that fails at random is one people learn to re-run.
     *
     * `pnpm test:allocation` runs it here, on demand, and is what to use when touching the
     * step path. It sets `DUELBOX_ALLOCATION=1`, which is what lifts the exclusion below —
     * without that, naming the file on the command line would find nothing, because an
     * `exclude` outranks a filter.
     */
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      ...(runAllocation ? [] : ['packages/engine/src/allocation.test.ts']),
      /**
       * The seat-balance sweep, which is a bot measurement rather than a coverage sample and
       * had been failing the nightly gate every night since 9 September 2026.
       *
       * `apps/web/src/data/balance-aggregate.test.ts` plays every game's bots over fifty seeds
       * in a `beforeAll`, and its hook budget is measured rather than guessed: 50 seeds times
       * 2400 ms a seed times the four-to-five CI runs this work slower at, which is **600 s**
       * on `normal`. Under v8 instrumentation the sweep takes **461.7 s on a quiet twelve-core
       * development machine** - 77% of a budget that already has CI's multiplier spent inside
       * it - so on a runner it is somewhere between 1,800 and 2,300 s and the nightly
       * `coverage` job ended `Failed Suites 1 ... Error: Hook timed out in 600000ms`, with the
       * `[vitest-worker]: Timeout calling "onTaskUpdate"` this file's first docstring explains,
       * on runs 34327671130, 34453659095, 34577407195, 34681983965 and 34691911651.
       *
       * Raising the hook budget under coverage was the other repair and it is the wrong one.
       * It would ask for roughly forty minutes of a ninety-minute job to re-measure bot balance
       * that `nightly.yml` already measures three times on its own - `normal` at 250 seeds,
       * `easy` and `hard` at 50 - on jobs that exist because that work needs a quiet machine to
       * mean anything. The coverage job would then be mostly a balance sweep, and the gate it
       * is here for would be behind it.
       *
       * **And the sweep was not carrying the thresholds, which is the claim that had to be
       * checked rather than assumed.** Measured with this exclusion in place, `pnpm
       * test:coverage` completes in 666 s over 384 files and 13,901 tests and reports **98.75%
       * of lines, 94.36% of branches, 97.97% of functions and 98.75% of statements** against
       * the 70% floor below. Every one of the **108 `rules.ts` files is at 95.67% or better**
       * without it - each game's own suites and `bot-parity` cover the rules, and the sweep
       * plays them to measure a seat rather than to reach a line. The weakest covered file is
       * `engine/src/scene.ts` at 78.03%, and it is eight points clear.
       *
       * The cost, stated rather than implied: a change that leaves `rules.ts` reachable only
       * from the balance sweep would no longer be counted. Nothing in the catalogue is in that
       * position today, and the three balance jobs still run the file every night.
       *
       * `DUELBOX_BALANCE_COVERAGE=1` lifts this, because an `exclude` outranks a filter and the
       * numbers above have to stay reproducible:
       *
       *     DUELBOX_COVERAGE=1 DUELBOX_BALANCE_COVERAGE=1 npx vitest run --coverage \
       *       apps/web/src/data/balance-aggregate.test.ts
       */
      ...(underCoverage && !runBalanceUnderCoverage
        ? ['apps/web/src/data/balance-aggregate.test.ts']
        : []),
    ],
    environment: 'node',
    poolOptions: {
      forks: { execArgv: NATIVES },
      threads: { execArgv: NATIVES },
    },
    testTimeout: underCoverage ? 600_000 : 30_000,
    dangerouslyIgnoreUnhandledErrors: underCoverage,
    ...(onCi && !underCoverage ? { maxWorkers: 2, minWorkers: 1 } : {}),
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
