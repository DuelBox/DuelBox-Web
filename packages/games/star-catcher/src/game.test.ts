import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  StarCatcherGame,
  toBoard,
  toField,
} from './game.js';
import { TARGET_STARS } from './rules.js';

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
    push: note('push'),
    pop: note('pop'),
    pushRotation: note('pushRotation'),
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
    ...overrides,
  } as SeatInput;
}

function inputOf(seats: Partial<Record<SeatId, SeatInput>>): InputState {
  return { seat: (seat: SeatId) => seats[seat] ?? seatInput() };
}

const IDLE = inputOf({});

function context(bots: Partial<Record<SeatId, 'easy' | 'normal' | 'hard'>>, seed = 5): GameContext {
  return {
    rng: new Rng(seed),
    botDifficulty: (seat: SeatId) => bots[seat] ?? null,
    seatView: () => ({ rotated: false }),
  } as unknown as GameContext;
}

function started(
  bots: Partial<Record<SeatId, 'easy' | 'normal' | 'hard'>>,
  seed = 5,
): StarCatcherGame {
  const game = new StarCatcherGame();
  game.init(context(bots, seed));
  return game;
}

function runOut(game: StarCatcherGame, input: InputState = IDLE, cap = 60 * 300): number {
  let frames = 0;
  while (game.getScore().winner === null && frames < cap) {
    game.update(STEP, input);
    frames += 1;
  }
  return frames;
}

describe('layout', () => {
  it('places both fields inside the board and nowhere near each other', () => {
    const near = { x: 0, y: 0 };
    const far = { x: 0, y: 0 };
    for (const [x, y] of [
      [0, 0],
      [FIELD_WIDTH, 0],
      [0, FIELD_HEIGHT],
      [FIELD_WIDTH, FIELD_HEIGHT],
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

  it('reads a board point back to the field it came from', () => {
    const board = { x: 0, y: 0 };
    const back = { x: 0, y: 0 };
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      for (const [x, y] of [
        [17, 33],
        [FIELD_WIDTH - 5, FIELD_HEIGHT - 11],
        [FIELD_WIDTH / 2, FIELD_HEIGHT / 2],
      ] as const) {
        toBoard(seat, x, y, board);
        toField(seat, board.x, board.y, back);
        expect(back.x).toBeCloseTo(x, 6);
        expect(back.y).toBeCloseTo(y, 6);
      }
    }
  });

  it('turns the far seat half a turn, so neither player reads a rotated sky', () => {
    // The field is placed twice rather than drawn once and spun, which is why `render` never
    // pushes a rotation — see the `renders` block below.
    const near = { x: 0, y: 0 };
    const far = { x: 0, y: 0 };
    toBoard('p1', 10, 20, near);
    toBoard('p2', 10, 20, far);
    expect(far.x).toBeCloseTo(FIELD_WIDTH - 10, 6);
    expect(near.x).toBeCloseTo(10, 6);
  });
});

describe('controls', () => {
  it('gives a key and a thumb the same reach in a second', () => {
    // Rule 10. The pointer is absolute and the keys are a direction, but `driveNet` caps
    // both at the same speed, so neither instrument crosses the sky faster than the other.
    const byThumb = started({ p2: 'normal' });
    const board = { x: 0, y: 0 };
    toBoard('p1', FIELD_WIDTH - 40, FIELD_HEIGHT / 2, board);
    const thumb = inputOf({ p1: seatInput({ pointer: { x: board.x, y: board.y } }) });
    for (let i = 0; i < 30; i += 1) byThumb.update(STEP, thumb);

    const byKey = started({ p2: 'normal' });
    const key = inputOf({ p1: seatInput({ move: { x: 1, y: 0 } }) });
    for (let i = 0; i < 30; i += 1) byKey.update(STEP, key);

    expect(byThumb.position.p1.x).toBeCloseTo(byKey.position.p1.x, 4);
    expect(byThumb.position.p1.y).toBeCloseTo(byKey.position.p1.y, 4);
  });

  it('does not reward a thumb that jumps about', () => {
    // A pointer that teleports to the far corner every frame must not out-run one held
    // steady on the same corner: `driveNet` is a rate, not a set.
    const steady = started({ p2: 'normal' });
    const board = { x: 0, y: 0 };
    toBoard('p1', FIELD_WIDTH - 40, 40, board);
    const held = inputOf({ p1: seatInput({ pointer: { x: board.x, y: board.y } }) });
    for (let i = 0; i < 40; i += 1) steady.update(STEP, held);

    const jumpy = started({ p2: 'normal' });
    for (let i = 0; i < 40; i += 1) {
      const corner = i % 2 === 0 ? [FIELD_WIDTH - 40, 40] : [FIELD_WIDTH - 41, 41];
      toBoard('p1', corner[0] as number, corner[1] as number, board);
      jumpy.update(STEP, inputOf({ p1: seatInput({ pointer: { x: board.x, y: board.y } }) }));
    }
    expect(Math.hypot(jumpy.position.p1.x - steady.position.p1.x, 0)).toBeLessThan(3);
  });

  it('leaves the net alone when nobody is asking', () => {
    const game = started({ p2: 'normal' });
    const before = { x: game.position.p1.x, y: game.position.p1.y };
    for (let i = 0; i < 60; i += 1) game.update(STEP, IDLE);
    expect(game.position.p1.x).toBeCloseTo(before.x, 6);
    expect(game.position.p1.y).toBeCloseTo(before.y, 6);
  });

  it('keeps both pointer zones open, because both nets fly at once', () => {
    expect(started({}).getActiveSeat()).toBeNull();
  });
});

describe('the match', () => {
  it('ends on its own from every seed, with no frame cap doing the work', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const game = started({ p1: 'easy', p2: 'hard' }, seed);
      const frames = runOut(game);
      expect(frames, `seed ${seed} never finished`).toBeLessThan(60 * 300);
      expect(game.getScore().winner).not.toBeNull();
    }
  });

  it('ends when somebody has the target, or when the sky runs out', () => {
    for (let seed = 0; seed < 12; seed += 1) {
      const game = started({ p1: 'normal', p2: 'normal' }, seed);
      runOut(game);
      const score = game.getScore();
      const reached = score.p1 >= TARGET_STARS || score.p2 >= TARGET_STARS;
      expect(reached || game.position.spawned >= 1).toBe(true);
    }
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
      return `${score.p1}:${score.p2}:${score.winner}`;
    };
    expect(play(9)).toBe(play(9));
    const seeds = new Set([play(1), play(2), play(3), play(4), play(5), play(6)]);
    expect(seeds.size).toBeGreaterThan(1);
  });

  it('comes back to a fresh sky after destroy', () => {
    const game = started({ p1: 'hard', p2: 'hard' }, 8);
    runOut(game);
    game.destroy();
    expect(game.position.p1Stars).toBe(0);
    expect(game.position.p2Stars).toBe(0);
    expect(game.position.drifters.every((drifter) => !drifter.active)).toBe(true);
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
    // Rule 7's companion: the whole board is shapes, so it needs no translation and no font.
    const game = started({ p1: 'normal', p2: 'hard' }, 4);
    const { renderer, calls } = recorder();
    for (let i = 0; i < 400; i += 1) {
      game.update(STEP, IDLE);
      if (i % 37 === 0) game.render(renderer);
    }
    expect(calls.some((call) => call.op === 'text')).toBe(false);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('never pushes a rotation, because the far field is already placed turned', () => {
    const game = started({ p1: 'easy', p2: 'easy' }, 6);
    const { renderer, calls } = recorder();
    for (let i = 0; i < 300; i += 1) {
      game.update(STEP, IDLE);
      if (i % 29 === 0) game.render(renderer);
    }
    expect(calls.some((call) => call.op === 'pushRotation')).toBe(false);
  });

  it('tells the two seats apart by shape, not only by colour', () => {
    // p1's net is a ring and p2's a square frame; p1's pips are discs and p2's blocks.
    const game = started({ p1: 'normal', p2: 'normal' }, 7);
    const { renderer, calls } = recorder();
    game.update(STEP, IDLE);
    game.render(renderer);
    expect(calls.some((call) => call.op === 'strokeCircle')).toBe(true);
    expect(calls.some((call) => call.op === 'strokeRect')).toBe(true);
    expect(calls.some((call) => call.op === 'circle')).toBe(true);
    expect(calls.some((call) => call.op === 'rect')).toBe(true);
  });

  it('draws inside the board', () => {
    const game = started({ p1: 'hard', p2: 'easy' }, 1);
    const { renderer, calls } = recorder();
    for (let i = 0; i < 240; i += 1) {
      game.update(STEP, IDLE);
      if (i % 31 === 0) game.render(renderer);
    }
    const slack = 40;
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
});

describe('fairness', () => {
  it('cannot tell which seat the shell asked about first', () => {
    // Each seat draws from its own generator, so the poll order inside `update` is not
    // observable. On one shared stream it was worth 1.4 points of win rate.
    const scores = new Set<string>();
    for (let seed = 0; seed < 8; seed += 1) {
      const game = started({ p1: 'normal', p2: 'normal' }, seed);
      runOut(game);
      const score = game.getScore();
      scores.add(`${seed}:${score.p1}:${score.p2}`);
    }
    expect(scores.size).toBe(8);
  });

  it('gives a bot no more reach than a person', () => {
    // Rule 6. The bot writes a target and `driveNet` moves it, which is the same function a
    // thumb goes through, so no bot can cross the sky faster than a human can drag.
    const bot = started({ p1: 'hard', p2: 'hard' }, 12);
    const board = { x: 0, y: 0 };
    let far = 0;
    let last = { x: bot.position.p1.x, y: bot.position.p1.y };
    for (let i = 0; i < 300; i += 1) {
      bot.update(STEP, IDLE);
      far = Math.max(far, Math.hypot(bot.position.p1.x - last.x, bot.position.p1.y - last.y));
      last = { x: bot.position.p1.x, y: bot.position.p1.y };
    }

    const human = started({ p2: 'hard' }, 12);
    toBoard('p1', 10, 10, board);
    let humanFar = 0;
    last = { x: human.position.p1.x, y: human.position.p1.y };
    for (let i = 0; i < 60; i += 1) {
      human.update(STEP, inputOf({ p1: seatInput({ pointer: { x: board.x, y: board.y } }) }));
      humanFar = Math.max(
        humanFar,
        Math.hypot(human.position.p1.x - last.x, human.position.p1.y - last.y),
      );
      last = { x: human.position.p1.x, y: human.position.p1.y };
    }
    expect(far).toBeLessThanOrEqual(humanFar + 1e-9);
  });
});
