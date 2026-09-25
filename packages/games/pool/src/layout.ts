import type { LogicalSize } from '@duelbox/engine';
import { BALL_RADIUS, TABLE_HEIGHT } from './rules.js';

/**
 * Where Pool puts things inside its logical box, as pure functions of that box.
 *
 * Nothing here is a pixel and nothing here asks what device it is on (rules 8 and 10). The
 * whole point of the module is that a *placement* is a function of the logical size, so it
 * can be checked in a node test with no DOM: `layout.test.ts` walks these, and
 * `game.test.ts` walks the picture they produce and asserts every drawn coordinate lands
 * inside the box.
 *
 * ## Why a game needs this at all, when the letterbox already exists
 *
 * The shell fits `manifest.logical` to the screen and letterboxes the remainder
 * (`fitViewport`), and `Canvas2DRenderer.beginFrame` clips the frame to the logical box for
 * the whole frame. So a game cannot spill onto a neighbour's screen — but it *can* quietly
 * draw outside its own box and have the clip eat it, and that is not a rendering detail:
 * it is content the player never sees, at every screen size, and no letterbox test can
 * notice because the letterbox is behaving perfectly. Pool did exactly that with its foul
 * message (below), and the guard that existed skipped `text` calls and allowed ±360 units
 * of slack besides.
 *
 * The second thing that lives here is more surprising, and it is the reason #1965 is a real
 * issue for this game rather than a formality: **a gesture measured from a moving world
 * point can require screen that does not exist.** See {@link pullSpan}.
 */

/**
 * How far a pull-back has to travel for full power, in logical units, on open table.
 *
 * A ceiling rather than a fixed distance — {@link pullSpan} shortens it when the cue ball is
 * close to the edge of the box and there is nowhere to pull to.
 */
export const PULL_FOR_FULL_POWER = 260;

/** A pull shorter than this is a tap rather than a shot, and is ignored. */
export const PULL_DEADZONE = 18;

/**
 * The shortest draw that is still a draw.
 *
 * A floor under {@link pullSpan} so that the power scale can never collapse toward zero and
 * turn a stray finger into a full-blooded shot. In play it never binds: the cue ball is
 * replaced on the baulk line and `onTable` keeps every resting ball at least
 * `CUSHION + BALL_RADIUS` = 49 units from the box edge, so the real minimum room is 49. It
 * binds only for a *potted* cue ball, which keeps its position inside a pocket and can sit
 * two units from the top edge — `strike` refuses to fire one, but `#updateAim` still divides
 * by the span while the table is being read.
 */
export const MIN_PULL_SPAN = 40;

/**
 * The pull, in logical units, that means full power for a cue ball with `room` units of
 * table behind it.
 *
 * **The defect this exists to fix.** The gesture is "pull away from the cue ball; how far
 * you pulled is how hard you hit it", and until now the distance was measured against a flat
 * 260 units. A pull of 260 units has to *fit somewhere*, and the only surface a player can
 * reliably touch is the canvas — which is exactly the logical box, letterboxed onto the
 * screen. A resting ball is at least 49 units from the box edge and at most a few hundred,
 * so to play a firm shot off a cushion the player had to drag their finger to a point that
 * was not on the canvas at all.
 *
 * That did not fail cleanly, and the two ways it failed are both #1965's subject:
 *
 * - **It depended on the screen.** The host calls `setPointerCapture` on pointer-down and
 *   converts with `viewportToLogical`, which clamps nothing, so a drag that leaves the
 *   canvas keeps reporting logical coordinates — negative ones. On a 4K desktop, where the
 *   letterbox bars either side of a 1.5625 box are enormous, every shot was available. On a
 *   phone where the canvas meets the edge of the screen, the finger ran out of glass and the
 *   same shot was not. Two players, two devices, two different games — which is the shape of
 *   thing rule 9 exists to forbid.
 * - **It aimed the player at the system gesture area.** Dragging to the edge of a phone
 *   screen is how you go back, go home, or open the notification shade. The OS answers with
 *   `pointercancel`, and since #2480 a cancel is correctly *not* a release — so the shot the
 *   player was winding up was silently abandoned. The harder they pulled, the likelier it
 *   was to vanish.
 *
 * The fix is to measure the pull against the room that is actually there: full power is the
 * shorter of a full draw and the distance from the ball to the edge of the box along the
 * pull. A ball tight on a cushion is played with a short, sharp action and can still be hit
 * as hard as one in the middle of the table — which is both what a real player does on the
 * rail and the only version of this gesture that is the same on every screen. The deadzone
 * stays absolute, so a short span costs resolution (about ten distinguishable levels on the
 * cushion against seventy-five on open table, at the engine's 3.2-unit input lattice) and
 * never costs the shot.
 *
 * This one function is the whole of the fairness property, and that is worth saying plainly
 * because the obvious second half — clamping the pointer into the box before measuring it —
 * was written, tested by putting it back, and found to guard nothing: the span is already
 * no larger than the room, so full power is reached at the edge of the box and a finger
 * beyond it is already saturated. It is not here, and `game.ts` says why at the call site.
 */
export function pullSpan(room: number): number {
  if (!(room > MIN_PULL_SPAN)) return MIN_PULL_SPAN;
  return room < PULL_FOR_FULL_POWER ? room : PULL_FOR_FULL_POWER;
}

/** Power for a pull of `pull` units with `room` units behind the ball. Never outside 0..1. */
export function powerForPull(pull: number, room: number): number {
  const power = pull / pullSpan(room);
  if (!(power > 0)) return 0;
  return power > 1 ? 1 : power;
}

/**
 * How far a point may travel from (`x`, `y`) along (`dirX`, `dirY`) before it leaves the box.
 *
 * The direction is expected to be a unit vector, so the answer is in logical units. A
 * degenerate direction, a point already outside, and a NaN all return 0 rather than
 * something infinite: every caller divides by this or draws with it.
 *
 * `margin` shrinks the box first, and it exists because a *stroked* line is wider than the
 * line: its two ends are rectangles half a line-width to either side, so a 7-unit cue whose
 * butt lands exactly on the boundary on a diagonal puts a corner about 2.5 units past it.
 * The finger has no margin — a player may touch the very edge of the canvas — and the drawn
 * cue and guide take {@link CUE_STROKE_MARGIN} and {@link GUIDE_STROKE_MARGIN}, each half
 * its own stroke rounded up, which is enough at any angle because a normal's components are
 * never larger than the normal.
 *
 * Allocation-free, because every caller is on a per-frame path (rule 5).
 */
export function roomAlong(
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  logical: LogicalSize,
  margin = 0,
): number {
  // Both components, up front. A NaN in one of them fails every ordered test below, so that
  // axis would quietly stay at infinity and the *other* axis would answer — a finite room
  // for a direction that is not a direction, and a caller drawing to NaN. The test that
  // found this asked for `roomAlong(100, 200, NaN, 1)` and got 440.
  if (!Number.isFinite(dirX) || !Number.isFinite(dirY)) return 0;
  let room = Number.POSITIVE_INFINITY;
  if (dirX > 0) room = (logical.width - margin - x) / dirX;
  else if (dirX < 0) room = (margin - x) / dirX;
  let vertical = Number.POSITIVE_INFINITY;
  if (dirY > 0) vertical = (logical.height - margin - y) / dirY;
  else if (dirY < 0) vertical = (margin - y) / dirY;
  if (vertical < room) room = vertical;
  if (!(room > 0) || room === Number.POSITIVE_INFINITY) return 0;
  return room;
}

/**
 * The band below the table, and everything the HUD draws in it.
 *
 * The table is 1000 x 560 and the box is 1000 x 640, so there are exactly 80 units under the
 * table for the status line, the foul line and the seat marker. Those three used to be
 * placed by adding a literal to `TABLE_HEIGHT`, and the foul line's literal was 80 — the
 * full height of the strip. `Renderer.text` takes `y` as the *centre* of the line, so a
 * 24-unit line centred on the bottom edge of the box put half of every foul message outside
 * it, where `beginFrame`'s clip removed it. "Foul — cue ball replaced" is the one message
 * that explains why the cue ball has moved, and half of it was missing at every screen size
 * from a 320px phone to a 4K desktop.
 *
 * {@link rowCentre} is the repair and it is a clamp rather than a corrected constant,
 * because a corrected constant is one arithmetic slip from the same bug and nothing would
 * catch it. A row is asked for as a fraction of the strip and comes back moved, if it has to
 * be, far enough in for a line of that size to sit wholly inside.
 */
export const STRIP_TOP = TABLE_HEIGHT;

/** The status line: whose shot it is and how many balls they have left. */
export const STATUS_ROW = 0.32;
export const STATUS_SIZE = 30;

/** The foul line, under it, when there is one to show. */
export const FOUL_ROW = 0.78;
export const FOUL_SIZE = 22;

/** The seat's own colour-and-shape marker, at the left of the strip (rule 7). */
export const MARKER_SIZE = 26;

/**
 * The centre line for a row of text of `size`, `fraction` of the way down the strip, moved
 * in far enough that the whole line sits inside the logical box.
 *
 * Returns the middle of the strip if the strip is too shallow to hold the line at all, which
 * is a box nobody should declare but is better answered than divided by.
 */
export function rowCentre(logical: LogicalSize, fraction: number, size: number): number {
  const height = logical.height - STRIP_TOP;
  const half = size / 2;
  const lowest = STRIP_TOP + half;
  const highest = STRIP_TOP + height - half;
  if (highest < lowest) return STRIP_TOP + height / 2;
  const centre = STRIP_TOP + height * fraction;
  return centre < lowest ? lowest : centre > highest ? highest : centre;
}

/**
 * The aim line, drawn from the cue ball along the shot.
 *
 * Stopped at the edge of the box rather than clipped there. The line has always been meant
 * to run "to the first cushion rather than for ever" — the comment said so while the code
 * drew a fixed length and let the frame clip decide where it ended, which is the same
 * picture by luck and an untestable one by construction.
 */
export const GUIDE_BASE = 180;
export const GUIDE_GROWTH = 220;
/** Half the guide's 3-unit stroke, rounded up. See {@link roomAlong}'s `margin`. */
export const GUIDE_STROKE_MARGIN = 2;

export function guideLength(room: number, power: number): number {
  const wanted = GUIDE_BASE + power * GUIDE_GROWTH;
  return room < wanted ? room : wanted;
}

/**
 * The cue, drawn behind the ball, back by how hard the shot will be.
 *
 * It shares {@link pullSpan}'s constraint and has to, or the picture would contradict the
 * control: with a fixed 150-unit cue drawn back by up to 154 units, a firm shot played off a
 * cushion put the whole cue outside the box, where the clip removed it — so the one thing a
 * player reads power from disappeared exactly when they were pulling hardest.
 *
 * The cue instead occupies the room there is. It keeps a little over half of it for its own
 * length and travels through the rest, so a ball on the rail shows a short cue with a short
 * action and a ball in the middle of the table shows very nearly the cue this game has
 * always drawn: 21 to 135 units behind the ball against the old 34 to 154.
 */
export const CUE_SPAN = 300;
export const CUE_LENGTH_FRACTION = 0.55;
/** Half the cue's 7-unit stroke, rounded up. See {@link roomAlong}'s `margin`. */
export const CUE_STROKE_MARGIN = 4;
/** The tip never touches the ball, so the cue reads as drawn rather than resting on it. */
const CUE_TIP_GAP = BALL_RADIUS + 6;

export function cueLength(room: number): number {
  return (room < CUE_SPAN ? room : CUE_SPAN) * CUE_LENGTH_FRACTION;
}

/** How far behind the ball the cue's tip sits, for a shot of `power` with `room` behind it. */
export function cueTip(room: number, power: number): number {
  const span = room < CUE_SPAN ? room : CUE_SPAN;
  const travel = span - span * CUE_LENGTH_FRACTION;
  const gap = CUE_TIP_GAP < travel * 0.3 ? CUE_TIP_GAP : travel * 0.3;
  const held = power < 0 ? 0 : power > 1 ? 1 : power;
  return gap + (travel - gap) * held;
}
