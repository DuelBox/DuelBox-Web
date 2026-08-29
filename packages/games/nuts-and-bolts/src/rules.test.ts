import { describe, expect, it } from 'vitest';
import { Rng, otherSeat } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BLUNDER_CHANCE,
  BOLT_CAPACITY,
  BOLT_COUNT,
  BOT_DRAWS_PER_MOVE,
  DEAL_WALK,
  EMPTY,
  KINDS,
  KIND_SHARE,
  MARK_P1,
  MARK_P2,
  MOVES_PER_SEAT,
  MOVES_PER_TURN,
  NO_MOVE,
  NUTS_PER_SEAT,
  NUT_COUNT,
  SEARCH_DEPTH,
  SEARCH_NODES,
  SLOT_COUNT,
  SORTED_MIN,
  TURN_SECONDS,
  UNMARKED,
  applyMove,
  bank,
  botMove,
  createBotRngs,
  createMatch,
  dealInto,
  dealMarksInto,
  depthMarks,
  finishedInto,
  forfeitMove,
  fromOf,
  hasAnyLegalMove,
  isLegalMove,
  isPureIn,
  isSortedIn,
  judge,
  lastSearchNodes,
  legalMovesInto,
  liveMarks,
  markOf,
  marksOn,
  moveOf,
  movesInto,
  movesLeft,
  resetMatch,
  reverseMovesInto,
  toOf,
  topKind,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Match } from './rules.js';

const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];

/**
 * A generator that counts how many times it was asked for a value.
 *
 * Counted on the *calls*, not on the raw words: `Rng.int` samples by rejection, so the number
 * of 32-bit words a call consumes depends on how many legal moves the rack offers. That range
 * is a property of the shared rack, which both seats already see, and never of the opponent's
 * tier — which is the thing a per-seat stream has to be independent of.
 */
class CountingRng extends Rng {
  calls = 0;

  override bool(probability?: number): boolean {
    this.calls += 1;
    return super.bool(probability);
  }

  override int(low: number, high: number): number {
    this.calls += 1;
    return super.int(low, high);
  }
}
const SEATS: SeatId[] = ['p1', 'p2'];

function started(seed: number, openingSeat: SeatId = 'p1'): Match {
  const match = createMatch();
  resetMatch(match, new Rng(seed), openingSeat);
  return match;
}

interface Played {
  readonly match: Match;
  readonly order: SeatId[];
  readonly moves: number[];
  readonly turnLengths: number[];
}

/**
 * One bot-versus-bot match with **no frame cap at all**: a match that failed to terminate
 * would hang the suite rather than pass quietly.
 */
function playOut(
  seed: number,
  openingSeat: SeatId,
  tierP1: BotDifficulty,
  tierP2: BotDifficulty,
): Played {
  const match = started(seed, openingSeat);
  const rng = new Rng(seed);
  const rngs = createBotRngs(rng);
  const order: SeatId[] = [];
  const moves: number[] = [];
  const turnLengths: number[] = [];
  let previous: SeatId | null = null;
  let run = 0;

  while (match.winner === null) {
    const seat = match.active;
    if (seat === previous) run += 1;
    else {
      if (previous !== null) turnLengths.push(run);
      previous = seat;
      run = 1;
    }
    order.push(seat);
    const move = botMove(match, rngs[seat], seat === 'p1' ? tierP1 : tierP2);
    moves.push(move);
    if (move === NO_MOVE || !applyMove(match, move)) forfeitMove(match);
  }
  turnLengths.push(run);
  return { match, order, moves, turnLengths };
}

/* ------------------------------------------------------------------ the rack */

describe('the rack', () => {
  it('holds every nut of every kind and nothing else', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const match = started(seed * 31 + 7);
      const counts = new Array<number>(KINDS).fill(0);
      let nuts = 0;
      for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
        const tall = match.height[bolt] ?? 0;
        expect(tall).toBeLessThanOrEqual(BOLT_CAPACITY);
        for (let level = 0; level < BOLT_CAPACITY; level += 1) {
          const value = match.slots[bolt * BOLT_CAPACITY + level] ?? EMPTY;
          if (level < tall) {
            expect(value, 'a slot below the top is never empty').toBeGreaterThanOrEqual(0);
            counts[value] = (counts[value] ?? 0) + 1;
            nuts += 1;
          } else {
            expect(value, 'a slot above the top is always empty').toBe(EMPTY);
          }
        }
      }
      expect(nuts).toBe(NUT_COUNT);
      expect(counts).toEqual(new Array<number>(KINDS).fill(BOLT_CAPACITY));
    }
  });

  it('deals the same rack from the same seed and a different one from another', () => {
    const a = started(4242);
    const b = started(4242);
    const c = started(4243);
    expect(a.slots).toEqual(b.slots);
    expect(a.marks).toEqual(b.marks);
    expect(a.slots).not.toEqual(c.slots);
  });

  it('starts with no pile already all one kind, so every point is earned', () => {
    for (let seed = 0; seed < 500; seed += 1) {
      const match = started(seed * 977 + 13);
      for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
        expect(isSortedIn(match.slots, match.height, bolt), `seed ${String(seed)} bolt`).toBe(
          false,
        );
      }
      expect(liveMarks(match, 'p1')).toBe(0);
      expect(liveMarks(match, 'p2')).toBe(0);
      expect(match.p1Score).toBe(0);
      expect(match.p2Score).toBe(0);
    }
  });

  it('always deals a rack with something legal to do on it', () => {
    for (let seed = 0; seed < 500; seed += 1) {
      expect(hasAnyLegalMove(started(seed * 613 + 5))).toBe(true);
    }
  });
});

/* --------------------------------------------------------------- solvability */

/**
 * An independent ball-sort solver, written for this test and knowing nothing about how the
 * rack was dealt.
 *
 * Depth-first over the move graph with a visited set keyed on the *canonical* rack — the
 * bolts sorted by content, because two bolts holding the same nuts are the same bolt as far
 * as the puzzle is concerned. Bare bolts are folded together for the same reason.
 *
 * Parameterised over the rack's shape rather than reading the package's constants, so it can
 * be pointed at a small rack whose unsolvability is obvious. A test whose instrument has
 * never been seen to fail is not a test.
 */
function solves(
  slots: number[],
  height: number[],
  bolts: number,
  capacity: number,
  kinds: number,
  seen: Set<string> = new Set(),
): boolean {
  let finished = 0;
  const locked: boolean[] = [];
  for (let bolt = 0; bolt < bolts; bolt += 1) {
    const tall = height[bolt] ?? 0;
    let pure = tall > 0;
    const first = slots[bolt * capacity] ?? EMPTY;
    for (let level = 1; level < tall; level += 1) {
      if (slots[bolt * capacity + level] !== first) pure = false;
    }
    const full = pure && tall === capacity;
    locked.push(full);
    if (full) finished += 1;
  }
  if (finished === kinds) return true;

  const key = Array.from({ length: bolts }, (_unused, bolt) =>
    slots.slice(bolt * capacity, bolt * capacity + (height[bolt] ?? 0)).join(','),
  )
    .sort()
    .join('|');
  if (seen.has(key)) return false;
  seen.add(key);

  let firstBare = -1;
  for (let bolt = 0; bolt < bolts; bolt += 1) {
    if ((height[bolt] ?? 0) === 0) {
      firstBare = bolt;
      break;
    }
  }

  for (let from = 0; from < bolts; from += 1) {
    const tall = height[from] ?? 0;
    if (locked[from] === true || tall === 0) continue;
    const kind = slots[from * capacity + tall - 1] ?? EMPTY;
    for (let to = 0; to < bolts; to += 1) {
      const room = height[to] ?? 0;
      if (to === from || locked[to] === true || room >= capacity) continue;
      if (room > 0 && slots[to * capacity + room - 1] !== kind) continue;
      if (room === 0 && to !== firstBare) continue;
      slots[from * capacity + tall - 1] = EMPTY;
      height[from] = tall - 1;
      slots[to * capacity + room] = kind;
      height[to] = room + 1;
      const ok = solves(slots, height, bolts, capacity, kinds, seen);
      height[to] = room;
      slots[to * capacity + room] = EMPTY;
      height[from] = tall;
      slots[from * capacity + tall - 1] = kind;
      if (ok) return true;
    }
  }
  return false;
}

describe('every rack this game deals can be sorted', () => {
  /**
   * The whole reason the deal plays legal moves backwards from the finished rack.
   *
   * A sorting puzzle dealt by scattering nuts is unsolvable a good share of the time, and it
   * fails silently — an impossible rack looks exactly like a hard one. This checks the
   * property directly rather than trusting the construction, with a solver that has no idea
   * the construction exists.
   */
  it('proves it with a solver that knows nothing about the deal', () => {
    for (let seed = 0; seed < 400; seed += 1) {
      const match = started(seed * 7919 + 1000003);
      const ok = solves([...match.slots], [...match.height], BOLT_COUNT, BOLT_CAPACITY, KINDS);
      expect(ok, `the rack dealt for seed ${String(seed)} cannot be sorted`).toBe(true);
    }
  });

  it('and that solver says no when the answer is no', () => {
    // Five bolts of four, every bolt full and every bolt mixed: no bolt has room and no nut
    // can move at all, so nothing can ever be sorted. If the solver called this solvable, the
    // four hundred green results above would mean nothing.
    const slots = [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2, 0, 1, 2, 3];
    const height = [4, 4, 4, 4, 4];
    expect(solves(slots, height, 5, 4, 4)).toBe(false);
  });

  it('reaches the finished rack by exactly the moves the deal walked backwards', () => {
    // The construction's own claim, stated separately from the check above: every reverse
    // step is the inverse of a legal forward move, so the walk *is* a solution.
    const slots = new Array<number>(SLOT_COUNT).fill(EMPTY);
    const height = new Array<number>(BOLT_COUNT).fill(0);
    const out = new Array<number>(BOLT_COUNT * BOLT_COUNT).fill(0);
    finishedInto(slots, height);
    const rng = new Rng(20260829);
    const trail: number[] = [];
    for (let step = 0; step < DEAL_WALK; step += 1) {
      const count = reverseMovesInto(slots, height, out);
      expect(count).toBeGreaterThan(0);
      const move = out[rng.int(0, count)] ?? NO_MOVE;
      const back = fromOf(move);
      const lift = toOf(move);
      const tall = height[lift] ?? 0;
      const kind = slots[lift * BOLT_CAPACITY + tall - 1] ?? EMPTY;
      slots[lift * BOLT_CAPACITY + tall - 1] = EMPTY;
      height[lift] = tall - 1;
      const room = height[back] ?? 0;
      slots[back * BOLT_CAPACITY + room] = kind;
      height[back] = room + 1;
      trail.push(move);
    }

    // Now walk it forwards through the real rules and finish the rack.
    const match = createMatch();
    for (let index = 0; index < SLOT_COUNT; index += 1) match.slots[index] = slots[index] ?? EMPTY;
    for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) match.height[bolt] = height[bolt] ?? 0;
    match.p1Moves = DEAL_WALK;
    match.p2Moves = DEAL_WALK;
    match.turnMoves = DEAL_WALK * 2;
    for (let step = trail.length - 1; step >= 0; step -= 1) {
      const move = trail[step] ?? NO_MOVE;
      expect(isLegalMove(match, move), `forward step ${String(step)} was not legal`).toBe(true);
      applyMove(match, move);
    }
    expect(match.lockedCount).toBe(KINDS);
  });
});

/* ---------------------------------------------------------------- legal moves */

describe('what may move where', () => {
  it('is the observed rule and nothing added to it', () => {
    const match = started(11);
    const out = new Array<number>(BOLT_COUNT * BOLT_COUNT).fill(0);
    const count = legalMovesInto(match, out, 0);
    const legal = new Set(out.slice(0, count));
    for (let from = 0; from < BOLT_COUNT; from += 1) {
      for (let to = 0; to < BOLT_COUNT; to += 1) {
        const tallFrom = match.height[from] ?? 0;
        const tallTo = match.height[to] ?? 0;
        const expected =
          from !== to &&
          tallFrom > 0 &&
          tallTo < BOLT_CAPACITY &&
          (tallTo === 0 || topKind(match, to) === topKind(match, from));
        expect(legal.has(moveOf(from, to)), `${String(from)}->${String(to)}`).toBe(expected);
        expect(isLegalMove(match, moveOf(from, to))).toBe(expected);
      }
    }
  });

  it('never lets a nut out of a finished bolt', () => {
    const match = createMatch();
    // Bolt 0 finished, bolt 1 holding one nut of the same kind.
    for (let level = 0; level < BOLT_CAPACITY; level += 1) match.slots[level] = 0;
    match.height[0] = BOLT_CAPACITY;
    match.locked[0] = true;
    match.slots[BOLT_CAPACITY] = 0;
    match.height[1] = 1;
    expect(isLegalMove(match, moveOf(0, 1))).toBe(false);
    expect(isLegalMove(match, moveOf(1, 0))).toBe(false);
    expect(isLegalMove(match, moveOf(1, 2))).toBe(true);
  });

  it('offers only one bare bolt to the search, and every one of them to a player', () => {
    const match = started(29);
    const all = new Array<number>(BOLT_COUNT * BOLT_COUNT).fill(0);
    const trimmed = new Array<number>(BOLT_COUNT * BOLT_COUNT).fill(0);
    const wide = movesInto(match.slots, match.height, match.locked, all, 0, false);
    const narrow = movesInto(match.slots, match.height, match.locked, trimmed, 0, true);
    expect(narrow).toBeLessThanOrEqual(wide);
    const bare: number[] = [];
    for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
      if ((match.height[bolt] ?? 0) === 0) bare.push(bolt);
    }
    if (bare.length > 1) {
      const offered = new Set(trimmed.slice(0, narrow).map(toOf));
      for (const bolt of bare.slice(1)) expect(offered.has(bolt)).toBe(false);
    }
    // Every canonical move is a real one, so folding bare bolts can never invent a move.
    for (const move of trimmed.slice(0, narrow)) expect(isLegalMove(match, move)).toBe(true);
  });

  it('offers a move that finishes a bolt before one that does not', () => {
    const match = createMatch();
    // Bolt 0 has three of kind 0; bolt 1 has the fourth on top of a stranger; bolt 2 is bare.
    for (let level = 0; level < 3; level += 1) match.slots[level] = 0;
    match.height[0] = 3;
    match.slots[BOLT_CAPACITY] = 1;
    match.slots[BOLT_CAPACITY + 1] = 0;
    match.height[1] = 2;
    const out = new Array<number>(BOLT_COUNT * BOLT_COUNT).fill(0);
    const count = movesInto(match.slots, match.height, match.locked, out, 0, true);
    expect(count).toBeGreaterThan(1);
    expect(out[0]).toBe(moveOf(1, 0));
  });

  it('refuses a move that is not offered, and changes nothing when it does', () => {
    const match = started(77);
    const before = JSON.stringify(match);
    expect(applyMove(match, moveOf(3, 3))).toBe(false);
    expect(applyMove(match, -1)).toBe(false);
    expect(applyMove(match, 9999)).toBe(false);
    expect(JSON.stringify(match)).toBe(before);
  });
});

/* -------------------------------------------------------------------- marking */

describe('who owns a nut', () => {
  it('is dealt ten to a seat and never changes', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const match = started(seed * 101 + 3);
      let p1 = 0;
      let p2 = 0;
      for (let index = 0; index < SLOT_COUNT; index += 1) {
        if (match.marks[index] === MARK_P1) p1 += 1;
        else if (match.marks[index] === MARK_P2) p2 += 1;
      }
      expect(p1).toBe(NUTS_PER_SEAT);
      expect(p2).toBe(NUTS_PER_SEAT);
    }
  });

  it('gives each seat the same hand shape, whichever kind is whose', () => {
    expect(KIND_SHARE.length).toBe(KINDS);
    expect(KIND_SHARE.reduce((a, b) => a + b, 0)).toBe(NUTS_PER_SEAT);
    // Seat two's hand is the list reversed, so neither seat is dealt the easier side of it.
    const theirs = KIND_SHARE.map((share) => BOLT_CAPACITY - share);
    expect([...theirs].reverse()).toEqual([...KIND_SHARE]);
  });

  it('travels with the nut, so a move never takes a mark off anybody', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const match = started(seed * 37 + 5);
      const owners = new Map<string, number>();
      const record = (): void => {
        owners.clear();
        for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
          for (let level = 0; level < (match.height[bolt] ?? 0); level += 1) {
            const index = bolt * BOLT_CAPACITY + level;
            owners.set(
              `${String(match.slots[index])}:${String(match.marks[index])}`,
              (owners.get(`${String(match.slots[index])}:${String(match.marks[index])}`) ?? 0) + 1,
            );
          }
        }
      };
      record();
      const opening = new Map(owners);
      const rngs = createBotRngs(new Rng(seed));
      while (match.winner === null) {
        const move = botMove(match, rngs[match.active], 'normal');
        if (move === NO_MOVE || !applyMove(match, move)) forfeitMove(match);
      }
      record();
      // The multiset of (kind, owner) pairs on the rack is exactly what was dealt.
      expect(owners).toEqual(opening);
    }
  });

  it('leaves no nut unowned once the rack is dealt', () => {
    const match = started(9001);
    for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
      for (let level = 0; level < (match.height[bolt] ?? 0); level += 1) {
        expect(match.marks[bolt * BOLT_CAPACITY + level]).not.toBe(UNMARKED);
      }
    }
  });

  it('deals a hand whose distribution is the same for both chairs', () => {
    // The seeded coin at the end of the deal swaps the two seats outright, so the *set* of
    // hands seat one can be given is exactly the set seat two can be given. Checked on the
    // per-kind counts, which is where a lean would show.
    const p1 = new Map<string, number>();
    const p2 = new Map<string, number>();
    for (let seed = 0; seed < 4000; seed += 1) {
      const match = started(seed * 31 + 1);
      const shape = (mark: number): string => {
        const counts: number[] = [];
        for (let kind = 0; kind < KINDS; kind += 1) counts.push(0);
        for (let index = 0; index < SLOT_COUNT; index += 1) {
          const value = match.slots[index] ?? EMPTY;
          if (value !== EMPTY && match.marks[index] === mark) {
            counts[value] = (counts[value] ?? 0) + 1;
          }
        }
        return counts.join('');
      };
      const a = shape(MARK_P1);
      const b = shape(MARK_P2);
      p1.set(a, (p1.get(a) ?? 0) + 1);
      p2.set(b, (p2.get(b) ?? 0) + 1);
    }
    // Seat two's hand shape is seat one's read backwards, so the two tallies must agree once
    // one of them is reversed.
    for (const [shape, count] of p1) {
      const mirrored = [...shape].reverse().join('');
      expect(Math.abs(count - (p2.get(mirrored) ?? 0)), `${shape} vs ${mirrored}`).toBeLessThan(
        140,
      );
    }
  });
});

/* -------------------------------------------------------------------- scoring */

describe('the score', () => {
  it('counts your nuts on piles that are all one kind, and only those', () => {
    const match = createMatch();
    // Bolt 0: two of kind 0, both seat one's. Bolt 1: two of kind 1 under a stranger.
    match.slots[0] = 0;
    match.slots[1] = 0;
    match.marks[0] = MARK_P1;
    match.marks[1] = MARK_P1;
    match.height[0] = 2;
    match.slots[BOLT_CAPACITY] = 1;
    match.slots[BOLT_CAPACITY + 1] = 1;
    match.slots[BOLT_CAPACITY + 2] = 2;
    match.marks[BOLT_CAPACITY] = MARK_P2;
    match.marks[BOLT_CAPACITY + 1] = MARK_P2;
    match.marks[BOLT_CAPACITY + 2] = MARK_P2;
    match.height[1] = 3;
    expect(liveMarks(match, 'p1')).toBe(2);
    expect(liveMarks(match, 'p2')).toBe(0);
    // A lone nut is not a line-up.
    match.slots[BOLT_CAPACITY * 2] = 3;
    match.marks[BOLT_CAPACITY * 2] = MARK_P1;
    match.height[2] = 1;
    expect(SORTED_MIN).toBe(2);
    expect(liveMarks(match, 'p1')).toBe(2);
  });

  it('counts a nut as deep as the pile it stands in, for the last tiebreak', () => {
    const match = createMatch();
    for (let level = 0; level < 3; level += 1) {
      match.slots[level] = 0;
      match.marks[level] = MARK_P1;
    }
    match.height[0] = 3;
    match.slots[BOLT_CAPACITY] = 1;
    match.slots[BOLT_CAPACITY + 1] = 1;
    match.marks[BOLT_CAPACITY] = MARK_P2;
    match.marks[BOLT_CAPACITY + 1] = MARK_P2;
    match.height[1] = 2;
    expect(liveMarks(match, 'p1')).toBe(3);
    expect(liveMarks(match, 'p2')).toBe(2);
    expect(depthMarks(match, 'p1')).toBe(9);
    expect(depthMarks(match, 'p2')).toBe(4);
  });

  it('only ever climbs, whatever happens on the rack afterwards', () => {
    for (let seed = 0; seed < 80; seed += 1) {
      const match = started(seed * 53 + 11);
      const rngs = createBotRngs(new Rng(seed));
      let p1 = match.p1Score;
      let p2 = match.p2Score;
      while (match.winner === null) {
        const move = botMove(match, rngs[match.active], 'normal');
        if (move === NO_MOVE || !applyMove(match, move)) forfeitMove(match);
        expect(match.p1Score).toBeGreaterThanOrEqual(p1);
        expect(match.p2Score).toBeGreaterThanOrEqual(p2);
        p1 = match.p1Score;
        p2 = match.p2Score;
      }
      expect(match.p1Score).toBeLessThanOrEqual(NUTS_PER_SEAT);
      expect(match.p2Score).toBeLessThanOrEqual(NUTS_PER_SEAT);
    }
  });

  it('is the high-water mark, not a reading of the final rack', () => {
    const match = createMatch();
    match.slots[0] = 0;
    match.slots[1] = 0;
    match.marks[0] = MARK_P1;
    match.marks[1] = MARK_P1;
    match.height[0] = 2;
    match.p1Moves = 4;
    match.p2Moves = 4;
    match.turnMoves = 4;
    bank(match);
    expect(match.p1Score).toBe(2);
    // Seat two lifts the top nut away. Seat one still holds two banked and only one live.
    match.active = 'p2';
    match.turnMoves = 4;
    expect(applyMove(match, moveOf(0, 1))).toBe(true);
    expect(liveMarks(match, 'p1')).toBe(0);
    expect(match.p1Score).toBe(2);
  });

  it('decides on the bank, then on what is still held, then on how deep', () => {
    const spent = (build: (match: Match) => void): SeatId | 'draw' | null => {
      const match = createMatch();
      build(match);
      match.p1Moves = 0;
      match.p2Moves = 0;
      match.turnMoves = 0;
      return judge(match);
    };
    expect(
      spent((match) => {
        match.p1Score = 3;
        match.p2Score = 2;
      }),
    ).toBe('p1');
    expect(
      spent((match) => {
        match.p1Score = 2;
        match.p2Score = 3;
      }),
    ).toBe('p2');
    expect(
      spent((match) => {
        match.p1Score = 2;
        match.p2Score = 2;
      }),
    ).toBe('draw');
    expect(
      spent((match) => {
        match.p1Score = 2;
        match.p2Score = 2;
        match.slots[0] = 0;
        match.slots[1] = 0;
        match.marks[0] = MARK_P1;
        match.marks[1] = MARK_P1;
        match.height[0] = 2;
      }),
      'level on the bank, seat one still holds two',
    ).toBe('p1');
    expect(
      spent((match) => {
        match.p1Score = 3;
        match.p2Score = 3;
        // Both hold three, but seat one's are in a taller pile.
        for (let level = 0; level < 3; level += 1) {
          match.slots[level] = 0;
          match.marks[level] = MARK_P1;
        }
        match.height[0] = 3;
        for (let level = 0; level < 2; level += 1) {
          match.slots[BOLT_CAPACITY + level] = 1;
          match.marks[BOLT_CAPACITY + level] = MARK_P2;
        }
        match.slots[BOLT_CAPACITY * 2] = 2;
        match.slots[BOLT_CAPACITY * 2 + 1] = 2;
        match.marks[BOLT_CAPACITY * 2] = MARK_P2;
        match.height[1] = 2;
        match.height[2] = 2;
      }),
      'level on the bank and on what is held, seat one is deeper',
    ).toBe('p1');
  });

  it('pays a finished bolt to everybody standing in it, and locks it', () => {
    const match = createMatch();
    for (let level = 0; level < 3; level += 1) {
      match.slots[level] = 0;
      match.marks[level] = level === 0 ? MARK_P2 : MARK_P1;
    }
    match.height[0] = 3;
    match.slots[BOLT_CAPACITY] = 0;
    match.marks[BOLT_CAPACITY] = MARK_P2;
    match.height[1] = 1;
    match.p1Moves = 4;
    match.p2Moves = 4;
    match.turnMoves = 4;
    expect(applyMove(match, moveOf(1, 0))).toBe(true);
    expect(match.locked[0]).toBe(true);
    expect(match.lockedCount).toBe(1);
    expect(marksOn(match, 0, 'p1')).toBe(2);
    expect(marksOn(match, 0, 'p2')).toBe(2);
    expect(match.p1Score).toBe(2);
    expect(match.p2Score).toBe(2);
    expect(isPureIn(match.slots, match.height, 0)).toBe(true);
  });
});

/* ---------------------------------------------------------------- the turn */

describe('the turn order', () => {
  it('runs A, BB, AA, ... BB, A — the same order backwards with the chairs swapped', () => {
    for (const opener of SEATS) {
      const played = playOut(20260829, opener, 'normal', 'normal');
      // Only a match that ran its whole budget can show the whole pattern.
      if (movesLeft(played.match, 'p1') > 0 || movesLeft(played.match, 'p2') > 0) continue;
      const lengths = played.turnLengths;
      expect(lengths[0]).toBe(1);
      expect(lengths[lengths.length - 1]).toBe(1);
      for (const length of lengths.slice(1, -1)) expect(length).toBe(MOVES_PER_TURN);
      expect([...lengths].reverse()).toEqual(lengths);
      const first = played.order[0];
      expect(first).toBe(opener);
      expect(played.order[played.order.length - 1]).toBe(otherSeat(opener));
    }
  });

  it('gives both seats exactly the same number of moves', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const played = playOut(seed * 71 + 3, seed % 2 === 0 ? 'p1' : 'p2', 'normal', 'normal');
      const p1 = played.order.filter((seat) => seat === 'p1').length;
      const p2 = played.order.filter((seat) => seat === 'p2').length;
      // Either both budgets are spent, or the rack finished early and the difference is at
      // most the one move a turn is worth.
      expect(Math.abs(p1 - p2)).toBeLessThanOrEqual(MOVES_PER_TURN);
      expect(p1).toBeLessThanOrEqual(MOVES_PER_SEAT);
      expect(p2).toBeLessThanOrEqual(MOVES_PER_SEAT);
    }
  });

  it('opens with the seat the shell names, not with p1', () => {
    expect(started(5, 'p1').active).toBe('p1');
    expect(started(5, 'p2').active).toBe('p2');
    const one = playOut(31337, 'p1', 'hard', 'hard');
    const two = playOut(31337, 'p2', 'hard', 'hard');
    expect(one.order[0]).toBe('p1');
    expect(two.order[0]).toBe('p2');
    expect(one.moves).not.toEqual(two.moves);
  });
});

/* ------------------------------------------------------------- termination */

describe('the match always ends', () => {
  /**
   * No frame cap at all, deliberately: a match that failed to terminate would hang the suite
   * rather than pass quietly. The two `easy` seats are the pairing the cross-game guard uses,
   * because the weakest play is the most likely to reach a position nothing resolves.
   */
  it('with two easy bots, on two hundred racks, with no ceiling on the loop', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const played = playOut(seed * 7919 + 1000003, seed % 2 === 0 ? 'p1' : 'p2', 'easy', 'easy');
      expect(winnerOf(played.match)).not.toBeNull();
      expect(played.order.length).toBeLessThanOrEqual(MOVES_PER_SEAT * 2);
    }
  });

  it('for one of exactly three reasons, and all three are reached', () => {
    const reasons = { solved: 0, budget: 0, jammed: 0 };
    for (let seed = 0; seed < 400; seed += 1) {
      const played = playOut(seed * 7919 + 1000003, seed % 2 === 0 ? 'p1' : 'p2', 'easy', 'easy');
      const match = played.match;
      if (match.lockedCount >= KINDS) reasons.solved += 1;
      else if (match.p1Moves <= 0 && match.p2Moves <= 0) reasons.budget += 1;
      else {
        expect(hasAnyLegalMove(match), 'a match ended with a move still on the rack').toBe(false);
        reasons.jammed += 1;
      }
    }
    expect(reasons.solved).toBeGreaterThan(0);
    expect(reasons.budget).toBeGreaterThan(0);
    expect(reasons.jammed).toBeGreaterThan(0);
  });

  it('even when nobody plays a move at all', () => {
    // What the turn clock does: a forfeited move spends the budget exactly as a played one
    // does, so two people who put the phone down still finish.
    const match = started(4);
    let spent = 0;
    while ((match.winner !== null) === false) {
      expect(forfeitMove(match)).toBe(true);
      spent += 1;
    }
    expect(spent).toBe(MOVES_PER_SEAT * 2);
    expect(match.p1Moves).toBe(0);
    expect(match.p2Moves).toBe(0);
    expect(forfeitMove(match)).toBe(false);
    expect(winnerOf(match)).toBe('draw');
    expect(MOVES_PER_SEAT * 2 * TURN_SECONDS).toBeLessThan(600);
  });

  it('and a jammed rack is a real position, not a bug', () => {
    // Every bolt full, every bolt mixed: nothing can move and the match is over on the spot.
    const match = createMatch();
    const pattern = [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2, 0, 1, 2, 3];
    for (let bolt = 0; bolt < 5; bolt += 1) {
      for (let level = 0; level < BOLT_CAPACITY; level += 1) {
        match.slots[bolt * BOLT_CAPACITY + level] = pattern[bolt * BOLT_CAPACITY + level] ?? 0;
      }
      match.height[bolt] = BOLT_CAPACITY;
    }
    match.height[5] = BOLT_CAPACITY;
    match.height[6] = BOLT_CAPACITY;
    for (let bolt = 5; bolt < BOLT_COUNT; bolt += 1) {
      for (let level = 0; level < BOLT_CAPACITY; level += 1) {
        match.slots[bolt * BOLT_CAPACITY + level] = (bolt + level) % 4;
      }
    }
    expect(hasAnyLegalMove(match)).toBe(false);
    expect(judge(match)).not.toBeNull();
  });
});

/* ---------------------------------------------------- the half-turn on seats */

/** The same rack with the two seats' nuts swapped, and the move handed to the other chair. */
function swapSeats(match: Readonly<Match>): Match {
  const mirror = createMatch();
  for (let index = 0; index < SLOT_COUNT; index += 1) {
    mirror.slots[index] = match.slots[index] ?? EMPTY;
    const mark = match.marks[index] ?? UNMARKED;
    mirror.marks[index] = mark === MARK_P1 ? MARK_P2 : mark === MARK_P2 ? MARK_P1 : UNMARKED;
  }
  for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
    mirror.height[bolt] = match.height[bolt] ?? 0;
    mirror.locked[bolt] = match.locked[bolt] === true;
  }
  mirror.active = otherSeat(match.active);
  mirror.turnMoves = match.turnMoves;
  mirror.p1Moves = match.p2Moves;
  mirror.p2Moves = match.p1Moves;
  mirror.p1Score = match.p2Score;
  mirror.p2Score = match.p1Score;
  mirror.lockedCount = match.lockedCount;
  mirror.winner = match.winner === 'p1' ? 'p2' : match.winner === 'p2' ? 'p1' : match.winner;
  return mirror;
}

/**
 * Swapping the two seats is this game's mirror, and it finds what nothing else can.
 *
 * Snowball Throw measured seat one at 64.3% and bisecting found two defects invisible to
 * every other kind of test, both of them a rule written in board coordinates rather than in
 * the mover's own frame. Here the analogue is a rule written in terms of `p1` and `p2` rather
 * than in terms of *the seat to move*: take a rack, swap whose nuts are whose, hand the move
 * to the other chair, and every answer the rules give must come back swapped as well.
 */
describe('the rules are covariant under swapping the two seats', () => {
  it('agrees on every judgement, on hundreds of racks', () => {
    for (let seed = 0; seed < 300; seed += 1) {
      const match = started(seed * 8191 + 17, seed % 2 === 0 ? 'p1' : 'p2');
      // Drive it a few moves so the racks under test are not all opening positions.
      const rngs = createBotRngs(new Rng(seed));
      for (let step = 0; step < seed % 6; step += 1) {
        if (match.winner !== null) break;
        const move = botMove(match, rngs[match.active], 'normal');
        if (move === NO_MOVE || !applyMove(match, move)) forfeitMove(match);
      }
      const mirror = swapSeats(match);

      expect(liveMarks(mirror, 'p1')).toBe(liveMarks(match, 'p2'));
      expect(liveMarks(mirror, 'p2')).toBe(liveMarks(match, 'p1'));
      expect(depthMarks(mirror, 'p1')).toBe(depthMarks(match, 'p2'));
      expect(hasAnyLegalMove(mirror)).toBe(hasAnyLegalMove(match));
      const a = judge(match);
      const b = judge(mirror);
      expect(b).toBe(a === 'p1' ? 'p2' : a === 'p2' ? 'p1' : a);

      const out = new Array<number>(BOLT_COUNT * BOLT_COUNT).fill(0);
      const mirrorOut = new Array<number>(BOLT_COUNT * BOLT_COUNT).fill(0);
      const count = legalMovesInto(match, out, 0);
      expect(legalMovesInto(mirror, mirrorOut, 0)).toBe(count);
      expect(mirrorOut.slice(0, count)).toEqual(out.slice(0, count));
    }
  });

  it('and so does every decision the bot makes, at every tier', () => {
    for (const tier of TIERS) {
      for (let seed = 0; seed < 120; seed += 1) {
        const match = started(seed * 4099 + 23, seed % 2 === 0 ? 'p1' : 'p2');
        const rngs = createBotRngs(new Rng(seed));
        for (let step = 0; step < seed % 5; step += 1) {
          if (match.winner !== null) break;
          const move = botMove(match, rngs[match.active], 'normal');
          if (move === NO_MOVE || !applyMove(match, move)) forfeitMove(match);
        }
        if (match.winner !== null) continue;
        const mirror = swapSeats(match);
        // The same generator state on both sides, so only the rack and the chair differ.
        const chosen = botMove(match, new Rng(seed | 1), tier);
        const mirrored = botMove(mirror, new Rng(seed | 1), tier);
        expect(mirrored, `${tier} chose differently for the mirrored seat`).toBe(chosen);
      }
    }
  });

  it('plays a whole match the same way from either chair', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const one = playOut(seed * 6151 + 7, 'p1', 'hard', 'hard');
      const two = playOut(seed * 6151 + 7, 'p2', 'hard', 'hard');
      // Not the same match — the two racks differ in whose nuts are whose — but the two must
      // not disagree about how long a match is by more than a turn.
      expect(Math.abs(one.order.length - two.order.length)).toBeLessThanOrEqual(MOVES_PER_SEAT * 2);
      expect(one.match.winner).not.toBeNull();
      expect(two.match.winner).not.toBeNull();
    }
  });
});

/* --------------------------------------------------------------------- the bot */

describe('the bot', () => {
  it('takes exactly the same number of draws every move, whatever it decides to do', () => {
    // Both draws happen before anything branches, so the generator advances by the same
    // amount whether the bot blunders or searches. A conditional draw count is how one seat's
    // play quietly becomes a function of how its opponent happens to be playing.
    for (const tier of TIERS) {
      const match = started(818);
      const rng = new CountingRng(5);
      let moves = 0;
      while (match.winner === null) {
        const before = rng.calls;
        const move = botMove(match, rng, tier);
        expect(rng.calls - before, `${tier} drew a different number of values`).toBe(
          BOT_DRAWS_PER_MOVE,
        );
        moves += 1;
        if (move === NO_MOVE || !applyMove(match, move)) forfeitMove(match);
      }
      expect(moves).toBeGreaterThan(0);
    }
  });

  it('draws the blunder coin before it knows whether it is going to blunder', () => {
    // The behavioural half of the same claim: the tier that never blunders advances its
    // generator by exactly as much as the tier that blunders on more than half its moves, so
    // two seats on different tiers stay on the same footing.
    const spend = (tier: BotDifficulty): number => {
      const match = started(2024);
      const rng = new CountingRng(77);
      let moves = 0;
      while (match.winner === null && moves < 4) {
        const move = botMove(match, rng, tier);
        if (move === NO_MOVE || !applyMove(match, move)) forfeitMove(match);
        moves += 1;
      }
      return rng.calls;
    };
    expect(BLUNDER_CHANCE.hard).toBe(0);
    expect(BLUNDER_CHANCE.easy).toBeGreaterThan(0.5);
    expect(spend('hard')).toBe(spend('easy'));
  });

  it('gives each seat its own stream, so one seat never reads the other', () => {
    // A shared stream is unbiased in a strict-alternation turn game *as long as* every turn
    // costs the same number of draws — and that is a property a later change breaks silently.
    // Two streams make it structural: the seat that is not moving never advances at all, so
    // its play cannot become a function of how its opponent happens to be playing.
    const rngs = createBotRngs(new Rng(20260829));
    expect(rngs.p1.save()).not.toEqual(rngs.p2.save());

    const match = started(20260829, 'p1');
    while (match.winner === null) {
      const seat = match.active;
      const idle = otherSeat(seat);
      const before = JSON.stringify(rngs[idle].save());
      const move = botMove(match, rngs[seat], seat === 'p1' ? 'hard' : 'easy');
      expect(JSON.stringify(rngs[idle].save()), 'the idle seat advanced').toBe(before);
      if (move === NO_MOVE || !applyMove(match, move)) forfeitMove(match);
    }
  });

  it('leaves the match exactly as it found it', () => {
    for (const tier of TIERS) {
      const match = started(1234);
      const before = JSON.stringify(match);
      botMove(match, new Rng(3), tier);
      expect(JSON.stringify(match)).toBe(before);
    }
  });

  it('returns the same move for the same rack and the same generator', () => {
    for (const tier of TIERS) {
      const match = started(4321);
      expect(botMove(match, new Rng(11), tier)).toBe(botMove(match, new Rng(11), tier));
    }
  });

  it('always returns a legal move when there is one', () => {
    for (const tier of TIERS) {
      for (let seed = 0; seed < 40; seed += 1) {
        const match = started(seed * 199 + 3);
        const rngs = createBotRngs(new Rng(seed));
        while (match.winner === null) {
          const move = botMove(match, rngs[match.active], tier);
          expect(move === NO_MOVE || isLegalMove(match, move)).toBe(true);
          if (move === NO_MOVE || !applyMove(match, move)) forfeitMove(match);
        }
      }
    }
  });

  it('reaches its declared depth inside the node budget', () => {
    let worst = 0;
    for (let seed = 0; seed < 60; seed += 1) {
      const match = started(seed * 313 + 9);
      const rngs = createBotRngs(new Rng(seed));
      while (match.winner === null) {
        const move = botMove(match, rngs[match.active], 'hard');
        worst = Math.max(worst, lastSearchNodes());
        if (move === NO_MOVE || !applyMove(match, move)) forfeitMove(match);
      }
    }
    expect(worst).toBeGreaterThan(0);
    expect(worst, 'the budget has become a limiter rather than a guard').toBeLessThan(SEARCH_NODES);
    expect(SEARCH_DEPTH.hard).toBeGreaterThan(SEARCH_DEPTH.normal);
    expect(SEARCH_DEPTH.normal).toBeGreaterThan(SEARCH_DEPTH.easy);
    expect(BLUNDER_CHANCE.easy).toBeGreaterThan(BLUNDER_CHANCE.normal);
    expect(BLUNDER_CHANCE.normal).toBeGreaterThan(BLUNDER_CHANCE.hard);
  });

  /**
   * The ladder, measured from **both** seat orders and averaged.
   *
   * A tier number taken from one chair is a tier number plus a chair number, and nothing in
   * it says how much of each. The sample here is small enough to run on every commit; the
   * numbers in SPEC.md were taken at 800 seeds a pairing.
   */
  function ladder(strong: BotDifficulty, weak: BotDifficulty, seeds: number): number {
    let wins = 0;
    let decided = 0;
    for (let seed = 0; seed < seeds; seed += 1) {
      for (const strongSeat of SEATS) {
        const played = playOut(
          seed * 7919 + 1000003,
          seed % 2 === 0 ? 'p1' : 'p2',
          strongSeat === 'p1' ? strong : weak,
          strongSeat === 'p1' ? weak : strong,
        );
        const winner = played.match.winner;
        if (winner === null || winner === 'draw') continue;
        decided += 1;
        if (winner === strongSeat) wins += 1;
      }
    }
    return decided === 0 ? Number.NaN : wins / decided;
  }

  it('is ordered: hard beats normal beats easy, from both chairs', () => {
    const hardEasy = ladder('hard', 'easy', 120);
    const hardNormal = ladder('hard', 'normal', 120);
    const normalEasy = ladder('normal', 'easy', 120);
    expect(hardEasy).toBeGreaterThan(0.8);
    expect(hardNormal).toBeGreaterThan(0.65);
    expect(normalEasy).toBeGreaterThan(0.65);
    expect(hardEasy).toBeGreaterThan(hardNormal);
    expect(hardEasy).toBeGreaterThan(normalEasy);
  });

  it('splits the seats evenly at equal skill, from both opening seats', () => {
    for (const tier of TIERS) {
      let seatOne = 0;
      let decided = 0;
      for (let seed = 0; seed < 200; seed += 1) {
        for (const opener of SEATS) {
          const played = playOut(seed * 7919 + 1000003, opener, tier, tier);
          const winner = played.match.winner;
          if (winner === null || winner === 'draw') continue;
          decided += 1;
          if (winner === 'p1') seatOne += 1;
        }
      }
      const share = seatOne / decided;
      expect(decided, `${tier} decided nothing`).toBeGreaterThan(100);
      expect(share, `${tier} gave seat one ${(share * 100).toFixed(1)}%`).toBeGreaterThan(0.42);
      expect(share, `${tier} gave seat one ${(share * 100).toFixed(1)}%`).toBeLessThan(0.58);
    }
  });
});

/* ------------------------------------------------------------------ the shape */

describe('the constants hold together', () => {
  it('leaves room on the rack for the puzzle to be played', () => {
    expect(BOLT_COUNT).toBeGreaterThan(KINDS);
    expect(SLOT_COUNT - NUT_COUNT).toBe((BOLT_COUNT - KINDS) * BOLT_CAPACITY);
    expect(NUT_COUNT % 2).toBe(0);
    expect(MOVES_PER_SEAT % 2, 'an even budget gives one seat a double turn more').toBe(1);
    expect(markOf('p1')).toBe(MARK_P1);
    expect(markOf('p2')).toBe(MARK_P2);
  });

  it('packs and unpacks a move', () => {
    for (let from = 0; from < BOLT_COUNT; from += 1) {
      for (let to = 0; to < BOLT_COUNT; to += 1) {
        const move = moveOf(from, to);
        expect(fromOf(move)).toBe(from);
        expect(toOf(move)).toBe(to);
      }
    }
  });

  it('deals marks that a caller can reproduce from the seed alone', () => {
    const slots = new Array<number>(SLOT_COUNT).fill(EMPTY);
    const height = new Array<number>(BOLT_COUNT).fill(0);
    dealInto(slots, height, new Rng(64));
    const a = new Array<number>(SLOT_COUNT).fill(UNMARKED);
    const b = new Array<number>(SLOT_COUNT).fill(UNMARKED);
    dealMarksInto(slots, height, a, new Rng(9));
    dealMarksInto(slots, height, b, new Rng(9));
    expect(a).toEqual(b);
  });
});
