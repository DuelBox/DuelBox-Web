import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, InputManager, InputView, Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign } from '@duelbox/engine';
import type { Game, GameContext, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { HALF_HEIGHT, LightFingersGame, halfTop } from './game.js';
import {
  ALARM_SECONDS,
  OPEN_SECONDS,
  SLOT_COUNT,
  START_SLOT,
  TARGET_POINTS,
  slotCentreX,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
const KEYS = DEFAULT_BINDINGS;

function makeContext(
  seed: number,
  botP1: BotDifficulty | null = null,
  botP2: BotDifficulty | null = null,
  presentation: Presentation = 'shared-screen',
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return seat === 'p1' ? botP1 : botP2;
    },
  };
}

/**
 * A game wired to the real `InputManager`.
 *
 * The engine is what sorts keys and touches into seats and what owns a pointer that
 * crosses the midline, so driving through it is the only way these tests can say anything
 * about whether a *player* can reach this game.
 */
class Table {
  readonly game = new LightFingersGame();
  readonly input = new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' });
  readonly view = new InputView();

  constructor(context: GameContext) {
    this.game.init(context);
  }

  step(count = 1): void {
    for (let i = 0; i < count; i += 1) {
      this.game.update(STEP, this.view.sync(this.input.beginStep(STEP)));
    }
  }

  /** Steps until the diamond is showing, or gives up. */
  toOpen(): void {
    for (let i = 0; i < 60 * 20 && this.game.state.phase !== 'open'; i += 1) this.step();
  }

  /** Steps until this seat has settled where it is aiming. */
  settle(seat: SeatId): void {
    const hand = seat === 'p1' ? this.game.state.p1Hand : this.game.state.p2Hand;
    for (let i = 0; i < 120 && hand.slot !== hand.want; i += 1) this.step();
  }

  touch(id: number, x: number, y: number): void {
    this.input.pointerDown(id, x, y);
  }
}

/** Where a seat's own half sits, for putting a finger in it. */
function seatY(seat: SeatId): number {
  return seat === 'p1' ? 750 : 250;
}

type DrawArg = number | string | boolean | undefined;

class RecordingRenderer implements Renderer {
  readonly ops: string[] = [];
  readonly args: DrawArg[] = [];

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
    this.ops.push(op);
    for (const value of values) this.args.push(value);
  }
}

const ARG_COUNTS: Readonly<Record<string, number>> = Object.freeze({
  clear: 1,
  rect: 5,
  strokeRect: 6,
  circle: 4,
  strokeCircle: 5,
  line: 6,
  text: 6,
  pushSeatRotation: 1,
  pushRotation: 1,
  popSeatRotation: 0,
});

interface Placed {
  readonly op: string;
  readonly value: string;
  /** Where it lands on the device once any seat rotation has been applied. */
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** Every text and circle, placed where the viewer actually sees it. */
function placed(renderer: RecordingRenderer): Placed[] {
  const height = manifest.logical.height;
  const width = manifest.logical.width;
  const out: Placed[] = [];
  let rotated = false;
  let cursor = 0;
  for (const op of renderer.ops) {
    if (op === 'pushSeatRotation') rotated = renderer.args[cursor] === true;
    if (op === 'popSeatRotation') rotated = false;
    if (op === 'text' || op === 'circle') {
      const label = op === 'text' ? renderer.args[cursor] : '';
      const x = renderer.args[cursor + (op === 'text' ? 1 : 0)];
      const y = renderer.args[cursor + (op === 'text' ? 2 : 1)];
      const radius = op === 'circle' ? renderer.args[cursor + 2] : 0;
      if (typeof label === 'string' && typeof x === 'number' && typeof y === 'number') {
        out.push({
          op,
          value: label,
          x: rotated ? width - x : x,
          y: rotated ? height - y : y,
          radius: typeof radius === 'number' ? radius : 0,
        });
      }
    }
    cursor += ARG_COUNTS[op] ?? 0;
  }
  return out;
}

function labels(renderer: RecordingRenderer): string[] {
  return placed(renderer)
    .filter((entry) => entry.op === 'text')
    .map((entry) => entry.value);
}

function frame(game: LightFingersGame): RecordingRenderer {
  const renderer = new RecordingRenderer();
  game.render(renderer);
  return renderer;
}

/**
 * One script, expressed twice.
 *
 * A player who waits for the lights, reaches for the diamond and grabs — spelled once
 * with the keys and once with a finger. Everything else about the two runs is identical,
 * so the difference in how often they win is the difference between the instruments.
 */
function playSkilled(seed: number, instrument: 'keyboard' | 'pointer'): SeatId | 'draw' | null {
  const table = new Table(makeContext(seed, null, 'normal'));
  const reaction = 0.26;
  let watched = 0;
  let downId = 0;
  let holding: string | null = null;

  const release = (): void => {
    if (holding !== null) {
      table.input.keyUp(holding);
      holding = null;
    }
    table.input.keyUp(KEYS.p1.action);
    if (downId !== 0) {
      table.input.pointerUp(downId);
      downId = 0;
    }
  };

  for (let i = 0; i < 60 * 240; i += 1) {
    const state = table.game.state;
    const hand = state.p1Hand;
    if (state.phase !== 'open') {
      watched = 0;
      release();
    } else {
      watched += STEP;
      if (watched < reaction || hand.lock > 0) {
        release();
      } else if (instrument === 'keyboard') {
        if (hand.want !== state.diamond) {
          const key = state.diamond > hand.want ? KEYS.p1.right : KEYS.p1.left;
          if (holding !== key) {
            release();
            table.input.keyDown(key);
            holding = key;
          }
        } else {
          if (holding !== null) {
            table.input.keyUp(holding);
            holding = null;
          }
          table.input.keyDown(KEYS.p1.action);
        }
      } else if (downId === 0) {
        downId = 1;
        table.input.pointerDown(downId, slotCentreX(state.diamond), seatY('p1'));
      }
    }
    table.step();
    const score = table.game.getScore();
    if (score.winner !== null) {
      table.game.destroy();
      return score.winner;
    }
  }
  table.game.destroy();
  return null;
}

describe('the halves', () => {
  it('gives each seat exactly half the box', () => {
    expect(HALF_HEIGHT * 2).toBe(manifest.logical.height);
    expect(halfTop('p2')).toBe(0);
    expect(halfTop('p1')).toBe(HALF_HEIGHT);
  });

  it('starts level, with nothing decided', () => {
    const table = new Table(makeContext(3));
    expect(table.game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('never claims to have turns', () => {
    // A real-time game reporting an active seat would switch the shell into shared-board
    // mode and take one seat's pointer zone away entirely.
    const game: Game = new LightFingersGame();
    expect(game.getActiveSeat?.() ?? null).toBeNull();
  });

  it('does nothing before it has been given a context', () => {
    const game = new LightFingersGame();
    const view = new InputView();
    const input = new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' });
    game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });
});

describe('the keyboard', () => {
  it('gives seat one A and D', () => {
    const table = new Table(makeContext(5));
    table.input.keyDown(KEYS.p1.left);
    table.step(20);
    expect(table.game.state.p1Hand.slot).toBeLessThan(START_SLOT);
  });

  it('gives seat two the arrow keys', () => {
    const table = new Table(makeContext(5));
    table.input.keyDown(KEYS.p2.right);
    table.step(20);
    expect(table.game.state.p2Hand.slot).toBeGreaterThan(START_SLOT);
  });

  it('never lets one seat drive the other', () => {
    // Each seat gets its OWN half of the keyboard. "W A S D or the arrow keys" would be a
    // lie in this archetype: the other half moves your opponent.
    const table = new Table(makeContext(7));
    table.input.keyDown(KEYS.p1.right);
    table.step(30);
    expect(table.game.state.p1Hand.slot).toBeGreaterThan(START_SLOT);
    expect(table.game.state.p2Hand.slot, 'the far hand never moved').toBe(START_SLOT);
  });

  it('commits with Space for seat one and Enter for seat two', () => {
    const table = new Table(makeContext(9));
    table.input.keyDown(KEYS.p1.action);
    table.input.keyDown(KEYS.p2.action);
    table.step();
    expect(table.game.state.p1Hand.armed).toBe(true);
    expect(table.game.state.p2Hand.armed).toBe(true);
  });

  it('walks the hand one pedestal at a time while a key is held', () => {
    const table = new Table(makeContext(11));
    table.input.keyDown(KEYS.p1.right);
    table.step(3);
    expect(table.game.state.p1Hand.slot).toBe(START_SLOT + 1);
    table.step(6);
    expect(table.game.state.p1Hand.slot).toBe(START_SLOT + 2);
  });
});

describe('the pointer', () => {
  it('sends a hand to the pedestal a finger names', () => {
    const table = new Table(makeContext(13));
    table.touch(1, slotCentreX(0), seatY('p1'));
    table.step();
    expect(table.game.state.p1Hand.want).toBe(0);
    table.settle('p1');
    expect(table.game.state.p1Hand.slot).toBe(0);
  });

  it('lets seat two reach the same pedestals from its own half', () => {
    const table = new Table(makeContext(13));
    table.touch(2, slotCentreX(SLOT_COUNT - 1), seatY('p2'));
    table.step();
    expect(table.game.state.p2Hand.want).toBe(SLOT_COUNT - 1);
    expect(table.game.state.p1Hand.want, 'seat one was not touched').toBe(START_SLOT);
  });

  it('keeps a finger with the seat it started in across the midline', () => {
    // Engine behaviour, relied on rather than reimplemented: a drag that crosses the
    // divider must keep feeding the player it came from.
    const table = new Table(makeContext(15));
    table.touch(3, slotCentreX(0), seatY('p1'));
    table.step();
    table.input.pointerMove(3, slotCentreX(SLOT_COUNT - 1), seatY('p2'));
    table.step();
    expect(table.game.state.p1Hand.want).toBe(SLOT_COUNT - 1);
    expect(table.game.state.p2Hand.want, 'the far seat never saw that finger').toBe(START_SLOT);
  });

  it('commits on the same touch that names the pedestal', () => {
    const table = new Table(makeContext(17));
    table.touch(4, slotCentreX(4), seatY('p1'));
    table.step();
    expect(table.game.state.p1Hand.armed).toBe(true);
    expect(table.game.state.p1Hand.want).toBe(4);
  });
});

describe('one press, one commit', () => {
  it('does not re-arm a hand while the action is still held', () => {
    // Otherwise leaning on the button would be the dominant strategy: an alarm would cost
    // nothing and the whole gamble would disappear.
    const table = new Table(makeContext(19));
    table.toOpen();
    const wrong = table.game.state.diamond === 0 ? 1 : 0;
    table.input.pointerDown(1, slotCentreX(wrong), seatY('p1'));
    table.step();
    table.settle('p1');
    table.step();
    expect(table.game.state.p1Hand.lock).toBeGreaterThan(0);
    table.step(Math.round((ALARM_SECONDS + 0.1) / STEP));
    expect(table.game.state.p1Hand.lock).toBe(0);
    expect(table.game.state.p1Hand.armed, 'the still-held finger did not re-arm').toBe(false);
  });

  it('does not commit for an action still held across a pause', () => {
    const table = new Table(makeContext(21));
    table.input.keyDown(KEYS.p1.action);
    table.game.onPause();
    table.game.onResume();
    table.step(10);
    expect(table.game.state.p1Hand.armed, 'the still-down key did nothing').toBe(false);

    table.input.keyUp(KEYS.p1.action);
    table.step();
    table.input.keyDown(KEYS.p1.action);
    table.step();
    expect(table.game.state.p1Hand.armed, 'and a genuine press still works').toBe(true);
  });
});

describe('the match', () => {
  it('ends at the target', () => {
    const table = new Table(makeContext(23, 'hard', 'easy'));
    for (let i = 0; i < 60 * 600 && table.game.getScore().winner === null; i += 1) table.step();
    const score = table.game.getScore();
    expect(score.winner).not.toBeNull();
    expect(Math.max(score.p1, score.p2)).toBeGreaterThanOrEqual(TARGET_POINTS);
  });

  it('reaches a decision even when nobody ever plays', () => {
    // The backstop clock, which is what makes termination a property of the rules rather
    // than a hope about the players. Two absent humans bust every round for ever.
    const table = new Table(makeContext(25));
    let steps = 0;
    for (; steps < 60 * 600 && table.game.getScore().winner === null; steps += 1) table.step();
    expect(table.game.getScore().winner).toBe('draw');
    expect(steps * STEP).toBeLessThan(200);
  });

  it('stops simulating once decided', () => {
    const table = new Table(makeContext(27, 'hard', 'easy'));
    for (let i = 0; i < 60 * 600 && table.game.getScore().winner === null; i += 1) table.step();
    const frozen = `${String(table.game.getScore().p1)}:${String(table.game.getScore().p2)}`;
    table.step(600);
    const after = `${String(table.game.getScore().p1)}:${String(table.game.getScore().p2)}`;
    expect(after).toBe(frozen);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const table = new Table(makeContext(29, 'normal', 'easy'));
      const out: string[] = [];
      for (let i = 0; i < 60 * 60; i += 1) {
        table.step();
        const state = table.game.state;
        out.push(
          `${state.phase[0] ?? '?'}${String(state.p1Hand.slot)}${String(state.p2Hand.slot)}`,
        );
      }
      return out.join('');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init', () => {
    const game = new LightFingersGame();
    const view = new InputView();
    const input = new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' });
    game.init(makeContext(31, 'easy', 'easy'));
    for (let i = 0; i < 60 * 60; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(game.state.p1 + game.state.p2).toBeGreaterThan(0);

    game.init(makeContext(31, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.state.phase).toBe('casing');
    expect(game.state.p1Hand.slot).toBe(START_SLOT);
  });

  it('clears on destroy', () => {
    const table = new Table(makeContext(33, 'easy', 'easy'));
    table.step(600);
    table.game.destroy();
    expect(table.game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    table.step();
    expect(table.game.getScore().p1).toBe(0);
  });
});

describe('the bot', () => {
  it('never plays the human seat', () => {
    const table = new Table(makeContext(35, null, 'hard'));
    for (let i = 0; i < 60 * 120 && table.game.getScore().winner === null; i += 1) {
      table.step();
      expect(table.game.state.p1Hand.armed, 'nothing committed for the human').toBe(false);
      expect(table.game.state.p1Hand.slot, 'and nothing moved its hand').toBe(START_SLOT);
    }
    expect(table.game.getScore().p2, 'the bot played on regardless').toBeGreaterThan(0);
  });

  it('plays a visibly different match on easy and on hard', () => {
    const trace = (difficulty: BotDifficulty): string => {
      const table = new Table(makeContext(20260823, difficulty, difficulty));
      const out: string[] = [];
      for (let i = 0; i < 60 * 25; i += 1) {
        table.step();
        const state = table.game.state;
        out.push(`${String(state.p1Hand.slot)}${String(state.p2Hand.slot)}${String(state.p1)}`);
      }
      return out.join('');
    };
    expect(trace('easy')).not.toBe(trace('hard'));
  });

  it('plays a different match than an empty seat does', () => {
    const trace = (difficulty: BotDifficulty | null): string => {
      const table = new Table(makeContext(20260823, difficulty, difficulty));
      const out: string[] = [];
      for (let i = 0; i < 60 * 25; i += 1) {
        table.step();
        out.push(`${String(table.game.state.p1Hand.slot)}${String(table.game.state.p1)}`);
      }
      return out.join('');
    };
    expect(trace('normal')).not.toBe(trace(null));
  });

  it('is stronger on hard than on easy, over many matches', () => {
    // The ordering the global bot-parity guard deliberately does not check, because it is
    // a per-game measurement over hundreds of seeded matches. The numbers are in SPEC.md.
    let hardWins = 0;
    let decided = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const table = new Table(makeContext(1000 + seed * 13, 'hard', 'easy'));
      for (let i = 0; i < 60 * 600 && table.game.getScore().winner === null; i += 1) table.step();
      const winner = table.game.getScore().winner;
      table.game.destroy();
      if (winner === null || winner === 'draw') continue;
      decided += 1;
      if (winner === 'p1') hardWins += 1;
    }
    expect(decided).toBeGreaterThan(30);
    expect(hardWins / decided).toBeGreaterThan(0.7);
  });
});

describe('both instruments play the same game', () => {
  it('lets a keyboard and a thumb win at comparable rates', () => {
    // The claim rule 10 is actually about, measured with a *player* rather than the
    // flailing script the global guard uses: the same intent, spelled two ways.
    const rate = (instrument: 'keyboard' | 'pointer'): number => {
      let wins = 0;
      let decided = 0;
      for (let seed = 1; seed <= 20; seed += 1) {
        const winner = playSkilled(seed * 41, instrument);
        if (winner === null || winner === 'draw') continue;
        decided += 1;
        if (winner === 'p1') wins += 1;
      }
      expect(decided, `${instrument} finished matches`).toBeGreaterThan(12);
      return wins / decided;
    };
    const byKey = rate('keyboard');
    const byThumb = rate('pointer');
    expect(byKey, 'a keyboard player can win').toBeGreaterThan(0.3);
    expect(byThumb, 'and so can a thumb').toBeGreaterThan(0.3);
    expect(Math.abs(byKey - byThumb), 'neither instrument is the better one').toBeLessThan(0.3);
  });
});

describe('rendering', () => {
  it('clears before it draws anything', () => {
    const table = new Table(makeContext(41));
    expect(frame(table.game).ops[0]).toBe('clear');
  });

  it('draws both seats in their own colours', () => {
    const table = new Table(makeContext(43));
    const renderer = frame(table.game);
    expect(renderer.args).toContain(SEAT_PALETTE.p1.base);
    expect(renderer.args).toContain(SEAT_PALETTE.p2.base);
  });

  it('gives each seat a shape as well as a colour', () => {
    // Rule 7. p1 is a disc and p2 is a block, so whose hand is whose survives greyscale.
    const table = new Table(makeContext(45));
    const renderer = frame(table.game);
    let cursor = 0;
    let p1Discs = 0;
    let p2Blocks = 0;
    for (const op of renderer.ops) {
      if (op === 'circle' && renderer.args[cursor + 3] === SEAT_PALETTE.p1.base) p1Discs += 1;
      if (op === 'rect' && renderer.args[cursor + 4] === SEAT_PALETTE.p2.base) p2Blocks += 1;
      cursor += ARG_COUNTS[op] ?? 0;
    }
    expect(p1Discs).toBeGreaterThan(0);
    expect(p2Blocks).toBeGreaterThan(0);
  });

  it('names each seat and tells it what is happening, in words', () => {
    const table = new Table(makeContext(47));
    const dark = labels(frame(table.game));
    expect(dark).toContain('P1 · DISC');
    expect(dark).toContain('P2 · BLOCK');
    expect(dark).toContain('LIGHTS OUT');

    table.toOpen();
    expect(labels(frame(table.game))).toContain('GRAB IT');
  });

  it('says ALARM to a seat whose hand has been caught', () => {
    const table = new Table(makeContext(49));
    table.toOpen();
    const wrong = table.game.state.diamond === 0 ? 1 : 0;
    table.touch(1, slotCentreX(wrong), seatY('p1'));
    table.step();
    table.settle('p1');
    table.step();
    expect(table.game.state.p1Hand.lock).toBeGreaterThan(0);
    expect(labels(frame(table.game))).toContain('ALARM');
  });

  it('says what happened once a round settles', () => {
    const table = new Table(makeContext(51));
    table.toOpen();
    table.touch(1, slotCentreX(table.game.state.diamond), seatY('p1'));
    table.step();
    table.settle('p1');
    table.step();
    expect(table.game.state.phase).toBe('settling');
    const shown = labels(frame(table.game));
    expect(shown).toContain('STOLE IT');
    expect(shown).toContain('TOO SLOW');
  });

  it('shows the gem only while the case is open', () => {
    const table = new Table(makeContext(53));
    const gems = (): number =>
      placed(frame(table.game)).filter((entry) => entry.op === 'circle' && entry.radius === 22)
        .length;
    expect(table.game.state.phase).toBe('casing');
    expect(gems(), 'nothing to see in the dark').toBe(0);
    table.toOpen();
    expect(gems(), 'one gem per seat, on the same pedestal').toBe(2);
  });

  it('keeps the far seat labels in the far seat half once the rotation is applied', () => {
    // `pushSeatRotation` turns the whole logical box about its centre, not about one half,
    // so a label drawn at the far seat's own coordinates would land in the near seat's.
    const table = new Table(makeContext(55));
    const shown = placed(frame(table.game)).filter((entry) => entry.op === 'text');
    expect(shown.length).toBeGreaterThanOrEqual(4);
    for (const entry of shown) {
      expect(entry.y).toBeGreaterThanOrEqual(0);
      expect(entry.y).toBeLessThanOrEqual(manifest.logical.height);
    }
    expect(shown.filter((entry) => entry.y < HALF_HEIGHT).length).toBeGreaterThan(0);
    expect(shown.filter((entry) => entry.y >= HALF_HEIGHT).length).toBeGreaterThan(0);
  });

  it('draws nothing rotated in single-seat play', () => {
    const table = new Table(makeContext(57, null, null, 'single-seat'));
    const renderer = frame(table.game);
    let cursor = 0;
    for (const op of renderer.ops) {
      if (op === 'pushSeatRotation') expect(renderer.args[cursor]).toBe(false);
      cursor += ARG_COUNTS[op] ?? 0;
    }
  });

  it('keeps every label clear of the hands and the gems', () => {
    const table = new Table(makeContext(59));
    table.toOpen();
    const entries = placed(frame(table.game));
    const texts = entries.filter((entry) => entry.op === 'text');
    const discs = entries.filter((entry) => entry.op === 'circle');
    expect(texts.length).toBeGreaterThanOrEqual(4);
    expect(discs.length).toBeGreaterThan(0);
    for (const label of texts) {
      for (const disc of discs) {
        const gap = Math.abs(label.y - disc.y) - disc.radius;
        expect(gap, `a label at ${String(Math.round(label.y))} overlaps a disc`).toBeGreaterThan(0);
      }
    }
  });

  it('draws nothing outside the logical play area', () => {
    const table = new Table(makeContext(61, 'normal', 'normal'));
    table.step(900);
    const renderer = frame(table.game);
    for (const value of renderer.args) {
      if (typeof value !== 'number') continue;
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(-20);
      expect(value).toBeLessThanOrEqual(manifest.logical.height + 20);
    }
  });

  it('does not mutate the simulation', () => {
    const table = new Table(makeContext(63, 'normal', 'normal'));
    table.step(600);
    const state = table.game.state;
    const before = `${state.phase}${String(state.p1)}${String(state.p2)}${String(state.p1Hand.slot)}`;
    frame(table.game);
    frame(table.game);
    const after = `${state.phase}${String(state.p1)}${String(state.p2)}${String(state.p1Hand.slot)}`;
    expect(after).toBe(before);
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('light-fingers');
    expect(manifest.archetype).toBe('rt-split');
    expect(manifest.zoneSplit).toBe('horizontal');
    expect(manifest.modes).toEqual(['friend', 'bot']);
    expect(manifest.roundSeconds).toBeGreaterThan(0);
  });

  it('promises the keys the code actually reads', () => {
    // Control strings that lie are a known recurring defect here, so the string is
    // checked against the engine's own bindings rather than against a memory of them.
    const { keyboard } = manifest.controls;
    expect(KEYS.p1.left).toBe('KeyA');
    expect(KEYS.p1.right).toBe('KeyD');
    expect(KEYS.p1.action).toBe('Space');
    expect(KEYS.p2.action).toBe('Enter');
    expect(keyboard).toContain('A and D');
    expect(keyboard).toContain('Space');
    expect(keyboard).toContain('arrow keys');
    expect(keyboard).toContain('Enter');
    expect(keyboard, 'each seat is named its own half').toMatch(/player one/i);
    expect(keyboard).toMatch(/player two/i);
  });

  it('promises a pointer idiom the code actually has', () => {
    expect(manifest.controls.pointer).toMatch(/pedestal/i);
    const table = new Table(makeContext(65));
    table.touch(1, slotCentreX(3), seatY('p1'));
    table.step();
    expect(table.game.state.p1Hand.want, 'touching a pedestal aims at it').toBe(3);
    expect(table.game.state.p1Hand.armed, 'and grabs when it arrives').toBe(true);
  });

  it('is fair across input families', () => {
    expect(manifest.sameInputClassOnly).toBe(false);
    expect(OPEN_SECONDS).toBeGreaterThan(0);
  });
});
