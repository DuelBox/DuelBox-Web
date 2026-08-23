import { Rng, SEAT_PALETTE, SeatFlip, seatView } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BANDS,
  CENTRE_X,
  CENTRE_Y,
  FLIP_SECONDS,
  FULL_CLIMB,
  MAX_ROUNDS,
  MAX_WINDS,
  SWEEP,
  TOWER_LENGTH,
  baseXOf,
  baseYOf,
  botPresses,
  createBotState,
  createGame,
  planSwing,
  press,
  resetBotState,
  resetGame,
  seatSign,
  step,
  towerFootYOf,
  towerTopYOf,
  windFactor,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Position } from './rules.js';

/**
 * Hammer Hit — a dial, a button, and a tower.
 *
 * Nothing here is dragged and nothing is pointed at, so a key and a thumb are the same
 * instrument. What the drawing has to do is make three things legible at a glance from
 * either end of the device: where the needle is, how far the hammer is wound, and who is
 * ahead. All three are shape and length; none of them is a number, because a number has a
 * top and this board is read from both ends.
 */

const COLOUR_NIGHT = '#141a26';
const COLOUR_GROUND = '#1e2634';
const COLOUR_STEEL = '#8f9cb3';
const COLOUR_STEEL_DEEP = '#4d586e';
const COLOUR_MARK = '#f2f6ff';
const COLOUR_MUTED = 'rgba(222, 232, 248, 0.42)';
const COLOUR_BELL = '#ffce6a';
const COLOUR_MISS = '#e0554f';

/** The dial the needle sweeps over, centred on a seat's own base. */
const DIAL_RADIUS = 95;
const NEEDLE_LENGTH = 84;
/** Half-width of the rail the puck climbs. */
const RAIL_HALF = 27;
const PUCK_RADIUS = 21;
/** Logical units of score bar per point. Eight rounds of ten bands is the full length. */
const SCORE_SCALE = 380 / (MAX_ROUNDS * BANDS);
const SCORE_HALF_WIDTH = 13;
/** Where each seat's score bar starts, either side of the centre line. */
const SCORE_GAP = 22;
/** Half-width of the rounds-remaining bar, which shrinks symmetrically about the centre. */
const ROUNDS_HALF_WIDTH = 88;

export class HammerHitGame implements Game {
  readonly #position: Position = createGame();
  readonly #flip = new SeatFlip({ durationSeconds: FLIP_SECONDS });
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();

  #rng = new Rng(1);
  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  get position(): Position {
    return this.#position;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetGame(this.#position);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    // Stepped before the early return, so the board finishes turning to face the winner
    // rather than freezing half way round.
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    if (this.#winner !== null) return;

    this.#take(input, fixedDeltaSeconds);
    step(this.#position, fixedDeltaSeconds);
    this.#winner = winnerOf(this.#position);
  }

  #take(input: InputState, fixedDeltaSeconds: number): void {
    const active = this.#position.active;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;

    if (difficulty !== null) {
      const state = active === 'p1' ? this.#botP1State : this.#botP2State;
      const phase = this.#position.phase;
      if (phase === 'winding' && !state.planned) {
        planSwing(this.#position, active, difficulty, state, this.#rng);
      }
      if (phase !== 'winding' && phase !== 'ready') {
        state.planned = false;
        return;
      }
      // The ready pause refuses the bot exactly as it refuses a person, so the board's
      // half-turn costs neither of them a notch of wind-up. Rule 6.
      if (botPresses(this.#position, state, fixedDeltaSeconds)) press(this.#position, active);
      return;
    }

    // Nothing is accepted while the board is part-way round: a tap would name a moment the
    // player could not have read. The ready pause outlasts the turn, so this costs the
    // person nothing the bot is not also refused.
    if (!this.#flip.acceptsInput) return;
    if (!input.seat(active).actionPressed) return;
    press(this.#position, active);
  }

  #shouldRotate(): boolean {
    // `seatView` is the one definition of when a seat reads the board upside down.
    return seatView(this.#position.active, this.#presentation, this.#localSeat).rotated;
  }

  getActiveSeat(): SeatId {
    return this.#position.active;
  }

  getScore(): MatchScore {
    return { p1: this.#position.p1Score, p2: this.#position.p2Score, winner: this.#winner };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#winner = null;
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_NIGHT);
    renderer.pushRotation(this.#flip.angle);
    this.#drawRounds(renderer);
    this.#drawTower(renderer, 'p1');
    this.#drawTower(renderer, 'p2');
    this.#drawScore(renderer, 'p1');
    this.#drawScore(renderer, 'p2');
    this.#drawDial(renderer);
    renderer.popSeatRotation();
  }

  /**
   * Rounds left, as a bar centred on the middle of the board that shrinks from both ends.
   *
   * Centred rather than filled from one side on purpose: a bar that grew from the left
   * would appear to grow from the right once the board had turned, and would then be two
   * different readings of one number.
   */
  #drawRounds(renderer: Renderer): void {
    const left = Math.max(0, 1 - (this.#position.rounds - 1) / MAX_ROUNDS);
    renderer.rect(CENTRE_X - ROUNDS_HALF_WIDTH, CENTRE_Y - 3, ROUNDS_HALF_WIDTH * 2, 6, '#26303f');
    const half = ROUNDS_HALF_WIDTH * left;
    renderer.rect(CENTRE_X - half, CENTRE_Y - 3, half * 2, 6, COLOUR_MUTED);
  }

  /**
   * A seat's tower: the rail, its ten bands, the bell on top, and the puck.
   *
   * Rule 7 lives here twice over. p1's band marks are dots and p2's are bars; p1's puck is
   * round and p2's square; p1's bell is a ring and p2's a box. Two towers side by side are
   * the pair most easily confused once the board has turned, so they differ in shape at
   * every part a player actually looks at.
   */
  #drawTower(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const x = baseXOf(seat);
    const foot = towerFootYOf(seat);
    const top = towerTopYOf(seat);
    const sign = seatSign(seat);
    const active = this.#position.active === seat;

    const climbing =
      active && (this.#position.phase === 'striking' || this.#position.phase === 'settling');

    renderer.rect(x - RAIL_HALF, Math.min(foot, top), RAIL_HALF * 2, TOWER_LENGTH, COLOUR_GROUND);
    renderer.line(x, foot, x, top, 3, COLOUR_STEEL_DEEP);

    for (let band = 1; band <= BANDS; band += 1) {
      const y = foot - sign * (band / BANDS) * TOWER_LENGTH;
      if (seat === 'p1') renderer.circle(x - RAIL_HALF - 9, y, 4, COLOUR_STEEL_DEEP);
      else renderer.rect(x + RAIL_HALF + 5, y - 2, 9, 4, COLOUR_STEEL_DEEP);
    }

    // The bell. Filled the instant one is rung, so the top band reads as an event rather
    // than as one more tick.
    const rung = climbing && this.#position.lastBell;
    const bellY = top - sign * 26;
    if (seat === 'p1') {
      renderer.strokeCircle(x, bellY, 19, 5, rung ? COLOUR_BELL : COLOUR_STEEL_DEEP);
      if (rung) renderer.circle(x, bellY, 9, COLOUR_BELL);
    } else {
      renderer.strokeRect(x - 18, bellY - 18, 36, 36, 5, rung ? COLOUR_BELL : COLOUR_STEEL_DEEP);
      if (rung) renderer.rect(x - 9, bellY - 9, 18, 18, COLOUR_BELL);
    }

    // The base plate the hammer lands on. Written as a span between two mirrored points so
    // that the rectangle a renderer wants — top-left and a height — is the same shape under
    // the half-turn for both seats.
    const plateNear = baseYOf(seat) - sign * 14;
    const plateFar = baseYOf(seat) - sign * 26;
    renderer.rect(
      x - 44,
      Math.min(plateNear, plateFar),
      88,
      12,
      active ? palette.base : COLOUR_STEEL,
    );

    const height = climbing ? this.#position.puck : 0;
    const puckY = foot - sign * height;
    if (seat === 'p1') {
      renderer.circle(x, puckY, PUCK_RADIUS, palette.base);
    } else {
      renderer.rect(
        x - PUCK_RADIUS,
        puckY - PUCK_RADIUS,
        PUCK_RADIUS * 2,
        PUCK_RADIUS * 2,
        palette.base,
      );
    }

    // A slip is drawn as a cross on the plate, because "no swing" and "a swing worth
    // nothing" look identical if the only difference is a puck that did not move.
    if (climbing && this.#position.lastSlipped) {
      const y = baseYOf(seat) - sign * 8;
      renderer.line(x - 18, y - 18, x + 18, y + 18, 5, COLOUR_MISS);
      renderer.line(x + 18, y - 18, x - 18, y + 18, 5, COLOUR_MISS);
    }
  }

  /**
   * The two totals, as bars growing out of the middle of the board in opposite directions.
   *
   * Adjacent and on one scale, so the question a player actually asks — who is ahead, and
   * by how much — is answered by which bar is longer, with no number to read the wrong way
   * up. p1's is solid with a round cap; p2's is broken into blocks with a square one.
   */
  #drawScore(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const sign = seatSign(seat);
    const start = CENTRE_Y + sign * SCORE_GAP;
    const length = (seat === 'p1' ? this.#position.p1Score : this.#position.p2Score) * SCORE_SCALE;
    const full = MAX_ROUNDS * BANDS * SCORE_SCALE;

    renderer.rect(
      CENTRE_X - SCORE_HALF_WIDTH,
      sign > 0 ? start : start - full,
      SCORE_HALF_WIDTH * 2,
      full,
      '#20293a',
    );
    if (seat === 'p1') {
      renderer.rect(CENTRE_X - SCORE_HALF_WIDTH, start, SCORE_HALF_WIDTH * 2, length, palette.base);
      if (length > 0) renderer.circle(CENTRE_X, start + length, SCORE_HALF_WIDTH, palette.base);
    } else {
      // Broken into blocks: a pattern difference that survives being read upside down and
      // in greyscale.
      const blocks = Math.floor(length / 10);
      for (let i = 0; i < blocks; i += 1) {
        renderer.rect(
          CENTRE_X - SCORE_HALF_WIDTH,
          start - (i + 1) * 10 + 2,
          SCORE_HALF_WIDTH * 2,
          7,
          palette.base,
        );
      }
      if (length > 0) {
        renderer.rect(
          CENTRE_X - SCORE_HALF_WIDTH,
          start - length - SCORE_HALF_WIDTH,
          SCORE_HALF_WIDTH * 2,
          SCORE_HALF_WIDTH * 2,
          palette.base,
        );
      }
    }
  }

  /**
   * The dial the whole game is played on, drawn only for the seat that may press.
   *
   * The mark is the reference genre's white line: dead centre of the sweep, and the only
   * thing on the board drawn in plain white. The band ticks either side of it are where
   * the score changes for the notch currently wound, so how much of the dial is worth
   * anything is visible rather than folklore — they crowd towards the mark as the hammer
   * winds, which is the cost of waiting made into a picture.
   */
  #drawDial(renderer: Renderer): void {
    const phase = this.#position.phase;
    if (phase === 'over') return;
    const seat = this.#position.active;
    const palette = SEAT_PALETTE[seat];
    const x = baseXOf(seat);
    const y = baseYOf(seat);
    const wind = Math.min(this.#position.wind, MAX_WINDS - 1);

    // The arc, in short segments: the renderer draws lines and circles, not arcs.
    const segments = 18;
    let previousX = this.#armX(seat, -SWEEP, DIAL_RADIUS);
    let previousY = this.#armY(seat, -SWEEP, DIAL_RADIUS);
    for (let i = 1; i <= segments; i += 1) {
      const angle = -SWEEP + (i / segments) * SWEEP * 2;
      const nextX = this.#armX(seat, angle, DIAL_RADIUS);
      const nextY = this.#armY(seat, angle, DIAL_RADIUS);
      renderer.line(previousX, previousY, nextX, nextY, 4, COLOUR_STEEL_DEEP);
      previousX = nextX;
      previousY = nextY;
    }

    // Where each band begins, for the notch now wound. Both sides of the mark.
    for (let band = 1; band < BANDS; band += 1) {
      const power = (band * FULL_CLIMB) / (BANDS * windFactor(wind));
      if (power >= 1) continue;
      const angle = (1 - power) * SWEEP;
      for (let side = -1; side <= 1; side += 2) {
        renderer.line(
          this.#armX(seat, side * angle, DIAL_RADIUS - 13),
          this.#armY(seat, side * angle, DIAL_RADIUS - 13),
          this.#armX(seat, side * angle, DIAL_RADIUS + 4),
          this.#armY(seat, side * angle, DIAL_RADIUS + 4),
          3,
          COLOUR_MUTED,
        );
      }
    }

    // The white line.
    renderer.line(
      this.#armX(seat, 0, DIAL_RADIUS - 30),
      this.#armY(seat, 0, DIAL_RADIUS - 30),
      this.#armX(seat, 0, DIAL_RADIUS + 12),
      this.#armY(seat, 0, DIAL_RADIUS + 12),
      6,
      COLOUR_MARK,
    );

    // The needle. Held still through the ready pause, and drawn hollow there so that
    // "not yet" is a shape and not only a stillness.
    const angle = this.#position.needle;
    const tipX = this.#armX(seat, angle, NEEDLE_LENGTH);
    const tipY = this.#armY(seat, angle, NEEDLE_LENGTH);
    const live = phase === 'winding';
    renderer.line(x, y, tipX, tipY, 7, live ? palette.base : COLOUR_STEEL);
    if (seat === 'p1') {
      renderer.circle(x, y, 15, palette.deep);
      if (!live) renderer.circle(x, y, 7, COLOUR_NIGHT);
    } else {
      renderer.rect(x - 15, y - 15, 30, 30, palette.deep);
      if (!live) renderer.rect(x - 7, y - 7, 14, 14, COLOUR_NIGHT);
    }

    // How far the hammer is wound: one pip a notch, filled from the mark outwards in the
    // seat's own reading direction, so both players see the row fill the same way.
    const direction = seatSign(seat);
    for (let notch = 0; notch < MAX_WINDS; notch += 1) {
      const pipX = x + direction * (notch - (MAX_WINDS - 1) / 2) * 30;
      const pipY = y + direction * 60;
      const filled = notch <= this.#position.wind && phase !== 'ready';
      const colour = filled ? palette.base : COLOUR_STEEL_DEEP;
      if (seat === 'p1') renderer.circle(pipX, pipY, 8, colour);
      else renderer.rect(pipX - 8, pipY - 8, 16, 16, colour);
    }
  }

  /** A point on the dial: `angle` from the mark, which always points up the tower. */
  #armX(seat: SeatId, angle: number, radius: number): number {
    return baseXOf(seat) + seatSign(seat) * Math.sin(angle) * radius;
  }

  #armY(seat: SeatId, angle: number, radius: number): number {
    return baseYOf(seat) - seatSign(seat) * Math.cos(angle) * radius;
  }
}
