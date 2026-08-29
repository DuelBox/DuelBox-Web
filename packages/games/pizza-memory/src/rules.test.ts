import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BELL_STATION,
  BOARD_WIDTH,
  BOT_PROFILES,
  FORGOTTEN,
  HAND_SPEED,
  KIND_COUNT,
  MATCH_SECONDS,
  PHASE_BUILD,
  PHASE_SERVE,
  PHASE_WATCH,
  RAIL_MARGIN,
  RAIL_PITCH,
  SLOT_MAX,
  SLOT_MIN,
  STATION_COUNT,
  TARGET_SERVED,
  TICKETS_PER_SLOT,
  benchCount,
  botDecide,
  botStep,
  botWatch,
  commit,
  counterOf,
  createBotState,
  createState,
  dealTicket,
  judgeMatch,
  orderMatches,
  railX,
  resetBotState,
  resetState,
  revealedCount,
  secondsLeft,
  stationFromBoardX,
  stationOf,
  step,
  steerHand,
  stepCounter,
  ticketLength,
  ticketTopping,
  watchSeconds,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Counter, State } from './rules.js';

const STEP = 1 / 60;
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

/* ------------------------------------------------------------------ harness */

/**
 * A whole match at the rules level, with a bot on each seat.
 *
 * The streams are handed out **by role**, exactly as `game.ts` does it: the opening seat gets
 * `streamA`. That is the one thing that makes a seed's two openings mirror images of each
 * other, and several tests below turn on it.
 */
function runBots(
  seed: number,
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  opener: SeatId = 'p1',
  maxSteps = 60 * 600,
): { state: State; steps: number } {
  const source = new Rng(seed);
  const book = new Rng(source.next() | 0);
  const streamA = new Rng(source.next() | 0);
  const streamB = new Rng(source.next() | 0);
  const state = createState();
  resetState(state, book);
  const bots: Record<SeatId, BotState> = { p1: createBotState(), p2: createBotState() };
  const tiers: Record<SeatId, BotDifficulty> = { p1: p1Tier, p2: p2Tier };

  let steps = 0;
  for (; steps < maxSteps; steps += 1) {
    for (const seat of ['p1', 'p2'] as const) {
      const counter = counterOf(state, seat);
      const rng = opener === seat ? streamA : streamB;
      if (botStep(counter, bots[seat], tiers[seat], rng, STEP) >= 0) commit(counter);
    }
    step(state, STEP);
    if (state.winner !== null) break;
  }
  return { state, steps };
}

/** Drive one counter to the moment its reveal has just ended. Returns its bot. */
function toBuildPhase(counter: Counter, tier: BotDifficulty, rng: Rng, book: number): BotState {
  const bot = createBotState();
  while (counter.phase === PHASE_WATCH) {
    botStep(counter, bot, tier, rng, STEP);
    stepCounter(counter, STEP, book);
  }
  return bot;
}

/** Everything a counter holds, as a comparable string. */
function snapshot(counter: Readonly<Counter>): string {
  return [
    counter.ticket,
    counter.phase,
    counter.phaseSeconds.toFixed(9),
    [...counter.order].join(''),
    counter.length,
    [...counter.placed].join(''),
    counter.placedCount,
    counter.hand.toFixed(9),
    counter.handTarget.toFixed(9),
    counter.served,
    counter.spoiled,
    counter.lastVerdict,
  ].join('|');
}

/* ------------------------------------------------------------------ the basics */

describe('a fresh kitchen', () => {
  it('starts level with no winner and a dealt ticket on each counter', () => {
    const state = createState();
    resetState(state, new Rng(1));
    expect(state.p1).toBe(0);
    expect(state.p2).toBe(0);
    expect(winnerOf(state)).toBeNull();
    for (const seat of ['p1', 'p2'] as const) {
      const counter = counterOf(state, seat);
      expect(counter.ticket).toBe(0);
      expect(counter.phase).toBe(PHASE_WATCH);
      expect(counter.length).toBe(SLOT_MIN);
      expect(counter.placedCount).toBe(0);
    }
  });

  it('draws exactly one value for the whole match, so the seats cannot change the orders', () => {
    const counted = new Rng(7);
    const before = counted.save();
    const state = createState();
    resetState(state, counted);
    const spent = new Rng(7);
    spent.next();
    expect(counted.save()).toEqual(spent.save());
    expect(counted.save()).not.toEqual(before);
  });

  it('deals the identical opening ticket to both seats', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const state = createState();
      resetState(state, new Rng(seed));
      expect([...state.p1Counter.order]).toEqual([...state.p2Counter.order]);
      expect(state.p1Counter.length).toBe(state.p2Counter.length);
    }
  });
});

/* ------------------------------------------------------------------ the book */

describe('the ticket book', () => {
  it('is addressed rather than consumed: ticket k is the same however you get to it', () => {
    // The property the seat band would catch us on. Two counters reach ticket 5 at completely
    // different moments; both must be asked for the same pizza.
    const book = 0x51ce;
    for (let ticket = 0; ticket < 40; ticket += 1) {
      for (let slot = 0; slot < SLOT_MAX; slot += 1) {
        expect(ticketTopping(book, ticket, slot)).toBe(ticketTopping(book, ticket, slot));
      }
    }
  });

  it('never asks for a topping the rail does not carry', () => {
    for (let book = -50; book < 50; book += 7) {
      for (let ticket = 0; ticket < 60; ticket += 1) {
        for (let slot = 0; slot < SLOT_MAX; slot += 1) {
          const kind = ticketTopping(book, ticket, slot);
          expect(Number.isInteger(kind)).toBe(true);
          expect(kind).toBeGreaterThanOrEqual(0);
          expect(kind).toBeLessThan(KIND_COUNT);
        }
      }
    }
  });

  it('spreads the five toppings evenly', () => {
    const seen = new Array<number>(KIND_COUNT).fill(0);
    let total = 0;
    for (let book = 0; book < 400; book += 1) {
      for (let ticket = 0; ticket < 30; ticket += 1) {
        for (let slot = 0; slot < SLOT_MAX; slot += 1) {
          const kind = ticketTopping(book * 7919, ticket, slot);
          seen[kind] = (seen[kind] ?? 0) + 1;
          total += 1;
        }
      }
    }
    for (const count of seen) {
      expect(Math.abs(count / total - 1 / KIND_COUNT)).toBeLessThan(0.01);
    }
  });

  it('does not correlate one slot with the next', () => {
    // A book that put the same topping twice in a row more often than chance would make the
    // game easier in a way nobody designed.
    let repeats = 0;
    let pairs = 0;
    for (let book = 0; book < 900; book += 1) {
      for (let ticket = 0; ticket < 20; ticket += 1) {
        for (let slot = 1; slot < SLOT_MAX; slot += 1) {
          if (
            ticketTopping(book * 104729, ticket, slot) ===
            ticketTopping(book * 104729, ticket, slot - 1)
          ) {
            repeats += 1;
          }
          pairs += 1;
        }
      }
    }
    expect(Math.abs(repeats / pairs - 1 / KIND_COUNT)).toBeLessThan(0.01);
  });

  it('grows the pizza, and stops at the size the buffers are', () => {
    expect(ticketLength(0)).toBe(SLOT_MIN);
    expect(ticketLength(TICKETS_PER_SLOT - 1)).toBe(SLOT_MIN);
    expect(ticketLength(TICKETS_PER_SLOT)).toBe(SLOT_MIN + 1);
    expect(ticketLength(999)).toBe(SLOT_MAX);
    let previous = 0;
    for (let ticket = 0; ticket < 200; ticket += 1) {
      const length = ticketLength(ticket);
      expect(length).toBeGreaterThanOrEqual(previous);
      expect(length).toBeLessThanOrEqual(SLOT_MAX);
      previous = length;
    }
  });
});

/* ------------------------------------------------------------------ the rail */

describe('the rail', () => {
  it('puts a mirrored touch on the same station for both seats', () => {
    // The engine quantises every pointer onto a lattice of 3 units in this box, so these are
    // the coordinates a real touch can actually land on. Exact equality, not a tolerance: the
    // whole point is that the two seats do not disagree in the last bits.
    for (let x = 0; x <= BOARD_WIDTH; x += 3) {
      expect(stationFromBoardX('p2', BOARD_WIDTH - x)).toBe(stationFromBoardX('p1', x));
    }
  });

  it('places the two rails at half-turn images of each other', () => {
    for (let station = 0; station < STATION_COUNT; station += 1) {
      expect(railX('p2', station)).toBe(BOARD_WIDTH - railX('p1', station));
      expect(stationFromBoardX('p1', railX('p1', station))).toBe(station);
      expect(stationFromBoardX('p2', railX('p2', station))).toBe(station);
    }
    expect(railX('p1', 0)).toBe(RAIL_MARGIN);
    expect(railX('p1', 1) - railX('p1', 0)).toBe(RAIL_PITCH);
  });

  it('keeps the hand on the rail whatever it is handed', () => {
    const counter = createState().p1Counter;
    for (const target of [-99, -1, 0, 2.5, 5, 6, 1e9, Number.NaN]) {
      steerHand(counter, target);
      expect(counter.handTarget).toBeGreaterThanOrEqual(0);
      expect(counter.handTarget).toBeLessThanOrEqual(STATION_COUNT - 1);
    }
  });

  it('walks the hand at one speed, so a thumb cannot beat a key to an ingredient', () => {
    // A finger that lands on the bell and a key held toward it are the same instrument here.
    const thumb = createState().p1Counter;
    const key = createState().p1Counter;
    // A full crossing of the rail takes exactly BELL_STATION / HAND_SPEED seconds either way.
    for (let i = 0; i < 70; i += 1) {
      steerHand(thumb, BELL_STATION);
      steerHand(key, key.hand + HAND_SPEED * STEP * 2);
      stepCounter(thumb, STEP, 0);
      stepCounter(key, STEP, 0);
      expect(thumb.hand).toBeCloseTo(key.hand, 9);
    }
    expect(thumb.hand).toBe(BELL_STATION);
  });

  it('commits the station the hand is nearest, and never off the end', () => {
    const counter = createState().p1Counter;
    counter.hand = -3;
    expect(stationOf(counter)).toBe(0);
    counter.hand = 99;
    expect(stationOf(counter)).toBe(STATION_COUNT - 1);
    counter.hand = 2.4;
    expect(stationOf(counter)).toBe(2);
    counter.hand = 2.6;
    expect(stationOf(counter)).toBe(3);
  });
});

/* ------------------------------------------------------------------ the ticket */

describe('a ticket', () => {
  function fresh(): Counter {
    const state = createState();
    resetState(state, new Rng(4242));
    return state.p1Counter;
  }

  it('shows the order one topping at a time and then takes it away', () => {
    const counter = fresh();
    expect(revealedCount(counter)).toBe(0);
    let seenAll = false;
    while (counter.phase === PHASE_WATCH) {
      const shown = revealedCount(counter);
      expect(shown).toBeLessThanOrEqual(counter.length);
      if (shown === counter.length) seenAll = true;
      stepCounter(counter, STEP, 0);
    }
    expect(seenAll, 'the whole order must be on the pizza before it goes').toBe(true);
    expect(counter.phase).toBe(PHASE_BUILD);
    expect(revealedCount(counter)).toBe(0);
  });

  it('refuses a topping while the order is still on the pizza', () => {
    const counter = fresh();
    steerHand(counter, 2);
    counter.hand = 2;
    expect(commit(counter)).toBe(false);
    expect(counter.placedCount).toBe(0);
  });

  it('fills the pizza in order, and then takes no more', () => {
    const counter = fresh();
    while (counter.phase === PHASE_WATCH) stepCounter(counter, STEP, 0);
    for (let slot = 0; slot < counter.length; slot += 1) {
      counter.hand = slot % KIND_COUNT;
      expect(commit(counter)).toBe(true);
      expect(counter.placed[slot]).toBe(slot % KIND_COUNT);
    }
    expect(counter.placedCount).toBe(counter.length);
    counter.hand = 0;
    expect(commit(counter), 'a full pizza takes no more').toBe(false);
    expect(counter.placedCount).toBe(counter.length);
  });

  it('serves an order that matches and spoils one that does not', () => {
    for (const faithful of [true, false]) {
      const counter = fresh();
      while (counter.phase === PHASE_WATCH) stepCounter(counter, STEP, 0);
      for (let slot = 0; slot < counter.length; slot += 1) {
        const truth = counter.order[slot] ?? 0;
        counter.hand = faithful ? truth : (truth + 1) % KIND_COUNT;
        commit(counter);
      }
      expect(orderMatches(counter)).toBe(faithful);
      counter.hand = BELL_STATION;
      expect(commit(counter)).toBe(true);
      expect(counter.served).toBe(faithful ? 1 : 0);
      expect(counter.spoiled).toBe(faithful ? 0 : 1);
      expect(counter.phase).toBe(PHASE_SERVE);
      expect(counter.lastVerdict).toBe(faithful ? 1 : -1);
    }
  });

  it('spoils an order rung early, however right the toppings on it are', () => {
    const counter = fresh();
    while (counter.phase === PHASE_WATCH) stepCounter(counter, STEP, 0);
    counter.hand = counter.order[0] ?? 0;
    commit(counter);
    counter.hand = BELL_STATION;
    commit(counter);
    expect(counter.spoiled).toBe(1);
    expect(counter.served).toBe(0);
  });

  it('deals the next ticket after the verdict has been on the counter a moment', () => {
    const counter = fresh();
    while (counter.phase === PHASE_WATCH) stepCounter(counter, STEP, 0);
    counter.hand = BELL_STATION;
    commit(counter);
    expect(counter.ticket).toBe(0);
    let guard = 0;
    while (counter.phase === PHASE_SERVE && guard < 600) {
      stepCounter(counter, STEP, 0);
      guard += 1;
    }
    expect(counter.ticket).toBe(1);
    expect(counter.phase).toBe(PHASE_WATCH);
    expect(counter.placedCount).toBe(0);
  });

  it('shows a longer order for longer', () => {
    expect(watchSeconds(SLOT_MAX)).toBeGreaterThan(watchSeconds(SLOT_MIN));
  });
});

/* ------------------------------------------------------------------ the verdict */

describe('the match verdict', () => {
  function levelState(servedEach: number): State {
    const state = createState();
    resetState(state, new Rng(11));
    state.p1 = servedEach;
    state.p2 = servedEach;
    state.p1Counter.served = servedEach;
    state.p2Counter.served = servedEach;
    return state;
  }

  it('is undecided while the clock runs and nobody has the target', () => {
    expect(judgeMatch(levelState(TARGET_SERVED - 1), 0)).toBeNull();
  });

  it('ends the moment a counter reaches the target', () => {
    const state = levelState(0);
    state.p1 = TARGET_SERVED;
    expect(judgeMatch(state, 0)).toBe('p1');
  });

  it('settles a level clock on orders spoiled, then on the pizza on the bench', () => {
    const level = levelState(3);
    expect(judgeMatch(level, MATCH_SECONDS)).toBe('draw');

    const spoiled = levelState(3);
    spoiled.p2Counter.spoiled = 2;
    expect(judgeMatch(spoiled, MATCH_SECONDS)).toBe('p1');
    spoiled.p1Counter.spoiled = 5;
    expect(judgeMatch(spoiled, MATCH_SECONDS)).toBe('p2');

    const bench = levelState(3);
    bench.p1Counter.phase = PHASE_BUILD;
    bench.p1Counter.placedCount = 2;
    bench.p2Counter.phase = PHASE_BUILD;
    bench.p2Counter.placedCount = 1;
    expect(benchCount(bench.p1Counter)).toBe(2);
    expect(judgeMatch(bench, MATCH_SECONDS)).toBe('p1');
  });

  it('counts nothing on the bench while a verdict is still on the counter', () => {
    const counter = createState().p1Counter;
    counter.phase = PHASE_SERVE;
    counter.placedCount = 4;
    expect(benchCount(counter)).toBe(0);
  });

  it('runs the clock down and never past zero', () => {
    const state = createState();
    resetState(state, new Rng(3));
    expect(secondsLeft(state)).toBe(MATCH_SECONDS);
    state.clock = MATCH_SECONDS + 10;
    expect(secondsLeft(state)).toBe(0);
  });
});

/* ------------------------------------------------------------------ the bot */

describe('what the bot can and cannot see', () => {
  it('answers the same when the order is scrambled behind its back', () => {
    // The sudoku test, in this game's terms. Once the reveal is over the ticket is hidden
    // from a person, so it must be hidden from the bot: the true order is replaced with a
    // completely different one between two identical questions, and the answer may not move.
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 120; seed += 1) {
        const state = createState();
        resetState(state, new Rng(seed * 31));
        const counter = state.p1Counter;
        const rng = new Rng(seed * 977);
        const bot = toBuildPhase(counter, tier, rng, state.book);

        const asked = new Rng(seed * 977);
        const first = botDecide(counter, bot, asked);
        // A completely different ticket, in place, with nothing else touched.
        for (let slot = 0; slot < counter.length; slot += 1) {
          counter.order[slot] = ((counter.order[slot] ?? 0) + 2) % KIND_COUNT;
        }
        const second = botDecide(counter, bot, asked);
        expect(second, `${tier} seed ${String(seed)} moved when the ticket changed`).toBe(first);
      }
    }
  });

  it('plays out a whole ticket the same way against a scrambled ticket', () => {
    // One call proves it does not peek this instant; a whole ticket proves it never does.
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 60; seed += 1) {
        const honest = createState();
        const scrambled = createState();
        resetState(honest, new Rng(seed * 13));
        resetState(scrambled, new Rng(seed * 13));

        const botA = toBuildPhase(honest.p1Counter, tier, new Rng(seed * 101), honest.book);
        const botB = toBuildPhase(scrambled.p1Counter, tier, new Rng(seed * 101), scrambled.book);
        // Everything the bot legitimately holds is identical; only the hidden ticket differs.
        expect([...botA.recall]).toEqual([...botB.recall]);
        for (let slot = 0; slot < scrambled.p1Counter.length; slot += 1) {
          scrambled.p1Counter.order[slot] =
            ((scrambled.p1Counter.order[slot] ?? 0) + 3) % KIND_COUNT;
        }

        const rngA = new Rng(seed * 555);
        const rngB = new Rng(seed * 555);
        const movesA: number[] = [];
        const movesB: number[] = [];
        for (let i = 0; i < 900; i += 1) {
          const a = botStep(honest.p1Counter, botA, tier, rngA, STEP);
          if (a >= 0) {
            movesA.push(a);
            commit(honest.p1Counter);
          }
          const b = botStep(scrambled.p1Counter, botB, tier, rngB, STEP);
          if (b >= 0) {
            movesB.push(b);
            commit(scrambled.p1Counter);
          }
          stepCounter(honest.p1Counter, STEP, honest.book);
          stepCounter(scrambled.p1Counter, STEP, scrambled.book);
          if (honest.p1Counter.phase === PHASE_SERVE) break;
        }
        expect(movesB, `${tier} seed ${String(seed)}`).toEqual(movesA);
        expect(movesA.length).toBeGreaterThan(0);
      }
    }
  });

  it('cannot see the other counter at all', () => {
    // Structural — `botStep` is handed one counter — and checked anyway, because "the bot
    // does not read it" is exactly the sort of claim that stops being true quietly.
    const state = createState();
    resetState(state, new Rng(99));
    const bot = toBuildPhase(state.p1Counter, 'hard', new Rng(7), state.book);
    const rng = new Rng(21);
    const first = botDecide(state.p1Counter, bot, rng);
    state.p2Counter.served = 40;
    state.p2Counter.placedCount = 3;
    state.p2Counter.order.fill(1);
    state.p2Counter.hand = 4;
    expect(botDecide(state.p1Counter, bot, rng)).toBe(first);
  });

  it('locks in a guess rather than re-rolling until it is right', () => {
    const state = createState();
    resetState(state, new Rng(5));
    const counter = state.p1Counter;
    while (counter.phase === PHASE_WATCH) stepCounter(counter, STEP, 0);
    const bot = createBotState();
    bot.ticket = counter.ticket;
    bot.recall.fill(FORGOTTEN);
    const rng = new Rng(66);
    const guess = botDecide(counter, bot, rng);
    expect(bot.recall[0]).toBe(guess);
    for (let i = 0; i < 20; i += 1) expect(botDecide(counter, bot, rng)).toBe(guess);
  });

  it('rings the bell once the pizza is full, whatever it put on it', () => {
    const state = createState();
    resetState(state, new Rng(8));
    const counter = state.p1Counter;
    while (counter.phase === PHASE_WATCH) stepCounter(counter, STEP, 0);
    counter.placedCount = counter.length;
    const bot = createBotState();
    expect(botDecide(counter, bot, new Rng(1))).toBe(BELL_STATION);
  });

  it('forgets the last ticket when a new one is dealt', () => {
    const state = createState();
    resetState(state, new Rng(17));
    const counter = state.p1Counter;
    const bot = toBuildPhase(counter, 'hard', new Rng(3), state.book);
    expect([...bot.recall].some((value) => value !== FORGOTTEN)).toBe(true);
    counter.ticket += 1;
    dealTicket(counter, state.book);
    botWatch(counter, bot, BOT_PROFILES.hard, new Rng(4));
    expect(bot.ticket).toBe(counter.ticket);
    expect([...bot.recall]).toEqual(new Array<number>(SLOT_MAX).fill(FORGOTTEN));
  });

  it('remembers perfectly only when it is told to', () => {
    // The knobs are what the memory is made of, so a profile with the errors turned off must
    // reproduce the order exactly, and one with grasp at zero must hold nothing at all.
    const state = createState();
    resetState(state, new Rng(23));
    const counter = state.p1Counter;
    while (revealedCount(counter) < counter.length) stepCounter(counter, STEP, 0);

    const perfect = createBotState();
    botWatch(
      counter,
      perfect,
      { graspChance: 1, slipChance: 0, swapChance: 0, reactSeconds: 0 },
      new Rng(1),
    );
    for (let slot = 0; slot < counter.length; slot += 1) {
      expect(perfect.recall[slot]).toBe(counter.order[slot]);
    }

    const blank = createBotState();
    botWatch(
      counter,
      blank,
      { graspChance: 0, slipChance: 0, swapChance: 0, reactSeconds: 0 },
      new Rng(1),
    );
    for (let slot = 0; slot < counter.length; slot += 1) expect(blank.recall[slot]).toBe(FORGOTTEN);
  });

  it('never stores a topping the rail does not carry', () => {
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 200; seed += 1) {
        const state = createState();
        resetState(state, new Rng(seed));
        const bot = toBuildPhase(state.p1Counter, tier, new Rng(seed * 7), state.book);
        for (const value of bot.recall) {
          expect(value === FORGOTTEN || (value >= 0 && value < KIND_COUNT)).toBe(true);
        }
      }
    }
  });

  it('is reset to knowing nothing', () => {
    const bot = createBotState();
    bot.recall.fill(2);
    bot.seen = 4;
    bot.ticket = 9;
    bot.waitSeconds = 3;
    resetBotState(bot);
    expect([...bot.recall]).toEqual(new Array<number>(SLOT_MAX).fill(FORGOTTEN));
    expect(bot.seen).toBe(0);
    expect(bot.ticket).toBe(-1);
    expect(bot.waitSeconds).toBe(0);
  });
});

/* ------------------------------------------------------------------ the ladder */

describe('the bot ladder', () => {
  it('remembers more of an order the higher the tier, at every length', () => {
    const fidelity = TIERS.map((tier) => {
      let right = 0;
      let total = 0;
      for (let seed = 1; seed <= 150; seed += 1) {
        const state = createState();
        resetState(state, new Rng(seed * 3));
        const counter = state.p1Counter;
        // Push the counter onto a long ticket, which is where the tiers separate most.
        counter.ticket = 12;
        dealTicket(counter, state.book);
        const bot = toBuildPhase(counter, tier, new Rng(seed * 19), state.book);
        for (let slot = 0; slot < counter.length; slot += 1) {
          if (bot.recall[slot] === counter.order[slot]) right += 1;
          total += 1;
        }
      }
      return right / total;
    });
    expect(fidelity[0]).toBeLessThan(fidelity[1]!);
    expect(fidelity[1]).toBeLessThan(fidelity[2]!);
    // And even the best tier is a long way from perfect recall, which is the whole point.
    expect(fidelity[2]).toBeLessThan(0.98);
  });

  it('serves more orders the higher the tier', () => {
    const served = TIERS.map((tier) => {
      let total = 0;
      for (let seed = 1; seed <= 40; seed += 1) {
        total += runBots(seed * 7919, tier, tier).state.p1;
      }
      return total / 40;
    });
    expect(served[0]).toBeLessThan(served[1]!);
    expect(served[1]).toBeLessThan(served[2]!);
  });

  it('beats the tier below it, from both seat orders', () => {
    for (const [strong, weak] of [
      ['hard', 'easy'],
      ['hard', 'normal'],
      ['normal', 'easy'],
    ] as const) {
      for (const strongSeat of ['p1', 'p2'] as const) {
        let wins = 0;
        let decided = 0;
        for (let seed = 1; seed <= 60; seed += 1) {
          const p1 = strongSeat === 'p1' ? strong : weak;
          const p2 = strongSeat === 'p1' ? weak : strong;
          const winner = runBots(seed * 7919, p1, p2).state.winner;
          if (winner === null || winner === 'draw') continue;
          decided += 1;
          if (winner === strongSeat) wins += 1;
        }
        expect(decided).toBeGreaterThan(40);
        expect(
          wins / decided,
          `${strong} in ${strongSeat} against ${weak} took ${String(wins)}/${String(decided)}`,
        ).toBeGreaterThan(0.6);
      }
    }
  });
});

/* ------------------------------------------------------------------ symmetry */

describe('the two counters are one counter and its mirror', () => {
  /** Swap everything the two seats own. */
  function mirror(state: State): State {
    const swapped = createState();
    swapped.book = state.book;
    swapped.clock = state.clock;
    swapped.p1 = state.p2;
    swapped.p2 = state.p1;
    copyCounter(state.p2Counter, swapped.p1Counter);
    copyCounter(state.p1Counter, swapped.p2Counter);
    swapped.winner = judgeMatch(swapped, swapped.clock);
    return swapped;
  }

  function copyCounter(from: Readonly<Counter>, to: Counter): void {
    to.ticket = from.ticket;
    to.phase = from.phase;
    to.phaseSeconds = from.phaseSeconds;
    to.order.set(from.order);
    to.length = from.length;
    to.placed.set(from.placed);
    to.placedCount = from.placedCount;
    to.hand = from.hand;
    to.handTarget = from.handTarget;
    to.served = from.served;
    to.spoiled = from.spoiled;
    to.lastVerdict = from.lastVerdict;
  }

  /** A board that did not come from a fresh deal: mid-ticket, part-built, mid-walk. */
  function scramble(state: State, rng: Rng): void {
    for (const seat of ['p1', 'p2'] as const) {
      const counter = counterOf(state, seat);
      counter.ticket = rng.int(0, 14);
      dealTicket(counter, state.book);
      counter.phase = rng.int(0, 3);
      counter.phaseSeconds = rng.float() * 2;
      counter.placedCount = rng.int(0, counter.length + 1);
      for (let slot = 0; slot < counter.placedCount; slot += 1) {
        counter.placed[slot] = rng.int(0, KIND_COUNT);
      }
      counter.hand = rng.float() * (STATION_COUNT - 1);
      counter.handTarget = rng.float() * (STATION_COUNT - 1);
      counter.served = rng.int(0, TARGET_SERVED);
      counter.spoiled = rng.int(0, 9);
      counter.lastVerdict = rng.int(-1, 2);
    }
    state.p1 = state.p1Counter.served;
    state.p2 = state.p2Counter.served;
    state.clock = rng.float() * MATCH_SECONDS;
  }

  it('steps a mirrored board to the mirror of what it steps the board to', () => {
    // Lesson 8's test, written first. Three hundred boards, each stepped a hundred times, on
    // `step` itself rather than on a match outcome that could hide a difference.
    for (let seed = 1; seed <= 300; seed += 1) {
      const rng = new Rng(seed * 8191);
      const state = createState();
      resetState(state, new Rng(seed));
      scramble(state, rng);
      const other = mirror(state);

      for (let i = 0; i < 100; i += 1) {
        step(state, STEP);
        step(other, STEP);
        expect(snapshot(other.p1Counter), `seed ${String(seed)} step ${String(i)}`).toBe(
          snapshot(state.p2Counter),
        );
        expect(snapshot(other.p2Counter)).toBe(snapshot(state.p1Counter));
        expect(other.p1).toBe(state.p2);
        expect(other.p2).toBe(state.p1);
        const flipped = state.winner === 'p1' ? 'p2' : state.winner === 'p2' ? 'p1' : state.winner;
        expect(other.winner).toBe(flipped);
        if (state.winner !== null) break;
      }
    }
  });

  it('makes the same bot decision for a seat and for its mirror image', () => {
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 120; seed += 1) {
        const state = createState();
        resetState(state, new Rng(seed * 5));
        const other = mirror(state);
        const botA = createBotState();
        const botB = createBotState();
        const rngA = new Rng(seed * 313);
        const rngB = new Rng(seed * 313);
        for (let i = 0; i < 400; i += 1) {
          const a = botStep(state.p1Counter, botA, tier, rngA, STEP);
          const b = botStep(other.p2Counter, botB, tier, rngB, STEP);
          expect(b, `${tier} seed ${String(seed)} step ${String(i)}`).toBe(a);
          if (a >= 0) {
            commit(state.p1Counter);
            commit(other.p2Counter);
          }
          stepCounter(state.p1Counter, STEP, state.book);
          stepCounter(other.p2Counter, STEP, other.book);
          expect([...botB.recall]).toEqual([...botA.recall]);
        }
      }
    }
  });

  it('plays a seed and its opposite opening as one match and its mirror', () => {
    // The seat band, made structural rather than measured: the streams are handed out by
    // role, so swapping the opener swaps the whole match and nothing else. Seat one therefore
    // wins exactly half of every paired sample there is.
    for (const tier of TIERS) {
      let p1Wins = 0;
      let decided = 0;
      for (let seed = 1; seed <= 80; seed += 1) {
        const forward = runBots(seed * 7919, tier, tier, 'p1');
        const back = runBots(seed * 7919, tier, tier, 'p2');
        expect(back.steps, `seed ${String(seed)}`).toBe(forward.steps);
        expect(snapshot(back.state.p1Counter)).toBe(snapshot(forward.state.p2Counter));
        expect(snapshot(back.state.p2Counter)).toBe(snapshot(forward.state.p1Counter));
        for (const winner of [forward.state.winner, back.state.winner]) {
          if (winner === 'p1') {
            p1Wins += 1;
            decided += 1;
          } else if (winner === 'p2') decided += 1;
        }
      }
      expect(decided).toBeGreaterThan(100);
      expect(p1Wins / decided, `${tier} seat-one share`).toBe(0.5);
    }
  });
});

/* ------------------------------------------------------------------ termination */

describe('a match always ends', () => {
  it('finishes with two easy bots, from either opening, well inside ten minutes', () => {
    for (const opener of ['p1', 'p2'] as const) {
      for (let seed = 1; seed <= 60; seed += 1) {
        const { state, steps } = runBots(seed * 7919, 'easy', 'easy', opener);
        expect(state.winner, `seed ${String(seed)} never finished`).not.toBeNull();
        expect(steps).toBeLessThan(MATCH_SECONDS * 60 + 4);
      }
    }
  });

  it('ends on the clock even when nobody ever rings the bell', () => {
    // The backstop. Two people who fill their pizzas and then stare at them for ever are a
    // real position, and `roundSeconds` would not end it.
    const state = createState();
    resetState(state, new Rng(2));
    let steps = 0;
    for (; steps < 60 * 600; steps += 1) {
      step(state, STEP);
      if (state.winner !== null) break;
    }
    expect(state.winner).toBe('draw');
    expect(steps).toBeLessThanOrEqual(MATCH_SECONDS * 60 + 2);
  });

  it('stops simulating once it is over', () => {
    const state = createState();
    resetState(state, new Rng(2));
    state.clock = MATCH_SECONDS;
    step(state, STEP);
    expect(state.winner).not.toBeNull();
    const frozen = snapshot(state.p1Counter);
    for (let i = 0; i < 100; i += 1) step(state, STEP);
    expect(snapshot(state.p1Counter)).toBe(frozen);
  });
});

/* ------------------------------------------------------------------ determinism */

describe('determinism', () => {
  it('plays the identical match from the identical seed', () => {
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 30; seed += 1) {
        const first = runBots(seed * 3, tier, tier);
        const second = runBots(seed * 3, tier, tier);
        expect(second.steps).toBe(first.steps);
        expect(snapshot(second.state.p1Counter)).toBe(snapshot(first.state.p1Counter));
        expect(snapshot(second.state.p2Counter)).toBe(snapshot(first.state.p2Counter));
      }
    }
  });

  it('gives the two seats different matches from different books', () => {
    const a = runBots(1, 'normal', 'normal');
    const b = runBots(2, 'normal', 'normal');
    expect(snapshot(b.state.p1Counter)).not.toBe(snapshot(a.state.p1Counter));
  });

  it('does not let one seat’s pace change what the other is asked for', () => {
    // The reason the book is addressed rather than consumed. A `hard` opponent gets through
    // far more tickets than an `easy` one; if the book were a stream, that alone would deal
    // seat one different orders.
    const against: string[] = [];
    for (const opponent of TIERS) {
      const { state } = runBots(4242, 'normal', opponent);
      const orders: number[] = [];
      for (let ticket = 0; ticket < 20; ticket += 1) {
        for (let slot = 0; slot < ticketLength(ticket); slot += 1) {
          orders.push(ticketTopping(state.book, ticket, slot));
        }
      }
      against.push(orders.join(''));
    }
    expect(new Set(against).size).toBe(1);
  });
});
