import type { SeatId } from '@duelbox/engine';
import styles from './DebugOverlay.module.css';

/**
 * The debug overlay (#119): what the loop is doing, and what the two seats are pressing.
 *
 * ## Why it is a function and not a component
 *
 * `TracePanel` is the precedent for the *gate* and this follows it: a query parameter,
 * `?debug=1`, rather than a build flag, because the run that matters is the one somebody is
 * confused by, and a switch they cannot reach is a switch that never explains anything.
 *
 * It is deliberately not the precedent for the *delivery*, and the difference is the
 * acceptance criterion. The trace panel ships and draws nothing without its flag; this must
 * not ship. A component behind a prop is still a module in the bundle, so the only reference
 * to this file anywhere in the app is an `import()` inside
 * `if (process.env.NODE_ENV !== 'production')` in `GameHost`. `process.env.NODE_ENV` is a
 * string literal by the time webpack parses that line, so the branch folds to `if (false)`
 * and is deleted before the parser ever looks inside it: no chunk is emitted, and this
 * module is never even resolved. `scripts/check-zero-cost.mjs` asserts the outcome rather
 * than trusting the reasoning, because a guard nobody has seen fail is a guard nobody has
 * seen.
 *
 * Living outside React is what that shape costs, and it is worth paying twice over. This
 * measures a loop; a component re-rendering four times a second would be measuring itself,
 * which is the same argument the trace panel makes for polling on an interval rather than
 * on a step. One `textContent` write per sample into one element on `document.body` costs
 * the match nothing and cannot be reconciled out from under itself by the tree it overlays.
 *
 * ## What it does not show, and why
 *
 * The issue asks for a body count. There is no body count: this engine has no physics-body
 * registry — a game is handed a fixed step, an input view and a renderer, and owns whatever
 * it simulates — so a number in that field would be one this file made up. Steps and frames
 * are counted by `FixedLoop` and by the host, and are real. A debugging aid that invents a
 * number is worse than one that leaves the row out, because the invented number is the one
 * somebody will chase.
 */

/**
 * The string `scripts/check-zero-cost.mjs` looks for in the build output.
 *
 * It is the element's id rather than a constant nothing reads, so it cannot be shaken out of
 * a bundle that does contain this module: if the overlay ships, its marker ships with it.
 */
const DEBUG_OVERLAY_ID = 'duelbox-debug-overlay';

/**
 * How often the read-out refreshes.
 *
 * A quarter of a second rather than the trace panel's tenth. Both are far off the frame
 * clock on purpose, but a frame rate is an average and 100 ms of a 60 Hz loop is six frames
 * — a window that narrow reports the sampling boundary as jitter, and a number that flickers
 * between 54 and 66 while nothing is wrong teaches whoever is watching to ignore it.
 */
const SAMPLE_MS = 250;

/** What one seat's controls are doing, at the instant of a reading. */
export interface DebugSeatReading {
  readonly seat: SeatId;
  /** Direction of intent, each component in [-1, 1]. */
  readonly moveX: number;
  readonly moveY: number;
  readonly actionHeld: boolean;
  readonly holdSeconds: number;
  /** Pointer position in logical units, or null when this seat has no pointer down. */
  readonly pointer: { readonly x: number; readonly y: number } | null;
  readonly pointerCount: number;
}

/**
 * One instantaneous read of the running host.
 *
 * Counters and a timestamp rather than rates. The overlay is what samples them, so the
 * overlay is what can turn two readings into a frame rate — and handing it the raw numbers
 * keeps every division in one file, next to the test that checks the arithmetic.
 */
/**
 * One input family's measured event-to-simulation latency (#133), from `LatencyMeter`.
 *
 * Shown so an unfair input path is a number a reader can see rather than a suspicion: a
 * reaction game where the pointer arrives a frame later than the keyboard is exactly the
 * thing `docs/input-parity.md` needs measured, and this is where the measurement surfaces.
 */
export interface DebugLatencyReading {
  /** 'keyboard' | 'pointer' | 'gamepad'. */
  readonly family: string;
  readonly samples: number;
  readonly meanMs: number;
  readonly lastMs: number;
  readonly maxMs: number;
}

export interface DebugReading {
  /** Wall-clock milliseconds, which is what makes the counters below into rates. */
  readonly at: number;
  /** Frames rendered since the host was built. */
  readonly frames: number;
  /** Simulation steps taken since the host was built — `FixedLoop.totalSteps`. */
  readonly steps: number;
  /** The loop's fixed timestep in milliseconds. Constant, and shown so the rate has a mark
      to be read against: a step consistently slower than this one is a loop falling behind. */
  readonly stepMs: number;
  /** Whether the run loop is being driven right now, which a countdown or a pause stops. */
  readonly running: boolean;
  readonly seats: readonly DebugSeatReading[];
  /**
   * Per-family input latency, or absent when no meter is attached.
   *
   * Optional so a host that does not wire the latency harness — every host in production,
   * where the whole overlay is folded out — needs no change, and the overlay simply prints no
   * latency rows. A family with no samples yet is skipped rather than shown as "0ms".
   */
  readonly latency?: readonly DebugLatencyReading[];
}

export type DebugSampler = () => DebugReading;

/** A number with its sign always shown, so a positive and a negative keep the same column. */
function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function formatSeat(seat: DebugSeatReading): string {
  const action = seat.actionHeld ? `held ${seat.holdSeconds.toFixed(2)}s` : 'up';
  // The finger count is shown only when there is more than one, because "x1" on every line
  // for the whole of every match is noise in the two columns that are read most.
  const fingers = seat.pointerCount > 1 ? ` x${seat.pointerCount}` : '';
  const pointer =
    seat.pointer === null
      ? 'none'
      : `${seat.pointer.x.toFixed(0)},${seat.pointer.y.toFixed(0)}${fingers}`;
  return `${seat.seat} move ${signed(seat.moveX)},${signed(seat.moveY)}  action ${action.padEnd(11)}pointer ${pointer}`;
}

/**
 * The lines to draw, from this reading and the one before it.
 *
 * Pure, and exported for `DebugOverlay.test.ts`: the rates are the only thing here that can
 * be wrong in a way looking at the screen would not reveal, since a plausible frame rate and
 * a correct one look identical.
 *
 * `previous` is null on the first sample and the rates are blank rather than zero, because
 * zero frames per second is a thing this overlay should be able to say when it is true.
 */
export function formatDebugReading(
  reading: DebugReading,
  previous: DebugReading | null,
): readonly string[] {
  let fps: number | null = null;
  let measuredStepMs: number | null = null;
  if (previous !== null) {
    const elapsedMs = reading.at - previous.at;
    // A window of no width divides by zero, and a negative one means the counters were
    // reset under us — a rebuilt host, a new match — so there is no rate to report yet.
    if (elapsedMs > 0) {
      fps = ((reading.frames - previous.frames) * 1000) / elapsedMs;
      const stepped = reading.steps - previous.steps;
      // Wall time actually spent per simulation step. It sits beside the fixed step rather
      // than replacing it: the two agreeing is the loop keeping up, and the measured one
      // running long is the spiral-of-death guard in `FixedLoop` dropping time.
      if (stepped > 0) measuredStepMs = elapsedMs / stepped;
    }
  }
  // The unit travels with the number rather than with the label, so an unmeasured window
  // reads "-- actual" rather than the "--ms actual" of a measurement that came out as none.
  const measured = measuredStepMs === null ? '--' : `${measuredStepMs.toFixed(2)}ms`;
  return [
    `fps ${fps === null ? '--' : fps.toFixed(1)}  step ${reading.stepMs.toFixed(2)}ms fixed,` +
      ` ${measured} actual`,
    `steps ${reading.steps}  loop ${reading.running ? 'running' : 'stopped'}`,
    ...reading.seats.map(formatSeat),
    ...formatLatency(reading.latency),
  ];
}

/**
 * One line per input family that has been measured, showing mean, last and worst latency.
 *
 * A family with no samples is left out entirely rather than shown as zero — nothing has been
 * pressed on it, and "0.00ms" would read as "instant" rather than "unmeasured", the same
 * mistake the fps row avoids by printing "--".
 */
function formatLatency(latency: DebugReading['latency']): readonly string[] {
  if (latency === undefined) return [];
  const lines: string[] = [];
  for (const entry of latency) {
    if (entry.samples <= 0) continue;
    lines.push(
      `lat ${entry.family.padEnd(8)} ${entry.meanMs.toFixed(2)}ms mean` +
        `  ${entry.lastMs.toFixed(2)} last  ${entry.maxMs.toFixed(2)} max  n=${entry.samples}`,
    );
  }
  return lines;
}

/**
 * Put the overlay on the page and start sampling. Returns the teardown.
 *
 * The element goes on `document.body` rather than into the play surface for two reasons that
 * point the same way: React owns every node inside the surface and inserts siblings around
 * the canvas as the match changes phase, and an element in that flow could push the board.
 * Fixed to the viewport, it can do neither.
 */
export function mountDebugOverlay(read: DebugSampler): () => void {
  const element = document.createElement('div');
  element.id = DEBUG_OVERLAY_ID;
  element.className = styles.overlay ?? '';
  // Hidden from assistive technology deliberately, and it is not laziness about a dev tool:
  // this text changes four times a second, so a live region here would talk over the match
  // continuously, and a static one would be read once and be wrong for the rest of the game.
  element.setAttribute('aria-hidden', 'true');
  document.body.append(element);

  let previous: DebugReading | null = null;
  const refresh = (): void => {
    const reading = read();
    element.textContent = formatDebugReading(reading, previous).join('\n');
    previous = reading;
  };
  // Drawn once immediately, so switching the flag on shows something before the first
  // interval elapses rather than a quarter-second of empty box.
  refresh();
  const timer = setInterval(refresh, SAMPLE_MS);

  return () => {
    clearInterval(timer);
    element.remove();
  };
}
