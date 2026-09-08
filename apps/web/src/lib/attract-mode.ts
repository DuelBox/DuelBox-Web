/**
 * When an idle catalogue may start playing itself, and when it must not (#165).
 *
 * A bot-versus-bot match on the catalogue shows a first-time visitor what a game looks like
 * for almost nothing — the game chunks are already built, the bots already exist — but it is
 * motion nobody asked for, on a page that is otherwise still, so every clause here is about
 * restraint. The decision is a pure function with a test per clause; the two callers
 * (`AttractIdle`, which waits, and `AttractStage`, which plays) supply the facts.
 *
 * Nothing in this module reaches the DOM, the engine or a game: it has to stay cheap enough
 * to sit in the shell, because the idle timer is on every visit to the catalogue and the
 * stage — a game module, `@duelbox/engine`, the bots — is fetched only when the timer fires.
 */

/** How long the catalogue has to be untouched before anything starts. The issue's number. */
export const IDLE_MS = 20_000;

/**
 * Events that mean "somebody is here". Any of them resets the wait, and any of them while a
 * match is showing stops it — in the same handler, before the next frame.
 *
 * `scroll` is deliberately included even though the stage's own arrival can nudge the page:
 * a nudge the browser makes is not a person, and the stage is placed where it pushes nothing
 * above it, so the only scroll events left are real ones.
 */
export const ACTIVITY_EVENTS = [
  'pointermove',
  'pointerdown',
  'keydown',
  'wheel',
  'scroll',
  'touchstart',
] as const;

/** What the browser reports about power, or null where there is no API (WebKit). */
export interface BatteryReading {
  readonly level: number;
  readonly charging: boolean;
}

/** Below this, unplugged, the device is saving itself and so must the site. */
export const LOW_BATTERY_LEVEL = 0.2;

export interface AttractEligibility {
  /** `navigator.connection.saveData` — the person has asked for less, not more. */
  readonly saveData: boolean;
  /** `(prefers-reduced-data: reduce)` — the same request, said to the stylesheet. */
  readonly reducedData: boolean;
  /** `(prefers-reduced-motion: reduce)` — a match nobody asked for is motion nobody asked for. */
  readonly reducedMotion: boolean;
  /** The tab is not being looked at. */
  readonly hidden: boolean;
  /** Null where the platform has no battery API, which is read as "not low". */
  readonly battery: BatteryReading | null;
}

/** A reading is low when the device is running down: at or under the floor and unplugged. */
export function isLowBattery(battery: BatteryReading | null): boolean {
  if (battery === null) return false;
  return battery.level <= LOW_BATTERY_LEVEL && !battery.charging;
}

/**
 * Whether the catalogue may start a match now. Every clause is a reason to say no; the only
 * yes is when none of them applies.
 */
export function shouldAttract(facts: AttractEligibility): boolean {
  if (facts.saveData || facts.reducedData || facts.reducedMotion || facts.hidden) return false;
  return !isLowBattery(facts.battery);
}

/** The scheduling primitives, injected so the timer is testable without a clock. */
export interface IdleTimerClock {
  readonly schedule: (callback: () => void, ms: number) => unknown;
  readonly cancel: (handle: unknown) => void;
}

export interface IdleTimer {
  /** Somebody did something: start the wait again from the beginning. */
  touch(): void;
  /** Stop waiting altogether, until the next `touch`. */
  cancel(): void;
}

/**
 * A wait that restarts on every touch and fires once per stretch of silence.
 *
 * Only one handle is ever live, so a burst of events costs one cancel and one schedule each
 * rather than a pile of pending callbacks that all fire at once when the burst ends.
 */
export function createIdleTimer(
  idleMs: number,
  onIdle: () => void,
  clock: IdleTimerClock,
): IdleTimer {
  let handle: unknown = null;
  const stop = (): void => {
    if (handle !== null) clock.cancel(handle);
    handle = null;
  };
  return {
    touch() {
      stop();
      handle = clock.schedule(() => {
        handle = null;
        onIdle();
      }, idleMs);
    },
    cancel: stop,
  };
}

/** The seed a match plays from, and the one the next round takes. Deterministic (rule 4). */
export function nextAttractSeed(seed: number): number {
  return (seed + 1) | 0;
}

/** Draw at most every other frame while attracting: 30 of a 60 Hz display's frames. */
export const FRAME_DIVISOR = 2;
