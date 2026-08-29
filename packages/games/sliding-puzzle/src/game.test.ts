import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { SlidingPuzzleGame, cellAt, cellCentre, directionOf } from './game.js';
import { manifest } from './manifest.js';
import {
  CELL_COUNT,
  DOWN,
  GAP,
  LEFT,
  MOVES_PER_SEAT,
  RIGHT,
  SIZE,
  SLIDES_PER_TURN,
  UP,
  homeCount,
  opposite,
  stepCell,
} from './rules.js';

const STEP = 1 / 60;

function context(overrides: Partial<GameContext> = {}): GameContext {
  return {
    manifest,
    rng: new Rng(20260829),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty: () => null,
    ...overrides,
  };
}

function inputs(): { manager: InputManager; view: InputView } {
  // A turn game owns the whole pointer surface: the board turns to face whoever is sliding.
  return {
    manager: new InputManager(manifest.logical, { split: 'shared', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

function drive(
  game: SlidingPuzzleGame,
  view: InputView,
  manager: InputManager,
  steps: number,
): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

/** Past the board's half-turn, so input is open again. */
function settled(game: SlidingPuzzleGame, view: InputView, manager: InputManager): void {
  drive(game, view, manager, 40);
}

function tapKey(
  game: SlidingPuzzleGame,
  view: InputView,
  manager: InputManager,
  key: string,
): void {
  manager.keyDown(key);
  drive(game, view, manager, 2);
  manager.keyUp(key);
  drive(game, view, manager, 2);
}

const noop = (): void => undefined;

function recorder(record: (name: string, ...args: unknown[]) => void) {
  return {
    clear: noop,
    rect: (...a: unknown[]) => {
      record('rect', ...a);
    },
    strokeRect: (...a: unknown[]) => {
      record('strokeRect', ...a);
    },
    circle: (...a: unknown[]) => {
      record('circle', ...a);
    },
    strokeCircle: (...a: unknown[]) => {
      record('strokeCircle', ...a);
    },
    line: (...a: unknown[]) => {
      record('line', ...a);
    },
    text: (...a: unknown[]) => {
      record('text', ...a);
    },
    pushSeatRotation: noop,
    pushRotation: noop,
    popSeatRotation: noop,
  };
}

describe('the manifest', () => {
  it('declares the box the simulation actually runs in, and it is square', () => {
    // The board has to sit dead centre or the half-turn would move it, so the box is
    // square and the two margins that hold the slide counters are equal.
    expect(manifest.logical.width).toBe(manifest.logical.height);
    cellCentre(vec2(), CELL_COUNT - 1);
    const first = cellCentre(vec2(), 0);
    const last = cellCentre(vec2(), CELL_COUNT - 1);
    expect(first.x + last.x).toBeCloseTo(manifest.logical.width, 6);
    expect(first.y + last.y).toBeCloseTo(manifest.logical.height, 6);
  });

  it('is a turn game on a shared board', () => {
    expect(manifest.archetype).toBe('turn-board');
    expect(manifest.zoneSplit).toBe('shared-board');
  });

  it('offers the two modes the shell can start, and says so in the game words', () => {
    // The catalogue row calls this a solo game; SPEC.md argues why it ships as a duel.
    expect(manifest.modes).toContain('friend');
    expect(manifest.modes).toContain('bot');
    expect(manifest.controls.keyboard).toMatch(/player one/i);
    expect(manifest.controls.pointer).toMatch(/tap/i);
    // Rule 10: the pointer must not be able to express anything a key cannot.
    expect(manifest.controls.pointer).not.toMatch(/drag|swipe|flick|hold/i);
  });

  it('advertises a round long enough to hold a match', () => {
    expect(manifest.roundSeconds).toBeGreaterThan(60);
  });
});

describe('whose turn it is', () => {
  it('opens from the seat the shell nominates, not from p1', () => {
    for (const opener of ['p1', 'p2'] as SeatId[]) {
      const game = new SlidingPuzzleGame();
      game.init(context({ openingSeat: opener }));
      expect(game.getActiveSeat()).toBe(opener);
      game.destroy();
    }
  });

  it('hands over after a full turn, not after every slide', () => {
    const game = new SlidingPuzzleGame();
    const { manager, view } = inputs();
    game.init(context());
    settled(game, view, manager);

    // The opening turn is a single slide, so the very first press passes the board over.
    slideOnce(game, view, manager);
    expect(game.getActiveSeat()).toBe('p2');
    settled(game, view, manager);

    // Seat two then gets two slides before it changes hands again.
    slideOnce(game, view, manager, 'p2');
    expect(game.getActiveSeat()).toBe('p2');
    slideOnce(game, view, manager, 'p2');
    expect(game.getActiveSeat()).toBe('p1');
    game.destroy();
  });
});

/** Press whichever of the four keys the active seat can legally slide with. */
function slideOnce(
  game: SlidingPuzzleGame,
  view: InputView,
  manager: InputManager,
  seat: SeatId = 'p1',
): void {
  const keys: Record<number, string> =
    seat === 'p1'
      ? { [UP]: 'KeyW', [RIGHT]: 'KeyD', [DOWN]: 'KeyS', [LEFT]: 'KeyA' }
      : { [UP]: 'ArrowUp', [RIGHT]: 'ArrowRight', [DOWN]: 'ArrowDown', [LEFT]: 'ArrowLeft' };
  settled(game, view, manager);
  const before = game.match.p1Moves + game.match.p2Moves;
  for (let direction = 0; direction < 4; direction += 1) {
    // Seat two reads the board upside down, so their key names the opposite direction.
    const key = keys[seat === 'p1' ? direction : opposite(direction)];
    if (key === undefined) continue;
    tapKey(game, view, manager, key);
    if (game.match.p1Moves + game.match.p2Moves < before) return;
  }
  throw new Error('no key slid anything');
}

describe('the keyboard', () => {
  it('slides on a press and never repeats on a hold', () => {
    const game = new SlidingPuzzleGame();
    const { manager, view } = inputs();
    game.init(context());
    settled(game, view, manager);

    const spent = game.match.p1Moves;
    manager.keyDown('KeyW');
    drive(game, view, manager, 120);
    manager.keyUp('KeyW');
    drive(game, view, manager, 4);
    // Two seconds of a held key is at most one slide, whatever the key happened to be:
    // the slide budget is small enough that an auto-repeat would spend a whole turn.
    expect(spent - game.match.p1Moves).toBeLessThanOrEqual(1);
    game.destroy();
  });

  it('gives the far seat their own frame, so both players push the same way', () => {
    // Seat two reads the board half a turn round. Pressing "up" must slide the tile above
    // the gap *as they see it*, which is the tile below it on the board.
    expect(directionOf(0, -1)).toBe(UP);
    expect(directionOf(0, 1)).toBe(DOWN);
    expect(directionOf(-1, 0)).toBe(LEFT);
    expect(directionOf(1, 0)).toBe(RIGHT);
    expect(directionOf(0, 0)).toBe(-1);
    expect(directionOf(0.2, 0.2)).toBe(-1);
    expect(opposite(directionOf(0, -1))).toBe(DOWN);
  });

  it('ignores the seat that is not to move', () => {
    const game = new SlidingPuzzleGame();
    const { manager, view } = inputs();
    game.init(context());
    settled(game, view, manager);
    const before = game.match.p1Moves + game.match.p2Moves;
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      tapKey(game, view, manager, key);
    }
    expect(game.match.p1Moves + game.match.p2Moves).toBe(before);
    game.destroy();
  });
});

describe('the pointer', () => {
  it('names a tile, and the tile names the slide', () => {
    const game = new SlidingPuzzleGame();
    const { manager, view } = inputs();
    game.init(context());
    settled(game, view, manager);

    const gap = game.match.gap;
    let target = -1;
    let expected = -1;
    for (let direction = 0; direction < 4; direction += 1) {
      const cell = stepCell(gap, direction);
      if (cell < 0) continue;
      target = cell;
      expected = direction;
      break;
    }
    const centre = cellCentre(vec2(), target);
    manager.pointerDown(1, centre.x, centre.y);
    drive(game, view, manager, 2);
    manager.pointerUp(1);
    drive(game, view, manager, 2);

    expect(game.match.movedTo).toBe(gap);
    expect(game.match.gap).toBe(target);
    expect(game.match.lastDirection).toBe(expected);
    game.destroy();
  });

  it('does nothing for a tap on the seam between two tiles', () => {
    // The gap between tiles is dead space rather than being rounded to the nearer tile.
    const first = cellCentre(vec2(), 0);
    const second = cellCentre(vec2(), 1);
    expect(cellAt(first.x, first.y)).toBe(0);
    expect(cellAt(second.x, second.y)).toBe(1);
    expect(cellAt((first.x + second.x) / 2, first.y)).toBe(-1);
    expect(cellAt(-5, -5)).toBe(-1);
    expect(cellAt(manifest.logical.width + 5, 10)).toBe(-1);
  });

  it('does nothing for a tap on a tile that is not beside the gap', () => {
    const game = new SlidingPuzzleGame();
    const { manager, view } = inputs();
    game.init(context());
    settled(game, view, manager);

    const gap = game.match.gap;
    let far = -1;
    for (let cell = 0; cell < CELL_COUNT; cell += 1) {
      if (cell === gap) continue;
      let adjacent = false;
      for (let direction = 0; direction < 4; direction += 1) {
        if (stepCell(gap, direction) === cell) adjacent = true;
      }
      if (!adjacent) {
        far = cell;
        break;
      }
    }
    const centre = cellCentre(vec2(), far);
    const before = game.match.p1Moves;
    manager.pointerDown(1, centre.x, centre.y);
    drive(game, view, manager, 2);
    manager.pointerUp(1);
    drive(game, view, manager, 2);
    expect(game.match.p1Moves).toBe(before);
    game.destroy();
  });
});

describe('the match through the shell', () => {
  it('reports a score that only climbs, and a winner exactly once', () => {
    const game = new SlidingPuzzleGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    let p1 = 0;
    let p2 = 0;
    let steps = 0;
    while (game.getScore().winner === null) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      const score = game.getScore();
      expect(score.p1).toBeGreaterThanOrEqual(p1);
      expect(score.p2).toBeGreaterThanOrEqual(p2);
      p1 = score.p1;
      p2 = score.p2;
      steps += 1;
      if (steps > 60 * 600) throw new Error('two easy bots did not finish in ten minutes');
    }
    expect(game.match.p1Moves).toBe(0);
    expect(game.match.p2Moves).toBe(0);
    // Comfortably inside the guard, and the number is in SPEC.md.
    expect(steps).toBeLessThan(60 * 120);
    game.destroy();
  });

  it('steps the identical match in both presentations', () => {
    // `seatView` reports no rotation at all in single-seat play, so anything keyed off the
    // board's half-turn would step one match on a shared phone and a different one on two
    // phones playing remotely.
    const trace = (presentation: Presentation): string => {
      const game = new SlidingPuzzleGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, botDifficulty: () => 'normal' }));
      const seen: string[] = [];
      while (game.getScore().winner === null) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        seen.push(`${game.board.join('')}:${game.getActiveSeat()}`);
      }
      game.destroy();
      return seen.join('|');
    };
    expect(trace('single-seat')).toBe(trace('shared-screen'));
  });

  it('plays a different match on easy and on hard', () => {
    const play = (tier: 'easy' | 'hard'): string => {
      const game = new SlidingPuzzleGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      while (game.getScore().winner === null) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      const result = `${game.board.join('')}:${String(game.getScore().p1)}`;
      game.destroy();
      return result;
    };
    expect(play('easy')).not.toBe(play('hard'));
  });

  it('does nothing at all when nobody plays, and still never throws', () => {
    const game = new SlidingPuzzleGame();
    const { manager, view } = inputs();
    game.init(context());
    const before = game.board.join('');
    drive(game, view, manager, 600);
    expect(game.board.join('')).toBe(before);
    expect(game.getScore().winner).toBeNull();
    game.destroy();
  });
});

describe('rendering', () => {
  it('does not touch the simulation, at any alpha', () => {
    const game = new SlidingPuzzleGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 200);
    const before = JSON.stringify(game.match);
    const renderer = recorder(() => undefined);
    for (let i = 0; i < 40; i += 1) {
      game.render(renderer, i / 40);
      game.render(renderer, 0);
    }
    expect(JSON.stringify(game.match)).toBe(before);
    game.destroy();
  });

  it('keeps every drawn point inside the declared box', () => {
    const game = new SlidingPuzzleGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    const points: number[] = [];
    const renderer = recorder((name, ...args) => {
      for (const arg of args) if (typeof arg === 'number') points.push(arg);
    });
    for (let frame = 0; frame < 400; frame += 1) {
      drive(game, view, manager, 1);
      game.render(renderer, 0);
    }
    expect(points.length).toBeGreaterThan(0);
    for (const value of points) {
      expect(Math.abs(value)).toBeLessThanOrEqual(manifest.logical.width);
    }
    game.destroy();
  });

  it('tells the two seats apart by shape, not only by colour', () => {
    // Rule 7. Strip every colour out of the draw calls and the two seats must still
    // produce different pictures — seat one is a ring and seat two a cross, everywhere.
    const shapesFor = (opener: SeatId): string => {
      const game = new SlidingPuzzleGame();
      const { manager, view } = inputs();
      game.init(context({ openingSeat: opener }));
      drive(game, view, manager, 60);
      const calls: string[] = [];
      const renderer = recorder((name, ...args) => {
        calls.push(`${name}(${args.filter((a) => typeof a === 'number').join(',')})`);
      });
      game.render(renderer, 0);
      game.destroy();
      return calls.join('|');
    };
    expect(shapesFor('p1')).not.toBe(shapesFor('p2'));
  });

  it('draws a label for every tile and nothing for the gap', () => {
    const game = new SlidingPuzzleGame();
    const { manager, view } = inputs();
    game.init(context());
    settled(game, view, manager);
    const labels: string[] = [];
    const renderer = recorder((name, ...args) => {
      if (name === 'text' && typeof args[0] === 'string') labels.push(args[0]);
    });
    game.render(renderer, 0);
    expect(labels.slice().sort()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    game.destroy();
  });
});

describe('teardown', () => {
  it('lets go of the board and can be stood back up', () => {
    const game = new SlidingPuzzleGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    drive(game, view, manager, 300);
    game.destroy();
    expect(game.board.every((value) => value === GAP)).toBe(true);
    expect(game.match.p1Moves).toBe(0);

    game.init(context());
    expect(game.match.p1Moves).toBe(MOVES_PER_SEAT);
    expect(game.match.turnSlides).toBe(1);
    expect(homeCount(game.board, 'p1')).toBe(homeCount(game.board, 'p2'));
    game.destroy();
  });

  it('starts a fresh match for a fresh seed', () => {
    const first = new SlidingPuzzleGame();
    first.init(context({ rng: new Rng(1) }));
    const a = first.board.join('');
    first.destroy();
    const second = new SlidingPuzzleGame();
    second.init(context({ rng: new Rng(2) }));
    const b = second.board.join('');
    second.destroy();
    expect(a).not.toBe(b);
  });
});

describe('the board layout', () => {
  it('maps every cell to a point that maps back to it', () => {
    for (let cell = 0; cell < CELL_COUNT; cell += 1) {
      const centre = cellCentre(vec2(), cell);
      expect(cellAt(centre.x, centre.y)).toBe(cell);
      expect(centre.x).toBeGreaterThan(0);
      expect(centre.x).toBeLessThan(manifest.logical.width);
      expect(centre.y).toBeGreaterThan(0);
      expect(centre.y).toBeLessThan(manifest.logical.height);
    }
  });

  it('is a square grid of the size the rules use', () => {
    expect(SIZE * SIZE).toBe(CELL_COUNT);
    expect(SLIDES_PER_TURN).toBe(2);
  });
});
