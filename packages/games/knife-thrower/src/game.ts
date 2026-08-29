import { Rng, SEAT_PALETTE, SeatFlip, seatView } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CENTRE_X,
  CENTRE_Y,
  IMPACT_ANGLE,
  KNIFE_LENGTH,
  LOG_RADIUS,
  MAX_KNIVES,
  MAX_THROWS,
  TARGET_POINTS,
  THROW_Y,
  botThrows,
  createBotState,
  createGame,
  resetBotState,
  resetGame,
  step,
  throwKnife,
  winnerOf,
  wouldStick,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Position } from './rules.js';

/**
 * Knife Thrower — a turning log, and a decision about when rather than where.
 *
 * There is nothing to aim. The knife always flies straight up the middle and always meets
 * the log at the same point on the circle; what moves is the wood. So the whole control is
 * one button, and the whole skill is reading a rotation that gets faster every time either
 * player succeeds.
 */

const COLOUR_BACKGROUND = '#181410';
const COLOUR_WALL = '#241c15';
const COLOUR_LOG = '#a9773f';
const COLOUR_LOG_DARK = '#7d5527';
const COLOUR_LOG_RING = 'rgba(60, 38, 16, 0.55)';
const COLOUR_BLADE = '#d9dee6';
const COLOUR_BLADE_EDGE = '#8e97a6';
const COLOUR_MUTED = 'rgba(233, 224, 210, 0.5)';
const COLOUR_SPLINTER = '#e8613c';
/** The blunt blades the log arrives carrying: weathered, and nobody's. */
const COLOUR_OLD_BLADE = '#77664f';

/** How many growth rings are drawn on the log. Fixed, so nothing allocates per frame. */
const RINGS = 3;

export class KnifeThrowerGame implements Game {
  readonly #position: Position = createGame();
  readonly #flip = new SeatFlip();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();

  #rng = new Rng(1);
  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;
  /** Counts down a flash after a splintered throw, in seconds. */
  #splinterFlash = 0;

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
    this.#splinterFlash = 0;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetGame(this.#position, this.#rng);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    // Stepped before the early return, so the board finishes turning to face the winner
    // rather than freezing half way round.
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    if (this.#splinterFlash > 0) this.#splinterFlash -= fixedDeltaSeconds;
    if (this.#winner !== null) return;

    if (this.#position.phase === 'aiming') this.#takeThrow(input, fixedDeltaSeconds);

    const outcome = step(this.#position, fixedDeltaSeconds);
    if (outcome.outcome === 'splintered') this.#splinterFlash = 0.45;
    this.#winner = winnerOf(this.#position);
  }

  #takeThrow(input: InputState, fixedDeltaSeconds: number): void {
    const active = this.#position.active;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;

    if (difficulty !== null) {
      const state = active === 'p1' ? this.#botP1State : this.#botP2State;
      if (botThrows(this.#position, difficulty, state, this.#rng, fixedDeltaSeconds)) {
        throwKnife(this.#position, active);
        resetBotState(state);
      }
      return;
    }

    // Nothing is accepted while the board is part-way round: the log a player is reading
    // is moving under them, so a tap would name a moment they did not mean.
    if (!this.#flip.acceptsInput) return;
    if (!input.seat(active).actionPressed) return;
    throwKnife(this.#position, active);
  }

  #shouldRotate(): boolean {
    // `seatView` is the one definition of when a seat reads the board upside down.
    return seatView(this.#position.active, this.#presentation, this.#localSeat).rotated;
  }

  getActiveSeat(): SeatId {
    return this.#position.active;
  }

  getScore(): MatchScore {
    return {
      p1: this.#position.p1Points,
      p2: this.#position.p2Points,
      winner: this.#winner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position, this.#rng);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#winner = null;
    this.#splinterFlash = 0;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawBackdrop(renderer);
    this.#drawLog(renderer);
    this.#drawKnives(renderer);
    this.#drawFlight(renderer);
    this.#drawHand(renderer);
    renderer.popSeatRotation();
  }

  #drawBackdrop(renderer: Renderer): void {
    // A wall panel behind the log, so the log reads as an object in a place rather than a
    // disc on a colour. Inset symmetrically, so the half-turn changes nothing.
    renderer.rect(40, 150, BOARD_WIDTH - 80, BOARD_HEIGHT - 300, COLOUR_WALL);

    if (this.#splinterFlash > 0) {
      renderer.strokeRect(40, 150, BOARD_WIDTH - 80, BOARD_HEIGHT - 300, 6, COLOUR_SPLINTER);
    }

    // Points as pips down each side: the near player's fill from the near edge, so each
    // person's own progress grows toward them.
    const span = BOARD_HEIGHT - 360;
    const spacing = span / TARGET_POINTS;
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const palette = SEAT_PALETTE[seat];
      const points = seat === 'p1' ? this.#position.p1Points : this.#position.p2Points;
      const x = seat === 'p1' ? 22 : BOARD_WIDTH - 30;
      const from = seat === 'p1' ? BOARD_HEIGHT - 180 : 180;
      const direction = seat === 'p1' ? -1 : 1;
      for (let i = 0; i < TARGET_POINTS; i += 1) {
        const y = from + direction * i * spacing;
        const filled = i < points;
        renderer.rect(x, y - 4, 8, 8, filled ? palette.base : COLOUR_WALL);
        // Rule 7: the far seat's pips are notched, so the two columns differ by shape.
        if (seat === 'p2' && filled) renderer.rect(x + 3, y - 4, 2, 8, COLOUR_BACKGROUND);
      }
    }

    // Throws left, as a bar across the foot. It is the other way this ends.
    const left = Math.max(0, 1 - this.#position.throws / MAX_THROWS);
    renderer.rect(60, BOARD_HEIGHT - 70, (BOARD_WIDTH - 120) * left, 4, COLOUR_MUTED);
  }

  #drawLog(renderer: Renderer): void {
    renderer.circle(CENTRE_X, CENTRE_Y, LOG_RADIUS, COLOUR_LOG);
    for (let i = 1; i <= RINGS; i += 1) {
      renderer.strokeCircle(CENTRE_X, CENTRE_Y, (LOG_RADIUS * i) / (RINGS + 1), 3, COLOUR_LOG_RING);
    }

    // One notch on the rim that turns with the log. Without it a plain disc gives a player
    // nothing to read the rotation from until the first knife is in, and the opening throw
    // of a cleared log would be blind.
    const notchX = CENTRE_X + Math.cos(this.#position.spin) * (LOG_RADIUS - 16);
    const notchY = CENTRE_Y + Math.sin(this.#position.spin) * (LOG_RADIUS - 16);
    renderer.circle(notchX, notchY, 11, COLOUR_LOG_DARK);

    // Where the next knife will land, marked on the rim. It is the target for both seats
    // and it never moves, which is the point being made.
    const markX = CENTRE_X + Math.cos(IMPACT_ANGLE) * LOG_RADIUS;
    const markY = CENTRE_Y + Math.sin(IMPACT_ANGLE) * LOG_RADIUS;
    const safe = this.#position.phase === 'aiming' && wouldStick(this.#position);
    renderer.strokeCircle(markX, markY, 15, 3, safe ? COLOUR_BLADE : COLOUR_SPLINTER);
  }

  #drawKnives(renderer: Renderer): void {
    for (const knife of this.#position.knives) {
      this.#drawBlade(renderer, knife.angle + this.#position.spin, knife.seat);
    }
  }

  /** A knife stuck in the log, drawn outward along its own radius. */
  #drawBlade(renderer: Renderer, worldAngle: number, seat: SeatId | null): void {
    const cos = Math.cos(worldAngle);
    const sin = Math.sin(worldAngle);
    const innerX = CENTRE_X + cos * (LOG_RADIUS - 26);
    const innerY = CENTRE_Y + sin * (LOG_RADIUS - 26);
    const outerX = CENTRE_X + cos * (LOG_RADIUS + KNIFE_LENGTH - 26);
    const outerY = CENTRE_Y + sin * (LOG_RADIUS + KNIFE_LENGTH - 26);

    renderer.line(
      innerX,
      innerY,
      outerX,
      outerY,
      9,
      seat === null ? COLOUR_OLD_BLADE : COLOUR_BLADE,
    );
    renderer.line(innerX, innerY, outerX, outerY, 3, COLOUR_BLADE_EDGE);

    // The handle carries the seat, and its shape carries it too: p1 a round pommel, p2 a
    // square one, and the blunt old blades the log arrives with a short bare tang. Eight
    // knives in one log is exactly where colour alone would fail.
    const gripX = CENTRE_X + cos * (LOG_RADIUS + KNIFE_LENGTH - 44);
    const gripY = CENTRE_Y + sin * (LOG_RADIUS + KNIFE_LENGTH - 44);
    if (seat === null) renderer.rect(gripX - 5, gripY - 5, 10, 10, COLOUR_OLD_BLADE);
    else if (seat === 'p1') renderer.circle(gripX, gripY, 13, SEAT_PALETTE[seat].base);
    else renderer.rect(gripX - 11, gripY - 11, 22, 22, SEAT_PALETTE[seat].base);
  }

  #drawFlight(renderer: Renderer): void {
    if (this.#position.phase !== 'flying') return;
    const y = CENTRE_Y + this.#position.flightDistance;
    const palette = SEAT_PALETTE[this.#position.active];
    renderer.line(CENTRE_X, y, CENTRE_X, y + KNIFE_LENGTH - 18, 9, COLOUR_BLADE);
    if (this.#position.active === 'p1')
      renderer.circle(CENTRE_X, y + KNIFE_LENGTH - 12, 13, palette.base);
    else renderer.rect(CENTRE_X - 11, y + KNIFE_LENGTH - 23, 22, 22, palette.base);
  }

  /** The hand waiting at the near edge, tinted for whoever is to throw. */
  #drawHand(renderer: Renderer): void {
    if (this.#position.phase === 'flying') return;
    const palette = SEAT_PALETTE[this.#position.active];
    renderer.rect(CENTRE_X - 34, THROW_Y - 6, 68, 12, palette.base);
    renderer.rect(CENTRE_X - 10, THROW_Y - 30, 20, 24, palette.deep);
    // How many knives are still in the log, as dashes beside the hand — the same number
    // the player has to fit around.
    for (let i = 0; i < this.#position.knives.length && i < MAX_KNIVES; i += 1) {
      renderer.rect(CENTRE_X - 130 + i * 20, THROW_Y + 22, 12, 4, COLOUR_MUTED);
    }
  }
}
