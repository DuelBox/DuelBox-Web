import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BALL_RADIUS,
  BOT_PROFILES,
  CENTRE_X,
  CENTRE_Y,
  EXTRA_SECONDS,
  GOAL_CEILING,
  GOAL_DEPTH,
  GOAL_HALF_W,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  MATCH_SECONDS,
  PITCH_HALF_H,
  PITCH_HALF_W,
  PLAYER_RADIUS,
  POST_RADIUS,
  attackSign,
  botHeading,
  createBotState,
  createMatch,
  drive,
  goalLineOf,
  resetBotState,
  resetMatch,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Match, Surface } from './rules.js';

/**
 * Ball Games — one pitch, two goals, and a ball that has a height.
 *
 * This file is presentation and control mapping and nothing else. Every number it draws
 * comes out of `rules.ts` in centre-origin logical units, and the only arithmetic here is
 * the one that puts the centre spot at the middle of the manifest's box.
 *
 * The pitch is **not** turned for the far seat. Two people sitting either side of one
 * device are looking at the same table, exactly as they would be looking at a real one,
 * so both read it the same way up and both steer in device directions — the convention
 * Air Hockey and Mini Soccer already use for a shared field.
 */

const COLOUR_BACKGROUND = '#06120b';
const COLOUR_TURF = '#123a20';
const COLOUR_TURF_ALT = '#154527';
const COLOUR_LINE = 'rgba(232, 250, 238, 0.42)';
const COLOUR_BALL = '#f7f8f2';
const COLOUR_INK = '#07150c';
const COLOUR_SHADOW = 'rgba(3, 12, 6, 0.42)';
const COLOUR_FRAME = 'rgba(240, 250, 244, 0.78)';

/** Bands of mown grass, so the pitch has a scale to read speed against. */
const STRIPES = 10;

/**
 * How far up the screen one unit of height moves a thing that has it.
 *
 * Height is a real simulation quantity and a flat screen has nowhere to put it, so it is
 * drawn as a shift towards the top of the device together with a shadow left on the turf.
 * The shift is the same for both ends of the pitch, which is the only choice that keeps
 * the two goals reading alike; a lift that leaned towards whichever end the ball was at
 * would make the same flight look different in the two halves.
 */
const LIFT = 0.45;

/** How far a finger must be from a player before it counts as a direction. */
const DRAG_DEADZONE = 16;

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export class BallGamesGame implements Game {
  readonly #match: Match;
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  readonly #heading = { x: 0, y: 0 };

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  constructor() {
    this.#match = createMatch(this.#rng);
  }

  /** Read-only view for the harness and the tests. */
  get match(): Readonly<Match> {
    return this.#match;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    resetMatch(this.#match, this.#rng);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;
    this.#driveSeat('p1', this.#botP1, this.#botP1State, input, fixedDeltaSeconds);
    this.#driveSeat('p2', this.#botP2, this.#botP2State, input, fixedDeltaSeconds);
    step(this.#match, fixedDeltaSeconds, this.#rng);
    this.#winner = winnerOf(this.#match);
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate between
  // fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    this.#drawPitch(renderer);
    this.#drawGoal(renderer, 'p1');
    this.#drawGoal(renderer, 'p2');
    this.#drawPlayer(renderer, 'p1');
    this.#drawPlayer(renderer, 'p2');
    this.#drawBall(renderer);
    this.#drawClock(renderer);
  }

  onPause(): void {}

  onResume(): void {}

  getScore(): MatchScore {
    return {
      p1: this.#match.score.p1,
      p2: this.#match.score.p2,
      winner: this.#winner,
    };
  }

  destroy(): void {
    resetMatch(this.#match, this.#rng);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#winner = null;
  }

  /**
   * One seat's intent for this step, from a bot or from a person.
   *
   * A key gives a direction and a drag gives a direction, and that is the whole of it:
   * neither instrument can ask for a speed, so a thumb and a keyboard are the same
   * instrument here and `control-parity.test.ts` has nothing to find. A pointer names the
   * point to run at rather than the point to stand on, so a finger that has gone down in
   * its own half and dragged across the halfway line steers the player up the pitch —
   * which is what pointer ownership by origin is for.
   */
  #driveSeat(
    seat: SeatId,
    difficulty: BotDifficulty | null,
    bot: BotState,
    input: InputState,
    dt: number,
  ): void {
    if (difficulty !== null) {
      botHeading(
        this.#heading,
        this.#match,
        bot,
        seat,
        BOT_PROFILES[difficulty],
        dt,
        this.#rng.float(),
      );
      drive(this.#match, seat, this.#heading.x, this.#heading.y, dt);
      return;
    }

    const seatInput = input.seat(seat);
    let dx = seatInput.move.x;
    let dy = seatInput.move.y;

    const pointer = seatInput.pointer;
    if (pointer !== null) {
      const me = seat === 'p1' ? this.#match.p1 : this.#match.p2;
      const gapX = pointer.x - CENTRE_X - me.x;
      const gapY = pointer.y - CENTRE_Y - me.y;
      if (Math.hypot(gapX, gapY) > DRAG_DEADZONE) {
        dx = gapX;
        dy = gapY;
      }
    }
    drive(this.#match, seat, dx, dy, dt);
  }

  #drawPitch(renderer: Renderer): void {
    const top = CENTRE_Y - PITCH_HALF_H;
    const left = CENTRE_X - PITCH_HALF_W;
    const width = PITCH_HALF_W * 2;
    const height = PITCH_HALF_H * 2;
    const band = height / STRIPES;
    for (let i = 0; i < STRIPES; i += 1) {
      renderer.rect(left, top + i * band, width, band, i % 2 === 0 ? COLOUR_TURF : COLOUR_TURF_ALT);
    }
    renderer.strokeRect(left, top, width, height, 4, COLOUR_LINE);
    renderer.line(left, CENTRE_Y, left + width, CENTRE_Y, 4, COLOUR_LINE);
    renderer.strokeCircle(CENTRE_X, CENTRE_Y, 92, 4, COLOUR_LINE);
    renderer.circle(CENTRE_X, CENTRE_Y, 6, COLOUR_LINE);
  }

  /**
   * A goal, drawn as a frame with a height rather than as a slot.
   *
   * The uprights and the bar are drawn at {@link GOAL_CEILING} lifted by {@link LIFT},
   * which is the same lift the ball gets — so "under the bar" is something a player can
   * see rather than a number in a spec, and a header that is going to sail over looks like
   * it is going to sail over.
   */
  #drawGoal(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const lineY = CENTRE_Y + goalLineOf(seat);
    const outward = -attackSign(seat);
    const netY = outward > 0 ? lineY : lineY - GOAL_DEPTH;
    renderer.rect(CENTRE_X - GOAL_HALF_W, netY, GOAL_HALF_W * 2, GOAL_DEPTH, palette.deep);
    renderer.strokeRect(CENTRE_X - GOAL_HALF_W, netY, GOAL_HALF_W * 2, GOAL_DEPTH, 4, palette.base);

    // The frame, in neutral ink: it belongs to the pitch rather than to a seat, and rule 7
    // reads seat-coloured marks, so keeping it neutral leaves each seat's own signature to
    // its player and its net.
    const barY = lineY - GOAL_CEILING * LIFT;
    renderer.line(CENTRE_X - GOAL_HALF_W, lineY, CENTRE_X - GOAL_HALF_W, barY, 4, COLOUR_FRAME);
    renderer.line(CENTRE_X + GOAL_HALF_W, lineY, CENTRE_X + GOAL_HALF_W, barY, 4, COLOUR_FRAME);
    renderer.line(CENTRE_X - GOAL_HALF_W, barY, CENTRE_X + GOAL_HALF_W, barY, 4, COLOUR_FRAME);
    renderer.circle(CENTRE_X - GOAL_HALF_W, lineY, POST_RADIUS, COLOUR_FRAME);
    renderer.circle(CENTRE_X + GOAL_HALF_W, lineY, POST_RADIUS, COLOUR_FRAME);
  }

  /**
   * Rule 7: the near seat is a disc with one pip, the far seat a square with two.
   *
   * Two independent signals, because the palette's own measurement says the seat colours
   * sit at 1.03:1 under deuteranopia — for those players the shape is not a garnish on top
   * of the colour, it is the whole of it. The pip count is fixed for the whole match, so it
   * is evidence rather than a score somebody could mistake for one.
   */
  #drawPlayer(renderer: Renderer, seat: SeatId): void {
    const me = seat === 'p1' ? this.#match.p1 : this.#match.p2;
    const palette = SEAT_PALETTE[seat];
    const x = CENTRE_X + me.x;
    const y = CENTRE_Y + me.y;

    if (seat === 'p1') {
      renderer.circle(x, y, PLAYER_RADIUS, palette.base);
      renderer.strokeCircle(x, y, PLAYER_RADIUS - 5, 5, COLOUR_INK);
      renderer.circle(x, y, 7, COLOUR_INK);
    } else {
      renderer.rect(
        x - PLAYER_RADIUS,
        y - PLAYER_RADIUS,
        PLAYER_RADIUS * 2,
        PLAYER_RADIUS * 2,
        palette.base,
      );
      renderer.strokeRect(
        x - PLAYER_RADIUS + 5,
        y - PLAYER_RADIUS + 5,
        PLAYER_RADIUS * 2 - 10,
        PLAYER_RADIUS * 2 - 10,
        5,
        COLOUR_INK,
      );
      renderer.rect(x - 13, y - 6, 10, 12, COLOUR_INK);
      renderer.rect(x + 3, y - 6, 10, 12, COLOUR_INK);
    }

    // Which part of the body last met the ball: one mark for a foot, two for a chest,
    // three for a header, stacked above the player. It fades with the flash timer, so it
    // reports the touch that just happened rather than decorating the player for ever.
    if (this.#match.flash > 0 && this.#match.lastToucher === seat) {
      const marks = markCount(this.#match.lastSurface);
      for (let i = 0; i < marks; i += 1) {
        renderer.circle(x - 14 + i * 14, y - PLAYER_RADIUS - 14, 5, COLOUR_FRAME);
      }
      renderer.strokeCircle(x, y, PLAYER_RADIUS + 8, 3, COLOUR_FRAME);
    }
  }

  /**
   * The ball, plus the shadow that is the only honest way to say how high it is.
   *
   * The shadow stays on the turf where the ball really is and shrinks as the ball climbs;
   * the ball itself is drawn lifted. A player reads the gap between the two, which is what
   * tells them whether the thing arriving is a foot ball, a chest ball or a header — and
   * that is the whole decision this game is made of.
   */
  #drawBall(renderer: Renderer): void {
    const ball = this.#match.ball;
    const groundX = CENTRE_X + ball.x;
    const groundY = CENTRE_Y + ball.y;
    const shadow = Math.max(4, BALL_RADIUS - ball.z * 0.06);
    renderer.circle(groundX, groundY, shadow, COLOUR_SHADOW);

    const drawY = clamp(groundY - ball.z * LIFT, BALL_RADIUS, LOGICAL_HEIGHT - BALL_RADIUS);
    renderer.circle(groundX, drawY, BALL_RADIUS, COLOUR_BALL);
    renderer.strokeCircle(groundX, drawY, BALL_RADIUS - 3, 3, COLOUR_INK);
    // A cross of panels, so the ball is not a plain disc against a plain disc in greyscale.
    renderer.line(groundX - 9, drawY, groundX + 9, drawY, 3, COLOUR_INK);
    renderer.line(groundX, drawY - 9, groundX, drawY + 9, 3, COLOUR_INK);
  }

  /**
   * The clock, as a bar along the top edge.
   *
   * The shell shows the score and nothing shows the time, and in a match decided *by* the
   * whistle a player who cannot see how long is left cannot decide whether to attack or
   * hold. Golden goal draws in the scoring seat's own colour when there is one, so the
   * change of rules is visible rather than announced.
   */
  #drawClock(renderer: Renderer): void {
    const total = this.#match.extra ? EXTRA_SECONDS : MATCH_SECONDS;
    const left = clamp(this.#match.clock / total, 0, 1);
    const width = LOGICAL_WIDTH - 60;
    const barY = 14;
    renderer.rect(30, barY, width, 9, COLOUR_INK);
    renderer.rect(30, barY, width * left, 9, this.#match.extra ? COLOUR_BALL : COLOUR_LINE);
    if (this.#match.extra) {
      renderer.rect(30, barY + 13, width, 3, COLOUR_BALL);
    }
  }
}

function markCount(surface: Surface | null): number {
  if (surface === 'foot') return 1;
  if (surface === 'chest') return 2;
  return surface === 'head' ? 3 : 0;
}

const gameModule = {
  manifest,
  create: (): Game => new BallGamesGame(),
};

export default gameModule;
