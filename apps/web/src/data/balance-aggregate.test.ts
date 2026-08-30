import { beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext, InputState, SeatInput } from '@duelbox/game-sdk';
import { CATALOGUE } from './catalogue.generated';
import { LOADERS_FOR_TEST } from './registry';
import type { LoadedGame } from './registry';

/**
 * Seat balance at equal skill, measured the same way for every game.
 *
 * ## Read this before quoting this file
 *
 * **Claimed band: 45-55%. Band actually enforced on the default push sample: 23.8-76.2%.**
 *
 * Those are not the same number, and this file used to open by stating only the first one.
 * The assertion is the flat band widened by {@link SIGMAS} standard errors of its own sample,
 * and at the fifty seeds a push runs that allowance is **21.2 points** - so what the push gate
 * forbids is a seat above 76.2% or below 23.8%, and nothing tighter. On a fully green run a
 * large minority of the catalogue still **measures outside the flat band** - it was around
 * half before #2487 taught 31 turn games to read the opening seat, and 31 of 107 after. The
 * exact count is printed at the top of every run, above the table, so nobody has to read this
 * comment to find it out, and nobody should quote the number in this sentence instead.
 *
 * The gap closes with sample size and only with sample size, and every run prints the number
 * it is actually enforcing:
 *
 * | seeds | allowance | enforced band | catches a seat above | wall clock |
 * |---|---|---|---|---|
 * | 50 (default, every push) | 21.2 pts | 23.8-76.2% | 76.2% | 1-2 min |
 * | 250 (`pnpm balance:audit`, nightly) | 9.5 pts | 35.5-64.5% | 64.5% | ~10 min |
 * | 1000 (what the `normal` records were measured at) | 4.7 pts | 40.3-59.7% | 59.7% | ~40 min |
 *
 * Saying "45-55" while enforcing 23.8-76.2 is the shape of the three phantom guards this
 * repository has already been burned by: `pnpm size` falling through to the system `size(1)`
 * and exiting 0, an asset-licence rule CLAUDE.md said CI enforced when nothing ran it, and CI
 * red on every commit behind another workflow's green tick. So the headline states both
 * numbers, the report states both numbers, and the day someone wants the headline to be true
 * they raise the sample rather than the prose.
 *
 * ## Why the seat, and not the bot
 *
 * The repository has been caught by this twice. Penalty Kicks reported a 63% "skill" gap
 * that turned out to be first-kicker advantage. Issue #2489 is the live second instance:
 * snakes-ladders measures its bot ladder from one seat order only, so its
 * `hardVersusEasy = 0.845` silently carries the first-mover edge that the same file measures
 * elsewhere - `rules.test.ts:684` records 51.2 / 53.5 / 55.0% at easy / normal / hard. A tier
 * number measured from one chair is a tier number plus a chair number, and nothing in it
 * says how much of each.
 *
 * So this harness sits both bots on the **same tier** and asks one question: how often does
 * seat one win? At equal skill the answer must be a coin toss, whatever the game is.
 * `packages/games/soccer-pool/src/bot.test.ts` is the model - it plays both directions and
 * keeps a separate seat-one counter, so the seat effect is reported rather than folded into
 * a tier number. `packages/games/sling-puck/src/rules.test.ts:322` is the stronger habit:
 * assert each direction rather than the average of the two, because an average hides exactly
 * the thing being looked for.
 *
 * ## What a run does
 *
 * Every seed is played **twice, once with each opening seat**, from the same `Rng` seed, so
 * a seed's luck falls on each chair in turn and the seat effect is separable from the seed
 * effect. That pairing is also the only way to attribute a difference to the opening seat
 * rather than to the draw: same seed, one variable.
 *
 * Which is how this file's first finding fell out. **Almost no built game reads
 * `context.openingSeat`.** The contract says a game "must read it rather than assume `p1`",
 * `PlaySurface` passes the value `MatchState` computes, and that value alternates across the
 * rounds of a best-of precisely so first-mover advantage washes out. That was true of every
 * older game in the catalogue when this file was written; #2487 closed it, and the measured
 * figure is now {@link OPENER_BLIND}. The first version of this file said "seventy-nine of seventy-nine, not one
 * built game reads it", and that number was wrong in the way a number is always wrong when it
 * is counted over a list rather than over the registry: it was counted after an allowlist had
 * removed nine games from the sweep, and five of those nine read the opening seat. Several
 * games - Tic Tac Toe among them - alternated the opener *internally* between their own
 * rounds and came out fair anyway; they now start that alternation from the shell's opener
 * rather than from a literal `p1`. The `opener` column
 * counts seed pairs whose two halves ended differently, and {@link OPENER_BLIND} is a ratchet
 * so the count cannot get worse.
 *
 * ## The sample, and what it buys
 *
 * A pair of matches from one seed is **one** independent draw, not two. Both halves share an
 * `Rng` seed, and for a game that ignores the opening seat they are the same match played
 * twice - so every confidence figure here counts seeds, never matches. That is conservative
 * for a game that does read the opening seat, which is the right way round for a gate.
 *
 * Five points of band is far inside the noise of a cheap sample, and no arithmetic makes that
 * untrue. The band does not move for it; the **evidence threshold** does - see the table at
 * the top for what each sample actually enforces.
 *
 * ```
 * pnpm test apps/web/src/data/balance-aggregate.test.ts          # the screen
 * pnpm balance:audit                                             # 250 seeds, what nightly runs
 * DUELBOX_BALANCE_SEEDS=1000 pnpm balance:sweep                  # the record
 * DUELBOX_BALANCE_TIER=hard pnpm balance:sweep                   # the other two tiers
 * ```
 *
 * That difference is not theoretical, and it was measured the same way everything else here
 * was. Rock Paper Scissors was deliberately broken so that seat one collected half the drawn
 * rounds; it measured **68.0% and passed** at fifty seeds, and **66.8% and failed** at two
 * hundred and fifty. The push gate is a smoke alarm and the nightly is the fire brigade, and
 * both of those sentences have been watched happen.
 *
 * Two things stop the cheap run being decorative:
 *
 * - **The pooled share.** Seat one's share across every non-exempt game at once is thousands
 *   of decided matches even at fifty seeds, so its standard error is under a point and the
 *   flat band applies to it. A catalogue-wide lean - the Penalty Kicks failure repeated
 *   across many games - is caught on every push for free. It is blind to one game leaning
 *   left while another leans right, which is what the per-game assertion is for.
 * - **The exceptions ratchet one way.** A game in {@link OUTSIDE_THE_BAND} is not skipped, and
 *   the check on it is **one-sided**: it may not get worse than its record by more than the
 *   sample can explain, and it may not get *better* at all without failing. The moment its
 *   fresh share lands inside the flat band the assertion fails with "this is now fair, delete
 *   its line". Before that rule existed a listed game only had to land within the sample's
 *   own allowance of its recorded number - 21.2 points at fifty seeds - so six of the nine
 *   recorded games could have been repaired to a perfect 50% and kept their stale lines for
 *   ever, and `hot-potato` could have gone from its recorded 92.0% to 100% and passed.
 *
 * ## Tiers
 *
 * `DUELBOX_BALANCE_TIER` picks the tier both bots sit on. It defaults to `normal`, which is
 * what a push runs, and until this fix **nothing ever set it to anything else** - so two
 * thirds of the bot ladder had never been measured by the harness that exists to measure the
 * bot ladder. A deliberate break that gave seat one 92% at `hard` read as a flat 50.0% at
 * `normal` and the file stayed green.
 *
 * The first run of the other two tiers produced twelve records over ten games that the
 * `normal` run cannot see, plus one game it can no longer measure at all. They are in
 * {@link OUTSIDE_THE_BAND} with their tier attached. The short version:
 * `hand-slap` gives seat one 100% on `easy`, 35% on `normal` and 12% on `hard`; `paint-fight`
 * ties every match on `normal` and `hard` and hands seat one every match on `easy`, so the
 * tie was hiding a total advantage rather than proving symmetry; four turn-board games become
 * a single deterministic match at `hard` because two near-perfect players play the same game
 * every time, and `tic-tac-toe` draws all hundred of them; and `checkers` stops finishing at
 * all against a hard bot. A single-tier balance number is one third of an answer.
 *
 * So a record carries its tier and gates that tier only - see {@link Exception} - and the
 * nightly `seat-balance` job is a matrix over all three. `normal` keeps its deep 250-seed
 * sample; `easy` and `hard` run the same fifty seeds a push does, because they are breadth
 * rather than depth and because the numbers recorded for them were measured at fifty. Making
 * a tier deeper means deepening its records first, which is an issue rather than a config
 * change. None of this is on the push gate: `hard` is three times the wall clock of `normal`
 * because the bots search, and the push gate has no room for it.
 *
 * ## Runtime
 *
 * Measured on the development machine over all 93 registered games at fifty seeds: **37 to
 * 115s** on `normal` depending on what else is running, about the same on `easy`, and 355s on
 * `hard`. The `normal` figure was 34s when this file was written, over 79 games; it is not the
 * sweep that got slower but the catalogue that grew, and several of the games that were being
 * skipped by name turned out to be long ones - `solitaire` alone averages 87 simulated
 * seconds a match. Budget roughly ten minutes for the nightly's 250 seeds on `normal`. CI is
 * slower again; `bot-cost.test.ts` puts it at four to five times slower for search-heavy work.
 *
 * That lands in the `verify` job, which spent 216s of its fifteen-minute limit before this
 * file existed, and `verify` is not the critical path: `e2e` is, at about eleven minutes in
 * its own job. So the gate's wall clock does not move, and issue #2459's eight-minute target
 * is an `e2e` problem this file does not touch. It is still the most expensive file in
 * `pnpm test` by a distance, which is the deliberate trade: `termination.test.ts` plays one
 * match per game because one match answers its question, and this is the one place in the
 * suite that pays for a sample.
 */

/* ------------------------------------------------------------------ configuration */

type Tier = 'easy' | 'normal' | 'hard';

/**
 * Seed pairs per game. Each seed is played twice, once per opening seat, so the default is
 * a hundred matches a game and over nine thousand matches across the catalogue.
 *
 * `DUELBOX_BALANCE_SEEDS=1000` is the audit, and is what the `normal` numbers in
 * {@link OUTSIDE_THE_BAND} were measured with. Every record carries the sample it was taken
 * at, because a record read at a different sample from the one that produced it is a guess.
 */
const SEEDS = Math.max(4, Math.floor(Number(process.env.DUELBOX_BALANCE_SEEDS ?? '50')));

/** Both seats always get the same tier - that is what "equal skill" means here. */
const TIER = (process.env.DUELBOX_BALANCE_TIER ?? 'normal') as Tier;

/** The band the issues ask for, on seat one's share of the matches that were decided. */
const BAND_LOW = 0.45;
const BAND_HIGH = 0.55;

/**
 * How many standard errors of slack the band is asserted with, and how many seeds it takes
 * for that to mean anything. **Both were measured, not chosen.**
 *
 * The first version ran thirty seeds. A game was then broken on purpose - drawn rounds in
 * Rock Paper Scissors quietly awarded to seat one - and it measured 76.7% for seat one and
 * **passed**, because three sigma over thirty seeds is twenty-seven points wide. A guard that
 * lets a three-quarters split through is not a guard.
 *
 * Two ways out, and the sample size is the right one. Dropping to two sigma also catches it,
 * and immediately produced a false alarm: Pinball, which the audit puts at 45.7% over a
 * thousand seeds, happens to run at 28% over the first fifty, and a gate that reports a fair
 * game as broken teaches people to edit the list rather than the game. Fifty seeds at three
 * sigma catches the same deliberate break at 80.0% and leaves Pinball alone.
 *
 * So: three sigma, and enough seeds that three sigma is 21 points rather than 27. That is
 * still 21 points, which is why {@link ENFORCED_LOW} and {@link ENFORCED_HIGH} are printed
 * beside the claimed band on every run instead of being left to be discovered.
 */
const SIGMAS = 3;

/**
 * The match budget a game gets, which is **exactly what the paired sweep always spent**.
 *
 * That is the whole shape of #2494's fix: a game that ignores the opening seat used to spend
 * half of this replaying matches it already had, and now spends it on seeds it does not have.
 * The wall clock does not move; the sample does.
 */
const MATCH_BUDGET = SEEDS * 2;

/**
 * Seeds played with **both** opening seats before the sweep decides whether a game can be
 * measured from one arm.
 *
 * The decision itself is {@link Played.readOpener} and does not need a sample at all - these
 * seeds exist to confirm it. Six of them is 12 matches out of the budget, under an eighth of
 * the ~1.8x more seeds the saving buys back.
 */
const PROBE_SEEDS = Math.min(SEEDS, 6);

/**
 * In the single-arm phase, how often the sweep pays for the second arm anyway and checks it
 * is still bit-identical.
 *
 * The issue asked for this in as many words: "if a game reports `openerSwung === 0` and the
 * second arm is *not* bit-identical, that is a game with hidden per-opener state and should
 * be reported, not silently halved". The probe alone would only ever prove it for the first
 * six seeds, so the check keeps running - about 8% of the budget - and every failure it can
 * see is collected in {@link Tally.unexplained} and asserted on.
 */
const AUDIT_EVERY = 12;

/**
 * Seeds a single-arm game gets out of {@link MATCH_BUDGET}, counted the same way
 * {@link measure} spends it: two matches for each probe seed, one for each seed after that,
 * and one more every {@link AUDIT_EVERY}th of those for the guard.
 *
 * At the default fifty-seed push sample that is **88 seeds against the paired sweep's 50** -
 * not the full doubling, because the probe and the guard are not free, but a noise band of
 * 16.0 points rather than 21.2.
 */
const SOLO_SEEDS = ((): number => {
  let spent = PROBE_SEEDS * 2;
  let seeds = PROBE_SEEDS;
  for (let index = PROBE_SEEDS; spent < MATCH_BUDGET; index += 1) {
    spent += 1;
    seeds += 1;
    if ((index - PROBE_SEEDS + 1) % AUDIT_EVERY === 0 && spent < MATCH_BUDGET) spent += 1;
  }
  return seeds;
})();

/**
 * Half-width of this sample's allowance for a game that decides every match, in share.
 *
 * There are two of these, because since #2494 there are two samples: a game that reads the
 * opening seat gets {@link SEEDS} paired seeds, and one that ignores it gets
 * {@link SOLO_SEEDS} single-arm seeds out of the same match budget. The paired figure is the
 * wider of the two and is what the headline quotes, because it is the weakest thing this run
 * enforces on anything.
 */
const ALLOWANCE_PAIRED = SIGMAS * Math.sqrt(0.25 / SEEDS);
const ALLOWANCE_SOLO = SIGMAS * Math.sqrt(0.25 / SOLO_SEEDS);

/**
 * The band this run actually enforces for a game that decides all of its matches. A game that
 * draws some of them decides fewer seeds and gets a wider one still - that is the `+/-`
 * column.
 */
const ENFORCED_LOW = BAND_LOW - ALLOWANCE_PAIRED;
const ENFORCED_HIGH = BAND_HIGH + ALLOWANCE_PAIRED;
const ENFORCED_LOW_SOLO = BAND_LOW - ALLOWANCE_SOLO;
const ENFORCED_HIGH_SOLO = BAND_HIGH + ALLOWANCE_SOLO;

/** Ten minutes of simulated play, the same ceiling `termination.test.ts` allows. */
const MAX_STEPS = 60 * 600;
const STEP = 1 / 60;

/**
 * How many measurable games in the registry ignore the opening seat completely.
 *
 * A ratchet, not a target. It may only ever go down, so a new turn game cannot quietly join
 * them - and every turn game that starts reading `openingSeat` tightens it.
 *
 * **Counted over `turn-*` games only.** The contract says outright that "real-time games
 * have no opener and may ignore this", and about half the games that ignore it are
 * real-time - so counting those made the guard fail four games in one afternoon for doing
 * exactly what the SDK permits. A guard that punishes correct behaviour gets disabled,
 * which is worse than no guard.
 *
 * It was 33 of the 46 turn games. #2487 brought 31 of them across and it is now **two**:
 * `basketball` and `cup-pong`. Both of those *do* read `context.openingSeat` - they simply
 * cannot be seen to. Each gives every seat its own generator and hands out an even number of
 * turns, so reversing the opener reorders the identical two sequences of shots and lands on
 * the identical result. That is a property worth having rather than a defect: it is the
 * strongest possible statement that neither seat is favoured. This measurement counts seed
 * pairs that *ended differently*, and it cannot tell "ignores the opener" from "is exactly
 * symmetric under it", so those two stay in the count.
 *
 * What the other 31 bought, on the default fifty-seed `normal` sample: eight records were
 * deleted from {@link OUTSIDE_THE_BAND} because the games came back inside the band. Five of
 * them - `reversi`, `color-wars`, `mancala`, `pop-it` and `ultimate-ttt` - are deterministic
 * at `hard` and used to hand one seat all hundred matches; each now plays two matches, one
 * per opening seat, and splits them 50/50 exactly. `four-in-a-row` did the same on `normal`
 * and `hard`. `soccer-pool` came in from 57.5% to 50.0%. One real defect fell out on the way:
 * `shut-the-box` ended the match after seat two's turn whichever seat had opened, so with a
 * `p2` opener seat one never played at all and won on its unset score, 100 times in 100.
 *
 * An earlier value of 79 was counted over a sweep an allowlist had already narrowed, under
 * a comment reading "seventy-nine of seventy-nine, not one built game reads it". Both
 * halves were wrong. Counting a property over a list rather than over the registry is how a
 * harness ends up certain of a false thing.
 */
const OPENER_BLIND = 2;

/**
 * How many games must reach a conclusion under at least one driver, per tier.
 *
 * This is the guard that stops a working game hiding among the unmeasurable ones. There is no
 * allowlist of scaffolds any more - {@link measurable} computes the skip from measurement, so
 * it cannot go stale - but a computed skip has its own failure mode: a game that regressed
 * until it never finished a match would drop out of the sweep silently and this file would
 * stay green. So the count of games that *do* finish something is ratcheted. It may only go
 * up.
 *
 * A new package that registers itself as a placeholder does not lower it, which is the point:
 * eight games were being built in parallel while this file was being fixed, and a harness
 * that goes red every time somebody scaffolds a package gets edited rather than read. A game
 * that stops working does lower it, and that is the case worth failing on.
 *
 * `hard` is one lower than the other two because `checkers` does not finish a single match
 * against a hard bot inside the ten simulated minutes `termination.test.ts` allows - not one
 * of 101, under either opening seat or with the device shouted at. That is a real finding and
 * it belongs to `termination.test.ts`; all this file can do is refuse to pretend the game was
 * measured.
 */
const MEASURED_MIN: Readonly<Record<Tier, number>> = { easy: 93, normal: 93, hard: 92 };

/* ------------------------------------------------------------------ measurement */

interface Played {
  readonly winner: SeatId | 'draw' | null;
  readonly steps: number;
  /** The final scoreline, kept only so two matches can be told apart. */
  readonly p1: number;
  readonly p2: number;
  /**
   * Whether the game ever read `context.openingSeat` during this match.
   *
   * This is the signal the single-arm sweep turns on, and it is structural rather than
   * statistical: the two contexts a seed is played with differ in **that property and
   * nothing else**, so a game that never touches it runs the identical code over the
   * identical `Rng` stream and must produce the identical match. Inferring the same thing
   * from outcomes cannot be made safe - `sudoku` reads the opener and swings only 26 of 50
   * seed pairs, and its outcome space is small enough that a short probe would call it blind
   * by luck. Reading it is a fact about the game; not swinging is a fact about the sample.
   */
  readonly readOpener: boolean;
}

/**
 * Nobody is touching the device: two bots play, and every seat reads the same idle input
 * every step.
 *
 * `termination.test.ts` builds a real `InputManager` and steps it, which is the obviously
 * faithful thing to do - and here it was 55% of the wall clock, because the sweep steps it
 * millions of times to be told that nothing happened. This file uses a frozen state instead,
 * as `soccer-pool/src/bot.test.ts` does.
 *
 * The first version of that shortcut came with a test comparing it against an untouched
 * `InputManager` over six games. That test could not fail, and did not when the frozen state
 * was deliberately filled with a held button and a full-tilt move vector: **no game reads
 * seat input while a bot holds the seat**, so nothing downstream could see the difference.
 * A guard nobody has watched fail is not a guard, so it was replaced with the claim that is
 * actually load-bearing and actually falsifiable - see {@link LOUD} and the test that uses
 * it. If a game ever does let the device reach a bot-held seat, that test fails and this
 * shortcut stops being sound on the same commit.
 */
const IDLE: SeatInput = {
  move: { x: 0, y: 0 },
  pointer: null,
  actionPressed: false,
  actionHeld: false,
  actionReleased: false,
  holdSeconds: 0,
  holdSecondsAtRelease: 0,
  pointerCancelled: false,
};
const SILENT: InputState = { seat: (): SeatInput => IDLE };

/** Everything at once: both seats shoved, held, tapped and pointed at the middle. */
function LOUD(width: number, height: number): InputState {
  const seat: SeatInput = {
    move: { x: 1, y: 1 },
    pointer: { x: width * 0.5, y: height * 0.5 },
    actionPressed: true,
    actionHeld: true,
    actionReleased: true,
    holdSeconds: 0.5,
    holdSecondsAtRelease: 0,
    pointerCancelled: false,
  };
  return { seat: (): SeatInput => seat };
}

/**
 * `openingSeat` is a getter so the sweep can see whether the game ever asked for it. A game
 * that never reads it cannot be affected by it, which is what {@link measure} needs to know
 * before it stops playing the second arm.
 */
function contextFor(
  loaded: LoadedGame,
  seed: number,
  opener: SeatId,
  seen: { read: boolean },
): GameContext {
  return {
    manifest: loaded.manifest,
    rng: new Rng(seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    get openingSeat(): SeatId {
      seen.read = true;
      return opener;
    },
    botDifficulty: () => TIER,
  };
}

/** One match, to a decision or to the ten-minute ceiling. */
function play(loaded: LoadedGame, seed: number, opener: SeatId, input: InputState = SILENT): Played {
  const game = loaded.create();
  const seen = { read: false };
  game.init(contextFor(loaded, seed, opener, seen));
  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      game.update(STEP, input);
      const score = game.getScore();
      if (score.winner !== null) {
        return {
          winner: score.winner,
          steps: step + 1,
          p1: score.p1,
          p2: score.p2,
          readOpener: seen.read,
        };
      }
    }
    const score = game.getScore();
    return {
      winner: null,
      steps: MAX_STEPS,
      p1: score.p1,
      p2: score.p2,
      readOpener: seen.read,
    };
  } finally {
    game.destroy();
  }
}

interface Tally {
  readonly id: string;
  readonly archetype: string;
  seatOne: number;
  seatTwo: number;
  draws: number;
  /** Still running after ten simulated minutes. `termination.test.ts` owns those. */
  unfinished: number;
  steps: number;
  /** Matches counted into the share. One per seed for a single-arm game, two for a paired one. */
  matches: number;
  /** Independent draws behind {@link matches} - the unit every confidence figure here uses. */
  seeds: number;
  /** Every match run, the discarded probe arms, the guard replays and the shouted probe included. */
  played: number;
  /**
   * Matches that reached *any* conclusion - a win or a draw - under *any* driver, the shouted
   * probe included. Zero means no driver could get this game to end, which is what
   * {@link measurable} keys on.
   */
  concluded: number;
  /** Seed pairs whose two halves ended differently - the opening seat changed the match. */
  openerSwung: number;
  /** Seed pairs both arms of which were played, which is what {@link openerSwung} is out of. */
  pairsChecked: number;
  /** True when the game never read `context.openingSeat` and is measured from one arm. */
  blind: boolean;
  /**
   * Pairs whose two arms differ in a way this game's reading of the opening seat cannot
   * account for. Non-empty fails the harness rather than being silently absorbed.
   *
   * Two shapes, and both are the case where halving the sweep would have been wrong:
   *
   * - The game's {@link openerSwung} is **zero** - so the sweep and the report both call it
   *   opener-blind - and yet a pair came back with the same winner after the same number of
   *   steps and a *different scoreline*. That is per-opener state `openerSwung` cannot see,
   *   and it is #2494's guard in as many words.
   * - The game never read `context.openingSeat` at all and a pair still differed. The two
   *   contexts differ in that property and nothing else, so this is state surviving from one
   *   match into the next, which would make every number in this file a measurement of the
   *   harness.
   *
   * A game whose `openerSwung` is non-zero is *expected* to move its scoreline around with
   * the opener - that is what reading the opening seat looks like - and says nothing here.
   */
  readonly unexplained: string[];
  /** True if the same seed played differently when the device was shouted at. */
  readsInput: boolean;
  /**
   * Every distinct match this game produced, as `winner:steps:p1:p2`.
   *
   * One entry means the seed changed nothing: the sweep played the same match N times and
   * the share it reports has no sample behind it at all. See the test that reports these.
   */
  readonly outcomes: Set<string>;
}

/** `winner:steps:p1:p2` - the whole of what this harness can see of a match. */
function fingerprint(result: Played): string {
  return `${String(result.winner)}:${String(result.steps)}:${String(result.p1)}:${String(result.p2)}`;
}

/**
 * One game's sweep, inside a fixed budget of {@link MATCH_BUDGET} matches.
 *
 * Two shapes, chosen by the game rather than by a list:
 *
 * - **Paired**, when the game reads `context.openingSeat`. Every seed is played twice, once
 *   per opening seat, and both arms are counted - unchanged from before #2494. The pairing is
 *   the only way to attribute a difference to the opener rather than to the draw.
 * - **Single-arm**, when it never reads it. The two arms of a seed are then the same match by
 *   construction, so the second one is not played and the budget buys {@link SOLO_SEEDS}
 *   seeds instead of {@link SEEDS} pairs.
 *
 * The classification is confirmed, not assumed: {@link PROBE_SEEDS} seeds are played both
 * ways up front and must come back bit-identical, and one seed in {@link AUDIT_EVERY} keeps
 * being checked for the rest of the run. Anything the opening seat cannot explain lands in
 * {@link Tally.unexplained} and fails.
 */
function measure(id: string, loaded: LoadedGame): Tally {
  const tally: Tally = {
    id,
    archetype: CATALOGUE.find((entry) => entry.id === id)?.archetype ?? '?',
    seatOne: 0,
    seatTwo: 0,
    draws: 0,
    unfinished: 0,
    steps: 0,
    matches: 0,
    seeds: 0,
    played: 0,
    concluded: 0,
    openerSwung: 0,
    pairsChecked: 0,
    blind: false,
    unexplained: [],
    readsInput: false,
    outcomes: new Set<string>(),
  };

  // Spread far apart so neighbouring seeds cannot share a prefix of the same stream.
  const seedAt = (index: number): number => 1000003 + index * 7919;

  /** Count one match, and the seed it stands for, into the share. */
  const count = (result: Played): void => {
    tally.matches += 1;
    tally.steps += result.steps;
    tally.outcomes.add(fingerprint(result));
    if (result.winner === null) tally.unfinished += 1;
    else if (result.winner === 'draw') {
      tally.draws += 1;
      tally.concluded += 1;
    } else {
      tally.concluded += 1;
      if (result.winner === 'p1') tally.seatOne += 1;
      else tally.seatTwo += 1;
    }
  };

  /**
   * Pairs that came apart without the winner or the length moving, kept until the sweep
   * knows whether this game's {@link Tally.openerSwung} ended at zero. Only then is a
   * scoreline that follows the opener a finding rather than the game working.
   */
  const silent: string[] = [];
  /** Pairs that came apart at all - a finding only for a game that never read the opener. */
  const divergent: string[] = [];

  /** Everything the sweep can learn from having played both arms of one seed. */
  const comparePair = (index: number, first: Played, second: Played): void => {
    tally.pairsChecked += 1;
    const swung = first.winner !== second.winner || first.steps !== second.steps;
    if (swung) tally.openerSwung += 1;
    if (!swung && first.p1 === second.p1 && first.p2 === second.p2) return;
    const at = `seed ${String(seedAt(index))}`;
    if (swung) {
      divergent.push(`${at}: ${fingerprint(first)} against ${fingerprint(second)}`);
    } else {
      silent.push(
        `${at}: the same winner after the same ${String(first.steps)} steps, but ` +
          `${String(first.p1)}-${String(first.p2)} against ` +
          `${String(second.p1)}-${String(second.p2)}`,
      );
    }
  };

  const probe: [Played, Played][] = [];
  for (let index = 0; index < PROBE_SEEDS; index += 1) {
    const seed = seedAt(index);
    const first = play(loaded, seed, 'p1');
    const second = play(loaded, seed, 'p2');
    tally.played += 2;
    if (index === 0) {
      // One extra match a game, to earn the frozen idle input the rest are driven with.
      // It is also the third driver `measurable` needs: a game that only ever ends when
      // somebody touches the device is a measurable game with a broken bot, not a scaffold.
      const { width, height } = loaded.manifest.logical;
      const shouted = play(loaded, seed, 'p1', LOUD(width, height));
      tally.played += 1;
      tally.readsInput = shouted.winner !== first.winner || shouted.steps !== first.steps;
      if (shouted.winner !== null) tally.concluded += 1;
    }
    comparePair(index, first, second);
    probe.push([first, second]);
  }

  tally.blind = probe.every(
    ([first, second]) =>
      !first.readOpener && !second.readOpener && fingerprint(first) === fingerprint(second),
  );

  let spent = PROBE_SEEDS * 2;
  if (tally.blind) {
    // The second arm of each probe seed was the same match as the first. It has been used to
    // prove that; counting it as well is the double-count this whole change is about.
    for (const [first] of probe) {
      count(first);
      tally.seeds += 1;
    }
    for (let index = PROBE_SEEDS; spent < MATCH_BUDGET; index += 1) {
      const seed = seedAt(index);
      const first = play(loaded, seed, 'p1');
      spent += 1;
      tally.played += 1;
      count(first);
      tally.seeds += 1;
      if ((index - PROBE_SEEDS + 1) % AUDIT_EVERY === 0 && spent < MATCH_BUDGET) {
        const second = play(loaded, seed, 'p2');
        spent += 1;
        tally.played += 1;
        // A guard, not a sample: it is asserted to be the match already counted, so counting
        // it again would put the double-count back one seed in twelve.
        comparePair(index, first, second);
      }
    }
  } else {
    for (const [first, second] of probe) {
      count(first);
      count(second);
      tally.seeds += 1;
    }
    for (let index = PROBE_SEEDS; index < SEEDS; index += 1) {
      const seed = seedAt(index);
      const first = play(loaded, seed, 'p1');
      const second = play(loaded, seed, 'p2');
      spent += 2;
      tally.played += 2;
      comparePair(index, first, second);
      count(first);
      count(second);
      tally.seeds += 1;
    }
  }

  if (tally.blind) {
    // Every pair this game produced was supposed to be one match played twice.
    for (const note of divergent) {
      tally.unexplained.push(
        `${note} - the two arms ended differently though the game never read ` +
          `context.openingSeat, so something survived from one match into the next`,
      );
    }
    for (const note of silent) {
      tally.unexplained.push(
        `${note} - the game never read context.openingSeat, so the two arms should have been ` +
          `the same match`,
      );
    }
  } else if (tally.openerSwung === 0) {
    // #2494's guard: the report calls this game opener-blind, and it is not.
    for (const note of silent) {
      tally.unexplained.push(
        `${note} - openerSwung is 0, so this game reads as opener-blind while the opening ` +
          `seat is still moving its scoreline`,
      );
    }
  }
  return tally;
}

/* ------------------------------------------------------------------ statistics */

function decided(tally: Tally): number {
  return tally.seatOne + tally.seatTwo;
}

/**
 * Whether this game can be balance-tested at all.
 *
 * **Computed, never listed.** The nine ids this file used to skip by name were an allowlist
 * written the week nine packages were scaffolded, and six of them - `target-practice`,
 * `explosive-festival`, `happy-hippos`, `sudoku`, `throw` and `sliding-puzzle` - had become
 * ordinary working games in the same session, deciding 94 to 100 of their hundred matches
 * while the harness went on skipping them. A seventh, `golf-football`, landed while this fix
 * was being written. That is what a hand-maintained skip list does: it is correct on the day
 * it is written and silently wrong for ever afterwards, and the games it hides are exactly
 * the ones nobody is looking at.
 *
 * So the skip is measured instead. A game is unmeasurable when **no driver ever brought it to
 * a conclusion** - not a win, not a draw, not once in 2N+1 matches of ten simulated minutes
 * each, with both opening seats and with the device shouted at. A placeholder that draws a
 * frame and has no rules cannot pass that test; a real game cannot fail it. Note the
 * distinction from `decided() === 0`: `paint-fight` decides nothing because two `normal` bots
 * mirror each other into a 245-245 tie, but it *concludes* every match, so it stays in the
 * sweep and keeps its recorded line.
 *
 * The count and the ids print on every run, and {@link MEASURED_MIN} ratchets the other side
 * of it so a working game cannot regress into this bucket unnoticed.
 */
function measurable(tally: Tally): boolean {
  return tally.concluded > 0;
}

/** Seat one's share of the matches that produced a winner. NaN when none did. */
function share(tally: Tally): number {
  return decided(tally) === 0 ? Number.NaN : tally.seatOne / decided(tally);
}

/** Draws and stalemates as a share of the matches that finished at all. */
function drawRate(tally: Tally): number {
  const finished = decided(tally) + tally.draws;
  return finished === 0 ? Number.NaN : tally.draws / finished;
}

/** Mean match length in simulated seconds - the figure that makes games comparable. */
function roundSeconds(tally: Tally): number {
  return tally.matches === 0 ? Number.NaN : tally.steps / tally.matches / 60;
}

/**
 * The independent draws behind the decided matches.
 *
 * A seed is the unit, never a match: the two arms of a paired seed share an `Rng` seed, so
 * they are one draw whether or not the opener moved them apart. This is the old
 * `decided / 2`, written so it is also right for a single-arm game, where a seed *is* a
 * match and halving would throw away evidence that was really collected.
 */
function decidedSeeds(tally: Tally): number {
  return tally.matches === 0 ? 0 : (decided(tally) * tally.seeds) / tally.matches;
}

/**
 * What this sample can resolve, in share points: {@link SIGMAS} standard errors of a fair
 * coin over the number of **decided seeds**.
 *
 * The standard error uses 0.5 rather than the observed share deliberately. A game measured
 * at 100% has an observed variance of zero, and a tolerance built from that would be zero
 * points wide: the most broken game in the catalogue would get the tightest test of all.
 */
function allowance(tally: Tally): number {
  const seeds = decidedSeeds(tally);
  return seeds <= 0 ? 1 : SIGMAS * Math.sqrt(0.25 / seeds);
}

/* ------------------------------------------------------------------ exceptions */

interface Exception {
  readonly id: string;
  /**
   * The tier this was measured on. **A record gates its own tier and no other.** Balance is
   * not a property of a game, it is a property of a game and a bot ladder: `hand-slap` gives
   * seat two 65% on `normal` and seat one 100% on `easy`, and a single number could only ever
   * have been a lie about two of the three tiers.
   */
  readonly tier: Tier;
  /** Seat one's share of decided matches, or null when nothing was ever decided. */
  readonly share: number | null;
  /** The sample the number was taken at, because a record without its sample is an opinion. */
  readonly seeds: number;
  readonly why: string;
}

/**
 * Every game measured outside the band, per tier. **Each line is an issue, not a licence.**
 *
 * A record carries the tier it was measured on and gates that tier only. The `normal` lines
 * were measured with `DUELBOX_BALANCE_SEEDS=1000` - a thousand seeds, two thousand matches a
 * game. Three sigma at that sample is 4.7 points, and the last `normal` line is inside that:
 * it is outside the band by less than even the deepest sample can prove, and is recorded so
 * it is watched rather than because it is settled. The `easy` and `hard` lines were measured
 * at the fifty seeds their nightly job runs, which is the sample they are gated at; where a
 * line says `distinct 1` the game played the identical match a hundred times and the sample
 * size makes no difference to it at all.
 *
 * **The check on a listed game is one-sided.** It may drift away from 50% by up to the
 * sample's own allowance, and it may not drift back towards 50% past the edge of the flat
 * band at all: the moment a listed game measures inside 45-55 the assertion fails with "this
 * is now fair, delete its line". Crossing to the other side of the band fails too. The
 * two-sided version this replaced only asked that the fresh share land within the sample's
 * allowance of the recorded one, which at fifty seeds is 21.2 points - so six of the nine
 * lines it then held could have been repaired to a perfect 50% and kept their line, and the
 * list would have rotted into exactly the "games nobody has looked at since" it claims not to
 * be.
 *
 * `crabby-volley` was the first thing the new rule caught. It was recorded at 55.9% - 0.9
 * points outside the band against an allowance of 4.7, a candidate rather than a finding -
 * and it measures **52.0% at fifty seeds on normal, and 54.0% on easy**, inside the band on
 * both. Under the one-sided rule that is a failure demanding the line be deleted, so it is
 * deleted. The number is kept here rather than thrown away: if a deeper run puts it outside
 * the band again, it goes back with that measurement attached.
 *
 * The list prints in full on every run, at every sample size, so a cheap run cannot quietly
 * stop mentioning it.
 *
 * ## What the tier axis found the first time it was run
 *
 * Everything below tagged `easy` or `hard` is new, and none of it was visible while the file
 * only ever ran `normal`. The `hard` bots in the turn-board games play near-perfectly, and a
 * solved game played perfectly twice is not a coin toss: `color-wars`, `mancala`, `pop-it`,
 * `ultimate-ttt` and `reversi` each produced **one** match, played identically a hundred
 * times and won by the same seat every time. Those five lines are gone, and how they went is
 * the point: none of the five games changed a rule, they started reading
 * `context.openingSeat` (#2487). A deterministic game now produces **two** matches, one per
 * opening seat, and splits them exactly 50/50 - the seat that wins is the seat the shell
 * seated first, which is the shell's business and rotates on its own. `tic-tac-toe` draws all
 * hundred and keeps its line, because a solved game at its top tier has no balance to
 * measure whoever opens. `checkers` stops finishing at
 * all - a `termination.test.ts`-shaped finding this file can only report. And `hand-slap`
 * moves from 35% to 12% to 100% across normal, hard and easy, which is three different bugs
 * wearing one name.
 *
 * That is the whole argument for the tier axis in nine lines, and the reason the deliberate
 * break that measured 92% for seat one at `hard` read as a flat 50.0% at `normal`.
 */
const OUTSIDE_THE_BAND: readonly Exception[] = [
  {
    id: 'paint-fight',
    tier: 'normal',
    share: null,
    seeds: 1000,
    why:
      'every one of 2000 matches ended 245-245. Two normal bots mirror each other exactly on ' +
      'a symmetric board, so the territory count ties to the cell and the game cannot be ' +
      'balance-tested at all.',
  },
  {
    id: 'paint-fight',
    tier: 'hard',
    share: null,
    seeds: 50,
    why: 'ties on hard too, at 198-198, for the same mirroring reason. distinct 1.',
  },
  {
    id: 'paint-fight',
    tier: 'easy',
    share: 1.0,
    seeds: 50,
    why:
      'easy is the one tier that decides it, and it hands seat one every match of 100. So the ' +
      'symmetric board is not symmetric at all - the tie on normal and hard was hiding a total ' +
      'seat-one advantage, not proving fairness. distinct 1.',
  },
  {
    id: 'mini-soccer',
    tier: 'normal',
    share: 0.756,
    seeds: 1000,
    why:
      'seat one takes 76% of the 65% of matches that are decided at all - the other 35% are ' +
      'goalless draws after the full 98 simulated seconds. Not yet root-caused.',
  },
  {
    id: 'king-of-the-yard',
    tier: 'normal',
    share: 0.389,
    seeds: 1000,
    why:
      'seat two takes 61%. Sits closest to the band of anything on this list: it measures ' +
      '44.0% at fifty seeds, one point outside, so a bot change that moves it a little will ' +
      'fail this file with "delete its line". That is the rule working, not a false alarm - ' +
      're-measure at 1000 and either delete the line or rewrite it. hard is 56%, the other ' +
      'side of 50 and inside the band, which is worth an issue of its own.',
  },
  {
    id: 'hand-slap',
    tier: 'normal',
    share: 0.352,
    seeds: 1000,
    why:
      'seat two takes 65% on normal. A reaction game, so this is the one most likely to be a ' +
      'real timing asymmetry between the two halves of the device rather than a bot artefact.',
  },
  {
    id: 'hand-slap',
    tier: 'easy',
    share: 1.0,
    seeds: 50,
    why:
      'and on easy the same game gives seat ONE 100.0% of 100 decided matches, from 48 ' +
      'distinct ones. An asymmetry that changes sign with the bot tier is not one bug.',
  },
  {
    id: 'hand-slap',
    tier: 'hard',
    share: 0.12,
    seeds: 50,
    why: 'and on hard seat two takes 88%, worse than the 65% it takes on normal. The three ' +
      'tiers read 100 / 35 / 12 percent for seat one, which is the strongest evidence in this ' +
      'file that a single-tier balance number means nothing.',
  },
  {
    id: 'tic-tac-toe',
    tier: 'hard',
    share: null,
    seeds: 50,
    why:
      'every one of 100 matches drawn - which is what perfect play against perfect play does ' +
      'to noughts and crosses, so this line is a statement about the harness, not the game: ' +
      'a solved game at its top tier has no balance to measure. distinct 1.',
  },
];

/* ------------------------------------------------------------------ the sweep */

/** Every game in the registry. The sweep narrows nothing by name - see {@link measurable}. */
const IDS = Object.keys(LOADERS_FOR_TEST).sort();

const TALLIES = new Map<string, Tally>();
/** A game with no bot has nobody to sit opposite; `bot-parity.test.ts` owns that gap. */
const NO_BOT: string[] = [];
let sweepSeconds = 0;

function pct(value: number): string {
  return Number.isNaN(value) ? '   n/a' : `${(value * 100).toFixed(1).padStart(5)}%`;
}

/** The record that gates this run, if any: same id AND same tier. */
function recordedFor(id: string): Exception | undefined {
  return OUTSIDE_THE_BAND.find((entry) => entry.id === id && entry.tier === TIER);
}

/** The games no driver could bring to a conclusion - the computed skip. */
function unmeasurableTallies(): Tally[] {
  return [...TALLIES.values()].filter((tally) => !measurable(tally));
}

/** The games that are actually being asserted on. */
function measuredTallies(): Tally[] {
  return [...TALLIES.values()].filter(measurable);
}

/** Outside the flat band, before any allowance for the sample. */
function outsideFlatBand(tally: Tally): boolean {
  const value = share(tally);
  return Number.isNaN(value) || value < BAND_LOW || value > BAND_HIGH;
}

/** Outside the band by more than this sample can put down to chance - what the test asserts. */
function provenOutside(tally: Tally): boolean {
  const value = share(tally);
  if (Number.isNaN(value)) return true;
  const tolerance = allowance(tally);
  return value < BAND_LOW - tolerance || value > BAND_HIGH + tolerance;
}

function report(): string {
  const rows = measuredTallies().sort((a, b) => {
    const da = Number.isNaN(share(a)) ? 9 : Math.abs(share(a) - 0.5);
    const db = Number.isNaN(share(b)) ? 9 : Math.abs(share(b) - 0.5);
    return db - da;
  });
  const dark = unmeasurableTallies();
  const outsideBand = rows.filter(outsideFlatBand).length;
  const beyondNoise = rows.filter(provenOutside).length;

  const solo = rows.filter((tally) => tally.blind);
  const lines: string[] = [''];
  lines.push(
    `BALANCE AT EQUAL SKILL - ${TIER} v ${TIER}, ${String(MATCH_BUDGET)} matches per game ` +
      `over ${String(rows.length)} measurable games, ${sweepSeconds.toFixed(1)}s`,
  );
  lines.push('');
  lines.push(
    `  SAMPLE    ${String(SEEDS)} seeds x 2 opening seats for a game that reads ` +
      `context.openingSeat, and ${String(SOLO_SEEDS)} seeds x 1 for one that never`,
  );
  lines.push(
    `                          reads it, out of the same budget - its two arms are the same ` +
      `match. ${String(solo.length)} of ${String(rows.length)} games`,
  );
  lines.push(
    `                          are measured from one arm today. See the seeds column, which ` +
      `is what the +/- column is over.`,
  );
  lines.push(
    `  CLAIMED   ${(BAND_LOW * 100).toFixed(0)}-${(BAND_HIGH * 100).toFixed(0)}%       ` +
      `the band the fifty open issues ask for, and the headline of this file.`,
  );
  lines.push(
    `  ENFORCED  ${(ENFORCED_LOW * 100).toFixed(1)}-${(ENFORCED_HIGH * 100).toFixed(1)}%   ` +
      `what this run can actually fail on: the flat band widened by ${String(SIGMAS)} sigma of`,
  );
  lines.push(
    `                          its own sample, ${(ALLOWANCE_PAIRED * 100).toFixed(1)} ` +
      `points at ${String(SEEDS)} paired seeds and ` +
      `${(ALLOWANCE_SOLO * 100).toFixed(1)} at ${String(SOLO_SEEDS)} single-arm ones`,
  );
  lines.push(
    `                          (${(ENFORCED_LOW_SOLO * 100).toFixed(1)}-` +
      `${(ENFORCED_HIGH_SOLO * 100).toFixed(1)}%). A game that draws some of its matches gets ` +
      `a wider one still -`,
  );
  lines.push(
    `                          that is the +/- column. 250 paired seeds enforces 35.5-64.5%, ` +
      `1000 enforces 40.3-59.7%.`,
  );
  lines.push(
    `  GAP       ${String(outsideBand).padStart(3)} of ${String(rows.length)} games measure ` +
      `outside the CLAIMED band. ${String(beyondNoise)} are outside the ENFORCED one,`,
  );
  lines.push(`                          and only those ${String(beyondNoise)} can fail.`);
  lines.push('');
  lines.push(
    'game                      archetype   seat-one   +/-  seeds  decided  draws  round(s)   ' +
      'opener  distinct',
  );
  for (const tally of rows) {
    const value = share(tally);
    const outside = outsideFlatBand(tally);
    const proven = provenOutside(tally);
    lines.push(
      [
        tally.id.padEnd(25),
        tally.archetype.padEnd(11),
        pct(value),
        (allowance(tally) * 100).toFixed(1).padStart(6),
        String(tally.seeds).padStart(5),
        String(decided(tally)).padStart(8),
        pct(drawRate(tally)),
        roundSeconds(tally).toFixed(1).padStart(9),
        `${String(tally.openerSwung)}/${String(tally.pairsChecked)}`.padStart(8),
        String(tally.outcomes.size).padStart(8),
        proven ? (recordedFor(tally.id) ? '  OUT (recorded)' : '  OUT') : outside ? '  ?' : '',
      ].join(' '),
    );
  }
  const blind = rows.filter((tally) => tally.openerSwung === 0);
  lines.push('');
  lines.push(
    `${String(outsideBand)} games measured outside the flat ` +
      `${(BAND_LOW * 100).toFixed(0)}-${(BAND_HIGH * 100).toFixed(0)}% band, ` +
      `${String(beyondNoise)} of them by more than this sample's allowance (OUT). The rest are ` +
      `marked "?": outside the claimed band and inside the noise, which at ${String(SEEDS)} ` +
      `seeds means only that the sample is small.`,
  );
  lines.push(
    `opener: of the seed pairs both arms of which were played, how many ended differently ` +
      `when only the opening seat changed. ${String(blind.length)} of ${String(rows.length)} ` +
      `games never swung; ${String(solo.length)} of those never read context.openingSeat at ` +
      `all and are the ones measured from one arm.`,
  );
  const scripted = rows.filter((tally) => tally.outcomes.size === 1);
  lines.push(
    `distinct: how many different matches the counted ones were. ${String(scripted.length)} ` +
      `games produced exactly one, so for those the share above is exact and the sample size ` +
      `means nothing: ${scripted.map((t) => t.id).join(', ') || 'none'}`,
  );
  lines.push(
    `unmeasurable, skipped: ${String(dark.length)} of ${String(TALLIES.size)} games reached no ` +
      `conclusion at all - not a win, not a draw - in any of their ` +
      `${String(MATCH_BUDGET + 1)} matches, under either opening seat or with the device ` +
      `shouted at. Computed, not listed: ${dark.map((t) => t.id).join(', ') || 'none'}`,
  );
  const odd = rows.filter((tally) => tally.unexplained.length > 0);
  if (odd.length > 0) {
    lines.push('');
    lines.push(
      `HIDDEN PER-OPENER STATE - ${String(odd.length)} games produced two arms of one seed ` +
        `that the opening seat cannot explain. Halving the sweep for these would be wrong:`,
    );
    for (const tally of odd) {
      for (const note of tally.unexplained.slice(0, 3)) lines.push(`  ${tally.id}: ${note}`);
      if (tally.unexplained.length > 3) {
        lines.push(`  ${tally.id}: and ${String(tally.unexplained.length - 3)} more`);
      }
    }
  }
  lines.push('');
  const mine = OUTSIDE_THE_BAND.filter((entry) => entry.tier === TIER).length;
  lines.push(
    `OUTSIDE THE BAND - every line is an issue. ${String(OUTSIDE_THE_BAND.length)} records over ` +
      `three tiers; the ${String(mine)} tagged [${TIER}] are the ones this run gates, one-sided: ` +
      `a listed game may drift further out by up to its allowance, and may not come back inside ` +
      `the flat band without failing.`,
  );
  if (OUTSIDE_THE_BAND.length === 0) lines.push('  (none recorded)');
  for (const entry of OUTSIDE_THE_BAND) {
    const was = entry.share === null ? 'never decides' : `${(entry.share * 100).toFixed(1)}%`;
    const fresh = entry.tier === TIER ? TALLIES.get(entry.id) : undefined;
    const now = fresh === undefined ? 'other tier' : pct(share(fresh)).trim();
    lines.push(
      `  [${entry.tier.padEnd(6)}] ${entry.id.padEnd(18)} recorded ${was.padStart(13)} ` +
        `@${String(entry.seeds)} seeds  now ${now.padStart(10)}  ${entry.why}`,
    );
  }
  if (NO_BOT.length > 0) lines.push(`no bot, not measured: ${NO_BOT.join(', ')}`);
  lines.push('');
  return lines.join('\n');
}

/**
 * The hook budget, measured rather than guessed.
 *
 * `hard` bots search, and over the whole registry a hard seed costs about three times a normal
 * one - 355s against 115s for fifty seeds. The old budget was a flat `SEEDS * 2_500` tuned on
 * `normal` over a smaller catalogue, and the first `hard` run this file ever did hit the hook
 * timeout at 180s without printing its table, which is the least useful way for a sweep to
 * fail: the whole deliverable is the table, and a timeout throws it away.
 *
 * So: the measured local cost per seed, times the four-to-five that `bot-cost.test.ts` puts CI
 * at for search-heavy work. That is deliberately generous — the job's own `timeout-minutes` is
 * the real backstop against a hang, and this number exists only so a slow-but-working run
 * still prints.
 */
const LOCAL_MS_PER_SEED = TIER === 'hard' ? 7_200 : 2_400;
const CI_SLOWDOWN = 5;

beforeAll(async () => {
  const started = Date.now();
  for (const id of IDS) {
    const loaded = await LOADERS_FOR_TEST[id]!();
    if (!loaded.manifest.modes.includes('bot')) {
      NO_BOT.push(id);
      continue;
    }
    TALLIES.set(id, measure(id, loaded));
  }
  sweepSeconds = (Date.now() - started) / 1000;
  // eslint-disable-next-line no-console -- the table is the deliverable of issue #154.
  console.log(report());
}, Math.max(300_000, SEEDS * LOCAL_MS_PER_SEED * CI_SLOWDOWN));

/* ------------------------------------------------------------------ assertions */

describe('the balance harness', () => {
  it('measured every game in the registry', () => {
    // Read from the registry rather than from `IDS`, because `IDS` is what the sweep walks.
    // The first version of this compared `IDS` with itself, so narrowing the sweep to skip a
    // game passed it - a coverage guard that could not notice a game going missing.
    const accounted = new Set([...TALLIES.keys(), ...NO_BOT]);
    const missed = Object.keys(LOADERS_FOR_TEST).filter((id) => !accounted.has(id));
    expect(
      missed,
      `these games are in the registry and were never measured: ${missed.join(', ')}`,
    ).toEqual([]);
    for (const tally of TALLIES.values()) {
      // Every game gets the same budget, whichever shape its sweep took - that is what makes
      // the single-arm sweep a free doubling of the sample rather than a different test. The
      // one extra match is the shouted probe, which was always outside the budget.
      expect(tally.played, `${tally.id} did not spend its match budget`).toBe(MATCH_BUDGET + 1);
      expect(tally.matches, `${tally.id} counted the wrong number of matches`).toBe(
        tally.blind ? tally.seeds : tally.seeds * 2,
      );
      expect(tally.seeds, `${tally.id} sampled the wrong number of seeds`).toBe(
        tally.blind ? SOLO_SEEDS : SEEDS,
      );
    }
  });

  it('never counts the same match twice, and says so when it cannot tell', () => {
    // The guard #2494 asked for in as many words. A game is measured from one arm only when
    // it never reads `context.openingSeat`, which makes the arm it skipped the arm it played:
    // the two contexts differ in that property and in nothing else. `PROBE_SEEDS` seeds prove
    // it up front and one seed in `AUDIT_EVERY` keeps proving it, and anything the opening
    // seat cannot account for is collected rather than absorbed.
    //
    // Two shapes land here, and neither may be silently halved. A pair with the same winner
    // after the same number of steps but a different scoreline is per-opener state that
    // `openerSwung` is blind to by construction. A pair that differs at all in a game that
    // never asked which seat opened is state surviving from one match into the next, which
    // would make every number in this file a measurement of the harness.
    const found = [...TALLIES.values()].filter((tally) => tally.unexplained.length > 0);
    const detail = found
      .map((tally) => `${tally.id} - ${tally.unexplained[0] ?? ''}`)
      .join('\n  ');
    expect(
      found.map((tally) => tally.id),
      `these games produced two arms of one seed that the opening seat cannot explain, so ` +
        `they have hidden per-opener state and must not be measured from one arm:\n  ` +
        `${detail}`,
    ).toEqual([]);
  });

  it('is not measuring anything a person at the device could have changed', () => {
    // Every seat is a bot here, so the input state ought to be dead weight - which is the
    // whole justification for driving the sweep with a frozen idle state instead of a real
    // `InputManager`. One seed a game is replayed with everything pressed, held and shoved
    // at once; if any game plays out differently, the sweep is measuring the harness's own
    // idle input as well as the game, and the shortcut is no longer sound.
    const reading = [...TALLIES.values()].filter((tally) => tally.readsInput).map((t) => t.id);
    expect(
      reading,
      `these games changed their match when a bot-held seat was given input: ${reading.join(', ')}`,
    ).toEqual([]);
  });

  it('skips only games that no driver can bring to a conclusion', () => {
    // The honest version of the old "skips only scaffolds" test, which asserted nothing about
    // the nine ids it skipped except that they were still in the registry - while six of them
    // were working games deciding 94 to 100 matches each behind its back.
    //
    // There is no list any more, so this cannot claim a skipped id is a scaffold. What it can
    // claim, and what makes hiding impossible, is that a skipped game won nothing, drew
    // nothing and finished nothing under any of the three drivers. A working game cannot
    // satisfy that.
    for (const tally of unmeasurableTallies()) {
      const seen = `decided ${String(decided(tally))}, drew ${String(tally.draws)}`;
      expect(
        tally.concluded,
        `${tally.id} is being skipped as unmeasurable but concluded ${String(tally.concluded)} ` +
          `matches (${seen}). It is a real game and must be measured.`,
      ).toBe(0);
      expect(
        tally.unfinished,
        `${tally.id} is being skipped as unmeasurable but did not run every one of its matches ` +
          `to the full ten simulated minutes`,
      ).toBe(tally.matches);
    }
  });

  it('does not let a working game go dark', () => {
    // The other side of the computed skip. A game that regressed until it never finished a
    // match would drop out of the sweep with no assertion left pointing at it, so the number
    // of games that do finish something is ratcheted upwards. Scaffolding a new package does
    // not move it; breaking a built game does.
    const measured = measuredTallies().map((t) => t.id);
    const dark = unmeasurableTallies().map((t) => t.id);
    expect(
      measured.length,
      `${String(measured.length)} games reach a conclusion on ${TIER} and the ratchet is set ` +
        `at ${String(MEASURED_MIN[TIER])}. If a game has been finished or added, raise ` +
        `MEASURED_MIN[${TIER}]; if one has stopped finishing matches, that is the bug. ` +
        `Unmeasurable on ${TIER} today: ${dark.join(', ') || 'none'}`,
    ).toBeGreaterThanOrEqual(MEASURED_MIN[TIER]);
  });

  it('names only real games in its exceptions list, and only once per tier', () => {
    const seen = new Set<string>();
    for (const entry of OUTSIDE_THE_BAND) {
      expect(LOADERS_FOR_TEST, `${entry.id} is recorded but is not in the registry`).toHaveProperty(
        entry.id,
      );
      const key = `${entry.id}@${entry.tier}`;
      expect(seen, `${entry.id} is recorded twice for ${entry.tier}`).not.toContain(key);
      seen.add(key);
      // A record that is itself inside the band could never fail the one-sided check below,
      // because that check's whole content is "you have not come back inside the band yet".
      if (entry.share !== null) {
        expect(
          entry.share < BAND_LOW || entry.share > BAND_HIGH,
          `${entry.id} is recorded at ${(entry.share * 100).toFixed(1)}%, which is inside the ` +
            `band. A line recorded inside the band asserts nothing - delete it.`,
        ).toBe(true);
      }
    }
    // Only the records for the tier being run can be checked against a measurement.
    for (const entry of OUTSIDE_THE_BAND.filter((e) => e.tier === TIER)) {
      const tally = TALLIES.get(entry.id);
      expect(tally, `${entry.id} is recorded for ${TIER} but has no bot to measure`).toBeDefined();
      expect(
        tally !== undefined && measurable(tally),
        `${entry.id} is recorded as outside the band on ${TIER} but no driver can conclude a ` +
          `match of it, so the record cannot be checked against anything`,
      ).toBe(true);
    }
  });

  it('does not let another turn-based game ignore the opening seat', () => {
    // A ratchet: it may only ever go down, so a new turn game cannot quietly join the ones
    // that ignore `context.openingSeat` and leave the SDK alternating an opener that
    // reaches nothing.
    //
    // Scoped to `turn-*`, because the contract says outright that "real-time games have no
    // opener and may ignore this" — and roughly half the blind list is real-time. Counting
    // those failed four games in one afternoon for doing exactly what the SDK permits,
    // which is a guard punishing correct behaviour rather than catching a defect.
    //
    // Several real-time games this session did find an honest use anyway — handing bot
    // streams out by opener makes a seed's two rounds exact mirrors, which turns a 50%
    // *measurement* into a symmetry *proof*. That is worth doing and is not worth failing
    // a build over.
    const blind = measuredTallies()
      .filter((tally) => tally.openerSwung === 0 && tally.archetype.startsWith('turn'))
      .map((t) => t.id);
    expect(
      blind.length,
      `${String(blind.length)} turn-based games ignore context.openingSeat and the ratchet ` +
        `is set at ${String(OPENER_BLIND)}. A new turn game must read it: ${blind.join(', ')}`,
    ).toBeLessThanOrEqual(OPENER_BLIND);
  });
});

describe('neither seat wins more than the 45-55 band at equal skill', () => {
  it.each(IDS)('%s', (id) => {
    const tally = TALLIES.get(id);
    if (!tally) return; // no bot at all; bot-parity.test.ts owns that.
    // Unmeasurable, and the two harness tests above own that between them: one asserts it
    // really did conclude nothing under any driver, the other ratchets the count that do.
    if (!measurable(tally)) return;

    const recorded = recordedFor(id);
    const value = share(tally);
    const tolerance = allowance(tally);
    const seen = `${(value * 100).toFixed(1)}% of ${String(decided(tally))} decided matches`;
    const band = `${(BAND_LOW * 100).toFixed(0)}-${(BAND_HIGH * 100).toFixed(0)}%`;

    if (recorded) {
      // `recordedFor` matched this tier as well as this id, so a game recorded on `normal` is
      // still gated by the flat band on `easy` and `hard`. Balance is a property of the pair.
      //
      // Recorded exceptions are not skipped, and the check is one-sided: worse is tolerated
      // up to the sample's noise, better is not tolerated at all.
      if (recorded.share === null) {
        expect(
          decided(tally),
          `${id} is recorded on ${TIER} as never deciding a match and has just decided ` +
            `${String(decided(tally))}. If that is a repair, delete its line and let the band ` +
            `assertion have it; if it has moved, re-measure at 1000 seeds.`,
        ).toBe(0);
        return;
      }
      expect(decided(tally), `${id} decided nothing this run`).toBeGreaterThan(0);

      const recordedHigh = recorded.share > BAND_HIGH;
      const at = `${(recorded.share * 100).toFixed(1)}%`;
      // How far outside the flat band the record sits. A repair shows up as a fresh reading
      // inside the band, and this sample can only tell that from noise when the record is
      // further out than the sample's own allowance - see {@link OUTSIDE_THE_BAND}.
      const outBy = recordedHigh ? recorded.share - BAND_HIGH : BAND_LOW - recorded.share;
      if (outBy > tolerance) {
        expect(
          value >= BAND_LOW && value <= BAND_HIGH,
          `${id} is recorded on ${TIER} at ${at} and measured ${seen} - inside the flat ${band} ` +
            `band, and the record is ${(outBy * 100).toFixed(1)} points outside it against this ` +
            `sample's allowance of ${(tolerance * 100).toFixed(1)}, so noise cannot account for ` +
            `the difference. This is now fair: delete its ${TIER} line from OUTSIDE_THE_BAND. ` +
            `There is deliberately no allowance in this direction, because the two-sided check ` +
            `this replaced would have let a game be repaired to a perfect 50% and keep its ` +
            `stale line for ever.`,
        ).toBe(false);
      }
      expect(
        recordedHigh ? value >= BAND_LOW : value <= BAND_HIGH,
        `${id} is recorded ${recordedHigh ? 'above' : 'below'} the band at ${at} and measured ` +
          `${seen}, on the other side of it. A seat advantage that changed sign is a new ` +
          `finding: re-measure at 1000 seeds and rewrite its line.`,
      ).toBe(true);
      expect(
        Math.abs(value - recorded.share),
        `${id} is recorded at ${at} and measured ${seen}, which this sample's allowance of ` +
          `${(tolerance * 100).toFixed(1)} points cannot explain. Re-measure at 1000 seeds and ` +
          `rewrite its line.`,
      ).toBeLessThanOrEqual(tolerance);
      return;
    }

    const complaint =
      `${id} gave seat one ${seen}, outside the ${band} band by more than this sample's ` +
      `allowance of ${(tolerance * 100).toFixed(1)} points. Do not widen the band: fix the game, ` +
      `or measure it at 1000 seeds and record it in OUTSIDE_THE_BAND.`;

    expect(
      decided(tally),
      `${id} concludes its matches but decided none of its ${String(tally.matches)}, so it has ` +
        `no balance to measure at all. Record it in OUTSIDE_THE_BAND with share: null.`,
    ).toBeGreaterThan(0);
    expect(value, complaint).toBeGreaterThanOrEqual(BAND_LOW - tolerance);
    expect(value, complaint).toBeLessThanOrEqual(BAND_HIGH + tolerance);
  });
});

describe('the catalogue as a whole', () => {
  it('does not lean towards a seat across every game at once', () => {
    // Thousands of decided matches even on the cheap sample, so this one gets the flat band.
    // It is blind to one game leaning left while another leans right - that is what the
    // per-game assertion is for. This is the cheap check that the *product* is not one-sided,
    // which is the shape the Penalty Kicks failure would have had across many games.
    let seatOne = 0;
    let total = 0;
    for (const tally of measuredTallies()) {
      if (recordedFor(tally.id)) continue;
      seatOne += tally.seatOne;
      total += decided(tally);
    }
    expect(total, 'too few decided matches to say anything').toBeGreaterThan(1000);
    const pooled = seatOne / total;
    const message = `seat one took ${(pooled * 100).toFixed(2)}% of ${String(total)} decided matches across the catalogue`;
    expect(pooled, message).toBeGreaterThanOrEqual(BAND_LOW);
    expect(pooled, message).toBeLessThanOrEqual(BAND_HIGH);
  });
});
