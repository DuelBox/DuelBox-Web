import { describe, expect, it } from 'vitest';
import { Rng, vec2 } from '@duelbox/engine';
import type { SeatId, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, SeatInput } from '@duelbox/game-sdk';
import { SpinWarGame } from './game.js';
import { manifest } from './manifest.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;

interface MutableSeatInput {
  move: Vec2;
  pointer: Vec2 | null;
  actionPressed: boolean;
  actionHeld: boolean;
  actionReleased: boolean;
  holdSeconds: number;
}

function blankSeat(): MutableSeatInput {
  return {
    move: vec2(),
    pointer: null,
    actionPressed: false,
    actionHeld: false,
    actionReleased: false,
    holdSeconds: 0,
  };
}

class Idle implements InputState {
  readonly #p1 = blankSeat();
  readonly #p2 = blankSeat();
  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

function ctx(seed: number, a: BotDifficulty | null, b: BotDifficulty | null): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty: (seat: SeatId) => (seat === 'p1' ? a : b),
  };
}

function play(seed: number, a: BotDifficulty | null, b: BotDifficulty | null): [string, number] {
  const game = new SpinWarGame();
  game.init(ctx(seed, a, b));
  const idle = new Idle();
  let steps = 0;
  while (game.getScore().winner === null && steps < 60 * 600) {
    game.update(STEP, idle);
    steps += 1;
  }
  const score = game.getScore();
  return [`${String(score.winner)} ${score.p1}-${score.p2}`, steps];
}

interface Row {
  p1: number;
  p2: number;
  draw: number;
  none: number;
  steps: number;
  max: number;
}

function series(a: BotDifficulty, b: BotDifficulty, count: number): Row {
  const row: Row = { p1: 0, p2: 0, draw: 0, none: 0, steps: 0, max: 0 };
  for (let seed = 1; seed <= count; seed += 1) {
    const [result, steps] = play(seed * 101, a, b);
    row.steps += steps;
    if (steps > row.max) row.max = steps;
    if (result.startsWith('p1')) row.p1 += 1;
    else if (result.startsWith('p2')) row.p2 += 1;
    else if (result.startsWith('draw')) row.draw += 1;
    else row.none += 1;
  }
  return row;
}

function head(a: BotDifficulty, b: BotDifficulty, count: number): string {
  const first = series(a, b, count);
  const second = series(b, a, count);
  const aWins = first.p1 + second.p2;
  const bWins = first.p2 + second.p1;
  const draws = first.draw + second.draw;
  const avg = Math.round((first.steps + second.steps) / (count * 2));
  const max = Math.max(first.max, second.max);
  return `${a} ${aWins} / ${b} ${bWins} / draw ${draws} / avg ${avg} / max ${max}`;
}

describe('measurement', () => {
  it('reports the ladder', () => {
    const lines = [
      `hard vs easy    ${head('hard', 'easy', 50)}`,
      `hard vs normal  ${head('hard', 'normal', 50)}`,
      `normal vs easy  ${head('normal', 'easy', 50)}`,
      `easy mirror     ${JSON.stringify(series('easy', 'easy', 50))}`,
      `normal mirror   ${JSON.stringify(series('normal', 'normal', 50))}`,
      `hard mirror     ${JSON.stringify(series('hard', 'hard', 50))}`,
    ];
    console.warn(lines.join('\n'));
    expect(lines.length).toBe(6);
  });

  it('reports an untouched match', () => {
    const [result, steps] = play(7, null, null);
    console.warn(`nobody plays: ${result} in ${String(steps)} steps`);
    expect(steps).toBeGreaterThan(0);
  });
});
