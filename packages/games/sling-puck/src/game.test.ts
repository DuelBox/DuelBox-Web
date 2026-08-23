import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { BOARD_HEIGHT, BOARD_WIDTH, SlingPuckGame } from './game.js';
import { SHOTS_PER_SEAT } from './rules.js';

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
    ...overrides,
  } as SeatInput;
}

function inputOf(seats: Partial<Record<SeatId, SeatInput>>): InputState {
  return { seat: (seat: SeatId) => seats[seat] ?? seatInput() };
}

const IDLE = inputOf({});

function started(
  bots: Partial<Record<SeatId, 'easy' | 'normal' | 'hard'>>,
  seed = 5,
  presentation: Presentation = 'shared-screen',
): SlingPuckGame {
  const game = new SlingPuckGame();
  game.init({
    rng: new Rng(seed),
    presentation,
    localSeat: 'p1',
    botDifficulty: (seat: SeatId) => bots[seat] ?? null,
  } as unknown as GameContext);
  return game;
}

/** Run until the match ends, with a cap only so a broken build fails rather than hangs. */
function runOut(game: SlingPuckGame, input: InputState = IDLE): number {
  let frames = 0;
  while (game.getScore().winner === null && frames < 60 * 900) {
    game.update(STEP, input);
    frames += 1;
  }
  return frames;
}

describe('the match', () => {
  it('ends on its own from every seed', () => {
    for (let seed = 0; seed < 24; seed += 1) {
      const game = started({ p1: 'easy', p2: 'hard' }, seed);
      const frames = runOut(game);
      expect(frames, `seed ${seed} never finished`).toBeLessThan(60 * 900);
      expect(game.getScore().winner).not.toBeNull();
      expect(game.position.p1Shots).toBe(SHOTS_PER_SEAT);
      expect(game.position.p2Shots).toBe(SHOTS_PER_SEAT);
    }
  });

  it('reports the score as pucks put through, which only ever goes up', () => {
    const game = started({ p1: 'hard', p2: 'normal' }, 2);
    let last = game.getScore();
    for (let i = 0; i < 60 * 90 && game.getScore().winner === null; i += 1) {
      game.update(STEP, IDLE);
      const now = game.getScore();
      expect(now.p1).toBeGreaterThanOrEqual(last.p1);
      expect(now.p2).toBeGreaterThanOrEqual(last.p2);
      last = now;
    }
  });

  it('stops once it is over', () => {
    const game = started({ p1: 'hard', p2: 'hard' }, 3);
    runOut(game);
    const settled = game.getScore();
    for (let i = 0; i < 200; i += 1) game.update(STEP, IDLE);
    expect(game.getScore()).toEqual(settled);
  });

  it('names the seat whose turn it is, for the shell to turn the board', () => {
    const game = started({ p2: 'normal' }, 6);
    expect(game.getActiveSeat()).toBe('p1');
  });

  it('is unmoved by a pause', () => {
    const game = started({ p1: 'normal', p2: 'hard' }, 4);
    for (let i = 0; i < 400; i += 1) game.update(STEP, IDLE);
    const before = game.getScore();
    game.onPause();
    game.onResume();
    expect(game.getScore()).toEqual(before);
  });

  it('comes back to a fresh rack after destroy', () => {
    const game = started({ p1: 'hard', p2: 'hard' }, 8);
    runOut(game);
    game.destroy();
    expect(game.position.p1Through).toBe(0);
    expect(game.position.p2Through).toBe(0);
    expect(game.position.pucks.every((puck) => !puck.through)).toBe(true);
  });

  it('replays a seed identically and a different seed differently', () => {
    const play = (seed: number): string => {
      const game = started({ p1: 'normal', p2: 'hard' }, seed);
      runOut(game);
      const score = game.getScore();
      return `${score.p1}:${score.p2}:${score.winner}`;
    };
    expect(play(9)).toBe(play(9));
    expect(new Set([play(1), play(2), play(3), play(4), play(5)]).size).toBeGreaterThan(1);
  });
});

describe('controls', () => {
  it('takes a press and nothing else, so a key and a thumb are the same instrument', () => {
    // Rule 10. `actionPressed` is an edge, and the game reads no position, direction or rate
    // from either instrument — so there is nothing a pointer can express that a key cannot.
    const byKey = started({ p2: 'normal' }, 12);
    const byThumb = started({ p2: 'normal' }, 12);
    const press = inputOf({ p1: seatInput({ actionPressed: true }) });
    const thumb = inputOf({
      p1: seatInput({ actionPressed: true, pointer: { x: 11, y: 640 }, actionHeld: true }),
    });
    for (let i = 0; i < 400; i += 1) {
      byKey.update(STEP, i % 40 === 20 ? press : IDLE);
      byThumb.update(STEP, i % 40 === 20 ? thumb : IDLE);
    }
    expect(byThumb.getScore()).toEqual(byKey.getScore());
    expect(byThumb.position.p1Shots).toBe(byKey.position.p1Shots);
  });

  it('does not reward a held button, or a mashed one', () => {
    // Held: `actionPressed` is only true on the edge, so holding is one press.
    const held = started({ p2: 'normal' }, 13);
    const heldInput = inputOf({ p1: seatInput({ actionHeld: true }) });
    for (let i = 0; i < 300; i += 1) held.update(STEP, heldInput);
    expect(held.position.p1Shots).toBe(0);
  });

  it('ignores the waiting seat, because both thumbs are on the same glass', () => {
    const game = started({}, 14);
    const wrong = inputOf({ p2: seatInput({ actionPressed: true }) });
    for (let i = 0; i < 300; i += 1) game.update(STEP, wrong);
    expect(game.position.p2Shots).toBe(0);
  });
});

describe('renders', () => {
  it('never draws a word', () => {
    const game = started({ p1: 'normal', p2: 'hard' }, 7);
    const { renderer, calls } = recorder();
    for (let i = 0; i < 900; i += 1) {
      game.update(STEP, IDLE);
      if (i % 41 === 0) game.render(renderer);
    }
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((call) => call.op === 'text')).toBe(false);
  });

  it('turns the board with one rotation, opened and closed every frame', () => {
    const game = started({ p1: 'easy', p2: 'easy' }, 9);
    const { renderer, calls } = recorder();
    game.update(STEP, IDLE);
    game.render(renderer);
    expect(calls.filter((call) => call.op === 'pushRotation')).toHaveLength(1);
    expect(calls.filter((call) => call.op === 'popSeatRotation')).toHaveLength(1);
  });

  it('tells the seats apart by shape, not only by colour', () => {
    const game = started({ p1: 'normal', p2: 'normal' }, 10);
    const { renderer, calls } = recorder();
    game.update(STEP, IDLE);
    game.render(renderer);
    expect(calls.some((call) => call.op === 'strokeCircle')).toBe(true);
    expect(calls.some((call) => call.op === 'rect')).toBe(true);
    expect(calls.some((call) => call.op === 'circle')).toBe(true);
  });

  it('draws inside the board', () => {
    const game = started({ p1: 'hard', p2: 'easy' }, 1);
    const { renderer, calls } = recorder();
    for (let i = 0; i < 600; i += 1) {
      game.update(STEP, IDLE);
      if (i % 37 === 0) game.render(renderer);
    }
    const slack = 60;
    for (const call of calls) {
      if (call.op === 'clear' || call.op === 'pushRotation') continue;
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
  it('plays the same match whichever presentation it is shown in', () => {
    // `seatView` reports no rotation in single-seat play, so anything time-sensitive hidden
    // behind the flip would step two different matches on two devices. The ready pause is in
    // the rules for exactly this reason.
    const shared = started({ p1: 'hard', p2: 'normal' }, 15, 'shared-screen');
    const single = started({ p1: 'hard', p2: 'normal' }, 15, 'single-seat');
    runOut(shared);
    runOut(single);
    expect(single.getScore()).toEqual(shared.getScore());
  });

  it('gives the two seats their own generators', () => {
    // On one shared stream the seat polled first takes the earlier value every time, which
    // measured 1.4 points of win rate in another game here. Different seeds must therefore
    // produce genuinely different matches for both seats, not a shifted copy.
    const scores = new Set<string>();
    for (let seed = 0; seed < 10; seed += 1) {
      const game = started({ p1: 'normal', p2: 'normal' }, seed);
      runOut(game);
      const score = game.getScore();
      scores.add(`${score.p1}:${score.p2}`);
    }
    expect(scores.size).toBeGreaterThan(3);
  });
});
