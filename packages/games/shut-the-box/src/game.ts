import { GridCursor, Rng, SEAT_PALETTE, SeatFlip, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  TILE_COUNT,
  botPick,
  botTakesOneDie,
  commitPick,
  createGame,
  endTurn,
  isPicked,
  oneDieAllowed,
  openTotal,
  pickComplete,
  resetGame,
  roll,
  rollTotal,
  tilesOfMask,
  togglePick,
  turnIsDead,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game as Position } from './rules.js';

/**
 * Board geometry in logical units. Exported because working out which tile a finger is on
 * is not a rendering question — the tests need the same mapping the game uses.
 */
export const TILE_WIDTH = 84;
export const TILE_HEIGHT = 108;
export const TILE_GAP = 8;
export const TILE_ROW_WIDTH = TILE_COUNT * TILE_WIDTH + (TILE_COUNT - 1) * TILE_GAP;
export const TILE_ORIGIN_X = (900 - TILE_ROW_WIDTH) / 2;
export const TILE_ORIGIN_Y = 452;

export const DIE_SIZE = 96;
export const DIE_GAP = 26;
export const DICE_CENTRE_Y = 286;

export const ROLL_WIDTH = 260;
export const ROLL_HEIGHT = 92;
export const ROLL_Y = 646;

const COLOUR_BACKGROUND = '#161a12';
const COLOUR_FELT = '#20301f';
const COLOUR_TILE = '#efe6cf';
const COLOUR_TILE_SHUT = '#2b3327';
const COLOUR_INK = '#151a12';
const COLOUR_DIE = '#f6f2e6';
const COLOUR_MUTED = 'rgba(239, 230, 207, 0.55)';

/** Converted to whole steps before being counted, so a replay is exact. */
const DEAD_SECONDS = 1.4;
const THINK_SECONDS = 0.55;
const SETTLE_SECONDS = 1.1;

/** The controls the cursor can sit on when there is no tile to choose. */
export type RollChoice = 'two' | 'one';

export function tileRect(tile: number): { x: number; y: number; w: number; h: number } {
  return {
    x: TILE_ORIGIN_X + (tile - 1) * (TILE_WIDTH + TILE_GAP),
    y: TILE_ORIGIN_Y,
    w: TILE_WIDTH,
    h: TILE_HEIGHT,
  };
}

/** The tile a point falls on, or 0 for none. */
export function tileAt(x: number, y: number): number {
  if (y < TILE_ORIGIN_Y || y > TILE_ORIGIN_Y + TILE_HEIGHT) return 0;
  const local = x - TILE_ORIGIN_X;
  if (local < 0 || local > TILE_ROW_WIDTH) return 0;
  const slot = Math.floor(local / (TILE_WIDTH + TILE_GAP));
  const within = local - slot * (TILE_WIDTH + TILE_GAP);
  if (within > TILE_WIDTH) return 0; // in the gap between two tiles
  return Math.min(TILE_COUNT, slot + 1);
}

export function rollRect(
  choice: RollChoice,
  bothOffered: boolean,
): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  if (!bothOffered) {
    return { x: (900 - ROLL_WIDTH) / 2, y: ROLL_Y, w: ROLL_WIDTH, h: ROLL_HEIGHT };
  }
  const width = ROLL_WIDTH * 0.78;
  const gap = 22;
  const left = (900 - (width * 2 + gap)) / 2;
  return {
    x: choice === 'two' ? left : left + width + gap,
    y: ROLL_Y,
    w: width,
    h: ROLL_HEIGHT,
  };
}

function inside(
  rect: { x: number; y: number; w: number; h: number },
  x: number,
  y: number,
): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export class ShutTheBoxGame implements Game {
  readonly #position: Position = createGame();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #flip = new SeatFlip();
  readonly #cursor = new GridCursor({ columns: TILE_COUNT, rows: 1, startIndex: 0 });
  readonly #maskTiles: number[] = [];

  #rng = new Rng(1);
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;
  #rollChoice: RollChoice = 'two';

  #stepsPerSecond = 0;
  #deadSteps = 0;
  #thinkSteps = -1;
  #settleSteps = 0;

  /** Exposed for tests, which need to state a position rather than play into one. */
  get position(): Position {
    return this.#position;
  }

  get rollChoice(): RollChoice {
    return this.#rollChoice;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    this.#rollChoice = 'two';
    this.#deadSteps = 0;
    this.#thinkSteps = -1;
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

    // A turn that cannot be played is held for a beat before the box changes hands. A
    // handover that happens the instant the dice land reads as the game skipping someone.
    if (this.#deadSteps > 0) {
      this.#deadSteps -= 1;
      if (this.#deadSteps === 0) {
        endTurn(this.#position);
        this.#cursor.reset();
        this.#rollChoice = 'two';
      }
      return;
    }

    if (this.#position.phase === 'handover') {
      endTurn(this.#position);
      this.#cursor.reset();
      this.#rollChoice = 'two';
      return;
    }

    const seat = this.#position.seat;
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      this.#updateBot(difficulty);
      return;
    }

    const seatInput = input.seat(seat);
    // Nothing is accepted while the board is part-way round: the tile under a finger is
    // moving, so a tap would name one the player did not mean.
    if (!this.#flip.acceptsInput) return;

    if (this.#position.phase === 'rolling') {
      this.#updateRolling(seatInput, fixedDeltaSeconds);
      return;
    }
    this.#updateChoosing(seatInput, fixedDeltaSeconds);
  }

  #updateBot(difficulty: BotDifficulty): void {
    if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(THINK_SECONDS);
    if (this.#thinkSteps > 0) {
      this.#thinkSteps -= 1;
      return;
    }
    this.#thinkSteps = -1;

    if (this.#position.phase === 'rolling') {
      const one = botTakesOneDie(this.#position, difficulty);
      this.#rollChoice = one ? 'one' : 'two';
      roll(this.#position, this.#rng, one ? 1 : 2);
      return;
    }

    const mask = botPick(this.#position, this.#rng, difficulty);
    if (mask === 0) {
      this.#deadSteps = this.#stepsFor(DEAD_SECONDS);
      return;
    }
    tilesOfMask(this.#maskTiles, mask);
    for (const tile of this.#maskTiles) togglePick(this.#position, tile);
    commitPick(this.#position);
  }

  #updateRolling(seatInput: ReturnType<InputState['seat']>, fixedDeltaSeconds: number): void {
    const bothOffered = oneDieAllowed(this.#position);
    if (bothOffered && seatInput.move.x !== 0) {
      // Left and right choose between one die and two, which is a real decision once the
      // high tiles are gone and not one the game should make for the player.
      this.#rollChoice = seatInput.move.x < 0 ? 'two' : 'one';
    }

    const pointer = seatInput.pointer;
    if (pointer !== null && seatInput.actionPressed) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      for (const choice of ['two', 'one'] as RollChoice[]) {
        if (!bothOffered && choice === 'one') continue;
        if (inside(rollRect(choice, bothOffered), this.#pointerWorld.x, this.#pointerWorld.y)) {
          this.#rollChoice = choice;
          this.#doRoll();
          return;
        }
      }
      return;
    }

    if (seatInput.actionPressed) this.#doRoll();
    void fixedDeltaSeconds;
  }

  #doRoll(): void {
    roll(this.#position, this.#rng, this.#rollChoice === 'one' ? 1 : 2);
    if (turnIsDead(this.#position)) this.#deadSteps = this.#stepsFor(DEAD_SECONDS);
  }

  #updateChoosing(seatInput: ReturnType<InputState['seat']>, fixedDeltaSeconds: number): void {
    if (turnIsDead(this.#position)) {
      this.#deadSteps = this.#stepsFor(DEAD_SECONDS);
      return;
    }

    this.#cursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, this.#flip.rotated);

    const pointer = seatInput.pointer;
    if (pointer !== null && seatInput.actionPressed) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const tapped = tileAt(this.#pointerWorld.x, this.#pointerWorld.y);
      if (tapped === 0) return;
      this.#cursor.moveTo(tapped - 1);
      this.#pick(tapped);
      return;
    }

    if (seatInput.actionPressed) this.#pick(this.#cursor.index + 1);
  }

  /**
   * Take a tile, and shut the set the moment it makes the roll exactly.
   *
   * There is no separate confirm control, and none is needed: a pick that would overshoot
   * is refused, so the instant the total matches there is nothing else the player could
   * want to add. Choosing 7 rather than 3 + 4 is expressed by which tile is tapped first.
   */
  #pick(tile: number): void {
    if (!togglePick(this.#position, tile)) return;
    if (!pickComplete(this.#position)) return;
    commitPick(this.#position);
    if (this.#position.phase === 'rolling') this.#rollChoice = 'two';
  }

  #stepsFor(seconds: number): number {
    return Math.max(1, Math.round(seconds * (this.#stepsPerSecond || 60)));
  }

  #shouldRotate(): boolean {
    // In single-seat play the local player owns the whole screen and it never turns.
    if (this.#presentation === 'single-seat') return false;
    return this.#position.seat !== this.#localSeat;
  }

  getScore(): MatchScore {
    // Lower is better here, so the shell is handed the tiles each player shut rather than
    // the tiles they were left with — a HUD that counts up while the player does well is
    // the one a person can read at a glance.
    const shutP1 = this.#position.scoreP1 < 0 ? 0 : 45 - this.#position.scoreP1;
    const shutP2 = this.#position.scoreP2 < 0 ? 0 : 45 - this.#position.scoreP2;
    return { p1: shutP1, p2: shutP2, winner: this.#matchWinner };
  }

  /**
   * Which seat the board belongs to right now.
   *
   * Not decoration: the shell keys off the *presence* of this method to know a game is
   * turn-based, and only then does it hand the whole board to the active seat and map
   * both keyboard halves onto them. Without it the arrow keys drive the player who is not
   * playing, and half the device is dead to a finger — which is exactly what the first
   * browser run of this game showed.
   */
  getActiveSeat(): SeatId {
    return this.#position.seat;
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position);
    this.#matchWinner = null;
    this.#deadSteps = 0;
    this.#thinkSteps = -1;
    this.#settleSteps = 0;
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawFelt(renderer);
    this.#drawTiles(renderer);
    this.#drawDice(renderer);
    this.#drawRollControls(renderer);
    this.#drawStatus(renderer);
    renderer.popSeatRotation();
  }

  #drawFelt(renderer: Renderer): void {
    renderer.rect(40, 150, 820, 620, COLOUR_FELT);
    const seat = this.#position.seat;
    renderer.strokeRect(40, 150, 820, 620, 6, SEAT_PALETTE[seat].base);
  }

  #drawTiles(renderer: Renderer): void {
    const seat = this.#position.seat;
    for (let tile = 1; tile <= TILE_COUNT; tile += 1) {
      const rect = tileRect(tile);
      const open = this.#position.open[tile - 1] === true;
      const picked = isPicked(this.#position, tile);

      renderer.rect(rect.x, rect.y, rect.w, rect.h, open ? COLOUR_TILE : COLOUR_TILE_SHUT);
      if (picked) {
        renderer.strokeRect(
          rect.x + 4,
          rect.y + 4,
          rect.w - 8,
          rect.h - 8,
          7,
          SEAT_PALETTE[seat].deep,
        );
      }
      renderer.text(
        String(tile),
        rect.x + rect.w / 2,
        rect.y + rect.h / 2 + 18,
        54,
        open ? COLOUR_INK : COLOUR_MUTED,
        'centre',
      );

      // Rule 7: a shut tile is struck through as well as darkened, so the box reads with
      // the colour taken away.
      if (!open) {
        renderer.line(
          rect.x + 12,
          rect.y + rect.h - 16,
          rect.x + rect.w - 12,
          rect.y + 16,
          6,
          COLOUR_MUTED,
        );
      }
    }

    // The cursor, so a keyboard player can see where they are.
    if (this.#position.phase === 'choosing') {
      const rect = tileRect(this.#cursor.index + 1);
      renderer.strokeRect(
        rect.x - 6,
        rect.y - 6,
        rect.w + 12,
        rect.h + 12,
        4,
        SEAT_PALETTE[this.#position.seat].base,
      );
    }
  }

  #drawDice(renderer: Renderer): void {
    const dice = this.#position.dice;
    if (dice.length === 0) return;
    const span = dice.length * DIE_SIZE + (dice.length - 1) * DIE_GAP;
    let x = (900 - span) / 2;
    for (const die of dice) {
      renderer.rect(x, DICE_CENTRE_Y - DIE_SIZE / 2, DIE_SIZE, DIE_SIZE, COLOUR_DIE);
      this.#drawPips(renderer, x, DICE_CENTRE_Y - DIE_SIZE / 2, die);
      x += DIE_SIZE + DIE_GAP;
    }
  }

  /** Pips, not a numeral: a die a player has to read as a number is not a die. */
  #drawPips(renderer: Renderer, x: number, y: number, face: number): void {
    const near = DIE_SIZE * 0.26;
    const far = DIE_SIZE - near;
    const mid = DIE_SIZE / 2;
    const radius = DIE_SIZE * 0.085;
    const spots: readonly (readonly [number, number])[] =
      face === 1
        ? [[mid, mid]]
        : face === 2
          ? [
              [near, near],
              [far, far],
            ]
          : face === 3
            ? [
                [near, near],
                [mid, mid],
                [far, far],
              ]
            : face === 4
              ? [
                  [near, near],
                  [far, near],
                  [near, far],
                  [far, far],
                ]
              : face === 5
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
    for (const [dx, dy] of spots) renderer.circle(x + dx, y + dy, radius, COLOUR_INK);
  }

  #drawRollControls(renderer: Renderer): void {
    if (this.#position.phase !== 'rolling') return;
    const seat = this.#position.seat;
    const bothOffered = oneDieAllowed(this.#position);
    const choices: RollChoice[] = bothOffered ? ['two', 'one'] : ['two'];
    for (const choice of choices) {
      const rect = rollRect(choice, bothOffered);
      const chosen = !bothOffered || this.#rollChoice === choice;
      renderer.rect(
        rect.x,
        rect.y,
        rect.w,
        rect.h,
        chosen ? SEAT_PALETTE[seat].base : COLOUR_TILE_SHUT,
      );
      renderer.text(
        choice === 'two' ? 'Roll two' : 'Roll one',
        rect.x + rect.w / 2,
        rect.y + rect.h / 2 + 12,
        34,
        chosen ? COLOUR_INK : COLOUR_MUTED,
        'centre',
      );
    }
  }

  #drawStatus(renderer: Renderer): void {
    const total = rollTotal(this.#position);
    const line =
      this.#deadSteps > 0
        ? 'No move — turn over'
        : this.#position.phase === 'rolling'
          ? 'Roll the dice'
          : `Make ${String(total)}`;
    renderer.text(line, 450, 210, 40, COLOUR_TILE, 'centre');
    renderer.text(
      `Left standing: ${String(openTotal(this.#position))}`,
      450,
      810,
      30,
      COLOUR_MUTED,
      'centre',
    );
  }
}
