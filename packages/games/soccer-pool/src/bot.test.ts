import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext, InputState, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { SoccerPoolGame } from './game.js';
import { MAX_SHOTS } from './rules.js';
import type { BotDifficulty } from './rules.js';

/**
 * What the three tiers are actually worth, measured.
 *
 * The global `bot-parity` guard only checks that the tiers *differ*; whether they are
 * ordered by strength is a per-game measurement over hundreds of seeded matches, and this
 * is where Soccer Pool makes it. The numbers written into `SPEC.md` come from here, so a
 * tuning change that quietly flattens the ladder fails a test rather than aging a document.
 *
 * Every pairing is played from **both seats on the same seed** and the two runs added
 * together, because the kick-off from the centre spot is the single best shot on the pitch
 * and a one-sided sample would credit it to whichever tier happened to take it.
 *
 * The sweep also **alternates the opening seat** across seeds, because the shell does
 * (`GameContext.openingSeat`, #2487). Pinning it to `p1` — which this file used to do —
 * makes the opener's advantage arrive already stamped with a seat, and there is then no
 * measurement that can tell the two apart. That is exactly what issue #2500 was: this file
 * read 57.5% and called it a seat edge, while the product harness, which alternates, read
 * 50.0%. Both numbers were right about different things.
 */

const STEP = 1 / 60;
/** Ten minutes, the ceiling `apps/web/src/data/termination.test.ts` allows. */
const TEN_MINUTES = 60 * 600;
/** Matches per direction per pairing. Two hundred a pairing all told. */
const SEEDS = 100;

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

const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

function contextFor(
  seed: number,
  p1: BotDifficulty,
  p2: BotDifficulty,
  openingSeat: SeatId,
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat,
    botDifficulty: (seat: SeatId) => (seat === 'p1' ? p1 : p2),
  };
}

interface Played {
  readonly winner: SeatId | 'draw' | null;
  readonly steps: number;
  readonly goals: number;
  readonly shots: number;
}

function play(seed: number, p1: BotDifficulty, p2: BotDifficulty, openingSeat: SeatId): Played {
  const game = new SoccerPoolGame();
  game.init(contextFor(seed, p1, p2, openingSeat));
  for (let i = 0; i < TEN_MINUTES; i += 1) {
    game.update(STEP, SILENT);
    const score = game.getScore();
    if (score.winner !== null) {
      return {
        winner: score.winner,
        steps: i,
        goals: score.p1 + score.p2,
        shots: game.match.shots,
      };
    }
  }
  return { winner: null, steps: TEN_MINUTES, goals: 0, shots: game.match.shots };
}

interface Tally {
  /** Wins for the first named tier, over both seats. */
  wins: number;
  losses: number;
  draws: number;
  unfinished: number;
  /** Decided matches won by the near seat, whichever tier and whichever opener. */
  seatOne: number;
  /** Decided matches won by whoever took the kick-off, whichever seat that was. */
  opener: number;
  goals: number;
  steps: number;
  worst: number;
}

function measure(a: BotDifficulty, b: BotDifficulty, seeds = SEEDS): Tally {
  const tally: Tally = {
    wins: 0,
    losses: 0,
    draws: 0,
    unfinished: 0,
    seatOne: 0,
    opener: 0,
    goals: 0,
    steps: 0,
    worst: 0,
  };
  for (let s = 1; s <= seeds; s += 1) {
    const seed = s * 7919;
    // Odd seeds open near, even seeds open far. Both tier orders see both openers an
    // equal number of times, so the sweep costs exactly what it did before.
    const openingSeat: SeatId = s % 2 === 0 ? 'p2' : 'p1';
    for (const forward of [true, false]) {
      const result = forward ? play(seed, a, b, openingSeat) : play(seed, b, a, openingSeat);
      if (result.winner === null) {
        tally.unfinished += 1;
        continue;
      }
      tally.goals += result.goals;
      tally.steps += result.steps;
      if (result.steps > tally.worst) tally.worst = result.steps;
      if (result.winner === 'draw') {
        tally.draws += 1;
        continue;
      }
      if (result.winner === 'p1') tally.seatOne += 1;
      if (result.winner === openingSeat) tally.opener += 1;
      const aSeat: SeatId = forward ? 'p1' : 'p2';
      if (result.winner === aSeat) tally.wins += 1;
      else tally.losses += 1;
    }
  }
  return tally;
}

function shareOfDecided(tally: Tally): number {
  const decided = tally.wins + tally.losses;
  return decided === 0 ? 0.5 : tally.wins / decided;
}

/** Every pairing measured once, so the whole file costs one sweep rather than nine. */
const SWEEP = new Map<string, Tally>();
for (let i = 0; i < TIERS.length; i += 1) {
  for (let j = i; j < TIERS.length; j += 1) {
    SWEEP.set(`${TIERS[i]!}:${TIERS[j]!}`, measure(TIERS[i]!, TIERS[j]!));
  }
}

function tallyFor(a: BotDifficulty, b: BotDifficulty): Tally {
  return SWEEP.get(`${a}:${b}`)!;
}

describe('the ladder', () => {
  it('has normal beating easy comfortably', () => {
    const share = shareOfDecided(tallyFor('easy', 'normal'));
    expect(1 - share, 'normal against easy').toBeGreaterThan(0.8);
  });

  it('has hard beating easy more comfortably still', () => {
    const share = shareOfDecided(tallyFor('easy', 'hard'));
    expect(1 - share, 'hard against easy').toBeGreaterThan(0.9);
  });

  it('has hard beating normal', () => {
    const share = shareOfDecided(tallyFor('normal', 'hard'));
    expect(1 - share, 'hard against normal').toBeGreaterThan(0.7);
  });

  it('is ordered, rung by rung', () => {
    const overEasy = 1 - shareOfDecided(tallyFor('easy', 'normal'));
    const hardOverEasy = 1 - shareOfDecided(tallyFor('easy', 'hard'));
    const hardOverNormal = 1 - shareOfDecided(tallyFor('normal', 'hard'));
    expect(hardOverEasy, 'hard is further above easy than normal is').toBeGreaterThan(overEasy);
    expect(hardOverNormal).toBeGreaterThan(0.5);
  });

  it('is a ladder rather than a wall: the weakest tier still wins sometimes', () => {
    // A tier that never wins is not an opponent. Mini Golf's first ladder was 120-0 and had
    // to be rebuilt; this is the check that this one does not become that.
    expect(tallyFor('easy', 'normal').wins + tallyFor('easy', 'hard').wins).toBeGreaterThan(0);
  });

  it('scores more goals the stronger the pair', () => {
    const perMatch = (a: BotDifficulty, b: BotDifficulty): number => {
      const tally = tallyFor(a, b);
      return tally.goals / (tally.wins + tally.losses + tally.draws);
    };
    expect(perMatch('normal', 'normal')).toBeGreaterThan(perMatch('easy', 'easy'));
    expect(perMatch('hard', 'hard')).toBeGreaterThan(perMatch('normal', 'normal'));
  });

  it('draws less often the stronger the pair, because more goals decide it', () => {
    const rate = (a: BotDifficulty, b: BotDifficulty): number => {
      const tally = tallyFor(a, b);
      return tally.draws / (tally.wins + tally.losses + tally.draws);
    };
    expect(rate('hard', 'hard')).toBeLessThan(rate('normal', 'normal'));
    expect(rate('normal', 'normal')).toBeLessThan(rate('easy', 'easy'));
    expect(rate('hard', 'hard'), 'and the strongest pair is decided most of the time').toBeLessThan(
      0.45,
    );
  });
});

describe('the two chairs', () => {
  it('gives neither seat more than the product band allows', () => {
    // The criterion the fifty "audit fairness" issues all converge on, and the one
    // `apps/web/src/data/balance-aggregate.test.ts` enforces across every game:
    // neither seat wins more than 45-55 percent at equal skill.
    //
    // This file used to assert 50-65 percent here and call it "an edge, not the match",
    // which is a floor at the product's ceiling — a game could not pass both (#2500).
    // The disagreement was never about the game. It was that this sweep pinned the
    // opening seat to `p1`, so the kick-off advantage below arrived wearing a seat.
    let decided = 0;
    let seatOne = 0;
    for (const tally of SWEEP.values()) {
      decided += tally.wins + tally.losses;
      seatOne += tally.seatOne;
    }
    expect(decided).toBeGreaterThan(500);
    const share = seatOne / decided;
    expect(share, `seat one won ${(share * 100).toFixed(1)}% of ${decided}`).toBeGreaterThan(0.45);
    expect(share, `seat one won ${(share * 100).toFixed(1)}% of ${decided}`).toBeLessThan(0.55);
  });

  it('gives no tier a seat of its own', () => {
    // Per pairing rather than in aggregate, because a lean that cancels between tiers is
    // still a lean. The band is wider than the product's only because each pairing decides
    // a few hundred matches, where +-5 points is inside the noise; the aggregate above is
    // what holds the game to 45-55.
    for (const [pairing, tally] of SWEEP) {
      const decided = tally.wins + tally.losses;
      expect(decided, `${pairing} decided too few`).toBeGreaterThan(40);
      const share = tally.seatOne / decided;
      expect(share, `${pairing}: seat one won ${(share * 100).toFixed(1)}%`).toBeGreaterThan(0.42);
      expect(share, `${pairing}: seat one won ${(share * 100).toFixed(1)}%`).toBeLessThan(0.58);
    }
  });

  it('does give the kick-off a real advantage, which is the game and not a defect', () => {
    // Striking first from the centre spot is the best shot on the pitch, the same edge
    // Pool's break has. It is worth keeping and worth measuring — but it belongs to
    // whoever opens, not to a chair. The shell alternates the opener between rounds of a
    // best-of, so across a match the two players get it equally often.
    let decided = 0;
    let opener = 0;
    for (const tally of SWEEP.values()) {
      decided += tally.wins + tally.losses;
      opener += tally.opener;
    }
    const share = opener / decided;
    expect(share, `the opener won ${(share * 100).toFixed(1)}% of ${decided}`).toBeGreaterThan(0.5);
    expect(share, 'an edge, not the match').toBeLessThan(0.65);
  });

  it('leans on the kick-off hardest when both bots are weakest', () => {
    // The measurement that made the point: two easy bots, and whoever opens takes about
    // three quarters of the decided matches, because neither can recover the deficit. Two
    // hard bots are near the sweep average. So the kick-off edge is a function of how well
    // the shot is answered, which is what it should be.
    const shareOf = (a: BotDifficulty, b: BotDifficulty): number => {
      const tally = tallyFor(a, b);
      return tally.opener / (tally.wins + tally.losses);
    };
    expect(shareOf('easy', 'easy')).toBeGreaterThan(shareOf('hard', 'hard'));
  });
});

describe('every measured match finished', () => {
  it('left nothing unfinished in the whole sweep', () => {
    for (const [pairing, tally] of SWEEP) {
      expect(tally.unfinished, `${pairing} left matches unfinished`).toBe(0);
    }
  });

  it('finished the slowest of them in well under the ten minutes allowed', () => {
    let worst = 0;
    for (const tally of SWEEP.values()) if (tally.worst > worst) worst = tally.worst;
    expect(worst / 60, 'the longest match in the sweep, in seconds').toBeLessThan(120);
  });

  it('averaged about a minute a match', () => {
    let steps = 0;
    let matches = 0;
    for (const tally of SWEEP.values()) {
      steps += tally.steps;
      matches += tally.wins + tally.losses + tally.draws;
    }
    const mean = steps / matches / 60;
    expect(mean).toBeGreaterThan(20);
    expect(mean).toBeLessThan(120);
  });

  it('never spent more than the shots a match has', () => {
    for (const tier of TIERS) {
      for (const openingSeat of ['p1', 'p2'] as const) {
        const result = play(4242, tier, tier, openingSeat);
        expect(result.shots, `${tier}, ${openingSeat} opening`).toBeLessThanOrEqual(MAX_SHOTS);
      }
    }
  });
});
