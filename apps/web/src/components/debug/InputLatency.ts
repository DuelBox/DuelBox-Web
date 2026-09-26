import {
  INPUT_FAMILIES,
  LatencyMeter,
  SCALAR_ENVELOPE,
  quantiseScalar,
  type GamepadManager,
  type InputFamily,
} from '@duelbox/engine';

/**
 * Development-only event/sample-to-step measurement (#133). Nothing here drives input.
 * DOM timeStamp and Gamepad.timestamp share performance.now()'s origin. Invalid, zero,
 * future or epoch-based timestamps are unavailable, never silently replaced with "now".
 * The native pads are the same single poll browserGamepadSource converts for this step.
 */
export class InputLatency {
  readonly #meter = new LatencyMeter();
  readonly #now: () => number;
  readonly #keys = new Set<string>();
  readonly #pointers = new Set<number>();
  #pads: readonly (Gamepad | null)[] = [];
  readonly #seats = [
    { pad: -1, x: 0, y: 0, action: false, timestamp: 0 },
    { pad: -1, x: 0, y: 0, action: false, timestamp: 0 },
  ];

  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
  }

  key(code: string, down: boolean, timestamp: number): void {
    if (down) {
      if (this.#keys.has(code)) return;
      this.#keys.add(code);
    } else if (!this.#keys.delete(code)) return;
    this.#mark('keyboard', timestamp, this.#now());
  }

  pointer(id: number, kind: 'down' | 'move' | 'up', timestamp: number): void {
    if (kind === 'down') this.#pointers.add(id);
    else if (!this.#pointers.has(id)) return;
    if (kind === 'up') this.#pointers.delete(id);
    this.#mark('pointer', timestamp, this.#now());
  }

  captureGamepads(pads: readonly (Gamepad | null)[]): void {
    this.#pads = pads;
  }

  /** Call immediately before beginStep, after this step's pad poll and phase decision. */
  step(gamepads: GamepadManager, live: boolean): void {
    const now = this.#now();
    for (let i = 0; i < 2; i += 1) {
      const seat = i === 0 ? 'p1' : 'p2';
      const previous = this.#seats[i];
      if (previous === undefined) continue;
      const index = gamepads.padOf(seat);
      const reading = gamepads.reading(seat);
      if (index === null || reading === null) {
        previous.pad = -1;
        continue;
      }
      let timestamp = 0;
      for (const pad of this.#pads) {
        if (pad !== null && pad.connected && pad.index === index) {
          timestamp = pad.timestamp;
          break;
        }
      }
      // Match the input manager's precision envelope: sub-envelope stick jitter is not
      // a new simulation intent, even if the platform refreshed its timestamp.
      const x = quantiseScalar(reading.moveX, SCALAR_ENVELOPE);
      const y = quantiseScalar(reading.moveY, SCALAR_ENVELOPE);
      const validTimestamp = Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now;
      if (
        live &&
        validTimestamp &&
        previous.pad === index &&
        (x !== previous.x || y !== previous.y || reading.action !== previous.action) &&
        timestamp > previous.timestamp
      ) {
        this.#mark('gamepad', timestamp, now);
      }
      if (previous.pad !== index) previous.timestamp = 0;
      previous.pad = index;
      previous.x = x;
      previous.y = y;
      previous.action = reading.action;
      // An unavailable timestamp must not poison the next valid reading; an old one
      // must not lower the watermark and make an already measured sample fresh again.
      if (validTimestamp) previous.timestamp = Math.max(previous.timestamp, timestamp);
    }
    if (live) this.#meter.consume(now);
    else this.#meter.discardPending();
  }

  /** Pause, lost focus or cleared input: preserve completed samples, discard stale intent. */
  clear(): void {
    this.#meter.discardPending();
    this.#keys.clear();
    this.#pointers.clear();
    for (const seat of this.#seats) seat.pad = -1;
  }

  /** Only the overlay's 250ms sampler allocates readings; the step path mutates in place. */
  readings() {
    return INPUT_FAMILIES.map((family) => ({ family, ...this.#meter.stats(family) }));
  }

  #mark(family: InputFamily, timestamp: number, now: number): void {
    if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now) return;
    this.#meter.markEvent(family, timestamp);
  }
}
