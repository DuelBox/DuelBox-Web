import { describe, expect, it } from 'vitest';
import { SeatFlip } from './flip.js';

const STEP = 1 / 60;
const HALF_TURN = Math.PI;

/** Steps until settled, returning the angle seen on each step. */
function run(flip: SeatFlip, steps = 120): number[] {
  const angles: number[] = [];
  for (let i = 0; i < steps; i += 1) {
    flip.step(STEP);
    angles.push(flip.angle);
    if (!flip.isFlipping) break;
  }
  return angles;
}

describe('the settled state', () => {
  it('starts upright and stays there', () => {
    const flip = new SeatFlip();
    expect(flip.rotated).toBe(false);
    expect(flip.angle).toBe(0);
    expect(flip.isFlipping).toBe(false);
    run(flip, 10);
    expect(flip.angle).toBe(0);
  });

  it('can start rotated', () => {
    const flip = new SeatFlip({ rotated: true });
    expect(flip.rotated).toBe(true);
    expect(flip.angle).toBe(HALF_TURN);
  });

  it('ignores a retarget to the orientation it is already in', () => {
    const flip = new SeatFlip();
    flip.retarget(false);
    expect(flip.isFlipping).toBe(false);
    expect(flip.angle).toBe(0);
  });
});

describe('the flip itself', () => {
  it('travels the whole half turn and lands exactly on it', () => {
    const flip = new SeatFlip();
    flip.retarget(true);
    expect(flip.isFlipping).toBe(true);
    const angles = run(flip);
    expect(flip.isFlipping).toBe(false);
    expect(flip.rotated).toBe(true);
    expect(flip.angle).toBe(HALF_TURN);
    expect(angles[0]).toBeGreaterThan(0);
  });

  it('never runs backwards or overshoots', () => {
    const flip = new SeatFlip();
    flip.retarget(true);
    const angles = run(flip);
    for (let i = 1; i < angles.length; i += 1) {
      expect(angles[i]).toBeGreaterThanOrEqual(angles[i - 1] as number);
    }
    for (const angle of angles) {
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThanOrEqual(HALF_TURN);
    }
  });

  it('is a mirror image in the other direction', () => {
    const out = new SeatFlip();
    out.retarget(true);
    const forwards = run(out);

    const back = new SeatFlip({ rotated: true });
    back.retarget(false);
    const backwards = run(back);

    expect(backwards.length).toBe(forwards.length);
    for (let i = 0; i < forwards.length; i += 1) {
      // A flip and its reverse take the same path, not one of them the long way round.
      expect(backwards[i] as number).toBeCloseTo(HALF_TURN - (forwards[i] as number), 10);
    }
  });

  it('eases at both ends rather than starting and stopping dead', () => {
    const flip = new SeatFlip({ durationSeconds: 1 });
    flip.retarget(true);
    flip.step(0.05);
    const early = flip.angle;
    flip.snap(false);
    flip.retarget(true);
    flip.step(0.5);
    const middle = flip.angle;
    // A linear tween would put 5% of the time at 5% of the angle; an eased one is far
    // behind at the start and exactly half way at the midpoint.
    expect(early).toBeLessThan(HALF_TURN * 0.05);
    expect(middle).toBeCloseTo(HALF_TURN / 2, 6);
  });

  it('takes the configured duration', () => {
    const flip = new SeatFlip({ durationSeconds: 0.5 });
    flip.retarget(true);
    let steps = 0;
    while (flip.isFlipping && steps < 1000) {
      flip.step(STEP);
      steps += 1;
    }
    expect(steps * STEP).toBeCloseTo(0.5, 1);
  });
});

describe('input ownership', () => {
  it('holds the old mapping for the whole flip and changes exactly once', () => {
    const flip = new SeatFlip();
    flip.retarget(true);
    const seen: boolean[] = [];
    while (flip.isFlipping) {
      seen.push(flip.rotated);
      flip.step(STEP);
    }
    seen.push(flip.rotated);
    // Every reading before the last is the old orientation; the last is the new one.
    const changes = seen.filter((value, i) => i > 0 && value !== seen[i - 1]).length;
    expect(changes).toBe(1);
    expect(seen[0]).toBe(false);
    expect(seen[seen.length - 1]).toBe(true);
  });

  it('refuses input for the whole flip and resumes the instant it settles', () => {
    const flip = new SeatFlip();
    expect(flip.acceptsInput).toBe(true);
    flip.retarget(true);
    while (flip.isFlipping) {
      expect(flip.acceptsInput).toBe(false);
      flip.step(STEP);
    }
    expect(flip.acceptsInput).toBe(true);
  });

  it('never maps input to a seat while the board is part-way round', () => {
    // The property that matters: whenever input is accepted, the board is square on.
    const flip = new SeatFlip();
    flip.retarget(true);
    for (let i = 0; i < 200; i += 1) {
      if (flip.acceptsInput) {
        expect(flip.angle === 0 || flip.angle === HALF_TURN).toBe(true);
      }
      flip.step(STEP);
    }
  });
});

describe('reduced motion is drawn here and stepped nowhere', () => {
  it('sweeps whatever the player has asked their system for, because this class is never told', () => {
    // A guard on a decision rather than on a behaviour, and it is here because the other
    // answer was written, reviewed and taken out again. A switch on this class can only be
    // adopted game by game, and a catalogue part way through that adoption draws one
    // preference two ways: a flip that held its settled orientation would cut on the step
    // it settles, while `Canvas2DRenderer.setReducedMotion` cuts at the midpoint of the
    // sweep. Four games had the switch and forty-one did not, so the same player saw the
    // board change hands at two different moments in an otherwise identical turn — and a
    // game is handed its context once, so the four could not hear the preference being
    // turned back off.
    const flip = new SeatFlip();
    expect(
      'setReducedMotion' in flip,
      'the preference belongs to the renderer, which reaches every board without an edit',
    ).toBe(false);

    flip.retarget(true);
    for (let i = 0; i < 10; i += 1) flip.step(STEP);
    // Unconditional, which is what leaves the renderer something to snap.
    expect(flip.angle).toBeGreaterThan(0);
    expect(flip.angle).toBeLessThan(HALF_TURN);
  });
});

describe('why reduced motion is never a zero duration', () => {
  it('a zero-duration flip reopens input on a step a tweened one refuses it', () => {
    // Written down as a test because it is the mistake the feature invites, and it is
    // invisible until two devices disagree about a match: forty-two of the forty-five
    // games that own a flip gate their `update()` on `acceptsInput`, so the flip's
    // duration is a simulation value and only its angle is a picture.
    const tweened = new SeatFlip();
    const instant = new SeatFlip({ durationSeconds: 0 });
    tweened.retarget(true);
    instant.retarget(true);
    expect(tweened.acceptsInput).toBe(false);
    expect(instant.acceptsInput).toBe(true);

    // Twenty-two steps of 1/60 s cover the default 0.36 s; input reopens on the last.
    for (let i = 0; i < 21; i += 1) {
      expect(tweened.acceptsInput, `step ${String(i)}`).toBe(false);
      tweened.step(STEP);
    }
    expect(tweened.acceptsInput).toBe(false);
    tweened.step(STEP);
    expect(tweened.acceptsInput).toBe(true);
  });
});

describe('instant flips and resets', () => {
  it('swaps instantly at zero duration, with no frame in between', () => {
    const flip = new SeatFlip({ durationSeconds: 0 });
    flip.retarget(true);
    expect(flip.isFlipping).toBe(false);
    expect(flip.rotated).toBe(true);
    expect(flip.angle).toBe(HALF_TURN);
    expect(flip.acceptsInput).toBe(true);
  });

  it('snaps out of a running flip', () => {
    const flip = new SeatFlip();
    flip.retarget(true);
    flip.step(STEP);
    flip.snap(false);
    expect(flip.isFlipping).toBe(false);
    expect(flip.angle).toBe(0);
    expect(flip.acceptsInput).toBe(true);
  });

  it('cancels back to where it started when the turn is taken back', () => {
    const flip = new SeatFlip();
    flip.retarget(true);
    flip.step(STEP);
    flip.retarget(false);
    expect(flip.isFlipping).toBe(false);
    expect(flip.rotated).toBe(false);
    expect(flip.angle).toBe(0);
  });
});

describe('determinism', () => {
  it('produces the same angles for the same steps', () => {
    const a = new SeatFlip();
    const b = new SeatFlip();
    a.retarget(true);
    b.retarget(true);
    expect(run(a)).toEqual(run(b));
  });

  it('does not read the wall clock: the same total time in different step sizes agrees', () => {
    const coarse = new SeatFlip({ durationSeconds: 1 });
    coarse.retarget(true);
    coarse.step(0.5);

    const fine = new SeatFlip({ durationSeconds: 1 });
    fine.retarget(true);
    for (let i = 0; i < 50; i += 1) fine.step(0.01);

    expect(fine.angle).toBeCloseTo(coarse.angle, 10);
  });

  it('rejects a negative duration and a negative step', () => {
    expect(() => new SeatFlip({ durationSeconds: -1 })).toThrow(RangeError);
    const flip = new SeatFlip();
    flip.retarget(true);
    expect(() => {
      flip.step(-1);
    }).toThrow(RangeError);
  });
});
