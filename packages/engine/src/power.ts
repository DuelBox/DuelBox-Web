/**
 * Battery awareness, as two pure decisions the host applies (#190).
 *
 * A game that flattens a phone in twenty minutes does not get played twice. What can be done
 * about it from a web page is narrow and worth stating exactly, because the issue asks for
 * more than the platform offers:
 *
 * - **Battery** is readable on Chromium and its relatives through `navigator.getBattery()`,
 *   which reports a level and whether the device is charging. WebKit — every iOS browser —
 *   implements nothing of the kind, so on the largest share of this audience the answer is
 *   always "unknown" and the feature is, correctly, a no-op. The adapter that asks the browser
 *   is `browserBatterySource` in `loop.ts`, the one file allowed to read the device; this
 *   module only decides.
 * - **Thermal** has no web API at all. There is no way for a page to learn that a phone is
 *   hot, so nothing here claims to react to it. The adaptive-quality monitor in `quality.ts`
 *   is the nearest honest proxy: a throttled device drops frames, and dropped frames step the
 *   quality down.
 *
 * ## What low power changes, and what it never changes
 *
 * Two things, both presentation. The render rate is halved — every other animation frame is
 * drawn, through {@link RenderGate} — and the renderer's effects switch goes off, so shake,
 * flash, hit-stop and the board's sweeping half-turn take the same cheap path they take under
 * reduced motion. The fixed step is untouched: `FixedLoop` runs exactly as many `update()`
 * calls per second as it always did, so the match a low-battery phone plays is byte-identical
 * to the one a charged laptop plays (rule 8), and nothing the simulation reads can tell the
 * difference.
 *
 * ## Why 20%, not charging
 *
 * The number is the one every platform's own low-power mode uses as its default prompt —
 * iOS offers Low Power Mode at 20%, Android's Battery Saver defaults to 20% (some vendors
 * 15%) — so it is the threshold a player already associates with "my phone is asking me to
 * ease off", and matching it means the site eases off at the same moment the device does
 * rather than at a number of its own. Charging is excluded because a phone on a cable is
 * not running down, and halving its frame rate would cost smoothness for nothing.
 */

/** What a battery reports, as the plain shape the adapter presents and a test can build. */
export interface BatterySnapshot {
  /** Charge in [0, 1]. */
  readonly level: number;
  readonly charging: boolean;
}

/** A function returning the battery's current state, or `null` where nothing can be known. */
export type BatterySource = () => BatterySnapshot | null;

/** The charge at and below which, off the cable, the site eases off. */
export const LOW_BATTERY_LEVEL = 0.2;

/**
 * Whether the device is running low and not being charged.
 *
 * `null` — no battery API, which is every WebKit browser — is "no", because the safe reading
 * of an unknown battery is a full frame rate: a charged laptop with no API must not be
 * throttled on a guess. A level that is not a finite number is treated the same way.
 */
export function isLowPower(snapshot: BatterySnapshot | null): boolean {
  if (snapshot === null) return false;
  if (!Number.isFinite(snapshot.level)) return false;
  return !snapshot.charging && snapshot.level <= LOW_BATTERY_LEVEL;
}

/**
 * Lets every Nth frame through.
 *
 * A counter, not a clock: the loop still schedules and receives every animation frame — it
 * has to, because the fixed step runs on the frame — and this decides which of them draw.
 * With `every` at 1 every frame draws; at 2, alternate frames. Allocation-free, and the
 * first call after a change always draws, so a change never costs a black frame.
 */
export class RenderGate {
  #every = 1;
  #countdown = 0;

  /** How many frames pass for each one drawn; 1 draws every frame. */
  get every(): number {
    return this.#every;
  }

  /**
   * Set the divisor. A value that is not a positive integer is read as 1 rather than
   * allowed to stall the picture: a gate that never opens is a blank canvas with a match
   * running behind it, which is the failure #101 is about.
   */
  setEvery(every: number): void {
    const next = Number.isInteger(every) && every >= 1 ? every : 1;
    if (next === this.#every) return;
    this.#every = next;
    this.#countdown = 0;
  }

  /** Whether the frame that is about to be rendered should be drawn. Call once per frame. */
  shouldRender(): boolean {
    if (this.#countdown === 0) {
      this.#countdown = this.#every - 1;
      return true;
    }
    this.#countdown -= 1;
    return false;
  }
}
