import { describe, expect, it } from 'vitest';
import { envelopeFor, InputManager } from './input.js';
import { InputView } from './input-view.js';

const LOGICAL = { width: 600, height: 1000 };

/**
 * Where a coordinate lands once the precision envelope has rounded it.
 *
 * These tests are about the *view* handing a game the pointer, not about the lattice, so
 * they say "wherever 800 ends up" rather than hard-coding the rounded number.
 */
const onLattice = (value: number): number =>
  Math.round(value / envelopeFor(LOGICAL)) * envelopeFor(LOGICAL);
const STEP = 1 / 60;

function manager(): InputManager {
  return new InputManager(LOGICAL, { split: 'horizontal', bottomSeat: 'p1' });
}

describe('InputView', () => {
  it('exposes movement as a vector matching the engine scalars', () => {
    const input = manager();
    const view = new InputView();
    input.keyDown('KeyD');
    view.sync(input.beginStep(STEP));

    const engine = input.state.seat('p1');
    const seat = view.seat('p1');
    expect(seat.move.x).toBe(engine.moveX);
    expect(seat.move.y).toBe(engine.moveY);
    expect(seat.move.x).toBeCloseTo(1, 10);
  });

  it('reports a null pointer when the seat has none down', () => {
    const view = new InputView().sync(manager().beginStep(STEP));
    expect(view.seat('p1').pointer).toBeNull();
    expect(view.seat('p2').pointer).toBeNull();
  });

  it('reports the pointer position while one is down, and null once it lifts', () => {
    const input = manager();
    const view = new InputView();

    // The lower half belongs to the bottom seat, which is p1 here.
    input.pointerDown(1, 300, 800);
    view.sync(input.beginStep(STEP));
    expect(view.seat('p1').pointer).not.toBeNull();
    expect(view.seat('p1').pointer?.x).toBe(onLattice(300));
    expect(view.seat('p1').pointer?.y).toBe(onLattice(800));

    input.pointerUp(1);
    view.sync(input.beginStep(STEP));
    expect(view.seat('p1').pointer).toBeNull();
  });

  it('keeps the two seats independent', () => {
    const input = manager();
    const view = new InputView();
    input.pointerDown(1, 300, 800); // p1 zone
    input.pointerDown(2, 300, 200); // p2 zone
    view.sync(input.beginStep(STEP));

    expect(view.seat('p1').pointer?.y).toBe(onLattice(800));
    expect(view.seat('p2').pointer?.y).toBe(onLattice(200));
  });

  it('carries the action edges and hold duration through', () => {
    const input = manager();
    const view = new InputView();

    input.keyDown('Space');
    view.sync(input.beginStep(STEP));
    expect(view.seat('p1').actionPressed).toBe(true);
    expect(view.seat('p1').actionHeld).toBe(true);

    view.sync(input.beginStep(STEP));
    expect(view.seat('p1').actionPressed).toBe(false);
    expect(view.seat('p1').actionHeld).toBe(true);
    expect(view.seat('p1').holdSeconds).toBeGreaterThan(0);

    input.keyUp('Space');
    view.sync(input.beginStep(STEP));
    expect(view.seat('p1').actionReleased).toBe(true);
    expect(view.seat('p1').actionHeld).toBe(false);
  });

  it('reuses the same objects every step, so reading input never allocates', () => {
    const input = manager();
    const view = new InputView();

    view.sync(input.beginStep(STEP));
    const seat = view.seat('p1');
    const move = seat.move;

    input.pointerDown(1, 100, 900);
    view.sync(input.beginStep(STEP));
    const pointer = view.seat('p1').pointer;

    input.pointerMove(1, 120, 880);
    view.sync(input.beginStep(STEP));

    expect(view.seat('p1')).toBe(seat);
    expect(view.seat('p1').move).toBe(move);
    // Same vector instance, updated in place, rather than a fresh object per step.
    expect(view.seat('p1').pointer).toBe(pointer);
    expect(view.seat('p1').pointer?.x).toBe(onLattice(120));
  });

  it('returns itself from sync so it can be passed straight to a game', () => {
    const input = manager();
    const view = new InputView();
    expect(view.sync(input.beginStep(STEP))).toBe(view);
  });
});

/**
 * #2498. The view is the whole of what a game can see, so this is the surface the finger
 * count had to reach — carrying it on `SeatInputState` alone would have left it as invisible
 * to a game as `SeatSources.pointerCount` was.
 */
describe('the finger count through the view', () => {
  it('hands a game the count alongside the one position it gets', () => {
    const input = manager();
    const view = new InputView();
    // Five fingers on seat one's half, at five different places.
    for (let id = 1; id <= 5; id += 1) input.pointerDown(id, 80 + id * 60, 800);
    view.sync(input.beginStep(STEP));

    expect(view.seat('p1').pointerCount).toBe(5);
    // And still exactly one position — whichever finger was last to arrive. The count says
    // how many there are; it does not say where they are, and this is the assertion that
    // stops anyone reading it as though it did.
    expect(view.seat('p1').pointer?.x).toBe(onLattice(380));
    expect(view.seat('p2').pointerCount).toBe(0);
    expect(view.seat('p2').pointer).toBeNull();

    for (let id = 1; id <= 5; id += 1) input.pointerUp(id);
    view.sync(input.beginStep(STEP));
    expect(view.seat('p1').pointerCount).toBe(0);
  });

  it('agrees with the nullable pointer, which is the same fact told twice', () => {
    const input = manager();
    const view = new InputView();
    const agree = (label: string): void => {
      for (const seat of ['p1', 'p2'] as const) {
        const s = view.seat(seat);
        // `?? 0` is the documented read on the interface: the field is optional there so a
        // required one would not break the 27 hand-written doubles at once, and `InputView`
        // sets it on every sync, so the fallback is unreachable through the real engine.
        expect((s.pointerCount ?? 0) > 0, `${label}: ${seat}`).toBe(s.pointer !== null);
      }
    };

    view.sync(input.beginStep(STEP));
    agree('idle');
    input.pointerDown(1, 300, 800);
    input.pointerDown(2, 360, 800);
    view.sync(input.beginStep(STEP));
    agree('two fingers');
    input.pointerUp(1);
    view.sync(input.beginStep(STEP));
    agree('one lifted');
    input.pointerCancel(2);
    view.sync(input.beginStep(STEP));
    agree('the other cancelled');
    expect(view.seat('p1').pointerCancelled).toBe(true);
    expect(view.seat('p1').pointerCount).toBe(0);
  });
});
