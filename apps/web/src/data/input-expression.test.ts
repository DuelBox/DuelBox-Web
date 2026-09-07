import { beforeAll, describe, expect, it } from 'vitest';
import { assess, GAP_THRESHOLD, type GameReport, type Verdict } from './input-expression';
import { LOADERS_FOR_TEST } from './registry';

/**
 * Criterion 1 of the seventy-eight fairness audits: "measured outcome distributions are
 * comparable across input families".
 *
 * `control-parity.test.ts` answers the coarse half — both instruments can move every game,
 * and neither wins at a wildly different rate — inside a band its own comment calls
 * deliberately wide, because it is hunting for a game one peripheral cannot play. This
 * answers the sharp half, which no win rate can reach: **can one instrument express things
 * the other cannot?** `input-expression.ts` carries the method and why it is that method.
 *
 * The table below is the deliverable, printed on every run. The assertions around it are a
 * ratchet: the verdicts are recorded, and a change to any game's input handling that moves a
 * game between classes fails here rather than being noticed a year later. That is the same
 * shape `bot-parity.test.ts` and `balance-aggregate.test.ts` use, and for the same reason —
 * these numbers are measured from 107 whole games and a bare `toEqual` on a factor would be
 * red every time somebody retuned a constant.
 *
 * ## What each class means
 *
 * - **A** — the two families are equivalent within the envelope, and the calibration says so.
 * - **B** — a measurable gap: one instrument selects values the other cannot reach.
 * - **C** — the game has no aimed scalar, so the question does not arise. Three ways that
 *   happens, and the harness distinguishes them: the outcome is a handful of discrete targets
 *   both instruments reach; what the pointer drives is integrated rather than selected; or
 *   the game is a timing game, where the commit is a step number and the fixed timestep hands
 *   both instruments the same one.
 * - **D** — not measured, and the note says why. Every D here is a limitation of the generic
 *   gesture, not a finding about the game.
 */

const SEED = 7;

/**
 * Games where one input family can express what the other cannot.
 *
 * Membership is the assertion. A game arriving here is a fairness regression and a game
 * leaving it is a fix, and either way somebody should have to say so in a diff.
 */
const MEASURED_GAP: readonly string[] = ['cricket', 'darts', 'dots-and-boxes', 'shuriken'];

/**
 * Games the generic sweep could not measure, so that the number cannot quietly grow.
 *
 * Fifty-three of a hundred and seven, and that is the honest state of this harness rather
 * than a state of the catalogue: a one-axis press-pull-lift gesture is not the gesture Chess
 * (select, then move), Pool (aim *and* power in one drag) or Whack-a-Mole (hit the thing that
 * happens to be up) is asking for. A ratchet, so closing them is progress somebody can see.
 */
const UNMEASURED: readonly string[] = [
  'air-hockey',
  'animal-stack',
  'archery-master',
  'backgammon',
  'ballgames-physics',
  'bowling',
  'brainrot-stack',
  'brick-blast',
  'broken-tiles',
  'carrom',
  'checkers',
  'chess',
  'cornhole',
  'crabby-volley',
  'disco-battle',
  'dung-battle',
  'fatal-siege',
  'flappy-jump',
  'frogs-fight',
  'fruit-duel',
  'gravity-run',
  'guard-and-thief',
  'hand-slap',
  'happy-birds',
  'happy-hippos',
  'hot-potato',
  'lumber-jack',
  'mancala',
  'maze-paint',
  'mini-golf',
  'mini-soccer',
  'money-grabber',
  'penalty-kicks',
  'pinball',
  'ping-pong',
  'pizza-memory',
  'pool',
  'reversi',
  'robot-arena',
  'sea-battle',
  'shut-the-box',
  'sliding-puzzle',
  'slot-cars',
  'snakes-ladders',
  'soccer-pool',
  'spike-attacks',
  'stampede',
  'star-catcher',
  'sudoku',
  'sword-throwing',
  'tanks',
  'throw',
  'whack-a-mole',
  'wheelie',
];

describe('what each input family can express', () => {
  const reports: GameReport[] = [];

  beforeAll(async () => {
    for (const [slug, load] of Object.entries(LOADERS_FOR_TEST)) {
      reports.push(assess(await load(), slug, SEED));
    }
    reports.sort((a, b) => a.slug.localeCompare(b.slug));
    const cell = (report: GameReport): string =>
      [
        report.slug.padEnd(20),
        report.archetype.padEnd(11),
        report.verdict,
        report.factor.toFixed(2).padStart(6),
        report.direction.padEnd(8),
        `${report.reach.pointer}/${report.reach.keyboard}`.padEnd(7),
        report.note,
      ].join(' ');
    const tally: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    for (const report of reports) tally[report.verdict] = (tally[report.verdict] ?? 0) + 1;
    // eslint-disable-next-line no-console
    console.log(
      ['', 'game                 archetype   V factor direction reach   why', ...reports.map(cell), '', JSON.stringify(tally)].join(
        '\n',
      ),
    );
  }, 600_000);

  it('reaches a verdict for every playable game', () => {
    expect(reports).toHaveLength(Object.keys(LOADERS_FOR_TEST).length);
    const verdicts: readonly Verdict[] = ['A', 'B', 'C', 'D'];
    for (const report of reports) {
      expect(verdicts, `${report.slug} has no verdict`).toContain(report.verdict);
    }
  });

  it('names exactly the games where one instrument can express what the other cannot', () => {
    const found = reports.filter((r) => r.verdict === 'B').map((r) => r.slug);
    expect(found.sort()).toEqual([...MEASURED_GAP].sort());
  });

  it('does not let the unmeasured list grow', () => {
    const found = reports
      .filter((r) => r.verdict === 'D')
      .map((r) => r.slug)
      .sort();
    // A ratchet rather than an equality: a game leaving this list is a harness improvement
    // and must not be a failure, while a game arriving on it is a measurement that stopped
    // working and must be.
    const arrived = found.filter((slug) => !UNMEASURED.includes(slug));
    expect(arrived, `newly unmeasurable: ${arrived.join(', ')}`).toEqual([]);
  });

  it('measures the gap Shuriken is already known to have', () => {
    const shuriken = reports.find((r) => r.slug === 'shuriken');
    expect(shuriken?.verdict).toBe('B');
    expect(shuriken?.direction).toBe('pointer');
    // Its own two constants put the pointer at 2.06x on spin (one envelope is 3.5 units, so
    // 3.5 x SPIN_PER_UNIT = 0.021 against SPIN_KEY_RATE / 60 = 0.0433) and 2.15x on aim
    // (3.5 units at 392 away is 0.0089 radians against AIM_KEY_RATE / 60 = 0.0192). The
    // harness reads neither constant and lands between them.
    expect(shuriken?.factor).toBeGreaterThan(1.8);
    expect(shuriken?.factor).toBeLessThan(3.2);
  });

  it('measures the same numbers twice', async () => {
    // Rule 4, and the whole standing of the table above: seeded RNG, a fixed timestep and a
    // scripted gesture, so two runs are identical rather than merely similar.
    const loaded = await LOADERS_FOR_TEST['darts']!();
    const first = assess(loaded, 'darts', SEED);
    const second = assess(loaded, 'darts', SEED);
    expect(second).toEqual(first);
  }, 120_000);

  it('agrees with itself about what a gap is', () => {
    for (const report of reports) {
      if (report.verdict === 'B') {
        expect(report.factor, `${report.slug} is B without a gap`).toBeGreaterThanOrEqual(
          GAP_THRESHOLD,
        );
        expect(report.direction, `${report.slug} is B with no direction`).not.toBe('none');
      }
      if (report.verdict === 'A') {
        expect(report.factor, `${report.slug} is A with a gap`).toBeLessThan(GAP_THRESHOLD);
      }
    }
  });
});
