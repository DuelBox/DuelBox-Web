import type { Vec2 } from './vec2.js';

/**
 * Seats, rotation, and pointer ownership for two people sharing one device.
 *
 * All coordinates here are logical units, never pixels. The renderer is the only
 * layer that knows about the device.
 */

export type SeatId = 'p1' | 'p2';

export const SEATS: readonly SeatId[] = ['p1', 'p2'];

export function otherSeat(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export type Presentation = 'shared-screen' | 'single-seat';

export interface SeatView {
  readonly seat: SeatId;
  readonly rotated: boolean;
}

/**
 * `localSeat` is the seat sitting at the bottom of the device. In shared-screen
 * play the opposite seat reads the device upside down, so its view is rotated;
 * in single-seat play the local player owns the whole viewport and nothing is
 * ever rotated.
 *
 * Allocates, so it is for presentation changes rather than for a step. Every caller in the
 * catalogue wanted only the boolean and called this once a frame from `update()`, which is
 * a rule-5 breach thirty-one times over — so {@link seatRotated} is the one to reach for,
 * and this is kept for the case that genuinely wants the pair.
 */
export function seatView(seat: SeatId, presentation: Presentation, localSeat: SeatId): SeatView {
  return { seat, rotated: seatRotated(seat, presentation, localSeat) };
}

/**
 * Whether this seat reads the device upside down.
 *
 * The same answer as {@link seatView}'s `rotated`, as a primitive. That is the whole point:
 * a game asks this on every fixed step, and returning an object there allocates once a step
 * per game, which rule 5 forbids and which nothing was catching.
 *
 * In single-seat play the local player owns the whole viewport, so no seat is ever rotated.
 */
export function seatRotated(seat: SeatId, presentation: Presentation, localSeat: SeatId): boolean {
  return presentation === 'shared-screen' && seat !== localSeat;
}

/** Fixed logical play area. Units are logical, never pixels. */
export interface LogicalSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Maps a point in device-oriented logical space into the seat's own space.
 * When rotated it is a 180-degree rotation about the centre of the logical area.
 * Writes into `out` and allocates nothing.
 */
export function toWorld(
  out: Vec2,
  screenX: number,
  screenY: number,
  size: LogicalSize,
  rotated: boolean,
): Vec2 {
  if (rotated) {
    out.x = size.width - screenX;
    out.y = size.height - screenY;
  } else {
    out.x = screenX;
    out.y = screenY;
  }
  return out;
}

/**
 * Inverse of {@link toWorld}. A 180-degree rotation is its own inverse, so the
 * two directions share one mapping. Allocates nothing.
 */
export function toScreen(
  out: Vec2,
  worldX: number,
  worldY: number,
  size: LogicalSize,
  rotated: boolean,
): Vec2 {
  return toWorld(out, worldX, worldY, size, rotated);
}

/**
 * How the pointer surface is divided between the two seats.
 *
 * `'shared'` is not a division at all: the whole surface belongs to one seat. It exists
 * for **turn-based** games, where only one player acts at a time and the board rotates to
 * face them. Dividing the surface there was a real and serious bug — the board turns to
 * face whoever is to move, so the far side of it sits in the *other* seat's zone, and
 * every tap aimed at it was handed to a player whose turn it was not and dropped. In Tic
 * Tac Toe that made the far row of cells unreachable by touch entirely.
 *
 * Zones are right for real-time games, where both seats act at once and a touch really
 * does need to belong to the person it came from.
 */
export type ZoneSplit = 'horizontal' | 'vertical' | 'shared';

/**
 * What a manifest *declares* about its board, which is not the same question as
 * {@link ZoneSplit}.
 *
 * `'shared-board'` says the two seats look at one common board rather than at two halves.
 * That is a statement about the picture, not about who a finger belongs to — Whack a Mole
 * declares it and still needs two pointer zones, because both seats swing at those same
 * twelve holes *at the same time* and the zone is the only thing that can say which of the
 * two people a tap came from. Only the live turn state can answer the ownership question,
 * which is why {@link zoneSplitFor} takes both.
 *
 * Deliberately written out rather than imported from `@duelbox/game-sdk`'s `ZONE_SPLITS`:
 * game-sdk depends on the engine, so the engine cannot depend back. It needs no guard to
 * keep the two in step. If a fourth split were added to the manifest schema, every caller
 * passing `manifest.zoneSplit` into {@link zoneSplitFor} would stop compiling, because the
 * wider union is not assignable to this one. The compiler is the check.
 */
export type DeclaredZoneSplit = 'horizontal' | 'vertical' | 'shared-board';

/**
 * The split the pointer surface is on **right now**: the one answer, for every caller.
 *
 * This existed twice, derived differently, and the two disagreed for eleven real-time games
 * (issue #2479). The shell went through the live active seat and so never reached `'shared'`
 * for a real-time game; the input fuzzer went straight from `manifest.zoneSplit`, read
 * `'shared-board'` as `'shared'`, and therefore handed *every* pointer to seat one and none
 * to seat two — a harness whose whole purpose is two children mashing one screen, modelling
 * one child. Both derivations were locally reasonable. That is exactly why there is one.
 *
 * Three things decide it, in this order:
 *
 * 1. **Single-seat play has no divider.** The local player owns the whole viewport
 *    (`docs/presentation.md`), so the surface is `'shared'` whatever else is true. Halving
 *    it there would leave a remote player with half a dead screen.
 * 2. **A turn belongs to whoever has it.** A non-null `activeSeat` means the board has
 *    turned to face one person, so all of it is theirs. Dividing it put the far side of a
 *    rotated board in the *other* seat's zone and dropped every tap aimed there.
 * 3. **Otherwise the seats share the device and act at once**, so they get a zone each, and
 *    the manifest chooses the axis. Anything that is not `'vertical'` is horizontal: a
 *    `'shared-board'` declaration describes the picture, not the ownership.
 *
 * Allocates nothing, so it is safe to ask every frame.
 */
export function zoneSplitFor(
  presentation: Presentation,
  declared: DeclaredZoneSplit,
  activeSeat: SeatId | null,
): ZoneSplit {
  if (presentation === 'single-seat') return 'shared';
  if (activeSeat !== null) return 'shared';
  return declared === 'vertical' ? 'vertical' : 'horizontal';
}

/**
 * Which seat owns the zone a point falls in. `bottomSeat` owns the lower half
 * under a horizontal split, the left half under a vertical one, and **everything**
 * under a shared one.
 *
 * Tie-break: a point exactly on the dividing line belongs to `bottomSeat`, so
 * the two zones never both claim, and never both refuse, the same point.
 */
export function seatForPoint(
  screenX: number,
  screenY: number,
  size: LogicalSize,
  split: ZoneSplit,
  bottomSeat: SeatId,
): SeatId {
  if (split === 'shared') return bottomSeat;
  if (split === 'horizontal') {
    return screenY >= size.height / 2 ? bottomSeat : otherSeat(bottomSeat);
  }
  return screenX <= size.width / 2 ? bottomSeat : otherSeat(bottomSeat);
}

/**
 * A pointer belongs to the seat whose zone it went down in and keeps that seat
 * until it is released, however far it later travels across the divider. Without
 * this, a drag that crosses the midline would be handed to the other player.
 *
 * Backed by a Map, so the number of simultaneous pointers is not capped.
 */
export class PointerOwnership {
  readonly #owners = new Map<number, SeatId>();

  /** First claim wins: a re-claim keeps and returns the original seat. */
  claim(pointerId: number, seat: SeatId): SeatId {
    const existing = this.#owners.get(pointerId);
    if (existing !== undefined) {
      return existing;
    }
    this.#owners.set(pointerId, seat);
    return seat;
  }

  seatOf(pointerId: number): SeatId | undefined {
    return this.#owners.get(pointerId);
  }

  release(pointerId: number): void {
    this.#owners.delete(pointerId);
  }

  releaseAll(): void {
    this.#owners.clear();
  }

  get activeCount(): number {
    return this.#owners.size;
  }
}
