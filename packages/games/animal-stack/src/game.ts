import { SEAT_PALETTE } from '@duelbox/engine';
import type { Rng, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  CARRY_GAP,
  CARRY_REACH,
  FALL_SECONDS,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  GRIP_DROP,
  GRIP_TURN,
  GUTTER,
  MAX_ANIMALS,
  PLATFORM_HALF,
  PLINTH_HEIGHT,
  YARD_HEIGHT,
  acrossOfWorld,
  backCentreOf,
  botIntent,
  clearIntent,
  createBotState,
  createGrip,
  createIntent,
  createMatch,
  gripStep,
  placedAt,
  resetBotState,
  resetGrip,
  resetMatch,
  speciesAt,
  step,
  supportHiAt,
  supportLoAt,
  tightestJointOf,
  towerMargin,
  weightAboveOf,
  winnerOf,
  worldXOf,
  worldYOf,
  yardOf,
} from './rules.js';
import type { BotDifficulty, BotState, Grip, Intent, Match, Yard } from './rules.js';

/**
 * Animal Stack — a platform each, a crane each, and one gesture.
 *
 * The rules module holds the whole simulation, in platform-local units. What lives here is
 * how a person's finger or key becomes an intent, and how one set of platform-local numbers
 * is drawn twice, a half turn apart.
 *
 * **What is drawn is what the bot reads** (CLAUDE.md rule 6), and in this game that is a
 * list rather than a single number: where every animal's feet are, where its back is, how
 * wide each of those is, which strip the next animal has to land on, where the weight of the
 * tower falls, and which join is closest to giving way. All of it is on the screen. The bot
 * does arithmetic on those numbers faster than a person can — that is what a bot is — but it
 * is handed no quantity a player cannot see, and it is handed one yard, never the match.
 */

const COLOUR_SKY = '#0e1620';
/**
 * Two shades of half, far enough apart to read as two different surfaces in a monochrome
 * screenshot — a pair a few per cent of luminance apart does not.
 */
const COLOUR_HALF_NEAR = '#1d2f3c';
const COLOUR_HALF_FAR = '#0b1620';
const COLOUR_GUTTER = '#050d13';
const COLOUR_GUTTER_EDGE = 'rgba(236, 244, 250, 0.2)';
const COLOUR_PLINTH = '#71818f';
const COLOUR_PLINTH_DEEP = '#46535d';
const COLOUR_INK = '#050d13';
const COLOUR_CHALK = 'rgba(236, 244, 250, 0.55)';
const COLOUR_FAINT = 'rgba(236, 244, 250, 0.16)';
const COLOUR_GOLD = '#f2c96b';
const COLOUR_ALARM = '#ff8a5c';
const COLOUR_HIDE = '#d9c39a';
const COLOUR_HIDE_DEEP = '#a88f62';

/** How much of one seat's half the tower is drawn in, above the platform's top surface. */
const VIEW_HEIGHT = YARD_HEIGHT - PLINTH_HEIGHT - 26;
/** The tallest animal there is, so the window leaves room for one on the crane. */
const TALLEST = 58;
/** Where the crane rail hangs, in drawn height above the platform. */
const RAIL_HEIGHT = VIEW_HEIGHT - 4;
/** Seconds a landing is flashed for. */
const FLASH_SECONDS = 0.6;

/** Both seats, as a constant rather than an array allocated per frame. */
const SEATS: readonly SeatId[] = ['p1', 'p2'];

/**
 * How far the tower has risen out of the window.
 *
 * The same rule for both seats and derived from that seat's own tower alone, so neither
 * player ever sees more of their own yard than the other sees of theirs (CLAUDE.md rule 9).
 * Pure, and called from the renderer only: the simulation has no idea a window exists.
 */
function scrollOf(yard: Readonly<Yard>): number {
  const wanted = yard.top + CARRY_GAP + TALLEST + 12 - VIEW_HEIGHT;
  return wanted > 0 ? wanted : 0;
}

/** Where the held animal's feet are, drawn height above the platform, part way through a fall. */
function heldBaseOf(yard: Readonly<Yard>): number {
  if (yard.stance !== 'dropping') return yard.top + CARRY_GAP;
  // A parabola, so it reads as a fall rather than a slide. Drawn only: the landing is judged
  // by the clock, and where the animal is mid-air changes nothing.
  const t = yard.fall / FALL_SECONDS;
  return yard.top + CARRY_GAP * (1 - t * t);
}

export class AnimalStackGame implements Game {
  readonly #match: Match = createMatch();
  readonly #botStates: Record<SeatId, BotState> = { p1: createBotState(), p2: createBotState() };
  readonly #grips: Record<SeatId, Grip> = { p1: createGrip(), p2: createGrip() };
  readonly #intents: Record<SeatId, Intent> = { p1: createIntent(), p2: createIntent() };

  #rng: Rng | null = null;
  #bots: Record<SeatId, BotDifficulty | null> = { p1: null, p2: null };
  #winner: SeatId | 'draw' | null = null;

  get match(): Match {
    return this.#match;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#bots = { p1: context.botDifficulty('p1'), p2: context.botDifficulty('p2') };
    this.#winner = null;
    for (const seat of SEATS) {
      resetBotState(this.#botStates[seat]);
      resetGrip(this.#grips[seat]);
      clearIntent(this.#intents[seat]);
    }
    resetMatch(this.#match);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    const rng = this.#rng;
    if (this.#winner !== null || rng === null) return;

    this.#read('p1', input, fixedDeltaSeconds, rng);
    this.#read('p2', input, fixedDeltaSeconds, rng);
    step(this.#match, this.#intents.p1, this.#intents.p2, fixedDeltaSeconds, rng);

    this.#winner = winnerOf(this.#match);
  }

  /**
   * Turn one seat's input into an intent, or ask its bot for one.
   *
   * The two input families arrive already folded together by the engine — `actionHeld` is
   * this seat's action key *or* a pointer down in this seat's own zone — so the gesture below
   * is spelled once and both instruments say it. Where they differ is what they can say about
   * *position*: a finger names a point, a key names a direction. Both reach the animal through
   * the same rate-limited walk at the same speed, so neither can place it faster than the
   * other, and a finger on the glass is the more specific instruction so it wins while it is
   * down.
   */
  #read(seat: SeatId, input: InputState, fixedDeltaSeconds: number, rng: Rng): void {
    const intent = this.#intents[seat];
    const difficulty = this.#bots[seat];
    if (difficulty !== null) {
      botIntent(
        yardOf(this.#match, seat),
        difficulty,
        this.#botStates[seat],
        fixedDeltaSeconds,
        rng,
        intent,
      );
      return;
    }

    clearIntent(intent);
    const seatInput = input.seat(seat);
    const grip = gripStep(
      this.#grips[seat],
      seatInput.actionPressed,
      seatInput.actionHeld,
      seatInput.actionReleased,
      fixedDeltaSeconds,
    );
    intent.turn = grip === GRIP_TURN;
    intent.drop = grip === GRIP_DROP;
    intent.slide = seatInput.move.x;
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      intent.aimActive = true;
      // The far seat reads the device the other way up, so its own left and right are the
      // device's right and left. That half turn lives in `acrossOfWorld` and nowhere else,
      // and the game never asks which half of the glass a finger is on — the engine already
      // decided that, on the zone the finger went down in.
      intent.aim = acrossOfWorld(seat, pointer.x);
      if (intent.aim > CARRY_REACH) intent.aim = CARRY_REACH;
      else if (intent.aim < -CARRY_REACH) intent.aim = -CARRY_REACH;
    }
  }

  getActiveSeat(): SeatId | null {
    // Never: both cranes are live at once, so the shell keeps its two pointer zones.
    return null;
  }

  getScore(): MatchScore {
    return { p1: this.#match.p1.count, p2: this.#match.p2.count, winner: this.#winner };
  }

  onPause(): void {}

  onResume(): void {
    // A press that began before the pause has no release to look forward to: the host clears
    // the input manager on a pause, so the key-up never arrives. Dropping the grip means a
    // resume cannot deliver a drop nobody asked for.
    for (const seat of SEATS) resetGrip(this.#grips[seat]);
  }

  destroy(): void {
    resetMatch(this.#match);
    for (const seat of SEATS) {
      resetBotState(this.#botStates[seat]);
      resetGrip(this.#grips[seat]);
      clearIntent(this.#intents[seat]);
    }
    this.#winner = null;
    this.#rng = null;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_SKY);
    this.#drawGutter(renderer);
    for (const seat of SEATS) {
      this.#drawYard(renderer, seat);
      this.#drawTower(renderer, seat);
      this.#drawSupport(renderer, seat);
      this.#drawHeld(renderer, seat);
      this.#drawPlinth(renderer, seat);
      this.#drawBalance(renderer, seat);
      this.#drawTicks(renderer, seat);
    }
  }

  /* ---------------------------------------------------------------- *
   * Two mappings: the tower scrolls, the platform does not.
   * ---------------------------------------------------------------- */

  /**
   * A band of the tower, given in platform-local units and clipped to this seat's window.
   *
   * Every rectangle above the platform goes through here, so both the half turn that
   * separates the two seats and the scroll are written once. Anything wholly outside the
   * window is dropped rather than drawn, which is what keeps a fourteen-animal tower from
   * spilling into the other player's half.
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
    const scroll = scrollOf(yardOf(this.#match, seat));
    let bottom = low - scroll;
    let top = high - scroll;
    if (top <= 0 || bottom >= VIEW_HEIGHT) return;
    if (bottom < 0) bottom = 0;
    if (top > VIEW_HEIGHT) top = VIEW_HEIGHT;
    this.#fixed(renderer, seat, across, width, bottom, top, colour);
  }

  /** A band pinned to the seat's own edge — the plinth and everything drawn on it. */
  #fixed(
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

  /* ---------------------------------------------------------------- *
   * The yard
   * ---------------------------------------------------------------- */

  #drawYard(renderer: Renderer, seat: SeatId): void {
    const shade = seat === 'p1' ? COLOUR_HALF_NEAR : COLOUR_HALF_FAR;
    const top = seat === 'p1' ? FIELD_HEIGHT - YARD_HEIGHT : 0;
    renderer.rect(0, top, FIELD_WIDTH, YARD_HEIGHT, shade);
    // The crane rail, so the animal reads as hanging from something.
    const railY = worldYOf(seat, RAIL_HEIGHT);
    renderer.line(40, railY, FIELD_WIDTH - 40, railY, 3, COLOUR_FAINT);
  }

  /** The strip between the two yards, which belongs to neither player. */
  #drawGutter(renderer: Renderer): void {
    const top = YARD_HEIGHT;
    renderer.rect(0, top, FIELD_WIDTH, GUTTER, COLOUR_GUTTER);
    renderer.line(0, top, FIELD_WIDTH, top, 2, COLOUR_GUTTER_EDGE);
    renderer.line(0, top + GUTTER, FIELD_WIDTH, top + GUTTER, 2, COLOUR_GUTTER_EDGE);
    // Posts spaced inward from both ends, so the strip is symmetric under the half turn that
    // separates the two seats: filling it from one end would have one player reading it one
    // way and the other the other.
    for (let i = 0; i < 9; i += 1) {
      const x = 36 + i * ((FIELD_WIDTH - 72) / 8);
      renderer.rect(x - 3, top + 8, 6, GUTTER - 16, COLOUR_GUTTER_EDGE);
    }
  }

  /**
   * The platform, its edges, and the cut where the tower leaves the window.
   *
   * Pinned rather than scrolled: the base join is the one that takes the whole tower with it
   * when it goes, so a player must be able to see where the platform ends however tall their
   * tower has got.
   */
  #drawPlinth(renderer: Renderer, seat: SeatId): void {
    const yard = yardOf(this.#match, seat);
    const palette = SEAT_PALETTE[seat];
    this.#fixed(renderer, seat, 0, PLATFORM_HALF * 2, -PLINTH_HEIGHT + 14, 0, COLOUR_PLINTH);
    this.#fixed(
      renderer,
      seat,
      0,
      PLATFORM_HALF * 2 + 26,
      -PLINTH_HEIGHT,
      -PLINTH_HEIGHT + 14,
      COLOUR_PLINTH_DEEP,
    );
    // The two edges an animal can go over, in this seat's own colour and marked by shape:
    // p1's posts are plain, p2's are notched (rule 7).
    for (let side = -1; side <= 1; side += 2) {
      this.#fixed(renderer, seat, side * PLATFORM_HALF, 6, -10, 4, palette.base);
      if (seat === 'p2') this.#fixed(renderer, seat, side * PLATFORM_HALF, 6, -4, -1, COLOUR_INK);
    }
    if (scrollOf(yard) <= 0) return;
    // A broken line where the tower runs out of window, so nobody reads the bottom of the
    // drawing as the bottom of the tower.
    for (let i = -4; i <= 4; i += 1) {
      this.#fixed(renderer, seat, i * 34, 22, 2, 6, COLOUR_FAINT);
    }
  }

  /* ---------------------------------------------------------------- *
   * The tower
   * ---------------------------------------------------------------- */

  #drawTower(renderer: Renderer, seat: SeatId): void {
    const yard = yardOf(this.#match, seat);
    const tight = tightestJointOf(yard);
    for (let k = 0; k < yard.count; k += 1) {
      const placed = placedAt(yard, k);
      const species = speciesAt(placed.species);
      this.#drawAnimal(
        renderer,
        seat,
        placed.across,
        placed.base,
        placed.species,
        placed.facing,
        false,
      );
      // The back this animal offers, marked so "where can the next one stand" is visible.
      const back = backCentreOf(placed);
      this.#slab(
        renderer,
        seat,
        back,
        species.topHalf * 2,
        placed.base + species.bodyHeight - 3,
        placed.base + species.bodyHeight,
        COLOUR_CHALK,
      );
      if (k !== tight) continue;
      // The join with the least slack, marked with a chevron: it is where this tower will
      // break, and it is not always the one that looks worst.
      for (let side = -1; side <= 1; side += 2) {
        this.#slab(renderer, seat, side * 20, 14, placed.base - 2, placed.base + 2, COLOUR_ALARM);
      }
    }
    this.#drawFlash(renderer, seat);
  }

  /**
   * The strip the next animal has to land on, and where the held animal's feet would fall.
   *
   * Two bars at the same height: the support, solid, and the footprint, in this seat's colour
   * with a tick at each end. Where they overlap is the contact the statics are decided on, so
   * a player can see the same thing the rules compute without being told the answer.
   */
  #drawSupport(renderer: Renderer, seat: SeatId): void {
    const yard = yardOf(this.#match, seat);
    if (yard.stance !== 'carrying' && yard.stance !== 'dropping') return;
    const palette = SEAT_PALETTE[seat];
    const lo = supportLoAt(yard, yard.count);
    const hi = supportHiAt(yard, yard.count);
    this.#slab(renderer, seat, (lo + hi) / 2, hi - lo, yard.top + 2, yard.top + 7, COLOUR_CHALK);

    const species = speciesAt(yard.held.species);
    const across = yard.held.across;
    this.#slab(
      renderer,
      seat,
      across,
      species.baseHalf * 2,
      yard.top + 9,
      yard.top + 13,
      palette.base,
    );
    for (let side = -1; side <= 1; side += 2) {
      this.#slab(
        renderer,
        seat,
        across + side * species.baseHalf,
        4,
        yard.top + 9,
        yard.top + 20,
        palette.deep,
      );
    }
  }

  /** The animal on the crane: its line up to the rail, and how long the crane will hold it. */
  #drawHeld(renderer: Renderer, seat: SeatId): void {
    const yard = yardOf(this.#match, seat);
    if (yard.stance !== 'carrying' && yard.stance !== 'dropping') return;
    const held = yard.held;
    const base = heldBaseOf(yard);
    const species = speciesAt(held.species);

    if (yard.stance === 'carrying') {
      const scroll = scrollOf(yard);
      const x = worldXOf(seat, held.across);
      const topY = worldYOf(seat, RAIL_HEIGHT);
      const lowY = worldYOf(seat, Math.min(VIEW_HEIGHT, base + species.bodyHeight - scroll));
      renderer.line(x, topY, x, lowY, 2, COLOUR_CHALK);
      // How much of the crane's patience is left, as a bar that shortens from both ends —
      // symmetric, so it reads the same way up for either seat.
      const left = 1 - yard.carry / yard.limit;
      const width = 64 * (left > 0 ? left : 0);
      this.#slab(
        renderer,
        seat,
        held.across,
        width,
        base + species.bodyHeight + 8,
        base + species.bodyHeight + 13,
        left < 0.3 ? COLOUR_ALARM : COLOUR_CHALK,
      );
    }

    this.#drawAnimal(renderer, seat, held.across, base, held.species, held.facing, true);
  }

  /**
   * One animal.
   *
   * Rule 7, twice over. **Species** are told apart by silhouette — a tortoise is wide and low,
   * a flamingo narrow and tall — and by a row of pips along the body, one more than the last,
   * so the six read apart in greyscale. **Seats** are told apart by colour and by pattern:
   * p1's animals are plain and p2's are barred across.
   */
  #drawAnimal(
    renderer: Renderer,
    seat: SeatId,
    across: number,
    base: number,
    index: number,
    facing: number,
    held: boolean,
  ): void {
    const species = speciesAt(index);
    const palette = SEAT_PALETTE[seat];
    const legTop = base + species.bodyHeight * 0.32;
    const bodyTop = base + species.bodyHeight * 0.86;
    const hide = held ? COLOUR_HIDE : palette.tint;

    // Legs, at the outside of the feet, so the footprint the rules use is the footprint drawn.
    for (let side = -1; side <= 1; side += 2) {
      this.#slab(
        renderer,
        seat,
        across + side * species.baseHalf * 0.72,
        7,
        base,
        legTop,
        COLOUR_HIDE_DEEP,
      );
    }
    this.#slab(renderer, seat, across, species.baseHalf * 2, base, base + 3, palette.deep);
    this.#slab(renderer, seat, across, species.baseHalf * 1.86, legTop, bodyTop, hide);
    // The back: a flat slab offset from the feet, which is the whole reason a turn matters.
    const back = across + facing * species.topOffset;
    this.#slab(renderer, seat, back, species.topHalf * 2, bodyTop, base + species.bodyHeight, hide);

    // The head, out over whichever way the animal is facing.
    const headX = back + facing * (species.topHalf + 6);
    const headY = base + species.bodyHeight - 5;
    this.#slab(renderer, seat, headX, 15, headY - 9, headY + 5, hide);
    this.#slab(renderer, seat, headX + facing * 6, 5, headY - 5, headY - 1, COLOUR_INK);

    // Pips: one more than the species index, so the six are counted rather than compared.
    for (let pip = 0; pip <= index; pip += 1) {
      const spread = species.baseHalf * 1.3;
      const at = index === 0 ? 0 : -spread / 2 + (spread / index) * pip;
      this.#slab(renderer, seat, across + at, 5, legTop + 5, legTop + 10, COLOUR_INK);
    }
    if (seat !== 'p2') return;
    for (let bar = -1; bar <= 1; bar += 2) {
      this.#slab(
        renderer,
        seat,
        across + bar * species.baseHalf * 0.62,
        4,
        legTop,
        bodyTop,
        COLOUR_INK,
      );
    }
  }

  /** A moment of feedback on the last animal. Shape carries it, not only colour. */
  #drawFlash(renderer: Renderer, seat: SeatId): void {
    const yard = yardOf(this.#match, seat);
    if (yard.last === 'none' || yard.since > FLASH_SECONDS) return;
    const lift = (yard.since / FLASH_SECONDS) * 40;
    const height = yard.top + 16 + lift;
    if (yard.last === 'stacked') {
      this.#slab(renderer, seat, 0, 46, height, height + 6, COLOUR_GOLD);
      return;
    }
    // A broken cross for a tower that went, drawn wherever the break was.
    for (let side = -1; side <= 1; side += 2) {
      this.#slab(renderer, seat, side * 16, 28, height, height + 6, COLOUR_ALARM);
    }
  }

  /**
   * The balance bar: which join is closest to going, and how close.
   *
   * Drawn on the plinth in platform-local units, which is the same coordinate the tower is
   * drawn in — so the marks under the platform line up with the animals above it. The wide
   * band is the contact that join is standing on, and the needle is where the weight above
   * it falls. When the needle reaches the end of the band, that join gives way.
   */
  #drawBalance(renderer: Renderer, seat: SeatId): void {
    const yard = yardOf(this.#match, seat);
    const palette = SEAT_PALETTE[seat];
    const low = -PLINTH_HEIGHT + 22;
    // The platform's own edges, always, so an empty platform still says how wide it is.
    this.#fixed(renderer, seat, 0, PLATFORM_HALF * 2, low, low + 3, COLOUR_FAINT);
    if (yard.count <= 0) return;

    const joint = tightestJointOf(yard);
    const lo = Math.max(
      supportLoAt(yard, joint),
      placedAt(yard, joint).across - speciesAt(placedAt(yard, joint).species).baseHalf,
    );
    const hi = Math.min(
      supportHiAt(yard, joint),
      placedAt(yard, joint).across + speciesAt(placedAt(yard, joint).species).baseHalf,
    );
    if (hi > lo) this.#fixed(renderer, seat, (lo + hi) / 2, hi - lo, low, low + 7, COLOUR_CHALK);

    const weight = weightAboveOf(yard, joint);
    const margin = towerMargin(yard);
    const colour = margin < 8 ? COLOUR_ALARM : palette.base;
    this.#fixed(renderer, seat, weight, 5, low - 8, low + 14, colour);
    // A shape as well as a colour: the needle grows a foot when the join is comfortable and
    // loses it when it is not, so the warning survives greyscale.
    if (margin >= 8) this.#fixed(renderer, seat, weight, 17, low - 8, low - 4, colour);
  }

  /**
   * How many animals this seat has left, as a row of ticks along its own edge.
   *
   * The shell's HUD prints both scores; what it cannot show is how much of the match is left,
   * and in this game that is not a clock — it is a count, and the two seats can be on
   * different counts because each spends its own.
   */
  #drawTicks(renderer: Renderer, seat: SeatId): void {
    const yard = yardOf(this.#match, seat);
    const palette = SEAT_PALETTE[seat];
    const reach = 250;
    const spacing = (reach * 2) / MAX_ANIMALS;
    for (let i = 0; i < MAX_ANIMALS; i += 1) {
      const across = -reach + spacing * (i + 0.5);
      const left = i >= yard.dealt;
      this.#fixed(
        renderer,
        seat,
        across,
        spacing - 8,
        -PLINTH_HEIGHT + 4,
        -PLINTH_HEIGHT + 12,
        left ? palette.base : COLOUR_FAINT,
      );
      if (seat === 'p2' && left) {
        this.#fixed(
          renderer,
          seat,
          across,
          spacing - 8,
          -PLINTH_HEIGHT + 6,
          -PLINTH_HEIGHT + 9,
          COLOUR_INK,
        );
      }
    }
  }
}
