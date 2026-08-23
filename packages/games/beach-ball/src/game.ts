import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BALL_RADIUS,
  BOT_PROFILES,
  COURT_HEIGHT,
  COURT_WIDTH,
  MATCH_SECONDS,
  NET_Y,
  PLAYER_RADIUS,
  REACH_HEIGHT,
  botIntent,
  createBotState,
  createMatch,
  movePlayer,
  resetBotState,
  resetMatch,
  step,
} from './rules.js';
import type { BotDifficulty, BotState, Intent, Match } from './rules.js';

/**
 * Beach Ball — a sand court seen from above, a net across the middle, and a ball that has
 * a height.
 *
 * Neither the presentation nor the local seat is read, and that is deliberate. The court is
 * point-symmetric about the net: rotating it half a turn maps each seat's half onto the
 * other's exactly, so both people read their own end the same way and there is nothing to
 * rotate. A `turn-board` game needs `seatView`; a split court does not, and pretending
 * otherwise would add a branch that could only ever be wrong.
 */

const COLOUR_SAND = '#e9c98d';
const COLOUR_SAND_DEEP = '#d9b169';
const COLOUR_LINE = 'rgba(255, 252, 240, 0.85)';
const COLOUR_LINE_SOFT = 'rgba(255, 252, 240, 0.35)';
const COLOUR_NET = '#f7fbff';
const COLOUR_NET_SHADE = 'rgba(20, 30, 42, 0.28)';
const COLOUR_BALL = '#fffdf6';
const COLOUR_INK = '#1b2b3a';
const COLOUR_SHADOW = 'rgba(60, 44, 20, 0.32)';

/** How close a finger has to be before a player stops fidgeting toward it. */
const POINTER_DEADZONE = 6;

/**
 * How far the sun throws the ball's shadow, per unit of height.
 *
 * Along **x**, because x is the axis the two seats share. Slanting it along y would put the
 * shadow nearer one seat than the other and give that player a fractionally better read on
 * the ball's height, which is the sort of thing rule 9 is about.
 */
const SHADOW_SLANT = 0.42;

/** How much bigger the ball is drawn at full reach height, so height reads at a glance. */
const HEIGHT_SWELL = 0.55;

/** How deep the net is drawn. A drawing decision; the physics uses `NET_HEIGHT`. */
const NET_BAND = 34;

interface MutableScore {
  p1: number;
  p2: number;
  winner: SeatId | 'draw' | null;
}

export class BeachBallGame implements Game {
  #match: Match;
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  readonly #intent: Intent = { dx: 0, dy: 0 };
  readonly #score: MutableScore = { p1: 0, p2: 0, winner: null };

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;

  /** Last step's positions, so a frame between steps interpolates instead of stuttering. */
  #prevBallX = 0;
  #prevBallY = 0;
  #prevBallZ = 0;
  #prevP1X = 0;
  #prevP1Y = 0;
  #prevP2X = 0;
  #prevP2Y = 0;

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
    this.#publish();
    this.#snapshot();
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#match.winner !== null) return;
    this.#snapshot();
    this.#driveSeat('p1', this.#botP1, this.#botP1State, input, fixedDeltaSeconds);
    this.#driveSeat('p2', this.#botP2, this.#botP2State, input, fixedDeltaSeconds);
    step(this.#match, fixedDeltaSeconds, this.#rng);
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
    this.#prevP2X = this.#match.p2.x;
    this.#prevP2Y = this.#match.p2.y;
  }

  #driveSeat(
    seat: SeatId,
    difficulty: BotDifficulty | null,
    bot: BotState,
    input: InputState,
    dt: number,
  ): void {
    if (difficulty !== null) {
      // Two draws a seat a step, used or not, so the two seats consume the stream at the
      // same rate and one bot's decisions cannot shift the other's.
      const rollX = this.#rng.float();
      const rollY = this.#rng.float();
      botIntent(this.#intent, this.#match, bot, seat, BOT_PROFILES[difficulty], dt, rollX, rollY);
      movePlayer(this.#match, seat, this.#intent.dx, this.#intent.dy, dt);
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
  }

  #drawCourt(renderer: Renderer): void {
    renderer.clear(COLOUR_SAND);
    // A wash of each seat's colour over the sand it defends, so "my end" needs no reading.
    renderer.rect(0, NET_Y, COURT_WIDTH, COURT_HEIGHT - NET_Y, SEAT_PALETTE.p1.tint);
    renderer.rect(0, 0, COURT_WIDTH, NET_Y, SEAT_PALETTE.p2.tint);
    renderer.rect(0, NET_Y - 3, COURT_WIDTH, 6, COLOUR_SAND_DEEP);

    // The lines. Both halves get exactly the same markings, drawn from the net outward, so
    // neither seat reads a court the other does not have.
    renderer.strokeRect(24, 24, COURT_WIDTH - 48, COURT_HEIGHT - 48, 4, COLOUR_LINE);
    renderer.line(24, NET_Y - 170, COURT_WIDTH - 24, NET_Y - 170, 3, COLOUR_LINE_SOFT);
    renderer.line(24, NET_Y + 170, COURT_WIDTH - 24, NET_Y + 170, 3, COLOUR_LINE_SOFT);

    // The match clock, as a bar down the left edge. It ends a match nothing else would end,
    // and a rule nobody can see is a rule nobody can play to — so it is drawn even though
    // three points arrive long before it matters.
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
    renderer.strokeCircle(this.#match.aimX, this.#match.aimY, 26, 3, palette.soft);
    renderer.strokeCircle(this.#match.aimX, this.#match.aimY, 9, 3, palette.soft);
  }

  /**
   * The net.
   *
   * A band of a fixed drawn depth rather than one scaled to `NET_HEIGHT`, which is a height
   * on the `z` axis and would cover both players' feet if it were laid flat on the court.
   * How high the ball is above it is read off the ball's own swell and its shadow, which is
   * the only honest way to show a height on a court seen from above.
   */
  #drawNet(renderer: Renderer): void {
    renderer.rect(24, NET_Y - NET_BAND / 2, COURT_WIDTH - 48, NET_BAND, COLOUR_NET_SHADE);
    for (let x = 24; x < COURT_WIDTH - 24; x += 26) {
      renderer.line(x, NET_Y - NET_BAND / 2, x, NET_Y + NET_BAND / 2, 2, COLOUR_NET);
    }
    renderer.line(24, NET_Y - NET_BAND / 2, COURT_WIDTH - 24, NET_Y - NET_BAND / 2, 4, COLOUR_NET);
    renderer.line(24, NET_Y + NET_BAND / 2, COURT_WIDTH - 24, NET_Y + NET_BAND / 2, 4, COLOUR_NET);
  }

  /**
   * A player, told apart by shape as well as colour (rule 7).
   *
   * p1 is a disc with one ring; p2 is a square with two. In a game where both ends of the
   * court hold one round-ish thing and a ball, the silhouette is what a player tracks, and
   * the ring count survives a greyscale screen that the two hues do not.
   */
  #drawPlayer(renderer: Renderer, seat: SeatId, alpha: number): void {
    const player = seat === 'p1' ? this.#match.p1 : this.#match.p2;
    const prevX = seat === 'p1' ? this.#prevP1X : this.#prevP2X;
    const prevY = seat === 'p1' ? this.#prevP1Y : this.#prevP2Y;
    const x = prevX + (player.x - prevX) * alpha;
    const y = prevY + (player.y - prevY) * alpha;
    const palette = SEAT_PALETTE[seat];

    renderer.circle(x, y, PLAYER_RADIUS + 3, COLOUR_SHADOW);
    if (seat === 'p1') {
      renderer.circle(x, y, PLAYER_RADIUS, palette.base);
      renderer.strokeCircle(x, y, PLAYER_RADIUS - 6, 5, COLOUR_INK);
    } else {
      const side = PLAYER_RADIUS * 1.72;
      renderer.rect(x - side / 2, y - side / 2, side, side, palette.base);
      renderer.strokeRect(x - side / 2 + 6, y - side / 2 + 6, side - 12, side - 12, 5, COLOUR_INK);
      renderer.strokeRect(
        x - side / 2 + 14,
        y - side / 2 + 14,
        side - 28,
        side - 28,
        4,
        COLOUR_INK,
      );
    }
  }

  /**
   * The ball, and its shadow.
   *
   * Height is drawn twice over — the shadow slides out from under the ball and the ball
   * itself swells — because a court seen from above has no other way to say how high
   * something is, and a player who cannot read the height cannot tell a ball they can reach
   * from one sailing over them.
   */
  #drawBall(renderer: Renderer, alpha: number): void {
    const ball = this.#match.ball;
    const x = this.#prevBallX + (ball.x - this.#prevBallX) * alpha;
    const y = this.#prevBallY + (ball.y - this.#prevBallY) * alpha;
    const z = this.#prevBallZ + (ball.z - this.#prevBallZ) * alpha;
    const lift = Math.max(0, Math.min(1.6, z / REACH_HEIGHT));

    renderer.circle(x + z * SHADOW_SLANT, y, BALL_RADIUS * (1 - 0.18 * lift), COLOUR_SHADOW);

    const radius = BALL_RADIUS * (1 + HEIGHT_SWELL * lift);
    renderer.circle(x, y, radius, COLOUR_BALL);
    // Panels, so it is a beach ball rather than a disc — and so it is not a plain pale
    // circle next to a pale line in greyscale.
    renderer.rect(x - radius * 0.86, y - radius * 0.2, radius * 1.72, radius * 0.4, COLOUR_INK);
    renderer.rect(x - radius * 0.2, y - radius * 0.86, radius * 0.4, radius * 1.72, COLOUR_INK);
    renderer.strokeCircle(x, y, radius - 2, 3, COLOUR_INK);
  }
}

const gameModule = {
  manifest,
  create: (): Game => new BeachBallGame(),
};

export default gameModule;
