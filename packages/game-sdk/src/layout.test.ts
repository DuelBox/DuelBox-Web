import { describe, expect, it } from 'vitest';
import type { SeatId } from '@duelbox/engine';
import {
  defaultLayout,
  mirrorRect,
  placeLayout,
  resolveLayout,
  type GameLayout,
  type LayoutContext,
} from './layout.js';
import type { Game, MatchScore } from './contract.js';

/**
 * The declarative layout abstraction (#1863).
 *
 * The property the whole thing exists for is at the bottom: a game supports both presentations
 * without one line branching on the device. `TwinAim` below is the reference — it declares its
 * regions once and never reads the presentation to decide a rule, and the two presentations
 * fall out of `placeLayout` rather than out of the game.
 */

const LOGICAL = { width: 800, height: 1200 } as const;

/**
 * Reference example: a two-seat aim game with a shared board and a control pad per seat.
 *
 * It shows the pattern a real game follows. Geometry is declared **once**, in the canonical
 * frame — p1's pad along the bottom where p1 sits, p2's along the top where p2 sits, the board
 * shared in the middle — and `describeLayout` returns the identical descriptor whatever the
 * presentation, because *where things are* is the game's business and *which way they face and
 * who can reach them* is the SDK's. The only thing that moves with the presentation is what
 * `placeLayout` decides, so this class has no `if (presentation === …)` in it at all (rule 10).
 *
 * Its simulation — a score each seat can nudge — is deliberately independent of layout, so the
 * test can prove that asking for a layout, in either presentation, never touches the match.
 */
class TwinAim implements Game {
  #p1 = 0;
  #p2 = 0;

  init(): void {
    this.#p1 = 0;
    this.#p2 = 0;
  }

  update(): void {
    // A trivial, presentation-blind simulation: p1 gains a point each step.
    this.#p1 += 1;
  }

  describeLayout(context: LayoutContext): GameLayout {
    // Sizes the play area from the shared logical box (the one thing a game legitimately reads
    // to place) and never from the presentation. p1's pad sits along the bottom where p1 is,
    // p2's along the top where p2 is — one canonical frame, declared once.
    const { width, height } = context.logical;
    return {
      playArea: { x: 0, y: height / 4, width, height: height / 2 },
      controlZones: [
        { id: 'pad-p1', seat: 'p1', rect: { x: 200, y: 1000, width: 400, height: 180 }, role: 'aim' },
        { id: 'pad-p2', seat: 'p2', rect: { x: 200, y: 20, width: 400, height: 180 }, role: 'aim' },
        { id: 'board', seat: 'both', rect: { x: 0, y: height / 4, width, height: height / 2 }, role: 'custom' },
      ],
      hud: [
        { id: 'score-p1', seat: 'p1', rect: { x: 0, y: 920, width, height: 60 } },
        { id: 'score-p2', seat: 'p2', rect: { x: 0, y: 220, width, height: 60 } },
      ],
    };
  }

  render(): void {}
  onPause(): void {}
  onResume(): void {}
  getScore(): MatchScore {
    return { p1: this.#p1, p2: this.#p2, winner: null };
  }
  destroy(): void {}
}

/** A plain game that declares no layout — the shape of every game built before #1863. */
class LegacyGame implements Game {
  init(): void {}
  update(): void {}
  render(): void {}
  onPause(): void {}
  onResume(): void {}
  getScore(): MatchScore {
    return { p1: 0, p2: 0, winner: null };
  }
  destroy(): void {}
}

function context(presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): LayoutContext {
  return { presentation, localSeat, logical: LOGICAL };
}

describe('defaultLayout and backward compatibility', () => {
  it('makes the whole box the play area and declares no zones', () => {
    expect(defaultLayout(LOGICAL)).toEqual({
      playArea: { x: 0, y: 0, width: 800, height: 1200 },
    });
  });

  it('falls back to the whole-box default for a game that declares nothing', () => {
    const resolved = resolveLayout(new LegacyGame(), context('shared-screen', 'p1'));
    expect(resolved).toEqual(defaultLayout(LOGICAL));
  });

  it('returns the declared layout for a game that opts in', () => {
    const resolved = resolveLayout(new TwinAim(), context('shared-screen', 'p1'));
    expect(resolved.controlZones).toHaveLength(3);
    expect(resolved.playArea).toEqual({ x: 0, y: 300, width: 800, height: 600 });
  });
});

describe('mirrorRect is the 180-degree turn of a rect about the box centre', () => {
  it('sends a bottom strip to the top and back', () => {
    const bottom = { x: 200, y: 1000, width: 400, height: 180 };
    const top = mirrorRect(bottom, LOGICAL);
    expect(top).toEqual({ x: 200, y: 20, width: 400, height: 180 });
    // Its own inverse, like the engine's toWorld.
    expect(mirrorRect(top, LOGICAL)).toEqual(bottom);
  });
});

describe('placeLayout owns rotation and reach per presentation', () => {
  const layout = new TwinAim().describeLayout(context('shared-screen', 'p1'));

  it('on a shared screen shows both seats and turns only the far one', () => {
    const placed = placeLayout(layout, context('shared-screen', 'p1'));
    const byId = new Map(placed.controlZones.map((z) => [z.id, z]));
    // Local seat p1: upright, reachable. Far seat p2: rotated to face them, still reachable.
    expect(byId.get('pad-p1')).toMatchObject({ rotated: false, interactive: true });
    expect(byId.get('pad-p2')).toMatchObject({ rotated: true, interactive: true });
    // The shared board is common ground: never rotated, always reachable.
    expect(byId.get('board')).toMatchObject({ rotated: false, interactive: true });
    // Rects are untouched — the game placed them; the SDK only decided facing and reach.
    expect(byId.get('pad-p2')?.rect).toEqual({ x: 200, y: 20, width: 400, height: 180 });
  });

  it('mirrors the rotation for the other local seat', () => {
    const placed = placeLayout(layout, context('shared-screen', 'p2'));
    const byId = new Map(placed.controlZones.map((z) => [z.id, z]));
    // With p2 local, it is p1 that reads the device upside down.
    expect(byId.get('pad-p1')).toMatchObject({ rotated: true });
    expect(byId.get('pad-p2')).toMatchObject({ rotated: false });
  });

  it('in single-seat turns nothing and reaches only the local seat', () => {
    const placed = placeLayout(layout, context('single-seat', 'p1'));
    const byId = new Map(placed.controlZones.map((z) => [z.id, z]));
    expect(byId.get('pad-p1')).toMatchObject({ rotated: false, interactive: true });
    // The opponent's pad is drawn but on their device — reported, not reachable, never turned.
    expect(byId.get('pad-p2')).toMatchObject({ rotated: false, interactive: false });
    expect(byId.get('board')).toMatchObject({ rotated: false, interactive: true });
    for (const zone of placed.controlZones) expect(zone.rotated).toBe(false);
  });

  it('places HUD slots by the same rules as control zones', () => {
    const shared = placeLayout(layout, context('shared-screen', 'p1'));
    const single = placeLayout(layout, context('single-seat', 'p1'));
    expect(shared.hud.find((h) => h.id === 'score-p2')).toMatchObject({ rotated: true });
    expect(single.hud.find((h) => h.id === 'score-p2')).toMatchObject({
      rotated: false,
      interactive: false,
    });
  });
});

describe('a game supports both presentations without branching on the device', () => {
  it('declares the identical layout in every presentation and for either local seat', () => {
    const game = new TwinAim();
    const a = game.describeLayout(context('shared-screen', 'p1'));
    const b = game.describeLayout(context('single-seat', 'p1'));
    const c = game.describeLayout(context('shared-screen', 'p2'));
    // The declaration is presentation-blind: the game says *what and where*, once.
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('leaves the simulation untouched however the layout is queried mid-match', () => {
    // Switching presentation between layout queries must not disturb the match (rule 8) — the
    // acceptance criterion "switching presentation at runtime does not disturb simulation state".
    const game = new TwinAim();
    game.init();
    for (let i = 0; i < 10; i += 1) game.update();
    const before = game.getScore();

    // Ask for and place the layout under both presentations, repeatedly.
    for (const p of ['shared-screen', 'single-seat', 'shared-screen'] as const) {
      placeLayout(resolveLayout(game, context(p, 'p1')), context(p, 'p1'));
      placeLayout(resolveLayout(game, context(p, 'p2')), context(p, 'p2'));
    }
    expect(game.getScore()).toEqual(before);
  });
});
