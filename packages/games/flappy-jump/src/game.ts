import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  DIVIDER,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  GAP_START,
  JUMPER_RADIUS,
  LANE_HEIGHT,
  MAX_HOOPS,
  POST_LENGTH,
  POST_THICKNESS,
  TARGET_BASKETS,
  botIntent,
  createBotState,
  createMatch,
  gapOf,
  laneOf,
  nextHoop,
  resetBotState,
  resetMatch,
  step,
  winnerOf,
  worldXOf,
  worldYOf,
} from './rules.js';
import type { BotDifficulty, BotState, Intent, Match, Lane } from './rules.js';

/**
 * Flappy Jump — a lane each, a hoop stream each, and one button.
 *
 * The rules module holds the whole simulation, in lane-local units. What lives here is how
 * a person's tap becomes an {@link Intent}, and how one set of lane-local numbers is drawn
 * twice, a half turn apart.
 */

const COLOUR_NIGHT = '#080e1c';
/**
 * Two shades of lane, so which half is yours survives greyscale.
 *
 * Far enough apart to read as two different surfaces at a glance and in a monochrome
 * screenshot — the first pair differed by about two per cent of luminance and might as
 * well have been one colour.
 */
const COLOUR_LANE_NEAR = '#1d3054';
const COLOUR_LANE_FAR = '#0c1527';
const COLOUR_DIVIDER = '#060a14';
const COLOUR_DIVIDER_EDGE = 'rgba(233, 240, 255, 0.22)';
const COLOUR_FLOOR = '#b0762f';
const COLOUR_FLOOR_DARK = '#7d5220';
const COLOUR_RIM = '#f4d47c';
const COLOUR_INK = '#050a14';
const COLOUR_CHALK = 'rgba(233, 240, 255, 0.5)';
const COLOUR_SPENT = 'rgba(233, 240, 255, 0.16)';

/** How deep the wooden floor strip is drawn at each seat's own edge. */
const FLOOR_DEPTH = 26;

/** Lane-x of the basket pips and of the next-hoop marker, behind the jumper. */
const PIP_LEAD = -128;
const MARKER_LEAD = -96;

/** Both seats, as a constant rather than an array allocated per frame. */
const SEATS: readonly SeatId[] = ['p1', 'p2'];

export class FlappyJumpGame implements Game {
  readonly #match: Match = createMatch();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  /**
   * Whether each seat's "up" key was already down last step.
   *
   * A wing-beat is an **edge**, not a level. The engine reports the action key as a clean
   * press/hold/release pair already, but the movement axis is a level — so W and the up
   * arrow, which players reach for first in a game about flying, would otherwise beat a
   * wing on every one of the sixty steps they were held. Held here rather than in the
   * rules because it is a fact about a keyboard, not about the game.
   */
  #p1Up = false;
  #p2Up = false;

  get match(): Match {
    return this.#match;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    this.#p1Up = false;
    this.#p2Up = false;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetMatch(this.#match);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;

    const p1 = this.#intentFor('p1', input, fixedDeltaSeconds);
    const p2 = this.#intentFor('p2', input, fixedDeltaSeconds);
    step(this.#match, p1, p2, fixedDeltaSeconds, this.#rng);

    this.#winner = winnerOf(this.#match);
  }

  #intentFor(seat: SeatId, input: InputState, fixedDeltaSeconds: number): Intent {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      return botIntent(
        laneOf(this.#match, seat),
        difficulty,
        seat === 'p1' ? this.#botP1State : this.#botP2State,
        fixedDeltaSeconds,
        this.#rng,
      );
    }
    return this.#humanIntent(seat, input);
  }

  /**
   * One button, two things it can say.
   *
   * A fresh press beats a wing; anything still held glides. That is the whole scheme, and
   * it is the same scheme through a thumb and through a key — the engine has already
   * folded a pointer down in this seat's zone and this seat's action key into one action,
   * so nothing here has to know which arrived. The movement axis is folded in too, on its
   * own rising edge, because W and the up arrow are what a player tries first.
   *
   * There is no *rate* advantage to be had from either family: the beat itself is capped
   * by the wing's recharge inside {@link step}, so a key held down, a key mashed, and a
   * thumb tapping all reach the same ceiling.
   */
  #humanIntent(seat: SeatId, input: InputState): Intent {
    const seatInput = input.seat(seat);
    const up = seatInput.move.y < 0;
    const wasUp = seat === 'p1' ? this.#p1Up : this.#p2Up;
    if (seat === 'p1') this.#p1Up = up;
    else this.#p2Up = up;

    if (seatInput.actionPressed || (up && !wasUp)) return 'flap';
    if (seatInput.actionHeld || up) return 'glide';
    return 'idle';
  }

  getActiveSeat(): SeatId | null {
    // Never: both lanes are live at once, so the shell keeps its two pointer zones.
    return null;
  }

  getScore(): MatchScore {
    return {
      p1: this.#match.p1.baskets,
      p2: this.#match.p2.baskets,
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
    this.#p1Up = false;
    this.#p2Up = false;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_NIGHT);
    this.#drawDivider(renderer);
    for (const seat of SEATS) {
      this.#drawLane(renderer, seat);
      this.#drawHoops(renderer, seat);
      this.#drawPips(renderer, seat);
      this.#drawJumper(renderer, seat);
    }
  }

  /**
   * Fill a band of one lane, given in lane-local heights.
   *
   * Every rectangle in this file goes through here, so the half turn that separates the
   * two seats is written once. p1's lane counts upward from the bottom edge of the field
   * and p2's downward from the top, and taking the min of the two mapped edges makes that
   * difference disappear at the call site.
   */
  #band(
    renderer: Renderer,
    seat: SeatId,
    lead: number,
    width: number,
    low: number,
    high: number,
    colour: string,
  ): void {
    const centreX = worldXOf(seat, lead);
    const a = worldYOf(seat, low);
    const b = worldYOf(seat, high);
    const top = a < b ? a : b;
    renderer.rect(centreX - width / 2, top, width, Math.abs(b - a), colour);
  }

  #drawLane(renderer: Renderer, seat: SeatId): void {
    const shade = seat === 'p1' ? COLOUR_LANE_NEAR : COLOUR_LANE_FAR;
    const top = seat === 'p1' ? FIELD_HEIGHT - LANE_HEIGHT : 0;
    renderer.rect(0, top, FIELD_WIDTH, LANE_HEIGHT, shade);

    // The floor, at this seat's own edge of the device.
    const floorTop = seat === 'p1' ? FIELD_HEIGHT - FLOOR_DEPTH : 0;
    renderer.rect(0, floorTop, FIELD_WIDTH, FLOOR_DEPTH, COLOUR_FLOOR);
    // Rule 7: the two floors carry different boarding — p1's upright, p2's raked — so the
    // two halves are told apart by pattern as well as by which shade of blue they are.
    for (let x = 0; x < FIELD_WIDTH; x += 32) {
      const skew = seat === 'p1' ? 0 : 14;
      renderer.line(x, floorTop, x + skew, floorTop + FLOOR_DEPTH, 2, COLOUR_FLOOR_DARK);
    }

    // A marker on the near edge at the height of the hoop coming next: the same
    // information the hoop itself carries, brought to where the jumper already is, so a
    // phone-sized lane is still readable.
    const lane = laneOf(this.#match, seat);
    const hoop = nextHoop(lane);
    if (hoop !== null) {
      this.#band(renderer, seat, MARKER_LEAD, 26, hoop.centre - 2, hoop.centre + 2, COLOUR_CHALK);
    }
  }

  /**
   * The shared band between the lanes, and the hoop budget written across it.
   *
   * The budget is the one thing in the match that genuinely belongs to both players — the
   * hoops are drawn once and handed to both lanes — so it is drawn in the one strip that
   * belongs to neither. A spent tick is dim, a remaining one bright, and running out of
   * them is what ends a match nobody wins outright.
   */
  #drawDivider(renderer: Renderer): void {
    const top = LANE_HEIGHT;
    renderer.rect(0, top, FIELD_WIDTH, DIVIDER, COLOUR_DIVIDER);
    renderer.line(0, top, FIELD_WIDTH, top, 2, COLOUR_DIVIDER_EDGE);
    renderer.line(0, top + DIVIDER, FIELD_WIDTH, top + DIVIDER, 2, COLOUR_DIVIDER_EDGE);

    // Spent from **both ends inward**, so the bar is symmetric under the half turn that
    // separates the two seats. Filling it from one end would have one player watching it
    // empty toward them and the other watching it empty away, which is the sort of small
    // asymmetry a shared element has no excuse for.
    const spacing = (FIELD_WIDTH - 40) / MAX_HOOPS;
    const left = this.#match.hoopsEntered;
    for (let i = 0; i < MAX_HOOPS; i += 1) {
      const spent = i * 2 < left || (MAX_HOOPS - 1 - i) * 2 < left;
      renderer.rect(
        20 + i * spacing,
        top + DIVIDER / 2 - 6,
        spacing - 4,
        12,
        spent ? COLOUR_SPENT : COLOUR_RIM,
      );
    }
  }

  /**
   * One seat's hoops.
   *
   * Drawn at *this seat's* current gap, which is the point: the two lanes carry the same
   * hoops in the same places, and the only visible difference between them is how much of
   * each one is open. A player who is ahead can see their own hoops closing.
   */
  #drawHoops(renderer: Renderer, seat: SeatId): void {
    const lane = laneOf(this.#match, seat);
    const palette = SEAT_PALETTE[seat];
    const gap = gapOf(lane);
    const half = gap / 2;

    for (const hoop of lane.hoops) {
      if (!hoop.live) continue;
      const x = worldXOf(seat, hoop.lead);
      if (x < -POST_THICKNESS || x > FIELD_WIDTH + POST_THICKNESS) continue;

      const low = hoop.centre - half;
      const high = hoop.centre + half;
      const bottom = Math.max(0, low - POST_LENGTH);
      const top = Math.min(LANE_HEIGHT, high + POST_LENGTH);

      if (low > bottom) {
        this.#band(renderer, seat, hoop.lead, POST_THICKNESS, bottom, low, palette.soft);
      }
      if (top > high) {
        this.#band(renderer, seat, hoop.lead, POST_THICKNESS, high, top, palette.soft);
      }
      // Rule 7 again: p2's posts are barred across, p1's are plain, so the two lanes are
      // distinguishable in a greyscale screenshot with the jumpers out of frame.
      if (seat === 'p2') {
        for (let i = 1; i <= 3; i += 1) {
          const h = bottom + ((low - bottom) * i) / 4;
          this.#band(renderer, seat, hoop.lead, POST_THICKNESS + 6, h - 1.5, h + 1.5, palette.deep);
          const g = high + ((top - high) * i) / 4;
          this.#band(renderer, seat, hoop.lead, POST_THICKNESS + 6, g - 1.5, g + 1.5, palette.deep);
        }
      }

      // The rims themselves: the two lips of the gap, which is what you aim between.
      renderer.circle(x, worldYOf(seat, low), 7, COLOUR_RIM);
      renderer.circle(x, worldYOf(seat, high), 7, COLOUR_RIM);
      renderer.line(
        x,
        worldYOf(seat, low),
        x,
        worldYOf(seat, high),
        1.5,
        gap <= GAP_START - 40 ? COLOUR_RIM : COLOUR_CHALK,
      );
    }
  }

  /**
   * Baskets as pips up each seat's own outer edge, filling toward that player.
   *
   * The shell's HUD prints both numbers; what it cannot show mid-flight is how close the
   * match is without reading two of them. Placed by the same lane-local mapping as
   * everything else, so the two columns are a half turn apart without any arithmetic here.
   */
  #drawPips(renderer: Renderer, seat: SeatId): void {
    const lane = laneOf(this.#match, seat);
    const palette = SEAT_PALETTE[seat];
    const spacing = (LANE_HEIGHT - 80) / TARGET_BASKETS;
    for (let i = 0; i < TARGET_BASKETS; i += 1) {
      const h = 46 + i * spacing;
      const filled = i < lane.baskets;
      this.#band(renderer, seat, PIP_LEAD, 14, h - 7, h + 7, filled ? palette.base : COLOUR_SPENT);
      if (seat === 'p2' && filled) {
        this.#band(renderer, seat, PIP_LEAD, 14, h - 1, h + 1, COLOUR_INK);
      }
    }
  }

  #drawJumper(renderer: Renderer, seat: SeatId): void {
    const lane: Readonly<Lane> = laneOf(this.#match, seat);
    const palette = SEAT_PALETTE[seat];
    const x = worldXOf(seat, 0);
    const y = worldYOf(seat, lane.height);

    // A short streak opposite the way it is travelling, so a fast drop is readable.
    // Clamped into the lane, or a knocked-down jumper near the ceiling would trail a
    // line across the divider and into the other seat's half.
    const behind = lane.height - lane.velocity * 0.05;
    const trail = worldYOf(seat, behind < 0 ? 0 : behind > LANE_HEIGHT ? LANE_HEIGHT : behind);
    renderer.line(x, trail, x, y, 5, palette.soft);

    renderer.circle(x, y, JUMPER_RADIUS, palette.base);
    renderer.strokeCircle(x, y, JUMPER_RADIUS, 2, COLOUR_INK);
    // Rule 7: p1's jumper carries a single centre spot, p2's is banded across.
    if (seat === 'p1') {
      renderer.circle(x, y, 5, COLOUR_INK);
    } else {
      for (let i = -1; i <= 1; i += 1) {
        // Chorded to the circle rather than a fixed width, so the outer bands sit inside
        // the ball instead of poking out of its sides.
        const offset = i * 7;
        const half = Math.sqrt(JUMPER_RADIUS * JUMPER_RADIUS - offset * offset) - 2;
        renderer.rect(x - half, y + offset - 1.5, half * 2, 3, COLOUR_INK);
      }
    }

    // Stunned: a ring that closes as the wing comes back, so being unable to beat is
    // something you can see rather than something you infer from not rising.
    if (lane.stun > 0) {
      renderer.strokeCircle(x, y, JUMPER_RADIUS + 6 + lane.stun * 30, 3, COLOUR_RIM);
    } else if (lane.recharge <= 0) {
      // Cocked: a thin ring that says the next tap will land. It is drawn because the bot
      // reads exactly this about its own wing, and rule 6 means a player must be able to
      // see anything the bot can — see the recharge gate in botIntent.
      renderer.strokeCircle(x, y, JUMPER_RADIUS + 5, 1.5, COLOUR_CHALK);
    }
  }
}
