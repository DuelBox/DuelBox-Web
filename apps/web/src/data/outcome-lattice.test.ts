import { beforeAll, describe, expect, it } from 'vitest';
import { LOADERS_FOR_TEST } from './registry';
import { measureGame, type Reading, type Verdict } from './outcome-lattice';

/**
 * The ratchet under `outcome-lattice.ts`: criterion 1 of the fairness audits — *are the measured
 * outcome distributions comparable across input families?* — as a number per game rather than as
 * an argument per game.
 *
 * Four things are held here, and the last two are the ones with teeth.
 *
 * **Every game has a reading.** A game added without one fails, so "we never measured it" cannot
 * quietly become the default the way it was for the eighty audits this answers.
 *
 * **Every measured number is pinned, provenance included.** The two quanta, the two lattice
 * sizes, how many values they share, which gesture answered, which drawn quantity it was read
 * off and how much of the rest of the frame agreed. The channel name is what makes a disputed
 * number checkable — `circle#1.01@2` is the x and y of the second circle of the frame drawn two
 * frames after the commit, and anybody can go and look at it.
 *
 * **The games that pass are asserted as a whole set**, so criterion 1 cannot be discharged for a
 * game by accident. {@link PASSES} is the list this evidence actually covers.
 *
 * **The games that fail are asserted as a whole set too.** {@link FAILS} is the more important
 * of the two: a fifteenth cannot appear quietly and a fixed one cannot be left behind on the
 * list. That is deliberately *not* the same as asserting that every game passes — they do not,
 * the gaps are real, and a guard that asserted the comfortable thing would have to be weakened
 * to keep it, which is how a guard stops being one.
 *
 * **What `uncalibratable` does not mean.** It is not a pass and not a failure; it is silence.
 * Most of the catalogue is silent because this harness asks one question — a held key against a
 * dragged finger, on one axis, watched through what the game draws — and most of the catalogue
 * does not answer to it: a board game's key steps one cell per *press* however long it is held,
 * and a drag that sets angle and power together cannot be swept on one axis at all. Those games
 * still need criterion 1 settled some other way, and reading this table as having settled them
 * is the one wrong use of it. Each carries the reason it went unmeasured so that the audit that
 * picks it up knows what it is up against.
 *
 * **To re-record** after a deliberate change: run `outcome-lattice.ts` over the registry, take
 * the reported numbers, and put them here with the reason in the commit message. Build the
 * packages first — `dist` is gitignored and a stale artefact has produced a false reading here
 * more than once. Do not widen {@link TOLERANCE}: the harness is deterministic and the tolerance
 * exists for the last bits of a transcendental function, not for a number that moved.
 */

/** Room for the last bits of `Math.hypot` and friends, and for nothing else. */
const TOLERANCE = 1e-9;

interface Recorded {
  readonly verdict: Verdict;
  /** Outcome units one envelope of pointer travel, or one frame of a planted finger, moves. */
  readonly pointer?: number;
  /** Outcome units one frame of a held key moves the same quantity. */
  readonly keyboard?: number;
  /** Of the two hundred and one values the pointer can name, how many a key can name too. */
  readonly shared?: number;
  /** How many values a key can name across the same span. */
  readonly keys?: number;
  readonly pairing?: string;
  readonly reason: string;
}

/**
 * Every game in the registry, measured on 2026-08-30 against `origin/main` at `8e80fa5`.
 *
 * The three games the method was checked against by hand before any of this ran — Air Hockey at
 * 3.00 against 15.000, Brick Blast at 3.20 against 10.333, and their shared counts of 41 and 2
 * out of 201 — are reproduced here exactly, which is the reason to believe the other hundred and
 * five.
 */
const RECORDED: Readonly<Record<string, Recorded>> = {
  'air-hockey': { verdict: 'nested', pointer: 3.0, keyboard: 15.0, shared: 41, keys: 41, pairing: 'travel+x/key+x', reason: 'circle#1.01@2, 6/6 channels agree' },
  'animal-stack': { verdict: 'sparse', pointer: 3.0, keyboard: 4.166666666666657, shared: 9, keys: 145, pairing: 'travel+x/key-x', reason: 'rect#12.01@2, 22/28 channels agree' },
  archery: { verdict: 'sparse', pointer: 2.4217741935484014, keyboard: 3.4375, shared: 1, keys: 141, pairing: 'travel+x/key+x', reason: 'strokeCircle#11.01@2, 10/19 channels agree' },
  'archery-master': { verdict: 'uncalibratable', reason: 'the frame disagrees with itself about the ratio: 2/7 channels agree' },
  backgammon: { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'ballgames-physics': { verdict: 'parity', pointer: 6.249999999999972, keyboard: 6.25, shared: 201, keys: 201, pairing: 'dwell+x/key+x', reason: 'circle#5.01@2, 6/6 channels agree' },
  basketball: { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  'beach-ball': { verdict: 'parity', pointer: 5.333333333333279, keyboard: 5.333333333333314, shared: 201, keys: 201, pairing: 'dwell+x/key+x', reason: 'circle#1.01@2, 6/6 channels agree' },
  blocks: { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it, and the keyboard moved nothing the renderer shows' },
  bowling: { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  'brainrot-stack': { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it, and the keyboard moved nothing the renderer shows' },
  'brick-blast': { verdict: 'sparse', pointer: 3.1999999999999886, keyboard: 10.333333333333314, shared: 2, keys: 62, pairing: 'travel+x/key+x', reason: 'rect#42.01@2, 6/6 channels agree' },
  'broken-tiles': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'cannon-duel': { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  carrom: { verdict: 'sparse', pointer: 0.477330392316394, keyboard: 3.0, shared: 1, keys: 32, pairing: 'travel+x/key+x', reason: 'circle#17.01@2, 3/3 channels agree' },
  checkers: { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  chess: { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'chicken-jump': { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  'color-wars': { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it, and the keyboard moved nothing the renderer shows' },
  cornhole: { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'crabby-volley': { verdict: 'parity', pointer: 6.666666666666657, keyboard: 6.666666666666657, shared: 201, keys: 201, pairing: 'travel-x/key-x', reason: 'circle#0.01@2, 8/8 channels agree' },
  'crash-it': { verdict: 'uncalibratable', reason: 'the keyboard moves the outcome continuously: no one step size describes it' },
  cricket: { verdict: 'sparse', pointer: 3.5, keyboard: 5.5, shared: 19, keys: 128, pairing: 'travel+x/key+x', reason: 'rect#4.01@2, 4/4 channels agree' },
  'cup-pong': { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  darts: { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it' },
  'disco-battle': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'dots-and-boxes': { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it, and the keyboard moved nothing the renderer shows' },
  'dung-battle': { verdict: 'parity', pointer: 5.0, keyboard: 5.0, shared: 201, keys: 201, pairing: 'dwell-y/key+x', reason: 'circle#61.01@2, 32/32 channels agree' },
  'explosive-festival': { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  'fatal-siege': { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  'flappy-jump': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'four-in-a-row': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'frogs-fight': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'frozen-beaks': { verdict: 'parity', pointer: 2.0, keyboard: 2.0, shared: 201, keys: 201, pairing: 'dwell+y/key+x', reason: 'circle#5.01@2, 16/16 channels agree' },
  'fruit-duel': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'golf-football': { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it, and the keyboard moved nothing the renderer shows' },
  'gravity-run': { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  'guard-and-thief': { verdict: 'uncalibratable', reason: 'the pointer moved nothing the renderer shows' },
  'guess-the-person': { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it, and the keyboard moved nothing the renderer shows' },
  'hammer-hit': { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  'hand-slap': { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  'happy-birds': { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it, and the keyboard moved nothing the renderer shows' },
  'happy-hippos': { verdict: 'sparse', pointer: 28.030303030303003, keyboard: 5.666666666666657, shared: 2, keys: 990, pairing: 'dwell+x/key-x', reason: 'line#2.23@20, 1/1 channels agree' },
  'hot-potato': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'king-of-the-yard': { verdict: 'parity', pointer: 5.333333333333314, keyboard: 5.333333333333314, shared: 201, keys: 201, pairing: 'dwell+x/key+x', reason: 'circle#0.01@2, 4/4 channels agree' },
  'knife-thrower': { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  'light-fingers': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  ludo: { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'lumber-jack': { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  mancala: { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it, and the keyboard moved nothing the renderer shows' },
  match: { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'math-quiz': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'maze-paint': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  memory: { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'mini-golf': { verdict: 'uncalibratable', reason: 'the pointer\'s step depends on where the finger sits across the sweep' },
  'mini-soccer': { verdict: 'parity', pointer: 6.999999999999981, keyboard: 7.0, shared: 201, keys: 201, pairing: 'dwell+y/key+x', reason: 'circle#0.01@2, 4/4 channels agree' },
  'money-grabber': { verdict: 'partial', pointer: 3.0, keyboard: 5.0, shared: 41, keys: 121, pairing: 'travel+y/key+x', reason: 'circle#1.01@2, 10/10 channels agree' },
  'nuts-and-bolts': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'paint-fight': { verdict: 'uncalibratable', reason: 'the pointer moved nothing the renderer shows' },
  'penalty-kicks': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  pinball: { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'ping-pong': { verdict: 'sparse', pointer: 3.1999999999999886, keyboard: 9.333333333333314, shared: 6, keys: 69, pairing: 'travel+x/key+x', reason: 'rect#18.01@2, 6/6 channels agree' },
  'piranha-rush': { verdict: 'parity', pointer: 2.5, keyboard: 2.5, shared: 201, keys: 201, pairing: 'dwell+x/key+x', reason: 'circle#6.01@2, 8/8 channels agree' },
  'pizza-memory': { verdict: 'partial', pointer: 3.0, keyboard: 8.0, shared: 26, keys: 76, pairing: 'travel+x/key+x', reason: 'circle#9.01@2, 6/6 channels agree' },
  pool: { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  'pop-it': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'pull-the-rope': { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  'racing-cars': { verdict: 'sparse', pointer: 2.999993445154047, keyboard: 7.666666666666657, shared: 1, keys: 79, pairing: 'travel+x/key-x', reason: 'rect#53.01@2, 16/16 channels agree' },
  'rat-race': { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  reversi: { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it, and the keyboard moved nothing the renderer shows' },
  'road-dodge': { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  'robot-arena': { verdict: 'uncalibratable', reason: 'the pointer moved nothing the renderer shows' },
  'rock-paper-scissors': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'sea-battle': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'ship-battle': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  shuriken: { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it' },
  'shut-the-box': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'sliding-puzzle': { verdict: 'uncalibratable', reason: 'the pointer\'s step depends on where the finger sits across the sweep, and the keyboard moved nothing the renderer shows' },
  'sling-puck': { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it, and the keyboard moved nothing the renderer shows' },
  'slot-cars': { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  snakes: { verdict: 'uncalibratable', reason: 'the pointer moved nothing the renderer shows, and the keyboard moves the outcome continuously: no one step size describes it' },
  'snakes-ladders': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'soccer-pool': { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  solitaire: { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  'spike-attacks': { verdict: 'parity', pointer: 3.166666666666657, keyboard: 3.166666666666657, shared: 201, keys: 201, pairing: 'travel-x/key-x', reason: 'line#17.01@2, 23/23 channels agree' },
  'spin-war': { verdict: 'uncalibratable', reason: 'the pointer\'s step depends on where the finger sits across the sweep, and the keyboard moved nothing the renderer shows' },
  stampede: { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it, and the keyboard moved nothing the renderer shows' },
  'star-catcher': { verdict: 'sparse', pointer: 3.1999999999999886, keyboard: 3.9166666666666288, shared: 1, keys: 164, pairing: 'travel+x/key+y', reason: 'strokeCircle#0.01@2, 4/4 channels agree' },
  'sticky-tongues': { verdict: 'sparse', pointer: 3.8268343236508873, keyboard: 5.0, shared: 1, keys: 154, pairing: 'travel-x/key+x', reason: 'circle#22.01@2, 7/7 channels agree' },
  sudoku: { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  sumo: { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it, and the keyboard moved nothing the renderer shows' },
  'sword-throwing': { verdict: 'uncalibratable', reason: 'the pointer\'s step depends on where the finger sits across the sweep' },
  tanks: { verdict: 'uncalibratable', reason: 'the pointer moved nothing the renderer shows' },
  'tap-match': { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it, and the keyboard moved nothing the renderer shows' },
  'target-practice': { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  'taxi-race': { verdict: 'sparse', pointer: 2.999999999751765, keyboard: 10.666666666666657, shared: 7, keys: 57, pairing: 'travel+x/key-x', reason: 'rect#76.01@2, 8/8 channels agree' },
  tennis: { verdict: 'parity', pointer: 5.333333333333303, keyboard: 5.333333333333314, shared: 201, keys: 201, pairing: 'dwell+x/key+x', reason: 'circle#2.01@2, 4/4 channels agree' },
  'the-last-sashimi': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  throw: { verdict: 'parity', pointer: 4.0, keyboard: 4.0, shared: 201, keys: 201, pairing: 'travel+x/key+x', reason: 'rect#19.01@2, 30/30 channels agree' },
  'tic-tac-toe': { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it, and the keyboard moved nothing the renderer shows' },
  'traffic-jam': { verdict: 'uncalibratable', reason: 'the pointer moved nothing the renderer shows, and the keyboard moves the outcome continuously: no one step size describes it' },
  'ultimate-ttt': { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it, and the keyboard moved nothing the renderer shows' },
  'unfair-fishing': { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it, and the keyboard moved nothing the renderer shows' },
  'water-game': { verdict: 'uncalibratable', reason: 'the pointer moves the outcome continuously: no one step size describes it, and the keyboard moved nothing the renderer shows' },
  'whack-a-mole': { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
  wheelie: { verdict: 'sparse', pointer: 2.3612422360248644, keyboard: 13.86, shared: 1, keys: 35, pairing: 'travel+y/key-y', reason: 'rect#7.2@2, 2/2 channels agree' },
  wrestle: { verdict: 'uncalibratable', reason: 'the keyboard moved nothing the renderer shows' },
  yazy: { verdict: 'uncalibratable', reason: 'neither instrument moved anything the renderer shows' },
};

/**
 * The games whose two instruments name comparable sets of outcomes.
 *
 * `parity` is set equality: every value either instrument can name, the other can name too.
 * `nested` is the near miss that costs nobody anything — Air Hockey's key step is exactly five
 * pointer envelopes, so every position a key can reach is also under a finger, and no shot
 * exists that only one player can play. Both discharge criterion 1; nothing else here does.
 */
const PASSES: readonly string[] = [
  'air-hockey',
  'ballgames-physics',
  'beach-ball',
  'crabby-volley',
  'dung-battle',
  'frozen-beaks',
  'king-of-the-yard',
  'mini-soccer',
  'piranha-rush',
  'spike-attacks',
  'tennis',
  'throw',
];

/**
 * The games whose instruments cannot name the same outcomes, worst overlap first.
 *
 * Nine of the fourteen are one shape: a paddle or a runner whose keyboard rate was chosen
 * without reference to the position envelope, so that the two paths land on lattices with almost
 * nothing in common. That is the defect #2506 built `scalarEnvelopeFor` to close for aimed
 * scalars and which nothing yet closes for positions. Brick Blast is the one to read first
 * because its arithmetic is plain: a paddle steered at `PADDLE_SPEED = 620` units a second moves
 * 10.333 units a step against a 640/200 = 3.2 unit envelope, and 3.2 and 10.333 share exactly
 * two values in the whole width of the table — the two ends of a run neither player can meet in
 * the middle of.
 *
 * **Four of them rest on thin evidence and should be checked by hand before anybody acts on
 * them**, and their recorded `reason` says which: `happy-hippos` measured one drawn quantity
 * (`1/1`), `wheelie` two, `carrom` three, and `archery` is the only game here whose frame is
 * split about the answer (`10/19`, barely over the half this harness insists on). Carrom in
 * particular commits an angle and a power in one gesture, which is the shape this harness says
 * elsewhere it cannot separate, so its 6.285 is the least safe number in the file.
 *
 * The fix for the other ten is to put both paths through one lattice. Slowing the key down
 * instead makes the keyboard worse rather than making the two commensurable, and **none of it
 * belongs here**: this file measures and records.
 */
const FAILS: readonly string[] = [
  'star-catcher',
  'sticky-tongues',
  'archery',
  'happy-hippos',
  'racing-cars',
  'wheelie',
  'carrom',
  'brick-blast',
  'animal-stack',
  'ping-pong',
  'taxi-race',
  'cricket',
  'money-grabber',
  'pizza-memory',
];

const IDS = Object.keys(LOADERS_FOR_TEST).sort();

/**
 * Measured once per game per run, because sweeping one game is several hundred simulated
 * matches and every test in this file wants the same answer.
 *
 * Warmed in a `beforeAll` rather than left to whichever test asks first. The two set assertions
 * each walk the whole registry, so on a cold cache one of them carries the cost of the entire
 * catalogue inside one test — thirty seconds on a quiet machine, which is Vitest's own default
 * timeout, so it passed here and would have failed on a loaded runner. The hook is where a cost
 * that belongs to the whole file can be given a budget that says so.
 */
const readings = new Map<string, Promise<Reading>>();

function read(id: string): Promise<Reading> {
  const cached = readings.get(id);
  if (cached !== undefined) return cached;
  const loader = LOADERS_FOR_TEST[id];
  if (loader === undefined) throw new Error(`no loader for ${id}`);
  const reading = loader().then((loaded) => measureGame(() => loaded.create(), loaded.manifest));
  readings.set(id, reading);
  return reading;
}

function close(actual: number | null, expected: number | undefined): boolean {
  if (actual === null || expected === undefined) return false;
  if (expected === 0) return actual === 0;
  return Math.abs(actual - expected) / Math.abs(expected) <= TOLERANCE;
}

describe('outcome lattices across input families', () => {
  beforeAll(async () => {
    for (const id of IDS) {
      await read(id);
      // Hand the event loop back between games. Sweeping one game is a solid block of
      // arithmetic, and a worker that strings a hundred and eight of them together without
      // yielding cannot answer the runner — whose transport gives up after sixty seconds,
      // surfacing as an unhandled error and an exit code of 1 with every test green. See the
      // `dangerouslyIgnoreUnhandledErrors` note in `vitest.config.ts`, which is the same trap.
      await new Promise((resolve) => setImmediate(resolve));
    }
  }, 600_000);

  it('has a reading recorded for every playable game', () => {
    expect(IDS.filter((id) => RECORDED[id] === undefined)).toEqual([]);
    expect(Object.keys(RECORDED).filter((id) => !IDS.includes(id))).toEqual([]);
  });

  it.each(IDS)('%s reads as it was recorded', async (id) => {
    const recorded = RECORDED[id];
    if (recorded === undefined) throw new Error(`${id} has no recorded reading`);
    const reading = await read(id);

    expect(reading.verdict).toBe(recorded.verdict);
    expect(reading.reason).toBe(recorded.reason);
    if (recorded.verdict === 'uncalibratable') {
      expect(reading.pointerQuantum).toBeNull();
      expect(reading.keyboardQuantum).toBeNull();
      return;
    }
    expect(reading.pairing).toBe(recorded.pairing);
    expect(reading.shared).toBe(recorded.shared);
    expect(reading.keyboardValues).toBe(recorded.keys);
    expect(reading.pointerValues).toBe(201);
    expect(close(reading.pointerQuantum, recorded.pointer)).toBe(true);
    expect(close(reading.keyboardQuantum, recorded.keyboard)).toBe(true);
  });

  it('names every game that discharges criterion 1', async () => {
    const passing: string[] = [];
    for (const id of IDS) {
      const reading = await read(id);
      if (reading.verdict === 'parity' || reading.verdict === 'nested') passing.push(id);
    }
    expect(passing).toEqual([...PASSES].sort());
  });

  it('names every game whose instruments cannot name the same outcomes', async () => {
    const failing: string[] = [];
    for (const id of IDS) {
      const reading = await read(id);
      if (reading.verdict === 'sparse' || reading.verdict === 'partial') failing.push(id);
    }
    expect(failing).toEqual([...FAILS].sort());
  });
});
