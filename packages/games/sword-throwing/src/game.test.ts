import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, Renderer } from '@duelbox/game-sdk';
import { SwordThrowingGame } from './game.js';
import { manifest } from './manifest.js';
import { gameModule } from './index.js';
import {
  BLADE_RANGE,
  BLADE_SPEED,
  CENTRE_X,
  CENTRE_Y,
  GUARD_V,
  MAX_AIM,
  MAX_THROWS,
  TARGETS_PER_SEAT,
  WIN_HITS,
  otherOf,
} from './rules.js';
import type { BotDifficulty, State } from './rules.js';

const STEP = 1 / 60;
/** Ten minutes of simulated play: the platform's own termination ceiling. */
const STEP_CAP = 60 * 600;

const P1_KEYS = { left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS', action: 'Space' };
const P2_KEYS = {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  action: 'Enter',
};

interface Rig {
  readonly game: SwordThrowingGame;
  readonly input: InputManager;
  readonly view: InputView;
  readonly state: State;
  step(times?: number): void;
}

function context(options?: {
  seed?: number;
  bots?: Partial<Record<SeatId, BotDifficulty>>;
  presentation?: 'shared-screen' | 'single-seat';
  localSeat?: SeatId;
}): GameContext {
  const bots = options?.bots ?? {};
  return {
    manifest,
    rng: new Rng(options?.seed ?? 17),
    presentation: options?.presentation ?? 'shared-screen',
    localSeat: options?.localSeat ?? 'p1',
    openingSeat: 'p1',
    botDifficulty: (seat) => bots[seat] ?? null,
  };
}

/**
 * A game wired to a real `InputManager`, driven exactly as `GameHost` drives it.
 *
 * The board is shared and belongs to whoever is to act, and the host hands it over when
 * `getActiveSeat` changes — so every control test below goes through the same sorting into
 * seats that a browser does, rather than through a hand-made input object that could agree
 * with the game about something the engine does not.
 */
function rig(options?: Parameters<typeof context>[0]): Rig {
  const game = new SwordThrowingGame();
  game.init(context(options));
  const input = new InputManager(manifest.logical, { split: 'shared', bottomSeat: 'p1' });
  const view = new InputView();
  return {
    game,
    input,
    view,
    state: game.state,
    step(times = 1) {
      for (let i = 0; i < times; i += 1) {
        input.setBoardSeat(game.getActiveSeat());
        game.update(STEP, view.sync(input.beginStep(STEP)));
      }
    },
  };
}

/** Step until a predicate holds. Bounded: a runaway loop hangs vitest rather than failing. */
function until(rigged: Rig, done: () => boolean, cap = 1200): number {
  for (let i = 0; i < cap; i += 1) {
    if (done()) return i;
    rigged.step();
  }
  return -1;
}

function recordingRenderer(): { renderer: Renderer; calls: string[]; texts: number } {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push(`${name}:${args.filter((a) => typeof a === 'number').join(',')}`);
    };
  let texts = 0;
  const renderer: Renderer = {
    clear: () => calls.push('clear'),
    rect: record('rect'),
    strokeRect: record('strokeRect'),
    circle: record('circle'),
    strokeCircle: record('strokeCircle'),
    line: record('line'),
    text: () => {
      texts += 1;
    },
    pushSeatRotation: () => calls.push('push'),
    pushRotation: () => calls.push('pushRotation'),
    popSeatRotation: () => calls.push('pop'),
  };
  return {
    renderer,
    calls,
    get texts() {
      return texts;
    },
  };
}

/**
 * One bot-versus-bot match, with what happened **reconstructed from sampled state**.
 *
 * Deliberately not read off the game's own outcome record. A counter can be wrong in the
 * same way the rule is, and a game whose headline verb never actually happens still ends
 * and still reports a winner — which is exactly how a game in this collection shipped with
 * its core mechanic impossible and passed every platform guard. So a hit is counted when a
 * rack's own tally of swords goes up, and a parry when a flight ends with the sword
 * standing on the defender's guard line and nothing in the rack having moved.
 */
function botMatch(p1: BotDifficulty, p2: BotDifficulty, seed: number) {
  const rigged = rig({ seed, bots: { p1, p2 } });
  const state = rigged.state;
  let throws = 0;
  let hits = 0;
  let parries = 0;
  let misses = 0;
  let rack = 0;
  let steps = 0;
  const total = (): number => {
    let sum = 0;
    for (const n of state.p1.struck) sum += n;
    for (const n of state.p2.struck) sum += n;
    return sum;
  };
  for (let i = 0; i < STEP_CAP; i += 1) {
    const flying = state.phase === 'flying';
    const before = state.throws;
    rigged.step();
    steps += 1;
    if (state.throws > before) throws += 1;
    const now = total();
    if (now > rack) {
      hits += 1;
      rack = now;
    } else if (flying && state.phase !== 'flying') {
      // The sword came to rest exactly on the guard line and took nothing with it: that is
      // a blade having met it, reconstructed from where it stopped.
      if (Math.abs(state.shot.v - GUARD_V) < 1e-9) parries += 1;
      else misses += 1;
    }
    if (rigged.game.getScore().winner !== null) break;
  }
  const score = rigged.game.getScore();
  rigged.game.destroy();
  return { ...score, throws, hits, parries, misses, steps, seconds: steps * STEP };
}

describe('the module', () => {
  it('exports the manifest and a factory', () => {
    expect(gameModule.manifest.id).toBe('sword-throwing');
    expect(gameModule.create()).toBeInstanceOf(SwordThrowingGame);
  });

  it('answers the whole Game contract', () => {
    const game: Game = gameModule.create();
    game.init(context());
    expect(typeof game.update).toBe('function');
    expect(typeof game.render).toBe('function');
    expect(typeof game.getScore).toBe('function');
    expect(typeof game.getActiveSeat).toBe('function');
    game.onPause();
    game.onResume();
    game.render(recordingRenderer().renderer, 0);
    game.destroy();
  });

  it('is declared as a turn game and answers with a seat', () => {
    expect(manifest.archetype.startsWith('turn-')).toBe(true);
    const game = gameModule.create();
    game.init(context());
    expect(game.getActiveSeat?.()).not.toBeNull();
  });
});

describe('the manifest', () => {
  it('declares the board the simulation actually uses', () => {
    expect(manifest.logical.width).toBe(CENTRE_X * 2);
    expect(manifest.logical.height).toBe(CENTRE_Y * 2);
  });

  it('offers both seats a shared board, because only one of them acts at a time', () => {
    expect(manifest.zoneSplit).toBe('shared-board');
  });

  it('says something to both input families', () => {
    expect(manifest.controls.keyboard.length).toBeGreaterThan(3);
    expect(manifest.controls.pointer.length).toBeGreaterThan(3);
  });

  it('never offers one player both halves of the keyboard', () => {
    // The exact check the platform's own controls guard makes.
    expect(manifest.controls.keyboard).not.toMatch(/\bor\b[^,:]*arrow/i);
    expect(manifest.controls.keyboard).toMatch(/player one|player two|seat|left|right|near|far/i);
    expect(manifest.controls.keyboard).toMatch(/w a s d|\ba and d\b|left and right/i);
  });

  it('names the keys it really reads and no others', () => {
    expect(manifest.controls.keyboard).toContain('A and D');
    expect(manifest.controls.keyboard).toContain('Space');
    expect(manifest.controls.keyboard).toContain('Enter');
    expect(manifest.controls.keyboard).toContain('arrows');
    // Nothing here reads an up or a down key, and the string does not claim it does.
    expect(manifest.controls.keyboard).not.toMatch(/\bW\b|\bS\b|up|down/i);
  });

  it('promises a pointer idiom for both halves of a turn', () => {
    expect(manifest.controls.pointer).toMatch(/drag/i);
    expect(manifest.controls.pointer).toMatch(/lift/i);
    expect(manifest.controls.pointer).toMatch(/parry/i);
  });
});

describe('whose turn the shell is told it is', () => {
  it('is the thrower until the sword leaves the hand, then the defender', () => {
    const rigged = rig();
    expect(rigged.game.getActiveSeat()).toBe('p1');
    rigged.input.keyDown(P1_KEYS.action);
    rigged.step();
    expect(rigged.state.phase).toBe('flying');
    expect(rigged.game.getActiveSeat()).toBe('p2');
  });

  it('hands the pointer surface over with it', () => {
    const rigged = rig();
    rigged.input.keyDown(P1_KEYS.action);
    rigged.step();
    rigged.input.keyUp(P1_KEYS.action);
    rigged.step();
    // The board now belongs to p2, so a finger anywhere on it is p2's.
    rigged.input.pointerDown(1, 100, 900);
    rigged.step();
    expect(rigged.view.sync(rigged.input.state).seat('p2').pointer).not.toBeNull();
    expect(rigged.view.sync(rigged.input.state).seat('p1').pointer).toBeNull();
  });

  it('never reports a seat that is not playing', () => {
    const rigged = rig({ bots: { p1: 'normal', p2: 'normal' } });
    for (let i = 0; i < 600; i += 1) {
      const seat: string = rigged.game.getActiveSeat();
      expect(['p1', 'p2']).toContain(seat);
      rigged.step();
    }
  });
});

describe('the keyboard, seat one', () => {
  it('swings the sight with A and D on its own turn', () => {
    const rigged = rig();
    rigged.input.keyDown(P1_KEYS.right);
    rigged.step(20);
    expect(rigged.state.aim).toBeGreaterThan(0);
    rigged.input.keyUp(P1_KEYS.right);
    rigged.input.keyDown(P1_KEYS.left);
    rigged.step(40);
    expect(rigged.state.aim).toBeLessThan(0);
  });

  it('throws on Space', () => {
    const rigged = rig();
    rigged.input.keyDown(P1_KEYS.action);
    rigged.step();
    expect(rigged.state.throws).toBe(1);
    expect(rigged.state.p1Throws).toBe(1);
  });

  it('throws on the press rather than on the release', () => {
    const rigged = rig();
    rigged.input.keyDown(P1_KEYS.action);
    rigged.step();
    expect(rigged.state.phase).toBe('flying');
  });

  it('throws once for one press, however long it is held', () => {
    const rigged = rig();
    rigged.input.keyDown(P1_KEYS.action);
    rigged.step(200);
    expect(rigged.state.throws).toBeLessThanOrEqual(2);
  });

  it('carries its blade with A and D while being thrown at', () => {
    const rigged = rig();
    rigged.input.keyDown(P2_KEYS.action);
    // Not p2's turn: nothing happens, so p1 still has to throw first.
    rigged.step();
    expect(rigged.state.throws).toBe(0);
    rigged.input.keyUp(P2_KEYS.action);
    rigged.input.keyDown(P1_KEYS.action);
    rigged.step();
    rigged.input.keyUp(P1_KEYS.action);
    // p2 is the defender now; p1's keys must do nothing to anybody's blade.
    const p1Before = rigged.state.p1.blade;
    rigged.input.keyDown(P1_KEYS.right);
    rigged.step(20);
    expect(rigged.state.p1.blade).toBe(p1Before);
    rigged.input.keyUp(P1_KEYS.right);

    // Now the other way round: p2 throws, p1 defends, and A and D move p1's blade.
    until(rigged, () => rigged.state.thrower === 'p2' && rigged.state.phase === 'aiming');
    rigged.input.keyDown(P2_KEYS.action);
    rigged.step();
    rigged.input.keyUp(P2_KEYS.action);
    const before = rigged.state.p1.blade;
    rigged.input.keyDown(P1_KEYS.right);
    rigged.step(10);
    expect(rigged.state.p1.blade).toBeGreaterThan(before);
  });

  it('cannot reach seat two’s sight with its own keys', () => {
    const rigged = rig();
    until(rigged, () => false, 1);
    rigged.input.keyDown(P2_KEYS.right);
    rigged.step(30);
    expect(rigged.state.aim).toBe(0);
  });
});

describe('the keyboard, seat two', () => {
  function handToSeatTwo(rigged: Rig): void {
    rigged.input.keyDown(P1_KEYS.action);
    rigged.step();
    rigged.input.keyUp(P1_KEYS.action);
    const found = until(
      rigged,
      () => rigged.state.thrower === 'p2' && rigged.state.phase === 'aiming',
    );
    expect(found).toBeGreaterThan(0);
  }

  it('swings the sight with the arrow keys on its own turn', () => {
    const rigged = rig();
    handToSeatTwo(rigged);
    rigged.input.keyDown(P2_KEYS.right);
    rigged.step(20);
    expect(rigged.state.aim).not.toBe(0);
  });

  it('throws on Enter', () => {
    const rigged = rig();
    handToSeatTwo(rigged);
    rigged.input.keyDown(P2_KEYS.action);
    rigged.step();
    expect(rigged.state.p2Throws).toBe(1);
  });

  it('is not moved by seat one’s keys', () => {
    const rigged = rig();
    handToSeatTwo(rigged);
    rigged.input.keyDown(P1_KEYS.right);
    rigged.input.keyDown(P1_KEYS.action);
    rigged.step(30);
    expect(rigged.state.aim).toBe(0);
    expect(rigged.state.p2Throws).toBe(0);
  });

  it('carries its blade with the arrow keys while being thrown at', () => {
    const rigged = rig();
    rigged.input.keyDown(P1_KEYS.action);
    rigged.step();
    rigged.input.keyUp(P1_KEYS.action);
    const before = rigged.state.p2.blade;
    rigged.input.keyDown(P2_KEYS.left);
    rigged.step(12);
    expect(rigged.state.p2.blade).not.toBe(before);
    expect(Math.abs(rigged.state.p2.blade - before)).toBeCloseTo(BLADE_SPEED * STEP * 12, 6);
  });

  it('moves its blade to the left when it presses left', () => {
    // Seat two's arena runs the other way round, so this is the check that the two facts
    // cancel: pressing left must move the blade left *on the screen*, as it does for the
    // other seat, exactly as every real-time game in the collection does it.
    const rigged = rig();
    rigged.input.keyDown(P1_KEYS.action);
    rigged.step();
    rigged.input.keyUp(P1_KEYS.action);
    const worldBefore = CENTRE_X - rigged.state.p2.blade;
    rigged.input.keyDown(P2_KEYS.left);
    rigged.step(12);
    const worldAfter = CENTRE_X - rigged.state.p2.blade;
    expect(worldAfter).toBeLessThan(worldBefore);
  });
});

describe('the pointer', () => {
  it('points the sword at the finger', () => {
    const rigged = rig();
    rigged.input.pointerDown(1, CENTRE_X + 200, CENTRE_Y - 200);
    rigged.step(2);
    expect(rigged.state.aim).toBeGreaterThan(0);
    rigged.input.pointerMove(1, CENTRE_X - 200, CENTRE_Y - 200);
    rigged.step(2);
    expect(rigged.state.aim).toBeLessThan(0);
  });

  it('throws when the finger lifts, not when it lands', () => {
    const rigged = rig();
    rigged.input.pointerDown(1, CENTRE_X + 90, CENTRE_Y - 300);
    rigged.step(4);
    expect(rigged.state.throws).toBe(0);
    rigged.input.pointerUp(1);
    rigged.step(2);
    expect(rigged.state.throws).toBe(1);
  });

  it('keeps the aim it was released at', () => {
    const rigged = rig();
    rigged.input.pointerDown(1, CENTRE_X + 90, CENTRE_Y - 300);
    rigged.step(4);
    const aimed = rigged.state.aim;
    rigged.input.pointerUp(1);
    rigged.step();
    expect(rigged.state.aim).toBeCloseTo(aimed, 12);
  });

  it('cannot aim outside the cone however far off the board the finger goes', () => {
    const rigged = rig();
    rigged.input.pointerDown(1, CENTRE_X + 4000, CENTRE_Y - 10);
    rigged.step(3);
    expect(rigged.state.aim).toBe(MAX_AIM);
  });

  it('carries the defender’s blade towards the finger', () => {
    const rigged = rig();
    rigged.input.keyDown(P1_KEYS.action);
    rigged.step();
    rigged.input.keyUp(P1_KEYS.action);
    // One more step so the board has actually changed hands before the finger lands: the
    // host moves pointer ownership on the frame *after* the active seat changes, and a
    // finger that arrives before that belongs to the seat that has just thrown.
    rigged.step();
    rigged.state.p2.blade = 0;
    rigged.input.pointerDown(2, CENTRE_X - 250, CENTRE_Y - 200);
    rigged.step(10);
    // Seat two's local frame runs the other way, so a finger to the left of the centre
    // line is a positive move in their own numbers.
    expect(rigged.state.p2.blade).toBeGreaterThan(0);
  });

  it('never carries the blade faster than a key does', () => {
    // A finger that named a place outright would be a strictly better instrument than a
    // key, which is the one thing rule 10 will not have.
    const rigged = rig();
    rigged.input.keyDown(P1_KEYS.action);
    rigged.step();
    rigged.input.keyUp(P1_KEYS.action);
    rigged.step();
    rigged.state.p2.blade = 0;
    rigged.input.pointerDown(2, CENTRE_X + 5000, CENTRE_Y);
    let moved = 0;
    for (let i = 0; i < 12; i += 1) {
      const before = rigged.state.p2.blade;
      rigged.step();
      const delta = Math.abs(rigged.state.p2.blade - before);
      moved += delta;
      expect(delta).toBeLessThanOrEqual(BLADE_SPEED * STEP + 1e-9);
    }
    // And it did move, or the cap above would be satisfied by a blade that never stirred.
    expect(moved).toBeCloseTo(BLADE_SPEED * STEP * 12, 6);
  });

  it('reaches the same throw as the keyboard does', () => {
    // The same intent said twice: point at a place, or walk the sight to the same angle.
    const byThumb = rig({ seed: 55 });
    byThumb.input.pointerDown(1, CENTRE_X + 180, CENTRE_Y - 260);
    byThumb.step(3);
    const wanted = byThumb.state.aim;

    const byKey = rig({ seed: 55 });
    byKey.input.keyDown(P1_KEYS.right);
    const walked = until(byKey, () => byKey.state.aim >= wanted, 600);
    expect(walked).toBeGreaterThan(0);
    expect(byKey.state.aim).toBeGreaterThanOrEqual(wanted);
    // And the walk is quick enough to be a control rather than a chore.
    expect(walked * STEP).toBeLessThan(1.5);
  });

  it('does not fire a throw the moment the finger lands', () => {
    const rigged = rig();
    rigged.input.pointerDown(1, CENTRE_X, CENTRE_Y - 100);
    rigged.step();
    expect(rigged.state.throws).toBe(0);
  });

  it('is a fresh instrument every turn', () => {
    // A finger held through a hand-over must not commit the next player's throw.
    const rigged = rig();
    rigged.input.pointerDown(1, CENTRE_X + 60, CENTRE_Y - 300);
    rigged.step(3);
    rigged.input.pointerUp(1);
    until(rigged, () => rigged.state.thrower === 'p2' && rigged.state.phase === 'aiming');
    expect(rigged.state.p2Throws).toBe(0);
    rigged.step(10);
    expect(rigged.state.p2Throws).toBe(0);
  });
});

describe('nobody may act out of turn', () => {
  it('ignores the defender’s action key entirely', () => {
    const rigged = rig();
    rigged.input.keyDown(P2_KEYS.action);
    rigged.step(60);
    expect(rigged.state.throws).toBe(0);
    expect(rigged.state.aim).toBe(0);
  });

  it('ignores the thrower’s keys once the sword has gone', () => {
    const rigged = rig();
    rigged.input.keyDown(P1_KEYS.action);
    rigged.step();
    const aim = rigged.state.aim;
    rigged.input.keyDown(P1_KEYS.left);
    rigged.step(20);
    expect(rigged.state.aim).toBe(aim);
  });

  it('lets two people press at once without either reaching the other’s turn', () => {
    const rigged = rig();
    rigged.input.keyDown(P1_KEYS.right);
    rigged.input.keyDown(P2_KEYS.left);
    rigged.step(20);
    expect(rigged.state.aim).toBeGreaterThan(0);
    const solo = rig();
    solo.input.keyDown(P1_KEYS.right);
    solo.step(20);
    expect(rigged.state.aim).toBeCloseTo(solo.state.aim, 12);
  });
});

describe('the scoreboard', () => {
  it('starts level', () => {
    const rigged = rig();
    expect(rigged.game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('counts swords landed in the other seat’s rack', () => {
    const rigged = rig();
    rigged.state.p2.struck[1] = 2;
    rigged.state.p1.struck[0] = 1;
    expect(rigged.game.getScore().p1).toBe(2);
    expect(rigged.game.getScore().p2).toBe(1);
  });

  it('is always a finite number', () => {
    const rigged = rig({ bots: { p1: 'hard', p2: 'easy' } });
    for (let i = 0; i < 900; i += 1) {
      const score = rigged.game.getScore();
      expect(Number.isFinite(score.p1)).toBe(true);
      expect(Number.isFinite(score.p2)).toBe(true);
      rigged.step();
    }
  });

  it('reports the winner the rules decided', () => {
    const match = botMatch('hard', 'easy', 3);
    expect(match.winner).not.toBeNull();
    expect(Math.max(match.p1, match.p2)).toBeGreaterThanOrEqual(WIN_HITS);
  });
});

describe('rendering', () => {
  it('draws something', () => {
    const rigged = rig();
    const recorder = recordingRenderer();
    rigged.game.render(recorder.renderer, 0);
    expect(recorder.calls.length).toBeGreaterThan(20);
  });

  it('draws no text of its own', () => {
    // The shell owns the HUD, the countdown, the turn indicator and the result. A second
    // scoreboard on the board could only ever disagree with the first.
    const rigged = rig({ bots: { p1: 'normal', p2: 'normal' } });
    const recorder = recordingRenderer();
    for (let i = 0; i < 600; i += 1) {
      rigged.step();
      rigged.game.render(recorder.renderer, 0);
    }
    expect(recorder.texts).toBe(0);
  });

  it('pairs every rotation with a pop', () => {
    const rigged = rig();
    const recorder = recordingRenderer();
    rigged.game.render(recorder.renderer, 0);
    const pushes = recorder.calls.filter((call) => call === 'push').length;
    const pops = recorder.calls.filter((call) => call === 'pop').length;
    expect(pushes).toBe(pops);
    expect(pushes).toBe(1);
  });

  it('keeps everything it draws inside the declared box', () => {
    const rigged = rig({ bots: { p1: 'hard', p2: 'hard' } });
    const recorder = recordingRenderer();
    for (let i = 0; i < 300; i += 1) {
      rigged.step();
      rigged.game.render(recorder.renderer, 0);
    }
    const limit = Math.max(manifest.logical.width, manifest.logical.height) * 2;
    for (const call of recorder.calls) {
      for (const part of call.split(':')[1]?.split(',') ?? []) {
        if (part === '') continue;
        expect(Math.abs(Number(part))).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('hides the sword of the seat that has thrown it', () => {
    // You cannot parry with a sword you no longer hold, and the board says so.
    const rigged = rig();
    const before = recordingRenderer();
    rigged.game.render(before.renderer, 0);
    rigged.input.keyDown(P1_KEYS.action);
    rigged.step(4);
    const during = recordingRenderer();
    rigged.game.render(during.renderer, 0);
    expect(during.calls.length).toBeLessThan(before.calls.length);
  });

  it('never mutates the state it is drawing', () => {
    const rigged = rig({ bots: { p1: 'normal', p2: 'normal' } });
    rigged.step(120);
    const snapshot = JSON.stringify(rigged.state);
    const recorder = recordingRenderer();
    for (let i = 0; i < 10; i += 1) rigged.game.render(recorder.renderer, 0);
    expect(JSON.stringify(rigged.state)).toBe(snapshot);
  });
});

describe('determinism', () => {
  it('plays the identical match from the identical seed', () => {
    const a = rig({ seed: 4242, bots: { p1: 'hard', p2: 'normal' } });
    const b = rig({ seed: 4242, bots: { p1: 'hard', p2: 'normal' } });
    for (let i = 0; i < 900; i += 1) {
      a.step();
      b.step();
      expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
    }
  });

  it('plays a different match from a different seed', () => {
    const a = rig({ seed: 1, bots: { p1: 'hard', p2: 'normal' } });
    const b = rig({ seed: 2, bots: { p1: 'hard', p2: 'normal' } });
    a.step(900);
    b.step(900);
    expect(JSON.stringify(b.state)).not.toBe(JSON.stringify(a.state));
  });

  it('steps the same match in both presentations', () => {
    // Rules and simulation are byte-identical across the two; only placement and control
    // mapping change. A divergence here is a desynchronised remote match.
    const shared = rig({ seed: 808, bots: { p1: 'normal', p2: 'hard' } });
    const single = rig({
      seed: 808,
      bots: { p1: 'normal', p2: 'hard' },
      presentation: 'single-seat',
      localSeat: 'p2',
    });
    for (let i = 0; i < 900; i += 1) {
      shared.step();
      single.step();
      expect(single.state.shot.u).toBe(shared.state.shot.u);
      expect(single.state.shot.v).toBe(shared.state.shot.v);
      expect(single.state.p1.blade).toBe(shared.state.p1.blade);
      expect(single.state.p2.blade).toBe(shared.state.p2.blade);
    }
  });

  it('starts a second match cleanly after a first', () => {
    const game = new SwordThrowingGame();
    game.init(context({ seed: 61, bots: { p1: 'hard', p2: 'hard' } }));
    const input = new InputManager(manifest.logical, { split: 'shared', bottomSeat: 'p1' });
    const view = new InputView();
    for (let i = 0; i < 600; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    const first = JSON.stringify(game.state);
    game.destroy();
    game.init(context({ seed: 61, bots: { p1: 'hard', p2: 'hard' } }));
    for (let i = 0; i < 600; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(JSON.stringify(game.state)).toBe(first);
  });

  it('is cleared out by destroy', () => {
    const rigged = rig({ bots: { p1: 'hard', p2: 'hard' } });
    rigged.step(600);
    rigged.game.destroy();
    expect(rigged.game.getScore().winner).toBeNull();
    expect(rigged.state.throws).toBe(0);
    expect(rigged.state.phase).toBe('aiming');
  });
});

describe('a seat with nobody in it', () => {
  it('waits, for ever, rather than playing itself', () => {
    // A silent human throws nothing and the turn never passes. The platform's own
    // termination guard says the same thing from the other side: a trace that stops
    // pressing keys proves nothing about a game that needs input to progress.
    const rigged = rig();
    rigged.step(3000);
    expect(rigged.state.throws).toBe(0);
    expect(rigged.game.getScore().winner).toBeNull();
  });

  it('does not let a bot in one seat take the other seat’s turn', () => {
    const rigged = rig({ bots: { p2: 'hard' } });
    rigged.step(1800);
    expect(rigged.state.p1Throws).toBe(0);
    expect(rigged.state.p2Throws).toBe(0);
  });

  it('lets a bot in seat one play on alone until it is seat two’s turn', () => {
    const rigged = rig({ bots: { p1: 'hard' } });
    rigged.step(1800);
    expect(rigged.state.p1Throws).toBe(1);
    expect(rigged.state.thrower).toBe('p2');
  });
});

describe('the mechanic, measured', () => {
  /**
   * The headline. Both halves of the observed rule have to be shown *happening*, over many
   * seeded matches, counted from state rather than from the game's own record — because a
   * match that ends and reports a winner proves nothing at all about whether the game was
   * played the way its rule says.
   */
  const SEEDS = 60;

  function sweep(tier: BotDifficulty) {
    let throws = 0;
    let hits = 0;
    let parries = 0;
    let misses = 0;
    let finished = 0;
    let worst = 0;
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const match = botMatch(tier, tier, 90000 + seed);
      throws += match.throws;
      hits += match.hits;
      parries += match.parries;
      misses += match.misses;
      if (match.winner !== null) finished += 1;
      worst = Math.max(worst, match.seconds);
    }
    return { throws, hits, parries, misses, finished, worst };
  }

  it('lands swords in the rack, at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const swept = sweep(tier);
      expect(swept.throws).toBeGreaterThan(SEEDS * 5);
      expect(swept.hits / swept.throws).toBeGreaterThan(0.4);
    }
  });

  it('parries throws out of the air, at every tier', () => {
    // The half of the rule that a game like this quietly loses. A zero here would mean the
    // parry does not exist however green the rest of the suite is.
    const rates: number[] = [];
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const swept = sweep(tier);
      const rate = swept.parries / swept.throws;
      expect(swept.parries).toBeGreaterThan(0);
      expect(rate).toBeGreaterThan(0.05);
      rates.push(rate);
    }
    // And it is a skill, not a coin toss: better tiers parry more.
    expect(rates[1] ?? 0).toBeGreaterThan(rates[0] ?? 0);
    expect(rates[2] ?? 0).toBeGreaterThan(rates[1] ?? 0);
  });

  it('accounts for every throw as a hit, a parry or a miss', () => {
    const swept = sweep('normal');
    expect(swept.hits + swept.parries + swept.misses).toBe(swept.throws);
  });

  it('finishes every match well inside the platform ceiling', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const swept = sweep(tier);
      expect(swept.finished).toBe(SEEDS);
      expect(swept.worst).toBeLessThan(600);
      expect(swept.worst).toBeLessThan(120);
    }
  });

  it('never runs past the throw cap', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const match = botMatch('easy', 'easy', 50000 + seed);
      expect(match.throws).toBeLessThanOrEqual(MAX_THROWS);
    }
  });
});

describe('the bot ladder, through the shipped game', () => {
  function duel(a: BotDifficulty, b: BotDifficulty, seeds: number) {
    let stronger = 0;
    let weaker = 0;
    let draws = 0;
    for (let seed = 0; seed < seeds; seed += 1) {
      // Both seat orders, so a seat advantage cannot masquerade as a tier advantage.
      const first = botMatch(a, b, 61000 + seed);
      if (first.winner === 'p1') stronger += 1;
      else if (first.winner === 'p2') weaker += 1;
      else draws += 1;
      const second = botMatch(b, a, 61000 + seed);
      if (second.winner === 'p2') stronger += 1;
      else if (second.winner === 'p1') weaker += 1;
      else draws += 1;
    }
    return { stronger, weaker, draws, total: seeds * 2 };
  }

  it('puts normal above easy', () => {
    const result = duel('normal', 'easy', 25);
    expect(result.stronger / result.total).toBeGreaterThan(0.75);
  });

  it('puts hard above easy', () => {
    const result = duel('hard', 'easy', 25);
    expect(result.stronger / result.total).toBeGreaterThan(0.85);
  });

  it('puts hard above normal', () => {
    const result = duel('hard', 'normal', 25);
    expect(result.stronger / result.total).toBeGreaterThan(0.6);
    expect(result.stronger).toBeGreaterThan(result.weaker);
  });

  it('plays a visibly different match on easy and on hard', () => {
    const easy = botMatch('easy', 'easy', 12);
    const hard = botMatch('hard', 'hard', 12);
    expect(hard.parries / hard.throws).toBeGreaterThan(easy.parries / easy.throws);
  });

  it('does not favour a seat at any tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      let p1 = 0;
      let decided = 0;
      for (let seed = 0; seed < 40; seed += 1) {
        const match = botMatch(tier, tier, 33000 + seed);
        if (match.winner === 'p1') {
          p1 += 1;
          decided += 1;
        } else if (match.winner === 'p2') decided += 1;
      }
      expect(p1 / decided).toBeGreaterThan(0.25);
      expect(p1 / decided).toBeLessThan(0.75);
    }
  });
});

describe('a person against a bot', () => {
  it('can be beaten, and can win', () => {
    // A crude but genuine human: aims at a target it can see and parries by running at the
    // sword. It should not be shut out by the weakest tier.
    let wins = 0;
    for (let seed = 0; seed < 20; seed += 1) {
      const rigged = rig({ seed: 12000 + seed, bots: { p2: 'easy' } });
      const state = rigged.state;
      for (let i = 0; i < STEP_CAP; i += 1) {
        if (state.thrower === 'p1' && state.phase === 'aiming') {
          const target = state.slots[(seed + state.throws) % TARGETS_PER_SEAT] ?? 0;
          const wanted = Math.atan2(-target - state.p1.blade, GUARD_V * 2 + 328);
          if (state.aim < wanted - 0.02) rigged.input.keyDown(P1_KEYS.right);
          else if (state.aim > wanted + 0.02) rigged.input.keyDown(P1_KEYS.left);
          else {
            rigged.input.keyUp(P1_KEYS.left);
            rigged.input.keyUp(P1_KEYS.right);
            rigged.input.keyDown(P1_KEYS.action);
          }
        } else {
          rigged.input.keyUp(P1_KEYS.action);
          rigged.input.keyUp(P1_KEYS.left);
          rigged.input.keyUp(P1_KEYS.right);
          if (state.phase === 'flying' && state.thrower === 'p2') {
            const chase = state.shot.u > state.p1.blade;
            rigged.input.keyDown(chase ? P1_KEYS.right : P1_KEYS.left);
          }
        }
        rigged.step();
        if (rigged.game.getScore().winner !== null) break;
      }
      if (rigged.game.getScore().winner === 'p1') wins += 1;
      rigged.game.destroy();
    }
    expect(wins).toBeGreaterThan(0);
  });

  it('is not required to be a bot to move anything', () => {
    const rigged = rig({ bots: { p2: 'hard' } });
    rigged.input.pointerDown(1, CENTRE_X - 200, CENTRE_Y - 350);
    rigged.step(5);
    rigged.input.pointerUp(1);
    rigged.step(3);
    expect(rigged.state.p1Throws).toBe(1);
  });
});

describe('boundaries', () => {
  it('keeps every blade on its own guard line', () => {
    const rigged = rig({ bots: { p1: 'hard', p2: 'hard' } });
    for (let i = 0; i < 1800; i += 1) {
      rigged.step();
      expect(Math.abs(rigged.state.p1.blade)).toBeLessThanOrEqual(BLADE_RANGE);
      expect(Math.abs(rigged.state.p2.blade)).toBeLessThanOrEqual(BLADE_RANGE);
    }
  });

  it('keeps every aim inside the cone', () => {
    const rigged = rig({ bots: { p1: 'easy', p2: 'hard' } });
    for (let i = 0; i < 1800; i += 1) {
      rigged.step();
      expect(Math.abs(rigged.state.aim)).toBeLessThanOrEqual(MAX_AIM);
    }
  });

  it('survives a pause and a resume mid-flight', () => {
    const rigged = rig({ bots: { p1: 'normal', p2: 'normal' } });
    rigged.step(120);
    const before = JSON.stringify(rigged.state);
    rigged.game.onPause();
    rigged.game.onResume();
    expect(JSON.stringify(rigged.state)).toBe(before);
  });

  it('takes a zero-length step without moving anything', () => {
    const rigged = rig({ bots: { p1: 'hard', p2: 'hard' } });
    rigged.step(90);
    const before = JSON.stringify(rigged.state);
    rigged.game.update(0, rigged.view.sync(rigged.input.beginStep(0)));
    expect(JSON.stringify(rigged.state)).toBe(before);
  });

  it('ignores a finger that arrives in the middle of a flight for the thrower', () => {
    const rigged = rig();
    rigged.input.keyDown(P1_KEYS.action);
    rigged.step();
    rigged.input.keyUp(P1_KEYS.action);
    const aim = rigged.state.aim;
    rigged.input.pointerDown(9, CENTRE_X + 300, CENTRE_Y - 400);
    rigged.step(6);
    expect(rigged.state.aim).toBe(aim);
  });

  it('lets the defender who parried throw from where they finished', () => {
    const rigged = rig({ bots: { p1: 'hard', p2: 'hard' } });
    until(rigged, () => rigged.state.phase === 'flying');
    until(rigged, () => rigged.state.phase === 'settling');
    const landed = rigged.state.p2.blade;
    until(rigged, () => rigged.state.thrower === 'p2' && rigged.state.phase === 'aiming');
    expect(rigged.state.p2.blade).toBe(landed);
    expect(otherOf(rigged.state.thrower)).toBe('p1');
  });
});
