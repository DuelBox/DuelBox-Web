import type { Rng, SeatId } from '@duelbox/engine';
import {
  commit,
  createJudgement,
  misjudgement,
  resetJudgement,
  shouldDecide,
} from '@duelbox/game-sdk';
import type { Judgement } from '@duelbox/game-sdk';

/**
 * King of the Yard, as pure rules.
 *
 * One crown in an open yard. Whoever is wearing it banks time; touching the wearer takes
 * it. First to bank enough wins.
 *
 * The tension is that the two players want opposite things at every moment, and the roles
 * swap the instant they meet — so the same touch that wins you the crown puts you in the
 * position of being chased. There is no safe place and no waiting move.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit.
 */

export const YARD_WIDTH = 900;
export const YARD_HEIGHT = 900;
export const WALL = 40;

export const PLAYER_RADIUS = 46;
export const CROWN_RADIUS = 30;

/** Bare speed, and the penalty for wearing the crown. */
export const SPEED = 320;
/**
 * How much slower the wearer moves.
 *
 * Without it the game has no tension at all: whoever takes the crown first simply runs
 * away with it for the rest of the match, because both players move identically and a
 * chase nobody can win is not a chase. The wearer being slower is the entire balance.
 */
export const CROWN_DRAG = 0.72;

/** Seconds of wearing the crown that win the match. */
export const TARGET_SECONDS = 20;

/**
 * How long after a steal before the crown can change hands again.
 *
 * Two circles that overlap stay overlapping for many steps, so without this the crown
 * would flip back and forth every step while they touched — which reads as the game having
 * a seizure rather than as a struggle.
 */
export const STEAL_COOLDOWN = 0.85;

/** How long the crown lies loose at the start before it can be picked up. */
export const LOOSE_SECONDS = 1.2;

export interface Mover {
  x: number;
  y: number;
}

export interface Game {
  readonly p1: Mover;
  readonly p2: Mover;
  /** The crown's own position while nobody wears it. */
  readonly crown: Mover;
  /** Who is wearing it, or null while it is loose. */
  wearer: SeatId | null;
  /** Seconds until the crown may change hands. */
  cooldown: number;
  /** Seconds until a loose crown may be picked up. */
  looseFor: number;
  /** Seconds each seat has worn it. */
  readonly worn: { p1: number; p2: number };
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function createGame(rng: Rng): Game {
  const game: Game = {
    p1: { x: 0, y: 0 },
    p2: { x: 0, y: 0 },
    crown: { x: 0, y: 0 },
    wearer: null,
    cooldown: 0,
    looseFor: LOOSE_SECONDS,
    worn: { p1: 0, p2: 0 },
  };
  resetGame(game, rng);
  return game;
}

export function resetGame(game: Game, rng: Rng): void {
  game.p1.x = YARD_WIDTH * 0.25;
  game.p1.y = YARD_HEIGHT * 0.5;
  game.p2.x = YARD_WIDTH * 0.75;
  game.p2.y = YARD_HEIGHT * 0.5;
  dropCrown(game, rng);
  game.worn.p1 = 0;
  game.worn.p2 = 0;
}

/** Put the crown somewhere loose and away from both players. */
export function dropCrown(game: Game, rng: Rng): void {
  game.wearer = null;
  game.cooldown = 0;
  game.looseFor = LOOSE_SECONDS;
  game.crown.x = YARD_WIDTH * 0.5;
  game.crown.y = WALL + CROWN_RADIUS + rng.float() * (YARD_HEIGHT - (WALL + CROWN_RADIUS) * 2);
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** Move a player. `dx`/`dy` are a direction, normalised here so diagonals are not faster. */
export function move(
  game: Game,
  seat: SeatId,
  dx: number,
  dy: number,
  fixedDeltaSeconds: number,
): void {
  const mover = seat === 'p1' ? game.p1 : game.p2;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const speed = SPEED * (game.wearer === seat ? CROWN_DRAG : 1);
  const step = speed * fixedDeltaSeconds;
  mover.x = clamp(mover.x + (dx / length) * step, WALL + PLAYER_RADIUS, YARD_WIDTH - WALL - PLAYER_RADIUS);
  mover.y = clamp(mover.y + (dy / length) * step, WALL + PLAYER_RADIUS, YARD_HEIGHT - WALL - PLAYER_RADIUS);
}

export function distanceBetween(a: Readonly<Mover>, b: Readonly<Mover>): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function touching(a: Readonly<Mover>, b: Readonly<Mover>, reach: number): boolean {
  return distanceBetween(a, b) <= reach;
}

export type StepResult = 'playing' | 'stolen' | 'taken';

/**
 * Advance one fixed step.
 *
 * Returns what happened, so a game can show a steal rather than having to notice one.
 */
export function step(game: Game, fixedDeltaSeconds: number, rng: Rng): StepResult {
  if (game.cooldown > 0) game.cooldown = Math.max(0, game.cooldown - fixedDeltaSeconds);
  if (game.looseFor > 0) game.looseFor = Math.max(0, game.looseFor - fixedDeltaSeconds);

  if (game.wearer === null) {
    if (game.looseFor > 0) return 'playing';
    const reach = PLAYER_RADIUS + CROWN_RADIUS;
    const p1Near = touching(game.p1, game.crown, reach);
    const p2Near = touching(game.p2, game.crown, reach);
    if (!p1Near && !p2Near) return 'playing';

    if (p1Near && p2Near) {
      /**
       * Both arrived together, which is not the rare accident it looks like.
       *
       * "A tie goes to nobody" was the first rule and it **deadlocked the whole game**:
       * the two start symmetric, the crown drops on the centre line, and two bots of the
       * same tier move identically — so they arrived together on every step and nobody
       * ever picked it up. Measured, normal against normal spent three hundred seconds
       * with the crown untouched.
       *
       * Closer wins; on an exact tie the seat that has worn it *less* takes it, which is
       * the fair answer rather than an arbitrary one; and if that is level too, a seeded
       * coin, because something has to decide and it must replay the same way.
       */
      const d1 = distanceBetween(game.p1, game.crown);
      const d2 = distanceBetween(game.p2, game.crown);
      if (d1 !== d2) game.wearer = d1 < d2 ? 'p1' : 'p2';
      else if (game.worn.p1 !== game.worn.p2) game.wearer = game.worn.p1 < game.worn.p2 ? 'p1' : 'p2';
      else game.wearer = rng.bool(0.5) ? 'p1' : 'p2';
    } else {
      game.wearer = p1Near ? 'p1' : 'p2';
    }
    game.cooldown = STEAL_COOLDOWN;
    return 'taken';
  }

  const wearer = game.wearer;
  if (wearer === 'p1') game.worn.p1 += fixedDeltaSeconds;
  else game.worn.p2 += fixedDeltaSeconds;

  // The crown rides on its wearer, so anything asking where it is gets one answer.
  const rider = wearer === 'p1' ? game.p1 : game.p2;
  game.crown.x = rider.x;
  game.crown.y = rider.y;

  if (game.cooldown > 0) return 'playing';
  const chaser = wearer === 'p1' ? game.p2 : game.p1;
  if (!touching(rider, chaser, PLAYER_RADIUS * 2)) return 'playing';

  game.wearer = otherOf(wearer);
  game.cooldown = STEAL_COOLDOWN;
  return 'stolen';
}

export function winnerOf(game: Readonly<Game>): SeatId | null {
  if (game.worn.p1 >= TARGET_SECONDS) return 'p1';
  if (game.worn.p2 >= TARGET_SECONDS) return 'p2';
  return null;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * How long it takes to notice the situation has changed, in seconds.
   *
   * The lever that decides matches in a chase, and the most human way to be worse at one.
   * No tier is quicker than a person.
   */
  readonly reaction: number;
  /** How far off its chosen heading it commits, in radians. */
  readonly wobble: number;
  /**
   * How far ahead of the target it aims when chasing, in seconds.
   *
   * Chasing where somebody *is* means always arriving where they were. A good chaser cuts
   * the corner; a poor one follows the tail.
   */
  readonly lead: number;
}

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.5, wobble: 0.85, lead: 0 },
  normal: { reaction: 0.26, wobble: 0.4, lead: 0.25 },
  hard: { reaction: 0.12, wobble: 0.12, lead: 0.5 },
});

/**
 * What a bot remembers: the heading it has committed to, and when it last chose one.
 *
 * The timing is the SDK's {@link Judgement}, not a counter of our own. Three games in this
 * repository each wrote that counter separately and each got it wrong the same way, so it
 * now lives in one place with the measurements that justify it.
 */
export interface BotState {
  headingX: number;
  headingY: number;
  readonly judgement: Judgement;
  /** Where the target was last time it looked, so it can estimate their motion. */
  lastTargetX: number;
  lastTargetY: number;
}

export function createBotState(): BotState {
  return { headingX: 0, headingY: 0, judgement: createJudgement(), lastTargetX: 0, lastTargetY: 0 };
}

export function resetBotState(bot: BotState): void {
  bot.headingX = 0;
  bot.headingY = 0;
  resetJudgement(bot.judgement);
  bot.lastTargetX = 0;
  bot.lastTargetY = 0;
}

/**
 * Where the bot heads this step.
 *
 * It chases the crown when it does not have it, and runs for the far corner when it does.
 * It sees only what is on the screen, and it **commits to a heading** between decisions —
 * re-choosing every step would average its wobble to zero and make the tiers meaningless,
 * which is a mistake this codebase has now made in three separate games.
 */
export function botHeading(
  out: { x: number; y: number },
  game: Readonly<Game>,
  bot: BotState,
  seat: SeatId,
  profile: BotProfile,
  fixedDeltaSeconds: number,
  roll: number,
): { x: number; y: number } {
  if (shouldDecide(bot.judgement, fixedDeltaSeconds)) {
    commit(bot.judgement, 0, profile.reaction);

    const me = seat === 'p1' ? game.p1 : game.p2;
    let targetX: number;
    let targetY: number;

    if (game.wearer === seat) {
      // Wearing it: head for the furthest corner from the chaser.
      const chaser = seat === 'p1' ? game.p2 : game.p1;
      targetX = chaser.x < YARD_WIDTH / 2 ? YARD_WIDTH - WALL : WALL;
      targetY = chaser.y < YARD_HEIGHT / 2 ? YARD_HEIGHT - WALL : WALL;
    } else if (game.wearer === null) {
      targetX = game.crown.x;
      targetY = game.crown.y;
    } else {
      // Chasing: aim where they are going, not where they are.
      const prey = game.wearer === 'p1' ? game.p1 : game.p2;
      const preyVx = (prey.x - bot.lastTargetX) / Math.max(profile.reaction, 1e-3);
      const preyVy = (prey.y - bot.lastTargetY) / Math.max(profile.reaction, 1e-3);
      targetX = prey.x + preyVx * profile.lead;
      targetY = prey.y + preyVy * profile.lead;
      bot.lastTargetX = prey.x;
      bot.lastTargetY = prey.y;
    }

    const angle = Math.atan2(targetY - me.y, targetX - me.x) + misjudgement(roll, profile.wobble);
    bot.headingX = Math.cos(angle);
    bot.headingY = Math.sin(angle);
  }

  out.x = bot.headingX;
  out.y = bot.headingY;
  return out;
}
