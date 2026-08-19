import { otherSeat, set, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, Vec2 } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type {
  Game,
  GameContext,
  InputState,
  MatchScore,
  Renderer,
  SeatInput,
  WinCondition,
} from '@duelbox/game-sdk';
import {
  BOT_PROFILES,
  GRID_COLUMNS,
  GRID_ROWS,
  HOLE_COUNT,
  MOLE_SHAPE,
  NO_HOLE,
  botTarget,
  createMoles,
  hit,
  retireAll,
  spawn,
  spawnRateAt,
  step,
} from './rules.js';
import type { BotDifficulty, HitResult, Mole } from './rules.js';

/** Hits that win a match. A penalty can never carry a seat back below zero. */
export const TARGET_HITS = 30;

/**
 * Board geometry in logical units — the same 600x1000 box the manifest declares, never
 * pixels. Exported because naming the hole under a finger is not a rendering question:
 * the tests and any pointer-driven harness need the mapping the game itself uses.
 */
export const CELL_EXTENT = 140;
export const BOARD_WIDTH = CELL_EXTENT * GRID_COLUMNS;
export const BOARD_HEIGHT = CELL_EXTENT * GRID_ROWS;
export const BOARD_X = 20;
export const BOARD_Y = 290;
export const HOLE_RADIUS = 52;

/** Steps a strike's +1, -1 or miss stays on the HUD. */
export const FEEDBACK_STEPS = 24;

/** Seconds a held direction key waits before the selection cursor moves on again. */
const CURSOR_REPEAT_SECONDS = 0.13;

/**
 * How far open an axis has to be to count as a direction. Two keys at once arrive
 * normalised, at about 0.71 each, so a diagonal still steps the cursor on both axes.
 */
const AXIS_THRESHOLD = 0.5;

const MOLE_RADIUS = 46;
/** How far a fully risen mole stands above its hole, in logical units. */
const MOLE_LIFT = 26;
const RISE_SECONDS = 0.12;
const SINK_SECONDS = 0.16;

const COLOUR_BACKGROUND = '#101725';
const COLOUR_PANEL = '#1b2740';
const COLOUR_LINE = 'rgba(233, 240, 252, 0.35)';
const COLOUR_HOLE = '#0a1020';
const COLOUR_HOLE_RIM = 'rgba(233, 240, 252, 0.22)';
const COLOUR_P1 = '#3d7bff';
const COLOUR_P2 = '#ff8a3d';
const COLOUR_INK = '#0b1220';
const COLOUR_TEXT = '#e9f0fc';
const COLOUR_PENALTY = '#ff5a5a';
const COLOUR_MISS = 'rgba(233, 240, 252, 0.5)';

const PANEL_PAD = 18;
const GLYPH_RADIUS = 26;
const SCORE_SIZE = 46;
const FEEDBACK_SIZE = 32;
const HUD_X = 44;
const HUD_Y = 930;
const HUD_TOP_Y = 70;
const SCORE_OFFSET = 74;
const FEEDBACK_OFFSET = 168;

const FEEDBACK_LABELS: Readonly<Record<HitResult, string>> = Object.freeze({
  own: '+1',
  other: '-1',
  miss: 'miss',
});

/** Scores never exceed the target, so the HUD never has to build a string per frame. */
const COUNT_LABELS: readonly string[] = buildCountLabels();

function buildCountLabels(): string[] {
  const labels: string[] = [];
  for (let count = 0; count <= TARGET_HITS; count += 1) labels.push(String(count));
  return labels;
}

function countLabel(count: number): string {
  const label = COUNT_LABELS[count];
  return label === undefined ? '' : label;
}

/** Centre of a hole in logical units. Writes into `out` and allocates nothing. */
export function holeCentre(out: Vec2, hole: number): Vec2 {
  const column = hole % GRID_COLUMNS;
  const row = Math.floor(hole / GRID_COLUMNS);
  return set(out, BOARD_X + (column + 0.5) * CELL_EXTENT, BOARD_Y + (row + 0.5) * CELL_EXTENT);
}

/** Hole a point in logical space falls in, or {@link NO_HOLE} when it misses the board. */
export function holeIndexAt(x: number, y: number): number {
  const localX = x - BOARD_X;
  const localY = y - BOARD_Y;
  if (localX < 0 || localY < 0 || localX >= BOARD_WIDTH || localY >= BOARD_HEIGHT) return NO_HOLE;
  const column = Math.floor(localX / CELL_EXTENT);
  const row = Math.floor(localY / CELL_EXTENT);
  return row * GRID_COLUMNS + column;
}

/** How far out of its hole a mole stands, in [0, 1], from its age alone. */
function riseOf(mole: Readonly<Mole>): number {
  if (mole.upSeconds < RISE_SECONDS) return mole.upSeconds / RISE_SECONDS;
  const left = mole.lifetime - mole.upSeconds;
  if (left < SINK_SECONDS) return left < 0 ? 0 : left / SINK_SECONDS;
  return 1;
}

function feedbackColour(result: HitResult, seat: SeatId): string {
  if (result === 'other') return COLOUR_PENALTY;
  if (result === 'miss') return COLOUR_MISS;
  return seat === 'p1' ? COLOUR_P1 : COLOUR_P2;
}

function axis(value: number): number {
  if (value > AXIS_THRESHOLD) return 1;
  if (value < -AXIS_THRESHOLD) return -1;
  return 0;
}

function clampIndex(value: number, count: number): number {
  if (value < 0) return 0;
  if (value > count - 1) return count - 1;
  return value;
}

/** One seat's controls and feedback. Both are allocated once, at construction. */
interface SeatRuntime {
  /** Hole the keyboard cursor sits on, and the hole the action key strikes. */
  cursor: number;
  dx: number;
  dy: number;
  repeatSeconds: number;
  /** Seconds a bot must wait before its next swing. Unused by a human seat. */
  cooldownSeconds: number;
  /** A seat that has tapped hides its cursor until it uses the direction keys again. */
  usesPointer: boolean;
  feedback: HitResult | null;
  feedbackSteps: number;
}

function createRuntime(cursor: number): SeatRuntime {
  return {
    cursor,
    dx: 0,
    dy: 0,
    repeatSeconds: 0,
    cooldownSeconds: 0,
    usesPointer: false,
    feedback: null,
    feedbackSteps: 0,
  };
}

function resetRuntime(runtime: SeatRuntime, cursor: number): void {
  runtime.cursor = cursor;
  runtime.dx = 0;
  runtime.dy = 0;
  runtime.repeatSeconds = 0;
  runtime.cooldownSeconds = 0;
  runtime.usesPointer = false;
  runtime.feedback = null;
  runtime.feedbackSteps = 0;
}

/** Where each seat's cursor starts: the corner of the grid nearest that seat. */
const START_CURSOR: Readonly<Record<SeatId, number>> = Object.freeze({
  p1: HOLE_COUNT - GRID_COLUMNS,
  p2: GRID_COLUMNS - 1,
});

export class WhackaMoleGame implements Game {
  readonly #moles: Mole[] = createMoles();
  readonly #tally = { p1: 0, p2: 0 };
  readonly #condition: WinCondition = { kind: 'first-to', target: TARGET_HITS };
  readonly #runtimeP1: SeatRuntime = createRuntime(START_CURSOR.p1);
  readonly #runtimeP2: SeatRuntime = createRuntime(START_CURSOR.p2);
  /** Render-only scratch. Written during render(), never read by the simulation. */
  readonly #scratch: Vec2 = vec2();

  #context: GameContext | null = null;
  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;
  #elapsedSteps = 0;

  /** Read-only view for the harness and the tests. Never mutate through it. */
  get moles(): readonly Readonly<Mole>[] {
    return this.#moles;
  }

  get elapsedSteps(): number {
    return this.#elapsedSteps;
  }

  /** Hole this seat's selection cursor sits on. */
  cursorFor(seat: SeatId): number {
    return this.#runtime(seat).cursor;
  }

  /** Result of this seat's most recent swing, or null before it has taken one. */
  lastStrike(seat: SeatId): HitResult | null {
    return this.#runtime(seat).feedback;
  }

  init(context: GameContext): void {
    this.#context = context;
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#tally.p1 = 0;
    this.#tally.p2 = 0;
    this.#winner = null;
    this.#elapsedSteps = 0;
    retireAll(this.#moles);
    resetRuntime(this.#runtimeP1, START_CURSOR.p1);
    resetRuntime(this.#runtimeP2, START_CURSOR.p2);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    const context = this.#context;
    if (context === null) return;
    if (this.#winner !== null) return;

    step(this.#moles, fixedDeltaSeconds);

    // Which seat resolves first alternates every step. Two seats swinging at the same
    // hole in one step are well inside any reaction-time tolerance, the mole is a single
    // object and only one of them can take it — a fixed order would hand every one of
    // those ties to the same seat for the whole match.
    const p1First = (this.#elapsedSteps & 1) === 0;
    this.#driveSeat(p1First ? 'p1' : 'p2', input, fixedDeltaSeconds, context);
    this.#driveSeat(p1First ? 'p2' : 'p1', input, fixedDeltaSeconds, context);

    const elapsedSeconds = this.#elapsedSteps * fixedDeltaSeconds;
    spawn(this.#moles, HOLE_COUNT, context.rng, fixedDeltaSeconds, spawnRateAt(elapsedSeconds));
    this.#elapsedSteps += 1;

    // Resolved once, after both seats have swung, so a step in which both cross the
    // target is settled by the SDK as the tie it is rather than by whoever went first.
    this.#winner = resolve(this.#condition, this.#tally);
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    this.#drawBoard(renderer);
    this.#drawMoles(renderer);
    this.#drawCursor(renderer, 'p1');
    this.#drawCursor(renderer, 'p2');
    this.#drawHuds(renderer);
  }

  onPause(): void {
    this.#settle();
  }

  onResume(): void {
    // A direction key still down across a pause must not read as a fresh press, and a
    // cursor must not sprint across the grid on the first step back.
    this.#settle();
  }

  getScore(): MatchScore {
    return { p1: this.#tally.p1, p2: this.#tally.p2, winner: this.#winner };
  }

  destroy(): void {
    this.#context = null;
    this.#botP1 = null;
    this.#botP2 = null;
    retireAll(this.#moles);
    resetRuntime(this.#runtimeP1, START_CURSOR.p1);
    resetRuntime(this.#runtimeP2, START_CURSOR.p2);
    this.#tally.p1 = 0;
    this.#tally.p2 = 0;
    this.#winner = null;
    this.#elapsedSteps = 0;
  }

  #runtime(seat: SeatId): SeatRuntime {
    return seat === 'p1' ? this.#runtimeP1 : this.#runtimeP2;
  }

  /** True when this seat reads the device upside down and its controls must mirror. */
  #isRotated(seat: SeatId): boolean {
    return this.#presentation === 'shared-screen' && seat !== this.#localSeat;
  }

  #driveSeat(seat: SeatId, input: InputState, dt: number, context: GameContext): void {
    const runtime = this.#runtime(seat);
    if (runtime.feedbackSteps > 0) runtime.feedbackSteps -= 1;

    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      if (runtime.cooldownSeconds > 0) {
        runtime.cooldownSeconds -= dt;
        return;
      }
      const hole = botTarget(this.#moles, seat, difficulty, context.rng);
      if (hole === NO_HOLE) return;
      runtime.cooldownSeconds = BOT_PROFILES[difficulty].strikeSeconds;
      runtime.cursor = hole;
      this.#strike(seat, hole, runtime);
      return;
    }

    const seatInput = input.seat(seat);
    this.#moveCursor(seat, runtime, seatInput, dt);
    if (!seatInput.actionPressed) return;

    const pointer = seatInput.pointer;
    if (pointer === null) {
      this.#strike(seat, runtime.cursor, runtime);
      return;
    }
    // The board is common ground drawn in one orientation, so a tap is already in board
    // space; nothing here needs turning the way a rotated turn-based board would.
    const hole = holeIndexAt(pointer.x, pointer.y);
    runtime.usesPointer = true;
    if (hole === NO_HOLE) return;
    runtime.cursor = hole;
    this.#strike(seat, hole, runtime);
  }

  #moveCursor(seat: SeatId, runtime: SeatRuntime, seatInput: SeatInput, dt: number): void {
    // A seat reading the device upside down means the opposite direction by every key,
    // so its axes mirror. Nothing else about the two seats differs.
    const mirror = this.#isRotated(seat) ? -1 : 1;
    const dx = axis(seatInput.move.x) * mirror;
    const dy = axis(seatInput.move.y) * mirror;
    if (dx !== runtime.dx || dy !== runtime.dy) runtime.repeatSeconds = 0;
    runtime.dx = dx;
    runtime.dy = dy;

    if (dx === 0 && dy === 0) {
      runtime.repeatSeconds = 0;
      return;
    }
    if (runtime.repeatSeconds > 0) {
      runtime.repeatSeconds -= dt;
      return;
    }
    runtime.repeatSeconds = CURSOR_REPEAT_SECONDS;
    const column = clampIndex((runtime.cursor % GRID_COLUMNS) + dx, GRID_COLUMNS);
    const row = clampIndex(Math.floor(runtime.cursor / GRID_COLUMNS) + dy, GRID_ROWS);
    runtime.cursor = row * GRID_COLUMNS + column;
    runtime.usesPointer = false;
  }

  #strike(seat: SeatId, hole: number, runtime: SeatRuntime): void {
    const result = hit(this.#moles, hole, seat);
    runtime.feedback = result;
    runtime.feedbackSteps = FEEDBACK_STEPS;
    if (result === 'own') this.#addScore(seat, 1);
    else if (result === 'other') this.#addScore(seat, -1);
  }

  #addScore(seat: SeatId, delta: number): void {
    // A penalty may never take a seat below zero: a negative score is not a score, and a
    // player who is behind has to be able to read the gap they still have to close.
    const next = (seat === 'p1' ? this.#tally.p1 : this.#tally.p2) + delta;
    const floored = next < 0 ? 0 : next;
    if (seat === 'p1') this.#tally.p1 = floored;
    else this.#tally.p2 = floored;
  }

  #settle(): void {
    this.#runtimeP1.dx = 0;
    this.#runtimeP1.dy = 0;
    this.#runtimeP1.repeatSeconds = 0;
    this.#runtimeP2.dx = 0;
    this.#runtimeP2.dy = 0;
    this.#runtimeP2.repeatSeconds = 0;
  }

  #drawBoard(renderer: Renderer): void {
    renderer.rect(
      BOARD_X - PANEL_PAD,
      BOARD_Y - PANEL_PAD,
      BOARD_WIDTH + PANEL_PAD * 2,
      BOARD_HEIGHT + PANEL_PAD * 2,
      COLOUR_PANEL,
    );
    renderer.strokeRect(
      BOARD_X - PANEL_PAD,
      BOARD_Y - PANEL_PAD,
      BOARD_WIDTH + PANEL_PAD * 2,
      BOARD_HEIGHT + PANEL_PAD * 2,
      4,
      COLOUR_LINE,
    );
    for (let hole = 0; hole < HOLE_COUNT; hole += 1) {
      holeCentre(this.#scratch, hole);
      renderer.circle(this.#scratch.x, this.#scratch.y, HOLE_RADIUS, COLOUR_HOLE);
      renderer.strokeCircle(this.#scratch.x, this.#scratch.y, HOLE_RADIUS, 4, COLOUR_HOLE_RIM);
    }
  }

  #drawMoles(renderer: Renderer): void {
    for (let i = 0; i < this.#moles.length; i += 1) {
      const mole = this.#moles[i];
      if (mole === undefined || mole.hole === NO_HOLE) continue;
      holeCentre(this.#scratch, mole.hole);
      const rise = riseOf(mole);
      this.#drawMole(
        renderer,
        mole.seat,
        this.#scratch.x,
        this.#scratch.y - MOLE_LIFT * rise,
        MOLE_RADIUS * (0.6 + 0.4 * rise),
      );
    }
  }

  /**
   * p1's mole is round with big ears, p2's is square with horns, exactly as
   * {@link MOLE_SHAPE} declares. Telling the two apart at speed is the entire mechanic,
   * so the outline carries it and the colours only reinforce it: the board stays playable
   * in greyscale and to a colour-blind player.
   */
  #drawMole(renderer: Renderer, seat: SeatId, x: number, y: number, radius: number): void {
    const colour = seat === 'p1' ? COLOUR_P1 : COLOUR_P2;
    const stroke = radius * 0.09;
    if (MOLE_SHAPE[seat] === 'round') {
      const ear = radius * 0.38;
      renderer.circle(x - radius * 0.68, y - radius * 0.68, ear, colour);
      renderer.circle(x + radius * 0.68, y - radius * 0.68, ear, colour);
      renderer.circle(x, y, radius, colour);
      renderer.strokeCircle(x, y, radius - stroke, stroke, COLOUR_INK);
      renderer.circle(x, y + radius * 0.3, radius * 0.22, COLOUR_INK);
      return;
    }
    const hornWidth = radius * 0.2;
    const hornTip = y - radius * 1.5;
    renderer.line(x - radius * 0.62, y - radius * 0.6, x - radius, hornTip, hornWidth, colour);
    renderer.line(x + radius * 0.62, y - radius * 0.6, x + radius, hornTip, hornWidth, colour);
    renderer.rect(x - radius, y - radius, radius * 2, radius * 2, colour);
    renderer.strokeRect(
      x - radius + stroke,
      y - radius + stroke,
      radius * 2 - stroke * 2,
      radius * 2 - stroke * 2,
      stroke,
      COLOUR_INK,
    );
    renderer.rect(x - radius * 0.24, y + radius * 0.1, radius * 0.48, radius * 0.44, COLOUR_INK);
  }

  #drawCursor(renderer: Renderer, seat: SeatId): void {
    const runtime = this.#runtime(seat);
    if (runtime.usesPointer) return;
    holeCentre(this.#scratch, runtime.cursor);
    const x = this.#scratch.x;
    const y = this.#scratch.y;
    const colour = seat === 'p1' ? COLOUR_P1 : COLOUR_P2;
    // The reticle repeats the seat's own silhouette — a ring for the round mole, a box
    // for the square one — so a glance says whose cursor it is without reading its colour.
    if (MOLE_SHAPE[seat] === 'round') {
      renderer.strokeCircle(x, y, HOLE_RADIUS + 10, 5, colour);
      return;
    }
    const half = HOLE_RADIUS + 10;
    renderer.strokeRect(x - half, y - half, half * 2, half * 2, 5, colour);
  }

  #drawHuds(renderer: Renderer): void {
    const local = this.#localSeat;
    const far = otherSeat(local);
    const rotated = this.#isRotated(far);
    this.#drawHud(renderer, local, HUD_Y);
    // Turned half a turn for the seat opposite, so that seat reads its own score upright.
    // In single-seat play nothing is rotated, so the far seat's row goes to the top edge
    // rather than landing on top of the local one.
    renderer.pushSeatRotation(rotated);
    this.#drawHud(renderer, far, rotated ? HUD_Y : HUD_TOP_Y);
    renderer.popSeatRotation();
  }

  #drawHud(renderer: Renderer, seat: SeatId, y: number): void {
    const runtime = this.#runtime(seat);
    const tally = seat === 'p1' ? this.#tally.p1 : this.#tally.p2;
    this.#drawMole(renderer, seat, HUD_X, y, GLYPH_RADIUS);
    renderer.text(countLabel(tally), HUD_X + SCORE_OFFSET, y, SCORE_SIZE, COLOUR_TEXT);
    if (runtime.feedbackSteps === 0 || runtime.feedback === null) return;
    renderer.text(
      FEEDBACK_LABELS[runtime.feedback],
      HUD_X + FEEDBACK_OFFSET,
      y,
      FEEDBACK_SIZE,
      feedbackColour(runtime.feedback, seat),
    );
  }
}
