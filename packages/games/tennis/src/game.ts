import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BALL_RADIUS,
  BOT_PROFILES,
  COURT_HEIGHT,
  COURT_WIDTH,
  JUMP_APEX,
  MATCH_SECONDS,
  NET_CLEAR,
  NET_Y,
  PLACE_MAX_DEPTH,
  PLAYER_RADIUS,
  RACKET_HEIGHT,
  RACKET_RADIUS,
  REACH,
  botIntent,
  createBotState,
  createMatch,
  jump,
  movePlayer,
  resetBotState,
  resetMatch,
  step,
} from './rules.js';
import type { BotDifficulty, BotState, Intent, Match } from './rules.js';

/**
 * Tennis — a court seen from above, a net across the middle, and a ball with a height.
 *
 * Neither the presentation nor the local seat is read, and that is deliberate. The court is
 * point-symmetric about the net: rotating it half a turn maps each seat's half onto the
 * other's exactly, so both people already read their own end upright and there is nothing to
 * rotate. A `turn-board` game needs `seatView`; a split court does not, and the branch could
 * only ever be wrong.
 */

const COLOUR_COURT = '#2f7d5b';
const COLOUR_COURT_DEEP = '#276a4d';
const COLOUR_LINE = 'rgba(255, 255, 250, 0.9)';
const COLOUR_LINE_SOFT = 'rgba(255, 255, 250, 0.32)';
const COLOUR_NET = '#f6f9fb';
const COLOUR_NET_SHADE = 'rgba(14, 30, 24, 0.32)';
const COLOUR_BALL = '#e8ff5a';
const COLOUR_INK = '#12261e';
const COLOUR_SHADOW = 'rgba(10, 34, 24, 0.34)';
const COLOUR_STRINGS = 'rgba(255, 255, 250, 0.75)';

/** How close a finger has to be before a player stops fidgeting toward it. */
const POINTER_DEADZONE = 6;

/**
 * How far the light throws a shadow, per unit of height.
 *
 * Along **x**, because x is the axis the two seats share. Slanting it along y would put the
 * shadow nearer one seat than the other and give that player a fractionally better read on
 * the ball's height, which is the sort of thing rule 9 is about.
 */
const SHADOW_SLANT = 0.4;

/** How much bigger the ball is drawn at full jump height, so height reads at a glance. */
const HEIGHT_SWELL = 0.5;

/** How deep the net is drawn. A drawing decision; the physics uses `NET_HEIGHT`. */
const NET_BAND = 30;

/** How long the strings flash after a clean strike, in seconds. */
const STRIKE_FLASH = 0.35;

interface MutableScore {
  p1: number;
  p2: number;
  winner: SeatId | 'draw' | null;
}

export class TennisGame implements Game {
  #match: Match;
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  readonly #intent: Intent = { dx: 0, dy: 0, jump: false };
  readonly #score: MutableScore = { p1: 0, p2: 0, winner: null };

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;

  /** Presentation only: how long is left of the flash on the racket that just struck. */
  #flash = 0;
  #flashSeat: SeatId = 'p1';
  #flashSweet = 0;

  /** Last step's positions, so a frame between steps interpolates instead of stuttering. */
  #prevBallX = 0;
  #prevBallY = 0;
  #prevBallZ = 0;
  #prevP1X = 0;
  #prevP1Y = 0;
  #prevP1Z = 0;
  #prevP2X = 0;
  #prevP2Y = 0;
  #prevP2Z = 0;

  constructor() {
    this.#match = createMatch(this.#rng);
    this.#snapshot();
  }

  /** Read-only view for the balance harness and the tests. Never mutate through it. */
  get match(): Readonly<Match> {
    return this.#match;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    resetMatch(this.#match, this.#rng);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#flash = 0;
    this.#flashSweet = 0;
    this.#publish();
    this.#snapshot();
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#match.winner !== null) return;
    this.#snapshot();
    this.#driveSeat('p1', this.#botP1, this.#botP1State, input, fixedDeltaSeconds);
    this.#driveSeat('p2', this.#botP2, this.#botP2State, input, fixedDeltaSeconds);
    const outcome = step(this.#match, fixedDeltaSeconds, this.#rng);
    if (outcome.touched !== null) {
      this.#flash = STRIKE_FLASH;
      this.#flashSeat = outcome.touched;
      this.#flashSweet = this.#match.lastSweet;
    } else if (this.#flash > 0) {
      this.#flash -= fixedDeltaSeconds;
      if (this.#flash < 0) this.#flash = 0;
    }
    this.#publish();
  }

  render(renderer: Renderer, alpha: number): void {
    this.#drawCourt(renderer);
    this.#drawMarker(renderer);
    this.#drawPlayer(renderer, 'p2', alpha);
    this.#drawPlayer(renderer, 'p1', alpha);
    this.#drawNet(renderer);
    this.#drawBall(renderer, alpha);
  }

  onPause(): void {
    this.#settle();
  }

  onResume(): void {
    // A shot takes some of the runner's own motion, so a key still down across a pause must
    // not read as a sprint into the ball on the first step back.
    this.#settle();
    this.#snapshot();
  }

  getScore(): MatchScore {
    return this.#score;
  }

  destroy(): void {
    resetMatch(this.#match, this.#rng);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#botP1 = null;
    this.#botP2 = null;
    this.#flash = 0;
    this.#flashSweet = 0;
    this.#publish();
    this.#snapshot();
  }

  #publish(): void {
    this.#score.p1 = this.#match.score.p1;
    this.#score.p2 = this.#match.score.p2;
    this.#score.winner = this.#match.winner;
  }

  #settle(): void {
    this.#match.p1.vx = 0;
    this.#match.p1.vy = 0;
    this.#match.p2.vx = 0;
    this.#match.p2.vy = 0;
  }

  #snapshot(): void {
    this.#prevBallX = this.#match.ball.x;
    this.#prevBallY = this.#match.ball.y;
    this.#prevBallZ = this.#match.ball.z;
    this.#prevP1X = this.#match.p1.x;
    this.#prevP1Y = this.#match.p1.y;
    this.#prevP1Z = this.#match.p1.z;
    this.#prevP2X = this.#match.p2.x;
    this.#prevP2Y = this.#match.p2.y;
    this.#prevP2Z = this.#match.p2.z;
  }

  /**
   * One seat's step of input.
   *
   * Movement is a **direction** from either instrument — the keys contribute the unit vector
   * they are holding, the pointer the unit vector from the player to the finger — and both go
   * through `movePlayer` under the same speed cap, so neither can arrive anywhere sooner.
   *
   * The jump is `actionPressed`, which the engine raises for exactly one step on the press
   * edge of **either** the action key or a pointer going down. That is what makes the two
   * control strings true at once: Space is a jump, and so is every fresh press of a finger.
   * Holding either does nothing extra, here and in the engine both.
   */
  #driveSeat(
    seat: SeatId,
    difficulty: BotDifficulty | null,
    bot: BotState,
    input: InputState,
    dt: number,
  ): void {
    if (difficulty !== null) {
      // Two draws a seat a step, used or not, so the two seats consume the stream at the same
      // rate and one bot's decisions cannot shift the other's.
      const rollX = this.#rng.float();
      const rollY = this.#rng.float();
      botIntent(this.#intent, this.#match, bot, seat, BOT_PROFILES[difficulty], dt, rollX, rollY);
      movePlayer(this.#match, seat, this.#intent.dx, this.#intent.dy, dt);
      if (this.#intent.jump) jump(this.#match, seat);
      return;
    }

    const seatInput = input.seat(seat);
    let dx = seatInput.move.x;
    let dy = seatInput.move.y;

    // A finger in your own half is a place to run to. No clamping here: `movePlayer` already
    // confines a player to their own half, and a second copy of that rule is a second place
    // for it to be wrong. Pointing across the net simply runs them up to their own line.
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      const player = seat === 'p1' ? this.#match.p1 : this.#match.p2;
      const gapX = pointer.x - player.x;
      const gapY = pointer.y - player.y;
      const distance = Math.hypot(gapX, gapY);
      if (distance > POINTER_DEADZONE) {
        dx = gapX / distance;
        dy = gapY / distance;
      } else {
        dx = 0;
        dy = 0;
      }
    }
    movePlayer(this.#match, seat, dx, dy, dt);
    if (seatInput.actionPressed) jump(this.#match, seat);
  }

  #drawCourt(renderer: Renderer): void {
    renderer.clear(COLOUR_COURT);
    // A wash of each seat's colour over the half they defend, so "my end" needs no reading.
    renderer.rect(0, NET_Y, COURT_WIDTH, COURT_HEIGHT - NET_Y, SEAT_PALETTE.p1.tint);
    renderer.rect(0, 0, COURT_WIDTH, NET_Y, SEAT_PALETTE.p2.tint);
    renderer.rect(0, NET_Y - 2, COURT_WIDTH, 4, COLOUR_COURT_DEEP);

    // The lines. Both halves get exactly the same markings, drawn outward from the net, so
    // neither seat reads a court the other does not have.
    renderer.strokeRect(24, 24, COURT_WIDTH - 48, COURT_HEIGHT - 48, 4, COLOUR_LINE);
    for (const away of [NET_CLEAR, PLACE_MAX_DEPTH]) {
      renderer.line(24, NET_Y - away, COURT_WIDTH - 24, NET_Y - away, 3, COLOUR_LINE_SOFT);
      renderer.line(24, NET_Y + away, COURT_WIDTH - 24, NET_Y + away, 3, COLOUR_LINE_SOFT);
    }
    renderer.line(COURT_WIDTH / 2, 24, COURT_WIDTH / 2, NET_Y - NET_CLEAR, 3, COLOUR_LINE_SOFT);
    renderer.line(
      COURT_WIDTH / 2,
      NET_Y + NET_CLEAR,
      COURT_WIDTH / 2,
      COURT_HEIGHT - 24,
      3,
      COLOUR_LINE_SOFT,
    );

    // The match clock, as a bar down the left edge. It ends a match nothing else would end,
    // and a rule nobody can see is a rule nobody can play to — so it is drawn even though
    // four points arrive long before it matters.
    const left = Math.max(0, Math.min(1, 1 - this.#match.elapsed / MATCH_SECONDS));
    renderer.rect(8, 24, 6, COURT_HEIGHT - 48, COLOUR_LINE_SOFT);
    renderer.rect(8, 24, 6, (COURT_HEIGHT - 48) * left, COLOUR_LINE);
  }

  /**
   * Where the ball is going to come down.
   *
   * Drawn for **both** players, from the aim the last touch committed to, so the prediction
   * the bot runs on is the prediction a person is looking at. Neither seat is told anything
   * the other is not.
   */
  #drawMarker(renderer: Renderer): void {
    if (this.#match.phase !== 'rally') return;
    const palette = SEAT_PALETTE[this.#match.lastToucher];
    renderer.strokeCircle(this.#match.aimX, this.#match.aimY, 24, 3, palette.soft);
    renderer.strokeCircle(this.#match.aimX, this.#match.aimY, 8, 3, palette.soft);
  }

  /**
   * The net.
   *
   * A band of a fixed drawn depth rather than one scaled to `NET_HEIGHT`, which is a height on
   * the `z` axis and would cover both players' feet if it were laid flat on the court. How
   * high the ball is above it is read off the ball's own swell and its shadow, which is the
   * only honest way to show a height on a court seen from above.
   */
  #drawNet(renderer: Renderer): void {
    renderer.rect(24, NET_Y - NET_BAND / 2, COURT_WIDTH - 48, NET_BAND, COLOUR_NET_SHADE);
    for (let x = 24; x < COURT_WIDTH - 24; x += 24) {
      renderer.line(x, NET_Y - NET_BAND / 2, x, NET_Y + NET_BAND / 2, 2, COLOUR_NET);
    }
    renderer.line(24, NET_Y - NET_BAND / 2, COURT_WIDTH - 24, NET_Y - NET_BAND / 2, 4, COLOUR_NET);
    renderer.line(24, NET_Y + NET_BAND / 2, COURT_WIDTH - 24, NET_Y + NET_BAND / 2, 4, COLOUR_NET);
  }

  /**
   * A player and their racket, told apart by shape as well as colour (rule 7).
   *
   * p1 is a disc with one ring; p2 is a square with two. The racket is drawn as its own ring
   * with a smaller ring inside it — the middle of the strings, the thing the whole game is
   * about — offset along x by the player's height, exactly as the shadow is, so a jump is
   * legible from directly above: the body swells, the strings slide out from under it, and
   * the sweet spot goes with them.
   */
  #drawPlayer(renderer: Renderer, seat: SeatId, alpha: number): void {
    const player = seat === 'p1' ? this.#match.p1 : this.#match.p2;
    const prevX = seat === 'p1' ? this.#prevP1X : this.#prevP2X;
    const prevY = seat === 'p1' ? this.#prevP1Y : this.#prevP2Y;
    const prevZ = seat === 'p1' ? this.#prevP1Z : this.#prevP2Z;
    const x = prevX + (player.x - prevX) * alpha;
    const y = prevY + (player.y - prevY) * alpha;
    const z = prevZ + (player.z - prevZ) * alpha;
    const palette = SEAT_PALETTE[seat];
    const lift = Math.max(0, Math.min(1, z / JUMP_APEX));

    // The shadow stays on the court while the body rises off it: the only way a height reads
    // from directly above.
    renderer.circle(x + z * SHADOW_SLANT, y, PLAYER_RADIUS * (1 - 0.2 * lift), COLOUR_SHADOW);

    const radius = PLAYER_RADIUS * (1 + 0.22 * lift);
    if (seat === 'p1') {
      renderer.circle(x, y, radius, palette.base);
      renderer.strokeCircle(x, y, radius - 6, 5, COLOUR_INK);
    } else {
      const side = radius * 1.7;
      renderer.rect(x - side / 2, y - side / 2, side, side, palette.base);
      renderer.strokeRect(x - side / 2 + 5, y - side / 2 + 5, side - 10, side - 10, 5, COLOUR_INK);
      renderer.strokeRect(
        x - side / 2 + 13,
        y - side / 2 + 13,
        side - 26,
        side - 26,
        4,
        COLOUR_INK,
      );
    }

    // The strings, at the height they are actually swung at.
    const racketX = x + (z + RACKET_HEIGHT) * SHADOW_SLANT;
    const flashing = this.#flash > 0 && this.#flashSeat === seat;
    const strings = flashing ? palette.base : COLOUR_STRINGS;
    renderer.strokeCircle(racketX, y, RACKET_RADIUS, 4, strings);
    renderer.strokeCircle(racketX, y, RACKET_RADIUS * 0.34, 3, strings);
    if (flashing) {
      // A clean strike is worth showing: the ring swells with how clean it was, so a player
      // learns what the middle of the strings feels like without being told.
      renderer.strokeCircle(racketX, y, RACKET_RADIUS * (0.4 + 0.7 * this.#flashSweet), 5, strings);
    }
  }

  /**
   * The ball, and its shadow.
   *
   * Height is drawn twice over — the shadow slides out from under the ball and the ball itself
   * swells — because a court seen from above has no other way to say how high something is,
   * and a player who cannot read the height cannot tell a ball they can jump into from one
   * sailing over them.
   */
  #drawBall(renderer: Renderer, alpha: number): void {
    const ball = this.#match.ball;
    const x = this.#prevBallX + (ball.x - this.#prevBallX) * alpha;
    const y = this.#prevBallY + (ball.y - this.#prevBallY) * alpha;
    const z = this.#prevBallZ + (ball.z - this.#prevBallZ) * alpha;
    const lift = Math.max(0, Math.min(1.6, z / (RACKET_HEIGHT + REACH)));

    renderer.circle(x + z * SHADOW_SLANT, y, BALL_RADIUS * (1 - 0.2 * lift), COLOUR_SHADOW);

    const radius = BALL_RADIUS * (1 + HEIGHT_SWELL * lift);
    renderer.circle(x, y, radius, COLOUR_BALL);
    // The seam, so it is a tennis ball rather than a pale disc — and so it is not a plain
    // circle next to a plain line in greyscale.
    renderer.line(x - radius, y - radius * 0.3, x + radius, y - radius * 0.3, 2, COLOUR_INK);
    renderer.line(x - radius, y + radius * 0.3, x + radius, y + radius * 0.3, 2, COLOUR_INK);
    renderer.strokeCircle(x, y, radius - 1, 2, COLOUR_INK);
  }
}

const gameModule = {
  manifest,
  create: (): Game => new TennisGame(),
};

export default gameModule;
