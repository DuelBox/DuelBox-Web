import { seatRotated, type LogicalSize, type Presentation, type SeatId } from '@duelbox/engine';
import type { Game } from './contract.js';

/**
 * The declarative layout a game hands the SDK, so the SDK owns placement (#1863).
 *
 * The old shape was: each game placed its own geometry and the shell letterboxed around it.
 * That survives seven single-board games and breaks on the first one that wants a separate
 * control strip per seat — because "where does the near player's control strip go, and is the
 * far player's rotated" is a *presentation* question, and answering it inside 107 games is 107
 * chances to answer it differently. So a game instead *declares* where its play area and
 * control zones sit, once, in its own logical units, and {@link placeLayout} works out where
 * each thing actually goes and which way it faces for the presentation in play.
 *
 * The whole API is opt-in. A game that says nothing gets {@link defaultLayout} — the whole box
 * is the play area, no declared zones — which is exactly what every game placing its own
 * geometry already assumes, so nothing that works today has to change to keep working.
 *
 * A game may read `presentation` and `localSeat` to *place* things (that is what this is for),
 * but never to change a rule (docs/presentation.md). The layout is not simulation: it is
 * recomputed from the context every time it is asked, holds no state, and switching
 * presentation between two calls changes only where things are drawn, never the match.
 */

/** A rectangle in a game's logical units. The unit the whole SDK speaks; never pixels (rule 8). */
export interface LayoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What a control zone is for, so the shell can hint it consistently. Free-form `custom` allowed. */
export type ControlRole = 'aim' | 'move' | 'action' | 'custom';

/**
 * A region a seat acts through — a thumb-stick corner, an aim pad, a button strip.
 *
 * `seat` names whose it is: a specific seat, or `'both'` for a region shared by the two (a
 * common board a turn game hands to whoever is to move). The rect is declared in the game's
 * own upright frame; {@link placeLayout} mirrors it for a seat that reads the device upside
 * down, so the game never writes the half-turn itself.
 */
export interface ControlZone {
  readonly id: string;
  readonly seat: SeatId | 'both';
  readonly rect: LayoutRect;
  readonly role?: ControlRole;
}

/** A slot the shell's HUD sits in — a scoreboard, a turn indicator — owned by a seat or shared. */
export interface HudSlot {
  readonly id: string;
  readonly seat: SeatId | 'both';
  readonly rect: LayoutRect;
}

/** Everything a game declares about where things sit. Play area required; the rest optional. */
export interface GameLayout {
  readonly playArea: LayoutRect;
  readonly controlZones?: readonly ControlZone[];
  readonly hud?: readonly HudSlot[];
}

/** What a game is told before it declares a layout: the presentation, its seat, and the box. */
export interface LayoutContext {
  readonly presentation: Presentation;
  readonly localSeat: SeatId;
  readonly logical: LogicalSize;
}

/** A game that opts into declarative layout implements this; it is optional on {@link Game}. */
export interface LayoutAware {
  describeLayout(context: LayoutContext): GameLayout;
}

/**
 * The layout a game gets when it declares nothing: the whole box is the play area.
 *
 * This is the backward-compatible default — the assumption every game that places its own
 * geometry already makes — so a game can adopt the declarative API a control zone at a time.
 */
export function defaultLayout(logical: LogicalSize): GameLayout {
  return { playArea: { x: 0, y: 0, width: logical.width, height: logical.height } };
}

/**
 * Whatever the game declared, or the whole-box default if it declared nothing. Never throws.
 *
 * Takes the whole {@link Game} rather than just its optional method so a game that has never
 * heard of layout is a legal argument — a lone optional property is a "weak type" TypeScript
 * refuses to match against an object that lacks it, which is exactly every game built so far.
 */
export function resolveLayout(game: Game, context: LayoutContext): GameLayout {
  return game.describeLayout?.(context) ?? defaultLayout(context.logical);
}

/**
 * A rect turned 180° about the centre of the logical box.
 *
 * The point analogue is the engine's {@link toWorld}; this is the same half-turn applied to a
 * rectangle, so a zone the near seat reads at the bottom lands where the far seat, reading the
 * device upside down, reads *its* bottom.
 */
export function mirrorRect(rect: LayoutRect, logical: LogicalSize): LayoutRect {
  return {
    x: logical.width - rect.x - rect.width,
    y: logical.height - rect.y - rect.height,
    width: rect.width,
    height: rect.height,
  };
}

/** One control zone or HUD slot after the SDK has placed it for the presentation. */
export interface PlacedZone {
  readonly id: string;
  readonly seat: SeatId | 'both';
  /** Where it sits, in the game's canonical logical frame — the same rect the game declared. */
  readonly rect: LayoutRect;
  /** Whether its contents read upside down here — a far seat on a shared screen. Draw rotated. */
  readonly rotated: boolean;
  /** Whether the local device can act on it. In single-seat only the local seat's zones are. */
  readonly interactive: boolean;
}

/** A whole layout, placed for one presentation and one local seat. */
export interface PlacedLayout {
  readonly playArea: LayoutRect;
  readonly controlZones: readonly PlacedZone[];
  readonly hud: readonly PlacedZone[];
}

function placeZone(
  zone: { id: string; seat: SeatId | 'both'; rect: LayoutRect },
  context: LayoutContext,
): PlacedZone {
  // Zones are declared in one canonical frame — p1's near the bottom, p2's near the top, as
  // the games already draw them — so the rect is where it belongs and is passed through. What
  // the presentation decides is orientation and reach:
  //
  // - `rotated`: whether the seat reads the device upside down, so its contents want turning to
  //   face it. 'both' is common ground and never rotated; a seat-owned zone defers to the
  //   engine's `seatRotated`, the one authority, which is false throughout single-seat play.
  // - `interactive`: on a shared screen both seats reach their zones; in single-seat only the
  //   local seat's are on this device — the opponent's are reported so a game may draw them, but
  //   they live on another device and cannot be touched here.
  const rotated =
    zone.seat !== 'both' && seatRotated(zone.seat, context.presentation, context.localSeat);
  const interactive =
    context.presentation === 'shared-screen' ||
    zone.seat === 'both' ||
    zone.seat === context.localSeat;
  return { id: zone.id, seat: zone.seat, rect: zone.rect, rotated, interactive };
}

/**
 * Place a declared layout for the presentation in play — the SDK's half of the bargain.
 *
 * The game declared *what* sits *where* in its own upright frame; this decides where each
 * thing lands and which way it faces on this device, so that a game supports both
 * presentations without one line of its own branching on the device (CLAUDE.md rule 10):
 *
 * - **shared-screen** — both seats' zones are shown and reachable; the far seat's are flagged
 *   `rotated`, because that player reads the device from the other end, so a game turns their
 *   contents to face them ({@link mirrorRect} is the rect analogue of the engine's `toWorld`
 *   for a game that would rather mirror than rotate in place).
 * - **single-seat** — nothing is rotated (the local player owns the whole viewport upright,
 *   docs/presentation.md), and only the local seat's zones are interactive; the opponent's are
 *   still reported so a game may draw them, but marked non-interactive because they live on
 *   another device.
 *
 * The play area passes through untouched: the per-turn board flip is a dynamic thing `SeatFlip`
 * owns frame by frame, not a static placement, so this does not try to own it too.
 */
export function placeLayout(layout: GameLayout, context: LayoutContext): PlacedLayout {
  return {
    playArea: layout.playArea,
    controlZones: (layout.controlZones ?? []).map((zone) => placeZone(zone, context)),
    hud: (layout.hud ?? []).map((slot) => placeZone(slot, context)),
  };
}
