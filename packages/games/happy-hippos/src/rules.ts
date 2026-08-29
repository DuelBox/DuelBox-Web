import { otherSeat } from '@duelbox/engine';
import type { Rng, SeatId } from '@duelbox/engine';
import { resolve, resolveSimultaneous } from '@duelbox/game-sdk';
import type { Outcome, WinCondition } from '@duelbox/game-sdk';

/**
 * Happy Hippos as pure rules: one pond, a fixed stock of balls drifting through it, and a
 * hippo on each bank that snaps forward when its player taps.
 *
 * Eating your own kind is worth two; eating the other seat's costs one. First to fifty.
 *
 * No rendering, no wall clock, no DOM. The game, both bots and the balance harness all drive
 * this same file, so there is exactly one definition of what a chomp catches.
 *
 * Two structural choices are worth reading before the numbers:
 *
 * 1. **A hippo cannot slide while its mouth is out.** That is not flavour — it makes the path
 *    the mouth sweeps a *vertical segment*, which is a shape both the simulation and the bot
 *    can test exactly. A bot that reasoned about a curve the simulation integrated numerically
 *    would be wrong in a way nobody could measure (issue #2465); here the two agree to the bit,
 *    and `rules.test.ts` asserts it.
 * 2. **Two hippos that snap at the same ball on the same step block each other.** Which one
 *    started earlier is decided by {@link resolveSimultaneous} on the times the two chomps were
 *    committed, never by which seat this file happens to look at first.
 */

/* ------------------------------------------------------------------ the pond */

export const BOARD_WIDTH = 600;
export const BOARD_HEIGHT = 1000;

/** The water. Everything below is in these logical units and never in pixels (rule 8). */
export const POND_LEFT = 30;
export const POND_RIGHT = 570;
export const POND_TOP = 170;
export const POND_BOTTOM = 830;

export const BALL_RADIUS = 20;

/** Where a ball's centre may be: the water, inset by its own radius. */
export const BALL_MIN_X = POND_LEFT + BALL_RADIUS;
export const BALL_MAX_X = POND_RIGHT - BALL_RADIUS;
export const BALL_MIN_Y = POND_TOP + BALL_RADIUS;
export const BALL_MAX_Y = POND_BOTTOM - BALL_RADIUS;

/**
 * How many balls the pond holds, and therefore the pool size. Even, because the stock is
 * fixed at half of each colour — see {@link colourOfSlot}.
 */
export const POND_BALLS = 12;

export const BALL_SPEED_MIN = 120;
export const BALL_SPEED_MAX = 210;

/**
 * How long an eaten ball is out of the water before its replacement is in play.
 *
 * It is parked on the wall it will roll in from for the whole of it, drawn as an outline, so
 * the delay doubles as a preview of what colour is about to arrive — and no hippo can camp a
 * spawn point, because there is nothing to eat there until the ball is live.
 */
export const ARRIVE_SECONDS = 0.9;

/* ---------------------------------------------------------------- the hippos */

export const HIPPO_HALF_WIDTH = 46;
export const HIPPO_MIN_X = POND_LEFT + HIPPO_HALF_WIDTH;
export const HIPPO_MAX_X = POND_RIGHT - HIPPO_HALF_WIDTH;

/** Logical units a second, for a thumb and for a key alike. See SPEC.md, "Fairness". */
export const HIPPO_SPEED = 340;

/** Radius of the open mouth. A ball is caught when it touches it. */
export const MOUTH_RADIUS = 30;

/** Centre-to-centre distance at which a mouth has a ball. */
export const CATCH_RADIUS = MOUTH_RADIUS + BALL_RADIUS;

/**
 * How far into the pond a chomp reaches, measured from the hippo's own bank.
 *
 * Chosen against {@link CATCH_RADIUS} rather than for the look of it. The two fully stretched
 * mouths sit at y = 460 and y = 540, eighty apart against a catch of fifty each — so a ball on
 * the middle line is inside **both** of them, and the strip of water down the centre of the
 * pond is the one place two hippos can be holding the same ball at once. At 400 the tips would
 * be a hundred and forty apart and that strip would not exist; the middle of the pond would be
 * two private halves with a gap between them, and the standoff rule would be dead code.
 */
export const LUNGE_REACH = 370;

export const LUNGE_OUT_SECONDS = 0.17;
/**
 * Seconds the mouth gapes at full stretch before it comes back.
 *
 * The hold is what makes the middle strip mean anything. Without it each mouth passes its
 * furthest point in a single frame, two mouths are only ever both out there by coincidence, and
 * a contested ball happens about once in twenty matches. With it a chomp *dwells* where the
 * other hippo can also reach, and the standoff becomes a thing a player can aim for.
 */
export const LUNGE_HOLD_SECONDS = 0.13;
export const LUNGE_BACK_SECONDS = 0.22;
export const LUNGE_RECOVER_SECONDS = 0.18;

/** How long the mouth is open — out, held and back, and none of the recovery. */
export const MOUTH_OPEN_SECONDS = LUNGE_OUT_SECONDS + LUNGE_HOLD_SECONDS + LUNGE_BACK_SECONDS;

/** One chomp, start to next chomp. */
export const CHOMP_CYCLE_SECONDS = MOUTH_OPEN_SECONDS + LUNGE_RECOVER_SECONDS;

/* --------------------------------------------------------------- the scoring */

export const OWN_POINTS = 2;
export const OTHER_POINTS = -1;
export const TARGET_POINTS = 50;

/**
 * The match clock, **ours**, and the thing that guarantees this game can end.
 *
 * `manifest.roundSeconds` ends nothing anywhere in this repo — it is the text on a catalogue
 * card. Two seats that both keep eating the wrong colour would otherwise sit at nought for
 * ever, so the clock lives here, in the simulation, where a person and a bot are the same
 * thing. When it runs out the higher score wins and a level one is a draw, which is what
 * `resolve` does with `timeExpired` for a `first-to` condition.
 */
export const MATCH_SECONDS = 90;

export const WIN_CONDITION: WinCondition = { kind: 'first-to', target: TARGET_POINTS };

/**
 * Scratch for {@link resolve}'s options.
 *
 * Hoisted and reused because the winner is judged on **every** step, and an object literal
 * there would be a fresh allocation sixty times a second — exactly what rule 5 forbids. The
 * SDK hoists its own empty-eliminations array for the same reason.
 */
const resolveOptions = { timeExpired: false };

/* ------------------------------------------------------------------- the state */

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /**
   * Whose colour this ball is. Assigned once, by {@link resetState}, and fixed for the whole
   * match after that: slot parity decides it, so the pond always holds six of each and neither
   * player can be starved of their own kind by how well the other one is playing.
   */
  seat: SeatId;
  /** False while the replacement is still rolling in. Only a live ball can be eaten. */
  live: boolean;
  /** Seconds left before it becomes live. Zero once it is. */
  arriveSeconds: number;
}

export interface Hippo {
  /** Where the hippo stands along its own bank. */
  x: number;
  /** Where its player is steering it. The hippo closes on this at {@link HIPPO_SPEED}. */
  targetX: number;
  /** Seconds since this chomp was committed, or 0 when the hippo is resting. */
  chompSeconds: number;
  chomping: boolean;
  /**
   * Match time at which the current chomp was committed, or -1 while resting.
   *
   * A *source* time, not an arrival time: when both mouths reach one ball this is what
   * {@link resolveSimultaneous} compares, so the ball goes to whoever actually snapped first
   * rather than to whoever's packet landed first on a remote match.
   */
  chompAt: number;
  /** Net points this chomp has taken so far. Reset when a chomp starts. */
  chompGain: number;
}

export interface State {
  readonly balls: Ball[];
  readonly p1Hippo: Hippo;
  readonly p2Hippo: Hippo;
  /** Scores. Named `p1`/`p2` so the state is a `Tally` the SDK can judge directly. */
  p1: number;
  p2: number;
  /** Seconds of play. The only clock in the game. */
  clock: number;
  winner: Outcome;
}

function createHippo(x: number): Hippo {
  return { x, targetX: x, chompSeconds: 0, chomping: false, chompAt: -1, chompGain: 0 };
}

function resetHippo(hippo: Hippo, x: number): void {
  hippo.x = x;
  hippo.targetX = x;
  hippo.chompSeconds = 0;
  hippo.chomping = false;
  hippo.chompAt = -1;
  hippo.chompGain = 0;
}

/**
 * Even slots belong to the opening seat, odd slots to the other. Six of each, always.
 *
 * The opening seat is the only thing `context.openingSeat` decides here, and it is worth being
 * exact about what that buys, because it is very little and pretending otherwise would be worse
 * than ignoring the field. Both hippos act from step zero, so this game has no opener in the
 * sense a turn game does. What it does have is one structural asymmetry: when several balls go
 * in the same step their replacements are drawn from the pond's stream **in slot order**, so
 * the seat holding the even slots draws first. Immeasurably small — seat one takes 48.4 to
 * 50.2% across the three tiers with the opener pinned — but real, and the SDK alternates
 * `openingSeat` across the rounds of a best-of precisely so that things like it wash out.
 *
 * Because the opening layout is mirrored pairs, moving the parity also hands a seed's opening
 * pond to the two seats turn about. Neither seat is favoured either way — the layout is
 * symmetric under the half-turn whichever parity is whose — so this alternates something that
 * is already fair rather than correcting something that was not.
 */
export function colourOfSlot(slot: number, openingSeat: SeatId = 'p1'): SeatId {
  const even = slot % 2 === 0;
  return even ? openingSeat : otherSeat(openingSeat);
}

/** A fresh state. Allocates, so call it from init() and never from a step. */
export function createState(): State {
  const balls: Ball[] = [];
  for (let i = 0; i < POND_BALLS; i += 1) {
    balls.push({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      seat: colourOfSlot(i),
      live: false,
      arriveSeconds: 0,
    });
  }
  return {
    balls,
    p1Hippo: createHippo(BOARD_WIDTH / 2),
    p2Hippo: createHippo(BOARD_WIDTH / 2),
    p1: 0,
    p2: 0,
    clock: 0,
    winner: null,
  };
}

export function hippoOf(state: Readonly<State>, seat: SeatId): Hippo {
  return seat === 'p1' ? state.p1Hippo : state.p2Hippo;
}

/** The bank a seat's hippo rests on: the y its closed mouth sits at. */
export function homeYOf(seat: SeatId): number {
  return seat === 'p1' ? POND_BOTTOM : POND_TOP;
}

/** Which way a seat's chomp travels: seat one reaches up the board, seat two down it. */
export function reachSignOf(seat: SeatId): number {
  return seat === 'p1' ? -1 : 1;
}

/** How far a chomp stands into the pond, `seconds` after it was committed. Out, held, back. */
export function depthAt(seconds: number): number {
  if (seconds <= 0) return 0;
  if (seconds < LUNGE_OUT_SECONDS) return LUNGE_REACH * (seconds / LUNGE_OUT_SECONDS);
  const held = seconds - LUNGE_OUT_SECONDS;
  if (held < LUNGE_HOLD_SECONDS) return LUNGE_REACH;
  const back = held - LUNGE_HOLD_SECONDS;
  if (back < LUNGE_BACK_SECONDS) return LUNGE_REACH * (1 - back / LUNGE_BACK_SECONDS);
  return 0;
}

/** True while a hippo's mouth is open and can take a ball. */
export function mouthOpen(hippo: Readonly<Hippo>): boolean {
  return hippo.chomping && hippo.chompSeconds < MOUTH_OPEN_SECONDS;
}

/** True when the hippo is free to move and free to chomp again. */
export function resting(hippo: Readonly<Hippo>): boolean {
  return !hippo.chomping;
}

/** Where a seat's mouth sits, given how far into its chomp it is. */
export function mouthYOf(seat: SeatId, seconds: number): number {
  return homeYOf(seat) + reachSignOf(seat) * depthAt(seconds);
}

/**
 * Does a mouth sweeping the vertical segment `x, y0 -> x, y1` touch a ball at `(ballX, ballY)`?
 *
 * Exact point-to-segment distance, and the segment is vertical because a hippo may not slide
 * while its mouth is out. That is what lets the bot evaluate a *whole* chomp with the identical
 * predicate the simulation applies one step at a time: for a ball that is not moving, the union
 * of the per-step segments is the whole-chomp segment, so the two answers agree exactly rather
 * than nearly.
 */
export function reaches(x: number, y0: number, y1: number, ballX: number, ballY: number): boolean {
  const dx = ballX - x;
  if (dx > CATCH_RADIUS || dx < -CATCH_RADIUS) return false;
  const low = y0 < y1 ? y0 : y1;
  const high = y0 < y1 ? y1 : y0;
  let dy = 0;
  if (ballY < low) dy = low - ballY;
  else if (ballY > high) dy = ballY - high;
  return dx * dx + dy * dy <= CATCH_RADIUS * CATCH_RADIUS;
}

/**
 * Send a ball back to a wall to roll in again.
 *
 * Exactly five draws, unconditionally, so the pond's stream advances by a fixed amount per
 * replacement whatever the board looks like.
 */
function sendAway(ball: Ball, rng: Rng): void {
  const fromLeft = rng.bool();
  const y = BALL_MIN_Y + rng.float() * (BALL_MAX_Y - BALL_MIN_Y);
  const spread = (rng.float() * 2 - 1) * (Math.PI / 3);
  const speed = BALL_SPEED_MIN + rng.float() * (BALL_SPEED_MAX - BALL_SPEED_MIN);
  const heading = (fromLeft ? 0 : Math.PI) + spread;
  ball.x = fromLeft ? BALL_MIN_X : BALL_MAX_X;
  ball.y = y;
  ball.vx = Math.cos(heading) * speed;
  ball.vy = Math.sin(heading) * speed;
  ball.live = false;
  ball.arriveSeconds = ARRIVE_SECONDS;
}

/**
 * Lay the pond out for a fresh match.
 *
 * **In mirrored pairs**, and that is the whole point: slot `2k` is the opening seat's colour and
 * slot `2k + 1` is the other seat's, and the odd one is placed at the half-turn image of the
 * even one with its heading reversed. So the opening board is *exactly* symmetric under the
 * rotation that turns one seat's view into the other's, and neither seat can be dealt a better
 * pond, for any seed and either opener. A test asserts it for a hundred seeds and both openers.
 */
export function resetState(state: State, rng: Rng, openingSeat: SeatId = 'p1'): void {
  state.p1 = 0;
  state.p2 = 0;
  state.clock = 0;
  state.winner = null;
  resetHippo(state.p1Hippo, BOARD_WIDTH / 2);
  resetHippo(state.p2Hippo, BOARD_WIDTH / 2);

  for (let i = 0; i < state.balls.length; i += 1) {
    const ball = state.balls[i];
    if (ball !== undefined) ball.seat = colourOfSlot(i, openingSeat);
  }

  for (let pair = 0; pair * 2 < state.balls.length; pair += 1) {
    const x = BALL_MIN_X + rng.float() * (BALL_MAX_X - BALL_MIN_X);
    const y = BALL_MIN_Y + rng.float() * (BALL_MAX_Y - BALL_MIN_Y);
    const heading = rng.float() * Math.PI * 2;
    const speed = BALL_SPEED_MIN + rng.float() * (BALL_SPEED_MAX - BALL_SPEED_MIN);

    const mine = state.balls[pair * 2];
    if (mine !== undefined) {
      mine.x = x;
      mine.y = y;
      mine.vx = Math.cos(heading) * speed;
      mine.vy = Math.sin(heading) * speed;
      mine.live = true;
      mine.arriveSeconds = 0;
    }
    const theirs = state.balls[pair * 2 + 1];
    if (theirs !== undefined) {
      theirs.x = BOARD_WIDTH - x;
      theirs.y = BOARD_HEIGHT - y;
      theirs.vx = -Math.cos(heading) * speed;
      theirs.vy = -Math.sin(heading) * speed;
      theirs.live = true;
      theirs.arriveSeconds = 0;
    }
  }
}

/**
 * Steer a hippo toward `targetX`, at its own speed and no faster.
 *
 * A rate, never a set. A thumb that jumps to the far bank and a key held down move the hippo at
 * the identical speed, which is what stops the pointer being a better instrument than the
 * keyboard (rule 10). A hippo with its mouth out does not move at all.
 */
export function driveHippo(hippo: Hippo, targetX: number, fixedDeltaSeconds: number): void {
  let wanted = targetX;
  if (wanted < HIPPO_MIN_X) wanted = HIPPO_MIN_X;
  if (wanted > HIPPO_MAX_X) wanted = HIPPO_MAX_X;
  hippo.targetX = wanted;
  if (hippo.chomping) return;
  const gap = wanted - hippo.x;
  const reach = HIPPO_SPEED * fixedDeltaSeconds;
  if (gap > reach) hippo.x += reach;
  else if (gap < -reach) hippo.x -= reach;
  else hippo.x = wanted;
}

/**
 * Commit a chomp. Returns false when the hippo is still busy with the last one.
 *
 * The commit *time* is recorded here rather than the fact of it, because a contested ball is
 * settled on when the two chomps started and not on the order this file reads the seats in.
 */
export function chomp(state: State, seat: SeatId): boolean {
  const hippo = hippoOf(state, seat);
  if (hippo.chomping) return false;
  hippo.chomping = true;
  hippo.chompSeconds = 0;
  hippo.chompAt = state.clock;
  hippo.chompGain = 0;
  return true;
}

function award(state: State, seat: SeatId, points: number): void {
  // A penalty may never take a seat below zero. A negative score is not a score, and a player
  // who is behind has to be able to read the gap they still have to close.
  if (seat === 'p1') state.p1 = state.p1 + points < 0 ? 0 : state.p1 + points;
  else state.p2 = state.p2 + points < 0 ? 0 : state.p2 + points;
  const hippo = hippoOf(state, seat);
  hippo.chompGain += points;
}

function advanceHippo(hippo: Hippo, fixedDeltaSeconds: number): void {
  if (!hippo.chomping) return;
  hippo.chompSeconds += fixedDeltaSeconds;
  if (hippo.chompSeconds >= CHOMP_CYCLE_SECONDS) {
    hippo.chomping = false;
    hippo.chompSeconds = 0;
    hippo.chompAt = -1;
  }
}

function driftBall(ball: Ball, fixedDeltaSeconds: number): void {
  if (!ball.live) {
    ball.arriveSeconds -= fixedDeltaSeconds;
    if (ball.arriveSeconds <= 0) {
      ball.arriveSeconds = 0;
      ball.live = true;
    }
    return;
  }
  ball.x += ball.vx * fixedDeltaSeconds;
  ball.y += ball.vy * fixedDeltaSeconds;
  if (ball.x < BALL_MIN_X) {
    ball.x = BALL_MIN_X + (BALL_MIN_X - ball.x);
    ball.vx = -ball.vx;
  } else if (ball.x > BALL_MAX_X) {
    ball.x = BALL_MAX_X - (ball.x - BALL_MAX_X);
    ball.vx = -ball.vx;
  }
  if (ball.y < BALL_MIN_Y) {
    ball.y = BALL_MIN_Y + (BALL_MIN_Y - ball.y);
    ball.vy = -ball.vy;
  } else if (ball.y > BALL_MAX_Y) {
    ball.y = BALL_MAX_Y - (ball.y - BALL_MAX_Y);
    ball.vy = -ball.vy;
  }
}

/**
 * Hand out every ball a mouth reached this step.
 *
 * Both seats are read before either is applied, and a ball both mouths reached goes to the
 * chomp that was committed first — `resolveSimultaneous` on the two source times, with anything
 * inside its tolerance a genuine draw. A step is 16.7 ms and the tolerance is 8, so two chomps
 * committed on the same step *are* the draw: the hippos butt heads and the ball goes free. Both
 * mouths keep covering it while the two chomps last, and the same verdict comes back every step,
 * so the standoff holds itself up with no extra state at all.
 */
function feedHippos(
  state: State,
  previousP1Seconds: number,
  previousP2Seconds: number,
  rng: Rng,
): void {
  const p1Open = mouthOpen(state.p1Hippo);
  const p2Open = mouthOpen(state.p2Hippo);
  if (!p1Open && !p2Open) return;

  const p1From = mouthYOf('p1', previousP1Seconds);
  const p1To = mouthYOf('p1', state.p1Hippo.chompSeconds);
  const p2From = mouthYOf('p2', previousP2Seconds);
  const p2To = mouthYOf('p2', state.p2Hippo.chompSeconds);

  for (let i = 0; i < state.balls.length; i += 1) {
    const ball = state.balls[i];
    if (ball === undefined || !ball.live) continue;
    const p1Bite = p1Open && reaches(state.p1Hippo.x, p1From, p1To, ball.x, ball.y);
    const p2Bite = p2Open && reaches(state.p2Hippo.x, p2From, p2To, ball.x, ball.y);
    if (!p1Bite && !p2Bite) continue;

    let taker: SeatId;
    if (p1Bite && p2Bite) {
      const first = resolveSimultaneous(state.p1Hippo.chompAt, state.p2Hippo.chompAt);
      // A genuine draw: neither hippo gets it, and neither is punished for the other's timing.
      if (first === 'draw' || first === null) continue;
      taker = first;
    } else {
      taker = p1Bite ? 'p1' : 'p2';
    }

    award(state, taker, ball.seat === taker ? OWN_POINTS : OTHER_POINTS);
    sendAway(ball, rng);
  }
}

/**
 * One fixed step: hippos first, then the water, then what the mouths caught, then the verdict.
 *
 * The mouth is swept as a segment across the step while the ball is sampled at its new
 * position. The mouth is the fast object — 2176 units a second against a ball's 210 at most —
 * so it is the one that has to be continuous, and being a segment it cannot tunnel past a ball
 * however fast it goes. A ball moves three and a half units in a step, well inside the
 * fifty-unit catch radius, so sampling it at a point loses nothing.
 */
export function step(state: State, fixedDeltaSeconds: number, rng: Rng): void {
  if (state.winner !== null) return;

  const previousP1Seconds = state.p1Hippo.chompSeconds;
  const previousP2Seconds = state.p2Hippo.chompSeconds;
  advanceHippo(state.p1Hippo, fixedDeltaSeconds);
  advanceHippo(state.p2Hippo, fixedDeltaSeconds);

  for (let i = 0; i < state.balls.length; i += 1) {
    const ball = state.balls[i];
    if (ball === undefined) continue;
    driftBall(ball, fixedDeltaSeconds);
  }

  feedHippos(state, previousP1Seconds, previousP2Seconds, rng);

  state.clock += fixedDeltaSeconds;
  resolveOptions.timeExpired = state.clock >= MATCH_SECONDS;
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

/* ------------------------------------------------------------------- the bot */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Seconds between looks at the pond. Everything a bot does between two looks it does on the
   * older picture, which is this game's reaction delay: a ball that drifted into reach half a
   * second ago is invisible to it until it looks again.
   */
  readonly thinkSeconds: number;
  /**
   * Chance of reading one ball's colour the wrong way round, drawn afresh at every look.
   *
   * This is the skill the game actually asks for, so it is the skill the ladder is built from.
   * A seat that cannot tell the two kinds apart eats the wrong ones, which is exactly what
   * happens to a person going too fast.
   */
  readonly misreadChance: number;
}

/**
 * Three tiers, and only two knobs — measured, not guessed. See SPEC.md for both sweeps and for
 * the third knob that was written, swept and deleted because it did nothing at all.
 *
 * No tier is given a ball's velocity, the opponent's chomp timing, or a ball that has not
 * rolled in yet (rule 6). Every number a bot uses is on the water in front of a player.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { thinkSeconds: 0.25, misreadChance: 0.24 },
  normal: { thinkSeconds: 0.17, misreadChance: 0.13 },
  hard: { thinkSeconds: 0.11, misreadChance: 0.05 },
});

/**
 * The smallest net a bot will accept before it snaps, for every tier alike.
 *
 * **Patience is not a difficulty axis in this game, and measuring it was the only way to find
 * that out.** Swept alone it is strongly non-monotone — a bot that snaps at anything and a bot
 * that holds out for a mouthful are both much worse than one in the middle — so a ladder built
 * on it would have had `hard` handicapped past the optimum while `normal` sat on it. It is a
 * fact about the pond, so it is a constant.
 *
 * Two, and the value is on a lattice: a chomp is worth an integer number of points, so 1.5 and
 * 2 select exactly the same chomps and so do 2.5 and 3. Two means "at least one clean ball of
 * my own" — one of mine and one of theirs together nets 1, and is not worth a cycle.
 */
export const CHOMP_THRESHOLD = 2;

export interface BotState {
  /** Where it is walking to. */
  targetX: number;
  /** What a chomp was worth where it stood at the last look. */
  nowValue: number;
  /** Counts down to the next look. */
  thinkSeconds: number;
  /** Whether this look reads slot `i` as the wrong colour. One entry per ball slot. */
  readonly misread: boolean[];
}

export function createBotState(): BotState {
  return {
    targetX: BOARD_WIDTH / 2,
    nowValue: 0,
    thinkSeconds: 0,
    misread: new Array<boolean>(POND_BALLS).fill(false),
  };
}

export function resetBotState(bot: BotState): void {
  bot.targetX = BOARD_WIDTH / 2;
  bot.nowValue = 0;
  bot.thinkSeconds = 0;
  for (let i = 0; i < bot.misread.length; i += 1) bot.misread[i] = false;
}

/**
 * What a chomp from `x` would be worth to `seat`, on the board as it stands.
 *
 * The whole-chomp segment, tested with {@link reaches} — the identical predicate the simulation
 * applies step by step. It does not model the ball drifting during the chomp and it does not
 * model the other hippo taking the ball first; a person cannot do either of those things
 * exactly either, and both errors fall on the two seats alike.
 */
export function chompValue(
  state: Readonly<State>,
  seat: SeatId,
  x: number,
  misread: readonly boolean[],
): number {
  const homeY = homeYOf(seat);
  const tipY = homeY + reachSignOf(seat) * LUNGE_REACH;
  let value = 0;
  for (let i = 0; i < state.balls.length; i += 1) {
    const ball = state.balls[i];
    if (ball === undefined || !ball.live) continue;
    if (!reaches(x, homeY, tipY, ball.x, ball.y)) continue;
    const read = misread[i] === true ? otherSeat(ball.seat) : ball.seat;
    value += read === seat ? OWN_POINTS : OTHER_POINTS;
  }
  return value;
}

function clampBank(x: number): number {
  if (x < HIPPO_MIN_X) return HIPPO_MIN_X;
  if (x > HIPPO_MAX_X) return HIPPO_MAX_X;
  return x;
}

/**
 * One look at the pond.
 *
 * Exactly `POND_BALLS` values are drawn, unconditionally and before anything branches, so a bot
 * occupies a fixed window of its own stream per look whatever the board looks like and whatever
 * it decides to do. Each seat has its own generator as well, so the order the two are polled in
 * is not observable at all — both guards are asserted in `rules.test.ts`.
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

  const hippo = hippoOf(state, seat);
  bot.nowValue = chompValue(state, seat, hippo.x, bot.misread);

  // Where the best mouthful is. Candidates are the balls themselves, because a chomp is only
  // ever worth taking from somewhere a ball already is; a grid of positions would search a
  // hundred spots to reach the same dozen answers.
  let bestX = clampBank(hippo.x);
  let bestValue = bot.nowValue;
  for (let i = 0; i < state.balls.length; i += 1) {
    const ball = state.balls[i];
    if (ball === undefined || !ball.live) continue;
    const candidate = clampBank(ball.x);
    const value = chompValue(state, seat, candidate, bot.misread);
    if (value > bestValue) {
      bestValue = value;
      bestX = candidate;
    }
  }

  // A strict `>` keeps the lowest slot on a tie, and slot order is the same in both seats'
  // frames, so two mirrored boards break their ties the same way.
  bot.targetX = bestX;
  bot.thinkSeconds = profile.thinkSeconds;
}

/**
 * Drive one bot for one step, and report whether it snaps.
 *
 * It walks toward the spot it chose and snaps when the spot it is *standing on* was worth its
 * tier's threshold at the last look — never on what the pond looks like this instant, because
 * that would give it a reaction of one frame.
 */
export function botStep(
  state: State,
  seat: SeatId,
  difficulty: BotDifficulty,
  bot: BotState,
  rng: Rng,
  fixedDeltaSeconds: number,
): boolean {
  bot.thinkSeconds -= fixedDeltaSeconds;
  if (bot.thinkSeconds <= 0) botLook(state, seat, difficulty, bot, rng);

  const hippo = hippoOf(state, seat);
  driveHippo(hippo, bot.targetX, fixedDeltaSeconds);
  if (!resting(hippo)) return false;
  return bot.nowValue >= CHOMP_THRESHOLD;
}
