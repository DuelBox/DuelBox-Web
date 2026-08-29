import { describe, expect, it } from 'vitest';
import { InputView, Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign } from '@duelbox/engine';
import type { Game, GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { DiscoBattleGame } from './game.js';
import { manifest } from './manifest.js';
import gameModule from './index.js';
import { GOOD_SECONDS, MATCH_SECONDS, NOTE_COUNT, PERFECT_SECONDS } from './rules.js';

const STEP = 1 / 60;
const WIDTH = manifest.logical.width;
const HEIGHT = manifest.logical.height;

/* ------------------------------------------------------------------ the fakes */

interface Mark {
  readonly kind: string;
  readonly colour: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly numbers: readonly number[];
}

/**
 * Records what a frame drew, in logical units.
 *
 * A bounding box per mark rather than a raw argument list, because two of the three things
 * asserted below — that nothing leaves the logical box, and that the board is its own
 * half-turn image — are statements about where a mark *is*, and reconstructing that from
 * positional arguments at every call site is how a test starts disagreeing with the game.
 */
class RecordingRenderer implements Renderer {
  readonly marks: Mark[] = [];
  #depth = 0;
  maxDepth = 0;
  balanced = true;

  clear(colour: string): void {
    this.#push('clear', colour, 0, WIDTH, 0, HEIGHT, [WIDTH, HEIGHT]);
  }

  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#push('rect', colour, x, x + width, y, y + height, [x, y, width, height]);
  }

  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    const half = lineWidth / 2;
    this.#push('strokeRect', colour, x - half, x + width + half, y - half, y + height + half, [
      x,
      y,
      width,
      height,
      lineWidth,
    ]);
  }

  circle(x: number, y: number, radius: number, colour: string): void {
    this.#push('circle', colour, x - radius, x + radius, y - radius, y + radius, [x, y, radius]);
  }

  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    const r = radius + lineWidth / 2;
    this.#push('strokeCircle', colour, x - r, x + r, y - r, y + r, [x, y, radius, lineWidth]);
  }

  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    const half = lineWidth / 2;
    this.#push(
      'line',
      colour,
      Math.min(x1, x2) - half,
      Math.max(x1, x2) + half,
      Math.min(y1, y2) - half,
      Math.max(y1, y2) + half,
      [x1, y1, x2, y2, lineWidth],
    );
  }

  text(
    value: string,
    x: number,
    y: number,
    sizePx: number,
    colour: string,
    align?: TextAlign,
  ): void {
    void align;
    const half = sizePx / 2;
    this.#push(
      `text:${value}`,
      colour,
      x - value.length * half,
      x + value.length * half,
      y - half,
      y + half,
      [x, y, sizePx],
    );
  }

  pushSeatRotation(rotated: boolean): void {
    void rotated;
    this.#depth += 1;
    this.maxDepth = Math.max(this.maxDepth, this.#depth);
  }

  pushRotation(radians: number): void {
    expect(Number.isFinite(radians)).toBe(true);
    this.#depth += 1;
    this.maxDepth = Math.max(this.maxDepth, this.#depth);
  }

  popSeatRotation(): void {
    this.#depth -= 1;
    if (this.#depth < 0) this.balanced = false;
  }

  get closed(): boolean {
    return this.balanced && this.#depth === 0;
  }

  #push(
    kind: string,
    colour: string,
    left: number,
    right: number,
    top: number,
    bottom: number,
    numbers: readonly number[],
  ): void {
    this.marks.push({ kind, colour, left, right, top, bottom, numbers });
  }
}

class FakeSeat implements SeatInput {
  readonly move = vec2();
  pointerAt: { x: number; y: number } | null = null;
  actionPressed = false;
  actionHeld = false;
  actionReleased = false;
  holdSeconds = 0;
  holdSecondsAtRelease = 0;
  pointerCancelled = false;

  get pointer(): { readonly x: number; readonly y: number } | null {
    return this.pointerAt;
  }
}

class FakeInput implements InputState {
  readonly p1 = new FakeSeat();
  readonly p2 = new FakeSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.p1 : this.p2;
  }

  press(seat: SeatId, down: boolean): void {
    const view = seat === 'p1' ? this.p1 : this.p2;
    view.actionPressed = down;
    view.actionHeld = down;
  }

  clear(): void {
    this.p1.actionPressed = false;
    this.p2.actionPressed = false;
  }
}

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

/** Play a match through, calling back on every step. */
function play(
  game: DiscoBattleGame,
  input: InputState,
  steps: number,
  onStep?: (step: number) => void,
): void {
  for (let i = 0; i < steps; i += 1) {
    onStep?.(i);
    game.update(STEP, input);
    if (game.getScore().winner !== null) return;
  }
}

/** The one note the whole track can be indexed from, without a possibly-undefined dance. */
function arrivalOf(game: DiscoBattleGame, note: number): number {
  const arrival = game.state.arrivals[note];
  if (arrival === undefined) throw new Error(`no note ${String(note)}`);
  return arrival;
}

const P1_COLOURS = new Set(Object.values(SEAT_PALETTE.p1));
const P2_COLOURS = new Set(Object.values(SEAT_PALETTE.p2));
const ROUND = new Set(['circle', 'strokeCircle']);
const SQUARE = new Set(['rect', 'strokeRect']);

/* ==================================================================== contract */

describe('the Game contract', () => {
  it('never claims to have turns, because a real-time game has none', () => {
    // `turn-seat.test.ts` reads the value on a freshly created instance that was never
    // initialised. The safest answer to "whose turn is it" in an `rt-*` game is not to
    // implement the question, and the manifest's archetype is what says so.
    const game: Game = new DiscoBattleGame();
    expect(manifest.archetype.startsWith('rt-')).toBe(true);
    // The guard reads `game.getActiveSeat?.() ?? null` on an instance that was never
    // initialised and requires null. Not implementing the method at all is the strongest
    // way to answer that, and `Reflect.has` walks the prototype chain, so an accidental
    // reintroduction on the class would fail here rather than in the shared suite.
    expect(game.getActiveSeat?.() ?? null).toBeNull();
    expect(Reflect.has(game, 'getActiveSeat')).toBe(false);
    expect(Reflect.has(gameModule.create(), 'getActiveSeat')).toBe(false);
  });

  it('exports a module the registry can load', () => {
    expect(gameModule.manifest.id).toBe('disco-battle');
    expect(gameModule.create()).toBeInstanceOf(DiscoBattleGame);
  });

  it('advertises a round length that is the track it actually plays', () => {
    // `roundSeconds` ends nothing — it is text on a catalogue card. The two are equal only
    // because something keeps them equal, and this is that something.
    expect(manifest.roundSeconds).toBe(MATCH_SECONDS);
  });

  it('claims no input-class restriction, and has none to claim', () => {
    // A press is one binary event with a timestamp. There is no continuous quantity anywhere
    // in this game for a thumb to be finer at than a key, so `sameInputClassOnly` is false
    // without the caveat cup-pong and target-practice both had to write. The test above —
    // "is one binary press a seat, and nothing else" — is what makes that claim true rather
    // than merely stated.
    expect(manifest.sameInputClassOnly).toBe(false);
    expect(manifest.controls.keyboard.length).toBeGreaterThan(3);
    expect(typeof manifest.controls.pointer).toBe('string');
    // No mention of an arrow key, which is what `controls.test.ts` reads for; both halves of
    // the keyboard are named, and each is named as belonging to one player.
    expect(manifest.controls.keyboard).not.toMatch(/arrow/i);
    expect(manifest.controls.keyboard).toMatch(/player one/i);
    expect(manifest.controls.keyboard).toMatch(/player two/i);
    expect(manifest.modes).toContain('bot');
    expect(manifest.modes).toContain('friend');
  });

  it('reports a finite score from the first frame to the last', () => {
    const game = new DiscoBattleGame();
    game.init(context({ botDifficulty: () => 'normal' }));
    const input = new FakeInput();
    let ended = false;
    for (let i = 0; i < 60 * 600; i += 1) {
      game.update(STEP, input);
      const score = game.getScore();
      expect(Number.isFinite(score.p1)).toBe(true);
      expect(Number.isFinite(score.p2)).toBe(true);
      if (score.winner !== null) {
        ended = true;
        break;
      }
    }
    expect(ended).toBe(true);
    expect(game.getScore().winner).not.toBeNull();
  });

  it('releases everything on destroy and starts clean on the next init', () => {
    const game = new DiscoBattleGame();
    game.init(context({ botDifficulty: () => 'hard' }));
    play(game, new FakeInput(), 600);
    expect(game.state.clock).toBeGreaterThan(0);

    game.destroy();
    expect(game.state.clock).toBe(0);
    expect(game.state.winner).toBeNull();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    // Destroyed means inert: further steps must not restart the simulation.
    play(game, new FakeInput(), 30);
    expect(game.state.clock).toBe(0);

    game.init(context());
    expect(game.state.clock).toBe(0);
    expect(game.state.p1.score).toBe(0);
    expect(game.state.p1Judged.every((j) => j === 'none')).toBe(true);
  });

  it('does nothing at all before it has been initialised', () => {
    const game = new DiscoBattleGame();
    play(game, new FakeInput(), 100);
    expect(game.state.clock).toBe(0);
  });
});

/* ======================================================================= input */

describe('the input this game reads', () => {
  it('is one binary press a seat, and nothing else', () => {
    // The fairness argument in SPEC.md is that a thumb, a trackpad and a key cannot express
    // a difference in a bare press. That is only true while the game reads nothing else, so
    // this drives a match with the pointer and the move vector doing everything they can and
    // asserts the simulation could not tell.
    const quiet = new DiscoBattleGame();
    quiet.init(context());
    const noisy = new DiscoBattleGame();
    noisy.init(context());

    const quietInput = new FakeInput();
    const noisyInput = new FakeInput();
    const rng = new Rng(4242);
    for (let i = 0; i < 1200; i += 1) {
      const press = i % 17 === 0;
      quietInput.press('p1', press);
      quietInput.press('p2', i % 23 === 0);
      noisyInput.press('p1', press);
      noisyInput.press('p2', i % 23 === 0);
      noisyInput.p1.move.x = rng.float() * 2 - 1;
      noisyInput.p1.move.y = rng.float() * 2 - 1;
      noisyInput.p1.pointerAt = { x: rng.float() * WIDTH, y: rng.float() * HEIGHT };
      noisyInput.p2.pointerAt = { x: rng.float() * WIDTH, y: rng.float() * HEIGHT };
      noisyInput.p1.actionHeld = true;
      noisyInput.p1.holdSeconds = rng.float() * 3;
      quiet.update(STEP, quietInput);
      noisy.update(STEP, noisyInput);
    }
    expect(noisy.getScore()).toEqual(quiet.getScore());
  });

  it('scores a press aimed at a note and charges one that is not', () => {
    const game = new DiscoBattleGame();
    game.init(context());
    const input = new FakeInput();
    const onBeat = Math.round(arrivalOf(game, 0) / STEP);
    play(game, input, onBeat + 40, (i) => {
      input.clear();
      input.press('p1', i === onBeat);
      input.press('p2', i === 5);
    });
    expect(game.state.p1.perfect).toBe(1);
    expect(game.state.p2.wild).toBe(1);
    expect(game.getScore().p1).toBeGreaterThan(game.getScore().p2);
  });

  it('survives an illegal storm of pointers, holds and unmatched releases', () => {
    const game = new DiscoBattleGame();
    game.init(context({ botDifficulty: (seat) => (seat === 'p2' ? 'easy' : null) }));
    const input = new FakeInput();
    const rng = new Rng(99);
    const renderer = new RecordingRenderer();
    expect(() => {
      for (let i = 0; i < 4000; i += 1) {
        input.p1.actionPressed = rng.bool(0.3);
        input.p1.actionReleased = rng.bool(0.3);
        input.p1.actionHeld = rng.bool(0.5);
        input.p1.pointerAt = rng.bool(0.5)
          ? { x: (rng.float() * 1.4 - 0.2) * WIDTH, y: (rng.float() * 1.4 - 0.2) * HEIGHT }
          : null;
        game.update(STEP, input);
        if (rng.bool(0.2)) game.render(renderer, rng.float());
        if (rng.bool(0.02)) game.onPause();
        if (rng.bool(0.02)) game.onResume();
      }
    }).not.toThrow();
    expect(Number.isFinite(game.getScore().p1)).toBe(true);
  });
});

/* ======================================================== presentation is inert */

describe('presentation', () => {
  it('cannot reach the simulation, from either seat or either presentation', () => {
    // `presentation-parity.test.ts` compares four arms of this and there is no room left in
    // its known-divergences list. Nothing here branches on the device, so all four arms are
    // one match — asserted rather than assumed, because the parity harness demonstrates it
    // can catch a game that reads `presentation` or `localSeat` in `update`.
    const traces = new Set<string>();
    for (const presentation of ['shared-screen', 'single-seat'] as const) {
      for (const localSeat of ['p1', 'p2'] as const) {
        const game = new DiscoBattleGame();
        game.init(context({ presentation, localSeat, botDifficulty: () => 'normal' }));
        const trace: string[] = [];
        play(game, new FakeInput(), 900, () => {
          const score = game.getScore();
          trace.push(`${score.p1}:${score.p2}:${String(score.winner)}`);
        });
        traces.add(trace.join('|'));
      }
    }
    expect(traces.size).toBe(1);
  });

  it('makes the two halves of a seed pair exact complements, from the opening seat', () => {
    // A real-time game has no opener and the contract lets it ignore the field. This one
    // uses it for the one thing in the game that is not already symmetric: the order the two
    // bot streams are drawn in. Handing them out by role rather than by seat makes the
    // second round of a pair the exact mirror of the first — which is why seat one's share
    // is 50.0% at every sample size rather than 64.0% at fifty seeds, which is what
    // `balance-aggregate.test.ts`'s own methodology read before this.
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      for (let trial = 0; trial < 12; trial += 1) {
        const seed = 1000003 + trial * 7919;
        const results = ['p1', 'p2'].map((openingSeat) => {
          const game = new DiscoBattleGame();
          game.init(
            context({
              rng: new Rng(seed),
              openingSeat: openingSeat as SeatId,
              botDifficulty: () => tier,
            }),
          );
          play(game, new FakeInput(), 2500);
          return game.getScore();
        });
        const [first, second] = results as [
          ReturnType<DiscoBattleGame['getScore']>,
          ReturnType<DiscoBattleGame['getScore']>,
        ];
        expect(first.p1).toBe(second.p2);
        expect(first.p2).toBe(second.p1);
        if (first.winner === 'draw') expect(second.winner).toBe('draw');
        else expect(second.winner).toBe(first.winner === 'p1' ? 'p2' : 'p1');
      }
    }
  });

  it('plays the same track whichever seat the shell says opens', () => {
    // The track is drawn before the two seat streams, so the opener changes who plays which
    // hand and never what either of them is playing.
    const tracks = new Set<string>();
    for (const openingSeat of ['p1', 'p2'] as const) {
      const game = new DiscoBattleGame();
      game.init(context({ rng: new Rng(555), openingSeat }));
      tracks.add(game.state.arrivals.join(','));
    }
    expect(tracks.size).toBe(1);
  });

  it('turns the board only in single-seat play, and only for the far seat', () => {
    // Rule 9 is untouched by this: the two lanes are the same length and the same distance
    // from the middle, so turning the board changes which end is under a thumb and nothing
    // about how much of the track either player can see.
    for (const [presentation, localSeat] of [
      ['shared-screen', 'p1'],
      ['shared-screen', 'p2'],
      ['single-seat', 'p1'],
      ['single-seat', 'p2'],
    ] as const) {
      const game = new DiscoBattleGame();
      game.init(context({ presentation, localSeat }));
      play(game, new FakeInput(), 200);
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      expect(renderer.closed, `${presentation}/${localSeat} left a rotation open`).toBe(true);
      expect(renderer.maxDepth).toBe(1);
    }
  });
});

/* ===================================================================== drawing */

function frameOf(game: DiscoBattleGame, alpha = 0): RecordingRenderer {
  const renderer = new RecordingRenderer();
  game.render(renderer, alpha);
  return renderer;
}

describe('what a frame draws', () => {
  it('draws something from the very first frame, before anybody has touched the device', () => {
    const game = new DiscoBattleGame();
    game.init(context());
    const marks = frameOf(game).marks;
    expect(marks.length).toBeGreaterThan(10);
    expect(marks.some((m) => P1_COLOURS.has(m.colour))).toBe(true);
    expect(marks.some((m) => P2_COLOURS.has(m.colour))).toBe(true);
  });

  it('keeps every drawn point inside the logical box, for a whole match', () => {
    // `cross-viewport.test.ts` records every number that reaches the renderer. Its own bound
    // is generous — twice the longer side — so this asserts the real one instead: nothing
    // this game draws leaves the 600 x 1000 box it declared.
    const game = new DiscoBattleGame();
    game.init(context({ botDifficulty: () => 'easy' }));
    const input = new FakeInput();
    let worstLeft = Infinity;
    let worstRight = -Infinity;
    let worstTop = Infinity;
    let worstBottom = -Infinity;
    for (let i = 0; i < 2500 && game.getScore().winner === null; i += 1) {
      input.press('p1', i % 7 === 0);
      game.update(STEP, input);
      if (i % 3 !== 0) continue;
      for (const mark of frameOf(game, (i % 3) / 3).marks) {
        worstLeft = Math.min(worstLeft, mark.left);
        worstRight = Math.max(worstRight, mark.right);
        worstTop = Math.min(worstTop, mark.top);
        worstBottom = Math.max(worstBottom, mark.bottom);
        for (const value of mark.numbers) expect(Number.isFinite(value)).toBe(true);
      }
    }
    expect(worstLeft).toBeGreaterThanOrEqual(0);
    expect(worstTop).toBeGreaterThanOrEqual(0);
    expect(worstRight).toBeLessThanOrEqual(WIDTH);
    expect(worstBottom).toBeLessThanOrEqual(HEIGHT);
  });

  it('draws the two timing windows at the size the windows actually are', () => {
    // The game's answer to having no audio (#168-#170): the tolerance is a shape on the
    // board rather than a number in a spec. If the referee's window ever changes, the band
    // has to change with it, and this is what makes that true rather than hoped for.
    const game = new DiscoBattleGame();
    game.init(context());
    const heights = frameOf(game)
      .marks.filter((m) => m.kind === 'rect' && m.right - m.left > 400)
      .map((m) => m.bottom - m.top);
    const speed = 180;
    const near = (wanted: number) => heights.some((h) => Math.abs(h - wanted) < 1e-9);
    expect(near(GOOD_SECONDS * 2 * speed), `bands drawn at ${heights.join(', ')}`).toBe(true);
    expect(near(PERFECT_SECONDS * 2 * speed), `bands drawn at ${heights.join(', ')}`).toBe(true);
  });

  it('never mutates the simulation, at any alpha, however many times it is called', () => {
    const game = new DiscoBattleGame();
    game.init(context({ botDifficulty: () => 'normal' }));
    play(game, new FakeInput(), 500);
    const before = JSON.stringify([
      game.state.clock,
      game.state.cursor,
      game.state.p1,
      game.state.p2,
      game.state.arrivals,
      game.state.p1Judged,
    ]);
    for (const alpha of [0, 0.25, 0.5, 0.75, 0.999]) game.render(frameOf(game, alpha), alpha);
    for (let i = 0; i < 40; i += 1) frameOf(game, i / 40);
    expect(
      JSON.stringify([
        game.state.clock,
        game.state.cursor,
        game.state.p1,
        game.state.p2,
        game.state.arrivals,
        game.state.p1Judged,
      ]),
    ).toBe(before);
  });

  it('moves a note between two steps rather than strobing it', () => {
    const game = new DiscoBattleGame();
    game.init(context());
    play(game, new FakeInput(), 60);
    const early = frameOf(game, 0)
      .marks.map((m) => m.top)
      .join(',');
    const late = frameOf(game, 0.9)
      .marks.map((m) => m.top)
      .join(',');
    expect(early).not.toBe(late);
  });
});

/* ============================================================ rule 7, asserted */

describe('rule 7: colour is never the only signal', () => {
  it('draws seat one in circles and seat two in squares, with no exception, all match', () => {
    // `greyscale.test.ts` throws away position and rotation before it compares the two
    // seats, so "the lane at the bottom" is not a distinction. The silhouette is. Its
    // evidence also collapses the moment the other seat draws the same primitive **even
    // once**, which is why this sweeps a whole match rather than a frame.
    const game = new DiscoBattleGame();
    game.init(context({ botDifficulty: () => 'easy' }));
    const input = new FakeInput();
    let framesWithBoth = 0;
    let checked = 0;
    for (let i = 0; i < 2500 && game.getScore().winner === null; i += 1) {
      input.press('p1', i % 11 === 0);
      input.press('p2', i % 13 === 0);
      game.update(STEP, input);
      if (i % 4 !== 0) continue;
      checked += 1;
      let p1Marks = 0;
      let p2Marks = 0;
      for (const mark of frameOf(game).marks) {
        if (P1_COLOURS.has(mark.colour)) {
          p1Marks += 1;
          expect(ROUND.has(mark.kind), `seat one drew a ${mark.kind}`).toBe(true);
        }
        if (P2_COLOURS.has(mark.colour)) {
          p2Marks += 1;
          expect(SQUARE.has(mark.kind), `seat two drew a ${mark.kind}`).toBe(true);
        }
      }
      if (p1Marks > 0 && p2Marks > 0) framesWithBoth += 1;
    }
    // Every sampled frame, not merely ten of them: the receptors are unconditional.
    expect(framesWithBoth).toBe(checked);
    expect(checked).toBeGreaterThan(500);
  });

  it('says nothing in words, so the board needs no language and no sound', () => {
    const game = new DiscoBattleGame();
    game.init(context({ botDifficulty: () => 'normal' }));
    const input = new FakeInput();
    for (let i = 0; i < 1500 && game.getScore().winner === null; i += 1) {
      input.press('p1', i % 9 === 0);
      game.update(STEP, input);
      if (i % 5 !== 0) continue;
      for (const mark of frameOf(game).marks) {
        expect(mark.kind.startsWith('text:')).toBe(false);
      }
    }
  });

  it('tells its four judgements apart by shape, not by colour', () => {
    // Three pips for a perfect, one for a good, one hollow ring for a note let go, two
    // concentric rings for a press that answered nothing. Counted here from a seat that is
    // made to produce all four.
    const game = new DiscoBattleGame();
    game.init(context());
    const input = new FakeInput();
    const perfectAt = Math.round(arrivalOf(game, 1) / STEP);
    const goodAt = Math.round((arrivalOf(game, 2) + 0.12) / STEP);
    const wildAt = Math.round((arrivalOf(game, 3) + GOOD_SECONDS + 0.2) / STEP);
    const missedAt = Math.round((arrivalOf(game, 0) + GOOD_SECONDS) / STEP) + 2;

    const signatures = new Map<string, string>();
    const record = (label: string) => {
      const marks = frameOf(game).marks.filter(
        (m) => P1_COLOURS.has(m.colour) && m.top > 880 && m.bottom < 1000,
      );
      signatures.set(
        label,
        marks
          .map((m) => `${m.kind}@${(m.right - m.left).toFixed(1)}`)
          .sort()
          .join('+'),
      );
    };

    for (let i = 0; i <= wildAt + 2; i += 1) {
      input.clear();
      input.press('p1', i === perfectAt || i === goodAt || i === wildAt);
      game.update(STEP, input);
      if (i === perfectAt) record('perfect');
      if (i === goodAt) record('good');
      if (i === wildAt) record('wild');
      if (i === missedAt) record('missed');
    }
    expect(signatures.size).toBe(4);
    expect(new Set(signatures.values()).size, [...signatures].join(' | ')).toBe(4);
  });

  it('draws a board that is exactly its own half-turn image', () => {
    // Rule 9, as a picture: whatever seat one can see, seat two can see the same amount of,
    // at the same moment, the same distance away. With nobody pressing, the two seats are in
    // the identical state all match, so every mark either seat owns must have a partner at
    // the point half a turn away.
    const game = new DiscoBattleGame();
    game.init(context());
    for (let frame = 0; frame < 30; frame += 1) {
      play(game, new FakeInput(), 40);
      const marks = frameOf(game).marks;
      const p1 = marks
        .filter((m) => P1_COLOURS.has(m.colour))
        .map((m) => `${((m.left + m.right) / 2).toFixed(6)},${((m.top + m.bottom) / 2).toFixed(6)}`)
        .sort();
      const p2 = marks
        .filter((m) => P2_COLOURS.has(m.colour))
        .map(
          (m) =>
            `${((m.left + m.right) / 2).toFixed(6)},${(HEIGHT - (m.top + m.bottom) / 2).toFixed(6)}`,
        )
        .sort();
      expect(p1.length).toBeGreaterThan(0);
      expect(p2).toEqual(p1);
    }
  });
});

/* ======================================================================= bots */

describe('the bot seat', () => {
  it('is taken only where the shell says a bot sits', () => {
    const alone = new DiscoBattleGame();
    alone.init(context({ botDifficulty: (seat) => (seat === 'p1' ? 'hard' : null) }));
    play(alone, new FakeInput(), 2500);
    expect(alone.state.p1.perfect + alone.state.p1.good).toBeGreaterThan(20);
    // Seat two was left to a person who never arrived, so it answered nothing at all.
    expect(alone.state.p2.perfect + alone.state.p2.good).toBe(0);
    expect(alone.state.p2.missed).toBe(NOTE_COUNT);
  });

  it('plays differently at every tier, which is what a difficulty is', () => {
    // `bot-parity.test.ts` hashes the numbers on screen and requires `easy` and `hard` to
    // diverge inside twenty-five seconds. Here they diverge on the score.
    const scores = new Map<string, number>();
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const game = new DiscoBattleGame();
      game.init(context({ botDifficulty: () => tier }));
      play(game, new FakeInput(), 2500);
      scores.set(tier, game.state.p1.score);
    }
    expect(scores.get('easy')).toBeLessThan(scores.get('normal') as number);
    expect(scores.get('normal')).toBeLessThan(scores.get('hard') as number);
  });

  it('moves the score without anybody touching the device', () => {
    // `input-fuzz.test.ts` needs the score to move or a match to end, and
    // `control-parity.test.ts` counts changes to `p1:p2`. Here it moves whether or not
    // anybody presses, because a note nobody answered costs both seats a point.
    const game = new DiscoBattleGame();
    game.init(context());
    const seen = new Set<string>();
    play(game, new FakeInput(), 900, () => {
      const score = game.getScore();
      seen.add(`${score.p1}:${score.p2}`);
    });
    expect(seen.size).toBeGreaterThan(10);
  });

  it('is driven through the same one bit a person is', () => {
    // Rule 6 has nowhere to be broken here: there is no channel a bot could be told
    // something on. The check that keeps it that way is that a bot seat and a pressing
    // person produce the same *kind* of record — a mix of all four judgements.
    const game = new DiscoBattleGame();
    game.init(context({ botDifficulty: () => 'normal' }));
    play(game, new FakeInput(), 2500);
    const side = game.state.p1;
    expect(side.perfect).toBeGreaterThan(0);
    expect(side.good).toBeGreaterThan(0);
    expect(side.missed).toBeGreaterThan(0);
    expect(side.wild).toBeGreaterThan(0);
  });
});

/* ================================================================ the harness */

describe('through the engine input view rather than a fake', () => {
  it('reads a real seat view without touching anything it should not', () => {
    const view = new InputView();
    const game = new DiscoBattleGame();
    game.init(context({ botDifficulty: () => 'easy' }));
    expect(() => {
      for (let i = 0; i < 300; i += 1) game.update(STEP, view);
    }).not.toThrow();
    expect(game.state.clock).toBeGreaterThan(0);
  });
});
