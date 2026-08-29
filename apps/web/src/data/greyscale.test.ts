import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, GameManifest, Renderer } from '@duelbox/game-sdk';
import { LOADERS_FOR_TEST } from './registry';
import type { LoadedGame } from './registry';

/**
 * Rule 7, checked rather than asserted in prose.
 *
 * "Colour is never the only signal. Every player-owned element also differs by shape,
 * pattern, or label." The definition of done says every game must be playable in
 * greyscale, seventy-nine open QA issues carry that line, and until this file nothing in
 * the repository executed it — an audit found only 37 of 107 game packages so much as
 * mention rule 7 in `src/`.
 *
 * It matters more here than the rule's placement in the list suggests, because
 * `packages/engine/src/palette-vision.test.ts` *measures* the two seat colours under
 * dichromacy and records that they sit at 1.03:1 under deuteranopia — indistinguishable.
 * Closing that gap is a palette decision parked on #2322. Until it is closed, shape is
 * not a nicety layered over colour: for those players it is the only signal there is.
 *
 * ## How the check works
 *
 * The renderer is the seam. Games draw through {@link Renderer} and never touch a canvas
 * context, so a recording renderer sees every mark a game makes — the same trick
 * `cross-viewport.test.ts` and `bot-parity.test.ts` already use. Each game is loaded from
 * its **source**, played through three seeded matches, and every draw call is captured.
 *
 * A mark belongs to a seat when its colour is *exactly* one of that seat's four
 * `SEAT_PALETTE` strings. A neutral mark — an ink pip, a wire outline, a label — is
 * attributed to a seat when it sits inside exactly one seat-coloured mark and is no
 * larger than it, because an ornament sits on top of the thing it marks. That step is
 * load-bearing, and measured rather than assumed: delete it and Sumo, Rock Paper Scissors
 * and Chicken Jump are falsely accused, because the shape that tells their seats apart —
 * a pip, a comb, a notch — is drawn in ink rather than in the seat's own colour.
 *
 * Each mark becomes a *glyph*: its primitive kind, the literal string if it is a label,
 * and a coarse size class. **Position is deliberately not part of a glyph.** Rule 7 names
 * shape, pattern and label — not "and they are in different places" — and on a shared
 * screen the whole point is that the two seats' material is mixed together. The price of
 * that decision is real, and it is paid by {@link SHAPE_THE_HARNESS_CANNOT_SEE}.
 *
 * Two seats are told apart by evidence in the order rule 7 names it:
 *
 * - **a primitive or a label one seat draws and the other never does** — a square mole
 *   against a round one, `P1 hull` against `P2 hull`;
 * - **a fixed multiplicity** — Spin War's tops carry three blades against five, every
 *   frame of every match;
 * - **a size**, and only when one seat holds it steadily, the other never draws that
 *   primitive near it, and the two are far enough apart to see.
 *
 * A count that either seat varies is not evidence: Dots and Boxes owning four squares to
 * three is the score, and tells you nothing about whose square is whose. A game fails
 * when nothing in that list separates the seats, because then the colour argument is the
 * only thing that differs between one seat's elements and the other's.
 *
 * ## Four ways this used to be talked around
 *
 * An adversarial review of the first version found four bypasses, all now closed, each
 * with a test of its own under "the harness itself" below.
 *
 * 1. **A mark that paints nothing used to count.** `renderer.line(0, 0, 0, 0, 0, seat)`
 *    draws nothing at all, and it was a one-line rule 7 exemption for any game, because
 *    the glyph existed in one seat's signature and not the other's. A mark is now dropped
 *    as it is recorded unless every measurement it carries is positive and its bounding
 *    box covers at least {@link MIN_INK_FRACTION} of the play area.
 * 2. **Sizes were quantised far too finely to be evidence.** They bucketed at a 160th of
 *    the shorter side — 0.28% of the board — so two discs whose radii differed by one
 *    device pixel counted as different shapes. Buckets are now logarithmic,
 *    {@link SIZE_STEPS_PER_DOUBLING} to the doubling, and neighbouring buckets count as
 *    the same size ({@link SIZE_SLACK}), so a pure size difference is never evidence
 *    below 1.19× and always evidence above 1.41×. Rule 7 says shape, pattern or label; a
 *    tenth of a radius is none of the three.
 * 3. **A size that tracked the score read as a discriminator.** A varying *count* has
 *    always collapsed to `*`; a varying *size* used to mint a fresh glyph per value. A
 *    size now has to hold across {@link SIZE_CONSTANCY} of the frames in which its
 *    primitive is drawn at all, and a mark whose size does not hold is dropped — the
 *    primitive it belongs to still counts, its size no longer does. This is a partial
 *    fix and is marked as one: it closes sizes that *move*, and not the harder case of a
 *    size that sits still because one seat is winning, which is recorded as an open hole
 *    below and is what Chicken Jump still passes on.
 * 4. **The harness read `dist`.** It loaded games through the registry, whose imports
 *    resolve to each package's build, so a rule 7 violation written into `src` came back
 *    green under `pnpm test` alone; CI caught it only because `pnpm typecheck` happens to
 *    run first and rebuilds. Games are now imported straight from
 *    `packages/games/<id>/src/index.ts` — see {@link SOURCE_MODULES}.
 *
 * ## What this can and cannot prove
 *
 * It can prove that two seats are drawn from different primitives, or from the same
 * primitives with different labels, different fixed multiplicities, or sizes half again
 * as large. It cannot prove a human can tell them apart at a glance, and it cannot see
 * *arrangement* — two ink strokes meeting in a chevron and two ink strokes lying parallel
 * are the same two strokes to this file. Legibility is a QA judgement and stays one. What
 * this closes is the hole where a game ships with two identical shapes and two colours,
 * which is the failure the rule was written about.
 *
 * Two holes are left open on purpose, each recorded by a test of its own under "the
 * harness itself", because a guard that lies about its reach is worse than one that names
 * it — the model is `palette-vision.test.ts`, which measures a contrast it cannot yet
 * meet and says so.
 *
 * - A seat whose size never holds still contributes no glyph, so the *other* seat's
 *   steady disc reads as a shape it lacks even when both are plain discs.
 * - A size that is stable but set by the score — Chicken Jump's tower blocks, each as
 *   wide as the pole was forgiving when it landed — makes the seat that is *ahead* look
 *   like the seat that is *marked*. Deleting all three of the blocks Chicken Jump labels
 *   "Rule 7" leaves it passing on that alone.
 *
 * Both need marks tracked as objects across frames rather than as size classes. Every
 * cheaper closure was tried and measured, and each falsely accuses games that get rule 7
 * right; the tests name which ones. A harness that invents faults costs more than one
 * with a hole somebody has written down.
 *
 * ## Every game lands in exactly one bucket
 *
 * Comparison is confined to frames in which **both** seats have material on screen. Where
 * that never happens the harness cannot judge the game, and an unjudged game used to pass
 * in silence — thirteen of eighty-seven did. It no longer does: an unjudged game must be
 * named in {@link TURN_BASED_SOLO} or {@link NOT_YET_DRIVEN} with a reason, and the
 * harness asserts *which of the two* rather than taking the entry's word for it. A
 * turn-based board that belongs wholly to whoever is to move shows each seat alone for a
 * long stretch; a game the gesture script never got moving shows one seat or neither.
 *
 * Every list here is printed on every run, capped as a share of the roster, and asserted
 * to still be true, so an entry cannot be carried after it stops being one.
 */

/** Fixed timestep. Every game in the repo simulates at this rate. */
const STEP = 1 / 60;

/** Long enough for a turn-based game to get several turns in and a board to fill. */
const STEPS_PER_MATCH = 1800;

/** Render every twelfth step: 150 sampled frames a match, at a fifth of the render cost. */
const SAMPLE_EVERY = 12;

/**
 * A mark whose bounding box covers less of the play area than this is ink nobody sees.
 *
 * A 600 × 900 board on a 360-point phone renders about 1.7 logical units to the device
 * pixel, so this floor — 1e-5 of the area, 5.4 square units there — is a mark of roughly
 * two device pixels on a side. Below it, and at zero, a draw call paints nothing that
 * could tell one seat's pieces from the other's, which is what made
 * `line(0, 0, 0, 0, 0, seatColour)` a free pass before this existed. Every measurement a
 * primitive carries must be positive too, so a zero radius, a zero line width and an
 * empty label are dropped whatever their bounding box says.
 *
 * Every game in the repository reaches the same verdict at 0, 1e-6, 1e-5 and 1e-4:
 * nothing real is anywhere near this floor, which is the point of choosing one.
 */
const MIN_INK_FRACTION = 1e-5;

/**
 * A mark covering more than this share of the play area is field, not a player-owned
 * element: the tint a turn-based board takes on for whoever is to move, a half-screen
 * territory wash. Counting those would let a game pass rule 7 by recolouring the
 * background, which is the opposite of the point.
 */
const MAX_AREA_FRACTION = 0.25;

/**
 * Sizes bucket logarithmically, this many buckets to every doubling, and two buckets
 * within {@link SIZE_SLACK} of each other are the same size.
 *
 * Together they say: a size difference under 1.19× is never evidence, and one over 1.41×
 * always is. That is the smallest difference this file is willing to call a shape, and it
 * replaces a linear grid so fine that a radius of 10 against a radius of 11 counted.
 * Sizes are also the *weakest* evidence here — a primitive or a label only one seat draws
 * is checked first, and does not depend on either number.
 */
const SIZE_STEPS_PER_DOUBLING = 4;
const SIZE_SLACK = 1;

/**
 * A glyph must appear in at least this share of the frames where both seats are on
 * screen before it may distinguish the seats. A shape that flickers past in a handful of
 * frames is not something a player can navigate by. 0.3 and 0.5 produce the identical
 * verdict for every game here.
 */
const STABILITY = 0.5;

/**
 * A mark's size counts as designed only if the seat draws that primitive at that size in
 * this share of the frames where it draws the primitive at all.
 *
 * Anything below is a number the simulation is moving — a bar that tracks the score, a
 * radius that tracks a charge — and the mark is dropped rather than allowed to mint a
 * glyph per value. The primitive it belongs to still counts; only its size stops
 * counting. Rule 7 asks for a shape, a pattern or a label, and a quantity drawn as a
 * length is a readout: both seats have one, and it says nothing about whose piece is
 * whose.
 */
const SIZE_CONSTANCY = 0.9;

/** Below this many both-seats-on-screen frames there is not enough evidence to judge. */
const MIN_SHARED_FRAMES = 10;

/**
 * How many frames a seat must hold the screen alone before that counts as taking a turn.
 *
 * This is the line between "turn-based, so the seats are never side by side" and "the
 * harness never got this game moving", and it is asserted rather than assumed. 450 frames
 * are sampled per game: the five turn-based games below give each seat between 67 and
 * 272, so nothing sits anywhere near this number.
 */
const MIN_SOLO_FRAMES = 20;

/**
 * Games whose two seats are, today, distinguished by colour and nothing else.
 *
 * Every one of these was read in its source and confirmed by hand — this is a record of
 * a real gap, not a list of harness quirks. They are exceptions so that `main` stays
 * green while the gap stays visible; the list is printed on every run, and a test below
 * fails if an entry stops failing, so fixing a game forces its removal from here.
 *
 * These belong on the open "Create original art" issue for each game, whose acceptance
 * criteria already say "Player-owned elements differ by shape or label as well as
 * colour".
 */
const COLOUR_ONLY_SEATS: ReadonlyMap<string, string> = new Map([
  [
    'dots-and-boxes',
    'A captured square is a plain rect in the owner’s soft tint and a claimed edge is a ' +
      'plain line in the owner’s base colour — identical geometry for both seats, on one ' +
      'shared board. Needs a fill pattern (hatching one way for one seat) or an initial ' +
      'in each captured square.',
  ],
  [
    'mancala',
    'Both stores are on screen the whole match and each is ringed with the same ' +
      'strokeCircle at the same radius and width, differing only in colour. Needs a ' +
      'second ring, a notch, or a label on one store.',
  ],
  [
    'math-quiz',
    'Both panels are on screen at once, and each seat’s only owned marks are two plain ' +
      'bars — the question timer and the underline beneath its own score — identical in ' +
      'size and shape. The tiles themselves are properly differentiated (carets and a ' +
      'tick, per its own comments); the two seat-coloured bars are not.',
  ],
  [
    'sea-battle',
    'During placement both fleets are laid out side by side, and each half is drawn with ' +
      'the identical strokeRect, the identical cell outlines and the identical “Ready” ' +
      'label — only the colour differs. Needs the two halves marked by a shape or an ' +
      'initial. (The firing board is fine: only the seat to move is ever drawn there.)',
  ],
]);

/**
 * Games whose seats do differ by shape, in a way this file cannot see.
 *
 * Not rule 7 failures and not work anybody owes — the entries record what the game draws
 * and which of this file's own blind spots hides it. Read by hand in the source like
 * every other list here, and asserted to still be indistinguishable *to this harness*, so
 * an entry cannot outlive the reason for it. If one of these games ever stops looking
 * identical, its test turns red and somebody has to come back and re-read it.
 */
const SHAPE_THE_HARNESS_CANNOT_SEE: ReadonlyMap<string, string> = new Map([
  [
    'traffic-jam',
    'Both cars carry two ink strokes six units wide: player one’s meet at a point as a ' +
      'chevron (27.5 long each), player two’s lie across the roof in parallel (34 long ' +
      'each). A player reads that instantly; to a file that has thrown position and angle ' +
      'away it is a difference of 1.24× in length, under the 1.41× needed before a size ' +
      'counts as a shape. Nothing to fix in the game.',
  ],
  [
    'taxi-race',
    'The near cab has one narrow roof lamp (18 wide) and a solid spine stripe, the far ' +
      'cab a wide lamp (34) and three chequered flank bars — #drawTaxi, and a real ' +
      'difference. Both lamps are drawn above the cab’s nose rather than on it, so the ' +
      'ornament rule cannot attribute them to a seat at all; the stripe and the bars are ' +
      'scaled by `swell` on every hop, so no size of them holds for the 0.9 of frames a ' +
      'size needs here. Nothing to fix in the game.',
  ],
]);

/**
 * Games where the two seats are never on screen together *by design*.
 *
 * The board belongs wholly to whoever is to move and recolours as the turn passes — each
 * of these paints in `SEAT_PALETTE[<the seat to move>]` and never in the other's — so
 * "which of these is mine" is not a question the player can ask: everything on screen is
 * theirs. Rule 7 still applies to these games and is still checked by hand at QA. What
 * cannot be done is checking it from draw calls, because no frame holds both seats'
 * material to compare.
 *
 * The harness does not take these entries on trust. Each is asserted to show both seats
 * holding the screen alone for {@link MIN_SOLO_FRAMES} frames or more, which is what
 * taking turns looks like from the outside, and to stop being listed the moment it can be
 * judged.
 */
const TURN_BASED_SOLO: ReadonlyMap<string, string> = new Map([
  [
    'darts',
    'Three darts, then the board passes. Everything drawn in a seat colour — the darts ' +
      'already thrown, the reticle, the turn’s running total — belongs to the seat ' +
      'throwing, and the board flips between turns. 234 frames with only p1, 216 with ' +
      'only p2, none with both.',
  ],
  [
    'hot-potato',
    'The potato has one holder at a time and is drawn in that holder’s colour, as is the ' +
      'band behind it; the other seat owns nothing on screen until it crosses. 194 ' +
      'frames with only p1, 256 with only p2, none with both.',
  ],
  [
    'pop-it',
    'The board rotates to the seat to move, and only that seat’s ring and bar are drawn ' +
      'on the bubbles; between turns the board holds neither seat’s colour, which is ' +
      'what the 300 empty frames are. 67 frames with only p1, 83 with only p2, none ' +
      'with both.',
  ],
  [
    'shut-the-box',
    'One sheet of tiles, framed and shaded in the colour of whoever is rolling, with the ' +
      'other seat’s tiles not on screen at all. 244 frames with only p1, 76 with only ' +
      'p2, none with both.',
  ],
  [
    'yazy',
    'One scoresheet at a time, tinted for the seat whose turn it is; the rival’s sheet ' +
      'is not drawn. 272 frames with only p1, 108 with only p2, none with both.',
  ],
]);

/**
 * Games this harness could not get moving, which is a gap in the harness, not a verdict.
 *
 * The gesture script is seeded taps and a held key; a game that wants a drag of a
 * particular shape, or that never puts a seat colour on screen until something the script
 * cannot do has happened, leaves one seat or both with nothing drawn. Recorded here in
 * the same spirit as the deuteranopia measurement in `palette-vision.test.ts`: a known
 * hole named out loud beats a green tick that means nothing.
 *
 * Empty today — every game this file cannot judge is turn-based by design — and kept
 * because the distinction is the point: an entry here is asserted to be genuinely
 * undriven, one seat alone or neither, so it can never stand in for a game that simply
 * takes turns.
 */
const NOT_YET_DRIVEN: ReadonlyMap<string, string> = new Map<string, string>();

/** One recorded draw call, reduced to what rule 7 cares about. */
interface Mark {
  readonly seat: SeatId | null;
  /** The primitive, and the literal string if it is a label. Never position. */
  readonly kind: string;
  /** The primitive's own measurements, in logical units. */
  readonly dims: readonly number[];
  readonly cx: number;
  readonly cy: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Every string either seat is allowed to be drawn in.
 *
 * All four entries, not just `base`: `deep` is the outline a piece carries, `tint` the
 * wash over territory it owns and `soft` its trail, and a game that marks ownership with
 * any of them is marking ownership. Matching is by exact string, never by how close two
 * colours look — the first version of this file scored colours by RGB distance and
 * cheerfully decided that every pale background in the repository was a seat.
 */
const SEAT_COLOURS: ReadonlyMap<string, SeatId> = new Map<string, SeatId>(
  (['p1', 'p2'] as const).flatMap((seat): [string, SeatId][] => {
    const palette = SEAT_PALETTE[seat];
    return [palette.base, palette.deep, palette.tint, palette.soft].map((colour) => [colour, seat]);
  }),
);

/**
 * The recording renderer.
 *
 * Rotation is accepted and ignored: `pushSeatRotation` turns the world about the centre
 * of the logical box, which moves where a mark lands but not what shape it is, and shape
 * is the whole question here.
 *
 * A mark that paints nothing is dropped here rather than filtered later, so that it can
 * never be a glyph, never be the anchor an ornament is attributed to, and never be
 * counted.
 */
class RecordingRenderer implements Renderer {
  readonly marks: Mark[] = [];
  readonly #minInk: number;

  constructor(minInk: number) {
    this.#minInk = minInk;
  }

  #push(
    kind: string,
    dims: readonly number[],
    colour: string,
    cx: number,
    cy: number,
    width: number,
    height: number,
  ): void {
    if (dims.some((dim) => !(dim > 0))) return;
    const w = Math.abs(width);
    const h = Math.abs(height);
    if (w * h < this.#minInk) return;
    this.marks.push({
      seat: SEAT_COLOURS.get(colour) ?? null,
      kind,
      dims,
      cx,
      cy,
      width: w,
      height: h,
    });
  }

  clear(): void {
    // The background is nobody's element.
  }

  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#push(
      'rect',
      [Math.abs(width), Math.abs(height)],
      colour,
      x + width / 2,
      y + height / 2,
      width,
      height,
    );
  }

  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    this.#push(
      'srect',
      [Math.abs(width), Math.abs(height), lineWidth],
      colour,
      x + width / 2,
      y + height / 2,
      width,
      height,
    );
  }

  circle(x: number, y: number, radius: number, colour: string): void {
    this.#push('circ', [radius], colour, x, y, radius * 2, radius * 2);
  }

  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.#push('scirc', [radius, lineWidth], colour, x, y, radius * 2, radius * 2);
  }

  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    const length = Math.hypot(x2 - x1, y2 - y1);
    this.#push(
      'line',
      [length, lineWidth],
      colour,
      (x1 + x2) / 2,
      (y1 + y2) / 2,
      Math.abs(x2 - x1) + lineWidth,
      Math.abs(y2 - y1) + lineWidth,
    );
  }

  text(value: string, x: number, y: number, sizePx: number, colour: string): void {
    // A label is a discriminator in its own right, so the string is part of the kind. The
    // width is an estimate; it is only ever used to decide whether this label sits inside
    // a seat's element.
    this.#push(
      `text:${value}`,
      [value.length, sizePx],
      colour,
      x,
      y,
      value.length * sizePx * 0.6,
      sizePx,
    );
  }

  pushSeatRotation(): void {}
  pushRotation(): void {}
  popSeatRotation(): void {}
}

/** One frame's marks, grouped by the seat that owns them; null when a seat drew nothing. */
interface FrameMarks {
  readonly p1: readonly Mark[] | null;
  readonly p2: readonly Mark[] | null;
}

/** Group one frame's marks by the seat that owns them. */
function ownFrame(marks: readonly Mark[], area: number): FrameMarks {
  const owned: Record<SeatId, Mark[]> = { p1: [], p2: [] };
  const playable = marks.filter((mark) => mark.width * mark.height <= area * MAX_AREA_FRACTION);

  for (const mark of playable) {
    if (mark.seat === null) continue;
    owned[mark.seat].push(mark);
  }
  if (owned.p1.length === 0 || owned.p2.length === 0) {
    return {
      p1: owned.p1.length > 0 ? owned.p1 : null,
      p2: owned.p2.length > 0 ? owned.p2 : null,
    };
  }

  // An ornament — an ink pip, a wire ring, a number written on a piece — belongs to the
  // seat whose element it sits on. Attributed only when exactly one seat claims it, so
  // two overlapping pieces never lend each other a shape.
  const anchors: Record<SeatId, readonly Mark[]> = { p1: [...owned.p1], p2: [...owned.p2] };
  for (const mark of playable) {
    if (mark.seat !== null) continue;
    let owner: SeatId | null = null;
    let ambiguous = false;
    for (const seat of ['p1', 'p2'] as const) {
      const hit = anchors[seat].some(
        (anchor) =>
          mark.width <= anchor.width &&
          mark.height <= anchor.height &&
          Math.abs(mark.cx - anchor.cx) <= anchor.width / 2 &&
          Math.abs(mark.cy - anchor.cy) <= anchor.height / 2,
      );
      if (!hit) continue;
      if (owner !== null) ambiguous = true;
      owner = seat;
    }
    if (owner !== null && !ambiguous) owned[owner].push(mark);
  }

  return { p1: owned.p1, p2: owned.p2 };
}

/**
 * Which seats held the screen, over every sampled frame of every match.
 *
 * The only number that used to matter was `shared`. The rest are here because "the seats
 * are never on screen together" has two completely different causes, and the harness has
 * to say which: a board that takes turns leaves both seats holding the screen alone for
 * long stretches, while a game the gesture script never started leaves one seat with
 * nothing, or the screen empty.
 */
interface Census {
  readonly shared: number;
  readonly soloP1: number;
  readonly soloP2: number;
  readonly blank: number;
}

function census(frames: readonly FrameMarks[]): Census {
  let shared = 0;
  let soloP1 = 0;
  let soloP2 = 0;
  let blank = 0;
  for (const frame of frames) {
    if (frame.p1 !== null && frame.p2 !== null) shared += 1;
    else if (frame.p1 !== null) soloP1 += 1;
    else if (frame.p2 !== null) soloP2 += 1;
    else blank += 1;
  }
  return { shared, soloP1, soloP2, blank };
}

/** True when both seats took the screen alone often enough to be taking turns. */
function alternates(count: Census): boolean {
  return count.soloP1 >= MIN_SOLO_FRAMES && count.soloP2 >= MIN_SOLO_FRAMES;
}

function sizeClass(dims: readonly number[]): string {
  return dims.map((dim) => String(Math.floor(Math.log2(dim) * SIZE_STEPS_PER_DOUBLING))).join(',');
}

function glyphOf(mark: Mark): string {
  return `${mark.kind}#${sizeClass(mark.dims)}`;
}

/** True when two glyphs are the same primitive at a size no player would call different. */
function alike(a: string, b: string): boolean {
  const cutA = a.indexOf('#');
  const cutB = b.indexOf('#');
  if (a.slice(0, cutA) !== b.slice(0, cutB)) return false;
  const mine = a.slice(cutA + 1).split(',');
  const theirs = b.slice(cutB + 1).split(',');
  if (mine.length !== theirs.length) return false;
  return mine.every((value, i) => Math.abs(Number(value) - Number(theirs[i])) <= SIZE_SLACK);
}

/** What a seat's elements look like once colour is taken away. */
interface Signature {
  /** How many frames were compared — the ones with both seats on screen. */
  readonly shared: number;
  /** How many of those frames held each primitive, at any size. */
  readonly kinds: ReadonlyMap<string, number>;
  /**
   * Glyphs steady enough to navigate by and drawn at a size that holds, against their
   * per-frame count — or `*` when that count moves with the board.
   */
  readonly glyphs: ReadonlyMap<string, string>;
}

function signatureOf(
  frames: readonly FrameMarks[],
  pick: (frame: FrameMarks) => readonly Mark[] | null,
): Signature {
  // First pass: how often each primitive is on screen, and how often at each size. A size
  // the seat holds nearly every time it draws that primitive is a designed size; one it
  // does not is a quantity the simulation is moving.
  const kinds = new Map<string, number>();
  const sizes = new Map<string, number>();
  for (const frame of frames) {
    const marks = pick(frame);
    if (marks === null) continue;
    const frameKinds = new Set<string>();
    const frameGlyphs = new Set<string>();
    for (const mark of marks) {
      frameKinds.add(mark.kind);
      frameGlyphs.add(glyphOf(mark));
    }
    for (const kind of frameKinds) kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    for (const glyph of frameGlyphs) sizes.set(glyph, (sizes.get(glyph) ?? 0) + 1);
  }

  const holds = (mark: Mark): boolean =>
    (sizes.get(glyphOf(mark)) ?? 0) >= SIZE_CONSTANCY * (kinds.get(mark.kind) ?? 0);

  // Second pass: the per-frame count of every glyph whose size holds.
  const counted = new Map<string, number[]>();
  for (const frame of frames) {
    const marks = pick(frame);
    if (marks === null) continue;
    const counts = new Map<string, number>();
    for (const mark of marks) {
      if (!holds(mark)) continue;
      const glyph = glyphOf(mark);
      counts.set(glyph, (counts.get(glyph) ?? 0) + 1);
    }
    for (const [glyph, n] of counts) {
      const list = counted.get(glyph);
      if (list === undefined) counted.set(glyph, [n]);
      else list.push(n);
    }
  }

  const glyphs = new Map<string, string>();
  for (const [glyph, list] of counted) {
    if (list.length < STABILITY * frames.length) continue;
    const first = list[0] ?? 0;
    glyphs.set(glyph, list.every((n) => n === first) ? String(first) : '*');
  }
  return { shared: frames.length, kinds, glyphs };
}

/**
 * True when nothing but colour separates the two seats.
 *
 * Evidence in the order rule 7 names it. A **primitive or label** one seat draws steadily
 * and the other never draws at all separates them — a square mole against a round one, an
 * initial on one piece. A **fixed multiplicity** of the same glyph separates them: three
 * blades against five, every frame of every match. A **size** separates them when one
 * seat holds it and the other draws nothing of that primitive within {@link SIZE_SLACK}
 * of it.
 *
 * What does not separate them: a count either seat varies, since "I have four squares and
 * you have three" is the score rather than an answer to whose square is whose; and a size
 * either seat moves, which is a readout both of them have. Sea Battle is the case that
 * made the first matter — one fleet happened to sit still at five cells for the whole
 * sample while the other was still being laid out — and Chicken Jump the second.
 */
function indistinguishable(a: Signature, b: Signature): boolean {
  for (const [side, other] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const [kind, frames] of side.kinds) {
      // A primitive that flickers past in a few frames is not something a player can
      // navigate by, so its absence from the other seat proves nothing.
      if (frames < STABILITY * side.shared) continue;
      if (!other.kinds.has(kind)) return false;
    }
    for (const [glyph, count] of side.glyphs) {
      const theirs = other.glyphs.get(glyph);
      if (theirs !== undefined) {
        if (count !== '*' && theirs !== '*' && count !== theirs) return false;
        continue;
      }
      let near = false;
      for (const candidate of other.glyphs.keys()) {
        if (alike(glyph, candidate)) {
          near = true;
          break;
        }
      }
      if (!near) return false;
    }
  }
  return true;
}

interface Verdict {
  readonly census: Census;
  readonly identical: boolean;
  readonly p1: Signature;
  readonly p2: Signature;
}

interface Run {
  readonly seed: number;
  readonly opening: SeatId;
  readonly difficulty: 'easy' | 'normal' | 'hard' | null;
}

/**
 * Three matches per game, deliberately unalike.
 *
 * Both bot tiers and a bot-free match, both opening seats: a game that only draws a
 * seat's mark once that seat has scored needs a match where both seats score, and a
 * turn-based game needs to be seen from both openings.
 */
const RUNS: readonly Run[] = [
  { seed: 20260829, opening: 'p1', difficulty: 'normal' },
  { seed: 424242, opening: 'p2', difficulty: 'hard' },
  { seed: 90210, opening: 'p1', difficulty: null },
];

function playMatch(manifest: GameManifest, game: Game, run: Run): FrameMarks[] {
  const logical = manifest.logical;
  const area = logical.width * logical.height;
  const renderer = new RecordingRenderer(area * MIN_INK_FRACTION);

  const context: GameContext = {
    manifest,
    rng: new Rng(run.seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: run.opening,
    botDifficulty: () => run.difficulty,
  };
  game.init(context);

  const input = new InputManager(logical, {
    split: manifest.zoneSplit === 'vertical' ? 'vertical' : 'horizontal',
    bottomSeat: 'p1',
  });
  const view = new InputView();
  const script = new Rng(run.seed ^ 0x5f3759df);
  const frames: FrameMarks[] = [];

  for (let step = 0; step < STEPS_PER_MATCH; step += 1) {
    // A seeded gesture script that sweeps the whole board from both seats' zones, so
    // that a game which only paints a seat's colour once that seat has acted gets the
    // chance to act.
    if (step % 13 === 0) {
      input.pointerDown(step % 3, script.float() * logical.width, script.float() * logical.height);
    }
    if (step % 13 === 5) input.pointerUp(step % 3);
    // Both seats' up keys, never one. This pressed `KeyW` alone, which is p1's key and
    // nobody else's, and that quietly handed the two seats different games: in
    // Whack-a-Mole only p1 counted as a keyboard player, so only p1 drew a cursor ring,
    // and the harness read "p1 has a ring and p2 has not" as rule 7 being satisfied.
    // Making both moles the same shape did not turn that game red until this pressed both
    // keys — a harness that drives the seats differently can prove nothing about them.
    if (step % 29 === 0) {
      input.keyDown('KeyW');
      input.keyDown('ArrowUp');
    }
    if (step % 29 === 11) {
      input.keyUp('KeyW');
      input.keyUp('ArrowUp');
    }

    game.update(STEP, view.sync(input.beginStep(STEP)));
    if (step % SAMPLE_EVERY !== 0) continue;
    renderer.marks.length = 0;
    game.render(renderer, 0);
    frames.push(ownFrame(renderer.marks, area));
  }
  game.destroy();
  return frames;
}

interface GlobbedImportMeta {
  glob: <T>(pattern: string) => Record<string, () => Promise<T>>;
}

/**
 * Every game package's entry point, taken from `src` and keyed by slug.
 *
 * Deliberately not the registry's loaders. Those import `@duelbox/game-<id>`, whose
 * package.json points at `dist`, so the harness graded the last build rather than the
 * code in the tree: a rule 7 violation written into `src` came back green under
 * `pnpm test` alone, and CI caught it only because `pnpm typecheck` runs first and
 * rebuilds. The registry is still the roster — a game the site cannot load is not a game
 * — but the code that runs here is the source.
 */
const SOURCE_GLOB = (import.meta as unknown as GlobbedImportMeta).glob<{ default: LoadedGame }>(
  '../../../../packages/games/*/src/index.ts',
);

function slugOfPath(path: string): string {
  return path.split('/').at(-3) ?? path;
}

const SOURCE_MODULES: ReadonlyMap<string, () => Promise<{ default: LoadedGame }>> = new Map(
  Object.entries(SOURCE_GLOB).map(([path, load]) => [slugOfPath(path), load]),
);

const SOURCE_PATHS: ReadonlyMap<string, string> = new Map(
  Object.keys(SOURCE_GLOB).map((path) => [slugOfPath(path), path]),
);

async function verdictFor(slug: string): Promise<Verdict> {
  const load = SOURCE_MODULES.get(slug);
  expect(load, `${slug} has no packages/games/${slug}/src/index.ts to run`).toBeDefined();
  const loaded = (await load!()).default;
  const frames: FrameMarks[] = [];
  for (const run of RUNS) {
    frames.push(...playMatch(loaded.manifest, loaded.create(), run));
  }
  const shared = frames.filter((frame) => frame.p1 !== null && frame.p2 !== null);
  const p1 = signatureOf(shared, (frame) => frame.p1);
  const p2 = signatureOf(shared, (frame) => frame.p2);
  return { census: census(frames), identical: indistinguishable(p1, p2), p1, p2 };
}

/** Every playable game, in registry order. */
const ROSTER = Object.keys(LOADERS_FOR_TEST);

/** Filled in as the per-game tests run, and reported at the end of the file. */
const RESULTS = new Map<string, Verdict>();

function noted(slug: string): string {
  if (COLOUR_ONLY_SEATS.has(slug)) return ' (known gap)';
  if (SHAPE_THE_HARNESS_CANNOT_SEE.has(slug)) return ' (shape this file cannot see)';
  if (TURN_BASED_SOLO.has(slug)) return ' (turn-based)';
  if (NOT_YET_DRIVEN.has(slug)) return ' (undriven)';
  return '';
}

describe('rule 7: the two seats differ by more than colour', () => {
  for (const slug of ROSTER) {
    it(
      `${slug}${noted(slug)}`,
      async () => {
        const verdict = await verdictFor(slug);
        RESULTS.set(slug, verdict);
        const count = verdict.census;
        const known = COLOUR_ONLY_SEATS.get(slug) ?? SHAPE_THE_HARNESS_CANNOT_SEE.get(slug);
        const byDesign = TURN_BASED_SOLO.get(slug);
        const undriven = NOT_YET_DRIVEN.get(slug);

        if (count.shared < MIN_SHARED_FRAMES) {
          // The two seats are never on screen together. Which of the two reasons that is
          // has to be claimed in a list, and is then checked against what the matches
          // actually did, so an unjudged game is never a silent pass.
          expect(known, `${slug} is listed as a rule 7 gap but cannot be judged`).toBeUndefined();
          expect(
            byDesign ?? undriven,
            `${slug} could not be judged: ${String(count.shared)} frame(s) had both seats on ` +
              `screen, against ${String(count.soloP1)} with only p1, ${String(count.soloP2)} ` +
              `with only p2 and ${String(count.blank)} with neither. Add it to ` +
              'TURN_BASED_SOLO if the board belongs wholly to whoever is to move, or to ' +
              'NOT_YET_DRIVEN if the gesture script never got it moving — with a reason, ' +
              'and check rule 7 by hand either way.',
          ).toBeDefined();
          expect(
            byDesign !== undefined && undriven !== undefined,
            `${slug} is in both TURN_BASED_SOLO and NOT_YET_DRIVEN`,
          ).toBe(false);
          if (byDesign !== undefined) {
            expect(
              alternates(count),
              `${slug} is listed as turn-based, but its seats do not take turns on screen: ` +
                `${String(count.soloP1)} frames with only p1 and ${String(count.soloP2)} with ` +
                'only p2. It belongs in NOT_YET_DRIVEN.',
            ).toBe(true);
          } else {
            expect(
              alternates(count),
              `${slug} is listed as undriven, but both seats do hold the screen alone — ` +
                `${String(count.soloP1)} frames and ${String(count.soloP2)}. That is a game ` +
                'taking turns: it belongs in TURN_BASED_SOLO.',
            ).toBe(false);
          }
          return;
        }

        expect(
          byDesign ?? undriven,
          `${slug} is judged now (${String(count.shared)} shared frames) — delete its ` +
            'TURN_BASED_SOLO or NOT_YET_DRIVEN entry',
        ).toBeUndefined();

        if (known !== undefined) {
          // A known gap. Asserted to still be one, so that fixing the game turns this red
          // and forces the entry out of the list rather than leaving a stale exception
          // behind, which is how the size budget rotted for months.
          expect(
            verdict.identical,
            `${slug} no longer draws its seats identically — delete its COLOUR_ONLY_SEATS ` +
              'or SHAPE_THE_HARNESS_CANNOT_SEE entry',
          ).toBe(true);
          return;
        }

        expect(
          verdict.identical,
          `${slug} draws both seats from the identical shapes; only the colour differs.\n` +
            `  p1: ${[...verdict.p1.glyphs].map(([g, n]) => `${g}x${n}`).join(', ')}\n` +
            `  p2: ${[...verdict.p2.glyphs].map(([g, n]) => `${g}x${n}`).join(', ')}`,
        ).toBe(false);
      },
      60_000,
    );
  }
});

describe('the harness itself', () => {
  const BOARD = 1000 * 1000;

  function verdictOf(frames: readonly FrameMarks[]): boolean {
    const shared = frames.filter((frame) => frame.p1 !== null && frame.p2 !== null);
    return indistinguishable(
      signatureOf(shared, (frame) => frame.p1),
      signatureOf(shared, (frame) => frame.p2),
    );
  }

  /** Forty frames of whatever `draw` puts on screen, grouped by the seat that owns it. */
  function play(draw: (renderer: RecordingRenderer, frame: number) => void): FrameMarks[] {
    const renderer = new RecordingRenderer(BOARD * MIN_INK_FRACTION);
    const frames: FrameMarks[] = [];
    for (let frame = 0; frame < 40; frame += 1) {
      renderer.marks.length = 0;
      draw(renderer, frame);
      frames.push(ownFrame(renderer.marks, BOARD));
    }
    return frames;
  }

  /**
   * A guard nobody has watched fail is not a guard.
   *
   * Two synthetic games, identical but for the one thing rule 7 is about: the first draws
   * both seats as the same circle in two colours, the second gives one seat a square. The
   * check must call the first a violation and the second fine — otherwise every green
   * result above means nothing.
   */
  function fakeGame(differentiate: boolean): FrameMarks[] {
    return play((renderer, frame) => {
      renderer.circle(100 + frame, 100, 20, SEAT_PALETTE.p1.base);
      if (differentiate) renderer.rect(300, 300, 40, 40, SEAT_PALETTE.p2.base);
      else renderer.circle(300, 300 + frame, 20, SEAT_PALETTE.p2.base);
    });
  }

  it('calls two identically-shaped seats a violation', () => {
    expect(verdictOf(fakeGame(false))).toBe(true);
  });

  it('clears two differently-shaped seats', () => {
    expect(verdictOf(fakeGame(true))).toBe(false);
  });

  it('attributes a neutral ornament to the seat whose element it sits on', () => {
    // The step that stops Sumo and Rock Paper Scissors being falsely accused: both seats
    // are the same circle, and the only difference is an ink pip drawn on one of them.
    expect(
      verdictOf(
        play((renderer) => {
          renderer.circle(100, 100, 20, SEAT_PALETTE.p1.base);
          renderer.circle(300, 300, 20, SEAT_PALETTE.p2.base);
          renderer.circle(300, 300, 5, '#000000');
        }),
      ),
    ).toBe(false);
  });

  it('ignores a mark that covers the board, so a background tint is not a shape', () => {
    expect(
      verdictOf(
        play((renderer) => {
          renderer.rect(0, 0, 900, 900, SEAT_PALETTE.p1.tint);
          renderer.circle(100, 100, 20, SEAT_PALETTE.p1.base);
          renderer.circle(300, 300, 20, SEAT_PALETTE.p2.base);
        }),
      ),
    ).toBe(true);
  });

  it('treats a fixed multiplicity as a pattern and a varying one as board state', () => {
    // Three blades against five is a discriminator; four squares against three is a score.
    const fixed = play((renderer) => {
      for (let i = 0; i < 3; i += 1) renderer.circle(100 + i * 40, 100, 20, SEAT_PALETTE.p1.base);
      for (let i = 0; i < 5; i += 1) renderer.circle(100 + i * 40, 300, 20, SEAT_PALETTE.p2.base);
    });
    const varying = play((renderer, frame) => {
      for (let i = 0; i <= frame % 4; i += 1) {
        renderer.circle(100 + i * 40, 100, 20, SEAT_PALETTE.p1.base);
      }
      for (let i = 0; i <= frame % 3; i += 1) {
        renderer.circle(100 + i * 40, 300, 20, SEAT_PALETTE.p2.base);
      }
    });
    expect(verdictOf(fixed)).toBe(false);
    expect(verdictOf(varying)).toBe(true);
  });

  it('does not count a varying multiplicity against a fixed one', () => {
    // Both seats draw the same square; one seat's count sits still and the other's moves.
    // That is board state, not a design, and reading it as a discriminator is exactly how
    // Sea Battle slipped through the first version of this file.
    expect(
      verdictOf(
        play((renderer, frame) => {
          for (let i = 0; i < 5; i += 1) {
            renderer.rect(100 + i * 60, 100, 40, 40, SEAT_PALETTE.p1.base);
          }
          for (let i = 0; i <= frame % 4; i += 1) {
            renderer.rect(100 + i * 60, 300, 40, 40, SEAT_PALETTE.p2.base);
          }
        }),
      ),
    ).toBe(true);
  });

  it('refuses a mark that paints nothing, so an invisible glyph is not an exemption', () => {
    // Every one of these was a one-line rule 7 exemption before the ink floor existed:
    // each adds a glyph to p2's signature that p1 does not have, and paints no pixels.
    expect(
      verdictOf(
        play((renderer) => {
          renderer.circle(100, 100, 20, SEAT_PALETTE.p1.base);
          renderer.circle(300, 300, 20, SEAT_PALETTE.p2.base);
          renderer.line(300, 300, 300, 300, 0, SEAT_PALETTE.p2.base);
          renderer.line(300, 300, 400, 300, 0, SEAT_PALETTE.p2.base);
          renderer.rect(300, 300, 40, 0, SEAT_PALETTE.p2.base);
          renderer.strokeRect(300, 300, 40, 40, 0, SEAT_PALETTE.p2.base);
          renderer.circle(300, 300, 0, SEAT_PALETTE.p2.base);
          renderer.strokeCircle(300, 300, 20, 0, SEAT_PALETTE.p2.base);
          renderer.text('', 300, 300, 20, SEAT_PALETTE.p2.base);
          renderer.rect(300, 300, 0.4, 0.4, SEAT_PALETTE.p2.base);
        }),
      ),
    ).toBe(true);

    // The same mark, drawn at a size somebody can see, is evidence.
    expect(
      verdictOf(
        play((renderer) => {
          renderer.circle(100, 100, 20, SEAT_PALETTE.p1.base);
          renderer.circle(300, 300, 20, SEAT_PALETTE.p2.base);
          renderer.line(300, 300, 340, 300, 4, SEAT_PALETTE.p2.base);
        }),
      ),
    ).toBe(false);
  });

  it('will not read a size difference too small to see as a difference of shape', () => {
    const discs = (left: number, right: number): FrameMarks[] =>
      play((renderer) => {
        renderer.circle(100, 100, left, SEAT_PALETTE.p1.base);
        renderer.circle(300, 300, right, SEAT_PALETTE.p2.base);
      });
    // The first version of this file conceded this case in its docstring and understated
    // it: a tenth of a radius was a shape.
    expect(verdictOf(discs(10, 11))).toBe(true);
    expect(verdictOf(discs(10, 13))).toBe(true);
    // Half again as large is a size a player can navigate by, and still counts.
    expect(verdictOf(discs(10, 15))).toBe(false);
    expect(verdictOf(discs(10, 30))).toBe(false);
  });

  it('collapses a size that tracks the score, and keeps one that does not', () => {
    // A bar whose width is the score is a readout, and both seats have one. Chicken Jump
    // passed the first version of this file on exactly that.
    expect(
      verdictOf(
        play((renderer, frame) => {
          renderer.rect(100, 100, 40, 40, SEAT_PALETTE.p1.base);
          renderer.rect(300, 300, 40, 40, SEAT_PALETTE.p2.base);
          renderer.rect(300, 400, 10 + frame * 4, 8, SEAT_PALETTE.p2.base);
        }),
      ),
    ).toBe(true);

    // The same extra bar at a size that holds is a pattern, and is evidence.
    expect(
      verdictOf(
        play((renderer) => {
          renderer.rect(100, 100, 40, 40, SEAT_PALETTE.p1.base);
          renderer.rect(300, 300, 40, 40, SEAT_PALETTE.p2.base);
          renderer.rect(300, 400, 10, 8, SEAT_PALETTE.p2.base);
        }),
      ),
    ).toBe(false);
  });

  it('records the hole where a seat animates a size out of the comparison', () => {
    // Both seats are the same disc and one of them breathes, so nothing of p1's size ever
    // holds and p1 contributes no glyph at all — which leaves p2's steady disc reading as
    // a shape p1 does not have. This *should* be called a violation and is not.
    //
    // Recorded rather than asserted, the way palette-vision.test.ts records the
    // deuteranopia measurement: the behaviour is real, and a test that lies about it is
    // worse than one that names it. Closing it means ignoring one's own sizes whenever
    // the other seat animates the same primitive, and that falsely accuses Match, whose
    // seats differ by round score pips against square ones that appear only once somebody
    // has scored. The hole predates this file's rewrite.
    expect(
      verdictOf(
        play((renderer, frame) => {
          renderer.circle(100, 100, 20 + (frame % 8), SEAT_PALETTE.p1.base);
          renderer.circle(300, 300, 20, SEAT_PALETTE.p2.base);
        }),
      ),
    ).toBe(false);
  });

  it('records the hole where the seat that is winning looks like the seat that is marked', () => {
    // The bigger of the two, and the one that matters most: a size that is *stable* but
    // set by the score. Both seats draw the same tower of blocks, each block as wide as
    // the pole was forgiving when it landed, so the seat that is ahead draws a narrow
    // block the seat behind never draws — a glyph in one signature and not the other.
    //
    // This is Chicken Jump, and it is why deleting all three of the blocks that game
    // labels "Rule 7" — the notched tower, the barred block, the comb — still leaves it
    // passing: p2 is ahead in all three sampled matches and its narrow block shows in 428
    // frames of 450. The size does not vary across frames, so SIZE_CONSTANCY does not
    // touch it.
    //
    // Left open because every closure measured costs more than it buys. Dropping the
    // whole family of sizes a game sweeps (a rect of one height at three or more widths)
    // catches this, and falsely accuses Pinball — one pip against two, drawn as the same
    // circle — and Animal Stack, whose ink notch shares a height class with the slabs it
    // sits on. Refusing a glyph whose count moves also catches it, and falsely accuses
    // Reversi, Backgammon, Cornhole, Taxi Race and Tap Match, whose pieces are a real
    // shape drawn a varying number of times. Closing it properly means tracking marks as
    // objects across frames rather than as size classes, which is a larger change than
    // this file, and belongs with the "Create original art" work rather than in front of
    // it.
    expect(
      verdictOf(
        play((renderer) => {
          // Two blocks each, same shape, and the seat that is ahead has the narrower top.
          renderer.rect(100, 100, 128, 12, SEAT_PALETTE.p1.base);
          renderer.rect(100, 120, 128, 12, SEAT_PALETTE.p1.base);
          renderer.rect(300, 100, 128, 12, SEAT_PALETTE.p2.base);
          renderer.rect(300, 120, 30, 12, SEAT_PALETTE.p2.base);
        }),
      ),
    ).toBe(false);
  });

  it('keeps a primitive as evidence even when its size never holds still', () => {
    // Whack-a-Mole: p2's mole is a square that grows as it rises, so no size of it ever
    // holds — but p1 never draws a rect at all, and that is the whole point of the rule.
    expect(
      verdictOf(
        play((renderer, frame) => {
          renderer.circle(100, 100, 20, SEAT_PALETTE.p1.base);
          renderer.rect(300, 300, 20 + frame, 20 + frame, SEAT_PALETTE.p2.base);
        }),
      ),
    ).toBe(false);
  });

  it('reads a label as a discriminator in its own right', () => {
    expect(
      verdictOf(
        play((renderer) => {
          renderer.circle(100, 100, 20, SEAT_PALETTE.p1.base);
          renderer.text('A', 100, 100, 18, '#000000');
          renderer.circle(300, 300, 20, SEAT_PALETTE.p2.base);
          renderer.text('B', 300, 300, 18, '#000000');
        }),
      ),
    ).toBe(false);
  });

  it('tells a board that takes turns from a game that never started', () => {
    // The distinction the two undecided lists rest on. Both look identical through
    // `shared`; only the census separates them.
    const turns = census(
      play((renderer, frame) => {
        const seat = frame % 2 === 0 ? SEAT_PALETTE.p1.base : SEAT_PALETTE.p2.base;
        renderer.circle(100, 100, 20, seat);
      }),
    );
    expect(turns.shared).toBe(0);
    expect(alternates(turns)).toBe(true);

    const stalled = census(
      play((renderer) => {
        renderer.circle(100, 100, 20, SEAT_PALETTE.p1.base);
      }),
    );
    expect(stalled.shared).toBe(0);
    expect(stalled.soloP2).toBe(0);
    expect(alternates(stalled)).toBe(false);

    const dead = census(
      play((renderer) => {
        renderer.circle(100, 100, 20, '#000000');
      }),
    );
    expect(dead.blank).toBe(40);
    expect(alternates(dead)).toBe(false);
  });

  it('runs each game from its source rather than from its build', () => {
    // The hole this closes: the registry imports `@duelbox/game-<id>`, which resolves to
    // `dist`, so a violation added to `src` was invisible to `pnpm test` until something
    // else happened to rebuild.
    for (const slug of ROSTER) {
      expect(SOURCE_PATHS.get(slug), `${slug} has no source entry point`).toBe(
        `../../../../packages/games/${slug}/src/index.ts`,
      );
    }
    for (const slug of SOURCE_PATHS.keys()) {
      expect(ROSTER, `${slug} is a game package the registry cannot load`).toContain(slug);
    }
  });
});

describe('the roster', () => {
  it('judges every game it can, and the large majority of them', () => {
    // A floor as a *share* rather than a count, so that it cannot rot as games are added:
    // the roster grew from 87 to 93 while this file was being written, and a fixed floor
    // of 75 turned red for no reason anybody had to do with rule 7. If a change to the
    // gesture script or to a game stops both seats appearing together, this notices
    // before the file turns into a row of green ticks that check nothing.
    expect(RESULTS.size, 'every game should have produced a verdict').toBe(ROSTER.length);
    const judged = [...RESULTS.values()].filter(
      (verdict) => verdict.census.shared >= MIN_SHARED_FRAMES,
    ).length;
    expect(
      judged / ROSTER.length,
      `only ${String(judged)} of ${String(ROSTER.length)} games were judged`,
    ).toBeGreaterThanOrEqual(0.8);
  });

  it('keeps its exceptions a small, named minority', () => {
    const exceptions = [
      ...COLOUR_ONLY_SEATS.keys(),
      ...SHAPE_THE_HARNESS_CANNOT_SEE.keys(),
      ...TURN_BASED_SOLO.keys(),
      ...NOT_YET_DRIVEN.keys(),
    ];
    expect(new Set(exceptions).size, 'a game is listed twice').toBe(exceptions.length);
    expect(
      exceptions.length / ROSTER.length,
      `${String(exceptions.length)} of ${String(ROSTER.length)} games are exceptions`,
    ).toBeLessThanOrEqual(0.2);
  });

  it('names a reason for every exception', () => {
    const lists = [
      COLOUR_ONLY_SEATS,
      SHAPE_THE_HARNESS_CANNOT_SEE,
      TURN_BASED_SOLO,
      NOT_YET_DRIVEN,
    ];
    for (const list of lists) {
      for (const [slug, why] of list) {
        expect(ROSTER, `${slug} is not a game`).toContain(slug);
        expect(why.length, `${slug} needs a reason`).toBeGreaterThan(40);
      }
    }
  });

  it('prints the gaps, so they are never quietly carried', () => {
    const section = (title: string, list: ReadonlyMap<string, string>): string[] => [
      title,
      ...[...list].map(([slug, why]) => `  - ${slug}: ${why}`),
    ];
    const lines = [
      ...section('rule 7 — seats told apart by colour alone:', COLOUR_ONLY_SEATS),
      ...section(
        'rule 7 — seats do differ, in a way this file cannot see:',
        SHAPE_THE_HARNESS_CANNOT_SEE,
      ),
      ...section(
        'rule 7 — undecidable: the seats never share a frame, by design:',
        TURN_BASED_SOLO,
      ),
      ...section(
        'rule 7 — undecidable: the harness could not get the game moving:',
        NOT_YET_DRIVEN,
      ),
    ];
    console.warn(lines.join('\n'));
    expect(lines.length).toBeGreaterThan(0);
  });
});
