import { Rng, SEAT_PALETTE, SeatFlip, seatView } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  AIM_SWEEP,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CANNON_RADIUS,
  CENTRE_X,
  CENTRE_Y,
  MAX_VOLLEYS,
  MAX_WIND,
  SHOT_RADIUS,
  TARGET_HITS,
  botPresses,
  cannonYOf,
  createBotState,
  createGame,
  firingSign,
  planShot,
  press,
  resetBotState,
  resetGame,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Position } from './rules.js';

/**
 * Cannon Duel — a needle, a button, and a crosswind.
 *
 * Nothing here is dragged and nothing is pointed at, so a key and a thumb are the same
 * instrument. What the drawing has to do is make two sweeping needles and one invisible
 * force legible at a glance, because that is the entire information the shot depends on.
 */

const COLOUR_SKY = '#101a2c';
const COLOUR_GROUND = '#1b2436';
const COLOUR_HORIZON = 'rgba(214, 226, 244, 0.16)';
const COLOUR_METAL = '#94a3bb';
const COLOUR_METAL_DEEP = '#5b6980';
const COLOUR_SHOT = '#ffd28a';
const COLOUR_MUTED = 'rgba(220, 230, 246, 0.5)';
const COLOUR_HIT = '#3ec98a';
const COLOUR_MISS = '#e0554f';

/** The gauges sit between the near cannon and the centre, where the eye already is. */
const GAUGE_Y = CENTRE_Y + 210;
const GAUGE_HALF_WIDTH = 220;

export class CannonDuelGame implements Game {
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
    resetGame(this.#position, this.#rng);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    // Stepped before the early return, so the board finishes turning to face the winner
    // rather than freezing half way round.
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    if (this.#winner !== null) return;

    this.#take(input, fixedDeltaSeconds);
    step(this.#position, fixedDeltaSeconds, this.#rng);
    this.#winner = winnerOf(this.#position);
  }

  #take(input: InputState, fixedDeltaSeconds: number): void {
    const active = this.#position.active;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;

    if (difficulty !== null) {
      const state = active === 'p1' ? this.#botP1State : this.#botP2State;
      if (this.#position.phase === 'aiming' && !state.planned) {
        planShot(this.#position, active, difficulty, state, this.#rng);
      }
      if (this.#position.phase !== 'aiming' && this.#position.phase !== 'powering') {
        state.planned = false;
        return;
      }
      if (botPresses(this.#position, state, fixedDeltaSeconds)) press(this.#position, active);
      return;
    }

    // Nothing is accepted while the board is part-way round: the needle a player is
    // reading is moving under them, so a tap would name a moment they did not mean.
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
    return { p1: this.#position.p1Hits, p2: this.#position.p2Hits, winner: this.#winner };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position, this.#rng);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#winner = null;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_SKY);
    renderer.pushRotation(this.#flip.angle);
    this.#drawField(renderer);
    this.#drawWind(renderer);
    for (const seat of ['p1', 'p2'] as SeatId[]) this.#drawCannon(renderer, seat);
    this.#drawShot(renderer);
    this.#drawGauges(renderer);
    this.#drawHits(renderer);
    renderer.popSeatRotation();
  }

  #drawField(renderer: Renderer): void {
    renderer.rect(0, CENTRE_Y - 60, BOARD_WIDTH, 120, COLOUR_GROUND);
    renderer.line(0, CENTRE_Y, BOARD_WIDTH, CENTRE_Y, 2, COLOUR_HORIZON);
    // Volleys left, as a bar on the halfway line — one object, shared by both players.
    const left = Math.max(0, 1 - (this.#position.volleys - 1) / MAX_VOLLEYS);
    renderer.rect(0, CENTRE_Y - 3, BOARD_WIDTH * left, 6, COLOUR_MUTED);
  }

  /**
   * The wind, as a row of streaks across the middle.
   *
   * It is the only thing on the board a player cannot deduce from the geometry, so it is
   * drawn as *length and direction*, never as a number — the arrow gets longer with the
   * wind and points the way it blows, which needs no reading and no translation.
   */
  #drawWind(renderer: Renderer): void {
    const wind = this.#position.wind;
    const strength = Math.abs(wind) / MAX_WIND;
    const direction = wind < 0 ? -1 : 1;
    for (let i = 0; i < 4; i += 1) {
      const y = CENTRE_Y - 40 + i * 26;
      const length = 30 + strength * 130;
      const x = CENTRE_X - (direction * length) / 2;
      renderer.line(x, y, x + direction * length, y, 3, COLOUR_MUTED);
      // A head on the leading end, so the direction survives being seen upside down.
      renderer.line(
        x + direction * length,
        y,
        x + direction * (length - 12),
        y - 7,
        3,
        COLOUR_MUTED,
      );
      renderer.line(
        x + direction * length,
        y,
        x + direction * (length - 12),
        y + 7,
        3,
        COLOUR_MUTED,
      );
    }
  }

  /**
   * Rule 7: p1's cannon is round-barrelled with a ringed base, p2's is square with a
   * barred one — two cannons facing each other are the pair most likely to be confused
   * once the board has turned.
   */
  #drawCannon(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const y = cannonYOf(seat);
    const sign = firingSign(seat);
    const active = this.#position.active === seat;

    // The barrel, pointing where this seat last aimed — or where it is aiming now.
    const angle = active
      ? this.#position.phase === 'aiming'
        ? this.#position.aim
        : this.#position.lockedAim
      : 0;
    renderer.line(
      CENTRE_X,
      y,
      CENTRE_X + Math.sin(angle) * 62 * -sign,
      y + Math.cos(angle) * 62 * sign,
      14,
      COLOUR_METAL,
    );

    if (seat === 'p1') {
      renderer.circle(CENTRE_X, y, CANNON_RADIUS, palette.base);
      renderer.strokeCircle(CENTRE_X, y, CANNON_RADIUS - 9, 4, palette.deep);
    } else {
      renderer.rect(
        CENTRE_X - CANNON_RADIUS,
        y - CANNON_RADIUS,
        CANNON_RADIUS * 2,
        CANNON_RADIUS * 2,
        palette.base,
      );
      renderer.rect(CENTRE_X - CANNON_RADIUS, y - 4, CANNON_RADIUS * 2, 8, palette.deep);
    }
    renderer.strokeCircle(
      CENTRE_X,
      y,
      CANNON_RADIUS + 4,
      2,
      active ? palette.base : COLOUR_METAL_DEEP,
    );
  }

  #drawShot(renderer: Renderer): void {
    if (this.#position.phase === 'flying') {
      const shot = this.#position.shot;
      renderer.circle(shot.x, shot.y, SHOT_RADIUS, COLOUR_SHOT);
      return;
    }
    if (this.#position.phase !== 'settling') return;
    // Where it ended, marked as a hit or a miss — a ring or a cross, so it reads without
    // colour.
    const shot = this.#position.shot;
    if (this.#position.lastHit) {
      renderer.strokeCircle(shot.x, shot.y, 30, 5, COLOUR_HIT);
      renderer.strokeCircle(shot.x, shot.y, 16, 5, COLOUR_HIT);
    } else {
      renderer.line(shot.x - 18, shot.y - 18, shot.x + 18, shot.y + 18, 5, COLOUR_MISS);
      renderer.line(shot.x + 18, shot.y - 18, shot.x - 18, shot.y + 18, 5, COLOUR_MISS);
    }
  }

  /**
   * The two needles, one at a time, on the firing player's own side.
   *
   * Only the live one is drawn. Two sweeping gauges at once is two things to watch and a
   * press that could mean either; this game asks for one decision, then another.
   */
  #drawGauges(renderer: Renderer): void {
    const phase = this.#position.phase;
    if (phase !== 'aiming' && phase !== 'powering') return;
    const palette = SEAT_PALETTE[this.#position.active];

    renderer.rect(
      CENTRE_X - GAUGE_HALF_WIDTH,
      GAUGE_Y - 12,
      GAUGE_HALF_WIDTH * 2,
      24,
      COLOUR_GROUND,
    );
    // The middle mark: for the angle it is straight ahead, for the power it means nothing,
    // so it is only drawn for the angle.
    if (phase === 'aiming') {
      renderer.rect(CENTRE_X - 2, GAUGE_Y - 20, 4, 40, COLOUR_MUTED);
    }

    const fraction =
      phase === 'aiming'
        ? (this.#position.aim + AIM_SWEEP) / (AIM_SWEEP * 2)
        : this.#position.power;
    const x = CENTRE_X - GAUGE_HALF_WIDTH + fraction * GAUGE_HALF_WIDTH * 2;

    // The power gauge fills behind its needle; the aim gauge does not, because a bigger
    // angle is not a bigger anything. Two different shapes for two different quantities.
    if (phase === 'powering') {
      renderer.rect(
        CENTRE_X - GAUGE_HALF_WIDTH,
        GAUGE_Y - 12,
        fraction * GAUGE_HALF_WIDTH * 2,
        24,
        palette.soft,
      );
    }
    renderer.rect(x - 3, GAUGE_Y - 22, 6, 44, palette.base);
  }

  /** Hits, as pips on each player's own side of the field. */
  #drawHits(renderer: Renderer): void {
    const spacing = 46;
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const palette = SEAT_PALETTE[seat];
      const hits = seat === 'p1' ? this.#position.p1Hits : this.#position.p2Hits;
      const y = seat === 'p1' ? BOARD_HEIGHT - 40 : 40;
      for (let i = 0; i < TARGET_HITS; i += 1) {
        const x = CENTRE_X + (i - (TARGET_HITS - 1) / 2) * spacing;
        const filled = i < hits;
        if (seat === 'p1') renderer.circle(x, y, 12, filled ? palette.base : COLOUR_METAL_DEEP);
        else renderer.rect(x - 11, y - 11, 22, 22, filled ? palette.base : COLOUR_METAL_DEEP);
      }
    }
  }
}
