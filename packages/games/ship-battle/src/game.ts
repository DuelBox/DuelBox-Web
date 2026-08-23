import { GridCursor, Rng, SEAT_PALETTE, SeatFlip, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId } from '@duelbox/engine';
import { misjudgement } from '@duelbox/game-sdk';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BOT_PROFILES,
  HULL_CELLS,
  HULL_COLUMNS,
  HULL_ROWS,
  SHIELD_HALF_X,
  SHIELD_HALF_Y,
  SHIELD_SPEED,
  aimAt,
  beginDefence,
  botTarget,
  breachCount,
  cellAt,
  cellCentreX,
  cellCentreY,
  columnOf,
  coverX,
  coverY,
  createGame,
  defenderOf,
  inHull,
  nudgeShield,
  parkX,
  parkY,
  passTurn,
  resetGame,
  resolveShot,
  rowOf,
  openingAttacker,
  shieldLive,
  shipOf,
  steerShield,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game as Position, Ship } from './rules.js';

/**
 * Board geometry in logical units. Exported because working out which hull section a
 * finger is over is not a rendering question — the tests need the same mapping the game
 * uses, and so does anybody reading the spec.
 */
export const HULL_ORIGIN_X = 90;
export const HULL_ORIGIN_Y = 330;
export const HULL_CELL = 120;
export const HULL_WIDTH = HULL_COLUMNS * HULL_CELL;
export const HULL_HEIGHT = HULL_ROWS * HULL_CELL;

/** The attacker's own ship, drawn small below the board so they can see their own damage. */
export const STRIP_ORIGIN_X = 330;
export const STRIP_ORIGIN_Y = 636;
export const STRIP_CELL = 40;

/** The muzzle every shell leaves from, on the attacker's side of the board. */
export const MUZZLE_X = 450;
export const MUZZLE_Y = 800;

/**
 * The shot clock. Every phase has one, which is what makes the match end: a turn moves on
 * whether or not anybody touches the screen, so no position can sit for ever.
 */
export const AIM_SECONDS = 1.8;
/** The gun is being loaded. A release left over from the last phase cannot fire it. */
export const ARM_SECONDS = 0.3;
export const FLIGHT_SECONDS = 1.4;
export const REVEAL_SECONDS = 0.5;
/** Long enough to see the last section go before the shell puts the result up. */
export const SETTLE_SECONDS = 1.2;
/** A shorter half-turn than the default: it happens once a turn, mid-flight. */
export const FLIP_SECONDS = 0.24;

const COLOUR_SEA = '#071a2b';
const COLOUR_SWELL = 'rgba(120, 190, 235, 0.12)';
const COLOUR_DECK = '#1d2b3a';
const COLOUR_LINE = 'rgba(198, 226, 246, 0.28)';
const COLOUR_TEXT = '#dcecf8';
const COLOUR_MUTED = 'rgba(220, 236, 248, 0.62)';
const COLOUR_BREACH = '#05090f';
const COLOUR_SMOKE = 'rgba(255, 236, 214, 0.85)';
const COLOUR_PLATE = '#b9d6ef';
const COLOUR_PLATE_EDGE = '#f2f8ff';
const COLOUR_WARN = '#ffb03a';
const COLOUR_SHELL = '#ffe6a8';

export class ShipBattleGame implements Game {
  readonly #position: Position = createGame();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #flip = new SeatFlip({ durationSeconds: FLIP_SECONDS });
  readonly #sight = new GridCursor({ columns: HULL_COLUMNS, rows: HULL_ROWS });

  #rng = new Rng(1);
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  #stepsPerSecond = 0;
  #phaseSteps = 0;
  #settleSteps = 0;
  /** Whether the bot laying the gun has settled on a section yet. */
  #aimCommitted = false;
  /** Seconds of the defender's window that have passed with the board settled. */
  #reactElapsed = 0;
  /** One misjudgement of where the shell is going, drawn per shot and acted on throughout. */
  #interceptErrX = 0;
  #interceptErrY = 0;

  /** Exposed for tests, which need to state a position rather than play into one. */
  get position(): Position {
    return this.#position;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    this.#phaseSteps = 0;
    this.#settleSteps = 0;
    this.#aimCommitted = false;
    this.#reactElapsed = 0;
    this.#interceptErrX = 0;
    this.#interceptErrY = 0;
    resetGame(this.#position);
    this.#position.attacker = openingAttacker(this.#rng);
    this.#sight.reset();
    aimAt(this.#position, this.#sight.index);
    this.#flip.snap(this.#shouldRotate());
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#stepsPerSecond === 0 && fixedDeltaSeconds > 0) {
      this.#stepsPerSecond = Math.max(1, Math.round(1 / fixedDeltaSeconds));
    }
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    if (this.#matchWinner !== null) return;

    if (this.#settleSteps > 0) {
      this.#settleSteps -= 1;
      if (this.#settleSteps === 0) this.#matchWinner = winnerOf(this.#position);
      return;
    }

    const phase = this.#position.phase;
    if (phase === 'aim') this.#updateAim(fixedDeltaSeconds, input);
    else if (phase === 'flight') this.#updateFlight(fixedDeltaSeconds, input);
    else if (phase === 'reveal') this.#updateReveal(fixedDeltaSeconds, input);
  }

  /**
   * Laying the gun.
   *
   * The whole enemy hull and the plate on it are on the screen, so both instruments are
   * choosing between twelve sections they can already see. The sight snaps to a section
   * still standing, so a shot is never spent on a hole somebody already made.
   */
  #updateAim(fixedDeltaSeconds: number, input: InputState): void {
    const position = this.#position;
    const attacker = position.attacker;
    this.#phaseSteps += 1;

    const difficulty = attacker === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      const profile = BOT_PROFILES[difficulty];
      const laying = this.#stepsFor(profile.fireSeconds);
      // It swings the gun on to its section part way through, so the person opposite has
      // the same warning of where it is going as a person aiming would give them.
      if (!this.#aimCommitted && this.#phaseSteps * 2 >= laying) {
        const chosen = botTarget(shipOf(position, defenderOf(position)), this.#rng, difficulty);
        if (chosen >= 0) aimAt(position, chosen);
        this.#aimCommitted = true;
      }
      if (this.#phaseSteps >= laying) this.#fire();
      return;
    }

    if (this.#flip.acceptsInput) {
      const seatInput = input.seat(attacker);
      this.#sight.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, this.#flip.rotated);
      const pointer = seatInput.pointer;
      if (pointer !== null) {
        toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
        const under = hullCellAt(this.#pointerWorld.x, this.#pointerWorld.y);
        if (under >= 0) this.#sight.moveTo(under);
      }
      aimAt(position, this.#sight.index);
      if (seatInput.actionReleased && this.#phaseSteps >= this.#stepsFor(ARM_SECONDS)) {
        this.#fire();
        return;
      }
    }

    if (this.#phaseSteps >= this.#stepsFor(AIM_SECONDS)) this.#fire();
  }

  /** Pull the lanyard: the shell is away and the board changes hands. */
  #fire(): void {
    const position = this.#position;
    aimAt(position, position.target);
    beginDefence(position);
    this.#phaseSteps = 0;
    this.#reactElapsed = 0;
    this.#aimCommitted = false;

    const defenderSeat = defenderOf(position);
    const difficulty = defenderSeat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty === null) {
      this.#interceptErrX = 0;
      this.#interceptErrY = 0;
      return;
    }
    // Drawn **once**, here, and acted on for the whole flight. A fresh error every step
    // would average to nothing and every tier would intercept perfectly — the mistake
    // `@duelbox/game-sdk`'s bot-judgement module exists to stop being made a fourth time.
    const spread = BOT_PROFILES[difficulty].aimSpread;
    this.#interceptErrX = misjudgement(this.#rng.float(), spread);
    this.#interceptErrY = misjudgement(this.#rng.float(), spread);
  }

  #updateFlight(fixedDeltaSeconds: number, input: InputState): void {
    const position = this.#position;
    this.#phaseSteps += 1;
    this.#steerDefence(fixedDeltaSeconds, input, position.target);
    if (this.#phaseSteps < this.#stepsFor(FLIGHT_SECONDS)) return;

    resolveShot(position);
    this.#phaseSteps = 0;
    if (winnerOf(position) === null) return;
    position.phase = 'over';
    this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
  }

  /**
   * The smoke after a shot.
   *
   * The board still faces the defender and the plate is still theirs to move, so this is
   * the one window in which it can be repositioned for the next shell. A person uses it;
   * so does the hardest tier, and no tier gets a moment a person does not have.
   */
  #updateReveal(fixedDeltaSeconds: number, input: InputState): void {
    this.#phaseSteps += 1;
    this.#steerDefence(fixedDeltaSeconds, input, -1);
    if (this.#phaseSteps < this.#stepsFor(REVEAL_SECONDS)) return;
    passTurn(this.#position);
    this.#phaseSteps = 0;
    this.#sight.reset();
  }

  /**
   * Slide the plate, for whoever is holding it.
   *
   * `incoming` is the section a shell is on its way to, or -1 when there is none in the
   * air. A pointer names a destination and the keys name a direction, and both are capped
   * at the same {@link SHIELD_SPEED} — so a thumb cannot reach an interception a keyboard
   * could not.
   */
  #steerDefence(fixedDeltaSeconds: number, input: InputState, incoming: number): void {
    if (!this.#flip.acceptsInput) return;
    const position = this.#position;
    const seat = defenderOf(position);
    const ship = shipOf(position, seat);
    const reach = SHIELD_SPEED * fixedDeltaSeconds;
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;

    if (difficulty !== null) {
      const profile = BOT_PROFILES[difficulty];
      if (incoming < 0) {
        if (profile.parks) steerShield(ship, parkX(ship), parkY(ship), reach);
        return;
      }
      // Counted only while the board is settled, because that is when a person can see
      // the shell and reach for the plate. A bot may not start reacting during the turn.
      this.#reactElapsed += fixedDeltaSeconds;
      if (this.#reactElapsed < profile.reactSeconds) return;
      steerShield(
        ship,
        coverX(incoming) + this.#interceptErrX,
        coverY(incoming) + this.#interceptErrY,
        reach,
      );
      return;
    }

    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      steerShield(
        ship,
        (this.#pointerWorld.x - HULL_ORIGIN_X) / HULL_CELL,
        (this.#pointerWorld.y - HULL_ORIGIN_Y) / HULL_CELL,
        reach,
      );
      return;
    }
    // The far seat reads the board half a turn round, so both of their axes invert.
    const flipped = this.#flip.rotated;
    nudgeShield(
      ship,
      flipped ? -seatInput.move.x : seatInput.move.x,
      flipped ? -seatInput.move.y : seatInput.move.y,
      reach,
    );
  }

  #stepsFor(seconds: number): number {
    return Math.max(1, Math.round(seconds * (this.#stepsPerSecond || 60)));
  }

  #shouldRotate(): boolean {
    if (this.#presentation === 'single-seat') return false;
    return this.getActiveSeat() !== this.#localSeat;
  }

  /**
   * Whose turn it is — and it changes twice a turn on purpose.
   *
   * While the gun is being laid the board belongs to the gunner; the moment the shell is
   * away it belongs to the seat it is coming at, who has until it lands to slide the plate
   * in front of it. One seat is acting at every instant, which is what makes a game about
   * reaction fit on one pointer surface.
   */
  getActiveSeat(): SeatId {
    const position = this.#position;
    return position.phase === 'aim' ? position.attacker : defenderOf(position);
  }

  getScore(): MatchScore {
    // Sections breached, which counts up and is the number a player is actually watching.
    return {
      p1: breachCount(this.#position.p2),
      p2: breachCount(this.#position.p1),
      winner: this.#matchWinner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position);
    this.#sight.reset();
    this.#matchWinner = null;
    this.#phaseSteps = 0;
    this.#settleSteps = 0;
    this.#aimCommitted = false;
    this.#reactElapsed = 0;
    this.#interceptErrX = 0;
    this.#interceptErrY = 0;
  }

  render(renderer: Renderer): void {
    const position = this.#position;
    const defender = defenderOf(position);
    renderer.clear(COLOUR_SEA);
    renderer.pushRotation(this.#flip.angle);

    drawSwell(renderer);
    renderer.text(this.#headline(), 450, 96, 44, COLOUR_TEXT, 'centre');

    this.#drawTargetShip(renderer, defender);
    this.#drawGunnerShip(renderer, position.attacker);

    renderer.popSeatRotation();
  }

  #headline(): string {
    const position = this.#position;
    if (position.phase === 'aim') return 'Take aim';
    if (position.phase === 'flight') return 'Incoming';
    if (position.lastResult === 'blocked') return 'Clang — plate holds';
    if (position.lastResult === 'breach') return 'Breach';
    return 'Down she goes';
  }

  /** The hull under fire, drawn large: sections, plate, sight and shell. */
  #drawTargetShip(renderer: Renderer, seat: SeatId): void {
    const position = this.#position;
    const ship = shipOf(position, seat);
    const palette = SEAT_PALETTE[seat];

    renderer.rect(
      HULL_ORIGIN_X - 24,
      HULL_ORIGIN_Y - 22,
      HULL_WIDTH + 48,
      HULL_HEIGHT + 60,
      COLOUR_DECK,
    );
    // A bow wedge at one end, so the two hulls read as ships rather than as grids.
    renderer.line(
      HULL_ORIGIN_X + HULL_WIDTH + 24,
      HULL_ORIGIN_Y - 22,
      HULL_ORIGIN_X + HULL_WIDTH + 70,
      HULL_ORIGIN_Y + HULL_HEIGHT + 8,
      6,
      COLOUR_DECK,
    );
    renderer.line(
      HULL_ORIGIN_X + HULL_WIDTH + 70,
      HULL_ORIGIN_Y + HULL_HEIGHT + 8,
      HULL_ORIGIN_X + HULL_WIDTH + 24,
      HULL_ORIGIN_Y + HULL_HEIGHT + 38,
      6,
      COLOUR_DECK,
    );

    for (let cell = 0; cell < HULL_CELLS; cell += 1) {
      drawSection(renderer, ship, cell, HULL_ORIGIN_X, HULL_ORIGIN_Y, HULL_CELL, seat);
    }
    renderer.strokeRect(HULL_ORIGIN_X, HULL_ORIGIN_Y, HULL_WIDTH, HULL_HEIGHT, 5, palette.base);
    renderer.text(
      `${label(seat)} hull`,
      HULL_ORIGIN_X,
      HULL_ORIGIN_Y - 48,
      30,
      palette.base,
      'left',
    );
    this.#drawCharges(renderer, ship, HULL_ORIGIN_X + HULL_WIDTH, HULL_ORIGIN_Y - 48);

    drawPlate(renderer, ship, HULL_ORIGIN_X, HULL_ORIGIN_Y, HULL_CELL);

    if (position.phase === 'aim') this.#drawSight(renderer, position.attacker);
    if (position.phase === 'flight') this.#drawShell(renderer);
    if (position.phase === 'reveal' || position.phase === 'over') this.#drawImpact(renderer);
  }

  #drawCharges(renderer: Renderer, ship: Ship, rightX: number, y: number): void {
    const out = !shieldLive(ship);
    renderer.text(
      out ? 'plate out' : 'plate',
      rightX - 96,
      y - 10,
      26,
      out ? COLOUR_WARN : COLOUR_MUTED,
      'right',
    );
    for (let i = 0; i < 2; i += 1) {
      const x = rightX - 62 + i * 40;
      if (i < ship.charges && !out) renderer.circle(x, y - 10, 13, COLOUR_PLATE);
      else renderer.strokeCircle(x, y - 10, 13, 4, COLOUR_MUTED);
    }
  }

  /** The crosshair, in the gunner's own colour so nobody has to guess whose it is. */
  #drawSight(renderer: Renderer, attacker: SeatId): void {
    const palette = SEAT_PALETTE[attacker];
    const cell = this.#position.target;
    const x = HULL_ORIGIN_X + cellCentreX(cell) * HULL_CELL;
    const y = HULL_ORIGIN_Y + cellCentreY(cell) * HULL_CELL;
    renderer.strokeCircle(x, y, 44, 5, palette.base);
    renderer.line(x - 62, y, x - 20, y, 5, palette.base);
    renderer.line(x + 20, y, x + 62, y, 5, palette.base);
    renderer.line(x, y - 62, x, y - 20, 5, palette.base);
    renderer.line(x, y + 20, x, y + 62, 5, palette.base);
  }

  #drawShell(renderer: Renderer): void {
    const cell = this.#position.target;
    const flight = this.#stepsFor(FLIGHT_SECONDS);
    const progress = Math.min(1, this.#phaseSteps / flight);
    const toX = HULL_ORIGIN_X + cellCentreX(cell) * HULL_CELL;
    const toY = HULL_ORIGIN_Y + cellCentreY(cell) * HULL_CELL;
    const x = MUZZLE_X + (toX - MUZZLE_X) * progress;
    const lift = Math.sin(Math.PI * progress) * 70;
    const y = MUZZLE_Y + (toY - MUZZLE_Y) * progress - lift;
    // Where it is going, marked from the moment it leaves: the defender is being asked to
    // beat it there, not to guess.
    renderer.strokeCircle(toX, toY, 40, 4, COLOUR_SHELL);
    renderer.line(MUZZLE_X, MUZZLE_Y, x, y, 3, 'rgba(255, 230, 168, 0.35)');
    renderer.circle(x, y, 15, COLOUR_SHELL);
  }

  #drawImpact(renderer: Renderer): void {
    const position = this.#position;
    const cell = position.target;
    const x = HULL_ORIGIN_X + cellCentreX(cell) * HULL_CELL;
    const y = HULL_ORIGIN_Y + cellCentreY(cell) * HULL_CELL;
    if (position.lastResult === 'blocked') {
      for (let i = 0; i < 4; i += 1) {
        const angle = (Math.PI / 4) * (i * 2 + 1);
        renderer.line(
          x + Math.cos(angle) * 22,
          y + Math.sin(angle) * 22,
          x + Math.cos(angle) * 64,
          y + Math.sin(angle) * 64,
          6,
          COLOUR_PLATE_EDGE,
        );
      }
      return;
    }
    renderer.circle(x, y, 40, COLOUR_SMOKE);
    renderer.circle(x, y, 26, COLOUR_BREACH);
  }

  /** The gunner's own ship, small, with the cannon under it. */
  #drawGunnerShip(renderer: Renderer, seat: SeatId): void {
    const ship = shipOf(this.#position, seat);
    const palette = SEAT_PALETTE[seat];
    const width = HULL_COLUMNS * STRIP_CELL;
    const height = HULL_ROWS * STRIP_CELL;

    renderer.rect(STRIP_ORIGIN_X - 10, STRIP_ORIGIN_Y - 8, width + 20, height + 20, COLOUR_DECK);
    for (let cell = 0; cell < HULL_CELLS; cell += 1) {
      drawSection(renderer, ship, cell, STRIP_ORIGIN_X, STRIP_ORIGIN_Y, STRIP_CELL, seat);
    }
    renderer.strokeRect(STRIP_ORIGIN_X, STRIP_ORIGIN_Y, width, height, 3, palette.base);
    drawPlate(renderer, ship, STRIP_ORIGIN_X, STRIP_ORIGIN_Y, STRIP_CELL);
    renderer.text(
      `${label(seat)} hull`,
      STRIP_ORIGIN_X - 16,
      STRIP_ORIGIN_Y + height / 2,
      26,
      palette.base,
      'right',
    );

    // The cannon, trained on wherever the sight is.
    const cell = this.#position.target;
    const toX = HULL_ORIGIN_X + cellCentreX(cell) * HULL_CELL;
    const toY = HULL_ORIGIN_Y + cellCentreY(cell) * HULL_CELL;
    const dx = toX - MUZZLE_X;
    const dy = toY - MUZZLE_Y;
    const span = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    renderer.rect(MUZZLE_X - 46, MUZZLE_Y + 6, 92, 56, COLOUR_DECK);
    renderer.line(
      MUZZLE_X,
      MUZZLE_Y + 20,
      MUZZLE_X + (dx / span) * 78,
      MUZZLE_Y + 20 + (dy / span) * 78,
      16,
      palette.base,
    );
    renderer.circle(MUZZLE_X, MUZZLE_Y + 20, 20, palette.deep);
  }
}

function label(seat: SeatId): string {
  return seat === 'p1' ? 'P1' : 'P2';
}

/** The horizon, so the board reads as a sea rather than as a table. */
function drawSwell(renderer: Renderer): void {
  for (let i = 0; i < 3; i += 1) {
    const y = 200 + i * 240;
    renderer.line(0, y, 900, y, 3, COLOUR_SWELL);
  }
}

/**
 * One hull section.
 *
 * Rule 7: the two ships differ by more than colour. A seat-one section carries one
 * diagonal rib and a seat-two section two, and a breached section is a hole crossed
 * through whoever owns it — all of which survive the colour being taken away.
 */
function drawSection(
  renderer: Renderer,
  ship: Ship,
  cell: number,
  originX: number,
  originY: number,
  size: number,
  seat: SeatId,
): void {
  const palette = SEAT_PALETTE[seat];
  const x = originX + columnOf(cell) * size;
  const y = originY + rowOf(cell) * size;
  const inset = size * 0.03;
  if (ship.breached[cell] === true) {
    renderer.rect(x + inset, y + inset, size - inset * 2, size - inset * 2, COLOUR_BREACH);
    renderer.line(
      x + size * 0.24,
      y + size * 0.24,
      x + size * 0.76,
      y + size * 0.76,
      3,
      COLOUR_SMOKE,
    );
    renderer.line(
      x + size * 0.76,
      y + size * 0.24,
      x + size * 0.24,
      y + size * 0.76,
      3,
      COLOUR_SMOKE,
    );
    return;
  }
  renderer.rect(x + inset, y + inset, size - inset * 2, size - inset * 2, palette.deep);
  const ribs = seat === 'p1' ? 1 : 2;
  for (let rib = 0; rib < ribs; rib += 1) {
    const offset = size * (0.3 + rib * 0.3);
    renderer.line(
      x + offset,
      y + size * 0.18,
      x + offset - size * 0.14,
      y + size * 0.82,
      3,
      palette.base,
    );
  }
  renderer.strokeRect(x + inset, y + inset, size - inset * 2, size - inset * 2, 2, COLOUR_LINE);
}

/** The armour plate: a slab with chevrons, or its dashed outline while it is being rebuilt. */
function drawPlate(
  renderer: Renderer,
  ship: Ship,
  originX: number,
  originY: number,
  size: number,
): void {
  const width = SHIELD_HALF_X * 2 * size;
  const height = SHIELD_HALF_Y * 2 * size;
  const x = originX + ship.shieldX * size - width / 2;
  const y = originY + ship.shieldY * size - height / 2;
  if (!shieldLive(ship)) {
    for (let i = 0; i < 4; i += 1) {
      const at = x + (width / 4) * i;
      renderer.line(at, y, at + width / 8, y, 4, COLOUR_WARN);
      renderer.line(at, y + height, at + width / 8, y + height, 4, COLOUR_WARN);
    }
    renderer.strokeRect(x, y, width, height, 2, COLOUR_WARN);
    return;
  }
  renderer.rect(x, y, width, height, COLOUR_PLATE);
  renderer.strokeRect(x, y, width, height, Math.max(2, size * 0.04), COLOUR_PLATE_EDGE);
  for (let i = 0; i < 3; i += 1) {
    const at = x + width * (0.25 + i * 0.25);
    renderer.line(at - width * 0.08, y + height * 0.2, at, y + height * 0.5, 3, COLOUR_DECK);
    renderer.line(at, y + height * 0.5, at - width * 0.08, y + height * 0.8, 3, COLOUR_DECK);
  }
}

/** The hull section a point is over, or -1. The one mapping a finger goes through. */
export function hullCellAt(x: number, y: number): number {
  const localX = x - HULL_ORIGIN_X;
  const localY = y - HULL_ORIGIN_Y;
  if (localX < 0 || localY < 0 || localX >= HULL_WIDTH || localY >= HULL_HEIGHT) return -1;
  const column = Math.min(HULL_COLUMNS - 1, Math.floor(localX / HULL_CELL));
  const row = Math.min(HULL_ROWS - 1, Math.floor(localY / HULL_CELL));
  if (!inHull(column, row)) return -1;
  return cellAt(column, row);
}
