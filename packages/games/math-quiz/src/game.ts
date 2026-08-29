import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  ANSWER_COUNT,
  QUESTIONS,
  QUESTION_SECONDS,
  answer,
  answerOf,
  botAnswer,
  createBotState,
  createGame,
  resetBotState,
  resetGame,
  step,
  truthOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Position } from './rules.js';

/**
 * Math Duel — one sum, two people, and four answers in a diamond.
 *
 * The diamond is the whole input design. Four answers arranged up, left, down, right map
 * exactly onto W A S D and the arrow keys, so a key names an answer as directly as a
 * finger does and neither family is a fallback for the other. Everything else here is
 * drawing the same panel twice, once the right way up for each player.
 */

export const BOARD_WIDTH = 640;
export const BOARD_HEIGHT = 1000;

/** A seat's panel occupies the lower half; the far seat's is the same panel, turned. */
const PANEL_HEIGHT = BOARD_HEIGHT / 2;

/** The diamond of answer tiles, in ANSWER_DIRECTIONS order: up, left, down, right. */
const TILE_WIDTH = 190;
const TILE_HEIGHT = 92;
const DIAMOND_X = BOARD_WIDTH / 2;
const DIAMOND_Y = PANEL_HEIGHT * 0.52;
const DIAMOND_SPREAD_X = 210;
const DIAMOND_SPREAD_Y = 118;

const COLOUR_BACKGROUND = '#101728';
const COLOUR_PANEL = '#182238';
const COLOUR_TILE = '#22304d';
const COLOUR_TILE_INK = '#e8eefb';
const COLOUR_RIGHT = '#3ec98a';
const COLOUR_WRONG = '#e0554f';
const COLOUR_MUTED = 'rgba(232, 238, 251, 0.45)';
const COLOUR_RULE = 'rgba(232, 238, 251, 0.18)';

/** Where each tile's centre sits, relative to the diamond, in ANSWER_DIRECTIONS order. */
const TILE_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -DIAMOND_SPREAD_Y],
  [-DIAMOND_SPREAD_X, 0],
  [0, DIAMOND_SPREAD_Y],
  [DIAMOND_SPREAD_X, 0],
];

/** A key has to return to neutral before it can name another answer. */
const KEY_DEADZONE = 0.6;

export class MathQuizGame implements Game {
  readonly #position: Position = createGame();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  /** Whether each seat's stick was pushed last step, so a held key is one answer. */
  readonly #held: Record<SeatId, boolean> = { p1: false, p2: false };

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  get position(): Position {
    return this.#position;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    this.#held.p1 = false;
    this.#held.p2 = false;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetGame(this.#position, this.#rng);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;

    // Both seats are read before anything is resolved, so two people answering on the
    // same step are treated as having answered together.
    this.#read('p1', input, fixedDeltaSeconds);
    this.#read('p2', input, fixedDeltaSeconds);

    step(this.#position, fixedDeltaSeconds, this.#rng);
    this.#winner = winnerOf(this.#position);
  }

  #read(seat: SeatId, input: InputState, fixedDeltaSeconds: number): void {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      const state = seat === 'p1' ? this.#botP1State : this.#botP2State;
      const choice = botAnswer(this.#position, difficulty, state, this.#rng, fixedDeltaSeconds);
      if (choice >= 0) answer(this.#position, seat, choice);
      return;
    }

    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer !== null && seatInput.actionPressed) {
      const tapped = this.#tileAt(seat, pointer);
      if (tapped >= 0) answer(this.#position, seat, tapped);
    }

    const direction = this.#keyDirection(seatInput.move);
    if (direction < 0) {
      this.#held[seat] = false;
      return;
    }
    if (this.#held[seat]) return;
    this.#held[seat] = true;
    answer(this.#position, seat, direction);
  }

  /**
   * Which of the four answers a key names, or −1 for neutral.
   *
   * The dominant axis wins, so a diagonal is read as whichever of the two the player
   * pushed further rather than being rejected — holding W and drifting onto D should
   * still mean "up", not "nothing".
   */
  #keyDirection(move: Readonly<Vec2>): number {
    const x = move.x;
    const y = move.y;
    if (Math.abs(x) < KEY_DEADZONE && Math.abs(y) < KEY_DEADZONE) return -1;
    if (Math.abs(y) >= Math.abs(x)) return y < 0 ? 0 : 2;
    return x < 0 ? 1 : 3;
  }

  /**
   * Which tile a finger landed on, in the seat's own panel.
   *
   * The far seat's panel is the near one turned half a turn about the centre of the board,
   * so a point in it is mapped back rather than laid out twice. One geometry, one place
   * it can be wrong.
   */
  #tileAt(seat: SeatId, pointer: Readonly<Vec2>): number {
    const x = seat === 'p1' ? pointer.x : BOARD_WIDTH - pointer.x;
    const y = seat === 'p1' ? pointer.y - PANEL_HEIGHT : PANEL_HEIGHT - pointer.y;
    for (let i = 0; i < ANSWER_COUNT; i += 1) {
      const offset = TILE_OFFSETS[i] as readonly [number, number];
      const cx = DIAMOND_X + offset[0];
      const cy = DIAMOND_Y + offset[1];
      if (Math.abs(x - cx) <= TILE_WIDTH / 2 && Math.abs(y - cy) <= TILE_HEIGHT / 2) return i;
    }
    return -1;
  }

  getActiveSeat(): SeatId | null {
    // Never: both players answer the same question at the same time, so the shell keeps
    // a pointer zone for each of them.
    return null;
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
    this.#held.p1 = false;
    this.#held.p2 = false;
    this.#winner = null;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    // The near seat's panel, then the identical panel turned half a turn, which lands it
    // in the far seat's half the right way up for them.
    renderer.pushSeatRotation(false);
    this.#drawPanel(renderer, 'p1');
    renderer.popSeatRotation();
    renderer.pushSeatRotation(true);
    this.#drawPanel(renderer, 'p2');
    renderer.popSeatRotation();
    this.#drawDivider(renderer);
  }

  #drawDivider(renderer: Renderer): void {
    renderer.line(0, PANEL_HEIGHT, BOARD_WIDTH, PANEL_HEIGHT, 3, COLOUR_RULE);
    // How much of the match is left, as a bar on the halfway line — one object, shared,
    // so neither player is reading a different clock from the other.
    const left = Math.max(0, 1 - this.#position.asked / QUESTIONS);
    renderer.rect(0, PANEL_HEIGHT - 3, BOARD_WIDTH * left, 6, COLOUR_MUTED);
  }

  /** One player's whole half: the sum, the diamond, and their score. */
  #drawPanel(renderer: Renderer, seat: SeatId): void {
    const question = this.#position.question;
    const palette = SEAT_PALETTE[seat];
    const top = PANEL_HEIGHT;

    renderer.rect(0, top, BOARD_WIDTH, PANEL_HEIGHT, COLOUR_PANEL);

    // The sum. Drawn per seat rather than once in the middle: a number is the one thing
    // that cannot be read upside down. Once the question is over it carries its own answer,
    // so the reveal is the same object gaining a right-hand side rather than a second one
    // appearing somewhere else.
    const sum = `${String(question.left)} ${question.operation} ${String(question.right)}`;
    const line =
      this.#position.phase === 'asking' ? sum : `${sum} = ${String(truthOf(this.#position))}`;
    renderer.text(
      line,
      BOARD_WIDTH / 2,
      top + PANEL_HEIGHT * 0.14,
      this.#position.phase === 'asking' ? 62 : 50,
      this.#position.phase === 'asking' ? COLOUR_TILE_INK : COLOUR_RIGHT,
      'centre',
    );

    // The time left on this question, as a bar under the sum.
    if (this.#position.phase === 'asking') {
      const left = Math.max(0, Math.min(1, this.#position.timer / QUESTION_SECONDS));
      renderer.rect(BOARD_WIDTH / 2 - 150, top + PANEL_HEIGHT * 0.2, 300 * left, 5, palette.base);
    }

    this.#drawDiamond(renderer, seat, top);
    this.#drawScore(renderer, seat, top);
  }

  #drawDiamond(renderer: Renderer, seat: SeatId, top: number): void {
    const question = this.#position.question;
    const given = answerOf(this.#position, seat);
    const revealing = this.#position.phase !== 'asking';

    for (let i = 0; i < ANSWER_COUNT; i += 1) {
      const offset = TILE_OFFSETS[i] as readonly [number, number];
      const cx = DIAMOND_X + offset[0];
      const cy = top + DIAMOND_Y + offset[1];

      let fill = COLOUR_TILE;
      if (revealing && i === question.correct) fill = COLOUR_RIGHT;
      else if (revealing && i === given) fill = COLOUR_WRONG;
      else if (i === given) fill = SEAT_PALETTE[seat].deep;

      renderer.rect(cx - TILE_WIDTH / 2, cy - TILE_HEIGHT / 2, TILE_WIDTH, TILE_HEIGHT, fill);
      renderer.text(String(question.answers[i]), cx, cy, 46, COLOUR_TILE_INK, 'centre');

      /*
       * The key that names this tile, drawn as a caret pointing the way it is pushed.
       *
       * Rule 7 twice over: a chosen tile is marked by *position* and by the caret rather
       * than by colour, and the right answer is a tick rather than a green square. Someone
       * playing this in greyscale still sees which one they picked and whether it was
       * right.
       */
      const caret = 26;
      const dirX = Math.sign(offset[0]);
      const dirY = offset[0] === 0 ? Math.sign(offset[1]) : 0;
      renderer.line(
        cx + dirX * (TILE_WIDTH / 2 - 8) + dirY * 0,
        cy + dirY * (TILE_HEIGHT / 2 - 8),
        cx + dirX * (TILE_WIDTH / 2 - 8 + caret * 0.5),
        cy + dirY * (TILE_HEIGHT / 2 - 8 + caret * 0.5),
        4,
        COLOUR_MUTED,
      );

      if (revealing && i === question.correct) {
        // A tick, from the shapes the renderer has.
        renderer.line(cx - 26, cy + 26, cx - 12, cy + 38, 5, COLOUR_TILE_INK);
        renderer.line(cx - 12, cy + 38, cx + 20, cy + 14, 5, COLOUR_TILE_INK);
      }
    }
  }

  #drawScore(renderer: Renderer, seat: SeatId, top: number): void {
    const palette = SEAT_PALETTE[seat];
    const mine = seat === 'p1' ? this.#position.p1Points : this.#position.p2Points;
    const theirs = seat === 'p1' ? this.#position.p2Points : this.#position.p1Points;
    renderer.text(
      `${String(mine)} — ${String(theirs)}`,
      BOARD_WIDTH / 2,
      top + PANEL_HEIGHT * 0.88,
      36,
      COLOUR_MUTED,
      'centre',
    );
    // A bar under your own number, in your own colour, so which of the two is yours is
    // not a matter of remembering which side you are sitting on.
    renderer.rect(BOARD_WIDTH / 2 - 96, top + PANEL_HEIGHT * 0.91, 60, 5, palette.base);
  }
}

/** The declared box, so a test can assert the manifest and the code agree. */
export const LOGICAL = manifest.logical;
