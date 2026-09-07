/**
 * The player's custom keyboard bindings, persisted per browser (#129, #2428).
 *
 * Kept in its own module, deliberately not in `settings.ts`: a binding is a different shape
 * with a different failure story (a stored *conflict* is a thing that cannot happen for a
 * volume), and folding it into the settings key would put two unrelated migration paths under
 * one version number.
 *
 * ## Why bindings survive any layout without detection
 *
 * The defaults, and everything stored here, are `KeyboardEvent.code` values — *physical* key
 * positions, not the letters printed on the caps. `KeyW` is the key above `KeyA` on QWERTY,
 * AZERTY and QWERTZ alike, so the WASD cluster is the same three-key shape under the left
 * hand on every layout. That is why #2428's "non-QWERTY layouts get workable defaults without
 * manual rebinding" needs no layout detection to satisfy: the code-based defaults already are
 * the sensible per-layout defaults. `keyLabel` exists only so the *UI* can print something
 * friendlier than `KeyW`; nothing stored or compared ever leaves the `code` space.
 *
 * Reads are safe anywhere but a static render, like every store here: they reach storage
 * through `local-store.ts`, which never throws.
 */
import {
  DEFAULT_BINDINGS,
  bindingConflicts,
  otherSeat,
  type KeyBinding,
  type SeatId,
} from '@duelbox/engine';
import { KEY_PREFIX, readVersioned, removeJson, writeVersioned } from './local-store';

export const KEY_BINDINGS_KEY = `${KEY_PREFIX}key-bindings`;

const VERSION = 1;

/** The five slots a seat binds, in the order a UI lists them. */
export const BINDING_SLOTS = ['up', 'down', 'left', 'right', 'action'] as const;
export type BindingSlot = (typeof BINDING_SLOTS)[number];

export type SeatBindings = Record<SeatId, KeyBinding>;

/**
 * Keys the shell owns during a match, which a player must not be able to steal for gameplay.
 *
 * `Escape` opens the pause menu and is never delivered to the game (`GameHost` returns early
 * on it); `Tab` moves focus between the shell's own controls; the bare modifiers belong to the
 * browser and the OS (`GameHost` lets `Ctrl`/`Meta`/`Alt` chords through untouched, and on
 * macOS a `Meta`-held letter never delivers its key-up). Binding gameplay to any of them
 * either does nothing or traps the player, so the rebinding UI rejects them up front (#2428).
 */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  'Escape',
  'Tab',
  'ContextMenu',
  'ControlLeft',
  'ControlRight',
  'MetaLeft',
  'MetaRight',
  'AltLeft',
  'AltRight',
  'OSLeft',
  'OSRight',
]);

function isKeyBindingShape(value: unknown): value is KeyBinding {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  for (const slot of BINDING_SLOTS) {
    const value = record[slot];
    if (typeof value !== 'string' || value.length === 0) return false;
  }
  return true;
}

function copyBinding(binding: KeyBinding): KeyBinding {
  return {
    up: binding.up,
    down: binding.down,
    left: binding.left,
    right: binding.right,
    action: binding.action,
  };
}

function defaults(): SeatBindings {
  return { p1: copyBinding(DEFAULT_BINDINGS.p1), p2: copyBinding(DEFAULT_BINDINGS.p2) };
}

/**
 * The stored bindings with the defaults filled in for anything missing, malformed, reserved
 * or conflicting.
 *
 * A stored pair is trusted only if it survives the *same* validation a live change must pass:
 * a build wrote it, but a build with a different reserved list, or a bug, could have written
 * something a player could not fix from the UI. If either seat is unusable the pair falls all
 * the way back to the defaults rather than half-applying — a partially-valid keyboard is worse
 * than the known-good one, and the defaults always load.
 */
export function readBindings(): SeatBindings {
  const stored = readVersioned(KEY_BINDINGS_KEY, VERSION);
  if (stored === null) return defaults();
  const p1 = stored['p1'];
  const p2 = stored['p2'];
  if (!isKeyBindingShape(p1) || !isKeyBindingShape(p2)) return defaults();
  const pair: SeatBindings = { p1: copyBinding(p1), p2: copyBinding(p2) };
  // A reserved key, a cross-seat collision or a self-collision in what was stored means this
  // build cannot honour it; take the defaults rather than load a keyboard the player is stuck
  // with.
  if (validateBindingChange('p1', pair.p1, pair.p2).length > 0) return defaults();
  if (validateBindingChange('p2', pair.p2, pair.p1).length > 0) return defaults();
  return pair;
}

/**
 * Every reason `binding` cannot be given to `seat` against `other` — reserved keys first,
 * then the engine's cross-seat and self collisions. Empty means it is safe to apply.
 *
 * The reserved-key messages are generated here because only the shell knows which keys it
 * keeps; the collision messages come from the engine's `bindingConflicts`, so the UI and
 * `InputManager.setBinding` agree to the letter about what collides (#129).
 */
export function validateBindingChange(
  seat: SeatId,
  binding: KeyBinding,
  other: KeyBinding,
): string[] {
  const errors: string[] = [];
  for (const slot of BINDING_SLOTS) {
    const code = binding[slot];
    if (RESERVED_KEYS.has(code)) {
      errors.push(`Cannot bind ${keyLabel(code)} to ${seat}.${slot}: it is reserved by the app`);
    }
  }
  errors.push(...bindingConflicts(seat, binding, other));
  return errors;
}

/** The result of asking to change a binding: whether it took, and why not if it did not. */
export interface BindingWriteResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  /** The bindings after the change — unchanged from before when `ok` is false. */
  readonly bindings: SeatBindings;
}

/**
 * Change one seat's binding, independently of the other (#2428).
 *
 * Validated against the *other seat's current* binding before anything is written, so a
 * rejected change leaves storage untouched and hands back the reasons for the UI to show. A
 * write that storage refuses (quota, private browsing) still returns the new value, matching
 * `settings.ts`: the player sees what they chose, and only persistence was lost.
 */
export function writeSeatBinding(seat: SeatId, binding: KeyBinding): BindingWriteResult {
  const current = readBindings();
  const other = current[otherSeat(seat)];
  const errors = validateBindingChange(seat, binding, other);
  if (errors.length > 0) return { ok: false, errors, bindings: current };
  const next: SeatBindings =
    seat === 'p1'
      ? { p1: copyBinding(binding), p2: current.p2 }
      : { p1: current.p1, p2: copyBinding(binding) };
  writeVersioned(KEY_BINDINGS_KEY, VERSION, { p1: next.p1, p2: next.p2 });
  return { ok: true, errors: [], bindings: next };
}

/** Put one seat back to its default binding, leaving the other seat's as it is. */
export function resetSeatBinding(seat: SeatId): SeatBindings {
  const current = readBindings();
  const next: SeatBindings =
    seat === 'p1'
      ? { p1: copyBinding(DEFAULT_BINDINGS.p1), p2: current.p2 }
      : { p1: current.p1, p2: copyBinding(DEFAULT_BINDINGS.p2) };
  writeVersioned(KEY_BINDINGS_KEY, VERSION, { p1: next.p1, p2: next.p2 });
  return next;
}

/** Forget every custom binding, returning both seats to the defaults on the next read. */
export function resetBindings(): void {
  removeJson(KEY_BINDINGS_KEY);
}

/**
 * A short, human label for a `KeyboardEvent.code`, for the capture-a-key UI.
 *
 * Presentation only — never stored, never compared. `KeyW` → `W`, `ArrowUp` → `↑`,
 * `Space` → `Space`; an unrecognised code is shown as-is rather than guessed at.
 */
export function keyLabel(code: string): string {
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  switch (code) {
    case 'ArrowUp':
      return '↑';
    case 'ArrowDown':
      return '↓';
    case 'ArrowLeft':
      return '←';
    case 'ArrowRight':
      return '→';
    case 'Space':
      return 'Space';
    case 'Enter':
      return 'Enter';
    default:
      return code;
  }
}
