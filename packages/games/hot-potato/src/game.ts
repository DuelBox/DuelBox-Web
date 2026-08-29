import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BOT_PROFILES,
  FUSE_SECONDS,
  botThrows,
  createBotState,
  createGame,
  resetBotState,
  resetGame,
  step,
  tryThrow,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Position } from './rules.js';

/**
 * Hot Potato — one bar, one moment, and a fuse that does not care.
 *
 * Both seats watch the same marker sweep the same bar, but only the holder may act. That
 * is what makes it work on one screen: there is nothing to hide, and the tension is in
 * whose hands the thing is when the fuse runs out.
 */

export const BAR_X = 120;
export const BAR_WIDTH = 360;
export const BAR_TOP = 190;
export const BAR_HEIGHT = 620;

const COLOUR_BACKGROUND = '#1a1208';
const COLOUR_BAR = '#2c2113';
const COLOUR_BAR_EDGE = 'rgba(255, 236, 200, 0.35)';
const COLOUR_MARKER = '#fff3d6';
const COLOUR_INK = '#150f06';
const COLOUR_FUSE = '#ff7a3d';
const COLOUR_FUSE_LOW = '#ffd23f';

const POTATO_RADIUS = 52;
const FUSE_BAR_HEIGHT = 22;

/** Where each seat's potato sits when it is holding it. */
function potatoY(seat: SeatId): number {
  return seat === 'p1' ? 900 : 100;
}

/** Per-seat controller state. */
interface SeatRuntime {
  readonly bot: BotState;
  /** True while the seat's button is down, so a hold is one throw. */
  held: boolean;
  /** Steps left of the "missed" flash. */
  missSteps: number;
}

function createRuntime(): SeatRuntime {
  return { bot: createBotState(), held: false, missSteps: 0 };
}

/** Steps a miss stays on screen. */
export const MISS_STEPS = 22;

export class HotPotatoGame implements Game {
  #position: Position;
  readonly #runtimeP1: SeatRuntime = createRuntime();
  readonly #runtimeP2: SeatRuntime = createRuntime();

  #rng = new Rng(1);
  /**
   * Neither the presentation nor the local seat is read, and that is deliberate.
   *
   * One bar, shared, read the same way up by both players — and each seat's own potato
   * already sits nearest to them. There is nothing to rotate and nothing to mirror, so a
   * branch on presentation could only ever be wrong.
   */
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | null = null;

  constructor() {
    this.#position = createGame(this.#rng);
  }

  /** Read-only view for the harness and the tests. */
  get position(): Readonly<Position> {
    return this.#position;
  }

  /** Whether a seat's last attempt missed, for the tests. */
  missing(seat: SeatId): boolean {
    return (seat === 'p1' ? this.#runtimeP1 : this.#runtimeP2).missSteps > 0;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    resetGame(this.#position, this.#rng);
    for (const runtime of [this.#runtimeP1, this.#runtimeP2]) {
      resetBotState(runtime.bot);
      runtime.held = false;
      runtime.missSteps = 0;
    }
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;
    this.#driveSeat('p1', this.#runtimeP1, this.#botP1, input, fixedDeltaSeconds);
    this.#driveSeat('p2', this.#runtimeP2, this.#botP2, input, fixedDeltaSeconds);
    step(this.#position, fixedDeltaSeconds, this.#rng);
    this.#winner = winnerOf(this.#position);
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    this.#drawFuse(renderer);
    this.#drawBar(renderer);
    this.#drawPotato(renderer);
  }

  onPause(): void {
    this.#settle();
  }

  onResume(): void {
    // A button still down across a pause must not throw on the first step back.
    this.#settle();
  }

  getScore(): MatchScore {
    return {
      p1: this.#position.rounds.p1,
      p2: this.#position.rounds.p2,
      winner: this.#winner,
    };
  }

  destroy(): void {
    resetGame(this.#position, this.#rng);
    this.#winner = null;
  }

  #settle(): void {
    this.#runtimeP1.held = true;
    this.#runtimeP2.held = true;
  }

  #driveSeat(
    seat: SeatId,
    runtime: SeatRuntime,
    difficulty: BotDifficulty | null,
    input: InputState,
    dt: number,
  ): void {
    if (runtime.missSteps > 0) runtime.missSteps -= 1;

    if (difficulty !== null) {
      if (
        botThrows(
          this.#position,
          runtime.bot,
          BOT_PROFILES[difficulty],
          seat,
          dt,
          this.#rng.float(),
        )
      ) {
        if (tryThrow(this.#position, seat, this.#rng) === 'missed') runtime.missSteps = MISS_STEPS;
      }
      return;
    }

    const seatInput = input.seat(seat);
    const down = seatInput.actionHeld || seatInput.actionPressed;
    const pressed = down && !runtime.held;
    runtime.held = down;
    if (!pressed) return;

    // A miss is shown, because a player who cannot tell a miss from a refusal will think
    // the game ignored them.
    if (tryThrow(this.#position, seat, this.#rng) === 'missed') runtime.missSteps = MISS_STEPS;
  }

  /**
   * The fuse, across the top and the bottom so both seats can see it.
   *
   * It turns from orange to yellow as it burns down, but the *length* is the information:
   * colour alone would tell a colour-blind player nothing about how long they have.
   */
  #drawFuse(renderer: Renderer): void {
    const left = Math.max(0, Math.min(1, this.#position.fuse / FUSE_SECONDS));
    const colour = left < 0.3 ? COLOUR_FUSE_LOW : COLOUR_FUSE;
    for (const y of [40, manifest.logical.height - 40 - FUSE_BAR_HEIGHT]) {
      renderer.strokeRect(BAR_X, y, BAR_WIDTH, FUSE_BAR_HEIGHT, 3, COLOUR_BAR_EDGE);
      renderer.rect(BAR_X, y, BAR_WIDTH * left, FUSE_BAR_HEIGHT, colour);
    }
  }

  /**
   * The bar, the band and the sweeping marker.
   *
   * One dimension, so the whole skill is *when* and never *where*. The band is drawn as a
   * bracket rather than a block so the marker stays visible inside it.
   */
  #drawBar(renderer: Renderer): void {
    renderer.rect(BAR_X, BAR_TOP, BAR_WIDTH, BAR_HEIGHT, COLOUR_BAR);
    renderer.strokeRect(BAR_X, BAR_TOP, BAR_WIDTH, BAR_HEIGHT, 4, COLOUR_BAR_EDGE);

    const position = this.#position;
    const palette = SEAT_PALETTE[position.holder];
    const bandTop = BAR_TOP + (position.bandCentre - position.band) * BAR_HEIGHT;
    const bandHeight = position.band * 2 * BAR_HEIGHT;
    renderer.strokeRect(BAR_X - 10, bandTop, BAR_WIDTH + 20, bandHeight, 6, palette.base);

    const markerY = BAR_TOP + position.marker * BAR_HEIGHT;
    renderer.rect(BAR_X - 22, markerY - 5, BAR_WIDTH + 44, 10, COLOUR_MARKER);
  }

  /**
   * The potato, in the holder's hands — or in the air between them.
   *
   * Its shape says whose it is as well as its colour (rule 7): round in p1's hands, and
   * squared off in p2's, so a glance at the silhouette answers the only question that
   * matters when the fuse is nearly out.
   */
  #drawPotato(renderer: Renderer): void {
    const position = this.#position;
    let y: number;
    if (position.phase === 'flying') {
      // Between hands, moving from the thrower to the receiver.
      const t = 1 - Math.max(0, Math.min(1, position.flight / 0.35));
      const from = potatoY(position.holder);
      const to = potatoY(position.holder === 'p1' ? 'p2' : 'p1');
      y = from + (to - from) * t;
    } else {
      y = potatoY(position.holder);
    }
    const x = BAR_X + BAR_WIDTH / 2;
    // Whose potato it is does not change while it is in the air: it belongs to the thrower
    // until it lands. A ternary with the same answer either way was the first version of
    // this line, which is dead code pretending to be a decision.
    const holder = position.holder;
    const palette = SEAT_PALETTE[holder];

    if (holder === 'p1') {
      renderer.circle(x, y, POTATO_RADIUS, palette.base);
      renderer.strokeCircle(x, y, POTATO_RADIUS - 5, 6, COLOUR_INK);
    } else {
      renderer.rect(
        x - POTATO_RADIUS,
        y - POTATO_RADIUS,
        POTATO_RADIUS * 2,
        POTATO_RADIUS * 2,
        palette.base,
      );
      renderer.strokeRect(
        x - POTATO_RADIUS + 5,
        y - POTATO_RADIUS + 5,
        POTATO_RADIUS * 2 - 10,
        POTATO_RADIUS * 2 - 10,
        6,
        COLOUR_INK,
      );
    }

    // A cross over a seat that has just missed, so a miss is a shape and not a flicker.
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const runtime = seat === 'p1' ? this.#runtimeP1 : this.#runtimeP2;
      if (runtime.missSteps === 0) continue;
      const missY = potatoY(seat);
      const reach = POTATO_RADIUS * 0.8;
      renderer.line(x - reach, missY - reach, x + reach, missY + reach, 8, COLOUR_MARKER);
      renderer.line(x - reach, missY + reach, x + reach, missY - reach, 8, COLOUR_MARKER);
    }
  }
}

const gameModule = {
  manifest,
  create: (): Game => new HotPotatoGame(),
};

export default gameModule;
