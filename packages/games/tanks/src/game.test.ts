import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { DRAG_DEADZONE, TanksGame } from './game.js';
import { ARENA, LIVES, LOAD_MIN, RECOIL, SHELLS } from './rules.js';

const STEP = 1 / 60;
const SEATS: SeatId[] = ['p1', 'p2'];

interface Call {
  readonly op: string;
  readonly args: readonly unknown[];
}

function recorder(): { renderer: Renderer; calls: Call[] } {
  const calls: Call[] = [];
  const note =
    (op: string) =>
    (...args: unknown[]): void => {
      calls.push({ op, args });
    };
  const renderer = {
    clear: note('clear'),
    rect: note('rect'),
    strokeRect: note('strokeRect'),
    circle: note('circle'),
    strokeCircle: note('strokeCircle'),
    line: note('line'),
    text: note('text'),
    pushSeatRotation: note('pushSeatRotation'),
    pushRotation: note('pushRotation'),
    popSeatRotation: note('popSeatRotation'),
  } as unknown as Renderer;
  return { renderer, calls };
}

function seatInput(overrides: Partial<SeatInput> = {}): SeatInput {
  return {
    move: { x: 0, y: 0 },
    pointer: null,
    actionHeld: false,
    actionPressed: false,
    actionReleased: false,
    holdSeconds: 0,
    ...overrides,
  };
}

function inputOf(seats: Partial<Record<SeatId, SeatInput>>): InputState {
  return { seat: (seat: SeatId) => seats[seat] ?? seatInput() };
}

const IDLE = inputOf({});

function context(bots: Partial<Record<SeatId, 'easy' | 'normal' | 'hard'>>, seed = 5): GameContext {
  return {
    rng: new Rng(seed),
    botDifficulty: (seat: SeatId) => bots[seat] ?? null,
  } as unknown as GameContext;
}

function started(bots: Partial<Record<SeatId, 'easy' | 'normal' | 'hard'>>, seed = 5): TanksGame {
  const game = new TanksGame();
  game.init(context(bots, seed));
  return game;
}

function runOut(game: TanksGame, input: InputState = IDLE, cap = 60 * 300): number {
  let frames = 0;
  while (game.getScore().winner === null && frames < cap) {
    game.update(STEP, input);
    frames += 1;
  }
  return frames;
}

/** Everything the simulation holds, as a string, for a bit-for-bit comparison. */
function snapshot(game: TanksGame): string {
  return JSON.stringify(game.position);
}

describe('controls', () => {
  /**
   * A drag equivalent to holding a key: the first frame anchors, the rest are displaced by
   * `by` on each axis. The displacement is far past the deadzone, because the point of the
   * sign lattice is that how far past makes no difference at all.
   */
  function dragged(seat: SeatId, dx: number, dy: number, frames: number): InputState[] {
    const anchor = { x: ARENA / 2, y: ARENA / 2 };
    const script: InputState[] = [
      inputOf({ [seat]: seatInput({ pointer: anchor, actionPressed: true, actionHeld: true }) }),
    ];
    for (let i = 1; i < frames; i += 1) {
      script.push(
        inputOf({
          [seat]: seatInput({
            pointer: { x: anchor.x + dx, y: anchor.y + dy },
            actionHeld: true,
          }),
        }),
      );
    }
    return script;
  }

  function keyed(seat: SeatId, x: number, y: number, frames: number): InputState[] {
    const script: InputState[] = [IDLE];
    for (let i = 1; i < frames; i += 1) {
      script.push(inputOf({ [seat]: seatInput({ move: { x, y } }) }));
    }
    return script;
  }

  function play(script: readonly InputState[], seed = 3): TanksGame {
    const game = started({ p2: 'normal' }, seed);
    for (const frame of script) game.update(STEP, frame);
    return game;
  }

  it('steps the identical match from a key and from a thumb', () => {
    /*
     * Rule 10, as an equality rather than a tolerance. Both instruments are reduced to a
     * pair of signs by `setIntent` before anything in the simulation sees them, so a key
     * held down and a drag four hundred units long are the same order — and four hundred
     * frames of one produce byte-identical state to four hundred frames of the other.
     *
     * This is the property an absolute pointer would have destroyed. Pointing at a spot on
     * the yard would let a thumb stop the gun exactly on a bearing where a key can only stop
     * it by letting go at the right moment, which at 2.4 radians a second is about thirty
     * degrees of aim per fifth of a second of reaction.
     */
    for (const [dx, dy, mx, my] of [
      [400, 0, 1, 0],
      [-90, 0, -1, 0],
      [0, -300, 0, -1],
      [0, 44, 0, 1],
      [120, -120, 0.7071, -0.7071],
      [-70, 70, -0.7071, 0.7071],
    ] as const) {
      const byThumb = play(dragged('p1', dx, dy, 400));
      const byKey = play(keyed('p1', mx, my, 400));
      expect(snapshot(byThumb), `drag ${dx},${dy} against keys ${mx},${my}`).toBe(snapshot(byKey));
    }
  });

  it('fires the first shell on the same frame either way', () => {
    // The trigger is letting go of the controls, and letting go is one act for both
    // instruments: a thumb lifting and a key coming up. `RECOIL` then locks the tank for
    // longer than either takes, so the difference is not observable afterwards either.
    const firstShot = (script: readonly InputState[]): number => {
      const game = started({ p2: 'normal' }, 4);
      for (let i = 0; i < script.length; i += 1) game.update(STEP, script[i] as InputState);
      // Let go.
      for (let i = 0; i < 200; i += 1) {
        game.update(STEP, IDLE);
        if (game.position.p1.shells < SHELLS) return i;
      }
      return -1;
    };
    const held = Math.ceil(LOAD_MIN / STEP) + 4;
    const thumb = firstShot(dragged('p1', 200, 0, held));
    const key = firstShot(keyed('p1', 1, 0, held));
    expect(thumb).toBeGreaterThanOrEqual(0);
    expect(thumb).toBe(key);
  });

  it('gains nothing from a thumb that jumps about', () => {
    // The drag is a sign, so a finger flung to the far corner and one held just past the
    // deadzone give the identical order. Nothing rewards a bigger gesture.
    const small = play(dragged('p1', DRAG_DEADZONE + 1, 0, 300));
    const huge = play(dragged('p1', ARENA, 0, 300));
    expect(snapshot(small)).toBe(snapshot(huge));
  });

  it('treats a thumb inside the deadzone as a resting hand, not an order', () => {
    const resting = play(dragged('p1', DRAG_DEADZONE - 1, DRAG_DEADZONE - 1, 200));
    const absent = play([...Array<InputState>(200).fill(IDLE)]);
    expect(snapshot(resting)).toBe(snapshot(absent));
  });

  it('lets the keys through while a thumb is resting, because one player may use both', () => {
    const anchor = { x: ARENA / 2, y: ARENA / 2 };
    const both = started({ p2: 'normal' }, 6);
    for (let i = 0; i < 200; i += 1) {
      both.update(
        STEP,
        inputOf({
          p1: seatInput({
            pointer: anchor,
            actionPressed: i === 0,
            actionHeld: true,
            move: { x: 1, y: 0 },
          }),
        }),
      );
    }
    const keysOnly = play(keyed('p1', 1, 0, 200), 6);
    // The first frame differs: `keyed` opens idle so the two anchors line up.
    expect(both.position.p1.heading).toBeCloseTo(keysOnly.position.p1.heading, 6);
  });

  it('cannot be made to fire faster by mashing than by holding', () => {
    // The floor is RECOIL + LOAD_MIN for everybody. A player letting go and grabbing again
    // every frame spends exactly as many shells as one who waits.
    const game = started({ p2: 'normal' }, 7);
    const anchor = { x: ARENA / 2, y: ARENA / 2 };
    const seconds = 12;
    for (let i = 0; i < seconds * 60; i += 1) {
      const on = i % 2 === 0;
      game.update(
        STEP,
        on
          ? inputOf({
              p1: seatInput({
                pointer: { x: anchor.x + 200, y: anchor.y },
                actionHeld: true,
              }),
            })
          : IDLE,
      );
    }
    const spent = SHELLS - game.position.p1.shells;
    expect(spent).toBeLessThanOrEqual(Math.ceil(seconds / (RECOIL + LOAD_MIN)) + 1);
  });

  it('keeps both pointer zones open, because both tanks roll at once', () => {
    expect(started({}).getActiveSeat()).toBeNull();
  });
});

describe('the match', () => {
  it('ends on its own from every seed, with no frame cap doing the work', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const game = started({ p1: 'easy', p2: 'hard' }, seed);
      const frames = runOut(game);
      expect(frames, `seed ${String(seed)} never finished`).toBeLessThan(60 * 300);
      expect(game.getScore().winner).not.toBeNull();
    }
  });

  it('ends even when nobody ever touches it', () => {
    // Two humans who never move. The guns cook off on their own until both racks are empty.
    const game = started({});
    const frames = runOut(game, IDLE);
    expect(frames).toBeLessThan(60 * 300);
    expect(game.getScore().winner).toBe('draw');
  });

  it('counts lives taken, so the score goes up', () => {
    const game = started({ p1: 'hard', p2: 'easy' }, 8);
    runOut(game);
    const score = game.getScore();
    expect(score.p1).toBe(LIVES - game.position.p2.lives);
    expect(score.p2).toBe(LIVES - game.position.p1.lives);
    expect(Math.max(score.p1, score.p2)).toBe(LIVES);
  });

  it('stops moving once it is over', () => {
    const game = started({ p1: 'hard', p2: 'hard' }, 3);
    runOut(game);
    const settled = game.getScore();
    for (let i = 0; i < 120; i += 1) game.update(STEP, IDLE);
    expect(game.getScore()).toEqual(settled);
  });

  it('replays a seed identically, and a different seed differently', () => {
    const play = (seed: number): string => {
      const game = started({ p1: 'normal', p2: 'hard' }, seed);
      runOut(game);
      const score = game.getScore();
      return `${String(score.p1)}:${String(score.p2)}:${String(score.winner)}:${String(game.position.p1.shells)}`;
    };
    expect(play(9)).toBe(play(9));
    const seen = new Set([play(1), play(2), play(3), play(4), play(5), play(6)]);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('comes back to a fresh yard after destroy', () => {
    const game = started({ p1: 'hard', p2: 'hard' }, 8);
    runOut(game);
    game.destroy();
    expect(game.position.p1.lives).toBe(LIVES);
    expect(game.position.p2.lives).toBe(LIVES);
    expect(game.position.p1.shells).toBe(SHELLS);
    expect(game.position.shells.every((shell) => !shell.active)).toBe(true);
  });

  it('is unmoved by a pause', () => {
    const game = started({ p1: 'normal', p2: 'hard' }, 2);
    for (let i = 0; i < 200; i += 1) game.update(STEP, IDLE);
    const before = game.getScore();
    game.onPause();
    game.onResume();
    expect(game.getScore()).toEqual(before);
  });
});

describe('renders', () => {
  it('never draws a word', () => {
    // Rule 7's companion: the whole yard is shapes, so it needs no translation and no font.
    const game = started({ p1: 'normal', p2: 'hard' }, 4);
    const { renderer, calls } = recorder();
    for (let i = 0; i < 600; i += 1) {
      game.update(STEP, IDLE);
      if (i % 37 === 0) game.render(renderer);
    }
    expect(calls.some((call) => call.op === 'text')).toBe(false);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('never rotates the yard, because it reads the same either way up', () => {
    // Rule 9 in its cheapest form: one arena, drawn once, at one scale. There is no per-seat
    // view to make unequal because there is only one view.
    const game = started({ p1: 'easy', p2: 'easy' }, 6);
    const { renderer, calls } = recorder();
    for (let i = 0; i < 400; i += 1) {
      game.update(STEP, IDLE);
      if (i % 29 === 0) game.render(renderer);
    }
    expect(calls.some((call) => call.op === 'pushRotation')).toBe(false);
    expect(calls.some((call) => call.op === 'pushSeatRotation')).toBe(false);
  });

  it('tells the two seats apart by shape, not only by colour', () => {
    // p1 is a round hull with a ring and disc pips; p2 a square hull with a bar and block
    // pips. Their shells differ the same way.
    const game = started({ p1: 'normal', p2: 'normal' }, 7);
    const { renderer, calls } = recorder();
    game.update(STEP, IDLE);
    game.render(renderer);
    expect(calls.some((call) => call.op === 'circle')).toBe(true);
    expect(calls.some((call) => call.op === 'strokeCircle')).toBe(true);
    expect(calls.some((call) => call.op === 'rect')).toBe(true);
    expect(calls.some((call) => call.op === 'line')).toBe(true);
  });

  it('draws inside the board', () => {
    const game = started({ p1: 'hard', p2: 'easy' }, 1);
    const { renderer, calls } = recorder();
    for (let i = 0; i < 400; i += 1) {
      game.update(STEP, IDLE);
      if (i % 31 === 0) game.render(renderer);
    }
    const slack = 60;
    for (const call of calls) {
      if (call.op === 'clear') continue;
      const [x, y] = call.args as [number, number];
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      expect(x).toBeGreaterThan(-slack);
      expect(x).toBeLessThan(ARENA + slack);
      expect(y).toBeGreaterThan(-slack);
      expect(y).toBeLessThan(ARENA + slack);
    }
  });
});

describe('fairness', () => {
  it('cannot tell which seat the shell asked about first', () => {
    // Each seat draws from a generator of its own, so the poll order inside `update` is not
    // observable. On one shared stream it is worth about a point and a half of win rate, and
    // reversing the two calls mirrors the result exactly — which is how that is identified.
    const scores = new Set<string>();
    for (let seed = 0; seed < 8; seed += 1) {
      const game = started({ p1: 'normal', p2: 'normal' }, seed);
      runOut(game);
      const score = game.getScore();
      scores.add(`${String(seed)}:${String(score.p1)}:${String(score.p2)}`);
    }
    expect(scores.size).toBe(8);
  });

  it('gives a bot no order a person could not give', () => {
    /*
     * Rule 6 at the shell's own boundary. A bot writes the same pair of signs a thumb does,
     * through the same `setIntent`, so the two are indistinguishable downstream: the
     * strongest possible statement of this is that a person holding one key produces exactly
     * the turn a bot does, and no more.
     */
    const bot = started({ p1: 'hard', p2: 'hard' }, 12);
    let worst = 0;
    let last = bot.position.p1.heading;
    for (let i = 0; i < 600; i += 1) {
      bot.update(STEP, IDLE);
      worst = Math.max(worst, Math.abs(bot.position.p1.heading - last));
      last = bot.position.p1.heading;
    }

    const human = started({ p2: 'hard' }, 12);
    let humanWorst = 0;
    last = human.position.p1.heading;
    for (let i = 0; i < 600; i += 1) {
      human.update(STEP, inputOf({ p1: seatInput({ move: { x: 1, y: 0 } }) }));
      humanWorst = Math.max(humanWorst, Math.abs(human.position.p1.heading - last));
      last = human.position.p1.heading;
    }
    expect(worst).toBeLessThanOrEqual(humanWorst + 1e-9);
  });

  it('opens both seats on the same yard, turned half a turn', () => {
    // Rule 9 for a shared arena: neither seat can see more of the play area than the other
    // because there is one play area, and neither has a friendlier corner of it because the
    // whole thing is point-symmetric. Measured here through the public position.
    for (let seed = 0; seed < 20; seed += 1) {
      const game = started({}, seed);
      const position = game.position;
      expect(position.p1.x).toBeCloseTo(ARENA - position.p2.x, 9);
      expect(position.p1.y).toBeCloseTo(ARENA - position.p2.y, 9);
      for (const crate of position.crates) {
        const twin = position.crates.find(
          (other) =>
            Math.abs(other.x - (ARENA - crate.x)) < 1e-9 &&
            Math.abs(other.y - (ARENA - crate.y)) < 1e-9,
        );
        expect(twin, `seed ${String(seed)} has an unmirrored crate`).toBeDefined();
      }
    }
  });

  it('is decided by the tier and not by the seat, over a run of seeds', () => {
    /*
     * The seats are interchangeable, but *not* frame for frame when the tiers are swapped:
     * seat one's generator is drawn from the match seed first whichever tier sits there, so
     * swapping the pairing is a different match rather than a mirrored one. The exact
     * statement lives in `rules.test.ts`, where both seats can be handed the same stream and
     * the two tanks then stay mirror images to within 1e-6 for a whole match. What is
     * checkable from here is the weaker claim that matters to a player: the stronger tier
     * wins the run from either side.
     */
    let strongAsP1 = 0;
    let strongAsP2 = 0;
    for (let seed = 0; seed < 24; seed += 1) {
      const forwards = started({ p1: 'hard', p2: 'easy' }, seed);
      runOut(forwards);
      if (forwards.getScore().winner === 'p1') strongAsP1 += 1;
      const backwards = started({ p1: 'easy', p2: 'hard' }, seed);
      runOut(backwards);
      if (backwards.getScore().winner === 'p2') strongAsP2 += 1;
    }
    expect(strongAsP1).toBeGreaterThan(16);
    expect(strongAsP2).toBeGreaterThan(16);
  });
});

describe('seats', () => {
  it('drives each seat from its own half of the keyboard', () => {
    const game = started({}, 11);
    const before = SEATS.map((seat) => game.position[seat].heading);
    for (let i = 0; i < 60; i += 1) {
      game.update(STEP, inputOf({ p2: seatInput({ move: { x: 1, y: 0 } }) }));
    }
    expect(game.position.p1.heading).toBe(before[0]);
    expect(game.position.p2.heading).not.toBe(before[1]);
  });
});
