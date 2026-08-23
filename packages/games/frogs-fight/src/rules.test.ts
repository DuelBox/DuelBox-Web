import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_DRAWS_PER_DECISION,
  BOT_PROFILES,
  BUG_BUDGET,
  DRAGONFLY_EVERY,
  DRAGONFLY_POINTS,
  FLY_POINTS,
  GRID,
  HOP_MIN_SECONDS,
  PAD_COUNT,
  PAD_X,
  PAD_Y,
  POND,
  P1_HOME,
  P2_HOME,
  REACH,
  REST_SECONDS,
  TARGET_POINTS,
  TIE_SECONDS,
  arrivalSeconds,
  botIntent,
  bugOn,
  candidatePads,
  createBotState,
  createGame,
  frogOf,
  hopFrog,
  hopSeconds,
  mirrorPad,
  nextHop,
  padTowards,
  resetGame,
  step,
  travel,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;
const SEATS: readonly SeatId[] = ['p1', 'p2'];

/** The eight compass pushes a keyboard can express. Nothing finer exists in this game. */
const PUSHES: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** Counts how many values a bot pulls out of the stream. */
class CountingRng extends Rng {
  draws = 0;

  override next(): number {
    this.draws += 1;
    return super.next();
  }
}

function fresh(): Game {
  const game = createGame();
  resetGame(game);
  return game;
}

/** Put a bug on a pad by hand, so a test can arrange a landing rather than wait for one. */
function placeBug(game: Game, pad: number, points: number): void {
  const bug = game.bugs[0]!;
  bug.active = true;
  bug.pad = pad;
  bug.points = points;
  bug.life = 5;
  bug.lifeTotal = 5;
}

/** Run a whole match between two bots and report who took it. */
function playBots(seed: number, tiers: Readonly<Record<SeatId, BotDifficulty>>): Game {
  const game = fresh();
  const rng = new Rng(seed);
  const streams: Record<SeatId, Rng> = { p1: new Rng(rng.next() | 0), p2: new Rng(rng.next() | 0) };
  const states = { p1: createBotState(), p2: createBotState() };
  const push = { x: 0, y: 0 };
  for (let i = 0; i < 60 * 600 && winnerOf(game) === null; i += 1) {
    for (const seat of SEATS) {
      botIntent(game, seat, tiers[seat], states[seat], STEP, streams[seat], push);
      hopFrog(game, seat, push.x, push.y);
    }
    step(game, STEP, rng);
  }
  return game;
}

describe('the pond', () => {
  it('is exactly its own reflection through the centre', () => {
    for (let pad = 0; pad < PAD_COUNT; pad += 1) {
      const opposite = mirrorPad(pad);
      // Exact equality, not a tolerance: the scatter is stored once and negated, so the two
      // halves are the same numbers rather than nearly the same ones.
      expect(PAD_X[pad]).toBe(POND - PAD_X[opposite]!);
      expect(PAD_Y[pad]).toBe(POND - PAD_Y[opposite]!);
    }
  });

  it('gives every pad exactly the eight pads around it, scatter and all', () => {
    // The whole design rests on the neighbourhood being the grid's, not an accident of how
    // far the scatter happened to push two pads apart.
    for (let pad = 0; pad < PAD_COUNT; pad += 1) {
      const row = Math.floor(pad / GRID);
      const col = pad % GRID;
      const expected: number[] = [];
      for (let dRow = -1; dRow <= 1; dRow += 1) {
        for (let dCol = -1; dCol <= 1; dCol += 1) {
          if (dRow === 0 && dCol === 0) continue;
          const nearRow = row + dRow;
          const nearCol = col + dCol;
          if (nearRow < 0 || nearRow >= GRID || nearCol < 0 || nearCol >= GRID) continue;
          expected.push(nearRow * GRID + nearCol);
        }
      }
      expect([...REACH[pad]!].sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
    }
  });

  it('reflects its reach, its routes and its travel times exactly', () => {
    for (let from = 0; from < PAD_COUNT; from += 1) {
      expect([...REACH[from]!].map(mirrorPad).sort((a, b) => a - b)).toEqual(
        [...REACH[mirrorPad(from)]!].sort((a, b) => a - b),
      );
      for (let to = 0; to < PAD_COUNT; to += 1) {
        expect(travel(from, to)).toBe(travel(mirrorPad(from), mirrorPad(to)));
        expect(nextHop(from, to)).toBe(mirrorPad(nextHop(mirrorPad(from), mirrorPad(to))));
      }
    }
  });

  it('is one connected pond, so no bug is ever unreachable', () => {
    for (let from = 0; from < PAD_COUNT; from += 1) {
      for (let to = 0; to < PAD_COUNT; to += 1) {
        expect(nextHop(from, to)).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(travel(from, to))).toBe(true);
      }
    }
  });

  it('starts the two frogs on reflected home pads', () => {
    expect(mirrorPad(P1_HOME)).toBe(P2_HOME);
    const game = fresh();
    expect(game.p1.pad).toBe(P1_HOME);
    expect(game.p2.pad).toBe(P2_HOME);
  });
});

describe('a push', () => {
  it('takes the neighbour nearest the bearing it was given', () => {
    // Pad 12 is the centre of the pond and has all eight neighbours, so every push lands.
    expect(padTowards(12, 1, 0)).toBe(13);
    expect(padTowards(12, -1, 0)).toBe(11);
    expect(padTowards(12, 0, 1)).toBe(17);
    expect(padTowards(12, 0, -1)).toBe(7);
    expect(padTowards(12, 1, 1)).toBe(18);
    expect(padTowards(12, -1, -1)).toBe(6);
  });

  it('never leaves a keyboard push tied between two pads', () => {
    // This is what the scatter buys. On a plain grid a push straight up from a corner sits
    // exactly between two diagonals, and which one it took would come down to the order the
    // neighbours happened to be listed in — an order that a reflection reverses, so it would
    // be a seat bias hiding in a tie-break.
    let closest = 1;
    for (let pad = 0; pad < PAD_COUNT; pad += 1) {
      for (const [pushX, pushY] of PUSHES) {
        const length = Math.hypot(pushX, pushY);
        const cosines = REACH[pad]!.map((near) => {
          const offsetX = PAD_X[near]! - PAD_X[pad]!;
          const offsetY = PAD_Y[near]! - PAD_Y[pad]!;
          const to = Math.hypot(offsetX, offsetY);
          return (offsetX * pushX + offsetY * pushY) / (to * length);
        }).sort((a, b) => b - a);
        closest = Math.min(closest, cosines[0]! - cosines[1]!);
      }
    }
    expect(closest).toBeGreaterThan(1e-3);
  });

  it('leaves a frog sitting when it is pushed off the edge of the pond', () => {
    // Pad 0 is the far corner; there is nothing up and to the left of it.
    expect(padTowards(0, -1, -1)).toBe(-1);
    const game = fresh();
    // P1 starts in the bottom-left corner: pushing down and left is pushing into the bank.
    expect(hopFrog(game, 'p1', -1, 1)).toBe(false);
    expect(game.p1.pad).toBe(P1_HOME);
  });

  it('is ignored in mid-air and during the rest that follows a landing', () => {
    const game = fresh();
    expect(hopFrog(game, 'p1', 1, 0)).toBe(true);
    const target = game.p1.pad;
    expect(hopFrog(game, 'p1', 0, -1)).toBe(false);
    expect(game.p1.pad).toBe(target);

    const rng = new Rng(4);
    while (game.p1.flight > 0) step(game, STEP, rng);
    expect(game.p1.rest).toBeGreaterThan(0);
    expect(hopFrog(game, 'p1', 0, -1)).toBe(false);
  });

  it('costs longer in the air the further it goes, identically for both seats', () => {
    const short = hopSeconds(12, 13);
    const long = hopSeconds(12, 18);
    expect(short).toBeGreaterThan(HOP_MIN_SECONDS);
    expect(long).toBeGreaterThan(short);
    // A hop and its reflection are the same hop, so no seat is quicker across the pond.
    for (let from = 0; from < PAD_COUNT; from += 1) {
      for (const to of REACH[from]!) {
        expect(hopSeconds(from, to)).toBe(hopSeconds(mirrorPad(from), mirrorPad(to)));
      }
    }
  });
});

describe('catching a bug', () => {
  it('scores on landing, one for a fly and five for a dragonfly', () => {
    const rng = new Rng(11);
    for (const points of [FLY_POINTS, DRAGONFLY_POINTS]) {
      const game = fresh();
      const target = padTowards(game.p1.pad, 1, 0);
      placeBug(game, target, points);
      hopFrog(game, 'p1', 1, 0);
      while (game.p1.flight > 0) step(game, STEP, rng);
      expect(game.p1.score).toBe(points);
      expect(bugOn(game, target)).toBeNull();
    }
  });

  it('gives it to whoever landed first inside the step, not to whoever is read first', () => {
    const game = fresh();
    const pad = 12;
    placeBug(game, pad, FLY_POINTS);
    // Both frogs dropped onto the same pad, p2 a hair earlier: its timer is nearer zero, so
    // it goes past zero further inside the step.
    for (const seat of SEATS) {
      const frog = frogOf(game, seat);
      frog.from = frog.pad;
      frog.pad = pad;
      frog.flightTotal = 0.2;
    }
    game.p1.flight = 0.01;
    game.p2.flight = 0.002;
    step(game, STEP, new Rng(3));
    expect(game.p2.score).toBe(FLY_POINTS);
    expect(game.p1.score).toBe(0);
  });

  it('is shared when the two landings cannot be told apart', () => {
    const game = fresh();
    const pad = 12;
    placeBug(game, pad, DRAGONFLY_POINTS);
    for (const seat of SEATS) {
      const frog = frogOf(game, seat);
      frog.from = frog.pad;
      frog.pad = pad;
      frog.flightTotal = 0.2;
      frog.flight = 0.005;
    }
    step(game, STEP, new Rng(3));
    // A fixed step cannot separate two landings that happened at the same instant, and
    // inventing an order for them would be a lie told every time it happened.
    expect(game.p1.score).toBe(DRAGONFLY_POINTS);
    expect(game.p2.score).toBe(DRAGONFLY_POINTS);
    expect(bugOn(game, pad)).toBeNull();
  });

  it('does not catch a bug that was already leaving', () => {
    const game = fresh();
    const pad = padTowards(game.p1.pad, 1, 0);
    placeBug(game, pad, FLY_POINTS);
    game.bugs[0]!.life = STEP / 2;
    game.p1.from = game.p1.pad;
    game.p1.pad = pad;
    game.p1.flightTotal = 0.2;
    game.p1.flight = 0.005;
    step(game, STEP, new Rng(3));
    expect(game.p1.score).toBe(0);
  });
});

describe('serving a bug', () => {
  it('never puts one under a frog or on top of another bug', () => {
    const game = fresh();
    placeBug(game, 12, FLY_POINTS);
    const pads = candidatePads(game);
    expect(pads).not.toContain(12);
    expect(pads).not.toContain(game.p1.pad);
    expect(pads).not.toContain(game.p2.pad);
    expect(pads.length).toBe(PAD_COUNT - 3);
  });

  it('offers a set of pads that reflects onto itself', () => {
    // This is the whole seat-fairness argument in one line: the draw is uniform, so a
    // candidate set closed under reflection means the two seats face the same distribution.
    const game = fresh();
    placeBug(game, 12, FLY_POINTS);
    const pads = new Set(candidatePads(game));
    for (const pad of pads) expect(pads.has(mirrorPad(pad))).toBe(true);
  });

  it('makes every fifth bug a dragonfly, as a cadence rather than a dice roll', () => {
    const game = fresh();
    const rng = new Rng(77);
    const kinds: number[] = [];
    let served = 0;
    for (let i = 0; i < 60 * 240 && served < DRAGONFLY_EVERY * 2; i += 1) {
      step(game, STEP, rng);
      if (game.served === served) continue;
      served = game.served;
      const bug = game.bugs.find((candidate) => candidate.active && candidate.life > 6)!;
      kinds.push(bug.points);
      // Nothing is ever eaten here, so the pond fills; clear it to keep the bugs coming.
      for (const each of game.bugs) if (each.life < 6) each.active = false;
    }
    for (let i = 0; i < kinds.length; i += 1) {
      const dragonfly = (i + 1) % DRAGONFLY_EVERY === 0;
      expect(kinds[i], `bug ${String(i + 1)}`).toBe(dragonfly ? DRAGONFLY_POINTS : FLY_POINTS);
    }
  });

  it('drops a dragonfly where the two frogs are most nearly level', () => {
    const game = fresh();
    const rng = new Rng(90210);
    // Pull the frogs somewhere lopsided first, so "level" is a real constraint rather than
    // something the starting position would have given for free.
    game.p1.pad = 6;
    game.p1.from = 6;
    game.p2.pad = 8;
    game.p2.from = 8;
    let dragonflies = 0;
    for (let i = 0; i < 60 * 300 && dragonflies < 3; i += 1) {
      const before = game.served;
      step(game, STEP, rng);
      for (const bug of game.bugs) {
        if (!bug.active || game.served === before || bug.points !== DRAGONFLY_POINTS) continue;
        if (bug.life < 6) continue;
        dragonflies += 1;
        const gap = Math.abs(arrivalSeconds(game.p1, bug.pad) - arrivalSeconds(game.p2, bug.pad));
        let fairest = Number.POSITIVE_INFINITY;
        for (const pad of candidatePads(game)) {
          if (pad === bug.pad) continue;
          const other = Math.abs(arrivalSeconds(game.p1, pad) - arrivalSeconds(game.p2, pad));
          fairest = Math.min(fairest, other);
        }
        expect(gap).toBeLessThanOrEqual(fairest + TIE_SECONDS);
      }
      for (const bug of game.bugs) if (bug.life < 6) bug.active = false;
    }
    expect(dragonflies).toBe(3);
  });
});

describe('the match', () => {
  it('ends the moment somebody reaches ten', () => {
    const game = fresh();
    game.p1.score = TARGET_POINTS - DRAGONFLY_POINTS;
    const pad = padTowards(game.p1.pad, 1, 0);
    placeBug(game, pad, DRAGONFLY_POINTS);
    hopFrog(game, 'p1', 1, 0);
    const rng = new Rng(5);
    for (let i = 0; i < 120 && winnerOf(game) === null; i += 1) step(game, STEP, rng);
    expect(game.p1.score).toBeGreaterThanOrEqual(TARGET_POINTS);
    expect(winnerOf(game)).toBe('p1');
  });

  it('ends when the pond runs out of bugs, however badly it is played', () => {
    // Structural, not a clock. `served` only ever rises, the interval between servings is a
    // fixed positive number and every bug leaves after a fixed life, so the budget is spent
    // in bounded simulated time whatever the two players do — including nothing at all.
    const game = fresh();
    const rng = new Rng(808);
    let steps = 0;
    for (; steps < 60 * 600 && winnerOf(game) === null; steps += 1) step(game, STEP, rng);
    expect(winnerOf(game)).toBe('draw');
    expect(game.served).toBe(BUG_BUDGET);
    expect(game.p1.score).toBe(0);
    expect(game.p2.score).toBe(0);
    expect(steps).toBeLessThan(60 * 400);
  });

  it('calls level scores a draw rather than picking a seat', () => {
    const game = fresh();
    game.p1.score = TARGET_POINTS;
    game.p2.score = TARGET_POINTS;
    step(game, STEP, new Rng(1));
    expect(winnerOf(game)).toBe('draw');
  });
});

describe('the bot', () => {
  it('draws exactly the same number of values whatever it decides', () => {
    // Fruit Duel's rule. A seat whose draw count depends on what it chose shifts the other
    // seat's stream, and that is a seat bias made of arithmetic.
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = fresh();
      const rng = new CountingRng(31);
      const state = createBotState();
      const push = { x: 0, y: 0 };
      let decisions = 0;
      for (let i = 0; i < 60 * 20; i += 1) {
        const before = rng.draws;
        botIntent(game, 'p1', tier, state, STEP, rng, push);
        const drawn = rng.draws - before;
        if (drawn > 0) {
          decisions += 1;
          expect(drawn, `${tier} decision ${String(decisions)}`).toBe(BOT_DRAWS_PER_DECISION);
        }
        hopFrog(game, 'p1', push.x, push.y);
        step(game, STEP, new Rng(i + 1));
      }
      expect(decisions).toBeGreaterThan(10);
    }
  });

  it('gets no hop a person does not get', () => {
    // Every tier's only output is a push, and every push goes through `padTowards`, so no
    // tier can reach a pad a thumb cannot reach or leave a pad sooner than the rest allows.
    const tiers = Object.values(BOT_PROFILES);
    for (const profile of tiers) {
      expect(profile.reaction).toBeGreaterThanOrEqual(0);
      expect(profile.blunder).toBeGreaterThanOrEqual(0);
      expect(profile.rival).toBeLessThanOrEqual(1);
    }
    // The quickest tier is still held by the rest every frog owes after a landing, which is
    // exactly what a person holding a direction is held by.
    expect(BOT_PROFILES.hard.reaction).toBeLessThan(REST_SECONDS);
  });

  it('leaves neither seat better placed, over ninety seeded matches', () => {
    /*
     * The measurement behind the reflection argument.
     *
     * A theorem is what says this *must* be 50%: relabelling the two players and reflecting
     * the pond maps a match onto an equally likely match with the seats exchanged, because
     * the pads reflect exactly, the two homes are reflections, and the set a bug is drawn
     * from reflects onto itself. This is the check that the code kept the promise the
     * layout makes — at 500 matches a tier it lands on 49%, 46% and 50%; the band here is
     * wide enough that a run of luck cannot fail it and narrow enough that a real bias
     * cannot pass it.
     */
    let p1Wins = 0;
    let decided = 0;
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      let seatWins = 0;
      for (let seed = 0; seed < 30; seed += 1) {
        const winner = winnerOf(playBots(2000 + seed * 271, { p1: tier, p2: tier }));
        if (winner === 'draw' || winner === null) continue;
        decided += 1;
        if (winner === 'p1') {
          p1Wins += 1;
          seatWins += 1;
        }
      }
      expect(seatWins, `${tier} never won from one of the seats`).toBeGreaterThan(4);
      expect(seatWins, `${tier} never lost from one of the seats`).toBeLessThan(26);
    }
    expect(decided).toBeGreaterThan(80);
    expect(p1Wins / decided).toBeGreaterThan(0.35);
    expect(p1Wins / decided).toBeLessThan(0.65);
  });

  it('is ordered: each tier beats the one below it from either seat', () => {
    const pairs: readonly (readonly [BotDifficulty, BotDifficulty])[] = [
      ['hard', 'easy'],
      ['normal', 'easy'],
      ['hard', 'normal'],
    ];
    for (const [strong, weak] of pairs) {
      let strongWins = 0;
      for (let seed = 0; seed < 8; seed += 1) {
        const asP1 = playBots(600 + seed * 131, { p1: strong, p2: weak });
        if (winnerOf(asP1) === 'p1') strongWins += 1;
        const asP2 = playBots(600 + seed * 131, { p1: weak, p2: strong });
        if (winnerOf(asP2) === 'p2') strongWins += 1;
      }
      expect(strongWins, `${strong} against ${weak}`).toBeGreaterThanOrEqual(12);
    }
  });
});
