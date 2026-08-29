import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, Vec2 } from '@duelbox/engine';
import type { GameContext, MatchScore } from '@duelbox/game-sdk';
import { TapMatchGame, overflowCentre, pileCentre, pileIndexAt, slotCentre } from './game.js';
import { manifest } from './manifest.js';
import {
  READY_SECONDS,
  SETTLE_SECONDS,
  SHAPE,
  STACK_LIMIT,
  THINK_SECONDS,
  frontKind,
  heldOf,
  setsOf,
  sizeOf,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];
const { width: WIDTH, height: HEIGHT } = manifest.logical;

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

/**
 * A turn game owns the whole pointer surface: the board turns to face whoever is to move,
 * so the far half of it sits in the other seat's zone. `GameHost` does exactly this.
 */
function inputs(bottomSeat: SeatId = 'p1'): { manager: InputManager; view: InputView } {
  return {
    manager: new InputManager(manifest.logical, { split: 'shared', bottomSeat }),
    view: new InputView(),
  };
}

function drive(game: TapMatchGame, view: InputView, manager: InputManager, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

/** Past the ready freeze and the board flip, so a press means something. */
function settle(game: TapMatchGame, view: InputView, manager: InputManager): void {
  drive(game, view, manager, Math.ceil((READY_SECONDS + 0.4) * 60));
}

/** Where a pile is on the device, for a seat that may be reading the board upside down. */
function devicePointOf(pile: number, rotated: boolean): Vec2 {
  const out = pileCentre(vec2(), pile);
  if (rotated) {
    out.x = WIDTH - out.x;
    out.y = HEIGHT - out.y;
  }
  return out;
}

function tapAt(
  game: TapMatchGame,
  view: InputView,
  manager: InputManager,
  point: Readonly<Vec2>,
): void {
  manager.pointerDown(1, point.x, point.y);
  drive(game, view, manager, 2);
  manager.pointerUp(1);
  drive(game, view, manager, 2);
}

function press(game: TapMatchGame, view: InputView, manager: InputManager, code: string): void {
  manager.keyDown(code);
  drive(game, view, manager, 2);
  manager.keyUp(code);
  drive(game, view, manager, 2);
}

const noop = (): void => undefined;

function recorder(record: (...args: unknown[]) => void) {
  return {
    clear: noop,
    rect: record,
    strokeRect: record,
    circle: record,
    strokeCircle: record,
    line: record,
    text: record,
    pushSeatRotation: noop,
    pushRotation: noop,
    popSeatRotation: noop,
  };
}

/** Play a whole bot-versus-bot match through the real update loop. */
function playOut(overrides: Partial<GameContext> = {}, cap = 60 * 600): MatchScore {
  const game = new TapMatchGame();
  const { manager, view } = inputs();
  game.init(context({ botDifficulty: () => 'easy', ...overrides }));
  let score = game.getScore();
  for (let i = 0; i < cap && score.winner === null; i += 1) {
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    score = game.getScore();
  }
  game.destroy();
  return score;
}

/* ------------------------------------------------------------------ the manifest */

describe('the manifest', () => {
  it('declares a turn-based shared board in the box the simulation runs in', () => {
    expect(manifest.archetype).toBe('turn-board');
    expect(manifest.zoneSplit).toBe('shared-board');
    expect(manifest.logical).toEqual({ width: 900, height: 1000 });
    expect(manifest.presentations).toEqual(['shared-screen', 'single-seat']);
  });

  it('offers a mode the lobby can actually start', () => {
    // `PlaySurface` renders only `friend` and `bot` buttons, so a manifest whose modes
    // survive that filter empty produces a page with no way to begin.
    const offered = manifest.modes.filter((mode) => mode === 'friend' || mode === 'bot');
    expect(offered).toEqual(['friend', 'bot']);
  });

  it('advertises a round long enough for a match to happen inside', () => {
    // Not a clock — nothing reads `roundSeconds`. It is what the catalogue card promises,
    // and it should not promise something the game routinely overruns.
    const perTurn = READY_SECONDS + SETTLE_SECONDS + THINK_SECONDS;
    expect(manifest.roundSeconds).toBeGreaterThan(20 * perTurn);
  });

  it('names a seat for each half of the keyboard, and describes what this game reads', () => {
    expect(manifest.controls.keyboard).toMatch(/player one/i);
    expect(manifest.controls.keyboard).toMatch(/a and d/i);
    expect(manifest.controls.keyboard).toMatch(/arrow/i);
    expect(manifest.controls.pointer).toMatch(/tap/i);
  });
});

/* ------------------------------------------------------------------ turns */

describe('whose turn it is', () => {
  it('is reported, so the shell turns the board and hands over the whole surface', () => {
    const game = new TapMatchGame();
    game.init(context());
    expect(typeof game.getActiveSeat).toBe('function');
    expect(game.getActiveSeat()).toBe('p1');
    game.destroy();
  });

  it('opens with the seat the shell names, not with p1', () => {
    // The SDK alternates the opener across the rounds of a best-of. Thirty-four older
    // games hardcode `p1` and are being fixed under #2487; this is the test that this
    // one is not the thirty-fifth.
    const game = new TapMatchGame();
    game.init(context({ openingSeat: 'p2' }));
    expect(game.getActiveSeat()).toBe('p2');
    game.destroy();
  });

  it('passes to the other seat once a take has been shown', () => {
    const game = new TapMatchGame();
    const { manager, view } = inputs();
    game.init(context());
    settle(game, view, manager);
    tapAt(game, view, manager, devicePointOf(0, false));
    expect(sizeOf(game.table, 'p1')).toBe(1);
    drive(game, view, manager, Math.ceil(SETTLE_SECONDS * 60) + 2);
    expect(game.getActiveSeat()).toBe('p2');
  });
});

/* ------------------------------------------------------------------ a person playing */

describe('a person taking a card', () => {
  it('takes the pile they tapped', () => {
    const game = new TapMatchGame();
    const { manager, view } = inputs();
    game.init(context());
    settle(game, view, manager);
    const wanted = frontKind(game.table, 3);
    tapAt(game, view, manager, devicePointOf(3, false));
    expect(heldOf(game.table, 'p1', wanted)).toBe(1);
    game.destroy();
  });

  it('ignores a tap in the gap between two piles', () => {
    const game = new TapMatchGame();
    const { manager, view } = inputs();
    game.init(context());
    settle(game, view, manager);
    const left = pileCentre(vec2(), 2);
    const right = pileCentre(vec2(), 3);
    tapAt(game, view, manager, { x: (left.x + right.x) / 2, y: left.y });
    expect(sizeOf(game.table, 'p1')).toBe(0);
    game.destroy();
  });

  it('ignores a tap on the racks and off the board', () => {
    const game = new TapMatchGame();
    const { manager, view } = inputs();
    game.init(context());
    settle(game, view, manager);
    tapAt(game, view, manager, slotCentre(vec2(), 'p1', 2));
    tapAt(game, view, manager, slotCentre(vec2(), 'p2', 5));
    tapAt(game, view, manager, { x: 4, y: 4 });
    expect(sizeOf(game.table, 'p1')).toBe(0);
    game.destroy();
  });

  it('takes nothing during the ready freeze, which is the rules and not the shell', () => {
    const game = new TapMatchGame();
    const { manager, view } = inputs();
    game.init(context());
    // One step in, the board is frozen by READY_SECONDS whatever the flip is doing.
    drive(game, view, manager, 1);
    tapAt(game, view, manager, devicePointOf(0, false));
    expect(sizeOf(game.table, 'p1')).toBe(0);
    settle(game, view, manager);
    tapAt(game, view, manager, devicePointOf(0, false));
    expect(sizeOf(game.table, 'p1')).toBe(1);
    game.destroy();
  });

  it('is one card a press, not one a step', () => {
    const game = new TapMatchGame();
    const { manager, view } = inputs();
    game.init(context());
    settle(game, view, manager);
    const point = devicePointOf(1, false);
    manager.pointerDown(1, point.x, point.y);
    drive(game, view, manager, 120);
    manager.pointerUp(1);
    expect(sizeOf(game.table, 'p1')).toBe(1);
    game.destroy();
  });

  it('takes the pile under the keyboard cursor when a press arrives with no pointer', () => {
    const game = new TapMatchGame();
    const { manager, view } = inputs();
    game.init(context());
    settle(game, view, manager);
    // Seat one's keys: D moves right, Space takes.
    press(game, view, manager, 'KeyD');
    press(game, view, manager, 'KeyD');
    const wanted = frontKind(game.table, 2);
    press(game, view, manager, 'Space');
    expect(heldOf(game.table, 'p1', wanted)).toBe(1);
    game.destroy();
  });

  it('never lets one seat play on the other seat’s turn', () => {
    const game = new TapMatchGame();
    const { manager, view } = inputs();
    game.init(context({ openingSeat: 'p2' }));
    settle(game, view, manager);
    // Seat one's key, on seat two's turn.
    press(game, view, manager, 'Space');
    expect(sizeOf(game.table, 'p1')).toBe(0);
    expect(sizeOf(game.table, 'p2')).toBe(0);
    game.destroy();
  });
});

/* ------------------------------------------------------------------ the half-turn */

describe('the board turning to face the seat to move', () => {
  it('reads the far seat’s tap in the rotated frame it was drawn in', () => {
    const game = new TapMatchGame();
    const { manager, view } = inputs();
    manager.setBoardSeat('p2');
    game.init(context({ openingSeat: 'p2' }));
    settle(game, view, manager);
    const wanted = frontKind(game.table, 4);
    // p2 reads the board upside down, so the device point is the board point turned round.
    tapAt(game, view, manager, devicePointOf(4, true));
    expect(heldOf(game.table, 'p2', wanted)).toBe(1);
    game.destroy();
  });

  it('never rotates in single-seat presentation, whichever seat is to move', () => {
    const game = new TapMatchGame();
    const { manager, view } = inputs('p2');
    manager.setBoardSeat('p2');
    game.init(context({ presentation: 'single-seat', localSeat: 'p2', openingSeat: 'p2' }));
    settle(game, view, manager);
    const wanted = frontKind(game.table, 4);
    tapAt(game, view, manager, devicePointOf(4, false));
    expect(heldOf(game.table, 'p2', wanted)).toBe(1);
    game.destroy();
  });

  it('takes nothing while the board is part-way round', () => {
    const game = new TapMatchGame();
    const { manager, view } = inputs();
    game.init(context());
    settle(game, view, manager);
    tapAt(game, view, manager, devicePointOf(0, false));
    // The turn has just passed to p2 and the board is turning; the pile under a finger is
    // moving, so a tap would take a card the player did not mean.
    drive(game, view, manager, Math.ceil(SETTLE_SECONDS * 60) + 2);
    manager.setBoardSeat('p2');
    const before = sizeOf(game.table, 'p2');
    tapAt(game, view, manager, devicePointOf(1, true));
    expect(sizeOf(game.table, 'p2')).toBe(before);
    game.destroy();
  });
});

/* ------------------------------------------------------------------ whole matches */

describe('a full match', () => {
  it('reaches a decision at every tier, from either opening seat', () => {
    for (const tier of TIERS) {
      for (const openingSeat of ['p1', 'p2'] as SeatId[]) {
        const score = playOut({ botDifficulty: () => tier, openingSeat });
        expect(score.winner, `${tier} from ${openingSeat}`).not.toBeNull();
      }
    }
  });

  it('finishes far inside the ten minutes the cross-game guard allows', () => {
    let worst = 0;
    for (let seed = 0; seed < 12; seed += 1) {
      const game = new TapMatchGame();
      const { manager, view } = inputs();
      game.init(context({ rng: new Rng(seed * 7919 + 3), botDifficulty: () => 'easy' }));
      let steps = 0;
      while (game.getScore().winner === null && steps < 60 * 600) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        steps += 1;
      }
      expect(game.getScore().winner).not.toBeNull();
      worst = Math.max(worst, steps);
      game.destroy();
    }
    expect(worst).toBeLessThan(60 * 200);
  });

  it('reports sets cleared, never more than the deck can yield', () => {
    const score = playOut({ botDifficulty: () => 'normal' });
    const mostPerSeat = Math.floor((SHAPE.piles * SHAPE.depth) / 3);
    expect(score.p1).toBeGreaterThanOrEqual(0);
    expect(score.p2).toBeGreaterThanOrEqual(0);
    expect(score.p1 + score.p2).toBeLessThanOrEqual(mostPerSeat);
  });

  it('takes the tier seriously', () => {
    // The failure this catches is a game that accepts `botDifficulty` and ignores it: it
    // type-checks, it runs, the lobby offers three tiers and they are the same tier.
    let differed = 0;
    for (let seed = 0; seed < 6; seed += 1) {
      const rng = (): Rng => new Rng(seed * 7919 + 11);
      const easy = playOut({ rng: rng(), botDifficulty: () => 'easy' });
      const hard = playOut({ rng: rng(), botDifficulty: () => 'hard' });
      const line = (s: MatchScore): string => `${String(s.p1)}:${String(s.p2)}:${String(s.winner)}`;
      if (line(easy) !== line(hard)) differed += 1;
    }
    expect(differed).toBeGreaterThan(3);
  });

  it('never lets a person play a seat a bot is holding', () => {
    const game = new TapMatchGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: (seat) => (seat === 'p1' ? 'hard' : null) }));
    settle(game, view, manager);
    // A storm on seat one's own keys while the bot holds that seat.
    const before = sizeOf(game.table, 'p1');
    manager.keyDown('Space');
    drive(game, view, manager, 4);
    manager.keyUp('Space');
    expect(sizeOf(game.table, 'p1')).toBeLessThanOrEqual(before + 1);
    game.destroy();
  });

  it('is a fresh board again after a second init', () => {
    const game = new TapMatchGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    drive(game, view, manager, 900);
    game.init(context({ botDifficulty: () => 'hard' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(sizeOf(game.table, 'p1')).toBe(0);
    expect(game.table.left).toBe(SHAPE.piles * SHAPE.depth);
    game.destroy();
  });
});

/* ------------------------------------------------------------------ presentations */

describe('the two presentations', () => {
  it('step the identical match from the same seed', () => {
    // docs/presentation.md: rules, scoring and simulation are byte-identical across both;
    // only placement, rotation and control mapping change. Two bots, so nothing the
    // control mapping is allowed to differ about is in the loop.
    const trace = (presentation: 'shared-screen' | 'single-seat'): string[] => {
      const game = new TapMatchGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, botDifficulty: () => 'normal' }));
      const out: string[] = [];
      for (let i = 0; i < 60 * 200; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        const score = game.getScore();
        out.push(
          `${String(score.p1)}:${String(score.p2)}:${String(score.winner)}:${game.getActiveSeat()}:${String(game.table.left)}`,
        );
        if (score.winner !== null) break;
      }
      game.destroy();
      return out;
    };
    expect(trace('single-seat')).toEqual(trace('shared-screen'));
  });
});

/* ------------------------------------------------------------------ rendering */

describe('rendering', () => {
  it('draws every shape inside the declared box, through a whole match', () => {
    // Bounded per primitive rather than on the magnitude of every argument. A loose check
    // on `Math.abs(value) <= max(width, height)` looks like the same test and is not: it
    // passed happily while the card a rack spilled was being drawn fifty units off the
    // right-hand edge of the board, because 950 is smaller than 1000.
    let marks = 0;
    let worst = '';
    const box = (x: number, y: number, w: number, h: number, what: string): void => {
      marks += 1;
      if (x >= -2 && y >= -2 && x + w <= WIDTH + 2 && y + h <= HEIGHT + 2) return;
      if (worst === '') {
        worst = `${what} at (${x.toFixed(1)}, ${y.toFixed(1)}) ${w.toFixed(1)}x${h.toFixed(1)}`;
      }
    };
    const renderer = {
      ...recorder(noop),
      rect: (x: number, y: number, w: number, h: number) => box(x, y, w, h, 'rect'),
      strokeRect: (x: number, y: number, w: number, h: number, lw: number) =>
        box(x - lw / 2, y - lw / 2, w + lw, h + lw, 'strokeRect'),
      circle: (x: number, y: number, r: number) => box(x - r, y - r, r * 2, r * 2, 'circle'),
      strokeCircle: (x: number, y: number, r: number, lw: number) =>
        box(x - r - lw / 2, y - r - lw / 2, (r + lw / 2) * 2, (r + lw / 2) * 2, 'strokeCircle'),
      line: (x1: number, y1: number, x2: number, y2: number, lw: number) =>
        box(
          Math.min(x1, x2) - lw / 2,
          Math.min(y1, y2) - lw / 2,
          Math.abs(x2 - x1) + lw,
          Math.abs(y2 - y1) + lw,
          'line',
        ),
    };

    const game = new TapMatchGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    // Long enough that at least one rack goes out, which is the frame that draws the most.
    for (let i = 0; i < 60 * 90; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 7 === 0) game.render(renderer, 0);
    }
    game.destroy();
    expect(marks).toBeGreaterThan(1000);
    expect(worst, 'a shape was drawn outside the declared logical box').toBe('');
  });

  it('balances every rotation it pushes', () => {
    let depth = 0;
    const renderer = {
      ...recorder(noop),
      pushSeatRotation: () => {
        depth += 1;
      },
      pushRotation: () => {
        depth += 1;
      },
      popSeatRotation: () => {
        depth -= 1;
      },
    };
    const game = new TapMatchGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 600; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      game.render(renderer, 0);
      expect(depth).toBe(0);
    }
    game.destroy();
  });

  it('draws no text at all', () => {
    // Rule 7: a kind is a shape, a rack is seven slots, a score is a row of pips. Nothing
    // on this board needs reading, so nothing needs translating.
    let texts = 0;
    const renderer = { ...recorder(noop), text: () => (texts += 1) };
    const game = new TapMatchGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 11 === 0) game.render(renderer, 0);
    }
    game.destroy();
    expect(texts).toBe(0);
  });

  it('tells the two racks apart by shape, not only by colour', () => {
    // The same check `apps/web/src/data/greyscale.test.ts` runs over the catalogue, in
    // the form this game's own drawing gives it: a seat-coloured mark is attributed to
    // that seat, and the two seats must not draw the identical primitive at the
    // identical size. Seat one's slots are seven rings; seat two's are seven squares.
    const glyphs: Record<SeatId, Map<string, number>> = { p1: new Map(), p2: new Map() };
    const seatOf = (colour: string): SeatId | null => {
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        const palette = SEAT_PALETTE[seat];
        if ([palette.base, palette.deep, palette.tint, palette.soft].includes(colour)) return seat;
      }
      return null;
    };
    const bump = (glyph: string, colour: string): void => {
      const seat = seatOf(colour);
      if (seat === null) return;
      glyphs[seat].set(glyph, (glyphs[seat].get(glyph) ?? 0) + 1);
    };
    const renderer = {
      ...recorder(noop),
      rect: (x: number, y: number, w: number, h: number, colour: string) =>
        bump(`rect|${String(Math.round(w))}|${String(Math.round(h))}`, colour),
      strokeRect: (x: number, y: number, w: number, h: number, lw: number, colour: string) =>
        bump(`srect|${String(Math.round(w))}|${String(Math.round(h))}`, colour),
      circle: (x: number, y: number, r: number, colour: string) =>
        bump(`circ|${String(Math.round(r))}`, colour),
      strokeCircle: (x: number, y: number, r: number, lw: number, colour: string) =>
        bump(`scirc|${String(Math.round(r))}`, colour),
      line: (x1: number, y1: number, x2: number, y2: number, lw: number, colour: string) =>
        bump('line', colour),
    };

    const game = new TapMatchGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 400);
    game.render(renderer, 0);
    game.destroy();

    expect(glyphs.p1.size).toBeGreaterThan(0);
    expect(glyphs.p2.size).toBeGreaterThan(0);
    // Every glyph either seat draws must be one the other does not, or drawn a different
    // number of times. Anything else is two colours and one shape.
    const shared = [...glyphs.p1.keys()].filter((glyph) => glyphs.p2.has(glyph));
    const separating = [...new Set([...glyphs.p1.keys(), ...glyphs.p2.keys()])].filter(
      (glyph) => glyphs.p1.get(glyph) !== glyphs.p2.get(glyph),
    );
    expect(separating.length, `shared glyphs: ${shared.join(', ')}`).toBeGreaterThan(0);
    expect(glyphs.p1.get('scirc|52')).toBe(STACK_LIMIT);
    expect(glyphs.p2.get('srect|104|104')).toBe(STACK_LIMIT);
  });

  it('does not move the simulation on, at any alpha', () => {
    const renderer = recorder(noop);
    const game = new TapMatchGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 400);
    const before = JSON.stringify(game.table);
    for (const alpha of [0, 0.25, 0.5, 0.75, 0.999]) {
      for (let i = 0; i < 8; i += 1) game.render(renderer, alpha);
    }
    expect(JSON.stringify(game.table)).toBe(before);
    game.destroy();
  });
});

/* ------------------------------------------------------------------ lifecycle */

describe('lifecycle', () => {
  it('pause and resume leave the board alone', () => {
    const game = new TapMatchGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 300);
    const before = JSON.stringify(game.table);
    game.onPause();
    game.onResume();
    expect(JSON.stringify(game.table)).toBe(before);
    game.destroy();
  });

  it('destroy clears both racks, the board and the tally', () => {
    const game = new TapMatchGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 900);
    game.destroy();
    expect(game.table.left).toBe(0);
    expect(sizeOf(game.table, 'p1')).toBe(0);
    expect(sizeOf(game.table, 'p2')).toBe(0);
    expect(setsOf(game.table, 'p1')).toBe(0);
    expect(setsOf(game.table, 'p2')).toBe(0);
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });
});

/* ------------------------------------------------------------------ geometry */

describe('the layout', () => {
  it('keeps every pile and every slot inside the declared box', () => {
    for (let p = 0; p < SHAPE.piles; p += 1) {
      const centre = pileCentre(vec2(), p);
      expect(centre.x).toBeGreaterThan(0);
      expect(centre.x).toBeLessThan(WIDTH);
      expect(centre.y).toBeGreaterThan(0);
      expect(centre.y).toBeLessThan(HEIGHT);
    }
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      for (let i = 0; i < STACK_LIMIT; i += 1) {
        const centre = slotCentre(vec2(), seat, i);
        expect(centre.x).toBeGreaterThan(0);
        expect(centre.x).toBeLessThan(WIDTH);
      }
      const spilled = overflowCentre(vec2(), seat);
      expect(spilled.x).toBeGreaterThan(0);
      expect(spilled.y).toBeGreaterThan(0);
      expect(spilled.y).toBeLessThan(HEIGHT);
    }
  });

  it('puts the two racks symmetrically about the middle, so the half-turn is exact', () => {
    // Under the board's half-turn seat one's rack must land exactly where seat two's was,
    // or one player would be reading their own cards further from the edge than the other.
    for (let i = 0; i < STACK_LIMIT; i += 1) {
      const one = slotCentre(vec2(), 'p1', i);
      const two = slotCentre(vec2(), 'p2', i);
      expect(one.x + two.x).toBeCloseTo(WIDTH, 6);
      expect(one.y + two.y).toBeCloseTo(HEIGHT, 6);
    }
    const spilledOne = overflowCentre(vec2(), 'p1');
    const spilledTwo = overflowCentre(vec2(), 'p2');
    expect(spilledOne.x + spilledTwo.x).toBeCloseTo(WIDTH, 6);
    expect(spilledOne.y + spilledTwo.y).toBeCloseTo(HEIGHT, 6);
  });

  it('names the pile a tap landed on, and nothing between them', () => {
    for (let p = 0; p < SHAPE.piles; p += 1) {
      const centre = pileCentre(vec2(), p);
      expect(pileIndexAt(centre.x, centre.y)).toBe(p);
    }
    const left = pileCentre(vec2(), 0);
    const right = pileCentre(vec2(), 1);
    expect(pileIndexAt((left.x + right.x) / 2, left.y)).toBe(-1);
    expect(pileIndexAt(left.x, 40)).toBe(-1);
    expect(pileIndexAt(-20, left.y)).toBe(-1);
    expect(pileIndexAt(WIDTH + 20, left.y)).toBe(-1);
  });

  it('gives a phone a tap target a thumb can hit', () => {
    // 320 x 568 is the smallest viewport the definition of done names. The board fits to
    // the narrow axis, so a pile is this many device pixels wide.
    const scale = Math.min(320 / WIDTH, 568 / HEIGHT);
    const cardWidth = (pileCentre(vec2(), 1).x - pileCentre(vec2(), 0).x) * scale;
    expect(cardWidth).toBeGreaterThan(40);
  });
});
