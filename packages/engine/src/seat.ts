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
 * Called on presentation changes, not per frame, so the returned object is fine.
 */
export function seatView(seat: SeatId, presentation: Presentation, localSeat: SeatId): SeatView {
  return { seat, rotated: presentation === 'shared-screen' && seat !== localSeat };
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

export type ZoneSplit = 'horizontal' | 'vertical';

/**
 * Which seat owns the zone a point falls in. `bottomSeat` owns the lower half
 * under a horizontal split and the left half under a vertical one.
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
