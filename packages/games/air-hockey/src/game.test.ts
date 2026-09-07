import { describe, it, expect } from 'vitest';
import { RecordingSoundBus, Rng, SOUND_EVENTS, vec2 } from '@duelbox/engine';
import type { SeatId, SoundBus, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { AirHockeyGame, MATCH_SECONDS, SERVE_STEPS } from './game.js';
import { manifest } from './manifest.js';
import { MALLET_RADIUS, TABLE } from './rules.js';
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
  pointerCancelled: boolean;
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
    pointerCancelled: false,
  };
}

class ScriptedInput implements InputState {
  readonly #p1 = blankSeat();
  readonly #p2 = blankSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  point(seat: SeatId, x: number, y: number): void {
    const target = seat === 'p1' ? this.#p1 : this.#p2;
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
  }
}

function makeContext(
  seed: number,
  botP1: BotDifficulty | null = null,
  botP2: BotDifficulty | null = null,
  audio?: SoundBus,
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
    // Omitted entirely when there is none, rather than passed as `undefined`: that is the
    // shape every other game's test double already has, and it must keep compiling.
    ...(audio ? { audio } : {}),
  };
}

type DrawArg = number | string | boolean | undefined;

interface DrawCall {
  readonly op: string;
  readonly args: readonly DrawArg[];
}

/**
 * Logs every call and every argument, so no draw can pass unobserved.
 *
 * Structured by call rather than as two flat lists: a flat `args` cannot say which
 * arguments belonged together, so a test that needs a rectangle's width *and* its height
 * has to walk the list counting arity — which desynchronises the moment an op with a
 * different argument count appears. `ops` and `args` are kept as views so the tests
 * written against the flat shape still read the same.
 */
class RecordingRenderer implements Renderer {
  readonly calls: DrawCall[] = [];

  get ops(): string[] {
    return this.calls.map((call) => call.op);
  }

  get args(): DrawArg[] {
    return this.calls.flatMap((call) => [...call.args]);
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
    this.pushSeatRotation(radians !== 0);
  }

  popSeatRotation(): void {
    this.#record('popSeatRotation');
  }

  #record(op: string, ...values: DrawArg[]): void {
    this.calls.push({ op, args: values });
  }
}

describe('AirHockeyGame', () => {
  it('runs a headless match through to a decided score', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(4711));

    const input = new ScriptedInput();
    // Both mallets parked in their own corners, well clear of the goal mouths, so the
    // match resolves on serves alone and the run terminates.
    input.point('p1', 60, 940);
    input.point('p2', 540, 60);

    let steps = 0;
    while (game.getScore().winner === null && steps < 40_000) {
      game.update(STEP, input);
      steps += 1;
    }

    const score = game.getScore();
    expect(score.winner).not.toBeNull();
    expect(Math.max(score.p1, score.p2)).toBe(7);
    expect(Math.min(score.p1, score.p2)).toBeLessThan(7);
    expect(score.winner).toBe(score.p1 > score.p2 ? 'p1' : 'p2');
  });

  it('stops simulating once the match is decided', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(4711));
    const input = new ScriptedInput();
    input.point('p1', 60, 940);
    input.point('p2', 540, 60);

    let steps = 0;
    while (game.getScore().winner === null && steps < 40_000) {
      game.update(STEP, input);
      steps += 1;
    }
    const decided = game.getScore();
    const p1 = decided.p1;
    const p2 = decided.p2;
    const x = game.puck.x;

    for (let i = 0; i < 300; i += 1) game.update(STEP, input);

    expect(game.getScore().p1).toBe(p1);
    expect(game.getScore().p2).toBe(p2);
    expect(game.puck.x).toBe(x);
  });

  it('holds the puck on the centre spot until the serve countdown expires', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(9));
    const idle = new ScriptedInput();

    expect(game.serveCountdown).toBe(SERVE_STEPS);
    for (let i = 0; i < SERVE_STEPS; i += 1) game.update(STEP, idle);

    expect(game.serveCountdown).toBe(0);
    expect(game.puck.x).toBe(TABLE.width / 2);
    expect(game.puck.y).toBe(TABLE.height / 2);
    expect(Math.hypot(game.puck.vx, game.puck.vy)).toBeGreaterThan(0);

    game.update(STEP, idle);
    expect(game.puck.y).not.toBe(TABLE.height / 2);
  });

  it('leaves idle mallets exactly where they started', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(5));
    const idle = new ScriptedInput();
    const startY = game.mallet('p1').y;

    for (let i = 0; i < SERVE_STEPS; i += 1) game.update(STEP, idle);

    expect(game.mallet('p1').x).toBe(TABLE.width / 2);
    expect(game.mallet('p1').y).toBe(startY);
  });

  it('keeps a bot seat inside its own half and gets it moving', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(2024, null, 'normal'));
    const input = new ScriptedInput();
    input.point('p1', 300, 940);

    const startY = game.mallet('p2').y;
    for (let i = 0; i < 900; i += 1) {
      game.update(STEP, input);
      expect(game.mallet('p2').y).toBeLessThanOrEqual(TABLE.height / 2 - MALLET_RADIUS + 1e-9);
      expect(game.mallet('p2').y).toBeGreaterThanOrEqual(MALLET_RADIUS - 1e-9);
    }
    expect(game.mallet('p2').y).not.toBe(startY);
  });

  it('replays identically from the same seed and the same inputs', () => {
    function run(): number[] {
      const game = new AirHockeyGame();
      game.init(makeContext(777, 'hard', 'easy'));
      const input = new ScriptedInput();
      for (let i = 0; i < 2400; i += 1) game.update(STEP, input);
      const score = game.getScore();
      return [
        game.puck.x,
        game.puck.y,
        game.puck.vx,
        game.puck.vy,
        game.mallet('p1').x,
        game.mallet('p1').y,
        game.mallet('p2').x,
        game.mallet('p2').y,
        score.p1,
        score.p2,
      ];
    }
    expect(run()).toEqual(run());
  });

  it('renders without touching simulation state', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(13, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 400; i += 1) game.update(STEP, input);

    const before = [
      game.puck.x,
      game.puck.y,
      game.puck.vx,
      game.puck.vy,
      game.mallet('p1').x,
      game.mallet('p2').x,
    ];
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    game.render(renderer, 0.5);
    game.render(renderer, 0.999);

    expect(renderer.ops.length).toBeGreaterThan(0);
    expect(renderer.ops[0]).toBe('clear');
    for (const value of renderer.args) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }
    expect([
      game.puck.x,
      game.puck.y,
      game.puck.vx,
      game.puck.vy,
      game.mallet('p1').x,
      game.mallet('p2').x,
    ]).toEqual(before);
  });

  it('ignores updates after destroy', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);

    const y = game.puck.y;
    game.destroy();
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);
    expect(game.puck.y).toBe(y);
  });

  it('clears mallet momentum across a pause so resuming is not read as a swing', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(21));
    const input = new ScriptedInput();
    input.point('p1', 100, 600);
    game.update(STEP, input);
    expect(Math.hypot(game.mallet('p1').vx, game.mallet('p1').vy)).toBeGreaterThan(0);

    game.onPause();
    expect(game.mallet('p1').vx).toBe(0);
    expect(game.mallet('p1').vy).toBe(0);
    game.onResume();
    expect(game.mallet('p1').vx).toBe(0);
  });
});

describe('the backstop clock', () => {
  /**
   * First to seven is the rule; this is what stops a cautious match running for ever.
   *
   * There was previously nothing at all. `roundSeconds` is validated by the manifest
   * schema and read only by the catalogue card that prints "about 1m 30s" — it ends
   * nothing. A registry-wide termination test found it by playing two `easy` bots against
   * each other: 2-4 after thirty minutes of simulated play, and still going.
   */
  it('runs down while the match is live', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(3));
    const before = game.clock;
    const input = new ScriptedInput();
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    expect(game.clock, 'two seconds gone').toBeLessThan(before);
  });

  it('calls a level match a draw at the whistle', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(5));
    game.clock = STEP;
    game.update(STEP, new ScriptedInput());
    expect(game.getScore()).toMatchObject({ p1: 0, p2: 0, winner: 'draw' });
  });

  it('gives it to whoever is ahead at the whistle', () => {
    // Played out rather than reached into: a bot match with the clock wound down to a
    // couple of seconds, so somebody is ahead when it goes.
    const game = new AirHockeyGame();
    game.init(makeContext(13, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 120 && game.getScore().p1 === game.getScore().p2; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().p1, 'somebody scored first').not.toBe(game.getScore().p2);
    const ahead = game.getScore().p1 > game.getScore().p2 ? 'p1' : 'p2';
    game.clock = STEP;
    game.update(STEP, input);
    expect(game.getScore().winner).toBe(ahead);
  });

  it('stops the match dead once the whistle has gone', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(17, 'hard', 'easy'));
    game.clock = STEP;
    const input = new ScriptedInput();
    game.update(STEP, input);
    const frozen = JSON.stringify(game.getScore());
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(JSON.stringify(game.getScore())).toBe(frozen);
  });

  it('starts full again on init', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(11));
    game.clock = 5;
    game.init(makeContext(11));
    expect(game.clock).toBe(MATCH_SECONDS);
  });

  it('is drawn, because a rule nobody can see is a rule nobody can play to', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(19));
    const full = new RecordingRenderer();
    game.render(full, 0);
    // The *filled* part, not the track behind it: both are thin strips, and taking the
    // taller of the two just measures the track every time, which is exactly what the
    // first version of this did.
    const filled = (renderer: RecordingRenderer): number => {
      let tallest = 0;
      for (const call of renderer.calls) {
        if (call.op !== 'rect') continue;
        const [, , w, h, colour] = call.args;
        if (typeof w !== 'number' || typeof h !== 'number') continue;
        if (w > 10 || colour !== 'rgba(233, 240, 252, 0.55)') continue;
        tallest = Math.max(tallest, h);
      }
      return tallest;
    };
    const before = filled(full);
    expect(before, 'the bar is there').toBeGreaterThan(0);

    game.clock = MATCH_SECONDS / 4;
    const later = new RecordingRenderer();
    game.render(later, 0);
    expect(filled(later), 'and it shortens as the match runs').toBeLessThan(before);
  });
});

/**
 * Air Hockey is the first game wired to the sound bus, and the pattern the other 106 will
 * follow, so what is checked here is the pattern rather than the noise.
 *
 * The load-bearing one is the last: **the match must step identically with a bus and
 * without one.** Sound is presentation. A game whose simulation changes when somebody
 * plugs in headphones cannot be replayed, cannot be balanced, and cannot be played across
 * two devices — and the failure would be silent, because every existing test runs without
 * a bus and would go on passing.
 */
describe('AirHockeyGame sound cues', () => {
  /** Both seats played by the hardest bot, which produces plenty of every kind of event. */
  function playWithBus(seed: number, steps: number): RecordingSoundBus {
    const bus = new RecordingSoundBus();
    const game = new AirHockeyGame();
    game.init(makeContext(seed, 'hard', 'hard', bus));
    const input = new ScriptedInput();
    for (let i = 0; i < steps && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    return bus;
  }

  it('says only things that are in the vocabulary', () => {
    const bus = playWithBus(4711, 6_000);
    expect(bus.events.length).toBeGreaterThan(0);
    for (const event of bus.distinct()) {
      expect(SOUND_EVENTS).toContain(event);
    }
  });

  it('makes all four of the cues a puck game has', () => {
    const bus = playWithBus(4711, 6_000);
    expect(bus.distinct().sort()).toEqual(['bounce', 'hit', 'launch', 'score'].sort());
  });

  it('leaves the match cues to the shell', () => {
    // A game that beeped its own countdown would be the bug CLAUDE.md names: "a bespoke
    // version of any of those inside a game package".
    const bus = playWithBus(4711, 6_000);
    for (const shellCue of ['countdown', 'start', 'pause', 'win'] as const) {
      expect(bus.count(shellCue)).toBe(0);
    }
  });

  it('says launch when the puck is served, and draws the flare in the same step', () => {
    const bus = new RecordingSoundBus();
    const game = new AirHockeyGame();
    game.init(makeContext(19, null, null, bus));
    const input = new ScriptedInput();
    for (let i = 0; i < SERVE_STEPS; i += 1) game.update(STEP, input);

    expect(bus.count('launch')).toBe(1);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const flare = renderer.calls.filter(
      (call) => call.op === 'line' && call.args[5] === 'rgba(233, 240, 252, 0.9)',
    );
    expect(flare, 'the serve is seen as well as heard').toHaveLength(1);
  });

  it('says hit with the striking seat, and rings the contact', () => {
    const bus = new RecordingSoundBus();
    const game = new AirHockeyGame();
    game.init(makeContext(19, null, null, bus));
    const input = new ScriptedInput();
    // p1 parks its mallet on the centre line of its own half, where a serve toward p1
    // must arrive. Nothing about the bot is involved, so the contact is not a coincidence.
    input.point('p1', TABLE.width / 2, TABLE.height * 0.62);
    for (let i = 0; i < 400 && bus.count('hit') === 0; i += 1) game.update(STEP, input);

    expect(bus.count('hit')).toBeGreaterThan(0);
    const first = bus.events.indexOf('hit');
    expect(bus.seats[first]).toBe('p1');
    expect(bus.intensities[first]).toBeGreaterThan(0);
    expect(bus.intensities[first]).toBeLessThanOrEqual(1);

    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const ring = renderer.calls.filter(
      (call) => call.op === 'strokeCircle' && call.args[4] === 'rgba(233, 240, 252, 0.9)',
    );
    expect(ring.length, 'the hit is seen as well as heard').toBeGreaterThan(0);
  });

  it('says bounce with no seat, because a rail belongs to nobody, and lights the rail', () => {
    const bus = playWithBus(4711, 6_000);
    const first = bus.events.indexOf('bounce');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(bus.seats[first]).toBeNull();

    // Replayed to the step the rebound happens on, so the marker can be caught on screen.
    const replay = new RecordingSoundBus();
    const game = new AirHockeyGame();
    game.init(makeContext(4711, 'hard', 'hard', replay));
    const input = new ScriptedInput();
    for (let i = 0; i < 6_000 && replay.count('bounce') === 0; i += 1) game.update(STEP, input);
    expect(replay.count('bounce')).toBe(1);

    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const bar = renderer.calls.filter(
      (call) => call.op === 'rect' && call.args[4] === 'rgba(233, 240, 252, 0.9)',
    );
    expect(bar, 'the rebound is seen as well as heard').toHaveLength(1);
  });

  it('gives a harder hit a louder cue', () => {
    const bus = playWithBus(4711, 6_000);
    const hits: number[] = [];
    for (let i = 0; i < bus.events.length; i += 1) {
      if (bus.events[i] === 'hit') hits.push(bus.intensities[i]!);
    }
    expect(hits.length).toBeGreaterThan(4);
    // Not all the same number, or intensity is decoration rather than information.
    expect(new Set(hits).size).toBeGreaterThan(1);
    for (const intensity of hits) {
      expect(intensity).toBeGreaterThanOrEqual(0);
      expect(intensity).toBeLessThanOrEqual(1);
    }
  });

  it('steps the identical match with a bus and without one', () => {
    function play(audio?: SoundBus): { score: string; puck: string } {
      const game = new AirHockeyGame();
      game.init(makeContext(4711, 'hard', 'hard', audio));
      const input = new ScriptedInput();
      for (let i = 0; i < 6_000 && game.getScore().winner === null; i += 1) {
        game.update(STEP, input);
      }
      const score = game.getScore();
      const puck = game.puck;
      return {
        score: `${String(score.p1)}-${String(score.p2)}-${String(score.winner)}`,
        // Full precision on purpose: rounding here would hide exactly the kind of tiny
        // divergence that compounds over a match.
        puck: [puck.x, puck.y, puck.vx, puck.vy].map((n) => n.toExponential(17)).join(','),
      };
    }
    const silent = play();
    const heard = play(new RecordingSoundBus());
    expect(heard).toEqual(silent);
  });
});
