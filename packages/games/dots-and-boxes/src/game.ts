import {
  Rng,
  SEAT_PALETTE,
  SeatFlip,
  otherSeat,
  seatRotated,
  set,
  toWorld,
  vec2,
} from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BLUNDER_CHANCE,
  BOX_COLUMNS,
  BOX_ROWS,
  DOT_COLUMNS,
  DOT_ROWS,
  EDGE_COUNT,
  H_EDGE_COUNT,
  applyMove,
  bestMove,
  createBoard,
  horizontalEdge,
  isComplete,
  isHorizontal,
  resetBoard,
  tallyOf,
  winnerOf,
} from './rules.js';
import type { Board, BotDifficulty } from './rules.js';

/**
 * Board geometry in logical units. Exported because aiming at an edge is not a rendering
 * question — the bot's pointer path and the tests need the same mapping the game uses.
 */
export const GRID_ORIGIN = 150;
export const GRID_PITCH = 120;
export const GRID_EXTENT = GRID_PITCH * BOX_COLUMNS;

/** How near an edge a tap must land to name it, in logical units. */
export const EDGE_REACH = 44;

const COLOUR_BACKGROUND = '#12161c';
const COLOUR_DOT = '#dfe5ee';
const COLOUR_EMPTY = '#2a323d';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P2 = SEAT_PALETTE.p2.base;
const COLOUR_P1_FILL = SEAT_PALETTE.p1.soft;
const COLOUR_P2_FILL = SEAT_PALETTE.p2.soft;

/** The owner mark stamped in a captured square. Small enough to leave the tint readable. */
const CLAIM_MARK_RADIUS = 9;

/** The owner mark at a claimed edge's midpoint — small, because an edge is thin. */
const EDGE_MARK_RADIUS = 4;

const DOT_RADIUS = 9;
const EDGE_WIDTH = 12;
const GHOST_WIDTH = 5;
const CURSOR_WIDTH = 5;
const CURSOR_OVERHANG = 14;

/** Converted to whole steps before being counted, so a replay is exact. */
const THINK_SECONDS = 0.4;
const SETTLE_SECONDS = 1.1;

/** Where a dot sits, in logical units. */
export function dotCentre(out: Vec2, column: number, row: number): Vec2 {
  return set(out, GRID_ORIGIN + column * GRID_PITCH, GRID_ORIGIN + row * GRID_PITCH);
}

/** The midpoint of an edge — where it is drawn and where a tap is measured against. */
export function edgeCentre(out: Vec2, edge: number): Vec2 {
  if (isHorizontal(edge)) {
    const column = edge % BOX_COLUMNS;
    const row = Math.floor(edge / BOX_COLUMNS);
    return set(out, GRID_ORIGIN + (column + 0.5) * GRID_PITCH, GRID_ORIGIN + row * GRID_PITCH);
  }
  const local = edge - H_EDGE_COUNT;
  const column = local % DOT_COLUMNS;
  const row = Math.floor(local / DOT_COLUMNS);
  return set(out, GRID_ORIGIN + column * GRID_PITCH, GRID_ORIGIN + (row + 0.5) * GRID_PITCH);
}

const probe = vec2();

/**
 * The edge nearest a point, or -1 if none is within reach.
 *
 * Nearest rather than first-within-reach: edges are 120 units apart and the reach is 44,
 * so the zones do not overlap — but "nearest" makes that a property of the geometry
 * rather than of the iteration order, which survives the pitch being changed.
 */
export function edgeIndexAt(x: number, y: number): number {
  let best = -1;
  let bestDistanceSq = EDGE_REACH * EDGE_REACH;
  for (let edge = 0; edge < EDGE_COUNT; edge += 1) {
    edgeCentre(probe, edge);
    const dx = probe.x - x;
    const dy = probe.y - y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      best = edge;
    }
  }
  return best;
}

export class DotsAndBoxesGame implements Game {
  readonly #board: Board = createBoard();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #scratch = vec2();
  readonly #scratchB = vec2();

  #rng = new Rng(1);
  #active: SeatId = 'p1';
  #startingSeat: SeatId = 'p1';
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  /** The board turning to face whoever has the move. */
  readonly #flip = new SeatFlip();

  /**
   * The keyboard's cursor over the edges.
   *
   * Not a `GridCursor`: the playable positions here are the gaps *between* dots rather
   * than cells, so the lattice is two interleaved grids of different shapes. Moving
   * between them is the whole navigation problem and a rectangular cursor cannot express
   * it, so this game owns its own — which is what the shared primitive existing makes
   * obvious rather than hides.
   */
  #cursorEdge = 0;
  #cursorVisible = false;
  #heldX = 0;
  #heldY = 0;
  #repeatIn = 0;

  #stepsPerSecond = 0;
  #thinkSteps = -1;
  #settleSteps = 0;

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#startingSeat = 'p1';
    this.#matchWinner = null;
    this.#resetRound(this.#startingSeat);
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
      if (this.#settleSteps === 0) {
        this.#matchWinner = winnerOf(this.#board);
      }
      return;
    }

    const active = this.#active;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(THINK_SECONDS);
      if (this.#thinkSteps > 0) {
        this.#thinkSteps -= 1;
        return;
      }
      this.#thinkSteps = -1;
      this.#play(bestMove(this.#board, this.#rng, BLUNDER_CHANCE[difficulty]), active);
      return;
    }

    const seatInput = input.seat(active);
    // Nothing is accepted while the board is part-way round: the edge under a finger is
    // moving, so a tap would draw one the player did not mean.
    if (!this.#flip.acceptsInput) return;

    this.#stepCursor(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds);

    if (!seatInput.actionPressed) return;

    let edge = this.#cursorEdge;
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      // The board is drawn under the active seat's rotation, so a device-space tap has to
      // be turned into board space before it names an edge.
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const aimed = edgeIndexAt(this.#pointerWorld.x, this.#pointerWorld.y);
      if (aimed < 0) return;
      edge = aimed;
      // Leave the cursor where the finger went, so switching to keys carries on there.
      this.#cursorEdge = aimed;
    }

    this.#play(edge, active);
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawBoxes(renderer);
    this.#drawEdges(renderer);
    this.#drawCursor(renderer);
    this.#drawDots(renderer);
    renderer.popSeatRotation();
  }

  // Every delay here is counted in steps and the shell stops stepping a paused match, so
  // there is nothing of this game's own to suspend or restart.
  onPause(): void {}

  onResume(): void {}

  getScore(): MatchScore {
    const { p1, p2 } = tallyOf(this.#board);
    return { p1, p2, winner: this.#matchWinner };
  }

  getActiveSeat(): SeatId {
    return this.#active;
  }

  destroy(): void {
    resetBoard(this.#board);
  }

  /** Read-only views for the tests and the harness. */
  get activeSeat(): SeatId {
    return this.#active;
  }

  boxOwner(box: number): SeatId | null {
    return this.#board.boxes[box] ?? null;
  }

  edgeDrawn(edge: number): boolean {
    return this.#board.edges[edge] === true;
  }

  get cursorEdge(): number {
    return this.#cursorEdge;
  }

  #play(edge: number, seat: SeatId): void {
    const claimed = applyMove(this.#board, edge, seat);
    if (claimed < 0) return;
    // Completing a box grants another turn. This one rule is what makes the game about
    // chains rather than about alternating.
    if (claimed === 0) this.#active = otherSeat(seat);
    this.#thinkSteps = -1;
    if (isComplete(this.#board)) this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
  }

  #resetRound(startingSeat: SeatId): void {
    resetBoard(this.#board);
    this.#active = startingSeat;
    this.#thinkSteps = -1;
    this.#settleSteps = 0;
    this.#cursorEdge = horizontalEdge(Math.floor(BOX_COLUMNS / 2), Math.floor(DOT_ROWS / 2));
    this.#cursorVisible = false;
    this.#heldX = 0;
    this.#heldY = 0;
    this.#repeatIn = 0;
  }

  /** The orientation the board should be in, which the flip tweens towards. */
  #shouldRotate(): boolean {
    return seatRotated(this.#active, this.#presentation, this.#localSeat);
  }

  #stepsFor(seconds: number): number {
    const steps = Math.round(seconds * this.#stepsPerSecond);
    return steps < 1 ? 1 : steps;
  }

  /**
   * Move the cursor to the nearest edge in the direction pressed.
   *
   * Geometric rather than index arithmetic: from a horizontal edge, pressing down should
   * reach the vertical edge below it, and those are not adjacent in any index order. So
   * the cursor asks which edge lies nearest in that direction, which is what the player
   * means by "down" and needs no special case for the two lattices.
   */
  #stepCursor(moveX: number, moveY: number, fixedDeltaSeconds: number): void {
    const x = moveX > 0.5 ? 1 : moveX < -0.5 ? -1 : 0;
    const y = moveY > 0.5 ? 1 : moveY < -0.5 ? -1 : 0;
    if (x === 0 && y === 0) {
      this.#heldX = 0;
      this.#heldY = 0;
      this.#repeatIn = 0;
      return;
    }

    const changed = x !== this.#heldX || y !== this.#heldY;
    this.#heldX = x;
    this.#heldY = y;
    if (!changed) {
      this.#repeatIn -= fixedDeltaSeconds;
      if (this.#repeatIn > 0) return;
      this.#repeatIn = 0.12;
    } else {
      this.#repeatIn = 0.4;
    }

    this.#cursorVisible = true;
    // The far seat reads the board half a turn round, so their "up" is the board's down.
    const dx = this.#flip.rotated ? -x : x;
    const dy = this.#flip.rotated ? -y : y;

    edgeCentre(this.#scratch, this.#cursorEdge);
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let edge = 0; edge < EDGE_COUNT; edge += 1) {
      if (edge === this.#cursorEdge) continue;
      edgeCentre(this.#scratchB, edge);
      const offX = this.#scratchB.x - this.#scratch.x;
      const offY = this.#scratchB.y - this.#scratch.y;
      const along = offX * dx + offY * dy;
      if (along <= 0) continue;
      const across = Math.abs(offX * dy - offY * dx);
      // A 45-degree cone, then plain nearest inside it.
      //
      // Weighting sideways drift instead — which is the obvious first attempt — keeps the
      // cursor on whichever lattice it started in: from a horizontal edge, the horizontal
      // edge directly below scores better than the vertical edge that is actually nearer,
      // so half the board becomes unreachable from the keyboard. The cone admits both and
      // lets distance decide, which is what the player means by "down".
      if (across > along) continue;
      const score = offX * offX + offY * offY;
      if (score < bestScore) {
        bestScore = score;
        best = edge;
      }
    }
    if (best >= 0) this.#cursorEdge = best;
  }

  #drawBoxes(renderer: Renderer): void {
    for (let box = 0; box < BOX_COLUMNS * BOX_ROWS; box += 1) {
      const owner = this.#board.boxes[box];
      if (owner === null || owner === undefined) continue;
      const column = box % BOX_COLUMNS;
      const row = Math.floor(box / BOX_COLUMNS);
      const x = GRID_ORIGIN + column * GRID_PITCH;
      const y = GRID_ORIGIN + row * GRID_PITCH;
      const mine = owner === 'p1';
      renderer.rect(x, y, GRID_PITCH, GRID_PITCH, mine ? COLOUR_P1_FILL : COLOUR_P2_FILL);
      // The tint alone was the only thing separating a captured square from the other
      // seat's, which is rule 7 and left the board unreadable in greyscale (#2496). The
      // owner is now stated as a shape too, and it is the same mark the shell uses for a
      // seat: a disc for seat one, a square for seat two, at equal area so neither seat's
      // territory reads as heavier ink.
      const centreX = x + GRID_PITCH / 2;
      const centreY = y + GRID_PITCH / 2;
      if (mine) {
        renderer.circle(centreX, centreY, CLAIM_MARK_RADIUS, COLOUR_P1);
      } else {
        const side = CLAIM_MARK_RADIUS * Math.sqrt(Math.PI);
        renderer.rect(centreX - side / 2, centreY - side / 2, side, side, COLOUR_P2);
      }
    }
  }

  #drawEdges(renderer: Renderer): void {
    for (let edge = 0; edge < EDGE_COUNT; edge += 1) {
      const drawn = this.#board.edges[edge] === true;
      const horizontal = isHorizontal(edge);
      edgeCentre(this.#scratch, edge);
      const half = GRID_PITCH / 2;
      const x1 = horizontal ? this.#scratch.x - half : this.#scratch.x;
      const y1 = horizontal ? this.#scratch.y : this.#scratch.y - half;
      const x2 = horizontal ? this.#scratch.x + half : this.#scratch.x;
      const y2 = horizontal ? this.#scratch.y : this.#scratch.y + half;
      // Undrawn edges are drawn faintly rather than not at all: a player needs to see
      // where the moves are, and an empty lattice of dots does not show that.
      // A claimed edge also carries its owner's shape at its midpoint: a disc for seat one,
      // a square for seat two, at equal area. A captured square gets the same mark, but a
      // capture is rare and an edge is claimed every turn, so this is the one that makes
      // the board readable in greyscale from the first move (#2496).
      if (drawn) {
        const owner = this.#board.edgeOwners[edge];
        if (owner === 'p1') {
          renderer.circle(this.#scratch.x, this.#scratch.y, EDGE_MARK_RADIUS, COLOUR_P1);
        } else if (owner === 'p2') {
          const side = EDGE_MARK_RADIUS * Math.sqrt(Math.PI);
          renderer.rect(
            this.#scratch.x - side / 2,
            this.#scratch.y - side / 2,
            side,
            side,
            COLOUR_P2,
          );
        }
      }
      renderer.line(
        x1,
        y1,
        x2,
        y2,
        drawn ? EDGE_WIDTH : GHOST_WIDTH,
        drawn ? (this.#board.edgeOwners[edge] === 'p1' ? COLOUR_P1 : COLOUR_P2) : COLOUR_EMPTY,
      );
    }
  }

  #drawCursor(renderer: Renderer): void {
    if (!this.#cursorVisible) return;
    if (this.#matchWinner !== null) return;
    const edge = this.#cursorEdge;
    const horizontal = isHorizontal(edge);
    edgeCentre(this.#scratch, edge);
    const half = GRID_PITCH / 2 + CURSOR_OVERHANG;
    renderer.line(
      horizontal ? this.#scratch.x - half : this.#scratch.x,
      horizontal ? this.#scratch.y : this.#scratch.y - half,
      horizontal ? this.#scratch.x + half : this.#scratch.x,
      horizontal ? this.#scratch.y : this.#scratch.y + half,
      CURSOR_WIDTH,
      this.#active === 'p1' ? COLOUR_P1 : COLOUR_P2,
    );
  }

  #drawDots(renderer: Renderer): void {
    for (let row = 0; row < DOT_ROWS; row += 1) {
      for (let column = 0; column < DOT_COLUMNS; column += 1) {
        dotCentre(this.#scratch, column, row);
        renderer.circle(this.#scratch.x, this.#scratch.y, DOT_RADIUS, COLOUR_DOT);
      }
    }
  }
}

export default {
  manifest,
  create: (): Game => new DotsAndBoxesGame(),
};
