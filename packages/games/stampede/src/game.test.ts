import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { StampedeGame } from './game.js';
import {
  AIR_SECONDS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  RUNNER_RADIUS,
  courseSeconds,
  enterLead,
  runnerOf,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;

/** The two beast colours, which `game.ts` owns; named here so the horn count can be read. */
const COLOUR_BULL = '#4e3a26';
const COLOUR_GOAT = '#8e7550';
type Presentation = 'shared-screen' | 'single-seat';

/* --------------------------------------------------------------- scripted input */

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

/**
 * Two ways to spell the one thing this game reads, and a third that is not it.
 *
 * `tapKey` and `tapFinger` differ in everything except `actionPressed`; a test below drives
 * the identical match through both and compares the whole simulation, which is the strongest
 * form the input-parity claim can take. `hold` keeps the action down without a fresh edge,
 * and must move nothing at all.
 */
class ScriptedInput implements InputState {
  readonly #p1 = blankSeat();
  readonly #p2 = blankSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  tapKey(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionPressed = true;
    target.actionHeld = true;
  }

  tapFinger(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionPressed = true;
    target.actionHeld = true;
  }

  /** The action still down from a previous step: held, but no new press. */
  hold(seat: SeatId): void {
    const target = this.#of(seat);
    target.actionPressed = false;
    target.actionHeld = true;
    target.holdSeconds += STEP;
  }

  /** Everything a seat could send that is not a press: a direction, a drag, a release. */
  fidget(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.move.x = 1;
    target.move.y = -1;
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionPressed = false;
    target.actionHeld = false;
    target.actionReleased = true;
  }

  release(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.move.x = 0;
    target.move.y = 0;
    target.actionPressed = false;
    target.actionHeld = false;
    target.actionReleased = false;
    target.holdSeconds = 0;
  }

  #of(seat: SeatId): MutableSeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

/* ------------------------------------------------------------------- recording */

type DrawArg = string | number | boolean | undefined;

interface Call {
  readonly op: string;
  readonly args: readonly DrawArg[];
}

class RecordingRenderer implements Renderer {
  readonly calls: Call[] = [];

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

  /** Every call with the colour arguments dropped: the picture a greyscale player sees. */
  shapesOnly(): string[] {
    return this.calls.map(
      (call) =>
        `${call.op}(${call.args
          .filter((arg) => typeof arg !== 'string' || !/^(#|rgba?\()/.test(arg))
          .map((arg) => (typeof arg === 'number' ? arg.toFixed(2) : String(arg)))
          .join(',')})`,
    );
  }

  #record(op: string, ...args: DrawArg[]): void {
    this.calls.push({ op, args });
  }
}

function makeContext(
  seed: number,
  botP1: BotDifficulty | null = null,
  botP2: BotDifficulty | null = null,
  presentation: Presentation = 'shared-screen',
  localSeat: SeatId = 'p1',
  openingSeat: SeatId = 'p1',
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat,
    openingSeat,
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return seat === 'p1' ? botP1 : botP2;
    },
  };
}

/** Everything the simulation holds, flattened, so a change anywhere shows up. */
function snapshot(game: StampedeGame): string {
  const field = game.field;
  return JSON.stringify({
    clock: field.clock,
    count: field.count,
    total: field.total,
    winner: field.winner,
    p1: field.p1,
    p2: field.p2,
    herd: field.hazards.slice(0, field.count),
  });
}

function run(game: StampedeGame, input: InputState, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, input);
}

/* ------------------------------------------------------------------------------------ */

describe('the contract', () => {
  it('never claims to have turns, because both runners jump at once', () => {
    // `rt-*` archetypes must not implement it at all — the shell reads its presence and its
    // value to decide whether to hand the whole board and both key halves to one seat.
    const game = new StampedeGame();
    expect((game as { getActiveSeat?: unknown }).getActiveSeat).toBeUndefined();
  });

  it('reports a score of the shape the shell expects', () => {
    const game = new StampedeGame();
    game.init(makeContext(1));
    const score = game.getScore();
    expect(score.p1).toBe(0);
    expect(score.p2).toBe(0);
    expect(score.winner).toBeNull();
    game.destroy();
  });

  it('does nothing at all before init and after destroy', () => {
    const game = new StampedeGame();
    const input = new ScriptedInput();
    input.tapKey('p1');
    input.tapKey('p2');
    // Before init: the shell may drive a game it has not started, and it must be inert. An
    // empty course is over before it begins rather than never, which is what makes it so.
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    expect(game.field.clock).toBe(0);
    expect(game.field.count).toBe(0);

    game.init(makeContext(2, 'hard', 'hard'));
    run(game, input, 600);
    expect(game.field.clock).toBeGreaterThan(0);
    expect(game.field.count).toBeGreaterThan(0);

    game.destroy();
    expect(game.field.clock).toBe(0);
    expect(game.field.count).toBe(0);
    expect(game.field.p1.points).toBe(0);
    const after = snapshot(game);
    run(game, input, 300);
    expect(snapshot(game)).toBe(after);
  });

  it('plays the identical match twice from the same seed', () => {
    const trace = (): string[] => {
      const game = new StampedeGame();
      game.init(makeContext(99, 'normal', 'easy'));
      const input = new ScriptedInput();
      const seen: string[] = [];
      for (let i = 0; i < 900; i += 1) {
        game.update(STEP, input);
        seen.push(snapshot(game));
      }
      game.destroy();
      return seen;
    };
    expect(trace()).toEqual(trace());
  });

  it('spends the opening seat on the herd, since it has no opener to wash out', () => {
    // The contract lets a real-time game ignore `openingSeat`, and eighty-one of ninety-three
    // do. This one uses it: there is no first mover here for the alternation to cancel, so it
    // deals the two halves of a best-of two different courses rather than the same one twice.
    const trace = (openingSeat: SeatId): string => {
      const game = new StampedeGame();
      game.init(makeContext(31, 'normal', 'normal', 'shared-screen', 'p1', openingSeat));
      run(game, new ScriptedInput(), 900);
      const result = snapshot(game);
      game.destroy();
      return result;
    };
    expect(trace('p1')).not.toBe(trace('p2'));
  });

  it('deals both seats the same herd whichever seat the shell nominates as opener', () => {
    // The seat symmetry is not weakened by reading `openingSeat`, because what it changes is
    // the course *both* seats run. There is no per-seat geometry anywhere in `rules.ts` to
    // change, and this is the check that the shell cannot introduce one.
    for (const openingSeat of ['p1', 'p2'] as const) {
      const game = new StampedeGame();
      game.init(makeContext(32, null, null, 'shared-screen', 'p1', openingSeat));
      const input = new ScriptedInput();
      for (let i = 0; i < 2400; i += 1) {
        input.release('p1');
        input.release('p2');
        if (i % 43 === 0) {
          input.tapKey('p1');
          input.tapKey('p2');
        }
        game.update(STEP, input);
        // Identical presses against one herd: the two runners must be in identical states.
        expect(JSON.stringify(game.field.p1)).toBe(JSON.stringify(game.field.p2));
      }
      expect(game.field.p1.cleared).toBeGreaterThan(0);
      game.destroy();
    }
  });

  it('steps the identical match in both presentations, from either local seat', () => {
    // `docs/presentation.md`: rules and simulation are byte-identical across both, and only
    // placement, rotation and control mapping change. Here not even the control mapping
    // changes — a press is a press — so this is the strongest form of the claim.
    const trace = (presentation: Presentation, localSeat: SeatId): string => {
      const game = new StampedeGame();
      game.init(makeContext(77, 'hard', 'easy', presentation, localSeat));
      run(game, new ScriptedInput(), 900);
      const result = snapshot(game);
      game.destroy();
      return result;
    };
    const base = trace('shared-screen', 'p1');
    expect(trace('single-seat', 'p1')).toBe(base);
    expect(trace('single-seat', 'p2')).toBe(base);
    expect(trace('shared-screen', 'p2')).toBe(base);
  });

  it('gives each bot seat its own generator, so a tier cannot leak across the lane', () => {
    // The number of values a tier draws depends on how many beasts it decides to jump for,
    // so on a shared stream one seat's play would become a function of which tier was
    // sitting opposite. Star Catcher measured that shape at 1.4 points of win rate.
    //
    // Compared step by step rather than at the end, and on what seat two *did* rather than
    // on its whole record: the two matches finish up to `DANGER_SECONDS` apart, because
    // whether seat one clears or is bowled over by the last beast decides when its own
    // cursor reaches the end, and the render decays go on ticking until it does.
    const seatTwo = (against: BotDifficulty): string[] => {
      const game = new StampedeGame();
      game.init(makeContext(4242, against, 'normal'));
      const input = new ScriptedInput();
      const trace: string[] = [];
      for (let i = 0; i < 2000; i += 1) {
        game.update(STEP, input);
        const p2 = game.field.p2;
        trace.push(
          [
            String(p2.jumping),
            p2.jumpStart.toFixed(9),
            String(p2.cursor),
            String(p2.points),
            String(p2.clean),
            String(p2.hits),
            String(p2.jumps),
          ].join('/'),
        );
      }
      game.destroy();
      return trace;
    };
    expect(seatTwo('easy')).toEqual(seatTwo('hard'));
  });

  it('finishes every match it starts, at both tiers and from a cold shell', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const game = new StampedeGame();
      game.init(makeContext(808, tier, tier));
      let steps = 0;
      while (game.getScore().winner === null) {
        game.update(STEP, new ScriptedInput());
        steps += 1;
        expect(steps).toBeLessThan(60 * 120);
      }
      expect(steps * STEP).toBeGreaterThan(20);
      game.destroy();
    }
  });

  it('advertises a round length that matches the course it actually lays out', () => {
    // `roundSeconds` ends nothing — it is text on a catalogue card — so the two are only
    // equal because something keeps them equal.
    let longest = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const game = new StampedeGame();
      game.init(makeContext(seed * 7919 + 3));
      longest = Math.max(longest, courseSeconds(game.field));
      game.destroy();
    }
    expect(Math.abs(manifest.roundSeconds - longest)).toBeLessThan(4);
  });
});

/* ------------------------------------------------------------------------------------ */

describe('input', () => {
  it('reads one bit from each seat, and a key and a finger send the identical bit', () => {
    // The whole fairness argument in one test. A press has no position, no direction and no
    // duration, so the two instruments cannot express a difference — and here they do not.
    const trace = (spell: 'key' | 'finger'): string => {
      const game = new StampedeGame();
      game.init(makeContext(55));
      const input = new ScriptedInput();
      for (let i = 0; i < 2400; i += 1) {
        input.release('p1');
        input.release('p2');
        if (i % 47 === 0) {
          if (spell === 'key') {
            input.tapKey('p1');
            input.tapKey('p2');
          } else {
            input.tapFinger('p1', 137, 880);
            input.tapFinger('p2', 411, 120);
          }
        }
        game.update(STEP, input);
      }
      const result = snapshot(game);
      game.destroy();
      return result;
    };
    expect(trace('key')).toBe(trace('finger'));
  });

  it('cares where a finger is only in so far as the engine decided whose seat it is', () => {
    // The pointer position never reaches this game. A tap in the middle of one seat's half
    // and a tap in its far corner are the same press, so the precision envelope in
    // `docs/input-parity.md` is not even load-bearing here.
    const trace = (x: number, y: number): string => {
      const game = new StampedeGame();
      game.init(makeContext(56));
      const input = new ScriptedInput();
      for (let i = 0; i < 1800; i += 1) {
        input.release('p1');
        if (i % 53 === 0) input.tapFinger('p1', x, y);
        game.update(STEP, input);
      }
      const result = JSON.stringify(game.field.p1);
      game.destroy();
      return result;
    };
    expect(trace(2, 999)).toBe(trace(598, 502));
  });

  it('jumps on the press and not on the hold, so nothing repeats while a key is down', () => {
    const game = new StampedeGame();
    game.init(makeContext(57));
    const input = new ScriptedInput();
    input.tapKey('p1');
    game.update(STEP, input);
    expect(runnerOf(game.field, 'p1').jumps).toBe(1);
    for (let i = 0; i < 600; i += 1) {
      input.hold('p1');
      game.update(STEP, input);
    }
    expect(runnerOf(game.field, 'p1').jumps).toBe(1);
    game.destroy();
  });

  it('ignores every other thing a seat can send', () => {
    const game = new StampedeGame();
    game.init(makeContext(58));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) {
      input.fidget('p1', 100 + i, 700);
      game.update(STEP, input);
    }
    expect(runnerOf(game.field, 'p1').jumps).toBe(0);
    game.destroy();
  });

  it('keeps one seat’s press out of the other seat’s lane', () => {
    const game = new StampedeGame();
    game.init(makeContext(59));
    const input = new ScriptedInput();
    input.tapKey('p1');
    game.update(STEP, input);
    expect(runnerOf(game.field, 'p1').jumps).toBe(1);
    expect(runnerOf(game.field, 'p2').jumps).toBe(0);
    game.destroy();
  });

  it('is unmoved by a pause, because there is no held state to plant', () => {
    const game = new StampedeGame();
    game.init(makeContext(60, 'normal', 'normal'));
    run(game, new ScriptedInput(), 400);
    const before = snapshot(game);
    game.onPause();
    game.onResume();
    expect(snapshot(game)).toBe(before);
    game.destroy();
  });
});

/* ------------------------------------------------------------------------------------ */

describe('rendering', () => {
  it('changes nothing, at any alpha', () => {
    const game = new StampedeGame();
    game.init(makeContext(3, 'hard', 'normal'));
    run(game, new ScriptedInput(), 400);
    const before = snapshot(game);
    const renderer = new RecordingRenderer();
    for (let i = 0; i < 40; i += 1) {
      game.render(renderer, 0);
      game.render(renderer, 0.5);
      game.render(renderer, 0.99);
    }
    expect(snapshot(game)).toBe(before);
    expect(renderer.calls.length).toBeGreaterThan(0);
    game.destroy();
  });

  it('interpolates between the last two steps, which is what alpha is for', () => {
    // A beast crosses the lane at up to 380 units a second, which is six units a step: a
    // display running above the simulation rate strobes it visibly without this. The
    // simulation is evaluated from the clock rather than integrated, so carrying it forward
    // by part of a step is asking the same function the same question a moment later.
    const game = new StampedeGame();
    game.init(makeContext(4, 'normal', 'normal'));
    run(game, new ScriptedInput(), 300);
    const at = (alpha: number): string[] => {
      const renderer = new RecordingRenderer();
      game.render(renderer, alpha);
      return renderer.shapesOnly();
    };
    expect(at(0.75)).not.toEqual(at(0));
    game.destroy();
  });

  it('keeps every drawn point inside the declared logical box', () => {
    const game = new StampedeGame();
    game.init(makeContext(5, 'easy', 'hard'));
    const input = new ScriptedInput();
    const renderer = new RecordingRenderer();
    // A generous margin: a beast half off the edge and a stroke legitimately overhang. What
    // this catches is a game drawing in a box other than the one its manifest declares.
    const limit = Math.max(BOARD_WIDTH, BOARD_HEIGHT) + 120;
    for (let i = 0; i < 1800; i += 1) {
      game.update(STEP, input);
      if (i % 7 === 0) game.render(renderer, 0);
    }
    for (const call of renderer.calls) {
      for (const arg of call.args) {
        if (typeof arg !== 'number') continue;
        expect(Math.abs(arg), `${call.op} drew at ${String(arg)}`).toBeLessThanOrEqual(limit);
      }
    }
    expect(renderer.calls.length).toBeGreaterThan(100);
    game.destroy();
  });

  it('keeps each seat’s lane on its own side of the centre line', () => {
    // Rule 9 in the shape a split-screen game takes it: neither player may see more of the
    // play area than the other, and neither may have the other's material drawn over their
    // own. Every seat-coloured mark is checked against the half of the board it belongs to.
    const game = new StampedeGame();
    game.init(makeContext(14, 'hard', 'hard'));
    const input = new ScriptedInput();
    let checked = 0;
    for (let i = 0; i < 1800; i += 1) {
      game.update(STEP, input);
      if (i % 9 !== 0) continue;
      const renderer = new RecordingRenderer();
      game.render(renderer, 0.4);
      for (const call of renderer.calls) {
        for (const seat of ['p1', 'p2'] as const) {
          const palette = SEAT_PALETTE[seat];
          const own = [palette.base, palette.deep, palette.tint, palette.soft];
          if (!call.args.some((arg) => typeof arg === 'string' && own.includes(arg))) continue;
          // `y` is the second numeric argument of every primitive this game draws except
          // `line`, whose two endpoints are the first and third pair.
          const ys = call.op === 'line' ? [call.args[1], call.args[3]] : [call.args[1]];
          for (const y of ys) {
            if (typeof y !== 'number') continue;
            checked += 1;
            if (seat === 'p1')
              expect(y, `p1 drew at y ${String(y)}`).toBeGreaterThanOrEqual(BOARD_HEIGHT / 2);
            else expect(y, `p2 drew at y ${String(y)}`).toBeLessThanOrEqual(BOARD_HEIGHT / 2);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    game.destroy();
  });

  it('draws no text at all, ever', () => {
    // Nothing here needs saying in words, and a glyph would be upside down for one of the
    // two people looking at it — the two lanes are half-turn images and nothing is rotated.
    const game = new StampedeGame();
    game.init(makeContext(6, 'hard', 'hard'));
    const input = new ScriptedInput();
    const renderer = new RecordingRenderer();
    for (let i = 0; i < 2400; i += 1) {
      game.update(STEP, input);
      if (i % 5 === 0) game.render(renderer, 0.3);
    }
    expect(renderer.calls.filter((call) => call.op === 'text')).toHaveLength(0);
    expect(renderer.calls.filter((call) => call.op.includes('otation'))).toHaveLength(0);
    game.destroy();
  });
});

/* ------------------------------------------------------------------------------------ */

/** Every primitive a seat draws in one of its own four palette strings. */
function seatKinds(calls: readonly Call[], seat: SeatId): Set<string> {
  const palette = SEAT_PALETTE[seat];
  const own = new Set<string>([palette.base, palette.deep, palette.tint, palette.soft]);
  const kinds = new Set<string>();
  for (const call of calls) {
    if (call.args.some((arg) => typeof arg === 'string' && own.has(arg))) kinds.add(call.op);
  }
  return kinds;
}

describe('rule 7: the two seats differ by more than colour', () => {
  it('draws seat one round and seat two square, in every mark either of them owns', () => {
    // Two runners doing the identical thing at the identical instant is the pair most likely
    // to be confused, and the two seat colours sit at 1.03:1 under deuteranopia
    // (`packages/engine/src/palette-vision.test.ts`). Every seat-owned mark goes through one
    // of two helpers, so the shape cannot drift apart from the colour.
    const game = new StampedeGame();
    game.init(makeContext(11, 'normal', 'normal'));
    const input = new ScriptedInput();
    const renderer = new RecordingRenderer();
    for (let i = 0; i < 1800; i += 1) {
      game.update(STEP, input);
      if (i % 11 === 0) game.render(renderer, 0);
    }
    const p1 = seatKinds(renderer.calls, 'p1');
    const p2 = seatKinds(renderer.calls, 'p2');
    expect(p1).toContain('circle');
    expect(p1).toContain('strokeCircle');
    expect(p2).toContain('rect');
    expect(p2).toContain('strokeRect');
    // And the evidence runs both ways, which is what the cross-game greyscale harness looks
    // for: a primitive one seat draws steadily and the other never draws at all.
    expect(p1.has('strokeRect')).toBe(false);
    expect(p2.has('circle')).toBe(false);
    expect(p2.has('strokeCircle')).toBe(false);
    game.destroy();
  });

  it('tells a bull from a goat by its horns, not by its colour', () => {
    // A choice asks which of two beasts is worth saving, so telling them apart is the whole
    // decision. A bull carries two horn strokes and a goat one, in the lane and in the dust
    // that announces it — and nothing in the herd is drawn in either seat's colour.
    const game = new StampedeGame();
    game.init(makeContext(12));
    const input = new ScriptedInput();
    let sawBull = 0;
    let sawGoat = 0;
    for (let i = 0; i < 2400; i += 1) {
      game.update(STEP, input);
      const field = game.field;
      let bulls = 0;
      let goats = 0;
      for (let h = 0; h < field.count; h += 1) {
        const hazard = field.hazards[h];
        if (hazard === undefined) continue;
        const since = field.clock - hazard.arrival;
        const lead = enterLead(hazard);
        // In the lane, rather than still announced by dust at the edge: only a beast in the
        // lane carries its horns in its own colour.
        if (since < -lead || since > lead) continue;
        if (hazard.beast === 'bull') bulls += 1;
        else goats += 1;
      }
      if (bulls === 0 && goats === 0) continue;
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      const horns = (colour: string): number =>
        renderer.calls.filter((call) => call.op === 'line' && call.args.includes(colour)).length;
      // Two lanes, and a bull carries two horn strokes to a goat's one.
      expect(horns(COLOUR_BULL), `step ${String(i)}`).toBe(bulls * 2 * 2);
      expect(horns(COLOUR_GOAT), `step ${String(i)}`).toBe(goats * 1 * 2);
      sawBull += bulls;
      sawGoat += goats;
    }
    expect(sawBull).toBeGreaterThan(0);
    expect(sawGoat).toBeGreaterThan(0);
    game.destroy();
  });

  it('shows a runner in the air by where it is, not by what colour it has turned', () => {
    const game = new StampedeGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    const heights = new Set<string>();
    input.tapKey('p1');
    for (let i = 0; i < Math.round(AIR_SECONDS / STEP); i += 1) {
      game.update(STEP, input);
      input.release('p1');
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      const body = renderer.calls.find(
        (call) =>
          call.op === 'circle' &&
          call.args.includes(SEAT_PALETTE.p1.base) &&
          call.args[2] === RUNNER_RADIUS,
      );
      expect(body).toBeDefined();
      heights.add(String(body?.args[1]));
    }
    expect(heights.size).toBeGreaterThan(20);
    game.destroy();
  });
});
