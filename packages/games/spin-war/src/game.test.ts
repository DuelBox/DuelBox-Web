import { describe, expect, it } from 'vitest';
import { Rng, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { RESET_STEPS, SpinWarGame } from './game.js';
import { manifest } from './manifest.js';
import { BOWL_RADIUS, POINTS_TO_WIN, RING_OUT_POINTS, SPIN_FULL, SPINNER_RADIUS } from './rules.js';
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

  push(seat: SeatId, x: number, y: number): void {
    const target = seat === 'p1' ? this.#p1 : this.#p2;
    target.move.x = x;
    target.move.y = y;
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

/** Logs every call and every argument, so no draw can pass unobserved. */
class RecordingRenderer implements Renderer {
  readonly calls: DrawCall[] = [];

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

  #record(op: string, ...args: DrawArg[]): void {
    this.calls.push({ op, args });
  }
}

/** Lines drawn from inside the disc at `(x, y)`, i.e. the blades that name a seat. */
function bladesAt(renderer: RecordingRenderer, x: number, y: number, colour: string): number {
  let count = 0;
  for (const call of renderer.calls) {
    if (call.op !== 'line' || call.args[5] !== colour) continue;
    const x1 = call.args[0];
    const y1 = call.args[1];
    if (typeof x1 !== 'number' || typeof y1 !== 'number') continue;
    if (Math.hypot(x1 - x, y1 - y) < SPINNER_RADIUS * 0.5) count += 1;
  }
  return count;
}

/** Ticks lit on a top's gauge: the long ones, drawn at the seat's own colour. */
function litPips(renderer: RecordingRenderer, x: number, y: number): number {
  let count = 0;
  for (const call of renderer.calls) {
    if (call.op !== 'line') continue;
    const x1 = call.args[0];
    const y1 = call.args[1];
    const x2 = call.args[2];
    const y2 = call.args[3];
    if (
      typeof x1 !== 'number' ||
      typeof y1 !== 'number' ||
      typeof x2 !== 'number' ||
      typeof y2 !== 'number'
    ) {
      continue;
    }
    const from = Math.hypot(x1 - x, y1 - y);
    if (Math.abs(from - (SPINNER_RADIUS + 9)) > 0.001) continue;
    if (Math.hypot(x2 - x1, y2 - y1) > 9) count += 1;
  }
  return count;
}

function distanceFromCentre(game: SpinWarGame, seat: SeatId): number {
  const s = game.spinner(seat);
  return Math.hypot(s.x - game.bowl.centreX, s.y - game.bowl.centreY);
}

function runToDecision(game: SpinWarGame, input: InputState, limit: number): number {
  let steps = 0;
  while (game.getScore().winner === null && steps < limit) {
    game.update(STEP, input);
    steps += 1;
  }
  return steps;
}

function settle(game: SpinWarGame, input: InputState): void {
  for (let i = 0; i < RESET_STEPS; i += 1) game.update(STEP, input);
}

/** One bot match, reported as the winning seat. */
function botMatch(seed: number, p1: BotDifficulty, p2: BotDifficulty): SeatId | 'draw' | null {
  const game = new SpinWarGame();
  game.init(makeContext(seed, p1, p2));
  runToDecision(game, new ScriptedInput(), 20_000);
  const winner = game.getScore().winner;
  game.destroy();
  return winner;
}

/** Wins for `a` over `count` matches in EACH seating, so a seat bias cannot masquerade. */
function ladder(a: BotDifficulty, b: BotDifficulty, count: number): number {
  let wins = 0;
  for (let seed = 1; seed <= count; seed += 1) {
    if (botMatch(seed * 101, a, b) === 'p1') wins += 1;
    if (botMatch(seed * 101, b, a) === 'p2') wins += 1;
  }
  return wins;
}

describe('SpinWarGame', () => {
  it('holds both tops still until the opening countdown expires', () => {
    const game = new SpinWarGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    input.push('p1', 1, 0);

    expect(game.resetCountdown).toBe(RESET_STEPS);
    const startX = game.spinner('p1').x;
    settle(game, input);

    expect(game.resetCountdown).toBe(0);
    expect(game.spinner('p1').x).toBe(startX);

    game.update(STEP, input);
    expect(game.spinner('p1').x).toBeGreaterThan(startX);
  });

  it('launches both seats the same distance from the middle', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const game = new SpinWarGame();
      game.init(makeContext(seed));
      expect(distanceFromCentre(game, 'p1')).toBeCloseTo(distanceFromCentre(game, 'p2'), 9);
    }
  });

  it('launches both seats at full spin', () => {
    const game = new SpinWarGame();
    game.init(makeContext(12));
    expect(game.spinner('p1').spin).toBe(SPIN_FULL);
    expect(game.spinner('p2').spin).toBe(SPIN_FULL);
  });

  it('starts both tops inside the bowl, whatever the launch angle', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const game = new SpinWarGame();
      game.init(makeContext(seed * 7));
      expect(distanceFromCentre(game, 'p1')).toBeLessThan(BOWL_RADIUS);
      expect(distanceFromCentre(game, 'p2')).toBeLessThan(BOWL_RADIUS);
    }
  });

  it('answers the movement keys', () => {
    const game = new SpinWarGame();
    game.init(makeContext(31));
    const input = new ScriptedInput();
    settle(game, input);
    input.push('p1', 1, 0);
    const before = game.spinner('p1').x;
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    expect(game.spinner('p1').x).toBeGreaterThan(before);
  });

  it('drives each seat from its own half of the keyboard and nothing else', () => {
    // The misconception this exists to catch: the shell does NOT fold both keyboard halves
    // onto one seat. `W A S D` is seat one and the arrows are seat two, always and at the
    // same time, so a push written into seat two must move seat two's top and leave seat
    // one's exactly where a push into nobody would have left it.
    const game = new SpinWarGame();
    game.init(makeContext(31));
    const input = new ScriptedInput();
    settle(game, input);
    const quiet = new SpinWarGame();
    quiet.init(makeContext(31));
    const nothing = new ScriptedInput();
    settle(quiet, nothing);

    input.push('p2', 1, 0);
    for (let i = 0; i < 20; i += 1) {
      game.update(STEP, input);
      quiet.update(STEP, nothing);
    }

    expect(game.spinner('p2').x).toBeGreaterThan(quiet.spinner('p2').x);
    expect(game.spinner('p1').x).toBe(quiet.spinner('p1').x);
    expect(game.spinner('p1').y).toBe(quiet.spinner('p1').y);
  });

  it('answers a pointer as a place on the dish to drive towards', () => {
    const game = new SpinWarGame();
    game.init(makeContext(31));
    const input = new ScriptedInput();
    settle(game, input);
    const start = game.spinner('p1').x;
    input.point('p1', start + 300, game.spinner('p1').y);
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    expect(game.spinner('p1').x).toBeGreaterThan(start);
  });

  it('answers a thumb and a key the same when they mean the same thing', () => {
    // The one place the two instruments have to agree exactly: a finger placed straight
    // out to the right and the right-hand key are the same direction, so they must be the
    // same push. Anything else is a game that plays differently on a phone.
    const byKey = new SpinWarGame();
    byKey.init(makeContext(88));
    const keys = new ScriptedInput();
    settle(byKey, keys);
    keys.push('p1', 1, 0);
    byKey.update(STEP, keys);

    const byThumb = new SpinWarGame();
    byThumb.init(makeContext(88));
    const thumb = new ScriptedInput();
    settle(byThumb, thumb);
    thumb.point('p1', byThumb.spinner('p1').x + 500, byThumb.spinner('p1').y);
    byThumb.update(STEP, thumb);

    expect(byThumb.spinner('p1').x).toBeCloseTo(byKey.spinner('p1').x, 9);
    expect(byThumb.spinner('p1').y).toBeCloseTo(byKey.spinner('p1').y, 9);
  });

  it('reads a finger resting on the top itself as no push at all', () => {
    const game = new SpinWarGame();
    game.init(makeContext(31));
    const input = new ScriptedInput();
    settle(game, input);
    const idle = new SpinWarGame();
    idle.init(makeContext(31));
    const nothing = new ScriptedInput();
    settle(idle, nothing);

    // The finger is moved with the top each step, because that is what "resting on it"
    // means for a top the dish is carrying: a finger left behind on the glass is a point on
    // the dish to drive back towards, which is the pointer working, not the deadzone
    // failing. Held on the top, thirty steps must be indistinguishable from no touch at all.
    for (let i = 0; i < 30; i += 1) {
      input.point('p1', game.spinner('p1').x + 2, game.spinner('p1').y);
      game.update(STEP, input);
      idle.update(STEP, nothing);
    }
    expect(game.spinner('p1').x).toBeCloseTo(idle.spinner('p1').x, 9);
    expect(game.spinner('p1').y).toBeCloseTo(idle.spinner('p1').y, 9);
  });

  it('ends a match nobody plays, level, because the two tops are identical', () => {
    const game = new SpinWarGame();
    game.init(makeContext(99));

    const steps = runToDecision(game, new ScriptedInput(), 20_000);

    const score = game.getScore();
    expect(steps).toBeLessThan(20_000);
    expect(score.winner).toBe('draw');
    expect(score.p1).toBe(score.p2);
    expect(score.p1).toBeGreaterThanOrEqual(POINTS_TO_WIN);
  });

  it('settles a bot against a bot rather than letting the pair circle for ever', () => {
    const game = new SpinWarGame();
    game.init(makeContext(808, 'normal', 'normal'));

    const steps = runToDecision(game, new ScriptedInput(), 20_000);

    const score = game.getScore();
    expect(steps).toBeLessThan(20_000);
    expect(score.winner).not.toBeNull();
    expect(Math.max(score.p1, score.p2)).toBeGreaterThanOrEqual(POINTS_TO_WIN);
  });

  it('finishes every seeded bot match well inside the ten-minute guard', () => {
    // The termination guarantee, measured rather than argued: a round cannot outlast the
    // spin gauge, and a match cannot outlast seven rounds.
    let worst = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const game = new SpinWarGame();
      game.init(makeContext(seed * 313, 'easy', 'easy'));
      const steps = runToDecision(game, new ScriptedInput(), 20_000);
      expect(game.getScore().winner).not.toBeNull();
      if (steps > worst) worst = steps;
      game.destroy();
    }
    expect(worst).toBeLessThan(60 * 600);
    expect(worst).toBeLessThan(12_000);
  });

  it('pays two for a throw out of the bowl', () => {
    // Bot play is where a throw actually happens, so the award is read off a real match
    // rather than from a position posed by hand.
    let sawAThrow = false;
    for (let seed = 1; seed <= 20 && !sawAThrow; seed += 1) {
      const game = new SpinWarGame();
      game.init(makeContext(seed * 37, 'hard', 'easy'));
      const input = new ScriptedInput();
      let last = 0;
      for (let i = 0; i < 20_000 && game.getScore().winner === null; i += 1) {
        game.update(STEP, input);
        const now = game.getScore().p1;
        if (now - last === RING_OUT_POINTS) sawAThrow = true;
        last = now;
      }
      game.destroy();
    }
    expect(sawAThrow).toBe(true);
  });

  it('restores both gauges at the start of every round', () => {
    const game = new SpinWarGame();
    game.init(makeContext(21, 'normal', 'easy'));
    const input = new ScriptedInput();
    let rounds = 0;
    let last = '0:0';
    for (let i = 0; i < 20_000 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
      const score = game.getScore();
      const shown = `${score.p1}:${score.p2}`;
      if (shown !== last) {
        rounds += 1;
        last = shown;
        if (score.winner !== null) {
          // The round that decides the match is the one round that is NOT relaunched: the
          // last frame has to show how the match ended rather than a tidied-up bowl.
          expect(game.resetCountdown).toBe(0);
          break;
        }
        expect(game.spinner('p1').spin).toBe(SPIN_FULL);
        expect(game.spinner('p2').spin).toBe(SPIN_FULL);
        expect(game.resetCountdown).toBe(RESET_STEPS);
      }
    }
    expect(rounds).toBeGreaterThan(1);
    expect(game.getScore().winner).not.toBeNull();
  });

  it('stops simulating once the match is decided', () => {
    const game = new SpinWarGame();
    game.init(makeContext(4711, 'hard', 'easy'));
    const input = new ScriptedInput();
    runToDecision(game, input, 20_000);

    const decided = game.getScore();
    const p1 = decided.p1;
    const p2 = decided.p2;
    const x = game.spinner('p2').x;
    const spin = game.spinner('p2').spin;

    for (let i = 0; i < 300; i += 1) game.update(STEP, input);

    expect(game.getScore().p1).toBe(p1);
    expect(game.getScore().p2).toBe(p2);
    expect(game.spinner('p2').x).toBe(x);
    expect(game.spinner('p2').spin).toBe(spin);
  });

  it('ignores updates after destroy', () => {
    const game = new SpinWarGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    input.push('p1', 1, 0);
    settle(game, input);
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);

    const x = game.spinner('p1').x;
    game.destroy();
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);

    expect(game.spinner('p1').x).toBe(x);
  });

  it('resumes a pause exactly where it stood', () => {
    const game = new SpinWarGame();
    game.init(makeContext(21));
    const input = new ScriptedInput();
    input.push('p1', 1, 0);
    settle(game, input);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);

    const p1 = game.spinner('p1');
    const before = [p1.x, p1.y, p1.vx, p1.vy, p1.spin];
    game.onPause();
    game.onResume();

    expect([p1.x, p1.y, p1.vx, p1.vy, p1.spin]).toEqual(before);
  });

  it('replays identically from the same seed and the same inputs', () => {
    function run(): number[] {
      const game = new SpinWarGame();
      game.init(makeContext(777, 'hard', 'easy'));
      const input = new ScriptedInput();
      for (let i = 0; i < 1800; i += 1) game.update(STEP, input);
      const score = game.getScore();
      const p1 = game.spinner('p1');
      const p2 = game.spinner('p2');
      return [
        p1.x,
        p1.y,
        p1.vx,
        p1.vy,
        p1.spin,
        p2.x,
        p2.y,
        p2.vx,
        p2.vy,
        p2.spin,
        score.p1,
        score.p2,
      ];
    }

    const first = run();
    expect(first).toEqual(run());
    for (const value of first) expect(Number.isFinite(value)).toBe(true);
  });

  it('plays the mirrored match for the seat sitting opposite', () => {
    // Rotate the board half a turn, swap the two seats, and it is the same match. That is
    // the whole of seat fairness in one assertion: neither half of the dish is kinder.
    const game = new SpinWarGame();
    game.init(makeContext(1234));
    const input = new ScriptedInput();
    input.push('p1', 0.6, -0.8);
    input.push('p2', -0.6, 0.8);

    for (let i = 0; i < RESET_STEPS + 240; i += 1) game.update(STEP, input);

    const p1 = game.spinner('p1');
    const p2 = game.spinner('p2');
    const centreX = game.bowl.centreX;
    const centreY = game.bowl.centreY;
    expect(p2.x).toBeCloseTo(2 * centreX - p1.x, 6);
    expect(p2.y).toBeCloseTo(2 * centreY - p1.y, 6);
    expect(p2.vx).toBeCloseTo(-p1.vx, 6);
    expect(p2.vy).toBeCloseTo(-p1.vy, 6);
    expect(p2.spin).toBeCloseTo(p1.spin, 6);
  });

  it('gets a bot seat moving under its own steering', () => {
    const game = new SpinWarGame();
    game.init(makeContext(2024, null, 'normal'));
    const input = new ScriptedInput();

    const startX = game.spinner('p2').x;
    const startY = game.spinner('p2').y;
    for (let i = 0; i < RESET_STEPS + 90; i += 1) game.update(STEP, input);

    const p2 = game.spinner('p2');
    expect(Math.abs(p2.x - startX) + Math.abs(p2.y - startY)).toBeGreaterThan(1);
  });

  it('keeps both tops inside the play area for the whole match', () => {
    const game = new SpinWarGame();
    game.init(makeContext(64, 'hard', 'hard'));
    const input = new ScriptedInput();

    for (let i = 0; i < 4000; i += 1) {
      game.update(STEP, input);
      for (const seat of ['p1', 'p2'] as const) {
        expect(distanceFromCentre(game, seat)).toBeLessThan(BOWL_RADIUS + SPINNER_RADIUS * 4);
      }
    }
  });

  it('never claims a turn, because nobody waits for one', () => {
    const game = new SpinWarGame();
    game.init(makeContext(1));
    expect((game as { getActiveSeat?: unknown }).getActiveSeat).toBeUndefined();
  });
});

describe('SpinWarGame, drawn', () => {
  it('tells the seats apart by blade count, not by colour alone', () => {
    const game = new SpinWarGame();
    game.init(makeContext(13));
    const renderer = new RecordingRenderer();

    game.render(renderer, 0);

    expect(renderer.calls[0]?.op).toBe('clear');
    expect(bladesAt(renderer, game.spinner('p1').x, game.spinner('p1').y, '#e0332a')).toBe(3);
    expect(bladesAt(renderer, game.spinner('p2').x, game.spinner('p2').y, '#118cbd')).toBe(5);
  });

  it('shows the spin left as a count of ticks, which greyscale can read', () => {
    const game = new SpinWarGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();

    const full = new RecordingRenderer();
    // Alpha one, so the gauge is drawn around where the top IS rather than where it was a
    // step ago: at any other alpha the ticks are counted from the wrong centre and every
    // reading comes back zero.
    game.render(full, 1);
    const atStart = litPips(full, game.spinner('p1').x, game.spinner('p1').y);

    settle(game, input);
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);

    const later = new RecordingRenderer();
    game.render(later, 1);
    const afterten = litPips(later, game.spinner('p1').x, game.spinner('p1').y);

    expect(atStart).toBe(8);
    expect(afterten).toBeLessThan(atStart);
    expect(afterten).toBeGreaterThan(0);
  });

  it('draws the crest at the radius the rule uses', () => {
    const game = new SpinWarGame();
    game.init(makeContext(13));
    const renderer = new RecordingRenderer();
    game.render(renderer, 1);

    const crest = renderer.calls.filter(
      (call) =>
        call.op === 'strokeCircle' &&
        call.args[0] === game.bowl.centreX &&
        call.args[1] === game.bowl.centreY &&
        call.args[2] === game.bowl.radius,
    );
    expect(crest.length).toBe(1);
    // Drawn last, so no top can cover the losing line.
    expect(renderer.calls[renderer.calls.length - 1]).toBe(crest[0]);
  });

  it('shows the countdown only while a round is waiting to start', () => {
    const game = new SpinWarGame();
    game.init(makeContext(13));
    const waiting = new RecordingRenderer();
    game.render(waiting, 0);
    const before = waiting.calls.length;

    settle(game, new ScriptedInput());
    const live = new RecordingRenderer();
    game.render(live, 0);

    expect(game.resetCountdown).toBe(0);
    expect(live.calls.length).toBe(before - 1);
  });

  it('renders without touching simulation state', () => {
    const game = new SpinWarGame();
    game.init(makeContext(13, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 400; i += 1) game.update(STEP, input);

    const p1 = game.spinner('p1');
    const p2 = game.spinner('p2');
    const before = [p1.x, p1.y, p1.vx, p1.vy, p1.spin, p2.x, p2.y, p2.vx, p2.vy, p2.spin];

    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    game.render(renderer, 0.5);
    game.render(renderer, 0.999);

    expect(renderer.calls.length).toBeGreaterThan(0);
    for (const call of renderer.calls) {
      for (const value of call.args) {
        if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
      }
    }
    expect([p1.x, p1.y, p1.vx, p1.vy, p1.spin, p2.x, p2.y, p2.vx, p2.vy, p2.spin]).toEqual(before);
  });

  it('keeps every drawn point inside the box the manifest declares', () => {
    const game = new SpinWarGame();
    game.init(makeContext(19, 'hard', 'hard'));
    const input = new ScriptedInput();
    const renderer = new RecordingRenderer();
    for (let i = 0; i < 900; i += 1) {
      game.update(STEP, input);
      game.render(renderer, 0.5);
    }
    const limit = Math.max(manifest.logical.width, manifest.logical.height);
    for (const call of renderer.calls) {
      if (call.op !== 'circle' && call.op !== 'line') continue;
      for (const value of call.args) {
        if (typeof value === 'number') expect(Math.abs(value)).toBeLessThanOrEqual(limit * 1.5);
      }
    }
  });
});

describe('the three tiers', () => {
  it('has hard beat easy far more often than not', () => {
    const wins = ladder('hard', 'easy', 20);
    expect(wins).toBeGreaterThanOrEqual(30);
  });

  it('has normal beat easy far more often than not', () => {
    const wins = ladder('normal', 'easy', 20);
    expect(wins).toBeGreaterThanOrEqual(30);
  });

  it('has hard beat normal far more often than not', () => {
    const wins = ladder('hard', 'normal', 20);
    expect(wins).toBeGreaterThanOrEqual(30);
  });

  it('leaves two bots of the same tier close to even', () => {
    // Neither seat may be the better seat. Over forty matches a coin toss lands between
    // twelve and twenty-eight often enough for this band to be quiet and still catch a
    // game in which one half of the dish is simply easier to hold.
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      let p1Wins = 0;
      for (let seed = 1; seed <= 40; seed += 1) {
        if (botMatch(seed * 619, tier, tier) === 'p1') p1Wins += 1;
      }
      expect(p1Wins, tier).toBeGreaterThan(11);
      expect(p1Wins, tier).toBeLessThan(29);
    }
  });

  it('plays a visibly different match on each tier from the same seed', () => {
    const seen = new Set<string>();
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const game = new SpinWarGame();
      game.init(makeContext(20260823, tier, 'normal'));
      const input = new ScriptedInput();
      for (let i = 0; i < 600; i += 1) game.update(STEP, input);
      const p1 = game.spinner('p1');
      seen.add(`${p1.x.toFixed(4)}:${p1.y.toFixed(4)}:${p1.spin.toFixed(4)}`);
      game.destroy();
    }
    expect(seen.size).toBe(3);
  });

  it('plays a different match with a bot than with an empty seat', () => {
    const withBot = new SpinWarGame();
    withBot.init(makeContext(4242, null, 'normal'));
    const without = new SpinWarGame();
    without.init(makeContext(4242, null, null));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) {
      withBot.update(STEP, input);
      without.update(STEP, input);
    }
    expect(withBot.spinner('p2').x).not.toBe(without.spinner('p2').x);
  });
});

describe('the manifest', () => {
  it('describes the game the code actually is', () => {
    expect(manifest.id).toBe('spin-war');
    expect(manifest.archetype).toBe('rt-arena');
    expect(manifest.zoneSplit).toBe('shared-board');
    expect(manifest.modes).toEqual(['friend', 'bot']);
    expect(manifest.logical).toEqual({ width: 800, height: 800 });
  });

  it('puts the bowl inside the box it declares', () => {
    const game = new SpinWarGame();
    game.init(makeContext(1));
    expect(game.bowl.centreX * 2).toBe(manifest.logical.width);
    expect(game.bowl.centreY * 2).toBe(manifest.logical.height);
    expect(game.bowl.radius).toBeLessThan(manifest.logical.width / 2);
  });

  it('gives each seat its own half of the keyboard and says which', () => {
    const { keyboard } = manifest.controls;
    expect(keyboard).toMatch(/W A S D/);
    expect(keyboard).toMatch(/arrow/i);
    expect(keyboard).toMatch(/player one/i);
    expect(keyboard).toMatch(/player two/i);
    // "W A S D or the arrow keys" would be a lie: the two halves are two people.
    expect(keyboard).not.toMatch(/\bor\b[^,:]*arrow/i);
  });

  it('promises no key the game does not read', () => {
    // Five control strings shipped wrong in Mini Soccer. This game has no action button
    // at all, so the string must not offer one — and the code must not read one.
    const { keyboard, pointer } = manifest.controls;
    expect(keyboard).not.toMatch(/space|enter|fire|throw|boost/i);
    expect(pointer).not.toMatch(/tap|release|hold/i);

    const game = new SpinWarGame();
    game.init(makeContext(2));
    const input = new ScriptedInput();
    settle(game, input);
    const held = new SpinWarGame();
    held.init(makeContext(2));
    const withAction = new ScriptedInput();
    const seat = withAction.seat('p1') as MutableSeatInput;
    seat.actionHeld = true;
    seat.actionPressed = true;
    settle(held, withAction);
    for (let i = 0; i < 120; i += 1) {
      game.update(STEP, input);
      held.update(STEP, withAction);
    }
    expect(held.spinner('p1').x).toBe(game.spinner('p1').x);
  });
});
