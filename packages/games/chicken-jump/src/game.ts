import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  FENCE,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  HANG_SECONDS,
  HESITATE_SECONDS,
  LANE_HEIGHT,
  MAX_BLOCKS,
  PERFECT_POINTS,
  STUMBLE_SECONDS,
  blockX,
  botJump,
  createBotState,
  createMatch,
  hopHeight,
  landOf,
  perchOf,
  perfectOf,
  resetBotState,
  resetMatch,
  stackedOf,
  step,
  stopPointOf,
  winnerOf,
  worldXOf,
  worldYOf,
} from './rules.js';
import type { BotDifficulty, BotState, Match } from './rules.js';

/**
 * Chicken Jump — a perch each, a swinging block each, and one button.
 *
 * The rules module holds the whole simulation, in perch-local units. What lives here is how
 * a person's press becomes a hop, and how one set of perch-local numbers is drawn twice, a
 * half turn apart.
 */

const COLOUR_SKY = '#101a24';
/**
 * Two shades of half, so which end is yours survives greyscale.
 *
 * Far enough apart to read as two different surfaces at a glance and in a monochrome
 * screenshot, which a pair a few per cent of luminance apart does not.
 */
const COLOUR_HALF_NEAR = '#1e3441';
const COLOUR_HALF_FAR = '#0d1a22';
const COLOUR_FENCE = '#07121a';
const COLOUR_FENCE_EDGE = 'rgba(236, 244, 250, 0.22)';
const COLOUR_STRAW = '#c89a3c';
const COLOUR_STRAW_DARK = '#8a6820';
const COLOUR_POLE = '#79899a';
const COLOUR_INK = '#06101a';
const COLOUR_GOLD = '#f6d67a';
const COLOUR_CHALK = 'rgba(236, 244, 250, 0.5)';
const COLOUR_SPENT = 'rgba(236, 244, 250, 0.15)';

/** How deep the straw is drawn at each seat's own edge. */
const FLOOR_DEPTH = 26;
/** Perch-local height of the top of the pole, where the chicken stands. */
const POLE_TOP = 214;
/** Perch-local height the block swings at. Just above the top of the chicken's hop. */
const SWING_HEIGHT = 384;
const BLOCK_THICK = 18;
const POLE_WIDTH = 16;
/** Blocks of the tower that are drawn. The rest have scrolled off below the perch. */
const VISIBLE_STACK = 9;
const CHICK_RADIUS = 17;
/** Where the row of remaining-block ticks sits, and how far it reaches either way. */
const TICK_HEIGHT = 44;
const TICK_REACH = 290;
/** Seconds a landing is flashed for. */
const FLASH_SECONDS = 0.55;

/** Both seats, as a constant rather than an array allocated per frame. */
const SEATS: readonly SeatId[] = ['p1', 'p2'];

export class ChickenJumpGame implements Game {
  readonly #match: Match = createMatch();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  get match(): Match {
    return this.#match;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetMatch(this.#match);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;

    const p1 = this.#jumpFor('p1', input, fixedDeltaSeconds);
    const p2 = this.#jumpFor('p2', input, fixedDeltaSeconds);
    step(this.#match, p1, p2, fixedDeltaSeconds, this.#rng);

    this.#winner = winnerOf(this.#match);
  }

  #jumpFor(seat: SeatId, input: InputState, fixedDeltaSeconds: number): boolean {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      return botJump(
        perchOf(this.#match, seat),
        difficulty,
        seat === 'p1' ? this.#botP1State : this.#botP2State,
        fixedDeltaSeconds,
        this.#rng,
      );
    }
    // One button, one thing it says, and both instruments say it the same way: the engine
    // has already folded this seat's action key and a pointer going down inside this seat's
    // own zone into the same edge, so nothing here has to know which arrived. Nothing is
    // held — a press is the whole input, so a key left down cannot hop twice and a finger
    // resting on the glass cannot hold the rope.
    return input.seat(seat).actionPressed;
  }

  getActiveSeat(): SeatId | null {
    // Never: both perches are live at once, so the shell keeps its two pointer zones.
    return null;
  }

  getScore(): MatchScore {
    return {
      p1: this.#match.p1.points,
      p2: this.#match.p2.points,
      winner: this.#winner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetMatch(this.#match);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#winner = null;
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_SKY);
    this.#drawFence(renderer);
    for (const seat of SEATS) {
      this.#drawGround(renderer, seat);
      this.#drawTower(renderer, seat);
      this.#drawPole(renderer, seat);
      this.#drawBlock(renderer, seat);
      this.#drawChicken(renderer, seat);
      this.#drawTicks(renderer, seat);
    }
  }

  /**
   * Fill a band of one perch, given in perch-local units.
   *
   * Every rectangle in this file goes through here, so the half turn that separates the two
   * seats is written once. p1's half counts upward from the bottom edge of the field and p2's
   * downward from the top, and taking the min of the two mapped edges makes that difference
   * disappear at the call site.
   */
  #slab(
    renderer: Renderer,
    seat: SeatId,
    across: number,
    width: number,
    low: number,
    high: number,
    colour: string,
  ): void {
    const centreX = worldXOf(seat, across);
    const a = worldYOf(seat, low);
    const b = worldYOf(seat, high);
    const top = a < b ? a : b;
    renderer.rect(centreX - width / 2, top, width, Math.abs(b - a), colour);
  }

  #drawGround(renderer: Renderer, seat: SeatId): void {
    const shade = seat === 'p1' ? COLOUR_HALF_NEAR : COLOUR_HALF_FAR;
    const top = seat === 'p1' ? FIELD_HEIGHT - LANE_HEIGHT : 0;
    renderer.rect(0, top, FIELD_WIDTH, LANE_HEIGHT, shade);

    const floorTop = seat === 'p1' ? FIELD_HEIGHT - FLOOR_DEPTH : 0;
    renderer.rect(0, floorTop, FIELD_WIDTH, FLOOR_DEPTH, COLOUR_STRAW);
    // Rule 7: the two floors carry different straw — p1's upright, p2's raked — so the two
    // halves are told apart by pattern as well as by which shade of blue they are.
    for (let x = 0; x < FIELD_WIDTH; x += 30) {
      const skew = seat === 'p1' ? 0 : 13;
      renderer.line(x, floorTop, x + skew, floorTop + FLOOR_DEPTH, 2, COLOUR_STRAW_DARK);
    }
  }

  /**
   * The tower of blocks already on the pole.
   *
   * Only the top few are drawn: the pole is a fixed height and the tower scrolls down
   * through it, so a seat on its fifteenth block reads exactly as legibly as one on its
   * second. The widths taper upward because that is what the narrowing pole means — each
   * block was as wide as the pole was forgiving when it landed.
   */
  #drawTower(renderer: Renderer, seat: SeatId): void {
    const perch = perchOf(this.#match, seat);
    const palette = SEAT_PALETTE[seat];
    const stacked = stackedOf(perch);
    const shown = stacked < VISIBLE_STACK ? stacked : VISIBLE_STACK;
    for (let d = 0; d < shown; d += 1) {
      const top = POLE_TOP - d * BLOCK_THICK;
      const half = landOf(perch.points - d * PERFECT_POINTS);
      this.#slab(renderer, seat, 0, half * 2, top - BLOCK_THICK + 2, top, palette.soft);
      this.#slab(renderer, seat, 0, half * 2, top - 2, top, palette.deep);
      // Rule 7: p2's blocks are notched down the middle, p1's are plain, so the two towers
      // are distinguishable with the chickens out of frame.
      if (seat === 'p2') {
        this.#slab(renderer, seat, 0, 4, top - BLOCK_THICK + 2, top, COLOUR_INK);
      }
    }
  }

  /**
   * The pole, the band of it that still catches, and the middle of that band.
   *
   * Drawn at *this seat's* current width, which is the point: the two seats are handed the
   * same blocks in the same order, and the only visible difference between them is how much
   * of the pole is left. A player who is ahead can watch their own pole close.
   */
  #drawPole(renderer: Renderer, seat: SeatId): void {
    const perch = perchOf(this.#match, seat);
    const palette = SEAT_PALETTE[seat];
    this.#slab(renderer, seat, 0, POLE_WIDTH, FLOOR_DEPTH, POLE_TOP, COLOUR_POLE);

    const catchBand = landOf(perch.points);
    const middle = perfectOf(perch.points);
    const y = POLE_TOP + 6;
    this.#slab(renderer, seat, 0, catchBand * 2, y, y + 3, COLOUR_CHALK);
    this.#slab(renderer, seat, 0, middle * 2, y, y + 6, COLOUR_GOLD);
    // The ends of the band, so how much pole is left reads without measuring the bar.
    for (const side of [-1, 1]) {
      this.#slab(renderer, seat, side * catchBand, 3, y, y + 12, palette.base);
    }

    if (perch.block.live && perch.stance === 'waiting') this.#drawShadow(renderer, seat);
    this.#drawFlash(renderer, seat);
  }

  /**
   * Where the block would come to rest if it were cut loose right now.
   *
   * **This is drawn because the bot reads it** — `stopPointOf` is the one number its whole
   * policy turns on, and CLAUDE.md rule 6 says a bot may never know something a player on
   * the same screen cannot. It is also simply what the game is about: the block's position
   * is not the answer and its speed is not the answer, and a player who could not see the
   * two combined would be guessing rather than timing.
   *
   * Shape as well as colour (rule 7): a wide bar when it would catch, a narrow tick when it
   * would not, and a filled square when it would settle in the middle.
   */
  #drawShadow(renderer: Renderer, seat: SeatId): void {
    const perch = perchOf(this.#match, seat);
    const palette = SEAT_PALETTE[seat];
    const stop = stopPointOf(perch.block);
    const off = Math.abs(stop);
    const catches = off <= landOf(perch.points);
    const middle = off <= perfectOf(perch.points);
    const x = worldXOf(seat, stop);
    renderer.line(
      x,
      worldYOf(seat, SWING_HEIGHT - BLOCK_THICK),
      x,
      worldYOf(seat, POLE_TOP + 20),
      2,
      catches ? COLOUR_CHALK : COLOUR_SPENT,
    );
    const width = middle ? 22 : catches ? 16 : 5;
    this.#slab(
      renderer,
      seat,
      stop,
      width,
      POLE_TOP + 14,
      POLE_TOP + 24,
      middle ? COLOUR_GOLD : catches ? palette.base : COLOUR_SPENT,
    );
    if (middle) this.#slab(renderer, seat, stop, 22, POLE_TOP + 14, POLE_TOP + 24, COLOUR_GOLD);
  }

  /** A moment of feedback on the last block, fading out. Shape carries it, not only colour. */
  #drawFlash(renderer: Renderer, seat: SeatId): void {
    const perch = perchOf(this.#match, seat);
    if (perch.since > FLASH_SECONDS || perch.last === 'none') return;
    const lift = (perch.since / FLASH_SECONDS) * 46;
    const y = POLE_TOP + 34 + lift;
    if (perch.last === 'perfect') {
      this.#slab(renderer, seat, 0, 54, y, y + 8, COLOUR_GOLD);
      this.#slab(renderer, seat, 0, 8, y - 10, y + 18, COLOUR_GOLD);
    } else if (perch.last === 'landed') {
      this.#slab(renderer, seat, 0, 40, y, y + 6, COLOUR_CHALK);
    } else {
      // Everything that scored nothing gets the same broken cross, so a stumble, a miss and
      // a block nobody cut all read as "that one is gone" at a glance.
      this.#slab(renderer, seat, -14, 26, y, y + 6, COLOUR_SPENT);
      this.#slab(renderer, seat, 14, 26, y, y + 6, COLOUR_SPENT);
    }
  }

  /** The block on the rope, or the one sliding to a halt under the chicken. */
  #drawBlock(renderer: Renderer, seat: SeatId): void {
    const perch = perchOf(this.#match, seat);
    const palette = SEAT_PALETTE[seat];
    const block = perch.block;
    if (!block.live) return;

    const across = blockX(block);
    // A free block rides down with the chicken: it is on its way to the top of the pole, and
    // drawing it at the swing height would leave the chicken landing on nothing.
    const drop = block.free ? (perch.air / HANG_SECONDS) * (SWING_HEIGHT - POLE_TOP - 8) : 0;
    const centre = SWING_HEIGHT - (drop > SWING_HEIGHT ? SWING_HEIGHT : drop);
    const half = landOf(perch.points);

    if (!block.free) {
      // The rope, so a hanging block reads as hanging rather than floating.
      renderer.line(
        worldXOf(seat, across),
        worldYOf(seat, LANE_HEIGHT),
        worldXOf(seat, across),
        worldYOf(seat, centre + BLOCK_THICK / 2),
        2,
        COLOUR_CHALK,
      );
    }
    this.#slab(
      renderer,
      seat,
      across,
      half * 2,
      centre - BLOCK_THICK / 2,
      centre + BLOCK_THICK / 2,
      palette.base,
    );
    // The middle of the block, which is the part that has to end up over the pole.
    this.#slab(
      renderer,
      seat,
      across,
      perfectOf(perch.points) * 2,
      centre - BLOCK_THICK / 2 + 4,
      centre + BLOCK_THICK / 2 - 4,
      COLOUR_GOLD,
    );
    // Rule 7 again: p2's block is barred across, p1's is plain.
    if (seat === 'p2') {
      for (let i = -1; i <= 1; i += 2) {
        this.#slab(
          renderer,
          seat,
          across + (i * half) / 2,
          4,
          centre - BLOCK_THICK / 2,
          centre + BLOCK_THICK / 2,
          COLOUR_INK,
        );
      }
    }
  }

  #drawChicken(renderer: Renderer, seat: SeatId): void {
    const perch = perchOf(this.#match, seat);
    const palette = SEAT_PALETTE[seat];
    const stumbling = perch.stance === 'stumbling';
    const height = POLE_TOP + CHICK_RADIUS + hopHeight(perch.stance === 'airborne' ? perch.air : 0);
    // A stumble tips the chicken off to one side, which is the only time it is not over its
    // own pole — and it is the one outcome a player needs to feel rather than read.
    const lean = stumbling ? (1 - perch.rest / STUMBLE_SECONDS) * 26 : 0;
    const x = worldXOf(seat, lean);
    const y = worldYOf(seat, height);

    renderer.circle(x, y, CHICK_RADIUS, palette.base);
    renderer.strokeCircle(x, y, CHICK_RADIUS, 2, COLOUR_INK);
    // The beak, pointing along this seat's own reading of the world.
    const beakY = worldYOf(seat, height - 3);
    renderer.line(x + CHICK_RADIUS - 2, beakY, x + CHICK_RADIUS + 9, beakY, 4, COLOUR_STRAW);
    // Rule 7: p1 wears a single comb, p2 is banded across.
    if (seat === 'p1') {
      renderer.circle(x, worldYOf(seat, height + CHICK_RADIUS - 1), 6, COLOUR_GOLD);
    } else {
      for (let i = -1; i <= 1; i += 1) {
        const offset = i * 7;
        const half = Math.sqrt(CHICK_RADIUS * CHICK_RADIUS - offset * offset) - 2;
        renderer.rect(x - half, y + offset - 1.5, half * 2, 3, COLOUR_INK);
      }
    }
    // A ring while the block is on the rope and the press is live, so "it is your move" is
    // something you can see rather than infer. It closes as the hesitation clock runs out.
    if (perch.stance === 'waiting') {
      const left = 1 - perch.wait / HESITATE_SECONDS;
      renderer.strokeCircle(x, y, CHICK_RADIUS + 5 + left * 9, 2, COLOUR_CHALK);
    }
  }

  /**
   * How many blocks this seat has left, as a row of ticks along its own floor.
   *
   * The shell's HUD prints both scores; what it cannot show is how much of the match is
   * left, and in this game that is not a clock — it is a count, and the two seats can be on
   * different counts because each spends its own.
   */
  #drawTicks(renderer: Renderer, seat: SeatId): void {
    const perch = perchOf(this.#match, seat);
    const palette = SEAT_PALETTE[seat];
    const spacing = (TICK_REACH * 2) / MAX_BLOCKS;
    for (let i = 0; i < MAX_BLOCKS; i += 1) {
      const across = -TICK_REACH + spacing * (i + 0.5);
      const left = i >= perch.used;
      this.#slab(
        renderer,
        seat,
        across,
        spacing - 6,
        TICK_HEIGHT,
        TICK_HEIGHT + 9,
        left ? palette.base : COLOUR_SPENT,
      );
      if (seat === 'p2' && left) {
        this.#slab(
          renderer,
          seat,
          across,
          spacing - 6,
          TICK_HEIGHT + 3,
          TICK_HEIGHT + 5,
          COLOUR_INK,
        );
      }
    }
  }

  /** The strip between the two halves, which belongs to neither player. */
  #drawFence(renderer: Renderer): void {
    const top = LANE_HEIGHT;
    renderer.rect(0, top, FIELD_WIDTH, FENCE, COLOUR_FENCE);
    renderer.line(0, top, FIELD_WIDTH, top, 2, COLOUR_FENCE_EDGE);
    renderer.line(0, top + FENCE, FIELD_WIDTH, top + FENCE, 2, COLOUR_FENCE_EDGE);
    // Posts, spaced from both ends inward so the strip is symmetric under the half turn that
    // separates the two seats. Filling it from one end would have one player reading it one
    // way and the other the other, which is the sort of small asymmetry a shared element has
    // no excuse for.
    for (let i = 0; i < 9; i += 1) {
      const x = 40 + i * ((FIELD_WIDTH - 80) / 8);
      renderer.rect(x - 3, top + 8, 6, FENCE - 16, COLOUR_FENCE_EDGE);
    }
  }
}
