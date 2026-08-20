import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BOT_PROFILES,
  CROWN_RADIUS,
  PLAYER_RADIUS,
  TARGET_SECONDS,
  WALL,
  YARD_HEIGHT,
  YARD_WIDTH,
  botHeading,
  createBotState,
  createGame,
  move,
  resetBotState,
  resetGame,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Position } from './rules.js';

/**
 * King of the Yard — one crown, one yard, and no safe place to stand.
 *
 * The two players want opposite things at every moment, and the roles swap the instant
 * they meet: the same touch that wins you the crown puts you in the position of being
 * chased. There is no waiting move.
 */

const COLOUR_BACKGROUND = '#101a12';
const COLOUR_YARD = '#1a2a1e';
const COLOUR_WALL = '#31543b';
const COLOUR_CROWN = '#ffd54a';
const COLOUR_INK = '#0c140e';

/** How far a drag has to travel before it counts as a direction. */
const DRAG_DEADZONE = 18;

/** Steps a steal flashes. */
export const STEAL_FLASH_STEPS = 24;

export class KingOfTheYardGame implements Game {
  #position: Position;
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  readonly #heading = { x: 0, y: 0 };

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | null = null;
  #flashSteps = 0;

  constructor() {
    this.#position = createGame(this.#rng);
  }

  /** Read-only view for the harness and the tests. */
  get position(): Readonly<Position> {
    return this.#position;
  }

  get flashing(): boolean {
    return this.#flashSteps > 0;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    this.#flashSteps = 0;
    resetGame(this.#position, this.#rng);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;
    if (this.#flashSteps > 0) this.#flashSteps -= 1;

    this.#driveSeat('p1', this.#botP1, this.#botP1State, input, fixedDeltaSeconds);
    this.#driveSeat('p2', this.#botP2, this.#botP2State, input, fixedDeltaSeconds);

    const what = step(this.#position, fixedDeltaSeconds, this.#rng);
    if (what === 'stolen' || what === 'taken') this.#flashSteps = STEAL_FLASH_STEPS;
    this.#winner = winnerOf(this.#position);
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    this.#drawYard(renderer);
    this.#drawPlayer(renderer, 'p1');
    this.#drawPlayer(renderer, 'p2');
    this.#drawCrown(renderer);
    this.#drawBanked(renderer);
  }

  onPause(): void {}

  onResume(): void {}

  getScore(): MatchScore {
    // Whole seconds banked, so the shell's number changes at a readable rate.
    return {
      p1: Math.floor(this.#position.worn.p1),
      p2: Math.floor(this.#position.worn.p2),
      winner: this.#winner,
    };
  }

  destroy(): void {
    resetGame(this.#position, this.#rng);
    this.#winner = null;
  }

  #driveSeat(
    seat: SeatId,
    difficulty: BotDifficulty | null,
    bot: BotState,
    input: InputState,
    dt: number,
  ): void {
    if (difficulty !== null) {
      botHeading(
        this.#heading,
        this.#position,
        bot,
        seat,
        BOT_PROFILES[difficulty],
        dt,
        this.#rng.float(),
      );
      move(this.#position, seat, this.#heading.x, this.#heading.y, dt);
      return;
    }

    const seatInput = input.seat(seat);
    let dx = seatInput.move.x;
    let dy = seatInput.move.y;

    // A finger is a direction from the player, so the yard is driven the same way it is
    // read: point where you want to go.
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      const me = seat === 'p1' ? this.#position.p1 : this.#position.p2;
      const gapX = pointer.x - me.x;
      const gapY = pointer.y - me.y;
      if (Math.hypot(gapX, gapY) > DRAG_DEADZONE) {
        dx = gapX;
        dy = gapY;
      }
    }
    move(this.#position, seat, dx, dy, dt);
  }

  #drawYard(renderer: Renderer): void {
    renderer.rect(0, 0, YARD_WIDTH, YARD_HEIGHT, COLOUR_WALL);
    renderer.rect(WALL, WALL, YARD_WIDTH - WALL * 2, YARD_HEIGHT - WALL * 2, COLOUR_YARD);
  }

  /**
   * Rule 7: p1 is a disc, p2 is a square, and **the wearer is ringed**.
   *
   * Who has the crown is the only thing either player needs to know at a glance, and in a
   * chase there is no time to read a number — so it is a ring around the wearer as well as
   * the crown drawn on their head.
   */
  #drawPlayer(renderer: Renderer, seat: SeatId): void {
    const me = seat === 'p1' ? this.#position.p1 : this.#position.p2;
    const palette = SEAT_PALETTE[seat];
    if (seat === 'p1') {
      renderer.circle(me.x, me.y, PLAYER_RADIUS, palette.base);
      renderer.strokeCircle(me.x, me.y, PLAYER_RADIUS - 4, 5, COLOUR_INK);
    } else {
      renderer.rect(
        me.x - PLAYER_RADIUS,
        me.y - PLAYER_RADIUS,
        PLAYER_RADIUS * 2,
        PLAYER_RADIUS * 2,
        palette.base,
      );
      renderer.strokeRect(
        me.x - PLAYER_RADIUS + 4,
        me.y - PLAYER_RADIUS + 4,
        PLAYER_RADIUS * 2 - 8,
        PLAYER_RADIUS * 2 - 8,
        5,
        COLOUR_INK,
      );
    }
    if (this.#position.wearer === seat) {
      renderer.strokeCircle(me.x, me.y, PLAYER_RADIUS + 12, 6, COLOUR_CROWN);
    }
  }

  /** The crown itself: on a head, or lying in the yard. */
  #drawCrown(renderer: Renderer): void {
    const position = this.#position;
    const wearer = position.wearer;
    const at = wearer === null ? position.crown : wearer === 'p1' ? position.p1 : position.p2;
    const y = wearer === null ? at.y : at.y - PLAYER_RADIUS - CROWN_RADIUS * 0.7;
    // Three points and a band, so it is a crown in silhouette rather than a yellow blob.
    renderer.rect(
      at.x - CROWN_RADIUS,
      y + CROWN_RADIUS * 0.4,
      CROWN_RADIUS * 2,
      CROWN_RADIUS * 0.5,
      COLOUR_CROWN,
    );
    for (const offset of [-CROWN_RADIUS * 0.7, 0, CROWN_RADIUS * 0.7]) {
      renderer.line(
        at.x + offset,
        y + CROWN_RADIUS * 0.4,
        at.x + offset,
        y - CROWN_RADIUS * 0.6,
        7,
        COLOUR_CROWN,
      );
    }
    if (this.#flashSteps > 0) {
      renderer.strokeCircle(at.x, y, CROWN_RADIUS * 2.2, 5, COLOUR_CROWN);
    }
  }

  /**
   * How much each seat has banked, as a bar under the yard.
   *
   * The shell shows the number; this shows the *gap*, which is what a player in a chase
   * actually wants — whether to press or to run is decided by how far ahead they are.
   */
  #drawBanked(renderer: Renderer): void {
    const width = (YARD_WIDTH - WALL * 2) / 2 - 10;
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const worn = seat === 'p1' ? this.#position.worn.p1 : this.#position.worn.p2;
      const share = Math.max(0, Math.min(1, worn / TARGET_SECONDS));
      const x = seat === 'p1' ? WALL : YARD_WIDTH / 2 + 10;
      renderer.rect(x, YARD_HEIGHT - WALL + 8, width, 16, COLOUR_YARD);
      renderer.rect(x, YARD_HEIGHT - WALL + 8, width * share, 16, SEAT_PALETTE[seat].base);
    }
  }
}

const gameModule = {
  manifest,
  create: (): Game => new KingOfTheYardGame(),
};

export default gameModule;
