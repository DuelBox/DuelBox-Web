import { describe, expect, it } from 'vitest';
import {
  Canvas2DRenderer,
  InputManager,
  InputView,
  LockstepSession,
  NO_INSETS,
  Rng,
  fitViewport,
  loopbackPair,
  mixNumber,
  type Canvas2DLike,
  type LoopbackOptions,
  type MatchConfig,
  type MatchTransport,
  type SeatId,
} from '@duelbox/engine';
import type { Game, GameManifest } from '@duelbox/game-sdk';
import { LOADERS_FOR_TEST } from './registry';

/**
 * The property the whole cross-device feature rests on: two devices step the identical match.
 *
 * `cross-viewport.test.ts` proves the neighbouring half — that one device's simulation does
 * not depend on the screen it is drawn to. This proves the other: that a match whose two
 * seats are held by two machines, exchanging inputs over a link with latency and out-of-order
 * delivery, produces the same match on both, step for step and bit for bit. Between them the
 * two files cover the whole of rule 8, which is why this one holds the screen constant: the
 * subject here is the wire, and the screen is already somebody else's proof.
 *
 * Every playable game, because a rule that holds for the seven somebody remembered is not a
 * rule. And compared with `toEqual` on raw values rather than a tolerance: "nearly the same"
 * diverges by the hundredth step, and by the thousandth the two people are watching different
 * games.
 *
 * ## Two claims, deliberately kept apart
 *
 * **The transport changes nothing.** Two devices given the identical match — same seed, same
 * presentation, same everything but which seat's input arrives locally and which comes over a
 * link — must produce identical matches. That one is compared on *everything the game draws*,
 * which is by far the sharper instrument: a game's score changes on a handful of its steps,
 * while where every one of its bodies is changes on all of them, so a score-only comparison
 * agrees happily about two boards that parted company two hundred steps ago.
 *
 * **The simulation does not depend on which seat is watching.** In a real remote match each
 * device is told a different `localSeat`, and that is presentation: it may change what a game
 * *draws* — each player's own side, their own HUD — and it may never change what the rules
 * do. So that one is compared on what the match counted and whose turn it is, and not on the
 * drawing, because the drawing is allowed to differ and does.
 *
 * Collapsing the two would be worse than either. Comparing drawings across devices with
 * different seats reports four games as broken that are working exactly as intended;
 * comparing only scores across a transport misses most of the divergence it exists to catch.
 * So both are asserted in one run per game, with the drawing compared wherever the drawing is
 * allowed to be compared — which is a hundred and two games out of a hundred and seven.
 */

const STEP = 1 / 60;
const STEPS = 200;
const DELAY = 3;

/** Steps at the start of a match during which nobody has touched anything. */
const QUIET_STEPS = 16;

/**
 * Steps for the local comparison, which is cheaper to be sure of.
 *
 * The cross-device runs are looking for a divergence that could appear at any step, so they
 * are worth their length. This one asks whether wrapping a manager in a session changed
 * anything, and a change of that kind shows up on the first step it happens or never.
 *
 * Both counts are chosen with the machine in mind as well as the proof. A hundred and seven
 * games, each played four times over with every draw call folded into a hash, is real work,
 * and `vitest.config.ts` is one long account of what happens to this repository when a test
 * is slow enough to fail on a loaded machine and pass on a quiet one. The heaviest game here
 * takes about a second; the timeout is thirty.
 */
const LOCAL_STEPS = 150;

/**
 * The games whose *simulation* depends on which seat is watching it, and which therefore
 * cannot be played across devices as they stand.
 *
 * One, and it is a bug rather than a category. `sword-throwing` computes
 * `presentation === 'single-seat' && localSeat === 'p2'` in `init` and then reads it from
 * `update` — to rotate the incoming pointer into world space, and to choose the direction a
 * sword travels. On a shared screen that is invisible, because both seats are on one device
 * and the flag is the same for both. In a remote match the two devices disagree about it by
 * construction, so they step different matches: rule 8, broken, in a game that passes every
 * test in its own package.
 *
 * The repair is not in this file and not in this pass — the flip belongs to presentation, and
 * `toWorld` is already the right place for it — but the entry stays until it is made, because
 * a list of one is how the hundred and eighth game avoids joining it. Adding a game here, or
 * taking one out, is a decision somebody made rather than a test somebody skipped.
 */
const SEAT_DEPENDENT: ReadonlySet<string> = new Set(['sword-throwing']);

/**
 * The games that legitimately *draw* differently depending on which player is looking.
 *
 * Not a bug and not a list of suspects: a single-seat device shows its own player their own
 * side, and four games do something with that. What it costs is sharpness — for these four
 * the cross-device comparison falls back to what the match counted, because their drawings
 * are supposed to differ. `playsTheSameDrawing` below buys that sharpness back for exactly
 * these four by running them a second time with both devices told the same seat.
 *
 * A game arriving in this list is a question, not a failure: check that the difference is
 * only in what it draws, and if it reaches `update`, the game belongs in
 * {@link SEAT_DEPENDENT} and needs fixing rather than listing.
 */
const SEAT_AWARE_RENDER: ReadonlySet<string> = new Set([
  'pull-the-rope',
  'whack-a-mole',
  'carrom',
  'disco-battle',
]);

/** Both devices letterbox to one negotiated logical box (rule 9), so this is what they share. */
function configFor(manifest: GameManifest, seed: number, inputDelaySteps = DELAY): MatchConfig {
  return {
    game: manifest.id,
    seed,
    logical: manifest.logical,
    stepsPerSecond: 60,
    inputDelaySteps,
  };
}

/**
 * A canvas context that answers every call and folds what it was asked to draw into a hash.
 *
 * A proxy rather than a hand-written stub, for the reason `cross-viewport.test.ts` gives: a
 * stub enumerated by hand stops seeing the day a game reaches for a method nobody listed,
 * which is a fact about the stub and not about the game.
 *
 * The hash is what makes the comparison worth making. A game's score changes on a handful of
 * its steps; where each of its bodies is, on every step, is the actual state of the match —
 * and it reaches this object as numbers whether or not the game exposes it anywhere else.
 */
class DrawRecorder {
  hash = 0;
  calls = 0;
  readonly context: Canvas2DLike;

  constructor() {
    const fold = (label: string | symbol, values: readonly unknown[]): void => {
      this.calls += 1;
      this.hash = mixNumber(this.hash, labelHash(label));
      for (const value of values) this.hash = foldValue(this.hash, value);
    };
    // One function per method name, made once. Returning a fresh closure from `get` — which
    // is the obvious way to write this — allocates on every call the games make, and there
    // are some millions of them across the catalogue: it took this file from twenty seconds
    // to eighty, and a test that slow fails on a loaded machine and passes on a quiet one,
    // which is the worst behaviour a test can have.
    const methods = new Map<string | symbol, (...args: unknown[]) => unknown>();
    const measure = (): TextMetrics => ({ width: 0 }) as TextMetrics;
    this.context = new Proxy(
      {},
      {
        get: (_target, property) => {
          if (property === 'measureText') return measure;
          let method = methods.get(property);
          if (method === undefined) {
            method = (...args: unknown[]): unknown => {
              fold(property, args);
              return undefined;
            };
            methods.set(property, method);
          }
          return method;
        },
        set: (_target, property, value: unknown) => {
          this.calls += 1;
          this.hash = mixNumber(this.hash, labelHash(property));
          this.hash = foldValue(this.hash, value);
          return true;
        },
      },
    ) as unknown as Canvas2DLike;
  }

  /** The hash of this step's drawing, and a fresh start for the next one. */
  take(): number {
    const taken = this.hash;
    this.hash = 0;
    return taken;
  }
}

/**
 * The hash of a string, remembered.
 *
 * Method names and colours repeat on every draw call of every step, so hashing them character
 * by character each time is most of the work this file does. Shared across recorders because
 * a string hashes to the same number wherever it turns up.
 */
const STRING_HASHES = new Map<string, number>();

function labelHash(label: string | symbol): number {
  if (typeof label !== 'string') return -1;
  return hashString(label);
}

function hashString(text: string): number {
  const known = STRING_HASHES.get(text);
  if (known !== undefined) return known;
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = mixNumber(hash, text.charCodeAt(i));
  STRING_HASHES.set(text, hash);
  return hash;
}

function foldValue(hash: number, value: unknown): number {
  if (typeof value === 'number') return mixNumber(hash, value);
  if (typeof value === 'boolean') return mixNumber(hash, value ? 1 : 0);
  if (typeof value === 'string') return mixNumber(hash, hashString(value));
  return mixNumber(hash, -2);
}

/** What a game did on one step: what it counted, whose turn it is, and what it drew. */
function observe(game: Game, step: number, drawn: number): string {
  const score = game.getScore();
  const seat = game.getActiveSeat?.() ?? null;
  return [step, score.p1, score.p2, score.winner, seat, drawn].map(String).join(' ');
}

/**
 * Fold what the match can be observed to have done into this device's checksum.
 *
 * The score, the winner and whose turn it is — and deliberately not the drawing. A host
 * cannot hash its draw calls in production and must not try: rendering happens outside the
 * fixed step and in device pixels, so two devices would disagree about it while agreeing
 * perfectly about the match. Only what the rules produced belongs in here.
 */
function mixObserved(game: Game, session: LockstepSession): void {
  const score = game.getScore();
  const winner = score.winner;
  const seat = game.getActiveSeat?.() ?? null;
  session.mix(score.p1);
  session.mix(score.p2);
  session.mix(winner === 'p1' ? 1 : winner === 'p2' ? 2 : winner === 'draw' ? 3 : 0);
  session.mix(seat === 'p1' ? 1 : seat === 'p2' ? 2 : 0);
}

/** The input surface a gesture script needs. Both a manager and a session have exactly it. */
interface InputSurface {
  keyDown(code: string): void;
  keyUp(code: string): void;
  pointerDown(id: number, x: number, y: number): void;
  pointerMove(id: number, x: number, y: number): void;
  pointerUp(id: number): void;
}

/**
 * One seat's gestures for the step they will land on.
 *
 * A pure function of the seat and the *applied* step, which is what makes every comparison
 * below mean something: the same step always produces the same gesture, whichever device is
 * asking, however long its frame spent on the wire, and whatever delay the match was
 * configured with.
 *
 * In logical units, never pixels — a device-space script would have to be converted per
 * device, and the conversion rather than the simulation would be what was compared.
 */
function gesture(
  seat: SeatId,
  step: number,
  logical: GameManifest['logical'],
  into: InputSurface,
): void {
  // Silent until every delay under test has warmed up. The first `inputDelaySteps` steps of a
  // match carry no input by construction — there has not been time for anybody to have made
  // any — so a script that spoke during them would be a different script at each delay, and
  // the delay comparison below would be measuring the fixture rather than the engine.
  if (step < QUIET_STEPS) return;
  const rng = new Rng(step * 131 + (seat === 'p1' ? 17 : 4093));
  const id = seat === 'p1' ? 1 : 2;
  const move = seat === 'p1' ? 'KeyW' : 'ArrowUp';
  const across = seat === 'p1' ? 'KeyD' : 'ArrowRight';
  const action = seat === 'p1' ? 'Space' : 'Enter';
  const phase = step % 13;
  if (phase === 0) into.pointerDown(id, rng.float() * logical.width, rng.float() * logical.height);
  if (phase === 2) into.pointerMove(id, rng.float() * logical.width, rng.float() * logical.height);
  if (phase === 4) into.pointerUp(id);
  if (phase === 5) into.keyDown(move);
  if (phase === 7) into.keyUp(move);
  if (phase === 8) into.keyDown(across);
  if (phase === 9) into.keyUp(across);
  if (phase === 10) into.keyDown(action);
  if (phase === 12) into.keyUp(action);
}

/** One device in a cross-device match: its own game, its own world, its own half of the input. */
class Device {
  readonly session: LockstepSession;
  readonly trace: string[] = [];
  readonly recorder = new DrawRecorder();
  readonly #game: Game;
  readonly #view = new InputView();
  readonly #renderer: Canvas2DRenderer | null;
  readonly #logical: GameManifest['logical'];
  readonly #seat: SeatId;
  readonly #delay: number;
  #fedTo = -1;

  constructor(
    manifest: GameManifest,
    create: () => Game,
    seat: SeatId,
    transport: MatchTransport | null,
    config: MatchConfig,
    options: { contextSeat: SeatId; draw: boolean },
  ) {
    this.#seat = seat;
    this.#logical = manifest.logical;
    this.#delay = config.inputDelaySteps;
    if (options.draw) {
      this.#renderer = new Canvas2DRenderer(this.recorder.context, manifest.logical);
      this.#renderer.setViewport(fitViewport(manifest.logical, 1024, 768, NO_INSETS));
    } else {
      this.#renderer = null;
    }
    const manager = new InputManager(manifest.logical);
    this.session = new LockstepSession(manager, { localSeat: seat, config, transport });
    this.#game = create();
    this.#game.init({
      manifest,
      rng: new Rng(config.seed),
      // `contextSeat` is which seat the *game* is told it is being watched by, which is a
      // separate question from which seat's input arrives locally. Held equal where the
      // subject is the transport, and given each device its own where the subject is whether
      // a simulation reads it.
      presentation: 'single-seat',
      localSeat: options.contextSeat,
      openingSeat: 'p1',
      botDifficulty: () => null,
    });
  }

  get step(): number {
    return this.session.step;
  }

  /** One attempt at a step. Feeds this seat's gestures for the step they will land on. */
  tick(): void {
    const appliedAt = this.session.step + this.#delay;
    if (appliedAt > this.#fedTo) {
      gesture(this.#seat, appliedAt, this.#logical, this.session);
      this.#fedTo = appliedAt;
    }
    const step = this.session.step;
    const input = this.session.beginStep(STEP);
    // Null is the match waiting for the other player: nothing is simulated and nothing is
    // guessed. A host would redraw the world it already has; this does not, so both devices
    // draw exactly once per step and a game whose `render` moved its own state could not
    // masquerade here as a network bug.
    if (input === null) return;
    this.#game.update(STEP, this.#view.sync(input));
    const renderer = this.#renderer;
    if (renderer !== null) {
      renderer.beginFrame();
      this.#game.render(renderer, 0);
      renderer.endFrame();
    }
    this.trace.push(observe(this.#game, step, this.recorder.take()));
    mixObserved(this.#game, this.session);
  }

  destroy(): void {
    this.#game.destroy();
  }
}

interface PlayOptions {
  seed?: number;
  inputDelaySteps?: number;
  first?: LoopbackOptions;
  second?: LoopbackOptions;
  steps?: number;
  /** Tell each device it is being watched by its own seat, as a real remote match does. */
  ownSeats?: boolean;
  /** Draw, and fold the drawing into the trace. Off where the drawing is allowed to differ. */
  draw?: boolean;
}

/** Play one match across a link, and hand back what each device saw. */
function playAcross(
  manifest: GameManifest,
  create: () => Game,
  options: PlayOptions = {},
): { first: Device; second: Device } {
  const steps = options.steps ?? STEPS;
  const config = configFor(manifest, options.seed ?? 20260830, options.inputDelaySteps ?? DELAY);
  const [linkA, linkB] = loopbackPair(options.first, options.second);
  const draw = options.draw ?? true;
  const first = new Device(manifest, create, 'p1', linkA, config, {
    contextSeat: 'p1',
    draw,
  });
  const second = new Device(manifest, create, 'p2', linkB, config, {
    contextSeat: options.ownSeats === true ? 'p2' : 'p1',
    draw,
  });
  for (let tick = 0; tick < steps * 8 + 500; tick += 1) {
    if (first.step >= steps && second.step >= steps) break;
    if (first.step < steps) first.tick();
    if (second.step < steps) second.tick();
  }
  first.destroy();
  second.destroy();
  return { first, second };
}

/**
 * The same game on one device, with and without a session that has nothing to connect to.
 *
 * Driven from one script through a bare `InputManager` and through a transport-less
 * `LockstepSession`, so what is compared is whether wrapping the manager changed anything. It
 * must not: with no transport the session forwards every call and hands back the manager's
 * own state object, which is what "the site degrades to local play" has to mean at this
 * layer — not a second code path that behaves similarly, but the same one.
 */
function playLocally(manifest: GameManifest, create: () => Game, wrapped: boolean): string[] {
  const seed = 20260830;
  const logical = manifest.logical;
  const recorder = new DrawRecorder();
  const renderer = new Canvas2DRenderer(recorder.context, logical);
  renderer.setViewport(fitViewport(logical, 1024, 768, NO_INSETS));
  const manager = new InputManager(logical, {
    split: manifest.zoneSplit === 'vertical' ? 'vertical' : 'horizontal',
    bottomSeat: 'p1',
  });
  const session = wrapped
    ? new LockstepSession(manager, { localSeat: 'p1', config: configFor(manifest, seed) })
    : null;
  const surface: InputSurface = session ?? manager;
  const view = new InputView();
  const game = create();
  game.init({
    manifest,
    rng: new Rng(seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty: () => null,
  });

  const trace: string[] = [];
  for (let step = 0; step < LOCAL_STEPS; step += 1) {
    gesture('p1', step, logical, surface);
    gesture('p2', step, logical, surface);
    const input = session === null ? manager.beginStep(STEP) : session.beginStep(STEP);
    expect(input, 'a session with no transport never waits').not.toBeNull();
    if (input === null) break;
    game.update(STEP, view.sync(input));
    renderer.beginFrame();
    game.render(renderer, 0);
    renderer.endFrame();
    trace.push(observe(game, step, recorder.take()));
  }
  game.destroy();
  return trace;
}

/** The observable part of a trace line, with the step number taken off the front. */
function withoutStep(line: string): string {
  return line.slice(line.indexOf(' ') + 1);
}

/** A trace line with the drawing hash taken off the end: what a score-only test would see. */
function withoutDrawing(line: string): string {
  return line.slice(0, line.lastIndexOf(' '));
}

describe('a cross-device match steps the identical match on both devices', () => {
  for (const [slug, load] of Object.entries(LOADERS_FOR_TEST)) {
    it(`${slug} plays the same match on both devices`, async () => {
      const loaded = await load();
      // As real as this gets without a network: each device holds one seat, is told it is the
      // one being watched, and receives the other player over a link with latency in one
      // direction and frames arriving backwards in the other.
      const { first, second } = playAcross(loaded.manifest, () => loaded.create(), {
        ownSeats: true,
        first: { lagDrains: 2 },
        second: { lagDrains: 1, reorder: true },
      });

      // What is compared: everything, drawing included, except for the four games whose
      // drawing is meant to differ per player — for those, what the match counted.
      const compare = SEAT_AWARE_RENDER.has(slug) ? withoutDrawing : (line: string) => line;
      const here = first.trace.map(compare);
      const there = second.trace.map(compare);

      if (SEAT_DEPENDENT.has(slug)) {
        // Known broken, and pinned rather than skipped: this game's rules read which seat is
        // watching. When it is repaired this assertion fails and says what to do about it.
        expect(there, `${slug} has been fixed — take it out of SEAT_DEPENDENT`).not.toEqual(here);
        return;
      }

      expect(first.session.status, `${slug} did not stay connected`).toBe('running');
      expect(second.session.status).toBe('running');
      expect(first.step, `${slug} did not reach the end of the match`).toBe(STEPS);
      expect(second.step).toBe(STEPS);
      expect(there, `${slug} played two different matches on the two devices`).toEqual(here);
      // The runtime form of the same statement: each device's rolling checksum of what it
      // observed, exchanged on the frames it was sending anyway.
      expect(first.session.checksum, `${slug} checksums disagree`).toBe(second.session.checksum);
      // And the comparison was not made over an empty room.
      expect(first.recorder.calls, `${slug} drew nothing`).toBeGreaterThan(0);
      // Only where the drawing is part of the comparison. For the four games it is not, the
      // remaining trace can genuinely hold still — a tug of war in which neither side has yet
      // won is not a test that stopped working — and their non-vacuity is asserted in the
      // describe below, where the drawing is back in.
      if (!SEAT_AWARE_RENDER.has(slug)) {
        expect(new Set(here.map(withoutStep)).size, `${slug} never moved`).toBeGreaterThan(1);
      }
    });
  }
});

describe('the games that draw for one player still simulate for both', () => {
  /**
   * The sharpness {@link SEAT_AWARE_RENDER} costs, bought back.
   *
   * These four are compared above on what the match counted, because their drawings are
   * allowed to differ between the two devices. Here they are played again with both devices
   * told the same seat, which takes that licence away and lets the drawing be compared after
   * all: whatever they do with the seat they are shown, the match underneath it is one match.
   */
  for (const slug of SEAT_AWARE_RENDER) {
    it(`${slug} draws the same match when both devices are shown the same seat`, async () => {
      const load = LOADERS_FOR_TEST[slug];
      expect(load, `${slug} is not a playable game`).toBeDefined();
      if (load === undefined) return;
      const loaded = await load();
      const { first, second } = playAcross(loaded.manifest, () => loaded.create(), {
        first: { lagDrains: 2 },
        second: { lagDrains: 1, reorder: true },
      });
      expect(second.trace, `${slug} played two different matches`).toEqual(first.trace);
      expect(new Set(first.trace.map(withoutStep)).size).toBeGreaterThan(1);
    });
  }
});

describe('with no transport, every game plays exactly as it does today', () => {
  for (const [slug, load] of Object.entries(LOADERS_FOR_TEST)) {
    it(`${slug} is untouched by a session with nothing to connect to`, async () => {
      const loaded = await load();
      const today = playLocally(loaded.manifest, () => loaded.create(), false);
      const wrapped = playLocally(loaded.manifest, () => loaded.create(), true);
      expect(wrapped, `${slug} changed when it was wrapped in a session`).toEqual(today);
      expect(today).toHaveLength(LOCAL_STEPS);
      expect(new Set(today.map(withoutStep)).size, `${slug} never moved`).toBeGreaterThan(1);
    });
  }
});

describe('the harness these proofs rest on', () => {
  it('can tell two different matches apart', async () => {
    // Every comparison above is worth exactly as much as this one. A harness that reported
    // agreement between two genuinely different matches would report it between any two.
    const loaded = await LOADERS_FOR_TEST['air-hockey']!();
    const a = playAcross(loaded.manifest, () => loaded.create(), { seed: 7, steps: 150 });
    const b = playAcross(loaded.manifest, () => loaded.create(), { seed: 9999, steps: 150 });
    expect(b.first.trace).not.toEqual(a.first.trace);
  });

  it('sees a divergence in what a game draws, not only in what it counts', async () => {
    // Most steps of most games change no score, so a score-only trace agrees about two boards
    // that have already drifted apart. Here are two demonstrably different matches whose
    // scores are identical throughout — the drawing is the only thing that tells them apart,
    // and without it every comparison above would be far weaker than it looks.
    const loaded = await LOADERS_FOR_TEST['air-hockey']!();
    const a = playAcross(loaded.manifest, () => loaded.create(), { seed: 7, steps: 150 });
    const b = playAcross(loaded.manifest, () => loaded.create(), { seed: 9999, steps: 150 });
    expect(b.first.trace.map(withoutDrawing)).toEqual(a.first.trace.map(withoutDrawing));
    expect(b.first.trace).not.toEqual(a.first.trace);
  });

  it('covers every playable game, so a new one cannot skip this quietly', () => {
    expect(Object.keys(LOADERS_FOR_TEST).length).toBeGreaterThanOrEqual(7);
  });
});

describe('the input delay is felt and never seen', () => {
  /**
   * The fairness rule from the other side.
   *
   * An input belongs to the step it was made for, so changing the delay changes *when* an
   * action reaches the simulation on both devices alike and changes nothing about what
   * happens. A match at three steps of delay and the same match at nine are the same match —
   * which is only true because outcomes resolve on the step a frame is stamped with rather
   * than on the moment it arrived.
   */
  const SAMPLE = ['air-hockey', 'tic-tac-toe', 'whack-a-mole', 'road-dodge', 'sumo'];

  for (const slug of SAMPLE) {
    it(`${slug} plays the same match at every delay`, async () => {
      const load = LOADERS_FOR_TEST[slug];
      expect(load, `${slug} is not a playable game`).toBeDefined();
      if (load === undefined) return;
      const loaded = await load();
      const traces = [2, 3, 9].map(
        (inputDelaySteps) =>
          playAcross(loaded.manifest, () => loaded.create(), { inputDelaySteps, steps: 150 }).first
            .trace,
      );
      for (const trace of traces.slice(1)) expect(trace).toEqual(traces[0]);
      expect(traces[0]).toHaveLength(150);
    });
  }
});

describe('when the other player disappears mid-match', () => {
  it('waits, then ends the match rather than playing on against nobody', async () => {
    // #2452 at this layer. A remote feature that has become unavailable must produce an
    // honest ending the shell can explain, never a frozen board or a phantom opponent.
    const loaded = await LOADERS_FOR_TEST['air-hockey']!();
    const config = configFor(loaded.manifest, 20260830);
    const [linkA, linkB] = loopbackPair();
    const first = new Device(loaded.manifest, () => loaded.create(), 'p1', linkA, config, {
      contextSeat: 'p1',
      draw: true,
    });
    const second = new Device(loaded.manifest, () => loaded.create(), 'p2', linkB, config, {
      contextSeat: 'p2',
      draw: true,
    });
    for (let tick = 0; tick < 120; tick += 1) {
      first.tick();
      second.tick();
    }
    const playedTo = first.step;
    expect(playedTo).toBeGreaterThan(100);

    linkB.pause();
    for (let tick = 0; tick < 400; tick += 1) first.tick();

    expect(first.session.status).toBe('failed');
    // The simulation stopped where the other player did, give or take the frames already in
    // flight. It did not run on, and it did not invent anything for the missing seat.
    expect(first.step).toBeLessThanOrEqual(playedTo + config.inputDelaySteps);
    expect(first.trace).toHaveLength(first.step);
    first.destroy();
    second.destroy();
  });
});
