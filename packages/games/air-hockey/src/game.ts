import { SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { Rng, SeatId, SoundBus, Vec2 } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type {
  Game,
  GameContext,
  InputState,
  MatchScore,
  Renderer,
  WinCondition,
} from '@duelbox/game-sdk';
import type { Body, BotDifficulty } from './rules.js';
import {
  MALLET_RADIUS,
  MAX_PUCK_SPEED,
  PUCK_RADIUS,
  TABLE,
  botTarget,
  collidePuckMallet,
  stepMallet,
  stepPuck,
} from './rules.js';

/** Goals that win a match. */
export const GOAL_TARGET = 7;

/**
 * The longest a match can run, in seconds. Most goals at the whistle, drawn if level.
 *
 * First to seven is the rule and this is a backstop, not a redesign: two people trading
 * goals reach seven inside a couple of minutes and never see it. Two cautious players do
 * not, and there was previously **nothing at all** that ended such a match — `roundSeconds`
 * is validated by the manifest schema and read only by the catalogue card that prints
 * "about 1m 30s". A registry-wide termination test found it by playing two `easy` bots
 * against each other: 2–4 after thirty minutes of simulated play, and still going.
 */
export const MATCH_SECONDS = 240;

/** Length of the post-goal pause, counted in simulation steps rather than seconds. */
export const SERVE_STEPS = 60;

/** Speed the puck leaves the centre spot with. */
const SERVE_SPEED = 330;

/**
 * Half-angle of the serve, in radians. Narrow enough that an unopposed serve always
 * reaches the goal mouth rather than the post beside it.
 */
const SERVE_SPREAD = 0.12;

/** Mallet speed for a seat steering with the movement axes instead of a pointer. */
const KEYBOARD_MALLET_SPEED = 900;

const COLOUR_TABLE = '#0e1726';
const COLOUR_LINE = 'rgba(233, 240, 252, 0.55)';
const COLOUR_LINE_SOFT = 'rgba(233, 240, 252, 0.22)';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P2 = SEAT_PALETTE.p2.base;
const COLOUR_INK = '#0b1220';
const COLOUR_PUCK = '#e9f0fc';
const COLOUR_SERVE = 'rgba(233, 240, 252, 0.38)';

const BORDER = 10;
const GOAL_BAR = 16;

/**
 * Steps an impact marker stays on screen: a sixth of a second at the fixed rate.
 *
 * Every sound this game makes has one of these beside it, which is issue #180's whole
 * requirement — no cue may be carried by audio alone. A player with the sound off, a
 * player on a muted phone and a Deaf player all see the same events the sound describes.
 *
 * The markers **appear and disappear at a fixed size**. Nothing expands, travels or
 * pulses, so there is nothing here for `prefers-reduced-motion` to reduce — which matters
 * because a game may not read the device (rule 10), so the only reduced-motion-safe marker
 * is one that is safe by construction rather than by branching.
 */
const FLASH_STEPS = 10;

/** Wall a rebound came off, as a small integer so a step never allocates to record one. */
const WALL_NONE = 0;
const WALL_LEFT = 1;
const WALL_RIGHT = 2;
const WALL_TOP = 3;
const WALL_BOTTOM = 4;

/** Quietest an impact may be. A glancing touch still happened, and still gets a sound. */
const MIN_IMPACT = 0.3;

const COLOUR_FLASH = 'rgba(233, 240, 252, 0.9)';

interface MutableScore {
  p1: number;
  p2: number;
  winner: SeatId | 'draw' | null;
}

export class AirHockeyGame implements Game {
  readonly #puck: Body = { x: 0, y: 0, vx: 0, vy: 0, radius: PUCK_RADIUS };
  readonly #malletP1: Body = { x: 0, y: 0, vx: 0, vy: 0, radius: MALLET_RADIUS };
  readonly #malletP2: Body = { x: 0, y: 0, vx: 0, vy: 0, radius: MALLET_RADIUS };
  readonly #botAim: Vec2 = vec2();
  readonly #condition: WinCondition = { kind: 'first-to', target: GOAL_TARGET };
  /** Doubles as the tally handed to resolve(): the score is the tally. */
  readonly #score: MutableScore = { p1: 0, p2: 0, winner: null };
  /** Seconds left before the whistle. */
  #clock = MATCH_SECONDS;

  /** Exposed for tests, which need to reach the whistle without playing four minutes. */
  get clock(): number {
    return this.#clock;
  }

  set clock(seconds: number) {
    this.#clock = seconds;
  }

  #context: GameContext | null = null;
  /**
   * Held directly rather than reached through the context on every collision.
   *
   * `undefined` in every headless test, every balance run and every replay — sound is
   * presentation and the simulation may not depend on it. `?.` at each call site is what
   * makes that true rather than merely intended, and it allocates nothing.
   */
  #audio: SoundBus | undefined = undefined;
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #serveCountdown = 0;
  #serveToward: SeatId = 'p1';

  /** Impact marker: steps left, and where the mallet met the puck. */
  #impactSteps = 0;
  #impactX = 0;
  #impactY = 0;
  /** Rebound marker: steps left, which wall, and where along it. */
  #wallSteps = 0;
  #wallSide = WALL_NONE;
  #wallAt = 0;
  /** Serve marker: steps left on the flare drawn where the puck was released. */
  #serveSteps = 0;

  #prevPuckX = 0;
  #prevPuckY = 0;
  #prevP1X = 0;
  #prevP1Y = 0;
  #prevP2X = 0;
  #prevP2Y = 0;

  /** Read-only view for the bot harness and tests. Never mutate through it. */
  get puck(): Readonly<Body> {
    return this.#puck;
  }

  /** Read-only view for the bot harness and tests. Never mutate through it. */
  mallet(seat: SeatId): Readonly<Body> {
    return seat === 'p1' ? this.#malletP1 : this.#malletP2;
  }

  /** Steps left before the puck is served, or 0 while play is live. */
  get serveCountdown(): number {
    return this.#serveCountdown;
  }

  init(context: GameContext): void {
    this.#context = context;
    this.#audio = context.audio;
    this.#impactSteps = 0;
    this.#wallSteps = 0;
    this.#wallSide = WALL_NONE;
    this.#serveSteps = 0;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#score.p1 = 0;
    this.#score.p2 = 0;
    this.#score.winner = null;
    this.#clock = MATCH_SECONDS;
    this.#serveToward = context.rng.bool() ? 'p1' : 'p2';

    const p1 = this.#malletP1;
    p1.x = TABLE.width / 2;
    p1.y = TABLE.height * 0.8;
    p1.vx = 0;
    p1.vy = 0;

    const p2 = this.#malletP2;
    p2.x = TABLE.width / 2;
    p2.y = TABLE.height * 0.2;
    p2.vx = 0;
    p2.vy = 0;

    this.#resetPuck();
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    const context = this.#context;
    if (context === null) return;
    if (this.#score.winner !== null) return;

    this.#clock = Math.max(0, this.#clock - fixedDeltaSeconds);
    if (this.#clock === 0) {
      this.#score.winner =
        this.#score.p1 === this.#score.p2 ? 'draw' : this.#score.p1 > this.#score.p2 ? 'p1' : 'p2';
      return;
    }

    this.#prevPuckX = this.#puck.x;
    this.#prevPuckY = this.#puck.y;
    this.#prevP1X = this.#malletP1.x;
    this.#prevP1Y = this.#malletP1.y;
    this.#prevP2X = this.#malletP2.x;
    this.#prevP2Y = this.#malletP2.y;

    // Markers first, so a cue raised this step lasts its full length. Counting down
    // afterwards would silently cost every marker one of its frames.
    if (this.#impactSteps > 0) this.#impactSteps -= 1;
    if (this.#wallSteps > 0) this.#wallSteps -= 1;
    if (this.#serveSteps > 0) this.#serveSteps -= 1;

    const rng = context.rng;
    this.#driveMallet('p1', this.#malletP1, this.#botP1, input, fixedDeltaSeconds, rng);
    this.#driveMallet('p2', this.#malletP2, this.#botP2, input, fixedDeltaSeconds, rng);

    if (this.#serveCountdown > 0) {
      this.#serveCountdown -= 1;
      if (this.#serveCountdown === 0) {
        const spread = (rng.float() * 2 - 1) * SERVE_SPREAD;
        const towards = this.#serveToward === 'p1' ? 1 : -1;
        this.#puck.vx = Math.sin(spread) * SERVE_SPEED;
        this.#puck.vy = Math.cos(spread) * SERVE_SPEED * towards;
        // The puck has just been let go. Nobody caused it, so the cue carries no seat.
        this.#serveSteps = FLASH_STEPS;
        this.#audio?.emit('launch', 0.7);
      }
      return;
    }

    // Signs kept so a rebound can be told from ordinary travel. `stepPuck` reports goals
    // and nothing else, and reading the wall out of it here rather than changing its
    // return type keeps the rules file — which the balance harness and the bot both drive
    // — exactly as it was.
    const wasVx = this.#puck.vx;
    const wasVy = this.#puck.vy;
    const scored = stepPuck(this.#puck, TABLE, fixedDeltaSeconds);
    if (scored !== 'none') {
      if (scored === 'p1') {
        this.#score.p1 += 1;
      } else {
        this.#score.p2 += 1;
      }
      this.#score.winner = resolve(this.#condition, this.#score);
      this.#audio?.emit('score', 1, scored);
      // The seat that conceded receives the next serve.
      this.#serveToward = scored === 'p1' ? 'p2' : 'p1';
      this.#resetPuck();
      return;
    }
    this.#reportRebound(wasVx, wasVy);

    if (collidePuckMallet(this.#puck, this.#malletP1)) this.#reportImpact('p1');
    if (collidePuckMallet(this.#puck, this.#malletP2)) this.#reportImpact('p2');
  }

  render(renderer: Renderer, alpha: number): void {
    const width = TABLE.width;
    const height = TABLE.height;
    const centreX = width / 2;
    const centreY = height / 2;
    const goalMinX = (width - TABLE.goalWidth) / 2;

    renderer.clear(COLOUR_TABLE);
    renderer.strokeRect(BORDER, BORDER, width - BORDER * 2, height - BORDER * 2, 4, COLOUR_LINE);
    renderer.line(0, centreY, width, centreY, 5, COLOUR_LINE);
    renderer.strokeCircle(centreX, centreY, 110, 5, COLOUR_LINE);
    renderer.strokeCircle(centreX, centreY, 9, 5, COLOUR_LINE);
    renderer.strokeCircle(centreX, 0, 170, 4, COLOUR_LINE_SOFT);
    renderer.strokeCircle(centreX, height, 170, 4, COLOUR_LINE_SOFT);

    // The backstop clock, as a bar down the left edge. It exists so a cautious match
    // cannot run for ever, and a rule nobody can see is a rule nobody can play to — so it
    // is drawn even though most matches reach seven goals long before it matters.
    const left = Math.max(0, Math.min(1, this.#clock / MATCH_SECONDS));
    renderer.rect(BORDER - 10, BORDER, 6, height - BORDER * 2, COLOUR_LINE_SOFT);
    renderer.rect(BORDER - 10, BORDER, 6, (height - BORDER * 2) * left, COLOUR_LINE);

    // p2 defends the top; its goal and its mallet both carry two stripes, p1's carry
    // one, so the seats stay apart in greyscale.
    renderer.rect(goalMinX, 0, TABLE.goalWidth, GOAL_BAR, COLOUR_P2);
    renderer.rect(goalMinX, GOAL_BAR + 8, TABLE.goalWidth, GOAL_BAR / 2, COLOUR_P2);
    renderer.rect(goalMinX, height - GOAL_BAR, TABLE.goalWidth, GOAL_BAR, COLOUR_P1);

    if (this.#serveCountdown > 0) {
      const remaining = this.#serveCountdown / SERVE_STEPS;
      renderer.strokeCircle(centreX, centreY, 34 + 76 * remaining, 4, COLOUR_SERVE);
    }

    this.#drawMallet(
      renderer,
      this.#prevP2X + (this.#malletP2.x - this.#prevP2X) * alpha,
      this.#prevP2Y + (this.#malletP2.y - this.#prevP2Y) * alpha,
      COLOUR_P2,
      2,
    );
    this.#drawMallet(
      renderer,
      this.#prevP1X + (this.#malletP1.x - this.#prevP1X) * alpha,
      this.#prevP1Y + (this.#malletP1.y - this.#prevP1Y) * alpha,
      COLOUR_P1,
      1,
    );

    const puckX = this.#prevPuckX + (this.#puck.x - this.#prevPuckX) * alpha;
    const puckY = this.#prevPuckY + (this.#puck.y - this.#prevPuckY) * alpha;
    renderer.circle(puckX, puckY, PUCK_RADIUS, COLOUR_PUCK);
    renderer.strokeCircle(puckX, puckY, PUCK_RADIUS - 5, 3, COLOUR_INK);

    this.#drawCues(renderer, centreX, centreY, width, height);
  }

  /**
   * The visible half of every sound this game makes.
   *
   * Issue #180 asks that no cue be audio-only, and the cheapest way to keep that true is
   * for the marker and the sound to be raised by the same line of code — which is what
   * `#reportImpact`, `#reportRebound` and the serve branch do. This just draws what they
   * raised. `apps/web/src/data/audio-cues.test.ts` plays a match, collects every cue that
   * comes out, and fails if one of them has no marker named here.
   *
   * Nothing below moves. Each marker is a fixed shape that is either drawn or not, which
   * is what makes it safe under `prefers-reduced-motion` without the game reading the
   * device — which it may not do (rule 10).
   */
  #drawCues(
    renderer: Renderer,
    centreX: number,
    centreY: number,
    width: number,
    height: number,
  ): void {
    // A struck puck: a ring around where the mallet met it.
    if (this.#impactSteps > 0) {
      renderer.strokeCircle(this.#impactX, this.#impactY, PUCK_RADIUS + 16, 5, COLOUR_FLASH);
    }

    // A rebound: a short bright length of the rail it came off, centred on the contact.
    if (this.#wallSteps > 0) {
      const span = 120;
      const thickness = 8;
      // Slid back inside the table when the contact was near a corner, rather than
      // hanging off the end of the rail it is supposed to be marking.
      const along = (extent: number): number =>
        Math.max(0, Math.min(extent - span, this.#wallAt - span / 2));
      switch (this.#wallSide) {
        case WALL_LEFT:
          renderer.rect(0, along(height), thickness, span, COLOUR_FLASH);
          break;
        case WALL_RIGHT:
          renderer.rect(width - thickness, along(height), thickness, span, COLOUR_FLASH);
          break;
        case WALL_TOP:
          renderer.rect(along(width), 0, span, thickness, COLOUR_FLASH);
          break;
        case WALL_BOTTOM:
          renderer.rect(along(width), height - thickness, span, thickness, COLOUR_FLASH);
          break;
        default:
          break;
      }
    }

    // A serve: a flare on the centre spot the puck has just left.
    if (this.#serveSteps > 0) {
      renderer.strokeCircle(centreX, centreY, PUCK_RADIUS + 10, 5, COLOUR_FLASH);
      renderer.line(centreX - 46, centreY, centreX + 46, centreY, 4, COLOUR_FLASH);
    }
  }

  onPause(): void {
    this.#settle();
  }

  onResume(): void {
    // Mallet velocity is derived from the movement of one step, so a pointer that moved
    // during the pause must not read as a swing on the first step back.
    this.#settle();
    this.#prevPuckX = this.#puck.x;
    this.#prevPuckY = this.#puck.y;
    this.#prevP1X = this.#malletP1.x;
    this.#prevP1Y = this.#malletP1.y;
    this.#prevP2X = this.#malletP2.x;
    this.#prevP2Y = this.#malletP2.y;
  }

  getScore(): MatchScore {
    return this.#score;
  }

  destroy(): void {
    this.#context = null;
    this.#audio = undefined;
    this.#botP1 = null;
    this.#botP2 = null;
  }

  /**
   * A mallet met the puck: raise the marker and say so.
   *
   * The seat goes with the cue, because the engine pitches the two seats apart — sound is
   * the one channel with no colour in it, so rule 7's "every player-owned element also
   * differs by shape, pattern or label" needs its own answer here.
   */
  #reportImpact(seat: SeatId): void {
    this.#impactSteps = FLASH_STEPS;
    this.#impactX = this.#puck.x;
    this.#impactY = this.#puck.y;
    const speed = Math.hypot(this.#puck.vx, this.#puck.vy);
    const force = speed / MAX_PUCK_SPEED;
    this.#audio?.emit('hit', force < MIN_IMPACT ? MIN_IMPACT : force > 1 ? 1 : force, seat);
  }

  /**
   * Report a rebound off the world, if the step produced one.
   *
   * A wall is the only thing in this game that can reverse a component of the puck's
   * velocity; friction and the speed cap both scale it and never flip it. So a sign change
   * across the step *is* a rebound, and which component changed says which wall.
   */
  #reportRebound(wasVx: number, wasVy: number): void {
    const vx = this.#puck.vx;
    const vy = this.#puck.vy;
    let side = WALL_NONE;
    let at = 0;
    if (wasVx > 0 && vx < 0) {
      side = WALL_RIGHT;
      at = this.#puck.y;
    } else if (wasVx < 0 && vx > 0) {
      side = WALL_LEFT;
      at = this.#puck.y;
    } else if (wasVy > 0 && vy < 0) {
      side = WALL_BOTTOM;
      at = this.#puck.x;
    } else if (wasVy < 0 && vy > 0) {
      side = WALL_TOP;
      at = this.#puck.x;
    }
    if (side === WALL_NONE) return;
    this.#wallSteps = FLASH_STEPS;
    this.#wallSide = side;
    this.#wallAt = at;
    const speed = Math.hypot(vx, vy);
    const force = speed / MAX_PUCK_SPEED;
    // Nobody chose this one, so it carries no seat: a rail belongs to the table.
    this.#audio?.emit('bounce', force > 1 ? 1 : force);
  }

  #driveMallet(
    seat: SeatId,
    mallet: Body,
    difficulty: BotDifficulty | null,
    input: InputState,
    dt: number,
    rng: Rng,
  ): void {
    let targetX: number;
    let targetY: number;
    if (difficulty !== null) {
      botTarget(this.#botAim, this.#puck, mallet, TABLE, seat, difficulty, rng);
      targetX = this.#botAim.x;
      targetY = this.#botAim.y;
    } else {
      const seatInput = input.seat(seat);
      const pointer = seatInput.pointer;
      if (pointer !== null) {
        targetX = pointer.x;
        targetY = pointer.y;
      } else {
        targetX = mallet.x + seatInput.move.x * KEYBOARD_MALLET_SPEED * dt;
        targetY = mallet.y + seatInput.move.y * KEYBOARD_MALLET_SPEED * dt;
      }
    }
    stepMallet(mallet, targetX, targetY, TABLE, seat, dt);
  }

  #resetPuck(): void {
    const puck = this.#puck;
    puck.x = TABLE.width / 2;
    puck.y = TABLE.height / 2;
    puck.vx = 0;
    puck.vy = 0;
    this.#serveCountdown = SERVE_STEPS;
    // Interpolation must not smear the puck across the table on the reset frame.
    this.#prevPuckX = puck.x;
    this.#prevPuckY = puck.y;
  }

  #settle(): void {
    this.#malletP1.vx = 0;
    this.#malletP1.vy = 0;
    this.#malletP2.vx = 0;
    this.#malletP2.vy = 0;
  }

  #drawMallet(renderer: Renderer, x: number, y: number, colour: string, rings: number): void {
    renderer.circle(x, y, MALLET_RADIUS, colour);
    renderer.strokeCircle(x, y, MALLET_RADIUS - 2, 4, COLOUR_INK);
    for (let i = 0; i < rings; i += 1) {
      renderer.strokeCircle(x, y, MALLET_RADIUS - 11 - i * 9, 3, COLOUR_INK);
    }
  }
}
