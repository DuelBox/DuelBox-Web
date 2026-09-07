import { describe, expect, it } from 'vitest';
import { negotiateSharedViewport, viewportToLogical, type SharedViewport } from './viewport.js';
import { vec2 } from './vec2.js';

/**
 * The match-start seam the host runs, driven for two devices at once (#1862).
 *
 * `shared-viewport.test.ts` proves `negotiateSharedLogical` is fair as a function. This drives
 * the wired seam — `negotiateSharedViewport`, the one `GameHost` calls once per resize — the
 * way a real remote match does: two devices of genuinely different aspect ratios, each running
 * the same game and so declaring the same logical box, each negotiating its own shared
 * viewport with no knowledge of the other beyond that shared declaration. Remote transport
 * does not exist yet, so the two "devices" are two viewport descriptors here, which is exactly
 * the model the issue asks for.
 *
 * The property under test is rule 9 end to end: after the negotiation both devices adopt the
 * identical logical box, and the set of world points each can actually see is identical — no
 * player can see an object the other cannot — with every surplus pixel spent on bars rather
 * than on field of view.
 */

/** Devices that differ in every way that decides this: aspect, size, density, and a notch. */
const DEVICES = [
  { label: 'small phone portrait', width: 320, height: 568, insets: undefined },
  { label: 'notched phone portrait', width: 393, height: 852, insets: { top: 59, right: 0, bottom: 34, left: 0 } },
  { label: 'phone landscape', width: 852, height: 393, insets: undefined },
  { label: 'tablet portrait', width: 768, height: 1024, insets: undefined },
  { label: 'laptop', width: 1440, height: 900, insets: undefined },
  { label: 'ultrawide', width: 3440, height: 1440, insets: undefined },
  { label: 'square', width: 800, height: 800, insets: undefined },
] as const;

/** A spread of real game boxes: square, tall, wide. Both devices run the same game, so both
 * declare the same box — which is what makes the negotiated box independent of either screen. */
const GAME_BOXES = [
  { width: 900, height: 900 },
  { width: 600, height: 1000 },
  { width: 1000, height: 600 },
  { width: 700, height: 1000 },
] as const;

/**
 * The corners of the world a device can see, in logical units, clamped to the play area.
 *
 * Derived by mapping the device's own screen corners back into logical space through its
 * negotiated viewport — the same path a tap takes — so if this says a point is visible, a
 * finger can reach it. Beyond the play-area edge is letterbox, which is not "seeing world".
 */
function visibleWorld(shared: SharedViewport, screenW: number, screenH: number) {
  const topLeft = viewportToLogical(vec2(), 0, 0, shared.view);
  const bottomRight = viewportToLogical(vec2(), screenW, screenH, shared.view);
  return {
    minX: Math.max(0, topLeft.x),
    minY: Math.max(0, topLeft.y),
    maxX: Math.min(shared.logical.width, bottomRight.x),
    maxY: Math.min(shared.logical.height, bottomRight.y),
  };
}

describe('the match-start viewport negotiation', () => {
  it('gives both devices the identical logical box, for every pair and every game', () => {
    for (const game of GAME_BOXES) {
      for (const a of DEVICES) {
        for (const b of DEVICES) {
          const seatA = negotiateSharedViewport(
            { logical: game, screenWidth: a.width, screenHeight: a.height, insets: a.insets },
            game,
          );
          const seatB = negotiateSharedViewport(
            { logical: game, screenWidth: b.width, screenHeight: b.height, insets: b.insets },
            game,
          );
          const where = `${a.label} vs ${b.label} @ ${game.width}x${game.height}`;
          // Independent of either screen: both devices land on the game's own box.
          expect(seatA.logical, where).toEqual(game);
          expect(seatB.logical, where).toEqual(game);
        }
      }
    }
  });

  it('lets neither device see a world point the other cannot', () => {
    for (const game of GAME_BOXES) {
      for (const a of DEVICES) {
        for (const b of DEVICES) {
          const seatA = negotiateSharedViewport(
            { logical: game, screenWidth: a.width, screenHeight: a.height, insets: a.insets },
            game,
          );
          const seatB = negotiateSharedViewport(
            { logical: game, screenWidth: b.width, screenHeight: b.height, insets: b.insets },
            game,
          );
          const seenA = visibleWorld(seatA, a.width, a.height);
          const seenB = visibleWorld(seatB, b.width, b.height);
          const where = `${a.label} vs ${b.label} @ ${game.width}x${game.height}`;
          // The whole play area is visible to both — the box is fully in view on each — so
          // there is no object either could hold back from the other.
          expect(seenA.minX, where).toBeCloseTo(0, 6);
          expect(seenA.minY, where).toBeCloseTo(0, 6);
          expect(seenA.maxX, where).toBeCloseTo(game.width, 6);
          expect(seenA.maxY, where).toBeCloseTo(game.height, 6);
          expect(seenB.minX, where).toBeCloseTo(seenA.minX, 6);
          expect(seenB.minY, where).toBeCloseTo(seenA.minY, 6);
          expect(seenB.maxX, where).toBeCloseTo(seenA.maxX, 6);
          expect(seenB.maxY, where).toBeCloseTo(seenA.maxY, 6);
        }
      }
    }
  });

  it('spends surplus screen on bars, never on extra field of view', () => {
    // The ultrawide has enormous surplus over a portrait box. Every bit of it must be
    // letterbox: the drawn area may not exceed the screen, and it may not reveal one unit of
    // world past the box edge.
    const game = { width: 600, height: 1000 };
    const shared = negotiateSharedViewport(
      { logical: game, screenWidth: 3440, screenHeight: 1440 },
      game,
    );
    const topLeft = viewportToLogical(vec2(), 0, 0, shared.view);
    const bottomRight = viewportToLogical(vec2(), 3440, 1440, shared.view);
    // Sees past the world horizontally — those are the bars, free for chrome.
    expect(topLeft.x).toBeLessThan(0);
    expect(bottomRight.x).toBeGreaterThan(game.width);
    // But not one unit of world past the box, and the drawn height fits the screen.
    expect(topLeft.y).toBeGreaterThanOrEqual(-1e-9);
    expect(shared.view.height).toBeLessThanOrEqual(1440 + 1e-9);
  });

  it('keeps the box independent of the screen even when a device is smaller than the box', () => {
    // A 320px phone showing a 900-unit board still simulates and hit-tests the full 900 box;
    // it simply scales it down. The negotiated logical box must not shrink to the screen.
    const game = { width: 900, height: 900 };
    const shared = negotiateSharedViewport(
      { logical: game, screenWidth: 320, screenHeight: 568 },
      game,
    );
    expect(shared.logical).toEqual(game);
    const seen = visibleWorld(shared, 320, 568);
    expect(seen.maxX - seen.minX).toBeCloseTo(900, 6);
    expect(seen.maxY - seen.minY).toBeCloseTo(900, 6);
  });

  it('never lets a peer that declared a bigger box widen this device field of view', () => {
    // The clamp half of the negotiation: if the peer somehow declared a taller box, the shared
    // box may not exceed this device's own declaration — nobody sees world the other cannot.
    // (LockstepSession refuses such a pairing outright; this is the geometric backstop.)
    const mine = { width: 600, height: 1000 };
    const peerTaller = { width: 600, height: 2000 };
    const shared = negotiateSharedViewport(
      { logical: mine, screenWidth: 1440, screenHeight: 900 },
      peerTaller,
    );
    expect(shared.logical.width).toBeLessThanOrEqual(mine.width + 1e-9);
    expect(shared.logical.height).toBeLessThanOrEqual(mine.height + 1e-9);
  });
});
