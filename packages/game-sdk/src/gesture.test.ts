import { describe, expect, it } from 'vitest';
import { actionAbandoned } from './gesture.js';
import { InputManager, InputView } from '@duelbox/engine';
import { DragAim, HoldToAct, PressGesture } from './gesture.js';
import type { SeatInput } from './contract.js';

/**
 * A full `SeatInput`, defaulting to an idle seat, so each test states only the fields it
 * cares about. Mirrors the shape `InputView` produces.
 */
function seat(
  partial: Partial<SeatInput> & { pointer?: { x: number; y: number } | null },
): SeatInput {
  return {
    move: { x: 0, y: 0 },
    pointer: null,
    pointerCount: 0,
    actionPressed: false,
    actionHeld: false,
    actionReleased: false,
    holdSeconds: 0,
    holdSecondsAtRelease: 0,
    pointerCancelled: false,
    ...partial,
  };
}

const STEP = 1 / 60;

/** A press with its coordinates: down this step, held, pointer present. */
function press(x: number, y: number): SeatInput {
  return seat({ actionPressed: true, actionHeld: true, pointer: { x, y } });
}
/** A drag: still held, pointer present, no fresh press. */
function drag(x: number, y: number): SeatInput {
  return seat({ actionHeld: true, pointer: { x, y } });
}
/** A release: the pointer is gone by now, exactly as the engine reports it. */
function release(): SeatInput {
  return seat({ actionReleased: true, pointer: null });
}

describe('DragAim (#126)', () => {
  it('a press begins the aim and fires nothing', () => {
    const aim = new DragAim({ maxPower: 100, deadzone: 5 });
    aim.sample(press(50, 50));
    expect(aim.active).toBe(true);
    expect(aim.result.fired).toBe(false);
    expect(aim.result.cancelled).toBe(false);
    expect(aim.magnitude).toBe(0);
  });

  it('captures origin, vector and magnitude across a drag', () => {
    const aim = new DragAim({ maxPower: 100, deadzone: 5 });
    aim.sample(press(50, 50));
    aim.sample(drag(80, 90));
    expect(aim.originX).toBe(50);
    expect(aim.originY).toBe(50);
    expect(aim.vectorX).toBe(30);
    expect(aim.vectorY).toBe(40);
    expect(aim.magnitude).toBeCloseTo(50, 6);
    expect(aim.power).toBeCloseTo(50, 6);
  });

  it('fires on release with a unit direction and the carried power', () => {
    const aim = new DragAim({ maxPower: 100, deadzone: 5 });
    aim.sample(press(50, 50));
    aim.sample(drag(80, 90));
    // The pointer is null on the release step; the vector must come from what was carried.
    aim.sample(release());
    expect(aim.result.fired).toBe(true);
    expect(aim.result.cancelled).toBe(false);
    expect(aim.result.power).toBeCloseTo(50, 6);
    expect(aim.result.dirX).toBeCloseTo(0.6, 6);
    expect(aim.result.dirY).toBeCloseTo(0.8, 6);
    expect(aim.active).toBe(false);
  });

  it('clamps power to the configured maximum', () => {
    const aim = new DragAim({ maxPower: 10, deadzone: 5 });
    aim.sample(press(0, 0));
    aim.sample(drag(300, 0));
    expect(aim.magnitude).toBeCloseTo(300, 6);
    expect(aim.power).toBe(10);
    expect(aim.powerFraction).toBe(1);
    aim.sample(release());
    expect(aim.result.power).toBe(10);
    expect(aim.result.dirX).toBe(1);
  });

  it('cancels instead of firing when the release returns inside the deadzone', () => {
    const aim = new DragAim({ maxPower: 100, deadzone: 8 });
    aim.sample(press(50, 50));
    aim.sample(drag(90, 50)); // dragged out...
    aim.sample(drag(53, 51)); // ...then back inside the deadzone
    aim.sample(release());
    expect(aim.result.fired).toBe(false);
    expect(aim.result.cancelled).toBe(true);
  });

  it('abandons on a pointer cancel without firing', () => {
    const aim = new DragAim({ maxPower: 100, deadzone: 5 });
    aim.sample(press(50, 50));
    aim.sample(drag(120, 50));
    aim.sample(seat({ pointerCancelled: true, pointer: null }));
    expect(aim.result.fired).toBe(false);
    expect(aim.result.cancelled).toBe(true);
    expect(aim.active).toBe(false);
  });

  it('anchors to an object other than the press point when asked', () => {
    const aim = new DragAim({ maxPower: 100, deadzone: 5 });
    aim.sample(press(50, 50));
    aim.setAnchor(0, 0);
    expect(aim.originX).toBe(0);
    expect(aim.vectorX).toBe(50);
    expect(aim.vectorY).toBe(50);
    expect(aim.magnitude).toBeCloseTo(Math.hypot(50, 50), 6);
  });
});

describe('PressGesture (#127)', () => {
  it('classifies a same-step press-and-release as a tap', () => {
    const g = new PressGesture({ tapMaxSeconds: 0.2, chargeFullSeconds: 1 });
    // Press and release land on one step — the common touch case.
    g.sample(seat({ actionPressed: true, actionReleased: true, holdSecondsAtRelease: 0 }));
    expect(g.released).toBe(true);
    expect(g.kind).toBe('tap');
    expect(g.releaseSeconds).toBe(0);
  });

  it('classifies a short hold released before the tap threshold as a tap', () => {
    const g = new PressGesture({ tapMaxSeconds: 0.2, chargeFullSeconds: 1 });
    g.sample(press(0, 0));
    g.sample(seat({ actionReleased: true, holdSecondsAtRelease: 0.15 }));
    expect(g.kind).toBe('tap');
  });

  it('classifies a longer hold as a hold and ramps the charge', () => {
    const g = new PressGesture({ tapMaxSeconds: 0.2, chargeFullSeconds: 1 });
    g.sample(press(0, 0));
    g.sample(seat({ actionHeld: true, holdSeconds: 0.6 }));
    expect(g.held).toBe(true);
    // 0.6s is (0.6 - 0.2) / (1 - 0.2) = 0.5 of the way to a full charge.
    expect(g.charge).toBeCloseTo(0.5, 6);
    g.sample(seat({ actionReleased: true, holdSecondsAtRelease: 0.6 }));
    expect(g.kind).toBe('hold');
    expect(g.releaseSeconds).toBeCloseTo(0.6, 6);
  });

  it('classifies a saturated hold as a charge and clamps the fraction', () => {
    const g = new PressGesture({ tapMaxSeconds: 0.2, chargeFullSeconds: 1 });
    g.sample(press(0, 0));
    g.sample(seat({ actionHeld: true, holdSeconds: 1.5 }));
    expect(g.charge).toBe(1);
    g.sample(seat({ actionReleased: true, holdSecondsAtRelease: 1.5 }));
    expect(g.kind).toBe('charge');
  });

  it('abandons on cancel and reports no release', () => {
    const g = new PressGesture({ tapMaxSeconds: 0.2, chargeFullSeconds: 1 });
    g.sample(press(0, 0));
    g.sample(seat({ actionHeld: true, holdSeconds: 0.5 }));
    g.sample(seat({ pointerCancelled: true }));
    expect(g.released).toBe(false);
    expect(g.kind).toBeNull();
    expect(g.held).toBe(false);
  });
});

describe('HoldToAct (#1754)', () => {
  it('accumulates the hold to within one step of the true duration', () => {
    const g = new HoldToAct({ graceSeconds: 0 });
    for (let i = 0; i < 30; i += 1) g.sample(seat({ actionHeld: true }), STEP);
    expect(g.held).toBe(true);
    expect(g.holdSeconds).toBeCloseTo(30 * STEP, 6);
  });

  it('penalises only holds inside the constraint window and reports overHeld past the grace', () => {
    const g = new HoldToAct({ graceSeconds: 0.1 });
    // Ten steps outside the window: no penalty.
    for (let i = 0; i < 10; i += 1) g.sample(seat({ actionHeld: true }), STEP, false);
    expect(g.penaltySeconds).toBe(0);
    expect(g.overHeld).toBe(false);
    // Ten steps inside the window: penalty accrues past the 0.1s grace.
    for (let i = 0; i < 10; i += 1) g.sample(seat({ actionHeld: true }), STEP, true);
    expect(g.penaltySeconds).toBeCloseTo(10 * STEP, 6);
    expect(g.overHeld).toBe(true);
  });

  it('reports the total on the release step and then forgets it', () => {
    const g = new HoldToAct({ graceSeconds: 0 });
    for (let i = 0; i < 5; i += 1) g.sample(seat({ actionHeld: true }), STEP);
    g.sample(release(), STEP);
    expect(g.released).toBe(true);
    expect(g.releaseSeconds).toBeCloseTo(5 * STEP, 6);
    expect(g.held).toBe(false);
    // A quiet step later, the release is gone.
    g.sample(seat({}), STEP);
    expect(g.released).toBe(false);
    expect(g.holdSeconds).toBe(0);
  });

  it('resets its hold and penalty on a cancel', () => {
    const g = new HoldToAct({ graceSeconds: 0 });
    for (let i = 0; i < 5; i += 1) g.sample(seat({ actionHeld: true }), STEP, true);
    g.sample(seat({ pointerCancelled: true }), STEP);
    expect(g.held).toBe(false);
    expect(g.holdSeconds).toBe(0);
    expect(g.penaltySeconds).toBe(0);
    expect(g.released).toBe(false);
  });
});

const LOGICAL_ABANDON = { width: 600, height: 1000 };

function manager(): { input: InputManager; view: InputView } {
  return {
    input: new InputManager(LOGICAL_ABANDON, { split: 'shared', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

function p1(input: InputManager, view: InputView): SeatInput {
  return view.sync(input.beginStep(STEP)).seat('p1');
}

describe('actionAbandoned', () => {
  it('is true on the step a lone pointer is cancelled', () => {
    const { input, view } = manager();
    input.pointerDown(1, 300, 800);
    expect(actionAbandoned(p1(input, view)), 'a press is not an ending').toBe(false);

    input.pointerCancel(1);
    const seat = p1(input, view);
    expect(seat.pointerCancelled).toBe(true);
    expect(seat.actionReleased, 'a cancel is never a release').toBe(false);
    expect(actionAbandoned(seat)).toBe(true);
  });

  it('is false for exactly one step, like every other edge', () => {
    const { input, view } = manager();
    input.pointerDown(1, 300, 800);
    p1(input, view);
    input.pointerCancel(1);
    expect(actionAbandoned(p1(input, view))).toBe(true);
    expect(actionAbandoned(p1(input, view)), 'the bit does not linger').toBe(false);
  });

  it('is false when the player let go, which commits instead', () => {
    const { input, view } = manager();
    input.pointerDown(1, 300, 800);
    p1(input, view);
    input.pointerUp(1);
    const seat = p1(input, view);
    expect(seat.actionReleased).toBe(true);
    expect(actionAbandoned(seat), 'a release commits; it does not abandon').toBe(false);
  });

  it('is false while a second finger still holds the action', () => {
    // The engine raises `pointerCancelled` for any cancelled pointer, not only the last one
    // down — it cannot know which finger was driving the aim. The gesture is still live.
    const { input, view } = manager();
    input.pointerDown(1, 200, 800);
    input.pointerDown(2, 400, 800);
    p1(input, view);

    input.pointerCancel(1);
    const seat = p1(input, view);
    expect(seat.pointerCancelled).toBe(true);
    expect(seat.actionHeld, 'the other finger is still down').toBe(true);
    expect(actionAbandoned(seat), 'nothing ended, so nothing is abandoned').toBe(false);
  });

  it('is false while the action key still holds the action', () => {
    const { input, view } = manager();
    input.keyDown('Space');
    input.pointerDown(1, 300, 800);
    p1(input, view);

    input.pointerCancel(1);
    const seat = p1(input, view);
    expect(seat.pointerCancelled).toBe(true);
    expect(seat.actionHeld, 'the key was not cancelled').toBe(true);
    expect(actionAbandoned(seat)).toBe(false);

    // And once the key goes too, that is a release and not an abandonment.
    input.keyUp('Space');
    const after = p1(input, view);
    expect(after.actionReleased).toBe(true);
    expect(actionAbandoned(after)).toBe(false);
  });

  it('is true when the shell pauses on a held action key, with no pointer in sight', () => {
    // `InputManager.clear()` is what a pause does. A key held through it never receives its
    // key-up, so without a cancel the charge it built would freeze with no bit to read.
    const { input, view } = manager();
    input.keyDown('Space');
    for (let i = 0; i < 10; i += 1) p1(input, view);

    input.clear();
    const seat = p1(input, view);
    expect(seat.actionReleased, 'a pause must not synthesise a release').toBe(false);
    expect(actionAbandoned(seat), 'but it must say the gesture was taken').toBe(true);
  });
});
