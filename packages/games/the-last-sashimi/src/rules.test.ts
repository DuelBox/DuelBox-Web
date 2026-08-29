import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import { manifest } from './manifest.js';
import {
  BLUNDER_SCALE,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOT_DRAWS_PER_TURN,
  BOT_PROFILES,
  CHOPSTICK_REACH,
  CLEAN_SHARE,
  DISH_SECONDS,
  EMPTY_LAPS,
  EMPTY_SECONDS,
  HALF_SLOTS,
  LAP_SECONDS,
  MAX_BITES_PER_TURN,
  MAX_ROUNDS,
  MISTAKE_POINTS,
  ONIGIRI_CHEW,
  ONIGIRI_HALF,
  ONIGIRI_PER_HALF,
  ONIGIRI_POINTS,
  READY_SECONDS,
  ROUNDS_PER_COURSE,
  SASHIMI_CHEW,
  SASHIMI_HALF,
  SASHIMI_POINTS,
  SETTLE_SECONDS,
  SLOT_COUNT,
  TARGET_POINTS,
  TURN_PERIOD_SECONDS,
  TURN_SECONDS,
  beltAt,
  bite,
  chooseQuarry,
  chewOf,
  cleanBy,
  createBotRngs,
  createBotState,
  createGame,
  driveBot,
  expectedPointsOf,
  fumblesBy,
  grabSlotOf,
  halfOf,
  isPresentAt,
  landChance,
  leadOf,
  nextArrival,
  offsetSeconds,
  offsetSecondsAt,
  pointsBy,
  pointsOf,
  reachOf,
  resetBotState,
  resetGame,
  slotLeadOf,
  slotUnderChopsticks,
  step,
  takenBy,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Dish, Game, Slot } from './rules.js';

const STEP = 1 / 60;
/** The shell's seat flip, from `SeatFlip`'s own default. */
const FLIP_SECONDS = 0.36;
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

function fresh(seed = 20260829, opener: SeatId = 'p1'): Game {
  const game = createGame();
  resetGame(game, opener, new Rng(seed));
  return game;
}

/** Step until the chopsticks are live, so a press means something. */
function toLive(game: Game): void {
  while (game.phase === 'ready') step(game, STEP);
}

function stepFor(game: Game, seconds: number): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i += 1) step(game, STEP);
}

/**
 * Step until both seats have taken `turns` turns, or the match ends.
 *
 * Counting turns rather than seconds, because a turn takes a step or two more than its nominal
 * length: a countdown of 0.5 s against a step of 1/60 does not land exactly on zero.
 */
function advanceTurns(game: Game, turns: number): void {
  const target = game.p1Turns + game.p2Turns + turns;
  let guard = 0;
  // Past the settle as well, so the hand-over that follows the last turn has happened.
  while (
    game.winner === null &&
    (game.p1Turns + game.p2Turns < target || game.phase === 'settling')
  ) {
    step(game, STEP);
    guard += 1;
    if (guard > 60 * 600) throw new Error('a turn never ended');
  }
}

interface Seats {
  readonly state: Record<SeatId, BotState>;
  readonly rng: { p1: Rng; p2: Rng };
  readonly tier: Record<SeatId, BotDifficulty>;
}

function seatsFor(seed: number, p1: BotDifficulty, p2: BotDifficulty): Seats {
  return {
    state: { p1: createBotState(), p2: createBotState() },
    rng: createBotRngs(new Rng(seed)),
    tier: { p1, p2 },
  };
}

/** One bot-vs-bot match, with no frame ceiling: a game that cannot end hangs the suite. */
function playOut(game: Game, seats: Seats, order: readonly SeatId[] = ['p1', 'p2']): number {
  let steps = 0;
  while (game.winner === null) {
    for (const seat of order) {
      driveBot(game, seat, seats.tier[seat], seats.state[seat], seats.rng[seat], STEP);
    }
    step(game, STEP);
    steps += 1;
  }
  return steps;
}

function match(seed: number, opener: SeatId, p1: BotDifficulty, p2: BotDifficulty): Game {
  const game = fresh(seed, opener);
  playOut(game, seatsFor(seed ^ 0x5bf03635, p1, p2));
  return game;
}

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(BOARD_WIDTH);
    expect(manifest.logical.height).toBe(BOARD_HEIGHT);
  });

  it('is a turn game on a shared board', () => {
    expect(manifest.archetype).toBe('turn-aim');
    expect(manifest.zoneSplit).toBe('shared-board');
  });

  it('advertises a round long enough to hold a match', () => {
    // Two bots take 34 s at `hard` and 66 s at `easy`; the number a card prints has to be on
    // the right side of that.
    expect(manifest.roundSeconds).toBeGreaterThan(60);
  });

  it('describes both instruments as the same single press', () => {
    // Rule 10. There is no gauge in this game at all, so there is nothing a thumb could do
    // that a key could not — but the manifest is where that promise is kept.
    expect(manifest.controls.keyboard).toMatch(/press/i);
    expect(manifest.controls.pointer).toMatch(/tap/i);
    expect(manifest.controls.pointer).not.toMatch(/drag|swipe|flick|hold/i);
    expect(manifest.controls.keyboard).not.toMatch(/drag|swipe|flick|hold/i);
    expect(manifest.sameInputClassOnly).toBe(false);
  });
});

describe('the belt', () => {
  it('lays a menu that is its own mirror about the half lap', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const game = fresh(seed);
      for (let i = 0; i < HALF_SLOTS; i += 1) {
        expect((game.slots[i] as Slot).kind).toBe((game.slots[i + HALF_SLOTS] as Slot).kind);
      }
      const onigiri = game.slots.filter((s) => s.kind === 'onigiri').length;
      expect(onigiri).toBe(ONIGIRI_PER_HALF * 2);
    }
  });

  it('puts the two seats on the identical belt, bit for bit, at every clock', () => {
    // The property the whole fairness argument rests on. `toBe`, not `toBeCloseTo`: a mirror
    // that only holds to a tolerance is a mirror that can straddle a comparison, which is the
    // defect that cost Snowball Throw 14 points of seat balance.
    const game = fresh(4242);
    const rng = new Rng(1);
    for (let sample = 0; sample < 400; sample += 1) {
      game.clock = rng.float() * 120;
      for (let i = 0; i < SLOT_COUNT; i += 1) {
        const partner = (i + HALF_SLOTS) % SLOT_COUNT;
        expect(offsetSeconds(game, i, 'p1')).toBe(offsetSeconds(game, partner, 'p2'));
        expect((game.slots[i] as Slot).kind).toBe((game.slots[partner] as Slot).kind);
      }
    }
  });

  it('reduces a slot lead to a whole number before the clock is anywhere near it', () => {
    // The one line that makes the line above exact. Without the reduction the two seats hand
    // `wrapSlots` summands that differ by fourteen and round differently.
    for (let i = 0; i < SLOT_COUNT; i += 1) {
      const partner = (i + HALF_SLOTS) % SLOT_COUNT;
      expect(slotLeadOf(i, 'p1')).toBe(slotLeadOf(partner, 'p2'));
      expect(Number.isInteger(slotLeadOf(i, 'p2'))).toBe(true);
      expect(slotLeadOf(i, 'p2')).toBeGreaterThanOrEqual(0);
      expect(slotLeadOf(i, 'p2')).toBeLessThan(SLOT_COUNT);
    }
    expect(grabSlotOf('p1')).toBe(0);
    expect(grabSlotOf('p2')).toBe(HALF_SLOTS);
  });

  it('is a function of the clock and nothing else', () => {
    // Nothing about a plate's position accumulates, so a plate asked about a moment answers the
    // same however much play happened in between. That is what lets the bot solve for an
    // arrival and get the answer the referee will get (issue #2465).
    const game = fresh(77);
    const before: number[] = [];
    for (let i = 0; i < SLOT_COUNT; i += 1) before.push(offsetSecondsAt(game, i, 'p1', 3.25));
    const seats = seatsFor(9, 'hard', 'hard');
    for (let s = 0; s < 60 * 20; s += 1) {
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        driveBot(game, seat, seats.tier[seat], seats.state[seat], seats.rng[seat], STEP);
      }
      step(game, STEP);
    }
    for (let i = 0; i < SLOT_COUNT; i += 1) {
      expect(offsetSecondsAt(game, i, 'p1', 3.25)).toBe(before[i]);
    }
  });

  it('never lets one press be inside two plates at once', () => {
    // Plates are DISH_SECONDS apart and the widest window is narrower than that gap, so at most
    // one plate can be in reach and no ambiguity is possible.
    const widest = Math.max(reachOf('sashimi'), reachOf('onigiri'));
    expect(widest * 2).toBeLessThan(DISH_SECONDS);
  });

  it('opens on a different belt for a different seed, and the same one for the same seed', () => {
    const a = fresh(1);
    const b = fresh(1);
    const c = fresh(2);
    expect(a.beltPhase).toBe(b.beltPhase);
    expect(a.slots.map((s) => s.kind)).toEqual(b.slots.map((s) => s.kind));
    expect(a.beltPhase === c.beltPhase && a.slots[0]?.kind === c.slots[0]?.kind).toBe(false);
  });

  it('starts level, frozen, with the seat the shell nominated', () => {
    for (const opener of ['p1', 'p2'] as SeatId[]) {
      const game = fresh(5, opener);
      expect(game.active).toBe(opener);
      expect(game.phase).toBe('ready');
      expect(game.p1Points).toBe(0);
      expect(game.p2Points).toBe(0);
      expect(game.round).toBe(1);
      expect(winnerOf(game)).toBeNull();
    }
  });
});

describe('solving for an arrival', () => {
  it('is the exact inverse of the reach test', () => {
    // Analytic and numeric are the *same* arithmetic here, not two roads to nearly the same
    // answer. Five games in this repo were wrong about that (commit b4af006) and one had hidden
    // the failure inside a 1% test tolerance.
    for (let seed = 0; seed < 40; seed += 1) {
      const game = fresh(seed);
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        for (let i = 0; i < SLOT_COUNT; i += 1) {
          const at = nextArrival(game, i, seat, seed * 0.37);
          expect(Math.abs(offsetSecondsAt(game, i, seat, at))).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('returns the next such moment and never an earlier one', () => {
    const game = fresh(11);
    const rng = new Rng(3);
    for (let sample = 0; sample < 300; sample += 1) {
      const after = rng.float() * 60;
      const index = rng.int(0, SLOT_COUNT);
      const at = nextArrival(game, index, 'p2', after);
      expect(at).toBeGreaterThanOrEqual(after);
      expect(at - after).toBeLessThanOrEqual(LAP_SECONDS + 1e-9);
      // Nothing between `after` and `at` is dead centre.
      expect(Math.abs(offsetSecondsAt(game, index, 'p2', at - LAP_SECONDS / 2))).toBeGreaterThan(
        0.1,
      );
    }
  });

  it('gives the two seats the identical answer for mirrored slots', () => {
    const game = fresh(19);
    for (let i = 0; i < SLOT_COUNT; i += 1) {
      const partner = (i + HALF_SLOTS) % SLOT_COUNT;
      for (const after of [0, 1.7, 9.3, 40.5]) {
        expect(nextArrival(game, i, 'p1', after)).toBe(nextArrival(game, partner, 'p2', after));
      }
    }
  });
});

describe('the ready freeze', () => {
  it("outlasts the shell's seat flip, which is why it is in the rules at all", () => {
    expect(READY_SECONDS).toBeGreaterThan(FLIP_SECONDS);
  });

  it('is worth a whole plate, which is what makes it load-bearing here', () => {
    // A bite is instantaneous, so unearned belt converts straight into free plates. Over the
    // 0.36 s the board takes to turn, the fraction of belt inside somebody's reach is what a
    // bot would have been handed and a person would not.
    const inReach =
      ((HALF_SLOTS - ONIGIRI_PER_HALF) * reachOf('sashimi') * 2 +
        ONIGIRI_PER_HALF * reachOf('onigiri') * 2) /
      (HALF_SLOTS * DISH_SECONDS);
    expect(inReach).toBeGreaterThan(0.35);
    // More than a tenth of a second of free grabbing every single turn.
    expect(FLIP_SECONDS * inReach).toBeGreaterThan(0.1);
  });

  it('refuses a press until it lifts', () => {
    const game = fresh();
    stepFor(game, READY_SECONDS - 0.05);
    expect(game.phase).toBe('ready');
    expect(bite(game, 'p1')).toBe(false);
    expect(game.p1Points).toBe(0);
    toLive(game);
    expect(game.phase).toBe('live');
    expect(bite(game, 'p1')).toBe(true);
  });

  it('lets the belt run through it, because the belt belongs to the restaurant', () => {
    const game = fresh();
    const before = beltAt(game);
    stepFor(game, 0.3);
    expect(beltAt(game)).toBeGreaterThan(before);
  });
});

describe('one press', () => {
  /**
   * A game past the freeze with a turn long enough to reach any plate on the belt.
   *
   * These tests are about what a press does, not about the turn clock, and a plate can be up to
   * a whole lap away — four times a real turn.
   */
  function open(seed = 3): Game {
    const game = fresh(seed);
    toLive(game);
    game.turnLeft = LAP_SECONDS * 3;
    return game;
  }

  /** Advance to the moment `index` is dead centre for `seat`, and press. */
  function biteAt(game: Game, index: number, seat: SeatId, offset = 0): boolean {
    const at = nextArrival(game, index, seat, game.clock) + offset;
    while (game.clock < at - STEP / 2) step(game, STEP);
    return bite(game, seat);
  }

  it('takes the plate under the chopsticks and scores what it is worth', () => {
    const game = open();
    const index = game.slots.findIndex((s) => s.kind === 'onigiri');
    expect(biteAt(game, index, 'p1')).toBe(true);
    expect(game.p1Points).toBe(ONIGIRI_POINTS);
    expect(game.lastOutcome).toBe('clean');
    expect(game.lastSlot).toBe(index);
    expect(takenBy(game, 'p1')).toBe(1);
    expect(cleanBy(game, 'p1')).toBe(1);
    expect(game.chew).toBe(ONIGIRI_CHEW);
  });

  it('counts a clean take and one nicked off the edge apart, and scores both the same', () => {
    const edge = (offset: number): Game => {
      const game = open();
      const index = game.slots.findIndex((s) => s.kind === 'sashimi');
      const at = nextArrival(game, index, 'p1', game.clock);
      while (game.clock < at + offset - STEP / 2) step(game, STEP);
      bite(game, 'p1');
      return game;
    };
    const clean = edge(0);
    const nicked = edge(reachOf('sashimi') * 0.85);
    expect(clean.lastOutcome).toBe('clean');
    expect(nicked.lastOutcome).toBe('edge');
    expect(nicked.p1Points).toBe(SASHIMI_POINTS);
    expect(cleanBy(nicked, 'p1')).toBe(0);
    expect(takenBy(nicked, 'p1')).toBe(1);
  });

  it('costs a point when the sticks close on bare belt', () => {
    const game = open();
    const index = game.slots.findIndex((s) => s.kind === 'sashimi');
    // Well past the window, and before the next plate arrives.
    expect(biteAt(game, index, 'p1', DISH_SECONDS / 2)).toBe(true);
    expect(game.lastOutcome).toBe('fumble');
    expect(game.p1Points).toBe(-MISTAKE_POINTS);
    expect(fumblesBy(game, 'p1')).toBe(1);
    expect(game.chew).toBeCloseTo(0.8, 10);
  });

  it('is refused while the chopsticks are still busy', () => {
    const game = open();
    const index = game.slots.findIndex((s) => s.kind === 'sashimi');
    expect(biteAt(game, index, 'p1')).toBe(true);
    expect(game.chew).toBe(SASHIMI_CHEW);
    expect(bite(game, 'p1')).toBe(false);
    expect(game.bites).toBe(1);
  });

  it('is refused from the seat that is not eating', () => {
    const game = open();
    expect(bite(game, 'p2')).toBe(false);
    expect(game.p2Points).toBe(0);
  });

  it('is refused once the turn has spent its presses', () => {
    const game = open();
    game.bites = MAX_BITES_PER_TURN;
    expect(bite(game, 'p1')).toBe(false);
  });

  it('takes the plate off the belt, and the chef puts it back three quarters of a lap later', () => {
    const game = open();
    const index = game.slots.findIndex((s) => s.kind === 'onigiri');
    biteAt(game, index, 'p1');
    const slot = game.slots[index] as Slot;
    const eatenAt = slot.emptyUntil - EMPTY_SECONDS;
    // Missing when it reaches the other counter half a lap later — the whole of the denial.
    expect(isPresentAt(slot, eatenAt + LAP_SECONDS / 2)).toBe(false);
    // Back by the time it returns to the seat that took it.
    expect(isPresentAt(slot, eatenAt + LAP_SECONDS)).toBe(true);
    expect(EMPTY_LAPS).toBeGreaterThan(0.5);
    expect(EMPTY_LAPS).toBeLessThan(1);
  });

  it('closes on nothing where a plate has been taken', () => {
    const game = open();
    const index = game.slots.findIndex((s) => s.kind === 'sashimi');
    const slot = game.slots[index] as Slot;
    slot.emptyUntil = game.clock + LAP_SECONDS;
    const at = nextArrival(game, index, 'p1', game.clock);
    while (game.clock < at - STEP / 2) step(game, STEP);
    expect(slotUnderChopsticks(game, 'p1')).toBe(-1);
    expect(bite(game, 'p1')).toBe(true);
    expect(game.lastOutcome).toBe('fumble');
  });
});

describe('turns and rounds', () => {
  it('end the turn when the clock runs out, with nobody pressing anything', () => {
    const game = fresh();
    stepFor(game, READY_SECONDS + TURN_SECONDS + 0.05);
    expect(game.phase).toBe('settling');
    expect(game.p1Turns).toBe(1);
    expect(game.p1Points).toBe(0);
  });

  it('pass to the other seat once the last bite has been shown', () => {
    const game = fresh();
    advanceTurns(game, 1);
    expect(game.active).toBe('p2');
    expect(game.phase).toBe('ready');
  });

  it('alternate the lead from the seat the shell nominated', () => {
    for (const opener of ['p1', 'p2'] as SeatId[]) {
      expect(leadOf(opener, 1)).toBe(opener);
      expect(leadOf(opener, 2)).not.toBe(opener);
      expect(leadOf(opener, 3)).toBe(opener);
    }
  });

  it('give both seats the same number of turns, whoever wins', () => {
    for (const tier of TIERS) {
      for (const opener of ['p1', 'p2'] as SeatId[]) {
        const game = match(500 + TIERS.indexOf(tier), opener, tier, tier);
        expect(game.p1Turns).toBe(game.p2Turns);
      }
    }
  });

  it('give both seats the same number of leads, because a match ends on a whole course', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const game = match(seed, seed % 2 === 0 ? 'p1' : 'p2', 'hard', 'easy');
      expect(game.round % ROUNDS_PER_COURSE).toBe(0);
    }
  });
});

describe('the match ending', () => {
  it('waits for the course to finish before fifteen points wins it', () => {
    const game = fresh();
    game.p1Points = TARGET_POINTS;
    // Mid-turn: nothing decided.
    stepFor(game, 0.2);
    expect(winnerOf(game)).toBeNull();
    // End of round one, which is only half a course: still nothing.
    advanceTurns(game, 2);
    expect(game.round).toBe(2);
    expect(winnerOf(game)).toBeNull();
    advanceTurns(game, 2);
    expect(winnerOf(game)).toBe('p1');
  });

  it('gives the higher score the match when the rounds run out', () => {
    const game = fresh();
    game.round = MAX_ROUNDS;
    game.p1Points = 4;
    game.p2Points = 6;
    advanceTurns(game, 2);
    expect(winnerOf(game)).toBe('p2');
  });

  it('is decided by the clean takes when the points are level', () => {
    const game = fresh();
    game.round = MAX_ROUNDS;
    game.p1Points = 5;
    game.p2Points = 5;
    game.p1Clean = 3;
    game.p2Clean = 1;
    advanceTurns(game, 2);
    expect(winnerOf(game)).toBe('p1');
  });

  it('is a draw when the points and the clean takes both tie', () => {
    const game = fresh();
    game.round = MAX_ROUNDS;
    game.p1Points = 5;
    game.p2Points = 5;
    game.p1Clean = 2;
    game.p2Clean = 2;
    advanceTurns(game, 2);
    expect(winnerOf(game)).toBe('draw');
  });

  it('always ends with nobody pressing anything at all, and no frame cap', () => {
    // No ceiling on the loop: a match that failed to terminate would hang the suite rather than
    // pass quietly.
    const game = fresh();
    let steps = 0;
    while (game.winner === null) {
      step(game, STEP);
      steps += 1;
    }
    expect(game.round).toBe(MAX_ROUNDS);
    expect(game.p1Turns).toBe(MAX_ROUNDS);
    expect(game.p2Turns).toBe(MAX_ROUNDS);
    expect(winnerOf(game)).toBe('draw');
    // Three frames a turn of slack: a countdown of 0.5 s against a step of a sixtieth does not
    // land exactly on zero, so each turn is a step or two longer than its nominal length.
    expect(steps * STEP).toBeLessThanOrEqual(MAX_ROUNDS * 2 * (TURN_PERIOD_SECONDS + 3 * STEP));
  });

  it('always ends when both seats only ever make mistakes, which is the stall the scoring invites', () => {
    // "First to fifteen" and "every mistake costs a point" together have a shape nothing else in
    // this catalogue has: two players who keep missing walk *backwards*, so the target recedes
    // and no amount of play brings it closer. Both seats here press only when the belt is bare,
    // which is the worst case exactly. The round cap fed to the helper as `timeExpired` is what
    // closes it. No frame cap: a match that could not end would hang the suite.
    const game = fresh(8);
    game.p1Points = TARGET_POINTS - 1;
    game.p2Points = TARGET_POINTS - 1;
    while (game.winner === null) {
      if (game.phase === 'live' && slotUnderChopsticks(game, game.active) < 0) {
        bite(game, game.active);
      }
      step(game, STEP);
    }
    expect(game.round).toBe(MAX_ROUNDS);
    expect(winnerOf(game)).not.toBeNull();
    expect(Math.max(game.p1Points, game.p2Points)).toBeLessThan(TARGET_POINTS);
    expect(game.p1Fumbles).toBeGreaterThan(10);
    expect(game.p2Fumbles).toBeGreaterThan(10);
  });

  it('lets a player who only mashes reach a decision too, badly', () => {
    // Mashing is measured at -0.14 points a turn against a `normal` bot and wins 6.5% of 600
    // matches. Against another masher it is bimodal — a fixed cadence can fall into step with
    // the belt, which is the same commensurability the turn period had to be kept clear of —
    // and one of the two always ends up on the good side of it, so this pairing decides quickly
    // rather than running to the cap.
    const game = fresh(8);
    while (game.winner === null) {
      bite(game, game.active);
      step(game, STEP);
    }
    expect(winnerOf(game)).not.toBeNull();
    expect(Math.min(game.p1Points, game.p2Points)).toBeLessThan(0);
  });

  it('stops simulating once it is decided', () => {
    const game = match(21, 'p1', 'hard', 'hard');
    const snapshot = JSON.stringify(game);
    stepFor(game, 5);
    expect(JSON.stringify(game)).toBe(snapshot);
  });
});

describe('mashing loses, which is what the plate sizes are set for', () => {
  it('is worth less than nothing to press at a moment nobody chose', () => {
    // The expected value of a uniformly random press: the belt is in reach less than half the
    // time, and a mistake costs a point. Widen the plates by a fifth and this turns positive
    // and the game becomes a button-masher.
    const sashimi =
      ((HALF_SLOTS - ONIGIRI_PER_HALF) * reachOf('sashimi') * 2) / (HALF_SLOTS * DISH_SECONDS);
    const onigiri = (ONIGIRI_PER_HALF * reachOf('onigiri') * 2) / (HALF_SLOTS * DISH_SECONDS);
    const nothing = 1 - sashimi - onigiri;
    const value = sashimi * SASHIMI_POINTS + onigiri * ONIGIRI_POINTS - nothing * MISTAKE_POINTS;
    expect(value).toBeLessThan(0);
  });

  it('loses a match to a seat that waits, from either side', () => {
    for (const masher of ['p1', 'p2'] as SeatId[]) {
      const other: SeatId = masher === 'p1' ? 'p2' : 'p1';
      const game = fresh(31);
      const seats = seatsFor(64, 'normal', 'normal');
      while (game.winner === null) {
        if (game.active === masher) bite(game, masher);
        else driveBot(game, other, 'normal', seats.state[other], seats.rng[other], STEP);
        step(game, STEP);
      }
      expect(winnerOf(game)).toBe(other);
      expect(pointsBy(game, masher)).toBeLessThan(pointsBy(game, other));
    }
  });
});

describe('the tolerances the ladder is built on', () => {
  it('are the plate plus the reach of the sticks, in seconds', () => {
    expect(reachOf('sashimi')).toBeCloseTo(SASHIMI_HALF + CHOPSTICK_REACH, 12);
    expect(reachOf('onigiri')).toBeCloseTo(ONIGIRI_HALF + CHOPSTICK_REACH, 12);
    expect(reachOf('onigiri')).toBeLessThan(reachOf('sashimi'));
    expect(pointsOf('onigiri')).toBe(ONIGIRI_POINTS);
    expect(pointsOf('sashimi')).toBe(SASHIMI_POINTS);
    expect(chewOf('onigiri')).toBe(ONIGIRI_CHEW);
    expect(chewOf('sashimi')).toBe(SASHIMI_CHEW);
    expect(halfOf('onigiri')).toBe(ONIGIRI_HALF);
  });

  it('leave both windows a grid finer than the plate they have to be stopped on', () => {
    // A press only lands on a whole frame. Cup Pong's first version ran a needle whose grid was
    // coarser than its cup, and two neighbouring mouth radii gave the identical hit rate to
    // three figures. Eight frames is the floor.
    for (const kind of ['sashimi', 'onigiri'] as Dish[]) {
      expect(reachOf(kind) * 2 * 60).toBeGreaterThanOrEqual(8);
    }
  });

  it('cost a rice ball more than half its turn to chew', () => {
    // The axis this game owns: a rice ball is not merely harder to catch, it is most of the turn.
    expect(ONIGIRI_CHEW / TURN_SECONDS).toBeGreaterThan(0.5);
    expect(SASHIMI_CHEW).toBeLessThan(ONIGIRI_CHEW);
  });

  it('keep the turn out of step with the belt, which is worth five points of fairness', () => {
    // A turn takes TURN_PERIOD_SECONDS and the belt comes round in LAP_SECONDS. Let the second
    // divide the first and the two seats meet the same phases of the belt for ever, and on a
    // shared belt that is a standing advantage to whoever meets them first: swept at `hard`,
    // the opener takes 54.9% of decided matches at a ratio of exactly 3 and 50.8% at the
    // shipped 2.71. The obvious tidy-up — a round 1.9 s turn — lands straight on the peak.
    const ratio = LAP_SECONDS / TURN_PERIOD_SECONDS;
    expect(Math.abs(ratio - Math.round(ratio))).toBeGreaterThan(0.25);
    expect(Math.abs(ratio * 2 - Math.round(ratio * 2))).toBeGreaterThan(0.25);
  });

  it('keep the match bounded whatever anybody does', () => {
    expect(MAX_ROUNDS % ROUNDS_PER_COURSE).toBe(0);
    expect(MAX_ROUNDS * 2 * TURN_PERIOD_SECONDS).toBeLessThan(600);
    // A turn cannot hold more presses than the chews allow, so the cap is insurance.
    expect(Math.ceil(TURN_SECONDS / Math.min(SASHIMI_CHEW, ONIGIRI_CHEW))).toBeLessThanOrEqual(
      MAX_BITES_PER_TURN,
    );
    expect(SETTLE_SECONDS).toBeGreaterThan(0);
  });
});

describe('the bot', () => {
  it('draws the same number of values for every turn, whatever it decides', () => {
    for (const tier of TIERS) {
      const game = fresh(12);
      const state = createBotState();
      let draws = 0;
      const rng = new Rng(5);
      const counting = new Proxy(rng, {
        get(target, property, receiver: unknown) {
          if (property === 'float') {
            return (): number => {
              draws += 1;
              return rng.float();
            };
          }
          return Reflect.get(target, property, receiver) as unknown;
        },
      });
      // Two whole turns for the same seat.
      while (game.p1Turns < 2) {
        driveBot(game, 'p1', tier, state, counting, STEP);
        step(game, STEP);
      }
      expect(draws).toBe(BOT_DRAWS_PER_TURN * 2);
    }
  });

  it('draws the same number again over a whole match, however the turns went', () => {
    const game = fresh(13);
    const state = createBotState();
    let draws = 0;
    const rng = new Rng(6);
    const counting = new Proxy(rng, {
      get(target, property, receiver: unknown) {
        if (property === 'float') {
          return (): number => {
            draws += 1;
            return rng.float();
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const other = createBotState();
    const otherRng = new Rng(7);
    while (game.winner === null) {
      driveBot(game, 'p1', 'hard', state, counting, STEP);
      driveBot(game, 'p2', 'easy', other, otherRng, STEP);
      step(game, STEP);
    }
    expect(draws).toBe(game.p1Turns * BOT_DRAWS_PER_TURN);
  });

  it('gives each seat a stream of its own, seeded from the match', () => {
    const source = new Rng(99);
    const rngs = createBotRngs(source);
    expect(rngs.p1.float()).not.toBe(rngs.p2.float());
  });

  it('values a press it is sure of at one and an impossible one at nothing', () => {
    expect(landChance(0.1, 0.2)).toBe(1);
    expect(landChance(0.2, 0)).toBe(0);
    expect(landChance(0.2, 0.1)).toBeCloseTo(0.75, 10);
    // Monotone in the tolerance, which is the only property the ranking needs.
    expect(landChance(0.2, 0.05)).toBeLessThan(landChance(0.2, 0.1));
  });

  it('prices a plate at its points times its chance, less the mistake', () => {
    for (const tier of TIERS) {
      const sashimi = expectedPointsOf('sashimi', tier);
      const onigiri = expectedPointsOf('onigiri', tier);
      expect(sashimi).toBeGreaterThan(0);
      expect(onigiri).toBeGreaterThan(0);
      // Three points beats one at every tier we ship, which is why the decision is about time
      // rather than about precision. See `chooseQuarry`.
      expect(onigiri).toBeGreaterThan(sashimi);
    }
    // A hand shaky enough would pass on a slice altogether, which is the term earning its place.
    expect(landChance(0.6, reachOf('sashimi')) * SASHIMI_POINTS).toBeLessThan(
      1 - landChance(0.6, reachOf('sashimi')),
    );
  });

  it('takes the plate that is worth most per second of turn, not the plate worth most', () => {
    // The rule that makes a slice arriving now beat a rice ball arriving in a second. Measured
    // over 400 matches a tier it lifts slices taken per turn from 0.66 to 0.96 at `easy` and
    // 1.05 to 1.38 at `hard`, and points a turn from 1.06 to 1.21 and 2.50 to 2.83.
    const game = fresh(23);
    toLive(game);
    const sashimiIndex = game.slots.findIndex((s) => s.kind === 'sashimi');
    const onigiriIndex = game.slots.findIndex((s) => s.kind === 'onigiri');
    // Park the clock so a slice is imminent and the rice ball is most of a turn away.
    game.clock = nextArrival(game, sashimiIndex, 'p1', game.clock) - 0.05;
    const end = game.clock + TURN_SECONDS;
    const onigiriWait = nextArrival(game, onigiriIndex, 'p1', game.clock) - game.clock;
    if (onigiriWait > 0.8 && onigiriWait < TURN_SECONDS) {
      expect(chooseQuarry(game, 'p1', 'hard', game.clock, end)).toBe(sashimiIndex);
    }
    // And a rice ball that is imminent beats a slice that is not.
    game.clock = nextArrival(game, onigiriIndex, 'p1', game.clock) - 0.05;
    expect(
      pointsOf(
        (
          game.slots[
            chooseQuarry(game, 'p1', 'hard', game.clock, game.clock + TURN_SECONDS)
          ] as Slot
        ).kind,
      ),
    ).toBe(ONIGIRI_POINTS);
  });

  it('takes both kinds of plate at every tier, so neither is scenery', () => {
    for (const tier of TIERS) {
      let sashimi = 0;
      let onigiri = 0;
      for (let seed = 0; seed < 24; seed += 1) {
        const game = match(seed, 'p1', tier, tier);
        const taken = game.p1Taken + game.p2Taken;
        const points = game.p1Points + game.p2Points + game.p1Fumbles + game.p2Fumbles;
        const rice = (points - taken) / 2;
        onigiri += rice;
        sashimi += taken - rice;
      }
      expect(sashimi, `${tier} never took a slice`).toBeGreaterThan(0);
      expect(onigiri, `${tier} never took a rice ball`).toBeGreaterThan(0);
    }
  });

  it('makes the identical choice from either seat on a mirrored belt', () => {
    // The per-decision half of the mirror test. Every emptied slot is mirrored too, so the two
    // seats are facing the same board and must answer the same way — exactly, not nearly.
    const game = fresh(37);
    const rng = new Rng(4);
    for (let sample = 0; sample < 400; sample += 1) {
      game.clock = rng.float() * 60;
      for (let i = 0; i < HALF_SLOTS; i += 1) {
        const until = rng.bool(0.3) ? game.clock + rng.float() * 5 : 0;
        (game.slots[i] as Slot).emptyUntil = until;
        (game.slots[i + HALF_SLOTS] as Slot).emptyUntil = until;
      }
      for (const tier of TIERS) {
        const end = game.clock + TURN_SECONDS;
        const one = chooseQuarry(game, 'p1', tier, game.clock, end);
        const two = chooseQuarry(game, 'p2', tier, game.clock, end);
        expect(two).toBe(one < 0 ? -1 : (one + HALF_SLOTS) % SLOT_COUNT);
        if (one >= 0) {
          expect(nextArrival(game, two, 'p2', game.clock)).toBe(
            nextArrival(game, one, 'p1', game.clock),
          );
        }
      }
    }
  });

  it('counts down to a moment rather than watching for a position', () => {
    // Watching for a position is the obvious way to write this and it never settles: a wanted
    // offset the belt does not land exactly on is a wait with no end. The countdown is a field,
    // and it is cleared on the press so nothing stale can fire the next one.
    const game = fresh(41);
    const state = createBotState();
    const rng = new Rng(8);
    toLive(game);
    driveBot(game, 'p1', 'hard', state, rng, STEP);
    expect(state.stage).toBe('committed');
    expect(state.quarry).toBeGreaterThanOrEqual(0);
    while (state.stage === 'committed' && game.phase === 'live') {
      driveBot(game, 'p1', 'hard', state, rng, STEP);
      step(game, STEP);
    }
    expect(state.timer).toBe(0);
    expect(state.quarry).toBe(-1);
  });

  it('starts each turn afresh, even when a fumbled countdown outran the last one', () => {
    const game = fresh(43);
    const state = createBotState();
    const rng = new Rng(9);
    while (game.p1Turns < 1) {
      driveBot(game, 'p1', 'easy', state, rng, STEP);
      step(game, STEP);
    }
    // The turn is over: whatever the bot was holding has gone.
    driveBot(game, 'p1', 'easy', state, rng, STEP);
    expect(state.drawn).toBe(false);
    expect(state.used).toBe(0);
    expect(state.stage).toBe('idle');
  });

  it('reads only what is on the belt, and how steady its own hand is', () => {
    // Rule 6, made checkable: `chooseQuarry` is a pure function of the game, the seat, the tier
    // and two clocks. Nothing about the opponent, nothing about the future, nothing hidden.
    const game = fresh(47);
    const end = game.clock + TURN_SECONDS;
    const first = chooseQuarry(game, 'p1', 'normal', game.clock, end);
    game.p2Points = 14;
    game.p2Taken = 9;
    game.round = MAX_ROUNDS - 1;
    expect(chooseQuarry(game, 'p1', 'normal', game.clock, end)).toBe(first);
  });

  it('scores more points a turn as the tier goes up', () => {
    const perTurn = (tier: BotDifficulty): number => {
      let points = 0;
      let turns = 0;
      for (let seed = 0; seed < 24; seed += 1) {
        const game = match(200 + seed, 'p1', tier, tier);
        points += game.p1Points + game.p2Points;
        turns += game.p1Turns + game.p2Turns;
      }
      return points / turns;
    };
    const easy = perTurn('easy');
    const normal = perTurn('normal');
    const hard = perTurn('hard');
    expect(normal).toBeGreaterThan(easy);
    expect(hard).toBeGreaterThan(normal);
  });

  it('is balanced against itself, from either opening seat', () => {
    for (const tier of TIERS) {
      for (const opener of ['p1', 'p2'] as SeatId[]) {
        let p1 = 0;
        let decided = 0;
        for (let seed = 0; seed < 160; seed += 1) {
          const game = match(3000 + seed, opener, tier, tier);
          if (game.winner === 'p1') p1 += 1;
          if (game.winner !== 'draw') decided += 1;
        }
        const share = p1 / decided;
        expect(share, `${tier} from ${opener}`).toBeGreaterThan(0.38);
        expect(share, `${tier} from ${opener}`).toBeLessThan(0.62);
      }
    }
  });

  it('beats a weaker tier from either seat', () => {
    for (const [strong, weak] of [
      ['hard', 'easy'],
      ['normal', 'easy'],
      ['hard', 'normal'],
    ] as [BotDifficulty, BotDifficulty][]) {
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        let wins = 0;
        for (let seed = 0; seed < 100; seed += 1) {
          const game =
            seat === 'p1'
              ? match(4000 + seed, 'p1', strong, weak)
              : match(4000 + seed, 'p1', weak, strong);
          if (game.winner === seat) wins += 1;
        }
        expect(wins, `${strong} as ${seat} v ${weak}`).toBeGreaterThan(60);
      }
    }
  });

  it('plays the bit-identical match whichever seat is polled first', () => {
    for (const tier of TIERS) {
      for (let seed = 0; seed < 20; seed += 1) {
        const forward = fresh(seed, 'p1');
        playOut(forward, seatsFor(seed ^ 0x5bf03635, tier, tier), ['p1', 'p2']);
        const reversed = fresh(seed, 'p1');
        playOut(reversed, seatsFor(seed ^ 0x5bf03635, tier, tier), ['p2', 'p1']);
        expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
      }
    }
  });

  it('two of the same tier do not play the identical match', () => {
    const game = match(61, 'p1', 'hard', 'hard');
    expect(game.p1Points === game.p2Points && game.p1Taken === game.p2Taken).toBe(false);
  });

  it('costs a fumble more than any plate forgives, so the rate is the knob and not the size', () => {
    // BLUNDER_SCALE saturates: swept alone at `hard` the win rate against `normal` runs 75.0%,
    // 76.7%, 77.8%, 77.6%, 77.8% at 1, 3, 6, 10 and 16, because any slip wider than the plate
    // is the same miss. Six is headroom, and `blunder` is the knob that actually moves.
    for (const tier of TIERS) {
      expect(BOT_PROFILES[tier].timing * BLUNDER_SCALE).toBeGreaterThan(reachOf('sashimi') * 3);
    }
  });

  it('has a ladder that is three real steps, in seconds a person could have', () => {
    expect(BOT_PROFILES.easy.timing).toBeGreaterThan(BOT_PROFILES.normal.timing);
    expect(BOT_PROFILES.normal.timing).toBeGreaterThan(BOT_PROFILES.hard.timing);
    expect(BOT_PROFILES.easy.blunder).toBeGreaterThan(BOT_PROFILES.hard.blunder);
    for (const tier of TIERS) {
      // Rule 6: every tier's error is several frames wide, so none of them can pick a moment
      // more finely than a person can.
      expect(BOT_PROFILES[tier].timing * 60).toBeGreaterThan(6);
    }
  });
});

describe('mirror symmetry', () => {
  /** One match, with the two seats' tiers and generators given explicitly. */
  function playMirrored(
    seed: number,
    leadSeat: SeatId,
    leadTier: BotDifficulty,
    followTier: BotDifficulty,
    leadSeed: number,
    followSeed: number,
  ): Game {
    const followSeat: SeatId = leadSeat === 'p1' ? 'p2' : 'p1';
    const game = createGame();
    resetGame(game, leadSeat, new Rng(seed));
    const state: Record<SeatId, BotState> = { p1: createBotState(), p2: createBotState() };
    const rng: Record<SeatId, Rng> = { p1: new Rng(0), p2: new Rng(0) };
    const tier: Record<SeatId, BotDifficulty> = { p1: 'easy', p2: 'easy' };
    tier[leadSeat] = leadTier;
    tier[followSeat] = followTier;
    rng[leadSeat] = new Rng(leadSeed);
    rng[followSeat] = new Rng(followSeed);
    while (game.winner === null) {
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        driveBot(game, seat, tier[seat], state[seat], rng[seat], STEP);
      }
      step(game, STEP);
    }
    return game;
  }

  it('plays the mirror-image match when the two seats swap places', () => {
    // The test the brief asks for, and the one nothing else in the repo can do: take a board,
    // mirror it, mirror the inputs, run both, and require the results to be mirror images. The
    // belt is its own mirror by construction, so mirroring the *board* is exactly swapping the
    // seats — which makes this a check on the whole simulation and not only on the geometry.
    for (let seed = 0; seed < 120; seed += 1) {
      const a = playMirrored(seed, 'p1', 'hard', 'easy', 991, 662);
      const b = playMirrored(seed, 'p2', 'hard', 'easy', 991, 662);
      expect(a.p1Points, `seed ${seed}`).toBe(b.p2Points);
      expect(a.p2Points).toBe(b.p1Points);
      expect(a.p1Taken).toBe(b.p2Taken);
      expect(a.p2Taken).toBe(b.p1Taken);
      expect(a.p1Clean).toBe(b.p2Clean);
      expect(a.p2Clean).toBe(b.p1Clean);
      expect(a.p1Fumbles).toBe(b.p2Fumbles);
      expect(a.p2Fumbles).toBe(b.p1Fumbles);
      expect(a.clock).toBe(b.clock);
      expect(a.round).toBe(b.round);
      expect(a.winner).toBe(b.winner === 'draw' ? 'draw' : b.winner === 'p1' ? 'p2' : 'p1');
    }
  });

  it('resolves a press to the same plate for both seats on a mirrored board', () => {
    const game = fresh(53);
    const rng = new Rng(2);
    for (let sample = 0; sample < 300; sample += 1) {
      game.clock = rng.float() * 60;
      for (let i = 0; i < HALF_SLOTS; i += 1) {
        const until = rng.bool(0.25) ? game.clock + rng.float() * 4 : 0;
        (game.slots[i] as Slot).emptyUntil = until;
        (game.slots[i + HALF_SLOTS] as Slot).emptyUntil = until;
      }
      const one = slotUnderChopsticks(game, 'p1');
      const two = slotUnderChopsticks(game, 'p2');
      expect(two).toBe(one < 0 ? -1 : (one + HALF_SLOTS) % SLOT_COUNT);
    }
  });
});

describe('determinism', () => {
  it('replays a fixed script to the identical final state', () => {
    const run = (): string => {
      const game = fresh(101);
      let steps = 0;
      while (game.winner === null && steps < 60 * 400) {
        if (steps % 37 === 0) bite(game, game.active);
        step(game, STEP);
        steps += 1;
      }
      return JSON.stringify(game);
    };
    expect(run()).toBe(run());
  });

  it('plays a different match from a different seed', () => {
    expect(JSON.stringify(match(1, 'p1', 'normal', 'normal'))).not.toBe(
      JSON.stringify(match(2, 'p1', 'normal', 'normal')),
    );
  });

  it('holds a state that is nothing but numbers, so it round-trips exactly', () => {
    const game = match(103, 'p1', 'hard', 'normal');
    const copy = JSON.parse(JSON.stringify(game)) as Game;
    expect(copy).toEqual(game);
  });

  it('is level again after a reset, with the new opener to eat', () => {
    const game = match(107, 'p1', 'hard', 'hard');
    resetGame(game, 'p2', new Rng(9));
    expect(game.p1Points).toBe(0);
    expect(game.p2Points).toBe(0);
    expect(game.p1Turns).toBe(0);
    expect(game.clock).toBe(0);
    expect(game.active).toBe('p2');
    expect(game.round).toBe(1);
    expect(winnerOf(game)).toBeNull();
    for (const slot of game.slots) expect(slot.emptyUntil).toBe(0);
  });

  it('clears a bot back to a turn it has not planned', () => {
    const state = createBotState();
    state.drawn = true;
    state.used = 3;
    state.quarry = 5;
    state.timer = 1.5;
    state.stage = 'committed';
    state.finished = true;
    resetBotState(state);
    expect(state).toEqual(createBotState());
  });

  it('never lets a point come from anywhere but a plate or a mistake', () => {
    for (const tier of TIERS) {
      const game = match(300 + TIERS.indexOf(tier), 'p1', tier, tier);
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        const taken = takenBy(game, seat);
        const fumbles = fumblesBy(game, seat);
        const points = pointsBy(game, seat);
        expect(points).toBeLessThanOrEqual(taken * ONIGIRI_POINTS - fumbles * MISTAKE_POINTS);
        expect(points).toBeGreaterThanOrEqual(taken * SASHIMI_POINTS - fumbles * MISTAKE_POINTS);
        expect(cleanBy(game, seat)).toBeLessThanOrEqual(taken);
      }
    }
  });

  it('keeps the clean band inside the window it is a band of', () => {
    expect(CLEAN_SHARE).toBeGreaterThan(0);
    expect(CLEAN_SHARE).toBeLessThan(1);
  });
});
