import { Rng, SEAT_PALETTE, SeatFlip, seatRotated } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  AIM_SPREAD,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  GAP_LEFT,
  GAP_RIGHT,
  MID_Y,
  PUCK_RADIUS,
  SHOTS_PER_SEAT,
  WALL_HALF_THICKNESS,
  angleOf,
  botPress,
  createBotState,
  createGame,
  forwardOf,
  resetBotState,
  resetGame,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Position } from './rules.js';

/**
 * Sling Puck — the board, drawn once, turned to face whoever is shooting.
 *
 * Nothing in here decides anything: the rules module holds the whole simulation in board
 * units and this file only says what a puck looks like. What it *does* decide is how the two
 * needles are read, and that is the only place the game could have become unfair between a
 * key and a thumb — so neither needle takes a position, only a moment.
 */

const COLOUR_FELT = '#123024';
const COLOUR_FELT_FAR = '#0d2420';
const COLOUR_RAIL = '#5b3a22';
const COLOUR_WALL = '#c8b18c';
const COLOUR_POST = '#efe0c4';
const COLOUR_MUTED = 'rgba(240, 246, 238, 0.42)';
const COLOUR_LINE = 'rgba(240, 246, 238, 0.75)';

export class SlingPuckGame implements Game {
  readonly #position: Position = createGame();
  readonly #flip = new SeatFlip();
  readonly #botState: Record<SeatId, BotState> = { p1: createBotState(), p2: createBotState() };

  /**
   * A generator per seat, and none at all for the board.
   *
   * The rack is built from the symmetry rather than dealt, so there is nothing random about
   * the world here to keep separate — but the two bots still need a stream each. Sharing one
   * and drawing a constant number of values per decision is not enough: whichever seat is
   * asked first takes the earlier value every time, which measured 1.4 points of win rate in
   * Star Catcher. Here the seats alternate rather than run at once, so the effect would be
   * even more one-sided.
   */
  #botRng: Record<SeatId, Rng> = { p1: new Rng(1), p2: new Rng(2) };
  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #bot: Record<SeatId, BotDifficulty | null> = { p1: null, p2: null };
  #winner: SeatId | 'draw' | null = null;

  get position(): Position {
    return this.#position;
  }

  init(context: GameContext): void {
    this.#botRng = {
      p1: new Rng(context.rng.next() | 0),
      p2: new Rng(context.rng.next() | 0),
    };
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#bot = { p1: context.botDifficulty('p1'), p2: context.botDifficulty('p2') };
    this.#winner = null;
    resetBotState(this.#botState.p1);
    resetBotState(this.#botState.p2);
    resetGame(this.#position);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    // Stepped before the early return, so the board finishes turning to face the winner
    // rather than stopping half way round.
    this.#flip.retarget(seatRotated(this.#position.active, this.#presentation, this.#localSeat));
    this.#flip.step(fixedDeltaSeconds);
    if (this.#winner !== null) return;

    step(this.#position, fixedDeltaSeconds, this.#press(input));
    this.#winner = winnerOf(this.#position);
  }

  /**
   * Who is asking to stop the needle, or nobody.
   *
   * A press and nothing else — no position, no direction, no rate. A key and a thumb produce
   * the identical event, and holding either does nothing a single press does not, because
   * `actionPressed` is an edge (rule 10).
   */
  #press(input: InputState): SeatId | null {
    const active = this.#position.active;
    const difficulty = this.#bot[active];

    if (difficulty !== null) {
      const pressed = botPress(
        this.#position,
        active,
        difficulty,
        this.#botState[active],
        this.#botRng[active],
      );
      return pressed ? active : null;
    }

    // Nothing is taken while the board is part-way round: the needle a player is reading is
    // moving under them, so a tap would name a moment they did not mean. The rules' own
    // ready pause is longer than this, so the bot is stopped by the same amount.
    if (!this.#flip.acceptsInput) return null;
    return input.seat(active).actionPressed ? active : null;
  }

  getActiveSeat(): SeatId {
    return this.#position.active;
  }

  getScore(): MatchScore {
    // What each seat has put through, which only ever goes up. The position also knows how
    // many are left to sling, and reporting that instead made the shell's HUD count *down* as
    // a player did well — and, once a crossing could be worth three, count down by one while
    // the score went up by three.
    return {
      p1: this.#position.p1Through,
      p2: this.#position.p2Through,
      winner: this.#winner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position);
    resetBotState(this.#botState.p1);
    resetBotState(this.#botState.p2);
    this.#winner = null;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_FELT);
    renderer.pushRotation(this.#flip.angle);
    this.#drawBoard(renderer);
    this.#drawPucks(renderer);
    this.#drawNeedles(renderer);
    this.#drawShots(renderer);
    renderer.popSeatRotation();
  }

  /** The two halves, the rails, and the wall with its gap. */
  #drawBoard(renderer: Renderer): void {
    // The far half is a shade darker, so which side is yours is readable without colour and
    // before you have found your own pucks.
    renderer.rect(0, 0, BOARD_WIDTH, MID_Y, COLOUR_FELT_FAR);
    renderer.strokeRect(3, 3, BOARD_WIDTH - 6, BOARD_HEIGHT - 6, 6, COLOUR_RAIL);

    const top = MID_Y - WALL_HALF_THICKNESS;
    const height = WALL_HALF_THICKNESS * 2;
    renderer.rect(0, top, GAP_LEFT, height, COLOUR_WALL);
    renderer.rect(GAP_RIGHT, top, BOARD_WIDTH - GAP_RIGHT, height, COLOUR_WALL);
    // The posts, drawn as the round things the physics treats them as.
    renderer.circle(GAP_LEFT, MID_Y, WALL_HALF_THICKNESS + 2, COLOUR_POST);
    renderer.circle(GAP_RIGHT, MID_Y, WALL_HALF_THICKNESS + 2, COLOUR_POST);
  }

  /** p1's pucks are discs with a ring, p2's are discs with a bar — rule 7. */
  #drawPucks(renderer: Renderer): void {
    for (let i = 0; i < this.#position.pucks.length; i += 1) {
      const puck = this.#position.pucks[i];
      if (puck === undefined) continue;
      const palette = SEAT_PALETTE[puck.owner];
      // A puck that is through is drawn hollow and racked at the back of the far side: it is
      // out of the game, and how many are gone is the only thing either player is counting.
      renderer.circle(puck.x, puck.y, PUCK_RADIUS, puck.through ? palette.soft : palette.base);
      if (puck.owner === 'p1') {
        renderer.strokeCircle(puck.x, puck.y, PUCK_RADIUS - 8, 4, palette.deep);
      } else {
        renderer.rect(puck.x - PUCK_RADIUS + 6, puck.y - 3, (PUCK_RADIUS - 6) * 2, 6, palette.deep);
      }
      if (i === this.#position.loaded && !puck.through && this.#position.phase !== 'over') {
        renderer.strokeCircle(puck.x, puck.y, PUCK_RADIUS + 7, 3, COLOUR_LINE);
      }
    }
  }

  /**
   * The two needles, drawn where the shot will come from.
   *
   * The angle needle is the line the puck will take, so it is drawn *as* that line rather
   * than as a dial somewhere else — there is nothing to translate between the gauge and the
   * board. The strength needle then grows along that same line, which is why the second
   * press needs no new place to look.
   */
  #drawNeedles(renderer: Renderer): void {
    const position = this.#position;
    if (position.phase !== 'aim' && position.phase !== 'power') return;
    const puck = position.pucks[position.loaded];
    if (puck === undefined) return;

    const seat = position.active;
    const palette = SEAT_PALETTE[seat];
    const angle = position.phase === 'aim' ? angleOf(seat, position.sweep) : position.aim;
    const forward = forwardOf(seat);

    // The arc the needle sweeps through, so a player can see the whole range before it starts.
    for (const edge of [-1, 1]) {
      const limit = (forward > 0 ? Math.PI / 2 : -Math.PI / 2) + edge * AIM_SPREAD;
      renderer.line(
        puck.x,
        puck.y,
        puck.x + Math.cos(limit) * 90,
        puck.y + Math.sin(limit) * 90,
        2,
        COLOUR_MUTED,
      );
    }

    const reach = position.phase === 'aim' ? 120 : 120 + position.sweep * 190;
    renderer.line(
      puck.x,
      puck.y,
      puck.x + Math.cos(angle) * reach,
      puck.y + Math.sin(angle) * reach,
      position.phase === 'aim' ? 5 : 9,
      palette.base,
    );
    // A tick at the end, so the line's length is readable at a glance and not only its angle.
    renderer.circle(
      puck.x + Math.cos(angle) * reach,
      puck.y + Math.sin(angle) * reach,
      7,
      palette.deep,
    );
  }

  /** Shots left, as pips on each player's own outer edge. */
  #drawShots(renderer: Renderer): void {
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const palette = SEAT_PALETTE[seat];
      const spent = seat === 'p1' ? this.#position.p1Shots : this.#position.p2Shots;
      const y = seat === 'p1' ? BOARD_HEIGHT - 20 : 20;
      const spacing = (BOARD_WIDTH - 120) / SHOTS_PER_SEAT;
      for (let i = 0; i < SHOTS_PER_SEAT; i += 1) {
        const x = 60 + i * spacing;
        const left = i >= spent;
        if (seat === 'p1') renderer.circle(x, y, 7, left ? palette.base : COLOUR_MUTED);
        else renderer.rect(x - 6, y - 6, 12, 12, left ? palette.base : COLOUR_MUTED);
      }
    }
  }
}

export { BOARD_WIDTH, BOARD_HEIGHT };
