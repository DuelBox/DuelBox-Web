import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOT_PROFILES,
  CARRY_DRAG,
  CENTRE_NOTE,
  CENTRE_VALUE,
  GRAB_RADIUS,
  GRIP_DECAY,
  GRIP_SECONDS,
  HAND_MAX_X,
  HAND_MIN_X,
  HAND_SPEED,
  HOME_AT,
  MATCH_SECONDS,
  MAX_CARRY,
  MID_Y,
  NOTE_COUNT,
  NOTE_MAX_X,
  NOTE_MAX_Y,
  NOTE_MIN_X,
  NOTE_MIN_Y,
  NOTE_PAIRS,
  PILE_VALUE,
  REACH_PAST_MID,
  SAFE_RADIUS,
  SAFE_X,
  botLook,
  botStep,
  clampHandX,
  clampHandY,
  contested,
  createBotState,
  createState,
  driveHand,
  handMaxYOf,
  handMinYOf,
  handOf,
  inSafe,
  palmHas,
  resetState,
  safeYOf,
  secondsLeft,
  speedOf,
  step,
  valueOfSlot,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Hand, Note, State } from './rules.js';

const STEP = 1 / 60;
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

function other(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/* ------------------------------------------------------------------ the table */

describe('the table', () => {
  it('is laid out as exact half-turn pairs, so neither seat is dealt the better one', () => {
    // Slot 2k+1 is the half-turn image of slot 2k with its heading reversed and the same
    // value, and slot 32 sits at the centre and does not move. Asserted to the bit: the
    // opening board is its own image under the rotation that turns one seat's view into the
    // other's, for every seed, so a seat advantage cannot be hiding in the deal.
    for (let seed = 0; seed < 100; seed += 1) {
      const state = createState();
      resetState(state, new Rng(seed * 7919 + 3));
      for (let pair = 0; pair < NOTE_PAIRS; pair += 1) {
        const a = state.notes[pair * 2];
        const b = state.notes[pair * 2 + 1];
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        if (a === undefined || b === undefined) continue;
        expect(b.x).toBe(BOARD_WIDTH - a.x);
        expect(b.y).toBe(BOARD_HEIGHT - a.y);
        expect(b.vx).toBe(-a.vx);
        expect(b.vy).toBe(-a.vy);
        expect(b.value).toBe(a.value);
      }
      const centre = state.notes[CENTRE_NOTE];
      expect(centre?.x).toBe(SAFE_X);
      expect(centre?.y).toBe(MID_Y);
      expect(centre?.vx).toBe(0);
      expect(centre?.vy).toBe(0);
      expect(centre?.value).toBe(CENTRE_VALUE);
    }
  });

  it('holds an odd number of pounds, so a cleared table can never be a draw', () => {
    let total = 0;
    for (let i = 0; i < NOTE_COUNT; i += 1) total += valueOfSlot(i);
    expect(total).toBe(PILE_VALUE);
    expect(PILE_VALUE % 2).toBe(1);
    // Which is the whole point of the centre note: p1 + p2 = odd implies p1 !== p2.
    for (let p1 = 0; p1 <= PILE_VALUE; p1 += 1) expect(p1).not.toBe(PILE_VALUE - p1);
  });

  it('starts both hands in their own safes, exactly opposite each other', () => {
    const state = createState();
    resetState(state, new Rng(11));
    expect(state.p1Hand.x).toBe(BOARD_WIDTH - state.p2Hand.x);
    expect(state.p1Hand.y).toBe(BOARD_HEIGHT - state.p2Hand.y);
    expect(state.p1).toBe(0);
    expect(state.p2).toBe(0);
    expect(state.inPlay).toBe(NOTE_COUNT);
    expect(winnerOf(state)).toBeNull();
  });

  it('gives each seat the same reach, and the same slice of the table to itself', () => {
    expect(handMinYOf('p1')).toBe(BOARD_HEIGHT - handMaxYOf('p2'));
    expect(handMaxYOf('p1')).toBe(BOARD_HEIGHT - handMinYOf('p2'));
    expect(handMaxYOf('p1') - handMinYOf('p1')).toBe(handMaxYOf('p2') - handMinYOf('p2'));
    expect(HAND_MIN_X).toBe(BOARD_WIDTH - HAND_MAX_X);
    // The contested band is the strip both palms can cover, and it is centred on the board.
    const near = MID_Y - REACH_PAST_MID - GRAB_RADIUS;
    const far = MID_Y + REACH_PAST_MID + GRAB_RADIUS;
    expect(near + far).toBe(BOARD_HEIGHT);
    expect(far).toBeGreaterThan(near);
  });
});

/* --------------------------------------------------------- mirror symmetry */

/**
 * The half-turn that takes one seat's view of the board to the other's.
 *
 * Slot indices are kept, positions and velocities are turned, and everything seat-labelled is
 * swapped. Written before the game was, and it is the test that found things nothing else
 * here could see — a threshold a state variable lands on exactly by construction is invisible
 * to a unit test and to a win-rate ladder, and this game has one by design (the centre note,
 * equidistant from both hands and stationary).
 */
function mirrorHand(hand: Readonly<Hand>): Hand {
  return {
    x: BOARD_WIDTH - hand.x,
    y: BOARD_HEIGHT - hand.y,
    targetX: BOARD_WIDTH - hand.targetX,
    targetY: BOARD_HEIGHT - hand.targetY,
    carryCount: hand.carryCount,
    carryValue: hand.carryValue,
    banks: hand.banks,
    lastBank: hand.lastBank,
  };
}

function mirrorState(state: Readonly<State>): State {
  const out = createState();
  for (let i = 0; i < state.notes.length; i += 1) {
    const from = state.notes[i];
    const to = out.notes[i];
    if (from === undefined || to === undefined) continue;
    to.x = BOARD_WIDTH - from.x;
    to.y = BOARD_HEIGHT - from.y;
    to.vx = -from.vx;
    to.vy = -from.vy;
    to.value = from.value;
    to.banked = from.banked;
    to.carriedBy = from.carriedBy === null ? null : other(from.carriedBy);
    to.grip1 = from.grip2;
    to.grip2 = from.grip1;
  }
  Object.assign(out.p1Hand, mirrorHand(state.p2Hand));
  Object.assign(out.p2Hand, mirrorHand(state.p1Hand));
  out.p1 = state.p2;
  out.p2 = state.p1;
  out.clock = state.clock;
  out.inPlay = state.inPlay;
  out.winner =
    state.winner === null || state.winner === 'draw' ? state.winner : other(state.winner);
  return out;
}

/** A board with nothing symmetric about it: scattered notes, part-grips, loaded hands. */
function scatteredBoard(rng: Rng): State {
  const state = createState();
  resetState(state, rng);
  for (let i = 0; i < state.notes.length; i += 1) {
    const note = state.notes[i];
    if (note === undefined) continue;
    note.x = NOTE_MIN_X + rng.float() * (NOTE_MAX_X - NOTE_MIN_X);
    note.y = NOTE_MIN_Y + rng.float() * (NOTE_MAX_Y - NOTE_MIN_Y);
    const heading = rng.float() * Math.PI * 2;
    const speed = 20 + rng.float() * 30;
    note.vx = Math.cos(heading) * speed;
    note.vy = Math.sin(heading) * speed;
    note.value = rng.int(1, 4);
    const roll = rng.float();
    if (roll < 0.12) {
      note.banked = true;
      state.inPlay -= 1;
    } else if (roll < 0.26) {
      note.carriedBy = 'p1';
      state.p1Hand.carryCount += 1;
      state.p1Hand.carryValue += note.value;
    } else if (roll < 0.4) {
      note.carriedBy = 'p2';
      state.p2Hand.carryCount += 1;
      state.p2Hand.carryValue += note.value;
    }
    note.grip1 = rng.float() < 0.3 ? rng.float() * GRIP_SECONDS : 0;
    note.grip2 = rng.float() < 0.3 ? rng.float() * GRIP_SECONDS : 0;
  }
  for (const seat of ['p1', 'p2'] as const) {
    const hand = handOf(state, seat);
    hand.x = clampHandX(HAND_MIN_X + rng.float() * (HAND_MAX_X - HAND_MIN_X));
    hand.y = clampHandY(seat, rng.float() * BOARD_HEIGHT);
    hand.targetX = hand.x;
    hand.targetY = hand.y;
  }
  return state;
}

/** Everything discrete about a board: who owns what, and what the score is. */
function discrete(state: Readonly<State>): string {
  const notes = state.notes.map((note) => `${String(note.carriedBy)}/${String(note.banked)}`);
  return JSON.stringify({
    notes,
    p1: state.p1,
    p2: state.p2,
    inPlay: state.inPlay,
    winner: state.winner,
    carry: [state.p1Hand.carryCount, state.p2Hand.carryCount],
    banks: [state.p1Hand.banks, state.p2Hand.banks],
  });
}

describe('mirror symmetry', () => {
  /**
   * Positions are compared to within a billionth rather than to the bit, and that is a
   * property of doubles rather than a hole in the test: `600 - (x + v dt)` and
   * `(600 - x) - v dt` round differently in the last place. What is asserted exactly is every
   * *discrete* consequence — which palm took which note, what was banked, who won — because
   * those are the only places a last-bit difference could ever be seen, and this file's
   * thresholds are built so that none of them is a knife edge: a grip test is
   * `dx*dx + dy*dy <= r*r`, and negating both components is exact.
   */
  const NEAR = 1e-9;

  it('steps a mirrored board into the mirror of the stepped board', () => {
    let checked = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const rng = new Rng(seed * 7919 + 13);
      const forward = scatteredBoard(rng);
      const mirrored = mirrorState(forward);
      for (let k = 0; k < 40; k += 1) {
        step(forward, STEP);
        step(mirrored, STEP);
      }
      const expected = mirrorState(forward);
      expect(discrete(expected), `seed ${String(seed)}`).toBe(discrete(mirrored));
      for (let i = 0; i < expected.notes.length; i += 1) {
        const a = expected.notes[i];
        const b = mirrored.notes[i];
        if (a === undefined || b === undefined) continue;
        expect(Math.abs(a.x - b.x)).toBeLessThan(NEAR);
        expect(Math.abs(a.y - b.y)).toBeLessThan(NEAR);
        expect(Math.abs(a.grip1 - b.grip1)).toBeLessThan(NEAR);
        expect(Math.abs(a.grip2 - b.grip2)).toBeLessThan(NEAR);
      }
      checked += 1;
    }
    expect(checked).toBe(200);
  });

  it('makes every bot decision the mirror of the same decision on the mirrored board', () => {
    // The bot's misread table is indexed by slot and the mirror keeps slot indices, so the
    // two bots are handed the identical stream and must reach mirrored answers. A tie-break
    // written in board coordinates would return the same answer rather than the mirrored one
    // and fail here, which is exactly why this game has none.
    let checked = 0;
    for (let seed = 0; seed < 150; seed += 1) {
      const forward = scatteredBoard(new Rng(seed * 104729 + 7));
      const mirrored = mirrorState(forward);
      for (const tier of TIERS) {
        const a = createBotState();
        const b = createBotState();
        botLook(forward, 'p1', tier, a, new Rng(99));
        botLook(mirrored, 'p2', tier, b, new Rng(99));
        expect(Math.abs(BOARD_WIDTH - a.targetX - b.targetX)).toBeLessThan(NEAR);
        expect(Math.abs(BOARD_HEIGHT - a.targetY - b.targetY)).toBeLessThan(NEAR);
        checked += 1;
      }
    }
    expect(checked).toBe(450);
  });

  it('settles the note in the exact middle without naming a seat', () => {
    // The centre note is the threshold this game lands on *by construction*: stationary, at
    // the exact centre, equidistant from two hands that start at mirrored positions. Two
    // palms that complete a grip on the same step take nothing, both grips reset, and the
    // board is left symmetric — a seeded coin or a "nearest hand" rule would both have handed
    // it to a named seat and broken every mirror above.
    const state = createState();
    resetState(state, new Rng(5));
    const note = state.notes[CENTRE_NOTE];
    expect(note).toBeDefined();
    if (note === undefined) return;
    state.p1Hand.x = SAFE_X;
    state.p1Hand.y = MID_Y;
    state.p2Hand.x = SAFE_X;
    state.p2Hand.y = MID_Y;
    expect(contested(state, note)).toBe(true);

    for (let k = 0; k < 200; k += 1) {
      state.p1Hand.x = SAFE_X;
      state.p1Hand.y = MID_Y;
      state.p2Hand.x = SAFE_X;
      state.p2Hand.y = MID_Y;
      step(state, STEP);
      expect(note.carriedBy).toBeNull();
      expect(note.banked).toBe(false);
    }
    expect(state.p1).toBe(0);
    expect(state.p2).toBe(0);
  });
});

/* -------------------------------------------------------------- the hand */

describe('a hand', () => {
  it('moves at the same speed for a slammed finger and a held key', () => {
    // The pointer names a place and the keys name a direction, and both go through the one
    // rate limiter. A thumb that jumps to the far rail cannot drag the hand there faster than
    // a key held down, which is the whole of rule 10 for this game.
    //
    // The two are aimed along the *same* line so that only the rate is being compared: the
    // corner below sits exactly 480 units left of and 480 above the corner the hands start
    // in, which is the direction a held W and a held A together name.
    const startX = HAND_MAX_X;
    const startY = handMinYOf('p1') + (HAND_MAX_X - HAND_MIN_X);
    const finger = createState();
    const key = createState();
    resetState(finger, new Rng(1));
    resetState(key, new Rng(1));
    for (const state of [finger, key]) {
      state.p1Hand.x = startX;
      state.p1Hand.y = startY;
    }
    let travelled = 0;
    for (let k = 0; k < 60; k += 1) {
      const beforeX = finger.p1Hand.x;
      const beforeY = finger.p1Hand.y;
      // The finger asks for the corner outright; the key asks for a direction and no more.
      driveHand(finger, 'p1', HAND_MIN_X, handMinYOf('p1'), STEP);
      const hand = key.p1Hand;
      driveHand(key, 'p1', hand.x - HAND_SPEED, hand.y - HAND_SPEED, STEP);
      expect(finger.p1Hand.x).toBeCloseTo(key.p1Hand.x, 9);
      expect(finger.p1Hand.y).toBeCloseTo(key.p1Hand.y, 9);
      const dx = finger.p1Hand.x - beforeX;
      const dy = finger.p1Hand.y - beforeY;
      travelled = Math.sqrt(dx * dx + dy * dy);
      // And the rate is the hand's own speed, not the length of whatever was pointed at.
      expect(travelled).toBeCloseTo(speedOf(0) * STEP, 9);
    }
    expect(travelled).toBeGreaterThan(0);
  });

  it('never leaves its own reach, however far past it the finger points', () => {
    for (const seat of ['p1', 'p2'] as const) {
      const state = createState();
      resetState(state, new Rng(2));
      for (let k = 0; k < 600; k += 1) {
        driveHand(state, seat, -5000, k % 2 === 0 ? -5000 : 5000, STEP);
        const hand = handOf(state, seat);
        expect(hand.x).toBeGreaterThanOrEqual(HAND_MIN_X);
        expect(hand.x).toBeLessThanOrEqual(HAND_MAX_X);
        expect(hand.y).toBeGreaterThanOrEqual(handMinYOf(seat));
        expect(hand.y).toBeLessThanOrEqual(handMaxYOf(seat));
      }
    }
  });

  it('slows by exactly the drag for every note in it, and never stalls', () => {
    expect(speedOf(0)).toBe(HAND_SPEED);
    for (let carried = 1; carried <= MAX_CARRY; carried += 1) {
      expect(speedOf(carried)).toBe(HAND_SPEED - CARRY_DRAG * carried);
      expect(speedOf(carried)).toBeLessThan(speedOf(carried - 1));
      // The clamp inside speedOf is a guard, not a behaviour: the carry cap keeps it out.
      expect(speedOf(carried)).toBeGreaterThan(1);
    }
    // A full hand is two and a half times slower than an empty one. That is the whole trade.
    expect(speedOf(0) / speedOf(MAX_CARRY)).toBeGreaterThan(2);
  });

  it('arrives when the bot says it will, to the bit', () => {
    // Issue #2465: a bot that reasons analytically about a quantity the simulation integrates
    // numerically is wrong in a way nothing measures. `botLook` costs a trip as
    // `distance / speedOf(carry)`, and `driveHand` moves along the straight line at exactly
    // that speed, so the prediction and the outcome are the same number rather than nearly.
    for (let seed = 0; seed < 40; seed += 1) {
      const rng = new Rng(seed * 31 + 5);
      const state = createState();
      resetState(state, new Rng(1));
      const hand = state.p1Hand;
      hand.x = clampHandX(HAND_MIN_X + rng.float() * (HAND_MAX_X - HAND_MIN_X));
      hand.y = clampHandY('p1', rng.float() * BOARD_HEIGHT);
      const targetX = clampHandX(HAND_MIN_X + rng.float() * (HAND_MAX_X - HAND_MIN_X));
      const targetY = clampHandY('p1', rng.float() * BOARD_HEIGHT);
      const dx = targetX - hand.x;
      const dy = targetY - hand.y;
      const predicted = Math.sqrt(dx * dx + dy * dy) / speedOf(0);

      let seconds = 0;
      for (let k = 0; k < 2000; k += 1) {
        driveHand(state, 'p1', targetX, targetY, STEP);
        seconds += STEP;
        if (hand.x === targetX && hand.y === targetY) break;
      }
      // The simulation lands on the target during the step the prediction falls inside, so
      // the two agree to within one step and never drift apart.
      expect(seconds - predicted).toBeGreaterThanOrEqual(0);
      expect(seconds - predicted).toBeLessThan(STEP + 1e-12);
    }
  });
});

/* ------------------------------------------------------------- grips */

/** Put a hand on a note and hold it there for `seconds`, driving nothing else. */
function hold(state: State, seat: SeatId, note: Note, seconds: number): void {
  const hand = handOf(state, seat);
  const steps = Math.round(seconds / STEP);
  for (let k = 0; k < steps; k += 1) {
    hand.x = clampHandX(note.x);
    hand.y = clampHandY(seat, note.y);
    step(state, STEP);
  }
}

/** A board with exactly one loose note, at a place both hands can reach. */
function oneNote(y = MID_Y): { state: State; note: Note } {
  const state = createState();
  resetState(state, new Rng(4));
  for (const note of state.notes) {
    note.banked = true;
    note.vx = 0;
    note.vy = 0;
  }
  const note = state.notes[0];
  if (note === undefined) throw new Error('unreachable');
  note.banked = false;
  note.value = 2;
  note.x = SAFE_X;
  note.y = y;
  state.inPlay = 1;
  return { state, note };
}

describe('a grip', () => {
  it('needs a dwell: a palm that passes over a note does not take it', () => {
    const { state, note } = oneNote();
    const hand = state.p1Hand;
    // Sweeping straight across the note at full speed spends well under GRIP_SECONDS on it.
    hand.x = HAND_MIN_X;
    hand.y = MID_Y;
    for (let k = 0; k < 600; k += 1) {
      driveHand(state, 'p1', HAND_MAX_X, MID_Y, STEP);
      step(state, STEP);
    }
    const crossing = (2 * GRAB_RADIUS) / HAND_SPEED;
    expect(crossing).toBeLessThan(GRIP_SECONDS);
    expect(note.carriedBy).toBeNull();
    expect(state.p1Hand.carryCount).toBe(0);
  });

  it('lifts once the palm has held it long enough', () => {
    const { state, note } = oneNote();
    hold(state, 'p1', note, GRIP_SECONDS - 2 * STEP);
    expect(note.carriedBy).toBeNull();
    hold(state, 'p1', note, 3 * STEP);
    expect(note.carriedBy).toBe('p1');
    expect(state.p1Hand.carryCount).toBe(1);
    expect(state.p1Hand.carryValue).toBe(2);
    // Still in play: a note in a hand is not a note in a safe.
    expect(state.inPlay).toBe(1);
  });

  it('is lost faster than it is gained once the palm leaves', () => {
    const { state, note } = oneNote();
    hold(state, 'p1', note, GRIP_SECONDS * 0.8);
    const held = note.grip1;
    expect(held).toBeGreaterThan(0);
    state.p1Hand.x = HAND_MIN_X;
    state.p1Hand.y = handMaxYOf('p1');
    step(state, STEP);
    expect(note.grip1).toBeCloseTo(held - STEP * GRIP_DECAY, 9);
    for (let k = 0; k < 60; k += 1) step(state, STEP);
    expect(note.grip1).toBe(0);
  });

  it('goes to whichever palm arrived first when the two are not level', () => {
    const { state, note } = oneNote();
    // Seat one has been on it for two steps before seat two arrives.
    state.p1Hand.x = SAFE_X;
    state.p1Hand.y = clampHandY('p1', note.y);
    step(state, STEP);
    step(state, STEP);
    for (let k = 0; k < 200; k += 1) {
      state.p1Hand.x = SAFE_X;
      state.p1Hand.y = clampHandY('p1', note.y);
      state.p2Hand.x = SAFE_X;
      state.p2Hand.y = clampHandY('p2', note.y);
      step(state, STEP);
      if (note.carriedBy !== null) break;
    }
    expect(note.carriedBy).toBe('p1');
  });

  it('takes nothing at all when both palms complete together', () => {
    const { state, note } = oneNote();
    for (let k = 0; k < 400; k += 1) {
      state.p1Hand.x = SAFE_X;
      state.p1Hand.y = clampHandY('p1', note.y);
      state.p2Hand.x = SAFE_X;
      state.p2Hand.y = clampHandY('p2', note.y);
      step(state, STEP);
      expect(note.carriedBy).toBeNull();
      // The reset is what stops the deadlock quietly becoming a lift for one of them.
      expect(note.grip1).toBe(note.grip2);
      expect(note.grip1).toBeLessThan(GRIP_SECONDS);
    }
  });

  it('does not start at all on a palm that is already full', () => {
    const { state, note } = oneNote();
    state.p1Hand.carryCount = MAX_CARRY;
    hold(state, 'p1', note, GRIP_SECONDS * 3);
    expect(note.carriedBy).toBeNull();
    expect(note.grip1).toBe(0);
  });

  it('covers every note under the palm at once — all the fingers of your hand', () => {
    const state = createState();
    resetState(state, new Rng(9));
    for (const note of state.notes) {
      note.banked = true;
      note.vx = 0;
      note.vy = 0;
    }
    // Four notes tucked inside one palm, which is what the catalogue row's phrase became.
    const chosen: Note[] = [];
    for (let i = 0; i < 4; i += 1) {
      const note = state.notes[i];
      if (note === undefined) continue;
      note.banked = false;
      note.value = 1;
      note.x = SAFE_X + (i - 1.5) * 8;
      note.y = MID_Y + (i % 2 === 0 ? 6 : -6);
      chosen.push(note);
    }
    state.inPlay = chosen.length;
    const first = chosen[0];
    if (first === undefined) throw new Error('unreachable');
    hold(state, 'p1', first, GRIP_SECONDS + 2 * STEP);
    for (const note of chosen) expect(note.carriedBy).toBe('p1');
    expect(state.p1Hand.carryCount).toBe(4);
  });
});

/* ------------------------------------------------------------- banking */

describe('a safe', () => {
  it('takes everything a hand is carrying the moment it is entered', () => {
    const { state, note } = oneNote(handMaxYOf('p1') - SAFE_RADIUS - GRAB_RADIUS - 20);
    hold(state, 'p1', note, GRIP_SECONDS + 2 * STEP);
    expect(note.carriedBy).toBe('p1');
    for (let k = 0; k < 600; k += 1) {
      driveHand(state, 'p1', SAFE_X, safeYOf('p1'), STEP);
      step(state, STEP);
      if (state.p1 > 0) break;
    }
    expect(inSafe(state.p1Hand, 'p1')).toBe(true);
    expect(state.p1).toBe(2);
    expect(state.p1Hand.carryCount).toBe(0);
    expect(state.p1Hand.banks).toBe(1);
    expect(state.p1Hand.lastBank).toBe(2);
    expect(note.banked).toBe(true);
    expect(state.inPlay).toBe(0);
  });

  it('is the same circle for both seats, drawn differently and tested identically', () => {
    for (const seat of ['p1', 'p2'] as const) {
      const hand: Hand = {
        x: SAFE_X,
        y: safeYOf(seat),
        targetX: 0,
        targetY: 0,
        carryCount: 0,
        carryValue: 0,
        banks: 0,
        lastBank: 0,
      };
      expect(inSafe(hand, seat)).toBe(true);
      hand.y = safeYOf(seat) + (seat === 'p1' ? -1 : 1) * (SAFE_RADIUS + 1);
      expect(inSafe(hand, seat)).toBe(false);
    }
  });

  it('never takes a note the other seat is carrying', () => {
    const { state, note } = oneNote();
    note.carriedBy = 'p2';
    state.p2Hand.carryCount = 1;
    state.p2Hand.carryValue = note.value;
    state.p1Hand.x = SAFE_X;
    state.p1Hand.y = safeYOf('p1');
    state.p1Hand.carryCount = 0;
    // Seat two is out on the table, so nothing it holds is banked this step either.
    state.p2Hand.x = SAFE_X;
    state.p2Hand.y = handMaxYOf('p2');
    step(state, STEP);
    expect(state.p1).toBe(0);
    expect(note.carriedBy).toBe('p2');
  });
});

/* --------------------------------------------------------- termination */

describe('termination', () => {
  it('ends the moment the table is empty, and never in a draw when it does', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const state = createState();
      resetState(state, new Rng(seed * 977 + 1));
      const p1 = createBotState();
      const p2 = createBotState();
      const r1 = new Rng(seed * 13 + 2);
      const r2 = new Rng(seed * 17 + 3);
      // No frame cap at all: a match that could not end hangs the suite rather than passing
      // quietly. MATCH_SECONDS is the only thing that can stop this loop.
      for (;;) {
        botStep(state, 'p1', 'easy', p1, r1, STEP);
        botStep(state, 'p2', 'easy', p2, r2, STEP);
        step(state, STEP);
        if (state.winner !== null) break;
      }
      expect(state.clock).toBeLessThanOrEqual(MATCH_SECONDS + STEP);
      if (state.inPlay === 0) {
        expect(state.p1 + state.p2).toBe(PILE_VALUE);
        expect(state.winner).not.toBe('draw');
      }
    }
  });

  it('ends on the clock, as a draw, when nobody ever touches the table', () => {
    const state = createState();
    resetState(state, new Rng(7));
    let steps = 0;
    while (state.winner === null) {
      step(state, STEP);
      steps += 1;
      expect(steps).toBeLessThan(60 * 600);
    }
    expect(state.winner).toBe('draw');
    expect(state.clock).toBeGreaterThanOrEqual(MATCH_SECONDS);
    expect(secondsLeft(state)).toBe(0);
  });

  it('stops simulating once it has a winner', () => {
    const state = createState();
    resetState(state, new Rng(7));
    while (state.winner === null) step(state, STEP);
    const clock = state.clock;
    const x = state.notes[0]?.x;
    step(state, STEP);
    step(state, STEP);
    expect(state.clock).toBe(clock);
    expect(state.notes[0]?.x).toBe(x);
  });

  it('keeps the clock bar honest', () => {
    const state = createState();
    resetState(state, new Rng(7));
    expect(secondsLeft(state)).toBe(MATCH_SECONDS);
    for (let k = 0; k < 600; k += 1) step(state, STEP);
    expect(secondsLeft(state)).toBeCloseTo(MATCH_SECONDS - 10, 6);
  });
});

/* ------------------------------------------------------------- the bot */

/** One bot-against-bot match, driven from the rules with two named streams. */
function duel(
  tableSeed: number,
  aSeed: number,
  bSeed: number,
  t1: BotDifficulty,
  t2: BotDifficulty,
): State {
  const state = createState();
  resetState(state, new Rng(tableSeed));
  const p1 = createBotState();
  const p2 = createBotState();
  const r1 = new Rng(aSeed);
  const r2 = new Rng(bSeed);
  for (let k = 0; k < 60 * 600 && state.winner === null; k += 1) {
    botStep(state, 'p1', t1, p1, r1, STEP);
    botStep(state, 'p2', t2, p2, r2, STEP);
    step(state, STEP);
  }
  return state;
}

describe('the bot', () => {
  it('draws exactly one value per note slot per look, whatever the table holds', () => {
    // A busy table and an empty one must leave a seat in the same place in its own stream, or
    // a tier that happens to see more notes would be dealt a different match.
    const busy = createState();
    resetState(busy, new Rng(3));
    const empty = createState();
    resetState(empty, new Rng(3));
    for (const note of empty.notes) note.banked = true;
    empty.inPlay = 0;

    for (const tier of TIERS) {
      const a = new Rng(42);
      const b = new Rng(42);
      botLook(busy, 'p1', tier, createBotState(), a);
      botLook(empty, 'p1', tier, createBotState(), b);
      expect(a.next()).toBe(b.next());
      expect(a.next()).toBe(b.next());
    }
  });

  it('plays a bit-identical match whichever seat is polled first', () => {
    // Each seat's bot has its own generator, so the poll order is not observable at all.
    for (const tier of TIERS) {
      for (let seed = 0; seed < 12; seed += 1) {
        const forward = createState();
        const reversed = createState();
        resetState(forward, new Rng(seed * 131 + 5));
        resetState(reversed, new Rng(seed * 131 + 5));
        const f1 = createBotState();
        const f2 = createBotState();
        const b1 = createBotState();
        const b2 = createBotState();
        const fr1 = new Rng(seed + 1);
        const fr2 = new Rng(seed + 2);
        const br1 = new Rng(seed + 1);
        const br2 = new Rng(seed + 2);
        for (let k = 0; k < 900; k += 1) {
          botStep(forward, 'p1', tier, f1, fr1, STEP);
          botStep(forward, 'p2', tier, f2, fr2, STEP);
          step(forward, STEP);
          botStep(reversed, 'p2', tier, b2, br2, STEP);
          botStep(reversed, 'p1', tier, b1, br1, STEP);
          step(reversed, STEP);
        }
        expect(discrete(forward)).toBe(discrete(reversed));
        expect(forward.p1Hand.x).toBe(reversed.p1Hand.x);
        expect(forward.p2Hand.y).toBe(reversed.p2Hand.y);
      }
    }
  });

  it('is deterministic: the same seeds replay the same match', () => {
    const a = duel(101, 202, 303, 'normal', 'normal');
    const b = duel(101, 202, 303, 'normal', 'normal');
    expect(discrete(a)).toBe(discrete(b));
    expect(a.clock).toBe(b.clock);
  });

  it('turns for home once its hand is full enough, and empties it', () => {
    const state = duel(55, 66, 77, 'normal', 'normal');
    expect(state.p1Hand.banks).toBeGreaterThan(1);
    expect(state.p2Hand.banks).toBeGreaterThan(1);
    // HOME_AT is a constant rather than a tier knob: see SPEC.md for the sweep that shows the
    // optimum sits in the same place for all three tiers.
    expect(HOME_AT).toBeLessThan(MAX_CARRY);
  });

  it('climbs: hard beats normal beats easy, from both seat orders', () => {
    const measure = (strong: BotDifficulty, weak: BotDifficulty): number => {
      let wins = 0;
      let decided = 0;
      for (let seed = 0; seed < 24; seed += 1) {
        const t = 5000 + seed * 131;
        const a = 900001 + seed * 7919;
        const b = 31 + seed * 104729;
        const asOne = duel(t, a, b, strong, weak);
        if (asOne.winner === 'p1') wins += 1;
        if (asOne.winner !== 'draw' && asOne.winner !== null) decided += 1;
        const asTwo = duel(t, b, a, weak, strong);
        if (asTwo.winner === 'p2') wins += 1;
        if (asTwo.winner !== 'draw' && asTwo.winner !== null) decided += 1;
      }
      return wins / decided;
    };
    // Measured over hundreds of seeds at 76%, 72% and 87%; the bar here is loose enough that
    // 48 matches cannot trip it by luck and tight enough that a broken tier cannot pass.
    expect(measure('hard', 'normal')).toBeGreaterThan(0.6);
    expect(measure('normal', 'easy')).toBeGreaterThan(0.6);
    expect(measure('hard', 'easy')).toBeGreaterThan(0.72);
  });

  it('is given nothing a person cannot see', () => {
    // Rule 6, asserted on the shape of the profiles rather than in prose: the only two things
    // a tier differs by are how often it looks and how often it misreads a face value. There
    // is no speed multiplier, no reach bonus and no knowledge of the other hand's target.
    for (const tier of TIERS) {
      const profile = BOT_PROFILES[tier];
      expect(Object.keys(profile).sort()).toEqual(['misreadChance', 'thinkSeconds']);
      expect(profile.thinkSeconds).toBeGreaterThan(0);
      expect(profile.misreadChance).toBeGreaterThanOrEqual(0);
    }
    expect(BOT_PROFILES.easy.thinkSeconds).toBeGreaterThan(BOT_PROFILES.normal.thinkSeconds);
    expect(BOT_PROFILES.normal.thinkSeconds).toBeGreaterThan(BOT_PROFILES.hard.thinkSeconds);
    expect(BOT_PROFILES.easy.misreadChance).toBeGreaterThan(BOT_PROFILES.normal.misreadChance);
    expect(BOT_PROFILES.normal.misreadChance).toBeGreaterThan(BOT_PROFILES.hard.misreadChance);
  });

  it('never targets a place its own hand cannot stand', () => {
    for (const seat of ['p1', 'p2'] as const) {
      for (let seed = 0; seed < 40; seed += 1) {
        const state = scatteredBoard(new Rng(seed * 97 + 11));
        const bot = createBotState();
        botLook(state, seat, 'hard', bot, new Rng(seed));
        expect(bot.targetX).toBeGreaterThanOrEqual(HAND_MIN_X);
        expect(bot.targetX).toBeLessThanOrEqual(HAND_MAX_X);
        expect(bot.targetY).toBeGreaterThanOrEqual(handMinYOf(seat));
        expect(bot.targetY).toBeLessThanOrEqual(handMaxYOf(seat));
      }
    }
  });
});

/* --------------------------------------------------------- allocation */

describe('a step', () => {
  it('adds nothing to the board it was handed', () => {
    // Rule 5. The note array is built once by createState and only ever written in place, so
    // a step that grew it — a replacement, a particle, a queued event — would show up here.
    const state = createState();
    resetState(state, new Rng(3));
    const notes = state.notes;
    const p1 = createBotState();
    const p2 = createBotState();
    const misreadP1 = p1.misread;
    const r1 = new Rng(1);
    const r2 = new Rng(2);
    for (let k = 0; k < 2000 && state.winner === null; k += 1) {
      botStep(state, 'p1', 'hard', p1, r1, STEP);
      botStep(state, 'p2', 'hard', p2, r2, STEP);
      step(state, STEP);
      expect(state.notes).toBe(notes);
      expect(state.notes.length).toBe(NOTE_COUNT);
      expect(p1.misread).toBe(misreadP1);
      expect(p1.misread.length).toBe(NOTE_COUNT);
    }
  });

  it('never lets a note leave the table or a score go backwards', () => {
    const state = createState();
    resetState(state, new Rng(21));
    const p1 = createBotState();
    const p2 = createBotState();
    const r1 = new Rng(5);
    const r2 = new Rng(6);
    let lastP1 = 0;
    let lastP2 = 0;
    while (state.winner === null) {
      botStep(state, 'p1', 'normal', p1, r1, STEP);
      botStep(state, 'p2', 'normal', p2, r2, STEP);
      step(state, STEP);
      expect(state.p1).toBeGreaterThanOrEqual(lastP1);
      expect(state.p2).toBeGreaterThanOrEqual(lastP2);
      lastP1 = state.p1;
      lastP2 = state.p2;
      for (const note of state.notes) {
        if (note.banked || note.carriedBy !== null) continue;
        expect(note.x).toBeGreaterThanOrEqual(NOTE_MIN_X - 1e-9);
        expect(note.x).toBeLessThanOrEqual(NOTE_MAX_X + 1e-9);
        expect(note.y).toBeGreaterThanOrEqual(NOTE_MIN_Y - 1e-9);
        expect(note.y).toBeLessThanOrEqual(NOTE_MAX_Y + 1e-9);
      }
    }
    expect(state.p1 + state.p2).toBeLessThanOrEqual(PILE_VALUE);
  });

  it('leaves a palm test that is exact under the half-turn', () => {
    // `dx*dx + dy*dy <= r*r` with both components negated is bitwise identical, which is why
    // the mirror tests above can assert discrete outcomes exactly rather than approximately.
    for (let seed = 0; seed < 200; seed += 1) {
      const rng = new Rng(seed + 1);
      const hand = { x: rng.float() * BOARD_WIDTH, y: rng.float() * BOARD_HEIGHT } as Hand;
      const note = { x: rng.float() * BOARD_WIDTH, y: rng.float() * BOARD_HEIGHT } as Note;
      const flipped = { x: BOARD_WIDTH - hand.x, y: BOARD_HEIGHT - hand.y } as Hand;
      const flippedNote = { x: BOARD_WIDTH - note.x, y: BOARD_HEIGHT - note.y } as Note;
      expect(palmHas(flipped, flippedNote)).toBe(palmHas(hand, note));
    }
  });
});
