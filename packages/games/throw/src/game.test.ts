import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { GameContext, Renderer } from '@duelbox/game-sdk';
import { SnowballThrowGame, seatAxisSign } from './game.js';
import { manifest } from './manifest.js';
import {
  BASELINE_P1,
  BASELINE_P2,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  HEALTH,
  MATCH_SECONDS,
  MOVE_SPEED,
  STAGES,
  activeBalls,
  throwerOf,
} from './rules.js';
import type { BotDifficulty, Stage } from './rules.js';

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

/** A real-time game keeps its two pointer zones for the whole match. */
function inputs(): { manager: InputManager; view: InputView } {
  return {
    manager: new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

function drive(game: SnowballThrowGame, io: ReturnType<typeof inputs>, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, io.view.sync(io.manager.beginStep(STEP)));
}

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function recorder(calls: Call[]): Renderer {
  const record =
    (method: string) =>
    (...args: unknown[]): void => {
      calls.push({ method, args });
    };
  return {
    clear: record('clear'),
    rect: record('rect'),
    strokeRect: record('strokeRect'),
    circle: record('circle'),
    strokeCircle: record('strokeCircle'),
    line: record('line'),
    text: record('text'),
    pushSeatRotation: record('pushSeatRotation'),
    pushRotation: record('pushRotation'),
    popSeatRotation: record('popSeatRotation'),
  };
}

function colourOf(call: Call): string {
  const last = call.args[call.args.length - 1];
  return typeof last === 'string' ? last : '';
}

/* ------------------------------------------------------------------------------------ */

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(BOARD_WIDTH);
    expect(manifest.logical.height).toBe(BOARD_HEIGHT);
  });

  it('advertises the clock the rules actually keep', () => {
    // `roundSeconds` ends nothing — it is text on a catalogue card. The clock that ends a
    // match lives in `rules.ts`, and the only thing keeping the two equal is this.
    expect(manifest.roundSeconds).toBe(MATCH_SECONDS);
  });

  it('is a real-time game split across the two ends of one field', () => {
    expect(manifest.archetype).toBe('rt-split');
    expect(manifest.zoneSplit).toBe('horizontal');
    expect(manifest.orientation).toBe('portrait');
  });

  it('claims to be fair across input families, and says how in both lines', () => {
    expect(manifest.sameInputClassOnly).toBe(false);
    // Both instruments are described as the same two things: walk, and let go.
    expect(manifest.controls.keyboard).toMatch(/throw/i);
    expect(manifest.controls.pointer).toMatch(/lift/i);
    expect(manifest.controls.pointer).toMatch(/walk/i);
  });
});

describe('the shell contract', () => {
  it('never claims to have turns', () => {
    // `apps/web/src/data/turn-seat.test.ts` enforces this: a real-time game that reported
    // an active seat would put the shell into shared-board mode and take one seat's
    // pointer zone away.
    const game = new SnowballThrowGame();
    game.init(context());
    // Not implemented at all, which is the strongest form of "no turns": the host decides
    // a game is turn-based from the live value, and a method that could ever return a seat
    // is a method that could ever be wrong.
    expect((game as { getActiveSeat?: unknown }).getActiveSeat).toBeUndefined();
  });

  it('reports health as the score, and a winner only once there is one', () => {
    const game = new SnowballThrowGame();
    game.init(context());
    expect(game.getScore()).toEqual({ p1: HEALTH, p2: HEALTH, winner: null });
    const io = inputs();
    drive(game, io, 10);
    expect(game.getScore().winner).toBeNull();
  });

  it('gives back a level board on destroy and on a second init', () => {
    const game = new SnowballThrowGame();
    game.init(context({ botDifficulty: () => 'hard' }));
    const io = inputs();
    drive(game, io, 600);
    expect(game.field.p1.health + game.field.p2.health).toBeLessThan(HEALTH * 2);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: HEALTH, p2: HEALTH, winner: null });
    expect(activeBalls(game.field)).toBe(0);
    game.init(context({ botDifficulty: () => 'hard' }));
    expect(game.field.clock).toBe(MATCH_SECONDS);
    expect(game.field.p1.throws).toBe(0);
  });

  it('plays the identical match whichever presentation the shell picked', () => {
    // Nothing in this game reads `presentation`, and this is what keeps it that way: a
    // shared phone and two phones playing remotely must step the same match.
    const traces = (['shared-screen', 'single-seat'] as Presentation[]).map((presentation) => {
      const game = new SnowballThrowGame();
      game.init(context({ presentation, localSeat: 'p2', botDifficulty: () => 'normal' }));
      const io = inputs();
      drive(game, io, 900);
      return JSON.stringify(game.field);
    });
    expect(traces[1]).toBe(traces[0]);
  });
});

describe('controls', () => {
  it('walks each seat with its own half of the keyboard', () => {
    const game = new SnowballThrowGame();
    game.init(context());
    const io = inputs();
    io.manager.keyDown('KeyD');
    drive(game, io, 30);
    expect(game.field.p1.x).toBeGreaterThan(BOARD_WIDTH / 2);
    expect(game.field.p2.x).toBe(BOARD_WIDTH / 2);
    io.manager.keyUp('KeyD');
    io.manager.keyDown('ArrowRight');
    drive(game, io, 30);
    expect(game.field.p2.x).not.toBe(BOARD_WIDTH / 2);
  });

  it('mirrors the far seat, so its own right is its own right', () => {
    // The far player reads the device upside down. Every mirrored game in the catalogue
    // negates the axis; the one that does not — pinball — has the far player's controls
    // reversed, which is the bug this is here to prevent.
    expect(seatAxisSign('p1')).toBe(1);
    expect(seatAxisSign('p2')).toBe(-1);
    const game = new SnowballThrowGame();
    game.init(context());
    const io = inputs();
    io.manager.keyDown('KeyD');
    io.manager.keyDown('ArrowRight');
    drive(game, io, 30);
    // Both players pressed their own "right" and the two throwers went opposite ways
    // across the board, which is what "right" means from where each of them is sitting.
    expect(game.field.p1.x).toBeGreaterThan(BOARD_WIDTH / 2);
    expect(game.field.p2.x).toBeLessThan(BOARD_WIDTH / 2);
    expect(game.field.p1.x - BOARD_WIDTH / 2).toBeCloseTo(BOARD_WIDTH / 2 - game.field.p2.x, 9);
  });

  it('walks a thrower toward a finger, at the same speed a key walks it', () => {
    const byKey = new SnowballThrowGame();
    byKey.init(context());
    const keyIo = inputs();
    keyIo.manager.keyDown('KeyD');
    drive(byKey, keyIo, 30);

    const byFinger = new SnowballThrowGame();
    byFinger.init(context());
    const fingerIo = inputs();
    // Absolute, inside seat one's own band. A horizontal split gives each seat a full-width
    // strip, so every point along its own line is under its own thumb.
    fingerIo.manager.pointerDown(1, BOARD_WIDTH - 40, BASELINE_P1);
    drive(byFinger, fingerIo, 30);

    expect(byFinger.field.p1.x).toBe(byKey.field.p1.x);
  });

  it('reads a finger as an absolute point, so the far seat is not mirrored twice', () => {
    // The keys are mirrored for the far seat and the pointer is not, and that is the right
    // answer for both: a key says "that way" in the player's own frame, and a finger says
    // "there" on the actual glass.
    const game = new SnowballThrowGame();
    game.init(context());
    const io = inputs();
    io.manager.pointerDown(2, 40, BASELINE_P2);
    drive(game, io, 30);
    expect(game.field.p2.x).toBeLessThan(BOARD_WIDTH / 2);
  });

  it('keeps a drag with the seat it started in, right across the midline', () => {
    const game = new SnowballThrowGame();
    game.init(context());
    const io = inputs();
    io.manager.pointerDown(3, 100, BASELINE_P1);
    drive(game, io, 20);
    // The finger crosses into the other player's half and keeps driving its own thrower.
    io.manager.pointerMove(3, BOARD_WIDTH - 60, BASELINE_P2);
    drive(game, io, 40);
    expect(game.field.p1.x).toBeGreaterThan(BOARD_WIDTH / 2);
    expect(game.field.p2.x).toBe(BOARD_WIDTH / 2);
  });

  it('throws the identical snowball from a key and from a thumb', () => {
    // The whole cross-device claim in one test. Both instruments walk right for the same
    // number of steps and then let go, and the snowball that leaves must be the same
    // object: same size, same launch point, same hook.
    const packTo = Math.ceil((STAGES[1] as Stage).windUp / STEP) + 2;

    const byKey = new SnowballThrowGame();
    byKey.init(context());
    const keyIo = inputs();
    keyIo.manager.keyDown('KeyD');
    keyIo.manager.keyDown('Space');
    drive(byKey, keyIo, packTo);
    keyIo.manager.keyUp('Space');
    drive(byKey, keyIo, 1);

    const byFinger = new SnowballThrowGame();
    byFinger.init(context());
    const fingerIo = inputs();
    // Far enough past the lane limit that the finger still reads as "keep walking" once
    // the thrower is against it: the deadzone is measured from the thrower, and a thrower
    // clamped at the edge of its lane is still forty-eight units short of the glass.
    fingerIo.manager.pointerDown(1, BOARD_WIDTH - 2, BASELINE_P1);
    drive(byFinger, fingerIo, packTo);
    fingerIo.manager.pointerUp(1);
    drive(byFinger, fingerIo, 1);

    const a = byKey.field.balls.find((ball) => ball.active);
    const b = byFinger.field.balls.find((ball) => ball.active);
    expect(a).toBeDefined();
    expect(b).toEqual(a);
  });

  it('lets go of nothing when the shell interrupts the gesture', () => {
    // Pausing clears every live pointer, which reaches a game as an ordinary
    // `actionReleased` on the first step back — the engine cannot yet tell a cancelled
    // gesture from a deliberate lift (`docs/input-idiom.md`, missing primitive 1).
    const packTo = Math.ceil((STAGES[0] as Stage).windUp / STEP) + 4;

    const paused = new SnowballThrowGame();
    paused.init(context());
    const pausedIo = inputs();
    pausedIo.manager.pointerDown(1, 320, BASELINE_P1);
    drive(paused, pausedIo, packTo);
    paused.onPause();
    pausedIo.manager.clear();
    paused.onResume();
    drive(paused, pausedIo, 4);
    expect(paused.field.p1.throws).toBe(0);

    // And the same gesture, deliberately ended, does throw.
    const lifted = new SnowballThrowGame();
    lifted.init(context());
    const liftedIo = inputs();
    liftedIo.manager.pointerDown(1, 320, BASELINE_P1);
    drive(lifted, liftedIo, packTo);
    liftedIo.manager.pointerUp(1);
    drive(lifted, liftedIo, 4);
    expect(lifted.field.p1.throws).toBe(1);
  });

  it('rests when a finger is sitting on the thrower, rather than creeping', () => {
    const game = new SnowballThrowGame();
    game.init(context());
    const io = inputs();
    io.manager.pointerDown(1, BOARD_WIDTH / 2 + 4, BASELINE_P1);
    drive(game, io, 60);
    expect(game.field.p1.x).toBe(BOARD_WIDTH / 2);
    expect(game.field.p1.dir).toBe(0);
  });

  it('drives a bot seat without touching the human one', () => {
    const game = new SnowballThrowGame();
    game.init(context({ botDifficulty: (seat: SeatId) => (seat === 'p2' ? 'normal' : null) }));
    const io = inputs();
    drive(game, io, 300);
    expect(game.field.p2.throws).toBeGreaterThan(0);
    expect(game.field.p1.throws).toBe(0);
    expect(game.field.p1.x).toBe(BOARD_WIDTH / 2);
  });

  it('plays the identical match from the same seed, and a different one from another', () => {
    const play = (seed: number): string => {
      const game = new SnowballThrowGame();
      game.init(context({ rng: new Rng(seed), botDifficulty: () => 'hard' }));
      const io = inputs();
      drive(game, io, 900);
      return JSON.stringify(game.field);
    };
    expect(play(7)).toBe(play(7));
    expect(play(8)).not.toBe(play(7));
  });

  it('hands the two bot seats separate streams', () => {
    // Derived from the match seed in a fixed order, so a seat's own play is a function of
    // the seed and never of which tier is sitting opposite. Two seats sharing one stream
    // would make the second seat's draws depend on how often the first one looked, and
    // `hard` looks nearly twice as often as `easy`.
    const game = new SnowballThrowGame();
    const source = new Rng(20260829);
    const first = source.next() | 0;
    const second = source.next() | 0;
    expect(first).not.toBe(second);
    game.init(context({ rng: new Rng(20260829), botDifficulty: () => 'hard' }));
    const io = inputs();
    drive(game, io, 600);
    // Two seats on one stream from a board that is its own mirror image would play the
    // same match twice over; separate streams are what make them two players.
    expect(game.field.p1.x).not.toBe(game.field.p2.x);
  });
});

describe('drawing', () => {
  it('does not move the simulation on', () => {
    const game = new SnowballThrowGame();
    game.init(context({ botDifficulty: () => 'normal' }));
    const io = inputs();
    drive(game, io, 400);
    const before = JSON.stringify(game.field);
    const calls: Call[] = [];
    const renderer = recorder(calls);
    for (let i = 0; i < 40; i += 1) {
      game.render(renderer, 0);
      game.render(renderer, 0.99);
    }
    expect(JSON.stringify(game.field)).toBe(before);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('interpolates between fixed steps rather than snapping', () => {
    const game = new SnowballThrowGame();
    game.init(context());
    const io = inputs();
    io.manager.keyDown('KeyD');
    drive(game, io, 20);
    const at = (alpha: number): number => {
      const calls: Call[] = [];
      game.render(recorder(calls), alpha);
      const thrower = calls.find(
        (call) => call.method === 'circle' && colourOf(call) === SEAT_PALETTE.p1.base,
      );
      return (thrower?.args[0] as number | undefined) ?? Number.NaN;
    };
    expect(at(0)).toBeCloseTo(game.field.p1.prevX, 9);
    expect(at(1)).toBeCloseTo(game.field.p1.x, 9);
    expect(at(0.5)).toBeCloseTo((game.field.p1.prevX + game.field.p1.x) / 2, 9);
  });

  it('draws every shape inside the declared box, through a whole match', () => {
    const game = new SnowballThrowGame();
    game.init(context({ botDifficulty: () => 'hard' }));
    const io = inputs();
    const calls: Call[] = [];
    const renderer = recorder(calls);
    for (let i = 0; i < 2400 && game.getScore().winner === null; i += 1) {
      drive(game, io, 1);
      game.render(renderer, 0.5);
    }
    const limit = Math.max(BOARD_WIDTH, BOARD_HEIGHT) * 1.1;
    for (const call of calls) {
      for (const arg of call.args) {
        if (typeof arg !== 'number') continue;
        expect(Math.abs(arg), `${call.method}(${String(arg)})`).toBeLessThanOrEqual(limit);
      }
    }
    expect(calls.length).toBeGreaterThan(1000);
  });

  it('draws no text at all', () => {
    // Nothing on this board needs reading, which is also what makes it work in any
    // language and at 320 pixels wide.
    const game = new SnowballThrowGame();
    game.init(context({ botDifficulty: () => 'normal' }));
    const io = inputs();
    const calls: Call[] = [];
    const renderer = recorder(calls);
    for (let i = 0; i < 1200; i += 1) {
      drive(game, io, 1);
      game.render(renderer, 0);
    }
    expect(calls.filter((call) => call.method === 'text')).toEqual([]);
  });

  it('tells the two seats apart by shape as well as by colour', () => {
    // Rule 7. The near seat is round and the far seat is square, everywhere: the thrower,
    // the mark inside every snowball it throws, and its row of health pips.
    const game = new SnowballThrowGame();
    game.init(context({ botDifficulty: () => 'normal' }));
    const io = inputs();
    drive(game, io, 400);
    const calls: Call[] = [];
    game.render(recorder(calls), 0);

    const round = new Set(['circle', 'strokeCircle']);
    const square = new Set(['rect', 'strokeRect']);
    const p1Round = calls.filter(
      (call) => round.has(call.method) && colourOf(call) === SEAT_PALETTE.p1.base,
    );
    const p2Square = calls.filter(
      (call) => square.has(call.method) && colourOf(call) === SEAT_PALETTE.p2.base,
    );
    expect(p1Round.length).toBeGreaterThan(0);
    expect(p2Square.length).toBeGreaterThan(0);
    // And never the other way round, which is what makes the rule survive greyscale.
    expect(
      calls.filter((call) => square.has(call.method) && colourOf(call) === SEAT_PALETTE.p1.base),
    ).toEqual([]);
    expect(
      calls.filter((call) => round.has(call.method) && colourOf(call) === SEAT_PALETTE.p2.base),
    ).toEqual([]);
  });

  it('shows the hook the bot reads, so the bot is reading the board', () => {
    // Rule 6 in the other direction: the bot extrapolates a snowball's curve, so the curve
    // has to be visible. It is a tick on the leading edge, and it is only drawn on a ball
    // that is actually hooking.
    const game = new SnowballThrowGame();
    game.init(context());
    const io = inputs();
    io.manager.keyDown('KeyD');
    io.manager.keyDown('Space');
    drive(game, io, Math.ceil((STAGES[0] as Stage).windUp / STEP) + 2);
    io.manager.keyUp('Space');
    drive(game, io, 2);
    const ball = game.field.balls.find((b) => b.active);
    expect(ball?.ax).toBeGreaterThan(0);
    const calls: Call[] = [];
    game.render(recorder(calls), 0);
    const ticks = calls.filter(
      (call) => call.method === 'line' && colourOf(call) === SEAT_PALETTE.p1.deep,
    );
    expect(ticks.length).toBeGreaterThan(0);
  });

  it('draws the clock, the ice and both rows of health without being asked', () => {
    const game = new SnowballThrowGame();
    game.init(context());
    const calls: Call[] = [];
    game.render(recorder(calls), 0);
    const pips = calls.filter(
      (call) =>
        (call.method === 'circle' && colourOf(call) === SEAT_PALETTE.p1.base) ||
        (call.method === 'rect' && colourOf(call) === SEAT_PALETTE.p2.base),
    );
    // Twenty pips a seat plus the two throwers and the two packed snowballs' owner marks.
    expect(pips.length).toBeGreaterThanOrEqual(HEALTH * 2);
    expect(calls.some((call) => call.method === 'strokeRect')).toBe(true);
  });
});

describe('a whole match', () => {
  it('is decided inside the clock at every pairing of tiers', () => {
    const tiers: BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (const p1 of tiers) {
      for (const p2 of tiers) {
        const game = new SnowballThrowGame();
        game.init(context({ botDifficulty: (seat: SeatId) => (seat === 'p1' ? p1 : p2) }));
        const io = inputs();
        let steps = 0;
        while (game.getScore().winner === null) {
          drive(game, io, 1);
          steps += 1;
          expect(steps, `${p1} v ${p2} never finished`).toBeLessThan(MATCH_SECONDS * 60 + 2);
        }
        const score = game.getScore();
        expect(score.winner).not.toBeNull();
        expect(Math.min(score.p1, score.p2)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('never walks a thrower off its own line', () => {
    const game = new SnowballThrowGame();
    game.init(context({ botDifficulty: () => 'hard' }));
    const io = inputs();
    for (let i = 0; i < 1800 && game.getScore().winner === null; i += 1) {
      drive(game, io, 1);
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        const thrower = throwerOf(game.field, seat);
        expect(thrower.x).toBeGreaterThanOrEqual(0);
        expect(thrower.x).toBeLessThanOrEqual(BOARD_WIDTH);
      }
    }
    expect(BASELINE_P1 + BASELINE_P2).toBe(BOARD_HEIGHT);
    expect(MOVE_SPEED).toBeGreaterThan(0);
  });
});
