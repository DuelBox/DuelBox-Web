import { SEAT_PALETTE, envelopeFor } from '@duelbox/engine';
import type { Rng, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  CARRY_GAP,
  FALL_SECONDS,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  GUTTER,
  KINDS,
  PLINTH_DEPTH,
  PLINTH_HALF,
  SLOT_LIMIT,
  SLOT_PITCH,
  YARD_HEIGHT,
  botIntent,
  clearIntent,
  createBotState,
  createIntent,
  createMatch,
  driftAt,
  landingSlackFor,
  marginAt,
  resetBotState,
  resetMatch,
  slotOfX,
  step,
  supportCentreAt,
  supportHalfAt,
  weightAt,
  winnerOf,
  worldXOf,
  worldYOf,
  xOfWorld,
  yardOf,
} from './rules.js';
import type { BotDifficulty, BotState, Intent, Match, Yard } from './rules.js';

/**
 * Wobble Stack — a plinth each, a rail of fifteen notches each, and one leaning tower each.
 *
 * `rules.ts` holds the whole simulation, in plinth-local units. What lives here is how a
 * finger or a key becomes an intent, and how one set of plinth-local numbers is drawn
 * twice, a half turn apart.
 *
 * **What is drawn is what the bot reads** (CLAUDE.md rule 6). The bot reads the tower, the
 * notch rail, the strip the next brainrot has to land on, the footprint it would land
 * with, how far the tower is leaning, and how much plinth its weight has left. Every one
 * of those is on the screen: the support strip and the footprint are drawn at the same
 * height so the overlap is visible, the lean is the tower's own slant, and the plinth
 * carries a balance bar showing where the weight falls and where the edges are.
 *
 * What is **not** drawn is the verdict. Whether a given notch would stand is arithmetic
 * over drawn quantities, and it is deliberately left as arithmetic: a game that printed
 * "this drop topples" would have no decision left in it.
 */

const COLOUR_SKY = '#0d1117';
/** Two shades of half, far enough apart to read as two surfaces in a monochrome capture. */
const COLOUR_HALF_NEAR = '#1e2c36';
const COLOUR_HALF_FAR = '#0a141b';
const COLOUR_GUTTER = '#05090d';
const COLOUR_PLINTH = '#78838d';
const COLOUR_PLINTH_DEEP = '#48525a';
const COLOUR_INK = '#05090d';
const COLOUR_CHALK = 'rgba(233, 240, 246, 0.55)';
const COLOUR_FAINT = 'rgba(233, 240, 246, 0.15)';
const COLOUR_TRACK = 'rgba(233, 240, 246, 0.22)';
const COLOUR_EDGE = '#f0c96a';
const COLOUR_ALARM = '#ff8a5c';

/** How much of a seat's half the tower is drawn in, above the plinth's top surface. */
const VIEW_HEIGHT = YARD_HEIGHT - PLINTH_DEPTH - 24;
/** The tallest brainrot there is, so the window leaves room for one on the rail. */
const TALLEST = 46;
/** How tall the balance bar on the plinth is. */
const BAR_HEIGHT = 12;

const SEATS: readonly SeatId[] = ['p1', 'p2'];

/**
 * How far the tower has risen out of the window.
 *
 * The same rule for both seats and derived from that seat's own tower alone, so neither
 * player ever sees more of their own yard than the other sees of theirs (CLAUDE.md rule
 * 9). Pure, and called from the renderer only: the simulation has no idea a window exists.
 */
function scrollOf(yard: Readonly<Yard>): number {
  const wanted = yard.top + CARRY_GAP + TALLEST + 10 - VIEW_HEIGHT;
  return wanted > 0 ? wanted : 0;
}

/** How far a falling brainrot has dropped. Drawn only; the landing is judged by the clock. */
function heldBaseOf(yard: Readonly<Yard>): number {
  if (yard.stance !== 'falling') return yard.top + CARRY_GAP;
  const gone = 1 - yard.fall / FALL_SECONDS;
  return yard.top + CARRY_GAP * (1 - gone * gone);
}

/** One seat's gesture, as the two facts a tap is defined by. */
interface Grip {
  down: boolean;
  /** Where the finger went down, or null when the press came from a key. */
  hasOrigin: boolean;
  originX: number;
  originY: number;
  /** True once the finger has left the tap radius, which makes this a drag and not a tap. */
  strayed: boolean;
}

function createGrip(): Grip {
  return { down: false, hasOrigin: false, originX: 0, originY: 0, strayed: false };
}

function resetGrip(grip: Grip): void {
  grip.down = false;
  grip.hasOrigin = false;
  grip.originX = 0;
  grip.originY = 0;
  grip.strayed = false;
}

export class WobbleStackGame implements Game {
  readonly #match: Match = createMatch();
  readonly #bots: Record<SeatId, BotState> = { p1: createBotState(), p2: createBotState() };
  readonly #grips: Record<SeatId, Grip> = { p1: createGrip(), p2: createGrip() };
  readonly #intents: Record<SeatId, Intent> = { p1: createIntent(), p2: createIntent() };

  #rng: Rng | null = null;
  #difficulty: Record<SeatId, BotDifficulty | null> = { p1: null, p2: null };
  #winner: SeatId | 'draw' | null = null;
  /** Two envelopes, which is what `docs/input-idiom.md` defines a tap by. */
  #tapRadius = 6;

  get match(): Match {
    return this.#match;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#difficulty = { p1: context.botDifficulty('p1'), p2: context.botDifficulty('p2') };
    this.#winner = null;
    this.#tapRadius = 2 * envelopeFor(context.manifest.logical);
    for (const seat of SEATS) {
      resetBotState(this.#bots[seat]);
      resetGrip(this.#grips[seat]);
      clearIntent(this.#intents[seat]);
    }
    resetMatch(this.#match);
    // `openingSeat` is deliberately not read. This is a real-time game: both rails are
    // live from the first step and there is no opener for the shell to alternate.
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
   * The two families arrive already folded together by the engine — `actionHeld` is this
   * seat's action key *or* a pointer down in this seat's own zone — so the gesture is
   * spelled once and both instruments say it. A **drag** steers: a finger names the notch
   * nearest it and the carrier walks there, a key names a direction and the carrier walks
   * that way, both through the same one-notch-per-`SLOT_SECONDS` limit. A **tap** drops:
   * a press whose pointer never left the tap radius, which a key satisfies trivially
   * because a key has no pointer to move.
   *
   * There is no hold threshold anywhere in this, deliberately. A duration threshold is a
   * number the two seats reach by accumulating steps from opposite ends of a match, and
   * two games in this repository have shipped one sitting on a knife edge.
   */
  #read(seat: SeatId, input: InputState, fixedDeltaSeconds: number, rng: Rng): void {
    const intent = this.#intents[seat];
    const difficulty = this.#difficulty[seat];
    if (difficulty !== null) {
      botIntent(
        yardOf(this.#match, seat),
        difficulty,
        this.#bots[seat],
        fixedDeltaSeconds,
        rng,
        intent,
      );
      return;
    }

    clearIntent(intent);
    const seatInput = input.seat(seat);
    const grip = this.#grips[seat];
    const pointer = seatInput.pointer;

    if (seatInput.actionPressed) {
      grip.down = true;
      grip.strayed = false;
      grip.hasOrigin = pointer !== null;
      grip.originX = pointer?.x ?? 0;
      grip.originY = pointer?.y ?? 0;
    }
    if (grip.down && grip.hasOrigin && pointer !== null) {
      const dx = pointer.x - grip.originX;
      const dy = pointer.y - grip.originY;
      if (dx * dx + dy * dy > this.#tapRadius * this.#tapRadius) grip.strayed = true;
    }
    if (seatInput.actionReleased) {
      if (grip.down && !grip.strayed) intent.drop = true;
      resetGrip(grip);
    }

    intent.nudge = seatInput.move.x;
    if (pointer !== null) {
      // The far player reads the device upside down, so their own left is the device's
      // right. That half turn lives in `xOfWorld` and nowhere else, and the game never
      // asks which half of the glass a finger is on — the engine already decided that,
      // on the zone the finger went down in.
      intent.aimActive = true;
      intent.aimSlot = slotOfX(xOfWorld(seat, pointer.x));
    }
  }

  getScore(): MatchScore {
    return { p1: this.#match.p1.count, p2: this.#match.p2.count, winner: this.#winner };
  }

  onPause(): void {}

  onResume(): void {
    // A press that began before the pause has no release to look forward to: the host
    // clears the input manager on a pause, so the key-up never arrives. Dropping the grip
    // means a resume cannot deliver a drop nobody asked for.
    for (const seat of SEATS) resetGrip(this.#grips[seat]);
  }

  destroy(): void {
    resetMatch(this.#match);
    for (const seat of SEATS) {
      resetBotState(this.#bots[seat]);
      resetGrip(this.#grips[seat]);
      clearIntent(this.#intents[seat]);
    }
    this.#winner = null;
    this.#rng = null;
  }

  /* ---------------------------------------------------------------- *
   * Drawing
   * ---------------------------------------------------------------- */

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. Nothing here interpolates.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_SKY);
    renderer.rect(0, YARD_HEIGHT, FIELD_WIDTH, GUTTER, COLOUR_GUTTER);
    for (const seat of SEATS) {
      this.#drawYard(renderer, seat);
      this.#drawRail(renderer, seat);
      this.#drawTower(renderer, seat);
      this.#drawSupport(renderer, seat);
      this.#drawHeld(renderer, seat);
      this.#drawPlinth(renderer, seat);
      this.#drawBalance(renderer, seat);
    }
  }

  /** A band pinned to the seat's own edge: the plinth and everything drawn on it. */
  #fixed(
    renderer: Renderer,
    seat: SeatId,
    centre: number,
    width: number,
    low: number,
    high: number,
    colour: string,
  ): void {
    const x = worldXOf(seat, centre);
    const a = worldYOf(seat, low);
    const b = worldYOf(seat, high);
    renderer.rect(x - width / 2, a < b ? a : b, width, Math.abs(b - a), colour);
  }

  /** A band of the tower, clipped to this seat's own window. */
  #slab(
    renderer: Renderer,
    seat: SeatId,
    centre: number,
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
    this.#fixed(renderer, seat, centre, width, bottom, top, colour);
  }

  #drawYard(renderer: Renderer, seat: SeatId): void {
    const shade = seat === 'p1' ? COLOUR_HALF_NEAR : COLOUR_HALF_FAR;
    const top = seat === 'p1' ? FIELD_HEIGHT - YARD_HEIGHT : 0;
    renderer.rect(0, top, FIELD_WIDTH, YARD_HEIGHT, shade);
  }

  /** The fifteen notches, and which one the carrier is on. */
  #drawRail(renderer: Renderer, seat: SeatId): void {
    const yard = yardOf(this.#match, seat);
    const height = heldBaseOf(yard) + TALLEST + 8 - scrollOf(yard);
    if (height <= 0 || height >= VIEW_HEIGHT) return;
    for (let slot = -SLOT_LIMIT; slot <= SLOT_LIMIT; slot += 1) {
      const on = slot === yard.slot && yard.stance === 'hover';
      this.#fixed(
        renderer,
        seat,
        slot * SLOT_PITCH,
        on ? 6 : 2,
        height,
        height + (on ? 10 : 5),
        on ? COLOUR_CHALK : COLOUR_FAINT,
      );
    }
  }

  /**
   * The tower, leaning.
   *
   * Every brainrot is carried sideways in proportion to how high it is, which is exactly
   * what {@link driftAt} tells the simulation, so the slant a player reads is the slant
   * the rules use. Player one's brainrots carry a round stud and player two's a barred
   * frame — a different primitive, not a different colour (CLAUDE.md rule 7).
   */
  #drawTower(renderer: Renderer, seat: SeatId): void {
    const yard = yardOf(this.#match, seat);
    if (yard.out && yard.loss === 'toppled') return;
    const palette = SEAT_PALETTE[seat];
    for (let i = 0; i < yard.count; i += 1) {
      const piece = yard.pieces[i];
      if (piece === undefined) continue;
      const kind = KINDS[piece.kind];
      if (kind === undefined) continue;
      const middle = piece.base + kind.tall / 2;
      const centre = piece.x + driftAt(yard, middle);
      this.#slab(
        renderer,
        seat,
        centre,
        kind.half * 2,
        piece.base,
        piece.base + kind.tall,
        palette.base,
      );
      this.#mark(renderer, seat, centre, middle, kind.half, kind.tall);
    }
  }

  /**
   * The per-seat glyph, and the only place either seat's `deep` colour is used.
   *
   * Seat one gets a filled circle and seat two a stroked frame: two different primitives
   * at two fixed sizes, so the difference survives a greyscale screenshot and survives a
   * harness that has thrown position away.
   */
  #mark(
    renderer: Renderer,
    seat: SeatId,
    centre: number,
    middle: number,
    half: number,
    tall: number,
  ): void {
    const scroll = scrollOf(yardOf(this.#match, seat));
    const height = middle - scroll;
    if (height <= 6 || height >= VIEW_HEIGHT - 6) return;
    const palette = SEAT_PALETTE[seat];
    const x = worldXOf(seat, centre);
    const y = worldYOf(seat, height);
    if (seat === 'p1') {
      renderer.circle(x, y, 5, palette.deep);
      return;
    }
    const width = half * 2 - 8;
    const barHeight = tall - 8;
    if (width <= 0 || barHeight <= 0) return;
    renderer.strokeRect(x - width / 2, y - barHeight / 2, width, barHeight, 3, palette.deep);
  }

  /**
   * The strip the next brainrot must land on, and the footprint it would land with.
   *
   * Drawn at the same height so the overlap is a thing a player can see rather than a
   * thing a player must compute. This is the bot's whole information advantage made
   * visible: it does the intersection faster, not with numbers nobody else has.
   */
  #drawSupport(renderer: Renderer, seat: SeatId): void {
    const yard = yardOf(this.#match, seat);
    if (yard.stance !== 'hover' && yard.stance !== 'falling') return;
    const index = yard.count;
    const kindIndex = yard.pieces[index]?.kind ?? 0;
    const kind = KINDS[kindIndex];
    if (kind === undefined) return;
    const supportHalf = supportHalfAt(yard, index);
    const supportCentre = supportCentreAt(yard, index) + driftAt(yard, yard.top);
    this.#slab(
      renderer,
      seat,
      supportCentre,
      supportHalf * 2,
      yard.top + 1,
      yard.top + 5,
      COLOUR_CHALK,
    );
    const landing = yard.slot * SLOT_PITCH + yard.swing.value;
    const slack = landingSlackFor(kindIndex, supportHalf);
    const safe = Math.abs(landing - supportCentre) <= slack;
    this.#slab(
      renderer,
      seat,
      landing,
      kind.half * 2,
      yard.top + 5,
      yard.top + 9,
      safe ? COLOUR_EDGE : COLOUR_ALARM,
    );
  }

  /** The brainrot on the rail, or on its way down. */
  #drawHeld(renderer: Renderer, seat: SeatId): void {
    const yard = yardOf(this.#match, seat);
    if (yard.stance !== 'hover' && yard.stance !== 'falling') return;
    const index = yard.count;
    const kindIndex = yard.pieces[index]?.kind ?? 0;
    const kind = KINDS[kindIndex];
    if (kind === undefined) return;
    const base = heldBaseOf(yard);
    const centre = yard.stance === 'hover' ? yard.slot * SLOT_PITCH + yard.swing.value : yard.dropX;
    this.#slab(
      renderer,
      seat,
      centre,
      kind.half * 2,
      base,
      base + kind.tall,
      SEAT_PALETTE[seat].base,
    );
    this.#mark(renderer, seat, centre, base + kind.tall / 2, kind.half, kind.tall);
  }

  /** The plinth: player one's posts are solid, player two's are notched. */
  #drawPlinth(renderer: Renderer, seat: SeatId): void {
    this.#fixed(renderer, seat, 0, PLINTH_HALF * 2, -12, 0, COLOUR_PLINTH);
    this.#fixed(renderer, seat, 0, PLINTH_HALF * 2, -16, -12, COLOUR_PLINTH_DEEP);
    for (const side of [-1, 1]) {
      const centre = side * (PLINTH_HALF - 12);
      if (seat === 'p1') {
        this.#fixed(renderer, seat, centre, 14, -PLINTH_DEPTH, -16, COLOUR_PLINTH_DEEP);
      } else {
        this.#fixed(renderer, seat, centre, 14, -PLINTH_DEPTH, -40, COLOUR_PLINTH_DEEP);
        this.#fixed(renderer, seat, centre, 14, -34, -16, COLOUR_PLINTH_DEEP);
      }
    }
  }

  /**
   * The balance bar: where the tower's weight falls across the plinth, and where the
   * edges are.
   *
   * The needle is the one number the tie-break is settled on, so it is a number both
   * players watched all match rather than a hidden second scoreboard.
   */
  #drawBalance(renderer: Renderer, seat: SeatId): void {
    const yard = yardOf(this.#match, seat);
    const low = -PLINTH_DEPTH + 8;
    this.#fixed(renderer, seat, 0, PLINTH_HALF * 2 - 8, low, low + BAR_HEIGHT, COLOUR_TRACK);
    if (yard.count === 0) return;
    const weight = weightAt(yard, yard.lean.value);
    const clamped =
      weight > PLINTH_HALF ? PLINTH_HALF : weight < -PLINTH_HALF ? -PLINTH_HALF : weight;
    const margin = marginAt(yard, yard.lean.value);
    this.#fixed(
      renderer,
      seat,
      clamped,
      8,
      low - 2,
      low + BAR_HEIGHT + 2,
      margin > 18 ? SEAT_PALETTE[seat].base : COLOUR_ALARM,
    );
    // The worst it has ever been, which is what a level match is settled on.
    const worst = yard.worst;
    if (worst < PLINTH_HALF) {
      const at = PLINTH_HALF - worst;
      for (const side of [-1, 1]) {
        this.#fixed(
          renderer,
          seat,
          side * at,
          2,
          low + BAR_HEIGHT,
          low + BAR_HEIGHT + 5,
          COLOUR_INK,
        );
      }
    }
  }
}
