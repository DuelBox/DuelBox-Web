import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  DRAGONFLY_POINTS,
  FROG_RADIUS,
  PAD_COUNT,
  PAD_RADIUS,
  PAD_X,
  PAD_Y,
  POND,
  TARGET_POINTS,
  botIntent,
  createBotState,
  createGame,
  frogOf,
  hopFrog,
  mirrorPad,
  resetBotState,
  resetGame,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Frog, Game as Position } from './rules.js';

/**
 * Frogs Fight — one pond, two frogs, and one bug at a time worth having.
 *
 * The rules module holds the whole simulation. What lives here is how a person expresses a
 * push through it, and how the pond is drawn.
 *
 * The pond is point-symmetric and so is everything drawn on it, so there is nothing to
 * rotate: the picture is already the same from either side of the device. That is why this
 * game has no `SeatFlip` and never reads the presentation.
 */

/** A drag shorter than this is a resting thumb, not a push. */
export const DRAG_DEADZONE = 20;

const SEATS: readonly SeatId[] = ['p1', 'p2'];

const COLOUR_WATER = '#0a2a33';
const COLOUR_RIPPLE = 'rgba(150, 214, 226, 0.07)';
const COLOUR_PAD = '#2f7d52';
const COLOUR_PAD_RIM = '#1b5335';
const COLOUR_VEIN = 'rgba(10, 42, 51, 0.3)';
const COLOUR_SHADOW = 'rgba(3, 18, 24, 0.4)';
const COLOUR_FLY = '#f6dd78';
const COLOUR_DRAGONFLY = '#9fe9ff';
const COLOUR_WING = 'rgba(233, 248, 252, 0.75)';
const COLOUR_INK = '#06212a';
const COLOUR_MUTED = 'rgba(206, 232, 238, 0.28)';

/** How much bigger a frog is drawn at the top of its arc. Height, without an up direction. */
const HOP_SWELL = 0.4;

export class FrogsFightGame implements Game {
  readonly #position: Position = createGame();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  /** Pre-allocated, so a step allocates nothing. */
  readonly #push = { x: 0, y: 0 };
  readonly #dragOrigin: Record<SeatId, Vec2 | null> = { p1: null, p2: null };
  /**
   * One generator per bot, seeded from the match seed.
   *
   * A frog decides when it lands and lands when its hop ends, so the number of decisions a
   * seat has made by any moment depends on the lengths of the hops it chose — which is the
   * one coupling a constant draw count per decision does not remove. Sharing one stream
   * measures as *no different* (see SPEC.md), so this is insurance rather than a fix: it
   * costs two integers at init and makes the two seats independent by construction instead
   * of by measurement.
   */
  readonly #botRng: Record<SeatId, Rng> = { p1: new Rng(1), p2: new Rng(2) };

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  get position(): Position {
    return this.#position;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    // Two draws, always, before anything else touches the stream: the seats' generators are
    // a deterministic function of the match seed, so the match still replays exactly.
    this.#botRng.p1 = new Rng(context.rng.next() | 0);
    this.#botRng.p2 = new Rng(context.rng.next() | 0);
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    this.#dragOrigin.p1 = null;
    this.#dragOrigin.p2 = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetGame(this.#position);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;

    for (const seat of SEATS) this.#drive(seat, input, fixedDeltaSeconds);
    step(this.#position, fixedDeltaSeconds, this.#rng);
    this.#winner = winnerOf(this.#position);
  }

  #drive(seat: SeatId, input: InputState, fixedDeltaSeconds: number): void {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty === null) {
      this.#humanPush(seat, input);
    } else {
      botIntent(
        this.#position,
        seat,
        difficulty,
        seat === 'p1' ? this.#botP1State : this.#botP2State,
        fixedDeltaSeconds,
        this.#botRng[seat],
        this.#push,
      );
    }
    hopFrog(this.#position, seat, this.#push.x, this.#push.y);
  }

  /**
   * How a person hops.
   *
   * The **direction of the drag**, not the position of the finger. The shell divides a
   * shared board into two pointer zones, so each player owns half the screen and the pad a
   * frog wants is as likely as not in the other player's half — an absolute pointer simply
   * cannot reach it. A relative drag works from anywhere your own thumb can be, which is the
   * same idiom Robot Arena and Snake Clash landed on for the same reason.
   *
   * Keys give a direction directly, and both families end up in the same `padTowards`, so
   * neither can aim finer than the other: there are at most eight answers to a push.
   *
   * Holding keeps hopping. The direction is read afresh the moment the frog is ready, so a
   * held key or a held drag carries a frog across the pond, and letting go stops it on the
   * pad it is standing on rather than the one it was flying to.
   */
  #humanPush(seat: SeatId, input: InputState): void {
    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    this.#push.x = 0;
    this.#push.y = 0;

    if (pointer === null) {
      this.#dragOrigin[seat] = null;
      this.#push.x = seatInput.move.x;
      this.#push.y = seatInput.move.y;
      return;
    }

    let origin = this.#dragOrigin[seat];
    if (origin === null || seatInput.actionPressed) {
      origin = vec2();
      origin.x = pointer.x;
      origin.y = pointer.y;
      this.#dragOrigin[seat] = origin;
    }

    const dx = pointer.x - origin.x;
    const dy = pointer.y - origin.y;
    if (Math.hypot(dx, dy) <= DRAG_DEADZONE) {
      this.#push.x = seatInput.move.x;
      this.#push.y = seatInput.move.y;
      return;
    }
    this.#push.x = dx;
    this.#push.y = dy;
  }

  getActiveSeat(): SeatId | null {
    // Never: both frogs hop at once, so the shell keeps its two pointer zones.
    return null;
  }

  getScore(): MatchScore {
    return {
      p1: this.#position.p1.score,
      p2: this.#position.p2.score,
      winner: this.#winner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#dragOrigin.p1 = null;
    this.#dragOrigin.p2 = null;
    this.#winner = null;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_WATER);
    this.#drawWater(renderer);
    this.#drawPads(renderer);
    this.#drawBugs(renderer);
    for (const seat of SEATS) this.#drawFrog(renderer, seat);
    this.#drawScores(renderer);
  }

  /** Three rings about the centre. Concentric, so the picture is its own reflection. */
  #drawWater(renderer: Renderer): void {
    const centre = POND / 2;
    for (let ring = 1; ring <= 3; ring += 1) {
      renderer.strokeCircle(centre, centre, ring * 110, 3, COLOUR_RIPPLE);
    }
  }

  #drawPads(renderer: Renderer): void {
    for (let pad = 0; pad < PAD_COUNT; pad += 1) {
      const x = PAD_X[pad]!;
      const y = PAD_Y[pad]!;
      renderer.circle(x, y, PAD_RADIUS, COLOUR_PAD);
      renderer.strokeCircle(x, y, PAD_RADIUS - 3, 4, COLOUR_PAD_RIM);
      // One vein, drawn as a full diameter, so a pad is the same picture upside down. The
      // angle is shared with the pad's reflection for exactly the same reason.
      const angle = (Math.min(pad, mirrorPad(pad)) % 4) * (Math.PI / 4);
      const reach = PAD_RADIUS - 8;
      renderer.line(
        x - Math.cos(angle) * reach,
        y - Math.sin(angle) * reach,
        x + Math.cos(angle) * reach,
        y + Math.sin(angle) * reach,
        3,
        COLOUR_VEIN,
      );
    }
    // Each frog's home pad wears its owner's mark, so a player can always find the pad they
    // came from: a ring for seat one, a square for seat two.
    const p1Home = this.#position.p1.home;
    renderer.strokeCircle(PAD_X[p1Home]!, PAD_Y[p1Home]!, PAD_RADIUS - 12, 5, SEAT_PALETTE.p1.deep);
    const p2Home = this.#position.p2.home;
    const side = (PAD_RADIUS - 12) * 1.6;
    renderer.strokeRect(
      PAD_X[p2Home]! - side / 2,
      PAD_Y[p2Home]! - side / 2,
      side,
      side,
      5,
      SEAT_PALETTE.p2.deep,
    );
  }

  /**
   * Rule 7: a fly is one small body with two wings; a dragonfly is a long body with four,
   * ringed by five pips you can count. Nothing about the prize is carried by its colour, and
   * nothing about it is carried by text either — a number would be upside down for one of
   * the two people reading it.
   *
   * The shrinking ring around each is its remaining life, which is why a bot is allowed to
   * read it: it is on the screen for both players.
   */
  #drawBugs(renderer: Renderer): void {
    for (const bug of this.#position.bugs) {
      if (!bug.active) continue;
      const x = PAD_X[bug.pad]!;
      const y = PAD_Y[bug.pad]!;
      const left = bug.life / bug.lifeTotal;
      const dragonfly = bug.points === DRAGONFLY_POINTS;
      renderer.strokeCircle(x, y, 6 + left * 26, 3, COLOUR_MUTED);

      if (!dragonfly) {
        renderer.line(x - 13, y - 7, x + 13, y + 7, 4, COLOUR_WING);
        renderer.line(x - 13, y + 7, x + 13, y - 7, 4, COLOUR_WING);
        renderer.circle(x, y, 8, COLOUR_FLY);
        renderer.circle(x, y, 3, COLOUR_INK);
        continue;
      }

      renderer.line(x - 22, y - 10, x + 22, y + 10, 5, COLOUR_WING);
      renderer.line(x - 22, y + 10, x + 22, y - 10, 5, COLOUR_WING);
      renderer.line(x - 18, y, x + 18, y, 9, COLOUR_DRAGONFLY);
      renderer.circle(x + 18, y, 7, COLOUR_DRAGONFLY);
      renderer.circle(x + 18, y, 3, COLOUR_INK);
      for (let pip = 0; pip < DRAGONFLY_POINTS; pip += 1) {
        const angle = (pip / DRAGONFLY_POINTS) * Math.PI * 2;
        renderer.circle(x + Math.cos(angle) * 34, y + Math.sin(angle) * 34, 4, COLOUR_DRAGONFLY);
      }
    }
  }

  /**
   * Rule 7 again: seat one is a spotted frog with round eyes, seat two a striped frog with
   * square ones. Two frogs of the same shape hopping about one pond is where colour alone
   * fails hardest — a player glancing up mid-hop has to know which one is theirs.
   *
   * Height in the arc is drawn as size rather than as an offset, because an offset needs an
   * "up" and this board is read from both ends. A frog swells towards whoever is watching
   * and its shadow shrinks under it, which reads the same way round either way up.
   */
  #drawFrog(renderer: Renderer, seat: SeatId): void {
    const frog = frogOf(this.#position, seat);
    const palette = SEAT_PALETTE[seat];
    const travelled = frog.flightTotal > 0 ? 1 - frog.flight / frog.flightTotal : 1;
    const fromX = PAD_X[frog.from]!;
    const fromY = PAD_Y[frog.from]!;
    const x = fromX + (PAD_X[frog.pad]! - fromX) * travelled;
    const y = fromY + (PAD_Y[frog.pad]! - fromY) * travelled;
    const rise = frog.flight > 0 ? Math.sin(Math.PI * travelled) : 0;
    const radius = FROG_RADIUS * (1 + HOP_SWELL * rise);

    renderer.circle(x, y, FROG_RADIUS * (1 - 0.3 * rise), COLOUR_SHADOW);
    renderer.circle(x, y, radius, palette.base);
    renderer.strokeCircle(x, y, radius - 2, 3, palette.deep);

    // Seat one is spotted, seat two striped. The two marks are point reflections of each
    // other, so each player reads their own frog the right way up from their own side.
    const facing = seat === 'p1' ? -1 : 1;
    if (seat === 'p1') {
      for (let spot = 0; spot < 3; spot += 1) {
        const angle = (spot / 3) * Math.PI * 2 + Math.PI / 6;
        renderer.circle(
          x + Math.cos(angle) * radius * 0.42,
          y + Math.sin(angle) * radius * 0.42,
          radius * 0.16,
          palette.deep,
        );
      }
    } else {
      for (let stripe = -1; stripe <= 1; stripe += 1) {
        const offset = stripe * radius * 0.4;
        const half = Math.sqrt(Math.max(0, radius * radius * 0.42 - offset * offset));
        renderer.line(x - half, y + offset, x + half, y + offset, radius * 0.14, palette.deep);
      }
    }

    const eyeX = radius * 0.42;
    const eyeY = facing * radius * 0.5;
    const eye = radius * 0.26;
    if (seat === 'p1') {
      renderer.circle(x - eyeX, y + eyeY, eye, '#f6fbfa');
      renderer.circle(x + eyeX, y + eyeY, eye, '#f6fbfa');
      renderer.circle(x - eyeX, y + eyeY, eye * 0.5, COLOUR_INK);
      renderer.circle(x + eyeX, y + eyeY, eye * 0.5, COLOUR_INK);
    } else {
      renderer.rect(x - eyeX - eye, y + eyeY - eye, eye * 2, eye * 2, '#f6fbfa');
      renderer.rect(x + eyeX - eye, y + eyeY - eye, eye * 2, eye * 2, '#f6fbfa');
      renderer.rect(x - eyeX - eye * 0.5, y + eyeY - eye * 0.5, eye, eye, COLOUR_INK);
      renderer.rect(x + eyeX - eye * 0.5, y + eyeY - eye * 0.5, eye, eye, COLOUR_INK);
    }
  }

  /**
   * Ten pips a side, one a point, on that player's own edge of the pond: circles for seat
   * one along the bottom, squares for seat two along the top. Countable rather than written,
   * so both people read their own score upright and neither needs the colours to tell the
   * two rows apart. A dragonfly fills five of them at once, which is the whole drama.
   */
  #drawScores(renderer: Renderer): void {
    const spacing = 38;
    for (const seat of SEATS) {
      const palette = SEAT_PALETTE[seat];
      const frog: Frog = frogOf(this.#position, seat);
      const y = seat === 'p1' ? POND - 32 : 32;
      for (let pip = 0; pip < TARGET_POINTS; pip += 1) {
        const x = POND / 2 + (pip - (TARGET_POINTS - 1) / 2) * spacing;
        const filled = pip < frog.score;
        const colour = filled ? palette.base : COLOUR_MUTED;
        if (seat === 'p1') renderer.circle(x, y, 12, colour);
        else renderer.rect(x - 11, y - 11, 22, 22, colour);
      }
    }
  }
}

export { POND as BOARD_WIDTH, POND as BOARD_HEIGHT };
