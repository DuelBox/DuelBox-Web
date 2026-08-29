import { Rng, SEAT_PALETTE, SeatFlip, seatView } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BELT_FORWARD,
  BIG_RADIUS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CENTRE_X,
  CENTRE_Y,
  CLEAN_SHARE,
  MAX_ROUNDS,
  PELLET_RADIUS,
  RANGE_MAX,
  RANGE_MIN,
  SMALL_POINTS,
  TARGET_POINTS,
  TRACK_HALF,
  boardXOf,
  boardYOf,
  createBotRngs,
  createBotState,
  createGame,
  driveBot,
  flightProgress,
  lateralAt,
  muzzleYOf,
  press,
  rangeOf,
  resetBotState,
  resetGame,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Range, Target } from './rules.js';

/**
 * Target Practice — a distance, a moment, and a belt full of ducks.
 *
 * Nothing here is dragged and nothing is pointed at, so a key and a thumb are the same
 * instrument. What the drawing has to do is make the second press legible: the shot always
 * lands on the lane's centre line, so what a player is choosing when they fire is *which
 * target will be there when it arrives*. The lane is therefore drawn as a line up the middle
 * with the marker sliding along it, and the belts crossing it — the crossing point is the
 * whole game, and it is a place on the board rather than a gauge to be translated.
 */

const COLOUR_GROUND = '#101a22';
const COLOUR_RANGE = '#16262f';
const COLOUR_EDGE = 'rgba(210, 232, 240, 0.18)';
const COLOUR_MUTED = 'rgba(210, 232, 240, 0.40)';
const COLOUR_FAINT = 'rgba(210, 232, 240, 0.13)';
const COLOUR_POST = '#22333c';
const COLOUR_TARGET = '#e8d9b0';
const COLOUR_TARGET_DEEP = '#8d7a4c';
const COLOUR_SHOT = '#fdf6e2';
const COLOUR_SCORED = '#48cf92';
const COLOUR_MISS = '#e2594f';

/** Pips sit outside both muzzles, on their owner's own edge of the board. */
const PIP_INSET = 26;
const PIP_SPACING = 44;
const PIP_RADIUS = 13;

/** The extra collar a double-scoring target wears, so size is not the only signal. */
const COLLAR_GAP = 6;

/** Hoisted: the render path runs every frame and a literal here would be four dead arrays a frame. */
const SIDES: readonly number[] = [-1, 1];

export class TargetPracticeGame implements Game {
  readonly #range: Range = createGame();
  readonly #flip = new SeatFlip();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();

  #botRng: { p1: Rng; p2: Rng } = { p1: new Rng(1), p2: new Rng(2) };
  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  get range(): Range {
    return this.#range;
  }

  init(context: GameContext): void {
    // A generator per seat, both drawn from the match's own before anything else touches it.
    this.#botRng = createBotRngs(context.rng);
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    // The shell alternates who opens across the rounds of a best-of so first-mover advantage
    // washes out. Assuming `p1` here would quietly undo that (issue #2466).
    resetGame(this.#range, context.openingSeat, context.rng);
    this.#flip.snap(this.#shouldRotate());
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    // Stepped before the early return, so the board finishes turning to face the winner
    // rather than freezing half way round.
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    if (this.#winner !== null) return;

    this.#take(input, fixedDeltaSeconds);
    step(this.#range, fixedDeltaSeconds);
    this.#winner = winnerOf(this.#range);
  }

  #take(input: InputState, fixedDeltaSeconds: number): void {
    const active = this.#range.active;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;

    if (difficulty !== null) {
      const state = active === 'p1' ? this.#botP1State : this.#botP2State;
      driveBot(this.#range, active, difficulty, state, this.#botRng[active], fixedDeltaSeconds);
      return;
    }

    // Nothing is accepted while the board is part-way round: the marker a player is reading
    // is moving under them, so a tap would name a moment they did not mean. The rules' ready
    // freeze is what makes this cost nothing — the marker is parked for longer than the turn
    // takes, for a bot as much as for a person.
    if (!this.#flip.acceptsInput) return;
    if (!input.seat(active).actionPressed) return;
    press(this.#range, active);
  }

  #shouldRotate(): boolean {
    // `seatView` is the one definition of when a seat reads the board upside down.
    return seatView(this.#range.active, this.#presentation, this.#localSeat).rotated;
  }

  getActiveSeat(): SeatId {
    return this.#range.active;
  }

  getScore(): MatchScore {
    return { p1: this.#range.p1Points, p2: this.#range.p2Points, winner: this.#winner };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#range, 'p1', new Rng(0));
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#winner = null;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate between
  // fixed steps — the flight is short and the belts are read off the simulation clock — so
  // the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_GROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawGround(renderer);
    this.#drawGallery(renderer, 'p1');
    this.#drawGallery(renderer, 'p2');
    this.#drawLane(renderer);
    this.#drawShot(renderer);
    this.#drawPips(renderer, 'p1');
    this.#drawPips(renderer, 'p2');
    renderer.popSeatRotation();
  }

  #drawGround(renderer: Renderer): void {
    renderer.rect(30, 30, BOARD_WIDTH - 60, BOARD_HEIGHT - 60, COLOUR_RANGE);
    renderer.line(30, CENTRE_Y, BOARD_WIDTH - 30, CENTRE_Y, 2, COLOUR_EDGE);
    // Rounds left, as a bar on the halfway line — one object, shared by both players.
    const left = Math.max(0, 1 - (this.#range.round - 1) / MAX_ROUNDS);
    const width = BOARD_WIDTH - 120;
    renderer.rect(CENTRE_X - width / 2, CENTRE_Y - 3, width * left, 6, COLOUR_MUTED);
  }

  /**
   * One seat's range: the two belts, their uprights, and the targets riding them.
   *
   * Both galleries are drawn, always. They are the same gallery read from two ends — every
   * position comes from the same `lateralAt` in the shooter's own frame — so a player can see
   * on their opponent's turn exactly the board they will face on their own.
   */
  #drawGallery(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const live = seat === this.#range.active;
    const rail = live ? palette.soft : COLOUR_FAINT;

    for (const forward of BELT_FORWARD) {
      const y = boardYOf(seat, forward);
      renderer.line(boardXOf(seat, -TRACK_HALF), y, boardXOf(seat, TRACK_HALF), y, 2, rail);
      // The uprights the belt runs behind, so a target leaving one side and returning at the
      // other is a machine going round rather than a thing that teleported.
      for (const side of SIDES) {
        const inner = boardXOf(seat, side * (TRACK_HALF - BIG_RADIUS));
        const outer = boardXOf(seat, side * (TRACK_HALF + BIG_RADIUS));
        const x = Math.min(inner, outer);
        renderer.rect(
          x,
          y - BIG_RADIUS - 6,
          Math.abs(outer - inner),
          BIG_RADIUS * 2 + 12,
          COLOUR_POST,
        );
      }
    }

    for (const target of this.#range.targets) {
      const x = boardXOf(seat, lateralAt(target, this.#range.clock));
      const y = boardYOf(seat, target.forward);
      this.#drawTarget(renderer, target, x, y, live);
    }

    // The shooting line, marked with its owner's shape: seat one round, seat two square.
    const muzzleY = muzzleYOf(seat);
    renderer.line(CENTRE_X - 70, muzzleY, CENTRE_X + 70, muzzleY, 3, palette.base);
    this.#seatMark(renderer, seat, CENTRE_X, muzzleY, 9, palette.base);
  }

  /**
   * A target, and what it is worth.
   *
   * Three signals, none of them colour: the size, the collar a double-scoring target wears,
   * and the inner ring, which is the clean zone the tiebreak is actually asking for drawn at
   * its real radius rather than explained afterwards.
   */
  #drawTarget(renderer: Renderer, target: Target, x: number, y: number, live: boolean): void {
    if (!live) {
      renderer.strokeCircle(x, y, target.radius, 2, COLOUR_FAINT);
      return;
    }
    renderer.circle(x, y, target.radius, COLOUR_TARGET);
    renderer.strokeCircle(x, y, target.radius, 2, COLOUR_TARGET_DEEP);
    renderer.strokeCircle(x, y, target.radius * CLEAN_SHARE, 2, COLOUR_TARGET_DEEP);
    if (target.points === SMALL_POINTS) {
      renderer.strokeCircle(x, y, target.radius + COLLAR_GAP, 2, COLOUR_TARGET);
    }
  }

  /**
   * The lane and the marker, drawn as the shot they describe.
   *
   * The marker is the landing point sliding up the lane, not a bar somewhere else whose
   * number has to be translated — so what the first press keeps is visibly a place on the
   * board, and what the second press has to do is get a target to that place.
   */
  #drawLane(renderer: Renderer): void {
    const phase = this.#range.phase;
    if (phase === 'flying' || phase === 'settling' || phase === 'over') return;
    const seat = this.#range.active;
    const palette = SEAT_PALETTE[seat];
    const muzzleY = muzzleYOf(seat);

    renderer.line(
      CENTRE_X,
      boardYOf(seat, RANGE_MIN),
      CENTRE_X,
      boardYOf(seat, RANGE_MAX),
      2,
      phase === 'ready' ? COLOUR_FAINT : palette.soft,
    );
    renderer.line(CENTRE_X, muzzleY, CENTRE_X, boardYOf(seat, RANGE_MIN), 2, COLOUR_FAINT);
    if (phase === 'ready') return;

    const y = boardYOf(seat, rangeOf(this.#range.marker));
    const kept = phase === 'laying';
    renderer.strokeCircle(CENTRE_X, y, PELLET_RADIUS + 9, kept ? 4 : 2, palette.base);
    if (kept) this.#seatMark(renderer, seat, CENTRE_X, y, 4, palette.base);
  }

  /** The shot on its way up the lane, and the mark it leaves when it gets there. */
  #drawShot(renderer: Renderer): void {
    const phase = this.#range.phase;
    const seat = this.#range.active;
    if (phase === 'flying') {
      const forward = flightProgress(this.#range) * this.#range.keptRange;
      renderer.circle(CENTRE_X, boardYOf(seat, forward), PELLET_RADIUS, COLOUR_SHOT);
      return;
    }
    if (phase !== 'settling') return;

    const outcome = this.#range.lastOutcome;
    // Nothing was fired at all, so there is nothing on the board to mark.
    if (outcome === 'timeout') return;
    if (outcome === 'miss') {
      const y = boardYOf(seat, this.#range.keptRange);
      renderer.line(CENTRE_X - 14, y - 14, CENTRE_X + 14, y + 14, 4, COLOUR_MISS);
      renderer.line(CENTRE_X + 14, y - 14, CENTRE_X - 14, y + 14, 4, COLOUR_MISS);
      return;
    }
    // Ring, double ring, cross: three outcomes told apart by shape, so the colour is
    // confirming what the shape already said rather than carrying it.
    const target = this.#range.targets[this.#range.hitIndex];
    if (target === undefined) return;
    const x = boardXOf(seat, this.#range.hitLateral);
    const y = boardYOf(seat, target.forward);
    renderer.strokeCircle(x, y, target.radius + 10, 4, COLOUR_SCORED);
    if (outcome === 'clean') {
      renderer.strokeCircle(x, y, target.radius * CLEAN_SHARE, 4, COLOUR_SCORED);
    }
  }

  /**
   * Points taken, on their owner's own edge of the board.
   *
   * Ten slots, because ten is what the match is played to, so a player reads how close they
   * are rather than a number they have to compare. Filled slots are solid, and a slot filled
   * by a clean hit carries the seat's own mark inside it — that is the tiebreak made visible,
   * so a player level on points can see which way it will go. A seat that has gone past ten
   * wears a ring on the last slot, which is the only case the ten slots cannot hold.
   */
  #drawPips(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const points = seat === 'p1' ? this.#range.p1Points : this.#range.p2Points;
    const clean = seat === 'p1' ? this.#range.p1Clean : this.#range.p2Clean;
    const y = seat === 'p1' ? BOARD_HEIGHT - PIP_INSET : PIP_INSET;
    for (let i = 0; i < TARGET_POINTS; i += 1) {
      const x = CENTRE_X + (i - (TARGET_POINTS - 1) / 2) * PIP_SPACING;
      if (i < points) this.#seatMark(renderer, seat, x, y, PIP_RADIUS, palette.base);
      else this.#seatOutline(renderer, seat, x, y, PIP_RADIUS, COLOUR_FAINT);
      if (i < clean) this.#seatOutline(renderer, seat, x, y, PIP_RADIUS - 6, palette.deep);
    }
    if (points > TARGET_POINTS) {
      const x = CENTRE_X + ((TARGET_POINTS - 1) / 2) * PIP_SPACING;
      this.#seatOutline(renderer, seat, x, y, PIP_RADIUS + 5, palette.base);
    }
  }

  /** p1 is round and p2 is square, everywhere on the board. Rule 7, in one place. */
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
