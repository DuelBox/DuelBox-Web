import { Rng, SEAT_PALETTE, SeatFlip, seatView } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BALL_RADIUS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CENTRE_X,
  CENTRE_Y,
  CUPS_PER_RACK,
  CUP_RADIUS,
  MAX_RANGE,
  ROUNDS,
  SWISH_RADIUS,
  createBotRngs,
  createBotState,
  createGame,
  driveBot,
  firingSign,
  flightProgress,
  landingOf,
  press,
  rackOf,
  resetBotState,
  resetGame,
  step,
  throwYOf,
  winnerOf,
} from './rules.js';
import type { Ball, BotDifficulty, BotState, Game as Table } from './rules.js';

/**
 * Cup Pong — a line, a distance, and six cups.
 *
 * Nothing here is dragged and nothing is pointed at, so a key and a thumb are the same
 * instrument. What the drawing has to do is turn two abstract needles into one picture: the
 * first press keeps a *line across the table* and the second stops a *marker running along
 * it*, so both dials are drawn where the ball will actually go rather than as bars whose
 * numbers a player would have to translate.
 */

const COLOUR_TABLE = '#11202a';
const COLOUR_FELT = '#16303c';
const COLOUR_EDGE = 'rgba(206, 231, 240, 0.18)';
const COLOUR_MUTED = 'rgba(206, 231, 240, 0.42)';
const COLOUR_GONE = 'rgba(206, 231, 240, 0.14)';
const COLOUR_SHADOW = 'rgba(4, 12, 16, 0.55)';
const COLOUR_BALL = '#f6efdc';
const COLOUR_MADE = '#3ec98a';
const COLOUR_MISS = '#e0554f';

/** Pips sit outside both throw lines, on their owner's own edge of the table. */
const PIP_INSET = 30;
const PIP_SPACING = 40;
const PIP_RADIUS = 12;

/** How far a ball at the top of its arc is drawn from its own shadow. */
const LIFT = 26;

const mark: Ball = { x: 0, y: 0 };

export class CupPongGame implements Game {
  readonly #table: Table = createGame();
  readonly #flip = new SeatFlip();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();

  #botRng: { p1: Rng; p2: Rng } = { p1: new Rng(1), p2: new Rng(2) };
  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  get table(): Table {
    return this.#table;
  }

  init(context: GameContext): void {
    // A generator per seat, both drawn from the match's own before anything else touches it.
    // One shared stream is a seat bias made of arithmetic — see `createBotRngs`.
    this.#botRng = createBotRngs(context.rng);
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetGame(this.#table);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    // Stepped before the early return, so the table finishes turning to face the winner
    // rather than freezing half way round.
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    if (this.#winner !== null) return;

    this.#take(input, fixedDeltaSeconds);
    step(this.#table, fixedDeltaSeconds);
    this.#winner = winnerOf(this.#table);
  }

  #take(input: InputState, fixedDeltaSeconds: number): void {
    const active = this.#table.active;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;

    if (difficulty !== null) {
      const state = active === 'p1' ? this.#botP1State : this.#botP2State;
      driveBot(this.#table, active, difficulty, state, this.#botRng[active], fixedDeltaSeconds);
      return;
    }

    // Nothing is accepted while the table is part-way round: the needle a player is reading
    // is moving under them, so a tap would name a moment they did not mean. The rules'
    // ready freeze is what makes this cost nothing — the needle is parked for longer than
    // the turn takes, for a bot as much as for a person.
    if (!this.#flip.acceptsInput) return;
    if (!input.seat(active).actionPressed) return;
    press(this.#table, active);
  }

  #shouldRotate(): boolean {
    // `seatView` is the one definition of when a seat reads the table upside down.
    return seatView(this.#table.active, this.#presentation, this.#localSeat).rotated;
  }

  getActiveSeat(): SeatId {
    return this.#table.active;
  }

  getScore(): MatchScore {
    return { p1: this.#table.p1Made, p2: this.#table.p2Made, winner: this.#winner };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#table);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#winner = null;
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_TABLE);
    renderer.pushRotation(this.#flip.angle);
    this.#drawTable(renderer);
    this.#drawRack(renderer, 'p1');
    this.#drawRack(renderer, 'p2');
    this.#drawAim(renderer);
    this.#drawBall(renderer);
    this.#drawPips(renderer, 'p1');
    this.#drawPips(renderer, 'p2');
    renderer.popSeatRotation();
  }

  #drawTable(renderer: Renderer): void {
    renderer.rect(40, 40, BOARD_WIDTH - 80, BOARD_HEIGHT - 80, COLOUR_FELT);
    renderer.line(40, CENTRE_Y, BOARD_WIDTH - 40, CENTRE_Y, 2, COLOUR_EDGE);
    // Rounds left, as a bar on the halfway line — one object, shared by both players.
    const left = Math.max(0, 1 - (this.#table.round - 1) / ROUNDS);
    renderer.rect(
      CENTRE_X - (BOARD_WIDTH - 80) / 2,
      CENTRE_Y - 3,
      (BOARD_WIDTH - 80) * left,
      6,
      COLOUR_MUTED,
    );
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const y = throwYOf(seat);
      renderer.line(CENTRE_X - 90, y, CENTRE_X + 90, y, 3, COLOUR_EDGE);
    }
  }

  /**
   * A rack, standing cups and gone ones alike.
   *
   * Rule 7: p1's cups carry a round centre and p2's a square one, and the empty ring a taken
   * cup leaves behind keeps the same mark — so which end of the table is whose survives both
   * the half-turn and a greyscale screen, and a player can still see the shape of the rack
   * they have already broken.
   */
  #drawRack(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    for (const cup of rackOf(this.#table, seat)) {
      if (!cup.standing) {
        renderer.strokeCircle(cup.x, cup.y, CUP_RADIUS - 6, 2, COLOUR_GONE);
        continue;
      }
      renderer.circle(cup.x, cup.y, CUP_RADIUS, palette.base);
      renderer.strokeCircle(cup.x, cup.y, CUP_RADIUS, 3, palette.deep);
      // The inner ring is the clean-drop zone, drawn so a player can see what the tiebreak
      // is actually asking for rather than being told about it afterwards.
      renderer.strokeCircle(cup.x, cup.y, SWISH_RADIUS, 2, palette.deep);
      this.#seatMark(renderer, seat, cup.x, cup.y, 5, palette.deep);
    }
  }

  /**
   * The two dials, drawn as the throw they describe.
   *
   * The line is the first press and the marker running out along it is the second, so the
   * second needle is literally the landing point sliding up the table. Only the live dial
   * moves; the other is held where it was stopped.
   */
  #drawAim(renderer: Renderer): void {
    const phase = this.#table.phase;
    if (phase === 'flying' || phase === 'settling' || phase === 'over') return;
    const seat = this.#table.active;
    const palette = SEAT_PALETTE[seat];
    const angle = phase === 'throwing' ? this.#table.lockedAim : this.#table.aim;
    const sign = firingSign(seat);
    const fromY = throwYOf(seat);

    renderer.line(
      CENTRE_X,
      fromY,
      CENTRE_X - Math.sin(angle) * MAX_RANGE * sign,
      fromY + Math.cos(angle) * MAX_RANGE * sign,
      2,
      phase === 'ready' ? COLOUR_GONE : palette.soft,
    );

    if (phase !== 'throwing') return;
    landingOf(mark, seat, angle, this.#table.strength);
    renderer.strokeCircle(mark.x, mark.y, BALL_RADIUS + 4, 3, palette.base);
    this.#seatMark(renderer, seat, mark.x, mark.y, 4, palette.base);
  }

  /** The ball in flight, and the mark it leaves when it comes down. */
  #drawBall(renderer: Renderer): void {
    const phase = this.#table.phase;
    const ball = this.#table.ball;
    if (phase === 'flying') {
      const lift = 4 * flightProgress(this.#table) * (1 - flightProgress(this.#table));
      renderer.circle(ball.x, ball.y, BALL_RADIUS * 0.6, COLOUR_SHADOW);
      // Drawn back toward the thrower as it rises: from where they sit, a ball in the air is
      // nearer than its own shadow, which is the whole of the height cue on a flat table.
      const y = ball.y - firingSign(this.#table.active) * lift * LIFT;
      renderer.circle(ball.x, y, BALL_RADIUS * (1 + lift * 0.4), COLOUR_BALL);
      this.#seatMark(
        renderer,
        this.#table.active,
        ball.x,
        y,
        4,
        SEAT_PALETTE[this.#table.active].deep,
      );
      return;
    }
    if (phase !== 'settling') return;
    // Ring, double ring, cross: three outcomes told apart by shape, so the colour is
    // confirming what the shape already said rather than carrying it.
    const outcome = this.#table.lastOutcome;
    if (outcome === 'miss') {
      renderer.line(ball.x - 14, ball.y - 14, ball.x + 14, ball.y + 14, 4, COLOUR_MISS);
      renderer.line(ball.x + 14, ball.y - 14, ball.x - 14, ball.y + 14, 4, COLOUR_MISS);
      return;
    }
    renderer.strokeCircle(ball.x, ball.y, CUP_RADIUS + 6, 4, COLOUR_MADE);
    if (outcome === 'swish') renderer.strokeCircle(ball.x, ball.y, CUP_RADIUS - 6, 4, COLOUR_MADE);
  }

  /**
   * Cups taken, on the taker's own edge of the table.
   *
   * Three states, and none of them needs a number: solid for a clean drop, hollow for one
   * that went in off the rim, faint for a cup still standing. That is the tiebreak made
   * visible — a player who is level on cups can see which way it will go.
   */
  #drawPips(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const made = seat === 'p1' ? this.#table.p1Made : this.#table.p2Made;
    const clean = seat === 'p1' ? this.#table.p1Clean : this.#table.p2Clean;
    const y = seat === 'p1' ? BOARD_HEIGHT - PIP_INSET : PIP_INSET;
    for (let i = 0; i < CUPS_PER_RACK; i += 1) {
      const x = CENTRE_X + (i - (CUPS_PER_RACK - 1) / 2) * PIP_SPACING;
      if (i < clean) this.#seatMark(renderer, seat, x, y, PIP_RADIUS, palette.base);
      else if (i < made) this.#seatOutline(renderer, seat, x, y, PIP_RADIUS, palette.base);
      else this.#seatOutline(renderer, seat, x, y, PIP_RADIUS, COLOUR_GONE);
    }
  }

  /** p1 is round and p2 is square, everywhere on the table. Rule 7, in one place. */
  #seatMark(
    renderer: Renderer,
    seat: SeatId,
    x: number,
    y: number,
    size: number,
    colour: string,
  ): void {
    if (seat === 'p1') renderer.circle(x, y, size, colour);
    else renderer.rect(x - size, y - size, size * 2, size * 2, colour);
  }

  #seatOutline(
    renderer: Renderer,
    seat: SeatId,
    x: number,
    y: number,
    size: number,
    colour: string,
  ): void {
    if (seat === 'p1') renderer.strokeCircle(x, y, size, 3, colour);
    else renderer.strokeRect(x - size, y - size, size * 2, size * 2, 3, colour);
  }
}
