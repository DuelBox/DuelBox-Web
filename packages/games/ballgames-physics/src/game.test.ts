import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { BallGamesGame } from './game.js';
import {
  CENTRE_X,
  CENTRE_Y,
  GOAL_TARGET,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  MATCH_SECONDS,
  PITCH_HALF_H,
  PITCH_HALF_W,
  PLAYER_RADIUS,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;

interface MutableSeatInput {
  move: Vec2;
  pointer: Vec2 | null;
  actionPressed: boolean;
  actionHeld: boolean;
  actionReleased: boolean;
  holdSeconds: number;
  holdSecondsAtRelease: number;
}

function blankSeat(): MutableSeatInput {
  return {
    move: vec2(),
    pointer: null,
    actionPressed: false,
    actionHeld: false,
    actionReleased: false,
    holdSeconds: 0,
    holdSecondsAtRelease: 0,
  };
}

class ScriptedInput implements InputState {
  readonly #p1 = blankSeat();
  readonly #p2 = blankSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  run(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.move.x = x;
    target.move.y = y;
  }

  /** A finger, in the manifest's logical box — which is where a real pointer arrives. */
  point(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
  }

  lift(seat: SeatId): void {
    this.#of(seat).pointer = null;
  }

  #of(seat: SeatId): MutableSeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

function makeContext(
  seed: number,
  botP1: BotDifficulty | null = null,
  botP2: BotDifficulty | null = null,
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return seat === 'p1' ? botP1 : botP2;
    },
  };
}

type DrawArg = number | string | boolean | undefined;

interface DrawCall {
  readonly op: string;
  readonly args: readonly DrawArg[];
}

class RecordingRenderer implements Renderer {
  readonly calls: DrawCall[] = [];

  get ops(): string[] {
    return this.calls.map((call) => call.op);
  }

  clear(colour: string): void {
    this.#record('clear', colour);
  }
  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#record('rect', x, y, width, height, colour);
  }
  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    this.#record('strokeRect', x, y, width, height, lineWidth, colour);
  }
  circle(x: number, y: number, radius: number, colour: string): void {
    this.#record('circle', x, y, radius, colour);
  }
  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.#record('strokeCircle', x, y, radius, lineWidth, colour);
  }
  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    this.#record('line', x1, y1, x2, y2, lineWidth, colour);
  }
  text(
    value: string,
    x: number,
    y: number,
    sizePx: number,
    colour: string,
    align?: TextAlign,
  ): void {
    this.#record('text', value, x, y, sizePx, colour, align);
  }
  pushSeatRotation(rotated: boolean): void {
    this.#record('pushSeatRotation', rotated);
  }
  pushRotation(radians: number): void {
    this.#record('pushRotation', radians);
  }
  popSeatRotation(): void {
    this.#record('popSeatRotation');
  }

  #record(op: string, ...values: DrawArg[]): void {
    this.calls.push({ op, args: values });
  }
}

/** Runs the kick-off pause out so the pitch is live. */
function goLive(game: BallGamesGame, input: InputState): void {
  for (let i = 0; i < 200 && game.match.phase !== 'playing'; i += 1) game.update(STEP, input);
}

/** The marks a seat owns: the ones drawn in exactly one of that seat's palette colours. */
function seatMarks(calls: readonly DrawCall[], seat: SeatId): Set<string> {
  const palette = SEAT_PALETTE[seat];
  const owned = new Set<string>([palette.base, palette.deep, palette.tint, palette.soft]);
  const glyphs = new Set<string>();
  for (const call of calls) {
    const colour = call.args[call.args.length - 1];
    if (typeof colour === 'string' && owned.has(colour)) glyphs.add(call.op);
  }
  return glyphs;
}

describe('the contract', () => {
  it('starts goalless with a full clock', () => {
    const game = new BallGamesGame();
    game.init(makeContext(11));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.clock).toBe(MATCH_SECONDS);
    expect(game.match.extra).toBe(false);
  });

  it('never claims to have turns', () => {
    // `rt-*`: the host reads the *presence* of this method to decide a game is turn-based,
    // and a real-time game that answered it would take one seat's pointer zone away.
    const game = new BallGamesGame();
    expect((game as { getActiveSeat?: unknown }).getActiveSeat).toBeUndefined();
  });

  it('reports a winner once, and keeps reporting it', () => {
    const game = new BallGamesGame();
    game.init(makeContext(3, 'hard', 'easy'));
    const input = new ScriptedInput();
    let winner: SeatId | 'draw' | null = null;
    for (let i = 0; i < 60 * 600 && winner === null; i += 1) {
      game.update(STEP, input);
      winner = game.getScore().winner;
    }
    expect(winner).not.toBeNull();
    const settled = game.getScore();
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    expect(game.getScore()).toEqual(settled);
  });

  it('starts a fresh match on init, whatever the last one did', () => {
    const game = new BallGamesGame();
    game.init(makeContext(5, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 200; i += 1) game.update(STEP, input);
    game.init(makeContext(5, 'hard', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.clock).toBe(MATCH_SECONDS);
    expect(game.match.score.p1).toBe(0);
  });

  it('puts everything back on its mark when it is destroyed', () => {
    const game = new BallGamesGame();
    game.init(makeContext(7, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 60; i += 1) game.update(STEP, input);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.ball.x).toBe(0);
    expect(game.match.ball.y).toBe(0);
  });

  it('survives pause and resume without moving', () => {
    const game = new BallGamesGame();
    game.init(makeContext(9, 'normal', 'normal'));
    const input = new ScriptedInput();
    goLive(game, input);
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    const before = { ...game.match.ball };
    game.onPause();
    game.onResume();
    expect({ ...game.match.ball }).toEqual(before);
  });

  it('never scores more than the target', () => {
    const game = new BallGamesGame();
    game.init(makeContext(13, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 600; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }
    expect(game.match.score.p1).toBeLessThanOrEqual(GOAL_TARGET);
    expect(game.match.score.p2).toBeLessThanOrEqual(GOAL_TARGET);
  });
});

describe('rendering', () => {
  it('is pure: two renders of one state make the same marks', () => {
    const game = new BallGamesGame();
    game.init(makeContext(17, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 240; i += 1) game.update(STEP, input);
    const before = JSON.stringify(game.match);

    const first = new RecordingRenderer();
    const second = new RecordingRenderer();
    game.render(first, 0);
    game.render(second, 0.99);
    expect(second.calls).toEqual(first.calls);
    expect(JSON.stringify(game.match)).toBe(before);
  });

  it('draws inside the logical box, at every moment of a match', () => {
    const game = new BallGamesGame();
    game.init(makeContext(19, 'hard', 'hard'));
    const input = new ScriptedInput();
    for (let frame = 0; frame < 900; frame += 1) {
      game.update(STEP, input);
      if (frame % 7 !== 0) continue;
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      for (const call of renderer.calls) {
        if (call.op === 'clear') continue;
        const numbers = call.args.filter((arg): arg is number => typeof arg === 'number');
        // Every primitive here starts with its x and y, so the first pair is the anchor.
        const [x, y] = numbers;
        if (x === undefined || y === undefined) continue;
        expect(x, `${call.op} x`).toBeGreaterThanOrEqual(-1);
        expect(x).toBeLessThanOrEqual(LOGICAL_WIDTH + 1);
        expect(y, `${call.op} y`).toBeGreaterThanOrEqual(-1);
        expect(y).toBeLessThanOrEqual(LOGICAL_HEIGHT + 1);
      }
    }
  });

  it('tells the seats apart by shape and not only by colour', () => {
    const game = new BallGamesGame();
    game.init(makeContext(23, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);

    const near = seatMarks(renderer.calls, 'p1');
    const far = seatMarks(renderer.calls, 'p2');
    expect(near.size).toBeGreaterThan(0);
    expect(far.size).toBeGreaterThan(0);
    // Rule 7 as the greyscale harness reads it: a primitive one seat draws in its own
    // colour and the other never does. The near seat is a disc; the far seat is a square.
    const onlyNear = [...near].filter((glyph) => !far.has(glyph));
    expect(onlyNear, 'the two seats draw the same primitives').not.toEqual([]);
  });

  it('draws the ball above its own shadow when it is in the air', () => {
    const game = new BallGamesGame();
    game.init(makeContext(29));
    const input = new ScriptedInput();
    goLive(game, input);
    // Put a ball in the air by hand: the height cue is the whole of how a player reads
    // which part of their body is about to meet it.
    game.match.ball.x = 0;
    game.match.ball.y = 0;
    game.match.ball.z = 80;
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const discs = renderer.calls.filter((call) => call.op === 'circle');
    const ys = discs.map((call) => call.args[1]).filter((y): y is number => typeof y === 'number');
    // Somewhere in there is a mark above the centre spot: the lifted ball.
    expect(ys.some((y) => y < CENTRE_Y - 20)).toBe(true);
  });
});

describe('the controls the manifest promises', () => {
  it('moves a player with the keys, both seats', () => {
    const game = new BallGamesGame();
    game.init(makeContext(31));
    const input = new ScriptedInput();
    goLive(game, input);
    const nearBefore = game.match.p1.x;
    const farBefore = game.match.p2.x;
    input.run('p1', 1, 0);
    input.run('p2', -1, 0);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.match.p1.x).toBeGreaterThan(nearBefore);
    expect(game.match.p2.x).toBeLessThan(farBefore);
  });

  it('runs towards a finger, wherever on the pitch it has been dragged', () => {
    const game = new BallGamesGame();
    game.init(makeContext(37));
    const input = new ScriptedInput();
    goLive(game, input);
    const before = game.match.p1.y;
    // A finger that went down in seat one's own half and has been dragged up the pitch.
    // Pointer ownership by origin is what makes that legal, and it is why the whole pitch
    // is reachable with a thumb as well as with a key.
    input.point('p1', CENTRE_X, CENTRE_Y - 300);
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    expect(game.match.p1.y).toBeLessThan(before);
  });

  it('ignores a finger resting on the player itself', () => {
    const game = new BallGamesGame();
    game.init(makeContext(41));
    const input = new ScriptedInput();
    goLive(game, input);
    const before = game.match.p1.y;
    input.point('p1', CENTRE_X + game.match.p1.x, CENTRE_Y + game.match.p1.y);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.match.p1.y).toBe(before);
  });

  it('keeps a driven player on the pitch', () => {
    const game = new BallGamesGame();
    game.init(makeContext(43));
    const input = new ScriptedInput();
    goLive(game, input);
    input.run('p1', -1, -1);
    input.run('p2', 1, 1);
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    for (const player of [game.match.p1, game.match.p2]) {
      expect(Math.abs(player.x)).toBeLessThanOrEqual(PITCH_HALF_W - PLAYER_RADIUS + 1e-6);
      expect(Math.abs(player.y)).toBeLessThanOrEqual(PITCH_HALF_H - PLAYER_RADIUS + 1e-6);
    }
  });
});

describe('the bot', () => {
  function trace(tier: BotDifficulty, seed: number): string {
    const game = new BallGamesGame();
    game.init(makeContext(seed, tier, tier));
    const input = new ScriptedInput();
    const out: number[] = [];
    for (let i = 0; i < 60 * 25; i += 1) {
      game.update(STEP, input);
      if (i % 30 === 0) out.push(game.match.ball.x, game.match.ball.y, game.match.p1.x);
    }
    return out.map((value) => value.toFixed(6)).join(',');
  }

  it('plays differently at every tier', () => {
    const easy = trace('easy', 51);
    const normal = trace('normal', 51);
    const hard = trace('hard', 51);
    expect(normal).not.toBe(easy);
    expect(hard).not.toBe(normal);
    expect(hard).not.toBe(easy);
  });

  it('actually plays: a bot pair does not look like two empty seats', () => {
    const game = new BallGamesGame();
    game.init(makeContext(53));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 25; i += 1) game.update(STEP, input);
    const idle = `${game.match.ball.x},${game.match.ball.y}`;
    expect(trace('normal', 53)).not.toContain(idle);
  });

  it('is deterministic on a seed', () => {
    expect(trace('normal', 61)).toBe(trace('normal', 61));
  });
});

describe('the manifest', () => {
  it('describes controls the game really reads', () => {
    expect(manifest.controls.keyboard).toMatch(/seat/i);
    expect(manifest.controls.pointer.length).toBeGreaterThan(3);
    expect(manifest.logical).toEqual({ width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT });
  });

  it('offers a friend and a bot, so nobody is left with a game they cannot start', () => {
    expect(manifest.modes).toContain('friend');
    expect(manifest.modes).toContain('bot');
  });

  it('is a real-time split', () => {
    expect(manifest.archetype).toBe('rt-split');
    expect(manifest.zoneSplit).toBe('horizontal');
  });
});
