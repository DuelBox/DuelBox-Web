import type { Rng, SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { Outcome, WinCondition } from '@duelbox/game-sdk';

/**
 * Money Grabber as pure rules: one table with a finite pile of notes drifting on it, a safe
 * at each end, and one hand per seat that sweeps notes up and carries them home.
 *
 * No rendering, no wall clock, no DOM. The game, both bots and the balance harness all drive
 * this file, so there is exactly one definition of what a palm picks up.
 *
 * Four structural choices are worth reading before the numbers, because each of them is
 * load-bearing for something a test asserts:
 *
 * 1. **Steering is the whole interaction.** There is no action, no press and no drag origin.
 *    A hand chases a place at a rate, which is the one gesture a thumb, a mouse, a trackpad
 *    and a key all express identically — see SPEC.md, "The multi-touch problem, and what was
 *    done about it". Nothing here reads `actionPressed`, `actionHeld` or `holdSeconds`.
 * 2. **A palm takes everything under it at once.** The catalogue row's "all the fingers of
 *    your hand" survives as a *radius* rather than as ten pointers: every loose note inside
 *    {@link GRAB_RADIUS} grips at the same time and lifts together. One pointer, many notes.
 * 3. **Carrying costs speed** ({@link CARRY_DRAG}), and the two hands race for the same notes
 *    in the middle of the table. So greed and tempo are the same axis: the fuller hand loses
 *    the next race. That is the duel, and it is why the contested band exists.
 * 4. **A dead heat is settled by nobody.** Two palms that complete a grip on the same step
 *    knock the note out of each other's hands and both grips reset. There is no tie-break in
 *    board coordinates and no seeded coin: either would be a seat asymmetry on a board whose
 *    opening layout is its own half-turn image (see `rules.test.ts`, "mirror symmetry").
 */

/* ------------------------------------------------------------------ the table */

export const BOARD_WIDTH = 600;
export const BOARD_HEIGHT = 900;

/**
 * The centre line. Everything in this file is placed as a mirror pair about it, so that the
 * half-turn which maps one seat's view onto the other's maps the board onto itself.
 */
export const MID_Y = BOARD_HEIGHT / 2;

/** The felt. Everything below is in these logical units and never in pixels (rule 8). */
export const TABLE_LEFT = 30;
export const TABLE_RIGHT = 570;
export const TABLE_TOP = 150;
export const TABLE_BOTTOM = 750;

/** A note's own radius, for the one circular test that decides whether a palm has it. */
export const NOTE_RADIUS = 18;

/** Where a note's centre may sit. Both spans are symmetric about the centre of the board. */
export const NOTE_MIN_X = TABLE_LEFT + NOTE_RADIUS;
export const NOTE_MAX_X = TABLE_RIGHT - NOTE_RADIUS;
export const NOTE_MIN_Y = TABLE_TOP + NOTE_RADIUS;
export const NOTE_MAX_Y = TABLE_BOTTOM - NOTE_RADIUS;

/**
 * The pile: twelve mirrored pairs and one note in the exact middle.
 *
 * The odd note is not decoration. Any number of mirrored pairs of equal value totals an even
 * number, so two seats that split the table evenly would tie every time — which is how
 * `paint-fight` came to be recorded as unbalanceable rather than balanced. The centre note is
 * worth 3, so the pile totals an **odd** number: once every note is banked the two scores
 * cannot be equal. A draw is only reachable by the clock, which is where a draw belongs.
 *
 * It also has to be stationary, and that is forced rather than chosen: a velocity that maps
 * to itself under the half-turn is the zero one.
 */
export const NOTE_PAIRS = 16;
export const NOTE_COUNT = NOTE_PAIRS * 2 + 1;
export const CENTRE_NOTE = NOTE_COUNT - 1;
export const CENTRE_VALUE = 3;

/**
 * The face value of a slot. Both notes of a pair share one, so the pile is symmetric.
 *
 * Fixed by slot rather than drawn, for the reason Happy Hippos fixes its stock: a pile whose
 * composition changed from match to match would move every number in SPEC.md, and a pile that
 * refilled itself would hand the leader a different table from the one behind.
 */
export function valueOfSlot(slot: number): number {
  if (slot >= CENTRE_NOTE) return CENTRE_VALUE;
  return 1 + (Math.floor(slot / 2) % 3);
}

/**
 * Total face value on the table at the start of every match. Summed rather than written down,
 * so it cannot drift away from {@link NOTE_PAIRS}, and asserted odd by `rules.test.ts`.
 */
export const PILE_VALUE = ((): number => {
  let total = 0;
  for (let i = 0; i < NOTE_COUNT; i += 1) total += valueOfSlot(i);
  return total;
})();

/** Drift speed. Slow enough to read a value off a note that is moving. */
export const NOTE_SPEED_MIN = 20;
export const NOTE_SPEED_MAX = 50;

/* ------------------------------------------------------------------ the safes */

/**
 * Each seat's safe: a circle at its own end of the board, entered rather than aimed at.
 *
 * Both seats are tested with the identical circular predicate. Seat one's is *drawn* as a
 * round vault door and seat two's as a square one, at equal area, so the two silhouettes
 * differ and nothing about the geometry does — the same device Happy Hippos uses for its two
 * kinds of ball. Rule 7 is a drawing decision here and never a rules decision.
 */
export const SAFE_RADIUS = 76;
export const SAFE_X = BOARD_WIDTH / 2;
/**
 * Far enough in that the whole vault door fits on the board.
 *
 * 824 rather than 840, and the radius 76 rather than 92, for one reason: seat one's safe is
 * drawn as a circle of the radius and seat two's as a square of the same *area*, so a centre
 * that let either spill past its own end of the board would clip the two by different amounts
 * and quietly make one of them the bigger object. At 824 the circle reaches exactly y = 900
 * and the square exactly y = 891, and neither is cut.
 *
 * The mouth still opens at y = 748, which is what decides how much of the felt a hand can
 * reach from inside its own safe, so the trip a note costs is unchanged.
 */
export const SAFE_P1_Y = 824;
export const SAFE_P2_Y = BOARD_HEIGHT - SAFE_P1_Y;

/* ------------------------------------------------------------------- the hands */

/** The palm. A note is gripped when its centre is inside {@link GRAB_RADIUS} of the hand. */
export const PALM_RADIUS = 34;
export const GRAB_RADIUS = PALM_RADIUS + NOTE_RADIUS;

/**
 * How far past the centre line a hand can reach.
 *
 * The band `MID_Y ± REACH` is the one place both hands can be on the same note, so it is
 * where every race is decided, and it is drawn as its own shade with a line at each edge.
 * At zero the table would be two private halves and nothing in this file's fourth structural
 * choice would ever run.
 */
export const REACH_PAST_MID = 96;

export const HAND_MIN_X = 60;
export const HAND_MAX_X = BOARD_WIDTH - HAND_MIN_X;

/** Seat one's hand lives between the far edge of the contested band and its own safe. */
export const HAND_P1_MIN_Y = MID_Y - REACH_PAST_MID;
export const HAND_P1_MAX_Y = SAFE_P1_Y;
export const HAND_P2_MIN_Y = BOARD_HEIGHT - HAND_P1_MAX_Y;
export const HAND_P2_MAX_Y = BOARD_HEIGHT - HAND_P1_MIN_Y;

/**
 * How fast an empty hand moves, in logical units a second, for a thumb and a key alike.
 *
 * A *rate*, never a set: a finger that jumps across the table moves the hand at exactly this
 * speed, which is what stops the pointer being a better instrument than the keyboard. A test
 * drives one hand with a finger slammed against the far wall and another with a key held down
 * and asserts they arrive together, to nine decimal places.
 */
export const HAND_SPEED = 300;

/**
 * Units a second lost per note carried. **This is the game's only real trade.**
 *
 * Six notes is 180 units a second, so a full hand moves at 120 against an empty hand's 300 —
 * it loses every race to the middle by a factor of two and a half. Sweeping one more note before turning for home is
 * therefore a bet on what the other seat is doing, which is what makes two people playing
 * this different from one person playing it.
 */
export const CARRY_DRAG = 30;

/** A hand holds this many notes and no more; a full palm grips nothing. */
export const MAX_CARRY = 6;

/**
 * Seconds a palm must stay on a note before it lifts.
 *
 * Without a dwell a sweep at full speed would rake the table clean in one pass, and two
 * palms would only ever be on one note by coincidence — the same reasoning as Happy Hippos'
 * hold at full stretch. With it, taking a note is a small commitment, and the contested band
 * has something in it to contest.
 */
export const GRIP_SECONDS = 0.45;

/** How fast a grip is lost once the palm leaves. Faster than it is gained, so brushing past
 * a row of notes on the way somewhere does not bank them all. */
export const GRIP_DECAY = 3;

/* --------------------------------------------------------------- the match */

/**
 * The clock, **ours**, and the backstop that guarantees this game can end.
 *
 * `manifest.roundSeconds` ends nothing anywhere in this repository. The pile is finite and
 * nothing replaces a banked note, so the ordinary end is the table running out; this is what
 * catches two seats who never bank anything, and two people who put the phone down.
 */
export const MATCH_SECONDS = 90;

/**
 * Highest bank when the table empties or the clock expires.
 *
 * `first-to` would have been wrong twice over: with a finite pile of 51 there is no target
 * that both a runaway win and a 26-25 finish can share, and a target above half the pile
 * makes most matches end on the clock anyway.
 */
export const WIN_CONDITION: WinCondition = { kind: 'highest-when-time-expires' };

/**
 * Scratch for {@link resolve}'s options.
 *
 * Hoisted and reused because the winner is judged on **every** step, and an object literal
 * there is a fresh allocation sixty times a second — exactly what rule 5 forbids.
 */
const resolveOptions = { timeExpired: false };

/* ------------------------------------------------------------------- the state */

export interface Note {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Face value, 1 to 3. Fixed by slot at construction and never redrawn. */
  value: number;
  /** The seat carrying it, or null while it is loose on the table. */
  carriedBy: SeatId | null;
  /** True once it is inside a safe. A banked note is out of play for good. */
  banked: boolean;
  /** Seconds seat one's palm has held it. Reset on a lift and on a dead heat. */
  grip1: number;
  grip2: number;
}

export interface Hand {
  x: number;
  y: number;
  /** Where its player is steering it. The hand closes on this at {@link speedOf}. */
  targetX: number;
  targetY: number;
  /** How many notes it is carrying, and what they are worth. Kept rather than counted. */
  carryCount: number;
  carryValue: number;
  /** Deposits made this match, and the value of the last one. Read by the feedback tally. */
  banks: number;
  lastBank: number;
}

export interface State {
  readonly notes: Note[];
  readonly p1Hand: Hand;
  readonly p2Hand: Hand;
  /** Banked value. Named `p1`/`p2` so the state is a `Tally` the SDK can judge directly. */
  p1: number;
  p2: number;
  /** Seconds of play. The only clock in the game. */
  clock: number;
  /** Notes not yet banked, carried ones included. The match ends when this reaches zero. */
  inPlay: number;
  winner: Outcome;
}

function createHand(y: number): Hand {
  return {
    x: SAFE_X,
    y,
    targetX: SAFE_X,
    targetY: y,
    carryCount: 0,
    carryValue: 0,
    banks: 0,
    lastBank: 0,
  };
}

function resetHand(hand: Hand, y: number): void {
  hand.x = SAFE_X;
  hand.y = y;
  hand.targetX = SAFE_X;
  hand.targetY = y;
  hand.carryCount = 0;
  hand.carryValue = 0;
  hand.banks = 0;
  hand.lastBank = 0;
}

/** A fresh state. Allocates, so call it from init() and never from a step. */
export function createState(): State {
  const notes: Note[] = [];
  for (let i = 0; i < NOTE_COUNT; i += 1) {
    notes.push({
      x: SAFE_X,
      y: MID_Y,
      vx: 0,
      vy: 0,
      value: valueOfSlot(i),
      carriedBy: null,
      banked: false,
      grip1: 0,
      grip2: 0,
    });
  }
  return {
    notes,
    p1Hand: createHand(SAFE_P1_Y),
    p2Hand: createHand(SAFE_P2_Y),
    p1: 0,
    p2: 0,
    clock: 0,
    inPlay: NOTE_COUNT,
    winner: null,
  };
}

export function handOf(state: Readonly<State>, seat: SeatId): Hand {
  return seat === 'p1' ? state.p1Hand : state.p2Hand;
}

/** The centre of a seat's own safe. */
export function safeYOf(seat: SeatId): number {
  return seat === 'p1' ? SAFE_P1_Y : SAFE_P2_Y;
}

export function handMinYOf(seat: SeatId): number {
  return seat === 'p1' ? HAND_P1_MIN_Y : HAND_P2_MIN_Y;
}

export function handMaxYOf(seat: SeatId): number {
  return seat === 'p1' ? HAND_P1_MAX_Y : HAND_P2_MAX_Y;
}

/**
 * How fast a hand carrying `carried` notes moves.
 *
 * Linear, and bounded below by {@link MAX_CARRY} rather than by a floor: six notes is 120
 * units a second and the clamp below never fires. It is here so that a future carry cap
 * cannot silently produce a hand that walks backwards.
 */
export function speedOf(carried: number): number {
  const speed = HAND_SPEED - CARRY_DRAG * carried;
  return speed < 1 ? 1 : speed;
}

/** The x a hand can actually stand at. Symmetric about the middle of the board. */
export function clampHandX(x: number): number {
  if (x < HAND_MIN_X) return HAND_MIN_X;
  if (x > HAND_MAX_X) return HAND_MAX_X;
  return x;
}

/** The y a seat's hand can actually stand at. The two ranges are exact half-turn images. */
export function clampHandY(seat: SeatId, y: number): number {
  const low = handMinYOf(seat);
  const high = handMaxYOf(seat);
  if (y < low) return low;
  if (y > high) return high;
  return y;
}

/**
 * Steer a hand toward a place, at its own speed and no faster.
 *
 * The target is clamped into the seat's own reach before anything else, so pointing at the
 * far end of the table parks the hand on its reach limit rather than doing nothing — and the
 * limit is an exact number both seats land on from opposite sides, which is what keeps a
 * mirrored pair of hands mirror-exact rather than nearly so.
 *
 * Motion is along the straight line to the target at `speedOf(carry)`, which is precisely the
 * model the bot costs a trip with. Issue #2465 is about a bot reasoning analytically about a
 * quantity the simulation integrates differently; here `distance / speed` is the simulation.
 */
export function driveHand(
  state: State,
  seat: SeatId,
  targetX: number,
  targetY: number,
  fixedDeltaSeconds: number,
): void {
  const hand = handOf(state, seat);
  const wantedX = clampHandX(targetX);
  const wantedY = clampHandY(seat, targetY);
  hand.targetX = wantedX;
  hand.targetY = wantedY;

  const dx = wantedX - hand.x;
  const dy = wantedY - hand.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const reach = speedOf(hand.carryCount) * fixedDeltaSeconds;
  if (distance <= reach || distance === 0) {
    hand.x = wantedX;
    hand.y = wantedY;
    return;
  }
  const share = reach / distance;
  hand.x += dx * share;
  hand.y += dy * share;
}

/** True when this palm is over this note. The identical test for both seats. */
export function palmHas(hand: Readonly<Hand>, note: Readonly<Note>): boolean {
  const dx = note.x - hand.x;
  const dy = note.y - hand.y;
  return dx * dx + dy * dy <= GRAB_RADIUS * GRAB_RADIUS;
}

/** True when a hand is far enough into its own safe to empty itself. */
export function inSafe(hand: Readonly<Hand>, seat: SeatId): boolean {
  const dx = hand.x - SAFE_X;
  const dy = hand.y - safeYOf(seat);
  return dx * dx + dy * dy <= SAFE_RADIUS * SAFE_RADIUS;
}

/**
 * Lay the table out for a fresh match, **in mirrored pairs**.
 *
 * Slot `2k + 1` is placed at the half-turn image of slot `2k` with its heading reversed and
 * the same face value, and slot 24 sits at the exact centre and does not move. So the opening
 * table is its own image under the rotation that turns one seat's view into the other's, and
 * neither seat can be dealt a better table, for any seed. A test asserts it to the bit for a
 * hundred seeds.
 *
 * Exactly four draws per pair, unconditionally, so the table's stream advances by a fixed
 * amount however the pile is shaped.
 */
export function resetState(state: State, rng: Rng): void {
  state.p1 = 0;
  state.p2 = 0;
  state.clock = 0;
  state.inPlay = NOTE_COUNT;
  state.winner = null;
  resetHand(state.p1Hand, SAFE_P1_Y);
  resetHand(state.p2Hand, SAFE_P2_Y);

  for (let i = 0; i < state.notes.length; i += 1) {
    const note = state.notes[i];
    if (note === undefined) continue;
    note.value = valueOfSlot(i);
    note.carriedBy = null;
    note.banked = false;
    note.grip1 = 0;
    note.grip2 = 0;
  }

  for (let pair = 0; pair < NOTE_PAIRS; pair += 1) {
    const x = NOTE_MIN_X + rng.float() * (NOTE_MAX_X - NOTE_MIN_X);
    const y = NOTE_MIN_Y + rng.float() * (NOTE_MAX_Y - NOTE_MIN_Y);
    const heading = rng.float() * Math.PI * 2;
    const speed = NOTE_SPEED_MIN + rng.float() * (NOTE_SPEED_MAX - NOTE_SPEED_MIN);
    const vx = Math.cos(heading) * speed;
    const vy = Math.sin(heading) * speed;

    const mine = state.notes[pair * 2];
    if (mine !== undefined) {
      mine.x = x;
      mine.y = y;
      mine.vx = vx;
      mine.vy = vy;
    }
    const theirs = state.notes[pair * 2 + 1];
    if (theirs !== undefined) {
      theirs.x = BOARD_WIDTH - x;
      theirs.y = BOARD_HEIGHT - y;
      theirs.vx = -vx;
      theirs.vy = -vy;
    }
  }

  const centre = state.notes[CENTRE_NOTE];
  if (centre !== undefined) {
    centre.x = SAFE_X;
    centre.y = MID_Y;
    centre.vx = 0;
    centre.vy = 0;
  }
}

function driftNote(note: Note, fixedDeltaSeconds: number): void {
  note.x += note.vx * fixedDeltaSeconds;
  note.y += note.vy * fixedDeltaSeconds;
  if (note.x < NOTE_MIN_X) {
    note.x = NOTE_MIN_X + (NOTE_MIN_X - note.x);
    note.vx = -note.vx;
  } else if (note.x > NOTE_MAX_X) {
    note.x = NOTE_MAX_X - (note.x - NOTE_MAX_X);
    note.vx = -note.vx;
  }
  if (note.y < NOTE_MIN_Y) {
    note.y = NOTE_MIN_Y + (NOTE_MIN_Y - note.y);
    note.vy = -note.vy;
  } else if (note.y > NOTE_MAX_Y) {
    note.y = NOTE_MAX_Y - (note.y - NOTE_MAX_Y);
    note.vy = -note.vy;
  }
}

function lift(state: State, note: Note, seat: SeatId): void {
  const hand = handOf(state, seat);
  note.carriedBy = seat;
  note.grip1 = 0;
  note.grip2 = 0;
  hand.carryCount += 1;
  hand.carryValue += note.value;
}

/**
 * Advance every grip on the table and lift whatever came free.
 *
 * A full palm grips nothing, so a hand at {@link MAX_CARRY} stops competing for the table
 * until it has been home — which is the other half of the carry trade.
 *
 * **Both seats' grips complete on the same step: nobody gets it.** There is no tie-break
 * here, deliberately. A rule written in board coordinates ("the hand nearer the safe") is
 * covariant under the half-turn and therefore decides nothing on a mirrored board, and a
 * seeded coin is worse — it names a seat, so a mirrored match would not come back mirrored.
 * Two palms knocking a note out of each other's hands is symmetric, terminating, and the one
 * answer that needs no extra state at all.
 */
function workGrips(state: State, fixedDeltaSeconds: number): void {
  const p1Hand = state.p1Hand;
  const p2Hand = state.p2Hand;
  const p1Free = p1Hand.carryCount < MAX_CARRY;
  const p2Free = p2Hand.carryCount < MAX_CARRY;
  const decay = fixedDeltaSeconds * GRIP_DECAY;

  for (let i = 0; i < state.notes.length; i += 1) {
    const note = state.notes[i];
    if (note === undefined || note.banked || note.carriedBy !== null) continue;

    if (p1Free && palmHas(p1Hand, note)) note.grip1 += fixedDeltaSeconds;
    else note.grip1 = note.grip1 > decay ? note.grip1 - decay : 0;

    if (p2Free && palmHas(p2Hand, note)) note.grip2 += fixedDeltaSeconds;
    else note.grip2 = note.grip2 > decay ? note.grip2 - decay : 0;

    const p1Got = note.grip1 >= GRIP_SECONDS;
    const p2Got = note.grip2 >= GRIP_SECONDS;
    if (p1Got && p2Got) {
      note.grip1 = 0;
      note.grip2 = 0;
    } else if (p1Got) {
      lift(state, note, 'p1');
    } else if (p2Got) {
      lift(state, note, 'p2');
    }
  }
}

/** Empty a hand into its own safe. Everything it carries is banked at once. */
function bank(state: State, seat: SeatId): void {
  const hand = handOf(state, seat);
  for (let i = 0; i < state.notes.length; i += 1) {
    const note = state.notes[i];
    if (note === undefined || note.carriedBy !== seat) continue;
    note.carriedBy = null;
    note.banked = true;
    state.inPlay -= 1;
  }
  if (seat === 'p1') state.p1 += hand.carryValue;
  else state.p2 += hand.carryValue;
  hand.banks += 1;
  hand.lastBank = hand.carryValue;
  hand.carryCount = 0;
  hand.carryValue = 0;
}

/** Carried notes travel with the palm holding them, so the state is coherent to draw from. */
function carryNotes(state: State): void {
  for (let i = 0; i < state.notes.length; i += 1) {
    const note = state.notes[i];
    if (note === undefined || note.carriedBy === null) continue;
    const hand = handOf(state, note.carriedBy);
    note.x = hand.x;
    note.y = hand.y;
  }
}

/**
 * One fixed step: the table drifts, then the grips are worked, then the safes are emptied,
 * then the verdict.
 *
 * The hands have already been driven by the caller — both of them, before anything here runs,
 * so neither seat is ever a step ahead of the other.
 */
export function step(state: State, fixedDeltaSeconds: number): void {
  if (state.winner !== null) return;

  for (let i = 0; i < state.notes.length; i += 1) {
    const note = state.notes[i];
    if (note === undefined || note.banked || note.carriedBy !== null) continue;
    driftNote(note, fixedDeltaSeconds);
  }

  workGrips(state, fixedDeltaSeconds);

  if (state.p1Hand.carryCount > 0 && inSafe(state.p1Hand, 'p1')) bank(state, 'p1');
  if (state.p2Hand.carryCount > 0 && inSafe(state.p2Hand, 'p2')) bank(state, 'p2');

  carryNotes(state);

  state.clock += fixedDeltaSeconds;
  resolveOptions.timeExpired = state.inPlay === 0 || state.clock >= MATCH_SECONDS;
  state.winner = resolve(WIN_CONDITION, state, resolveOptions);
}

export function winnerOf(state: Readonly<State>): Outcome {
  return state.winner;
}

/** Seconds of play left, for the bar on the side margins. Never negative. */
export function secondsLeft(state: Readonly<State>): number {
  const left = MATCH_SECONDS - state.clock;
  return left < 0 ? 0 : left;
}

/** True when both palms are on this note and neither has taken it. Drawn as a clash. */
export function contested(state: Readonly<State>, note: Readonly<Note>): boolean {
  if (note.banked || note.carriedBy !== null) return false;
  return (
    state.p1Hand.carryCount < MAX_CARRY &&
    state.p2Hand.carryCount < MAX_CARRY &&
    palmHas(state.p1Hand, note) &&
    palmHas(state.p2Hand, note)
  );
}

/* ------------------------------------------------------------------- the bot */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Seconds between looks at the table. Everything a bot does between two looks it does on
   * the older picture, so a note that drifted into reach half a second ago is invisible to it
   * until it looks again. This is the game's reaction time.
   */
  readonly thinkSeconds: number;
  /**
   * Chance of reading one note's face value wrong, drawn afresh at every look, per slot.
   *
   * Reading the table is the skill this game asks for — which of the notes in front of you is
   * worth the detour — so it is the skill the ladder is built from. A misread note reads as
   * the next value up, wrapping 3 back to 1, which costs exactly one draw per slot and keeps
   * a look's window in the bot's own stream a fixed size.
   */
  readonly misreadChance: number;
}

/**
 * Three tiers, two knobs, both measured rather than guessed. SPEC.md carries both sweeps and
 * the third knob that was written, swept and turned into a constant because it was not
 * monotone.
 *
 * No tier is given a note's velocity, the other hand's target, or anything about a note it
 * cannot see (rule 6). Every number a bot uses is on the table in front of a player.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { thinkSeconds: 0.34, misreadChance: 0.34 },
  normal: { thinkSeconds: 0.2, misreadChance: 0.16 },
  hard: { thinkSeconds: 0.1, misreadChance: 0.04 },
});

/**
 * How full a hand has to be before a bot turns for home, for every tier alike.
 *
 * **Greed is not a difficulty axis in this game, and the sweep in SPEC.md is the only way
 * that could have been found out.** It is strongly non-monotone: a bot that banks every note
 * on its own and a bot that fills all eight slots are both far worse than one in the middle,
 * and the optimum sits in the same place for all three tiers. Built as a tier knob it would
 * have handicapped `hard` past the optimum while `normal` sat on it — which is exactly what
 * happened to Happy Hippos' patience knob. It is a fact about the table, so it is a constant.
 */
export const HOME_AT = 4;

export interface BotState {
  targetX: number;
  targetY: number;
  /** Counts down to the next look. */
  thinkSeconds: number;
  /** Whether this look reads slot `i`'s value wrongly. One entry per note slot. */
  readonly misread: boolean[];
}

export function createBotState(): BotState {
  return {
    targetX: SAFE_X,
    targetY: MID_Y,
    thinkSeconds: 0,
    misread: new Array<boolean>(NOTE_COUNT).fill(false),
  };
}

export function resetBotState(bot: BotState): void {
  bot.targetX = SAFE_X;
  bot.targetY = MID_Y;
  bot.thinkSeconds = 0;
  for (let i = 0; i < bot.misread.length; i += 1) bot.misread[i] = false;
}

/** A misread note reads as the next value up, wrapping. One draw decides it, not two. */
export function readValue(value: number, misread: boolean): number {
  return misread ? (value % 3) + 1 : value;
}

/**
 * One look at the table.
 *
 * Exactly `NOTE_COUNT` values are drawn, unconditionally and before anything branches, so a
 * bot occupies a fixed window of its own stream per look whatever the table looks like and
 * whatever it decides to do. Each seat's bot has its own generator as well, so the order the
 * two are polled in is not observable at all; both guards are asserted in `rules.test.ts`.
 *
 * The policy is one line of arithmetic: **take the note with the best face value per second**,
 * where a second is the trip to it plus the dwell it takes to lift it. A hand at
 * {@link HOME_AT} goes home instead, and a hand with nothing in reach goes and waits over the
 * nearest note it could eventually have. All three use the identical trip model the
 * simulation moves the hand with.
 */
export function botLook(
  state: Readonly<State>,
  seat: SeatId,
  difficulty: BotDifficulty,
  bot: BotState,
  rng: Rng,
): void {
  const profile = BOT_PROFILES[difficulty];
  for (let i = 0; i < bot.misread.length; i += 1) bot.misread[i] = rng.bool(profile.misreadChance);

  const hand = handOf(state, seat);
  if (hand.carryCount >= HOME_AT) {
    bot.targetX = SAFE_X;
    bot.targetY = safeYOf(seat);
    return;
  }

  const speed = speedOf(hand.carryCount);
  let bestRate = 0;
  let bestX = 0;
  let bestY = 0;
  let found = false;
  // The fallback: the loose note this hand could stand nearest to, whether or not it is in
  // reach today. Standing over a note that is drifting in is what a person does, and it is
  // the only thing to do when the whole table is on the other side of the line.
  let waitDistance = Number.POSITIVE_INFINITY;
  let waitX = SAFE_X;
  let waitY = clampHandY(seat, MID_Y);

  for (let i = 0; i < state.notes.length; i += 1) {
    const note = state.notes[i];
    if (note === undefined || note.banked || note.carriedBy !== null) continue;

    // Where the hand would have to stand to have it: the note's own place, brought inside
    // this seat's reach. Clamped with the same two functions `driveHand` clamps with.
    const standX = clampHandX(note.x);
    const standY = clampHandY(seat, note.y);
    const dx = standX - hand.x;
    const dy = standY - hand.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < waitDistance) {
      waitDistance = distance;
      waitX = standX;
      waitY = standY;
    }

    const missX = note.x - standX;
    const missY = note.y - standY;
    if (missX * missX + missY * missY > GRAB_RADIUS * GRAB_RADIUS) continue;

    const value = readValue(note.value, bot.misread[i] === true);
    const rate = value / (distance / speed + GRIP_SECONDS);
    // A strict `>` keeps the lowest slot on a tie, and slot order is the same in both seats'
    // frames, so two mirrored tables break their ties into mirrored answers.
    if (rate > bestRate) {
      bestRate = rate;
      bestX = standX;
      bestY = standY;
      found = true;
    }
  }

  if (found) {
    bot.targetX = bestX;
    bot.targetY = bestY;
    return;
  }
  if (hand.carryCount > 0 || waitDistance === Number.POSITIVE_INFINITY) {
    bot.targetX = SAFE_X;
    bot.targetY = safeYOf(seat);
    return;
  }
  bot.targetX = waitX;
  bot.targetY = waitY;
}

/** Drive one bot for one step. It steers and nothing else — this game has no action. */
export function botStep(
  state: State,
  seat: SeatId,
  difficulty: BotDifficulty,
  bot: BotState,
  rng: Rng,
  fixedDeltaSeconds: number,
): void {
  bot.thinkSeconds -= fixedDeltaSeconds;
  if (bot.thinkSeconds <= 0) {
    botLook(state, seat, difficulty, bot, rng);
    bot.thinkSeconds = BOT_PROFILES[difficulty].thinkSeconds;
  }
  driveHand(state, seat, bot.targetX, bot.targetY, fixedDeltaSeconds);
}
