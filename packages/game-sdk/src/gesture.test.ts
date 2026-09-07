import { describe, expect, it } from 'vitest';
import { InputManager, InputView } from '@duelbox/engine';
import { actionAbandoned } from './gesture.js';
import type { SeatInput } from './contract.js';

const STEP = 1 / 60;
const LOGICAL = { width: 600, height: 1000 };

function manager(): { input: InputManager; view: InputView } {
  return {
    input: new InputManager(LOGICAL, { split: 'shared', bottomSeat: 'p1' }),
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
