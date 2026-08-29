import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  MAX_ROUNDS,
  SHOW_SECONDS,
  TARGET_POINTS,
  botCuts,
  createBotState,
  createGame,
  cut,
  isFruit,
  resetBotState,
  resetGame,
  step,
  verdictOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Position, Subject } from './rules.js';

/**
 * Fruit Duel — one thing in the middle, and the only question is when.
 *
 * There is nothing to aim and nothing to steer, so the entire game is a single press and
 * the entire craft is in what the two players are shown while they wait. The subject is
 * drawn once, in the middle, upright for nobody in particular — a melon is a melon either
 * way up, which is exactly why the shapes here are radially symmetric and the *verdicts*
 * are drawn per seat instead.
 */

export const BOARD_WIDTH = 640;
export const BOARD_HEIGHT = 1000;

const CENTRE_X = BOARD_WIDTH / 2;
const CENTRE_Y = BOARD_HEIGHT / 2;
const SUBJECT_RADIUS = 96;

/** Each seat's blade rests here, on its own side, and swings toward the middle. */
const BLADE_INSET = 190;

const COLOUR_BACKGROUND = '#0f1013';
const COLOUR_MAT = '#191c22';
const COLOUR_RULE = 'rgba(238, 240, 246, 0.16)';
const COLOUR_MUTED = 'rgba(238, 240, 246, 0.45)';
const COLOUR_BLADE = '#dfe4ee';
const COLOUR_GOOD = '#3ec98a';
const COLOUR_BAD = '#e0554f';

/** Each subject's flesh and rind, and the shape that tells them apart in greyscale. */
const LOOKS: Readonly<Record<Subject, { body: string; mark: string; pips: number }>> =
  Object.freeze({
    melon: { body: '#3f9a52', mark: '#e8506a', pips: 0 },
    pomegranate: { body: '#b83b52', mark: '#7a1f30', pips: 6 },
    orange: { body: '#e08b2e', mark: '#b3641a', pips: 8 },
    bomb: { body: '#2b3038', mark: '#0f1013', pips: 0 },
    stone: { body: '#78808c', mark: '#525963', pips: 3 },
  });

export class FruitDuelGame implements Game {
  readonly #position: Position = createGame();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();

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
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetGame(this.#position, this.#rng);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;

    // Both seats are read before the step resolves anything, so two blades landing on the
    // same step are compared rather than raced.
    this.#read('p1', input);
    this.#read('p2', input);

    step(this.#position, fixedDeltaSeconds, this.#rng);
    this.#winner = winnerOf(this.#position);
  }

  #read(seat: SeatId, input: InputState): void {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      const state = seat === 'p1' ? this.#botP1State : this.#botP2State;
      if (botCuts(this.#position, difficulty, state, this.#rng)) {
        cut(this.#position, seat, this.#position.timer);
      }
      return;
    }

    // A press, from either family, and nothing else. `actionPressed` is the edge, so a
    // key held down through a round does not cut the next one as it opens.
    if (!input.seat(seat).actionPressed) return;
    cut(this.#position, seat, this.#position.timer);
  }

  getActiveSeat(): SeatId | null {
    // Never: both players watch the same subject at once, so the shell keeps a pointer
    // zone for each of them.
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
    this.#winner = null;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    this.#drawMat(renderer);
    this.#drawSubject(renderer);
    for (const seat of ['p1', 'p2'] as SeatId[]) this.#drawSeat(renderer, seat);
  }

  #drawMat(renderer: Renderer): void {
    renderer.rect(0, CENTRE_Y - 200, BOARD_WIDTH, 400, COLOUR_MAT);
    renderer.line(0, CENTRE_Y, BOARD_WIDTH, CENTRE_Y, 2, COLOUR_RULE);

    // Rounds left, as a bar on the halfway line. One object, shared, so neither player is
    // reading a different clock from the other.
    const left = Math.max(0, 1 - this.#position.rounds / MAX_ROUNDS);
    renderer.rect(0, CENTRE_Y - 3, BOARD_WIDTH * left, 6, COLOUR_RULE);
  }

  /**
   * The subject, drawn once and radially symmetric.
   *
   * Nothing here is text and nothing has a right way up, which is what lets one drawing
   * serve two people sitting opposite each other. Rule 7 does the rest of the work: a melon
   * is a plain disc with a bright stripe, a pomegranate has six pips, an orange eight
   * segments, a stone three chips, and a bomb a fuse — so which of the five it is survives
   * greyscale, and the fruit-or-not decision does not rest on hue.
   */
  #drawSubject(renderer: Renderer): void {
    if (this.#position.phase === 'waiting') {
      // A ring that tightens as the wait runs down would give the appearance away, so the
      // wait shows nothing but a steady outline. Reaction, not anticipation.
      renderer.strokeCircle(CENTRE_X, CENTRE_Y, SUBJECT_RADIUS, 3, COLOUR_RULE);
      return;
    }

    const look = LOOKS[this.#position.subject];
    renderer.circle(CENTRE_X, CENTRE_Y, SUBJECT_RADIUS, look.body);

    if (this.#position.subject === 'melon') {
      renderer.rect(CENTRE_X - SUBJECT_RADIUS, CENTRE_Y - 10, SUBJECT_RADIUS * 2, 20, look.mark);
    } else if (this.#position.subject === 'bomb') {
      // A fuse, and it is the only asymmetric thing on the board — a bomb having a top is
      // the point of it.
      renderer.line(
        CENTRE_X,
        CENTRE_Y - SUBJECT_RADIUS,
        CENTRE_X + 34,
        CENTRE_Y - SUBJECT_RADIUS - 44,
        8,
        look.mark,
      );
      renderer.strokeCircle(CENTRE_X, CENTRE_Y, SUBJECT_RADIUS - 20, 6, look.mark);
    }

    for (let i = 0; i < look.pips; i += 1) {
      const angle = (i / look.pips) * Math.PI * 2;
      renderer.circle(
        CENTRE_X + Math.cos(angle) * SUBJECT_RADIUS * 0.55,
        CENTRE_Y + Math.sin(angle) * SUBJECT_RADIUS * 0.55,
        11,
        look.mark,
      );
    }

    // How long is left to move, as a ring closing on the subject.
    if (this.#position.phase === 'showing') {
      const left = Math.max(0, 1 - this.#position.timer / SHOW_SECONDS);
      renderer.strokeCircle(CENTRE_X, CENTRE_Y, SUBJECT_RADIUS + 14 + 36 * left, 3, COLOUR_MUTED);
    }
  }

  /** One seat's blade, verdict and score, on its own side of the mat. */
  #drawSeat(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const near = seat === 'p1';
    const baseline = near ? BOARD_HEIGHT - BLADE_INSET : BLADE_INSET;
    const towards = near ? -1 : 1;
    const verdict = verdictOf(this.#position, seat);

    // The blade: at rest until this seat has moved, swung in once it has.
    const swung = verdict !== null || this.#position.timer > 0;
    const reach = verdict === null ? 0 : 74;
    renderer.line(
      CENTRE_X,
      baseline,
      CENTRE_X,
      baseline + towards * (58 + reach),
      12,
      swung ? COLOUR_BLADE : COLOUR_MUTED,
    );
    // The hilt carries the seat, by shape as well as colour: p1 a disc, p2 a bar.
    if (near) renderer.circle(CENTRE_X, baseline + 16, 22, palette.base);
    else renderer.rect(CENTRE_X - 26, baseline - 30, 52, 26, palette.base);

    this.#drawVerdict(renderer, seat, baseline, towards);
    this.#drawScore(renderer, seat, baseline, towards);
  }

  /**
   * What this seat did, as a shape rather than a word.
   *
   * A tick for a good cut, a cross for a bad one, a bar for holding, and a forward arrow
   * for jumping early. No text, so it needs no translation and no right way up — and it
   * sits on the player's own side, so neither of them has to work out whose result is
   * whose.
   */
  #drawVerdict(renderer: Renderer, seat: SeatId, baseline: number, towards: number): void {
    const verdict = verdictOf(this.#position, seat);
    if (verdict === null || this.#position.phase !== 'revealing') return;
    const y = baseline + towards * -96;
    const good = verdict === 'cut' || (verdict === 'held' && !isFruit(this.#position.subject));
    const colour = good ? COLOUR_GOOD : COLOUR_BAD;

    if (verdict === 'cut') {
      renderer.line(CENTRE_X - 30, y, CENTRE_X - 10, y + 22, 7, colour);
      renderer.line(CENTRE_X - 10, y + 22, CENTRE_X + 32, y - 22, 7, colour);
    } else if (verdict === 'wrong') {
      renderer.line(CENTRE_X - 24, y - 24, CENTRE_X + 24, y + 24, 7, colour);
      renderer.line(CENTRE_X + 24, y - 24, CENTRE_X - 24, y + 24, 7, colour);
    } else if (verdict === 'early') {
      // An arrow pointing the way they jumped: forward, too soon.
      renderer.line(CENTRE_X, y + towards * 26, CENTRE_X, y - towards * 26, 7, colour);
      renderer.line(CENTRE_X, y - towards * 26, CENTRE_X - 18, y - towards * 6, 7, colour);
      renderer.line(CENTRE_X, y - towards * 26, CENTRE_X + 18, y - towards * 6, 7, colour);
    } else {
      renderer.rect(CENTRE_X - 28, y - 5, 56, 10, colour);
    }
  }

  #drawScore(renderer: Renderer, seat: SeatId, baseline: number, towards: number): void {
    const palette = SEAT_PALETTE[seat];
    const points = seat === 'p1' ? this.#position.p1Points : this.#position.p2Points;
    const y = baseline + towards * -150;
    const spacing = (BOARD_WIDTH - 120) / TARGET_POINTS;
    for (let i = 0; i < TARGET_POINTS; i += 1) {
      const x = 60 + i * spacing;
      const filled = i < points;
      renderer.rect(x - 8, y - 5, 16, 10, filled ? palette.base : COLOUR_RULE);
      // Rule 7 again: the far seat's pips are split, so the two rows differ by shape.
      if (!filled) continue;
      if (seat === 'p2') renderer.rect(x - 1, y - 5, 2, 10, COLOUR_BACKGROUND);
    }
  }
}
