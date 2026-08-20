import { GridCursor, Rng, SEAT_PALETTE, SeatFlip, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  AT_START,
  HOME,
  HOME_RUN,
  TOKENS,
  TRACK,
  botMove,
  canMove,
  createGame,
  hasMove,
  isHome,
  leadOf,
  loopSquare,
  move,
  passTurn,
  resetGame,
  roll,
  tokensOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game as Position } from './rules.js';

/** Board geometry in logical units. Exported because the tests need the same mapping. */
export const BOARD = 900;
export const RING_INSET = 130;
export const TOKEN_RADIUS = 26;
export const START_RADIUS = 22;

export const DIE_SIZE = 108;
export const DIE_X = (BOARD - DIE_SIZE) / 2;
export const DIE_Y = (BOARD - DIE_SIZE) / 2;

const COLOUR_BACKGROUND = '#191426';
const COLOUR_TRACK = '#2b2440';
const COLOUR_TRACK_EDGE = '#3d3459';
const COLOUR_DIE = '#f5f1ea';
const COLOUR_INK = '#191426';
const COLOUR_TEXT = '#ece7f6';
const COLOUR_MUTED = 'rgba(236, 231, 246, 0.55)';

const THINK_SECONDS = 0.6;
const PASS_SECONDS = 1.0;
const SETTLE_SECONDS = 1.1;

/**
 * The centre of a square of the shared loop.
 *
 * A ring rather than the cross a full Ludo board uses: two seats do not need four arms,
 * and a ring puts every square the same distance from the die in the middle, so no square
 * is harder to reach with a thumb than another.
 */
export function squareCentre(square: number): { x: number; y: number } {
  const angle = (square / TRACK) * Math.PI * 2 - Math.PI / 2;
  const radius = BOARD / 2 - RING_INSET;
  return {
    x: BOARD / 2 + Math.cos(angle) * radius,
    y: BOARD / 2 + Math.sin(angle) * radius,
  };
}

/** Where a token in its home column sits: inside the ring, walking toward the middle. */
export function homeCentre(seat: SeatId, progress: number): { x: number; y: number } {
  const stepsIn = progress - TRACK + 1;
  const angle = (loopEntryAngle(seat) / TRACK) * Math.PI * 2 - Math.PI / 2;
  const radius =
    BOARD / 2 - RING_INSET - stepsIn * ((BOARD / 2 - RING_INSET - 120) / (HOME_RUN + 1));
  return {
    x: BOARD / 2 + Math.cos(angle) * radius,
    y: BOARD / 2 + Math.sin(angle) * radius,
  };
}

function loopEntryAngle(seat: SeatId): number {
  return seat === 'p1' ? 0 : TRACK / 2;
}

/**
 * Where a token waits before it is released.
 *
 * Inside the ring, either side of the die, rather than in a row at the top and bottom of
 * the board. The rows collided with the status line and left the busiest part of the
 * screen — the edges, where a thumb rests — carrying tokens nobody can tap yet.
 */
export function startCentre(seat: SeatId, token: number): { x: number; y: number } {
  const x = BOARD / 2 + (seat === 'p1' ? -190 : 190);
  return { x, y: BOARD / 2 - (TOKENS - 1) * 34 + token * 68 };
}

/** Where a token is drawn, whatever it is doing. */
export function tokenCentre(
  seat: SeatId,
  progress: number,
  token: number,
): { x: number; y: number } {
  if (progress === AT_START) return startCentre(seat, token);
  if (progress >= TRACK) return homeCentre(seat, progress);
  return squareCentre(loopSquare(seat, progress));
}

export class LudoGame implements Game {
  readonly #position: Position = createGame();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #flip = new SeatFlip();
  readonly #cursor = new GridCursor({ columns: TOKENS, rows: 1 });

  #rng = new Rng(1);
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | null = null;

  #stepsPerSecond = 0;
  #thinkSteps = -1;
  #passSteps = 0;
  #settleSteps = 0;

  get position(): Position {
    return this.#position;
  }

  get cursorToken(): number {
    return this.#cursor.index;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    this.#thinkSteps = -1;
    this.#passSteps = 0;
    this.#settleSteps = 0;
    resetGame(this.#position);
    this.#cursor.reset();
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
    if (this.#position.phase === 'over') {
      this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
      return;
    }

    // A roll with no move in it is held for a beat before the turn changes hands. A turn
    // that silently bounces back looks like the game ignored someone.
    //
    // Checked here rather than only where the die is rolled. Tying it to the roll left a
    // stuck state reachable — anything that put the game in `choosing` by another route
    // sat there for ever with no move and no pass — and a rule about the position belongs
    // where the position is read.
    if (
      this.#passSteps === 0 &&
      this.#position.phase === 'choosing' &&
      !hasMove(this.#position, this.#position.seat, this.#position.die)
    ) {
      this.#passSteps = this.#stepsFor(PASS_SECONDS);
    }

    if (this.#passSteps > 0) {
      this.#passSteps -= 1;
      if (this.#passSteps === 0) {
        passTurn(this.#position);
        this.#cursor.reset();
      }
      return;
    }

    const seat = this.#position.seat;
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      this.#updateBot(difficulty);
      return;
    }
    if (!this.#flip.acceptsInput) return;
    this.#updateHuman(fixedDeltaSeconds, input.seat(seat));
  }

  #updateBot(difficulty: BotDifficulty): void {
    if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(THINK_SECONDS);
    if (this.#thinkSteps > 0) {
      this.#thinkSteps -= 1;
      return;
    }
    this.#thinkSteps = -1;

    if (this.#position.phase === 'rolling') {
      roll(this.#position, this.#rng);
      return;
    }
    const token = botMove(this.#position, this.#rng, difficulty);
    if (token >= 0) move(this.#position, token);
  }

  #updateHuman(fixedDeltaSeconds: number, seatInput: ReturnType<InputState['seat']>): void {
    if (this.#position.phase === 'rolling') {
      if (!seatInput.actionPressed) return;
      roll(this.#position, this.#rng);
      return;
    }

    this.#cursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, this.#flip.rotated);

    const pointer = seatInput.pointer;
    if (pointer !== null && seatInput.actionPressed) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const tapped = this.#tokenAt(this.#pointerWorld.x, this.#pointerWorld.y);
      if (tapped < 0) return;
      this.#cursor.moveTo(tapped);
      move(this.#position, tapped);
      return;
    }
    if (seatInput.actionPressed) move(this.#position, this.#cursor.index);
  }

  /** The seat's own token a point falls on, or -1. */
  #tokenAt(x: number, y: number): number {
    const seat = this.#position.seat;
    const tokens = tokensOf(this.#position, seat);
    for (let token = 0; token < TOKENS; token += 1) {
      const centre = tokenCentre(seat, tokens[token] ?? AT_START, token);
      if (Math.hypot(centre.x - x, centre.y - y) <= TOKEN_RADIUS + 8) return token;
    }
    return -1;
  }

  #stepsFor(seconds: number): number {
    return Math.max(1, Math.round(seconds * (this.#stepsPerSecond || 60)));
  }

  #shouldRotate(): boolean {
    if (this.#presentation === 'single-seat') return false;
    return this.#position.seat !== this.#localSeat;
  }

  getActiveSeat(): SeatId {
    return this.#position.seat;
  }

  getScore(): MatchScore {
    // How far each side's leading token has come, which is the race a player is watching.
    return {
      p1: leadOf(this.#position, 'p1'),
      p2: leadOf(this.#position, 'p2'),
      winner: this.#matchWinner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position);
    this.#matchWinner = null;
    this.#thinkSteps = -1;
    this.#passSteps = 0;
    this.#settleSteps = 0;
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawTrack(renderer);
    this.#drawDie(renderer);
    this.#drawTokens(renderer);
    this.#drawStatus(renderer);
    renderer.popSeatRotation();
  }

  #drawTrack(renderer: Renderer): void {
    for (let square = 0; square < TRACK; square += 1) {
      const centre = squareCentre(square);
      // Each seat's entry square carries its colour, so a player can see where they join.
      const entry =
        loopSquare('p1', 0) === square
          ? SEAT_PALETTE.p1.deep
          : loopSquare('p2', 0) === square
            ? SEAT_PALETTE.p2.deep
            : COLOUR_TRACK;
      renderer.circle(centre.x, centre.y, TOKEN_RADIUS + 4, entry);
      renderer.strokeCircle(centre.x, centre.y, TOKEN_RADIUS + 4, 2, COLOUR_TRACK_EDGE);
    }
    // The two home columns, running in toward the middle.
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      for (let step = TRACK; step < HOME; step += 1) {
        const centre = homeCentre(seat, step);
        renderer.strokeCircle(centre.x, centre.y, TOKEN_RADIUS - 2, 3, SEAT_PALETTE[seat].soft);
      }
    }
  }

  #drawDie(renderer: Renderer): void {
    const die = this.#position.die;
    if (die === 0) {
      renderer.strokeRect(DIE_X, DIE_Y, DIE_SIZE, DIE_SIZE, 4, COLOUR_MUTED);
      renderer.text('Roll', BOARD / 2, BOARD / 2 + 10, 30, COLOUR_MUTED, 'centre');
      return;
    }
    renderer.rect(DIE_X, DIE_Y, DIE_SIZE, DIE_SIZE, COLOUR_DIE);
    const near = DIE_SIZE * 0.26;
    const far = DIE_SIZE - near;
    const mid = DIE_SIZE / 2;
    const radius = DIE_SIZE * 0.085;
    const spots: readonly (readonly [number, number])[] =
      die === 1
        ? [[mid, mid]]
        : die === 2
          ? [
              [near, near],
              [far, far],
            ]
          : die === 3
            ? [
                [near, near],
                [mid, mid],
                [far, far],
              ]
            : die === 4
              ? [
                  [near, near],
                  [far, near],
                  [near, far],
                  [far, far],
                ]
              : die === 5
                ? [
                    [near, near],
                    [far, near],
                    [mid, mid],
                    [near, far],
                    [far, far],
                  ]
                : [
                    [near, near],
                    [far, near],
                    [near, mid],
                    [far, mid],
                    [near, far],
                    [far, far],
                  ];
    for (const [dx, dy] of spots) renderer.circle(DIE_X + dx, DIE_Y + dy, radius, COLOUR_INK);
  }

  /**
   * Rule 7: p1's tokens are discs with a ring, p2's are discs with a bar. A token that
   * cannot take this roll is drawn hollow, so a player is never left tapping a dead one.
   */
  #drawTokens(renderer: Renderer): void {
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const tokens = tokensOf(this.#position, seat);
      const palette = SEAT_PALETTE[seat];
      for (let token = 0; token < TOKENS; token += 1) {
        const progress = tokens[token] ?? AT_START;
        const centre = tokenCentre(seat, progress, token);
        const radius = progress === AT_START ? START_RADIUS : TOKEN_RADIUS;
        const playable =
          seat === this.#position.seat &&
          this.#position.phase === 'choosing' &&
          canMove(this.#position, seat, token, this.#position.die);

        // Hollow only the *active* seat's tokens that cannot take this roll. Hollowing the
        // opponent's as well made their whole side look dead on your turn, when all it
        // meant was that it was not their turn to move.
        const dead =
          seat === this.#position.seat && this.#position.phase === 'choosing' && !playable;
        if (dead) renderer.strokeCircle(centre.x, centre.y, radius, 3, palette.soft);
        else renderer.circle(centre.x, centre.y, radius, palette.base);
        if (seat === 'p1') renderer.strokeCircle(centre.x, centre.y, radius * 0.5, 4, palette.deep);
        else renderer.rect(centre.x - radius, centre.y - 4, radius * 2, 8, palette.deep);

        if (isHome(progress)) {
          renderer.strokeCircle(centre.x, centre.y, radius + 7, 3, COLOUR_TEXT);
        }
        if (playable) {
          renderer.strokeCircle(centre.x, centre.y, radius + 7, 4, COLOUR_TEXT);
        }
        if (
          seat === this.#position.seat &&
          this.#position.phase === 'choosing' &&
          this.#cursor.index === token
        ) {
          renderer.strokeCircle(centre.x, centre.y, radius + 12, 3, palette.base);
        }
      }
    }
  }

  #drawStatus(renderer: Renderer): void {
    const line =
      this.#passSteps > 0
        ? 'No move — turn passes'
        : this.#position.phase === 'rolling'
          ? 'Roll the die'
          : `Move ${String(this.#position.die)}`;
    renderer.text(line, BOARD / 2, 56, 34, COLOUR_TEXT, 'centre');
  }
}
