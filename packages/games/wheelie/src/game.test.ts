import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  LANE_HEIGHT,
  LANE_WIDTH,
  WheelieGame,
  leanForPointer,
  toBoard,
  toLane,
} from './game.js';
import { COURSE_LENGTH, LEAN_RATE, SECTORS } from './rules.js';

const STEP = 1 / 60;

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
    holdSecondsAtRelease: 0,
    pointerCancelled: false,
    ...overrides,
  };
}

function inputOf(seats: Partial<Record<SeatId, SeatInput>>): InputState {
  return { seat: (seat: SeatId) => seats[seat] ?? seatInput() };
}

const IDLE = inputOf({});
/** Seat one leaning back on the keys, and seat one putting the wheel down. */
const LEAN_BACK = inputOf({ p1: seatInput({ move: { x: 0, y: -1 } }) });
const LEAN_DOWN = inputOf({ p1: seatInput({ move: { x: 0, y: 1 } }) });

function context(bots: Partial<Record<SeatId, 'easy' | 'normal' | 'hard'>>, seed = 5): GameContext {
  return {
    rng: new Rng(seed),
    botDifficulty: (seat: SeatId) => bots[seat] ?? null,
  } as unknown as GameContext;
}

function started(bots: Partial<Record<SeatId, 'easy' | 'normal' | 'hard'>>, seed = 5): WheelieGame {
  const game = new WheelieGame();
  game.init(context(bots, seed));
  return game;
}

/** Play to the end. No frame cap: this is what proves there is one in the rules. */
function runOut(game: WheelieGame, input: InputState = IDLE): number {
  let frames = 0;
  while (game.getScore().winner === null) {
    game.update(STEP, input);
    frames += 1;
    if (frames > 60 * 3000) throw new Error('never finished');
  }
  return frames;
}

describe('layout', () => {
  it('places both lanes inside the board and nowhere near each other', () => {
    const near = { x: 0, y: 0 };
    const far = { x: 0, y: 0 };
    for (const [x, y] of [
      [0, 0],
      [LANE_WIDTH, 0],
      [0, LANE_HEIGHT],
      [LANE_WIDTH, LANE_HEIGHT],
    ] as const) {
      toBoard('p1', x, y, near);
      toBoard('p2', x, y, far);
      for (const point of [near, far]) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(BOARD_WIDTH);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(BOARD_HEIGHT);
      }
      expect(near.y).toBeGreaterThan(BOARD_HEIGHT / 2 - 1);
      expect(far.y).toBeLessThan(BOARD_HEIGHT / 2 + 1);
    }
  });

  it('reads a board point back to the lane it came from', () => {
    const board = { x: 0, y: 0 };
    const back = { x: 0, y: 0 };
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      for (const [x, y] of [
        [17, 33],
        [LANE_WIDTH - 5, LANE_HEIGHT - 11],
        [LANE_WIDTH / 2, LANE_HEIGHT / 2],
      ] as const) {
        toBoard(seat, x, y, board);
        toLane(seat, board.x, board.y, back);
        expect(back.x).toBeCloseTo(x, 6);
        expect(back.y).toBeCloseTo(y, 6);
      }
    }
  });

  it('turns the far lane half a turn, so neither player reads an upside-down bike', () => {
    // The lane is placed twice rather than drawn once and spun, which is why `render` never
    // pushes a rotation — see the `renders` block below.
    const near = { x: 0, y: 0 };
    const far = { x: 0, y: 0 };
    toBoard('p1', 10, 20, near);
    toBoard('p2', 10, 20, far);
    expect(near.x).toBeCloseTo(10, 6);
    expect(far.x).toBeCloseTo(LANE_WIDTH - 10, 6);
  });

  it('gives both seats exactly the same lane, so neither sees more course', () => {
    // Rule 9. Two lanes of the same size, and the same course units drawn across each.
    const nearTop = { x: 0, y: 0 };
    const nearBottom = { x: 0, y: 0 };
    const farTop = { x: 0, y: 0 };
    const farBottom = { x: 0, y: 0 };
    toBoard('p1', 0, 0, nearTop);
    toBoard('p1', LANE_WIDTH, LANE_HEIGHT, nearBottom);
    toBoard('p2', 0, 0, farTop);
    toBoard('p2', LANE_WIDTH, LANE_HEIGHT, farBottom);
    expect(Math.abs(nearBottom.x - nearTop.x)).toBeCloseTo(Math.abs(farBottom.x - farTop.x), 6);
    expect(Math.abs(nearBottom.y - nearTop.y)).toBeCloseTo(Math.abs(farBottom.y - farTop.y), 6);
  });
});

describe('controls', () => {
  it('reads a thumb up the lane as leaning back and one on the ground as putting it down', () => {
    expect(leanForPointer(0)).toBe(1);
    expect(leanForPointer(9999)).toBe(0);
    expect(leanForPointer(-9999)).toBe(1);
    expect(leanForPointer(100)).toBeGreaterThan(leanForPointer(200));
  });

  it('gives a key and a thumb the same reach in a second', () => {
    // Rule 10. The pointer sets a level and the keys give a direction, but both arrive at
    // `driveLean`, which caps them at the same rate — so neither instrument can shift the
    // rider's weight faster than the other.
    const byThumb = started({ p2: 'normal' });
    const board = { x: 0, y: 0 };
    toBoard('p1', 200, 0, board);
    const thumb = inputOf({ p1: seatInput({ pointer: { x: board.x, y: board.y } }) });
    for (let i = 0; i < 12; i += 1) byThumb.update(STEP, thumb);

    const byKey = started({ p2: 'normal' });
    for (let i = 0; i < 12; i += 1) byKey.update(STEP, LEAN_BACK);

    expect(byThumb.position.p1.lean).toBeCloseTo(byKey.position.p1.lean, 9);
    expect(byKey.position.p1.lean).toBeCloseTo(LEAN_RATE * STEP * 12, 6);
  });

  it('holds the lean when the keys are let go, because holding one is the game', () => {
    const game = started({ p2: 'normal' });
    for (let i = 0; i < 12; i += 1) game.update(STEP, LEAN_BACK);
    const held = game.position.p1.lean;
    for (let i = 0; i < 30; i += 1) game.update(STEP, IDLE);
    expect(game.position.p1.lean).toBe(held);
  });

  it('brings the lean back down on the other key', () => {
    const game = started({ p2: 'normal' });
    for (let i = 0; i < 20; i += 1) game.update(STEP, LEAN_BACK);
    const back = game.position.p1.lean;
    for (let i = 0; i < 10; i += 1) game.update(STEP, LEAN_DOWN);
    expect(game.position.p1.lean).toBeLessThan(back);
  });

  it('does nothing when a seat asks for both directions at once', () => {
    // Two keys down together, which a keyboard will happily report. Neither wins, which is
    // the same answer as neither key: the lean stays where the rider left it.
    const game = started({ p2: 'normal' });
    for (let i = 0; i < 12; i += 1) game.update(STEP, LEAN_BACK);
    const held = game.position.p1.lean;
    const conflicting = inputOf({
      p1: seatInput({ move: { x: 0, y: 1 }, actionHeld: true }),
    });
    for (let i = 0; i < 12; i += 1) game.update(STEP, conflicting);
    expect(game.position.p1.lean).toBe(held);
  });

  it('takes the action as a lean back, so one button is enough to get it up', () => {
    const game = started({ p2: 'normal' });
    for (let i = 0; i < 12; i += 1)
      game.update(STEP, inputOf({ p1: seatInput({ actionHeld: true }) }));
    expect(game.position.p1.lean).toBeCloseTo(LEAN_RATE * STEP * 12, 6);
  });
});

describe('mashing', () => {
  it('never reaches a lean a held key has not already passed through', () => {
    // Rule 10's real content. The control is a level moved at a fixed rate, so mashing can
    // only ask for the same thing less often — it arrives later and never sooner.
    const held = started({ p2: 'normal' });
    const mashed = started({ p2: 'normal' });
    for (let i = 0; i < 10; i += 1) {
      held.update(STEP, LEAN_BACK);
      mashed.update(STEP, i % 2 === 0 ? LEAN_BACK : IDLE);
    }
    expect(mashed.position.p1.lean).toBeLessThan(held.position.p1.lean);
  });

  it('buys nothing over simply letting go, which is the trap this avoids', () => {
    // The version of mashing that would actually be worth doing: flicking up and down to
    // *hold* a level the keys supposedly cannot. They can — releasing holds it — so the
    // two land in the same place, and there is no rate for a faster thumb to win with.
    const released = started({ p2: 'normal' });
    const flicked = started({ p2: 'normal' });
    for (let i = 0; i < 16; i += 1) {
      released.update(STEP, LEAN_BACK);
      flicked.update(STEP, LEAN_BACK);
    }
    for (let i = 0; i < 60; i += 1) {
      released.update(STEP, IDLE);
      flicked.update(STEP, i % 2 === 0 ? LEAN_BACK : LEAN_DOWN);
    }
    expect(flicked.position.p1.lean).toBeCloseTo(released.position.p1.lean, 9);
  });

  it('is behind a held key on every frame the two are comparable', () => {
    /*
     * The strict form of the claim, and deliberately about the *lean* rather than the
     * distance.
     *
     * Distance is not monotone in lean — leaning harder past the balance point is how you
     * lose — so "the masher covered less ground" would be neither a fact nor evidence. It
     * measured 0.17 % *more* ground over eight seeds when it was tried, which is where the
     * flip cycle happened to land and nothing to do with the input. What is true, and true
     * on every frame, is that mashing asks for the same thing less often and so is never
     * further along: whatever a mashed key reaches, a held one reached first.
     *
     * The comparison stops at the first fall on purpose. Going over resets the rider's
     * weight to nothing, so after one of them falls the two are no longer answering the
     * same question — the claim is about the control, and that is where it is asserted.
     */
    for (let seed = 0; seed < 4; seed += 1) {
      const held = started({ p2: 'normal' }, seed);
      const mashed = started({ p2: 'normal' }, seed);
      let frames = 0;
      for (;;) {
        held.update(STEP, LEAN_BACK);
        mashed.update(STEP, frames % 2 === 0 ? LEAN_BACK : IDLE);
        if (held.position.p1.falls > 0 || mashed.position.p1.falls > 0) break;
        expect(mashed.position.p1.lean).toBeLessThanOrEqual(held.position.p1.lean + 1e-12);
        frames += 1;
      }
      // Long enough to have covered the whole ramp from nothing to a full lean twice over,
      // or the comparison would be proving nothing.
      expect(frames, `seed ${String(seed)} fell too soon to compare`).toBeGreaterThan(
        (2 / (LEAN_RATE * STEP)) | 0,
      );
    }
  });

  it('does not reward a thumb that jumps about', () => {
    // A pointer flickering on and off at the same place must not beat one held there:
    // `driveLean` is a rate, not a set.
    const board = { x: 0, y: 0 };
    toBoard('p1', 200, 40, board);
    const steady = started({ p2: 'normal' });
    const jumpy = started({ p2: 'normal' });
    const thumb = inputOf({ p1: seatInput({ pointer: { x: board.x, y: board.y } }) });
    for (let i = 0; i < 20; i += 1) {
      steady.update(STEP, thumb);
      jumpy.update(STEP, i % 2 === 0 ? thumb : IDLE);
    }
    expect(jumpy.position.p1.lean).toBeLessThanOrEqual(steady.position.p1.lean);
  });
});

describe('the match', () => {
  it('ends on its own from every seed, with no frame cap doing the work', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const game = started({ p1: 'easy', p2: 'hard' }, seed);
      runOut(game);
      expect(game.getScore().winner, `seed ${String(seed)}`).not.toBeNull();
    }
  });

  it('ends with somebody past the line', () => {
    for (let seed = 0; seed < 12; seed += 1) {
      const game = started({ p1: 'normal', p2: 'normal' }, seed);
      runOut(game);
      const furthest = Math.max(game.position.p1.distance, game.position.p2.distance);
      expect(furthest).toBeGreaterThanOrEqual(COURSE_LENGTH);
    }
  });

  it('ends even with one seat empty, because the motor never stops', () => {
    const game = started({ p2: 'hard' }, 3);
    runOut(game);
    expect(game.getScore().winner).not.toBeNull();
  });

  it('scores marker posts, and all of them by the end', () => {
    const game = started({ p1: 'hard', p2: 'hard' }, 3);
    expect(game.getScore().p1).toBe(0);
    runOut(game);
    expect(Math.max(game.getScore().p1, game.getScore().p2)).toBe(SECTORS);
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
      return [
        String(score.winner),
        game.position.p1.distance.toFixed(6),
        game.position.p2.distance.toFixed(6),
        String(game.position.p1.falls),
        String(game.position.p2.falls),
      ].join(':');
    };
    expect(play(9)).toBe(play(9));
    expect(new Set([play(1), play(2), play(3), play(4), play(5), play(6)]).size).toBeGreaterThan(1);
  });

  it('comes back to a fresh course after destroy', () => {
    const game = started({ p1: 'hard', p2: 'hard' }, 8);
    runOut(game);
    game.destroy();
    expect(game.position.p1.distance).toBe(0);
    expect(game.position.p2.distance).toBe(0);
    expect(game.position.p1.falls).toBe(0);
    expect(game.position.phase).toBe('riding');
  });

  it('is unmoved by a pause', () => {
    const game = started({ p1: 'normal', p2: 'hard' }, 2);
    for (let i = 0; i < 200; i += 1) game.update(STEP, IDLE);
    const before = game.getScore();
    game.onPause();
    game.onResume();
    expect(game.getScore()).toEqual(before);
  });

  it('keeps both pointer zones open, because both bikes run at once', () => {
    expect(started({}).getActiveSeat()).toBeNull();
  });
});

describe('renders', () => {
  it('never draws a word', () => {
    // Rule 7's companion: the whole board is shapes, so it needs no translation and no
    // font, and it survives greyscale.
    const game = started({ p1: 'normal', p2: 'hard' }, 4);
    const { renderer, calls } = recorder();
    for (let i = 0; i < 900; i += 1) {
      game.update(STEP, IDLE);
      if (i % 37 === 0) game.render(renderer, 0);
    }
    expect(calls.some((call) => call.op === 'text')).toBe(false);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('never pushes a rotation, because the far lane is already placed turned', () => {
    const game = started({ p1: 'easy', p2: 'easy' }, 6);
    const { renderer, calls } = recorder();
    for (let i = 0; i < 600; i += 1) {
      game.update(STEP, IDLE);
      if (i % 29 === 0) game.render(renderer, 0);
    }
    expect(calls.some((call) => call.op === 'pushRotation')).toBe(false);
    expect(calls.some((call) => call.op === 'pushSeatRotation')).toBe(false);
  });

  it('tells the two seats apart by shape, not only by colour', () => {
    // p1's wheels are discs and its rider a circle; p2's wheels are rings and its rider a
    // square, and their marker pips are discs against blocks.
    const game = started({ p1: 'normal', p2: 'normal' }, 7);
    const { renderer, calls } = recorder();
    for (let i = 0; i < 90; i += 1) game.update(STEP, IDLE);
    game.render(renderer, 0);
    expect(calls.some((call) => call.op === 'circle')).toBe(true);
    expect(calls.some((call) => call.op === 'strokeCircle')).toBe(true);
    expect(calls.some((call) => call.op === 'rect')).toBe(true);
    expect(calls.some((call) => call.op === 'strokeRect')).toBe(true);
  });

  it('draws inside the board', () => {
    const game = started({ p1: 'hard', p2: 'easy' }, 1);
    const { renderer, calls } = recorder();
    for (let i = 0; i < 900; i += 1) {
      game.update(STEP, IDLE);
      if (i % 31 === 0) game.render(renderer, 0);
    }
    const slack = 60;
    for (const call of calls) {
      if (call.op === 'clear') continue;
      const [x, y] = call.args as [number, number];
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      expect(x).toBeGreaterThan(-slack);
      expect(x).toBeLessThan(BOARD_WIDTH + slack);
      expect(y).toBeGreaterThan(-slack);
      expect(y).toBeLessThan(BOARD_HEIGHT + slack);
    }
  });

  it('draws a different picture on easy than on hard', () => {
    // What the shell's parity suite checks for every game: a tier that is read but ignored
    // would draw the identical match.
    const trace = (tier: 'easy' | 'hard'): string => {
      const game = started({ p1: tier, p2: tier }, 12);
      const { renderer, calls } = recorder();
      for (let i = 0; i < 600; i += 1) {
        game.update(STEP, IDLE);
        if (i % 60 === 0) game.render(renderer, 0);
      }
      return calls.map((call) => call.args.join(',')).join('|');
    };
    expect(trace('easy')).not.toBe(trace('hard'));
  });
});

describe('fairness', () => {
  it('cannot tell which seat the shell asked about first', () => {
    // Each seat draws from its own generator, so the poll order inside `update` is not
    // observable at all. On one shared stream it was worth over a point of win rate to
    // whichever seat drew second.
    const scores = new Set<string>();
    for (let seed = 0; seed < 8; seed += 1) {
      const game = started({ p1: 'normal', p2: 'normal' }, seed);
      runOut(game);
      scores.add(
        `${String(seed)}:${game.position.p1.finished.toFixed(6)}:${game.position.p2.finished.toFixed(6)}`,
      );
    }
    expect(scores.size).toBe(8);
  });

  it('gives a bot no quicker a wrist than a person', () => {
    // Rule 6. The bot writes a lean and `driveLean` applies it, which is the same function
    // a thumb goes through, so no tier can shift its weight faster than a player can.
    const bot = started({ p1: 'hard', p2: 'hard' }, 12);
    let botFar = 0;
    let last = bot.position.p1.lean;
    for (let i = 0; i < 900; i += 1) {
      bot.update(STEP, IDLE);
      botFar = Math.max(botFar, Math.abs(bot.position.p1.lean - last));
      last = bot.position.p1.lean;
    }
    expect(botFar).toBeLessThanOrEqual(LEAN_RATE * STEP + 1e-9);

    const human = started({ p2: 'hard' }, 12);
    let humanFar = 0;
    last = human.position.p1.lean;
    for (let i = 0; i < 60; i += 1) {
      human.update(STEP, i < 30 ? LEAN_BACK : LEAN_DOWN);
      humanFar = Math.max(humanFar, Math.abs(human.position.p1.lean - last));
      last = human.position.p1.lean;
    }
    expect(botFar).toBeLessThanOrEqual(humanFar + 1e-9);
  });

  it('runs both riders over the identical course', () => {
    const game = started({ p1: 'easy', p2: 'hard' }, 21);
    runOut(game);
    // One array of bumps, read by both — the fairness claim is structural rather than
    // measured, because there is only one course to be unlucky on.
    expect(game.position.bumps.length).toBeGreaterThan(0);
    expect(game.position.p1.nextBump).toBeGreaterThan(0);
    expect(game.position.p2.nextBump).toBeGreaterThan(0);
  });
});
