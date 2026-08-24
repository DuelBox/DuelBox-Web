import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BLUNDER_SECONDS,
  BOT_PROFILES,
  CARRY_MIN,
  CARRY_REACH,
  CARRY_START,
  CARRY_STEP,
  DRIFT_WEIGHT,
  FALL_SECONDS,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  GRIP_DROP,
  GRIP_NONE,
  GRIP_TURN,
  GUTTER,
  LOOK_JITTER,
  MAX_ANIMALS,
  MIN_CONTACT,
  PLATFORM_HALF,
  PLINTH_HEIGHT,
  READY_SECONDS,
  REST_SECONDS,
  ROUND_SECONDS,
  SEARCH_SPAN,
  SLIDE_SPEED,
  SPECIES,
  START_FAR,
  START_NEAR,
  TAP_SECONDS,
  YARD_HEIGHT,
  acrossOfWorld,
  backCentreOf,
  botIntent,
  breakJointOf,
  breakTie,
  carrySecondsFor,
  clearIntent,
  createBotState,
  createGrip,
  createIntent,
  createMatch,
  decide,
  fallenOf,
  gripStep,
  marginOf,
  otherOf,
  placedAt,
  resetBotState,
  resetGrip,
  resetMatch,
  speciesAt,
  spent,
  startReachFor,
  step,
  stepYard,
  supportHiAt,
  supportLoAt,
  tightestJointOf,
  towerMargin,
  trialMargin,
  weightAboveOf,
  weightCentreOf,
  winnerOf,
  worldXOf,
  worldYOf,
  wouldStand,
  yardOf,
} from './rules.js';
import type { BotDifficulty, Intent, Landing, Match, Stance, Yard } from './rules.js';

const STEP = 1 / 60;
/** Ten simulated minutes: what `apps/web/src/data/termination.test.ts` allows. */
const GUARD_STEPS = 60 * 600;
const SEATS: readonly SeatId[] = ['p1', 'p2'];

const IDLE: Intent = createIntent();
const scratch: Intent = createIntent();

/**
 * One yard s stance, read back through a function.
 *
 * A test that has just written a stance has narrowed the type to that one literal, so
 * comparing it against another is a build error rather than a question — see the note about
 * `tsc --noEmit -p tsconfig.lint.json` in game.test.ts. Reading it through here asks the
 * question the test means to ask.
 */
function stanceOf(yard: Readonly<Yard>): Stance {
  return yard.stance;
}

function started(seed = 20260824): { match: Match; rng: Rng } {
  return { match: createMatch(), rng: new Rng(seed) };
}

/** Step both yards with nothing asked of either. */
function coast(match: Match, rng: Rng, steps: number): void {
  for (let i = 0; i < steps; i += 1) step(match, IDLE, IDLE, STEP, rng);
}

/** Step one yard until it has an animal on the crane, or give up. */
function toCrane(match: Match, yard: Yard, rng: Rng): void {
  for (let i = 0; i < 600 && yard.stance !== 'carrying'; i += 1) {
    stepYard(match, yard, IDLE, STEP, rng);
  }
}

/** Build a tower directly, for the statics tests. Returns the yard it built into. */
function tower(
  yard: Yard,
  animals: readonly { species: number; facing: number; across: number }[],
): Yard {
  let top = 0;
  for (let i = 0; i < animals.length; i += 1) {
    const wanted = animals[i];
    const placed = yard.stack[i];
    if (wanted === undefined || placed === undefined) continue;
    placed.species = wanted.species;
    placed.facing = wanted.facing;
    placed.across = wanted.across;
    placed.base = top;
    top += speciesAt(wanted.species).bodyHeight;
  }
  yard.count = animals.length;
  yard.top = top;
  return yard;
}

/** Put one animal on the crane and let it go, without touching the rest of the match. */
function dropAt(
  match: Match,
  yard: Yard,
  rng: Rng,
  species: number,
  facing: number,
  across: number,
): Landing {
  yard.stance = 'carrying';
  yard.carry = 0;
  yard.limit = CARRY_START;
  yard.held.species = species;
  yard.held.facing = facing;
  yard.held.across = across;
  clearIntent(scratch);
  scratch.drop = true;
  stepYard(match, yard, scratch, STEP, rng);
  clearIntent(scratch);
  let landing: Landing = 'none';
  for (let i = 0; i < 60 && stanceOf(yard) === 'dropping'; i += 1) {
    landing = stepYard(match, yard, IDLE, STEP, rng);
  }
  return landing;
}

/* ------------------------------------------------------------------ *
 * Scripted players, for everything that must not depend on a bot.
 * ------------------------------------------------------------------ */

type Policy = (yard: Readonly<Yard>, intent: Intent) => void;

/** Walks the animal to `aim(yard)` and lets go once it is within `tolerance`. */
function player(aim: (yard: Readonly<Yard>) => number, tolerance: number): Policy {
  return (yard, intent) => {
    clearIntent(intent);
    if (yard.stance !== 'carrying') return;
    const target = aim(yard);
    intent.aimActive = true;
    intent.aim = target;
    if (Math.abs(yard.held.across - target) <= tolerance) intent.drop = true;
  };
}

/** The middle of whatever strip the next animal has to land on. */
function supportCentre(yard: Readonly<Yard>): number {
  return (supportLoAt(yard, yard.count) + supportHiAt(yard, yard.count)) / 2;
}

/**
 * Searches a fine grid for the placement leaving the most slack, exactly the way the bot
 * does but with no misjudgement and no reaction time. This is what "played perfectly" means
 * in the tests below, and it reads nothing a player on the same screen cannot see.
 */
function bestAim(yard: Readonly<Yard>): number {
  const centre = supportCentre(yard);
  let best = centre;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (let i = 0; i <= 120; i += 1) {
    const across = centre - SEARCH_SPAN + (SEARCH_SPAN * 2 * i) / 120;
    const margin = trialMargin(yard, across, yard.held.facing);
    const back = across + yard.held.facing * speciesAt(yard.held.species).topOffset;
    const value = margin - DRIFT_WEIGHT * Math.abs(back);
    if (value > bestValue) {
      bestValue = value;
      best = across;
    }
  }
  return best;
}

const idle: Policy = (_yard, intent) => {
  clearIntent(intent);
};
const careful = player(bestAim, 0.5);
const middling = player(supportCentre, 3);
const wide = player((yard) => supportCentre(yard) + 26, 3);

/** A whole match, driven by two scripts. Bounded by the guard s own ten minutes. */
function play(seed: number, p1: Policy, p2: Policy): { match: Match; steps: number; rng: Rng } {
  const { match, rng } = started(seed);
  const a = createIntent();
  const b = createIntent();
  let steps = 0;
  for (; steps < GUARD_STEPS && match.winner === null; steps += 1) {
    p1(match.p1, a);
    p2(match.p2, b);
    step(match, a, b, STEP, rng);
  }
  return { match, steps, rng };
}

/** A whole bot-against-bot match, driven through the rules alone. */
function botMatch(
  p1: BotDifficulty,
  p2: BotDifficulty,
  seed: number,
): { match: Match; steps: number } {
  const { match, rng } = started(seed);
  const sa = createBotState();
  const sb = createBotState();
  const ia = createIntent();
  const ib = createIntent();
  let steps = 0;
  for (; steps < GUARD_STEPS && match.winner === null; steps += 1) {
    botIntent(match.p1, p1, sa, STEP, rng, ia);
    botIntent(match.p2, p2, sb, STEP, rng, ib);
    step(match, ia, ib, STEP, rng);
  }
  return { match, steps };
}

interface Run {
  p1: number;
  p2: number;
  drawn: number;
  open: number;
  longest: number;
  /** Matches in which at least one animal left a platform, reconstructed from the counts. */
  withFall: number;
  /** Animals that left a platform, over the whole run. */
  off: number;
  /** Animals put down on a platform, over the whole run. */
  dealt: number;
}

/** Head-to-head counts over `seeds` seeded matches. */
function ladder(p1: BotDifficulty, p2: BotDifficulty, seeds: number, base = 977): Run {
  const run: Run = { p1: 0, p2: 0, drawn: 0, open: 0, longest: 0, withFall: 0, off: 0, dealt: 0 };
  for (let seed = 1; seed <= seeds; seed += 1) {
    const { match, steps } = botMatch(p1, p2, seed * base + 3);
    run.longest = Math.max(run.longest, steps);
    if (match.winner === 'p1') run.p1 += 1;
    else if (match.winner === 'p2') run.p2 += 1;
    else if (match.winner === 'draw') run.drawn += 1;
    else run.open += 1;
    // Reconstructed from two counters that know nothing about falling: every animal dealt
    // either ends up standing on the platform or it went over the side.
    const off = match.p1.dealt - match.p1.count + (match.p2.dealt - match.p2.count);
    if (off > 0) run.withFall += 1;
    run.off += off;
    run.dealt += match.p1.dealt + match.p2.dealt;
  }
  return run;
}

/**
 * The statics, restated from the physical claim rather than reused from `rules.ts`.
 *
 * A stack of rigid bodies stands exactly when, at every join, the weight of everything above
 * that join falls inside the patch the two bodies touch on. Written out longhand here so that
 * the tests below check the *claim* rather than check `marginOf` against itself.
 */
function independentBreak(yard: Readonly<Yard>): number {
  let mass = 0;
  let moment = 0;
  for (let k = yard.count - 1; k >= 0; k -= 1) {
    const placed = placedAt(yard, k);
    const species = speciesAt(placed.species);
    mass += species.mass;
    moment += species.mass * (placed.across + placed.facing * species.lean);
    const weight = moment / mass;
    let supportLo = -PLATFORM_HALF;
    let supportHi = PLATFORM_HALF;
    if (k > 0) {
      const under = placedAt(yard, k - 1);
      const beneath = speciesAt(under.species);
      const centre = under.across + under.facing * beneath.topOffset;
      supportLo = centre - beneath.topHalf;
      supportHi = centre + beneath.topHalf;
    }
    const lo = Math.max(placed.across - species.baseHalf, supportLo);
    const hi = Math.min(placed.across + species.baseHalf, supportHi);
    if (hi - lo < MIN_CONTACT) return k;
    if (weight < lo || weight > hi) return k;
  }
  return -1;
}

/* ================================================================== *
 * The field
 * ================================================================== */

describe('the field', () => {
  it('is two whole yards and a gutter, with nothing left over', () => {
    expect(YARD_HEIGHT * 2 + GUTTER).toBe(FIELD_HEIGHT);
    expect(GUTTER).toBeGreaterThan(0);
  });

  it('maps the two yards onto exact half turns of one another', () => {
    for (const across of [-CARRY_REACH, -91, 0, 37, PLATFORM_HALF, CARRY_REACH]) {
      expect(worldXOf('p2', across)).toBeCloseTo(FIELD_WIDTH - worldXOf('p1', across), 9);
    }
    for (const height of [0, 44, YARD_HEIGHT / 2, YARD_HEIGHT - PLINTH_HEIGHT]) {
      expect(worldYOf('p2', height)).toBeCloseTo(FIELD_HEIGHT - worldYOf('p1', height), 9);
    }
  });

  it('puts both platforms on the centre line, because the platform is the origin', () => {
    expect(worldXOf('p1', 0)).toBe(FIELD_WIDTH / 2);
    expect(worldXOf('p2', 0)).toBe(FIELD_WIDTH / 2);
  });

  it('lays each seat platform along the edge nearest that seat', () => {
    expect(worldYOf('p1', 0)).toBe(FIELD_HEIGHT - PLINTH_HEIGHT);
    expect(worldYOf('p2', 0)).toBe(PLINTH_HEIGHT);
  });

  it('keeps each yard wholly inside its own half of the device', () => {
    const ceiling = YARD_HEIGHT - PLINTH_HEIGHT;
    expect(worldYOf('p1', ceiling)).toBeGreaterThan(FIELD_HEIGHT / 2);
    expect(worldYOf('p2', ceiling)).toBeLessThan(FIELD_HEIGHT / 2);
  });

  it('reads a point on the device back as an offset, for both seats', () => {
    for (const across of [-150, -8, 0, 8, 150]) {
      for (const seat of SEATS) {
        expect(acrossOfWorld(seat, worldXOf(seat, across))).toBeCloseTo(across, 9);
      }
    }
  });

  it('reads the far seat left and right the other way round, because it is', () => {
    // The far player is holding the device upside down, so their own right is the device s
    // left. That half turn lives in one function and is applied to input as well as output.
    expect(acrossOfWorld('p1', FIELD_WIDTH / 2 + 40)).toBeCloseTo(40, 9);
    expect(acrossOfWorld('p2', FIELD_WIDTH / 2 + 40)).toBeCloseTo(-40, 9);
  });

  it('keeps the widest animal at full reach inside the field', () => {
    const widest = Math.max(...SPECIES.map((species) => species.baseHalf));
    expect(CARRY_REACH + widest).toBeLessThan(FIELD_WIDTH / 2);
  });

  it('lets the crane reach well past the edge of the platform', () => {
    // The whole win condition is that an animal can go over the side, so the losing move has
    // to be reachable. If this ever stopped being true the game would have no rule.
    expect(CARRY_REACH).toBeGreaterThan(PLATFORM_HALF + 40);
  });

  it('has a platform wide enough to hold the widest animal twice over', () => {
    const widest = Math.max(...SPECIES.map((species) => species.baseHalf));
    expect(PLATFORM_HALF).toBe(widest * 2);
  });

  it('names the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

/* ================================================================== *
 * The animals
 * ================================================================== */

describe('the animals', () => {
  it('are six, ordered from the easiest to stack to the worst', () => {
    expect(SPECIES).toHaveLength(6);
    for (let i = 1; i < SPECIES.length; i += 1) {
      const previous = SPECIES[i - 1];
      const current = SPECIES[i];
      if (previous === undefined || current === undefined) continue;
      expect(current.baseHalf, `${current.name} feet`).toBeLessThan(previous.baseHalf);
      expect(current.topHalf, `${current.name} back`).toBeLessThan(previous.topHalf);
    }
  });

  it('can every one of them stand on the bare platform', () => {
    // An animal whose weight fell outside its own feet could not stand anywhere at all,
    // which would be a broken animal rather than a hard one.
    for (const species of SPECIES) {
      expect(Math.abs(species.lean), species.name).toBeLessThan(species.baseHalf);
    }
  });

  it('offers a back wide enough to be stood on at all', () => {
    for (const species of SPECIES) {
      expect(species.topHalf * 2, species.name).toBeGreaterThan(MIN_CONTACT);
    }
  });

  it('gives every one of them a positive height and mass', () => {
    for (const species of SPECIES) {
      expect(species.bodyHeight, species.name).toBeGreaterThan(0);
      expect(species.mass, species.name).toBeGreaterThan(0);
    }
  });

  it('offsets most backs from the feet, or a turn would mean nothing', () => {
    const offset = SPECIES.filter((species) => species.topOffset !== 0);
    expect(offset.length).toBeGreaterThanOrEqual(5);
  });

  it('answers an index outside the list with a tortoise rather than undefined', () => {
    expect(speciesAt(-1).name).toBe('tortoise');
    expect(speciesAt(99).name).toBe('tortoise');
    expect(speciesAt(0).name).toBe('tortoise');
    expect(speciesAt(5).name).toBe('flamingo');
  });

  it('mirrors the lean and the back when an animal is turned round', () => {
    for (let index = 0; index < SPECIES.length; index += 1) {
      const right = { species: index, facing: 1, across: 12, base: 0 };
      const left = { species: index, facing: -1, across: 12, base: 0 };
      expect(backCentreOf(right) - 12).toBeCloseTo(-(backCentreOf(left) - 12), 9);
      expect(weightCentreOf(right) - 12).toBeCloseTo(-(weightCentreOf(left) - 12), 9);
    }
  });
});

/* ================================================================== *
 * The statics
 * ================================================================== */

describe('one join', () => {
  it('holds when the weight is inside the contact', () => {
    expect(marginOf(-20, 20, -20, 20, 0)).toBe(20);
    expect(marginOf(-20, 20, -20, 20, 15)).toBe(5);
  });

  it('holds a weight exactly on the edge of the contact', () => {
    // The decision is made on the bit, so both sides of it are driven rather than described.
    expect(marginOf(-20, 20, -20, 20, 20)).toBe(0);
    expect(marginOf(-20, 20, -20, 20, -20)).toBe(0);
  });

  it('gives way a hair past the edge', () => {
    expect(marginOf(-20, 20, -20, 20, 20.0000001)).toBeLessThan(0);
    expect(marginOf(-20, 20, -20, 20, -20.0000001)).toBeLessThan(0);
  });

  it('takes the narrower of the feet and the back as the contact', () => {
    expect(marginOf(-40, 40, -10, 10, 0)).toBe(10);
    expect(marginOf(-10, 10, -40, 40, 0)).toBe(10);
  });

  it('takes the overlap when the two are offset', () => {
    // Feet from 0 to 40, back from 20 to 60: they touch on 20 to 40.
    expect(marginOf(0, 40, 20, 60, 30)).toBe(10);
    expect(marginOf(0, 40, 20, 60, 20)).toBe(0);
    expect(marginOf(0, 40, 20, 60, 19)).toBeLessThan(0);
  });

  it('refuses a foothold narrower than the minimum, however the weight falls', () => {
    const narrow = MIN_CONTACT - 0.0001;
    expect(marginOf(0, narrow, 0, narrow, narrow / 2)).toBeLessThan(0);
    expect(marginOf(0, MIN_CONTACT, 0, MIN_CONTACT, MIN_CONTACT / 2)).toBeGreaterThanOrEqual(0);
  });

  it('refuses feet that do not reach the back at all', () => {
    expect(marginOf(0, 20, 40, 60, 10)).toBeLessThan(0);
    expect(marginOf(0, 20, 40, 60, 50)).toBeLessThan(0);
  });

  it('reports how far short a hopeless placement fell, so two bad ones can be told apart', () => {
    const near = marginOf(0, 20, 21, 60, 10);
    const far = marginOf(0, 20, 90, 130, 10);
    expect(far).toBeLessThan(near);
  });

  it('is symmetric under mirroring', () => {
    for (const weight of [-31, -7, 0, 4, 19]) {
      expect(marginOf(-30, 12, -25, 25, weight)).toBeCloseTo(
        marginOf(-12, 30, -25, 25, -weight),
        9,
      );
    }
  });
});

describe('a tower', () => {
  it('stands with one animal squarely on the platform', () => {
    const { match } = started();
    tower(match.p1, [{ species: 0, facing: 1, across: 0 }]);
    expect(breakJointOf(match.p1)).toBe(-1);
    expect(towerMargin(match.p1)).toBeGreaterThan(0);
    expect(independentBreak(match.p1)).toBe(-1);
  });

  it('holds an animal whose weight sits exactly on the platform edge', () => {
    // A tortoise has no lean, so its weight is at its feet. Put its feet exactly on the edge
    // of the platform and the contact runs from there to the edge of its own feet.
    const { match } = started();
    tower(match.p1, [{ species: 0, facing: 1, across: PLATFORM_HALF }]);
    expect(towerMargin(match.p1)).toBe(0);
    expect(breakJointOf(match.p1)).toBe(-1);
    expect(independentBreak(match.p1)).toBe(-1);
  });

  it('drops one placed a hair further out than that', () => {
    const { match } = started();
    tower(match.p1, [{ species: 0, facing: 1, across: PLATFORM_HALF + 0.0001 }]);
    expect(breakJointOf(match.p1)).toBe(0);
    expect(independentBreak(match.p1)).toBe(0);
  });

  it('drops one placed clean off the platform', () => {
    const { match } = started();
    tower(match.p1, [{ species: 5, facing: 1, across: CARRY_REACH }]);
    expect(breakJointOf(match.p1)).toBe(0);
    expect(independentBreak(match.p1)).toBe(0);
  });

  it('breaks at the top join when only the newest animal is wrong', () => {
    const { match } = started();
    const yard = tower(match.p1, [
      { species: 0, facing: 1, across: 0 },
      { species: 5, facing: 1, across: 70 },
    ]);
    expect(breakJointOf(yard)).toBe(1);
    expect(independentBreak(yard)).toBe(1);
  });

  it('breaks at the base when the weight of the whole tower leaves the platform', () => {
    // A tortoise out near the edge holds on its own — its weight is 85 against a platform
    // that reaches 92. A pig put down further out again is perfectly happy on the tortoise s
    // back, and the pair together weigh in at 96.7, which is over the side.
    const { match } = started();
    const alone = tower(match.p1, [{ species: 0, facing: 1, across: 85 }]);
    expect(breakJointOf(alone)).toBe(-1);
    const yard = tower(match.p1, [
      { species: 0, facing: 1, across: 85 },
      { species: 1, facing: 1, across: 100 },
    ]);
    expect(weightAboveOf(yard, 1)).toBeCloseTo(106, 9);
    expect(weightAboveOf(yard, 0)).toBeCloseTo(261 / 2.7, 9);
    expect(breakJointOf(yard)).toBe(0);
    expect(independentBreak(yard)).toBe(0);
  });

  it('agrees with the statics written out longhand, over a thousand towers', () => {
    // The independent restatement is the point: it checks the physical claim rather than
    // checking `marginOf` against itself.
    const rng = new Rng(5150);
    const { match } = started();
    let broken = 0;
    let standing = 0;
    for (let trial = 0; trial < 1000; trial += 1) {
      const animals: { species: number; facing: number; across: number }[] = [];
      const height = 1 + rng.int(0, 5);
      for (let i = 0; i < height; i += 1) {
        animals.push({
          species: rng.int(0, SPECIES.length),
          facing: rng.bool() ? 1 : -1,
          across: (rng.float() * 2 - 1) * 120,
        });
      }
      const yard = tower(match.p1, animals);
      const mine = breakJointOf(yard);
      expect(mine).toBe(independentBreak(yard));
      if (mine >= 0) broken += 1;
      else standing += 1;
    }
    // And it has to have seen both answers, or it agreed about nothing.
    expect(broken).toBeGreaterThan(50);
    expect(standing).toBeGreaterThan(50);
  });

  it('says a tower stands exactly when its tightest join has slack to spare', () => {
    const rng = new Rng(6231);
    const { match } = started();
    for (let trial = 0; trial < 400; trial += 1) {
      const animals: { species: number; facing: number; across: number }[] = [];
      for (let i = 0; i < 1 + rng.int(0, 4); i += 1) {
        animals.push({
          species: rng.int(0, SPECIES.length),
          facing: rng.bool() ? 1 : -1,
          across: (rng.float() * 2 - 1) * 110,
        });
      }
      const yard = tower(match.p1, animals);
      expect(towerMargin(yard) >= 0).toBe(breakJointOf(yard) < 0);
    }
  });

  it('has no join at all when the platform is empty', () => {
    const { match } = started();
    expect(match.p1.count).toBe(0);
    expect(towerMargin(match.p1)).toBe(0);
    expect(breakJointOf(match.p1)).toBe(-1);
    expect(tightestJointOf(match.p1)).toBe(-1);
  });

  it('names the join with the least slack', () => {
    const { match } = started();
    const yard = tower(match.p1, [
      { species: 0, facing: 1, across: 0 },
      { species: 0, facing: 1, across: 0 },
      { species: 4, facing: 1, across: 30 },
    ]);
    const tight = tightestJointOf(yard);
    expect(tight).toBe(2);
    expect(towerMargin(yard)).toBeGreaterThanOrEqual(0);
  });

  it('weighs everything above a join and nothing below it', () => {
    const { match } = started();
    const yard = tower(match.p1, [
      { species: 0, facing: 1, across: -40 },
      { species: 0, facing: 1, across: 40 },
    ]);
    // Two equal tortoises with no lean: the pair balances at zero, the top one at forty.
    expect(weightAboveOf(yard, 0)).toBeCloseTo(0, 9);
    expect(weightAboveOf(yard, 1)).toBeCloseTo(40, 9);
    expect(weightAboveOf(yard, 2)).toBe(0);
  });

  it('reports the support of the first animal as the platform itself', () => {
    const { match } = started();
    expect(supportLoAt(match.p1, 0)).toBe(-PLATFORM_HALF);
    expect(supportHiAt(match.p1, 0)).toBe(PLATFORM_HALF);
  });

  it('reports the support of every later animal as the back below it', () => {
    const { match } = started();
    const yard = tower(match.p1, [{ species: 3, facing: -1, across: 20 }]);
    const goat = speciesAt(3);
    const centre = 20 - goat.topOffset;
    expect(supportLoAt(yard, 1)).toBeCloseTo(centre - goat.topHalf, 9);
    expect(supportHiAt(yard, 1)).toBeCloseTo(centre + goat.topHalf, 9);
  });

  it('is mirror symmetric: a mirrored tower has the mirrored margin', () => {
    const rng = new Rng(4242);
    const { match } = started();
    for (let trial = 0; trial < 200; trial += 1) {
      const animals: { species: number; facing: number; across: number }[] = [];
      for (let i = 0; i < 1 + rng.int(0, 4); i += 1) {
        animals.push({
          species: rng.int(0, SPECIES.length),
          facing: rng.bool() ? 1 : -1,
          across: (rng.float() * 2 - 1) * 100,
        });
      }
      const forward = towerMargin(tower(match.p1, animals));
      const mirrored = animals.map((animal) => ({
        species: animal.species,
        facing: -animal.facing,
        across: -animal.across,
      }));
      expect(towerMargin(tower(match.p2, mirrored))).toBeCloseTo(forward, 9);
    }
  });
});

describe('a trial placement', () => {
  it('says yes exactly when letting go really would leave everything standing', () => {
    // Driven rather than argued: a grid of placements is judged by `trialMargin` and then
    // actually dropped, and the two must agree on every one.
    const rng = new Rng(31337);
    let stood = 0;
    let dropped = 0;
    for (let trial = 0; trial < 240; trial += 1) {
      const { match, rng: stream } = started(trial * 13 + 1);
      const yard = tower(match.p1, [
        { species: rng.int(0, 4), facing: rng.bool() ? 1 : -1, across: (rng.float() * 2 - 1) * 40 },
        { species: rng.int(0, 5), facing: rng.bool() ? 1 : -1, across: (rng.float() * 2 - 1) * 50 },
      ]);
      if (breakJointOf(yard) >= 0) continue;
      const species = rng.int(0, SPECIES.length);
      const facing = rng.bool() ? 1 : -1;
      const across = (rng.float() * 2 - 1) * 90;
      yard.held.species = species;
      const predicted = wouldStand(yard, across, facing);
      const landing = dropAt(match, yard, stream, species, facing, across);
      expect(landing === 'stacked').toBe(predicted);
      if (predicted) stood += 1;
      else dropped += 1;
    }
    // And it has to have seen both answers, or it agreed about nothing.
    expect(stood).toBeGreaterThan(15);
    expect(dropped).toBeGreaterThan(15);
  });

  it('does not change the tower it is asked about', () => {
    const { match } = started();
    const yard = tower(match.p1, [{ species: 0, facing: 1, across: 5 }]);
    yard.held.species = 4;
    const before = JSON.stringify(yard.stack.slice(0, yard.count));
    trialMargin(yard, 200, -1);
    trialMargin(yard, 0, 1);
    expect(JSON.stringify(yard.stack.slice(0, yard.count))).toBe(before);
    expect(yard.count).toBe(1);
  });

  it('gets better as the animal is walked towards the middle of the support', () => {
    const { match } = started();
    const yard = tower(match.p1, [{ species: 0, facing: 1, across: 0 }]);
    yard.held.species = 0;
    const centre = supportCentre(yard);
    expect(trialMargin(yard, centre, 1)).toBeGreaterThan(trialMargin(yard, centre + 20, 1));
    expect(trialMargin(yard, centre, 1)).toBeGreaterThan(trialMargin(yard, centre - 20, 1));
  });
});

/* ================================================================== *
 * Dropping one animal
 * ================================================================== */

describe('letting an animal go', () => {
  it('stacks it when it lands square, and counts it', () => {
    const { match, rng } = started();
    expect(dropAt(match, match.p1, rng, 0, 1, 0)).toBe('stacked');
    expect(match.p1.count).toBe(1);
    expect(match.p1.stance).toBe('settling');
    expect(match.p1.last).toBe('stacked');
    expect(match.p1.top).toBe(speciesAt(0).bodyHeight);
  });

  it('takes only the newest animal when it slides off the top', () => {
    const { match, rng } = started();
    dropAt(match, match.p1, rng, 0, 1, 0);
    match.p1.stance = 'carrying';
    expect(dropAt(match, match.p1, rng, 5, 1, 110)).toBe('fell');
    expect(match.p1.count).toBe(1);
    expect(match.p1.toppled).toBe(1);
    expect(match.p1.broke).toBe(1);
    expect(match.p1.stance).toBe('fallen');
  });

  it('takes the whole tower when the base gives way', () => {
    const { match, rng } = started();
    const yard = tower(match.p1, [{ species: 0, facing: 1, across: 85 }]);
    expect(breakJointOf(yard)).toBe(-1);
    expect(dropAt(match, yard, rng, 1, 1, 100)).toBe('fell');
    expect(yard.broke).toBe(0);
    expect(yard.count).toBe(0);
    expect(yard.toppled).toBe(2);
    expect(yard.top).toBe(0);
  });

  it('leaves whatever is still standing standing', () => {
    // Every prefix of the stack was checked when it was built, so nothing left after a break
    // can be unstable. Driven over many towers rather than argued.
    const rng = new Rng(808);
    for (let trial = 0; trial < 200; trial += 1) {
      const { match, rng: stream } = started(trial * 7 + 5);
      const yard = match.p1;
      for (let i = 0; i < 6 && yard.stance !== 'fallen'; i += 1) {
        yard.stance = 'carrying';
        dropAt(
          match,
          yard,
          stream,
          rng.int(0, SPECIES.length),
          rng.bool() ? 1 : -1,
          (rng.float() * 2 - 1) * 90,
        );
      }
      expect(independentBreak(yard)).toBe(-1);
      expect(breakJointOf(yard)).toBe(-1);
    }
  });

  it('takes exactly as long to fall as the fall is long', () => {
    const { match, rng } = started();
    const yard = match.p1;
    yard.stance = 'carrying';
    yard.limit = CARRY_START;
    yard.held.species = 0;
    yard.held.across = 0;
    clearIntent(scratch);
    scratch.drop = true;
    stepYard(match, yard, scratch, STEP, rng);
    clearIntent(scratch);
    expect(yard.stance).toBe('dropping');
    let steps = 0;
    for (; steps < 200 && stanceOf(yard) === 'dropping'; steps += 1) {
      stepYard(match, yard, IDLE, STEP, rng);
    }
    expect(steps).toBe(Math.ceil(FALL_SECONDS / STEP));
  });

  it('does not judge the landing until the animal is down', () => {
    const { match, rng } = started();
    const yard = match.p1;
    yard.stance = 'carrying';
    yard.limit = CARRY_START;
    yard.held.species = 5;
    yard.held.across = CARRY_REACH;
    clearIntent(scratch);
    scratch.drop = true;
    stepYard(match, yard, scratch, STEP, rng);
    clearIntent(scratch);
    for (let i = 0; i < 3; i += 1) {
      expect(stepYard(match, yard, IDLE, STEP, rng)).toBe('none');
      expect(yard.stance).toBe('dropping');
    }
  });
});

/* ================================================================== *
 * Walking the animal
 * ================================================================== */

describe('walking the animal', () => {
  function carrying(): { match: Match; yard: Yard; rng: Rng } {
    const { match, rng } = started();
    toCrane(match, match.p1, rng);
    match.p1.held.across = 0;
    return { match, yard: match.p1, rng };
  }

  it('walks at one speed for a held key', () => {
    const { match, yard, rng } = carrying();
    clearIntent(scratch);
    scratch.slide = 1;
    stepYard(match, yard, scratch, STEP, rng);
    expect(yard.held.across).toBeCloseTo(SLIDE_SPEED * STEP, 9);
  });

  it('walks the other way for the other key', () => {
    const { match, yard, rng } = carrying();
    clearIntent(scratch);
    scratch.slide = -1;
    stepYard(match, yard, scratch, STEP, rng);
    expect(yard.held.across).toBeCloseTo(-SLIDE_SPEED * STEP, 9);
  });

  it('reads the sign of a key and never its size, so two keys cannot out-run one', () => {
    const a = carrying();
    clearIntent(scratch);
    scratch.slide = 1;
    stepYard(a.match, a.yard, scratch, STEP, a.rng);
    const b = carrying();
    clearIntent(scratch);
    scratch.slide = 0.7071067811865476;
    stepYard(b.match, b.yard, scratch, STEP, b.rng);
    expect(b.yard.held.across).toBe(a.yard.held.across);
  });

  it('stands still when nothing is asked of it', () => {
    const { match, yard, rng } = carrying();
    stepYard(match, yard, IDLE, STEP, rng);
    expect(yard.held.across).toBe(0);
  });

  it('walks towards a point at the same speed a key walks it', () => {
    const { match, yard, rng } = carrying();
    clearIntent(scratch);
    scratch.aimActive = true;
    scratch.aim = CARRY_REACH;
    stepYard(match, yard, scratch, STEP, rng);
    expect(yard.held.across).toBeCloseTo(SLIDE_SPEED * STEP, 9);
  });

  it('lands exactly on a point already within one step, so a finger is exact', () => {
    const { match, yard, rng } = carrying();
    clearIntent(scratch);
    scratch.aimActive = true;
    scratch.aim = 1.25;
    stepYard(match, yard, scratch, STEP, rng);
    expect(yard.held.across).toBe(1.25);
  });

  it('never teleports after a finger that jumps across the yard', () => {
    const { match, yard, rng } = carrying();
    clearIntent(scratch);
    scratch.aimActive = true;
    scratch.aim = -CARRY_REACH;
    for (let i = 0; i < 5; i += 1) stepYard(match, yard, scratch, STEP, rng);
    expect(yard.held.across).toBeCloseTo(-5 * SLIDE_SPEED * STEP, 9);
    expect(yard.held.across).toBeGreaterThan(-CARRY_REACH);
  });

  it('lets a finger beat a key to nothing, over the whole reach', () => {
    // Rule 10: neither instrument may place the animal faster than the other.
    const byKey = carrying();
    const byThumb = carrying();
    for (let i = 0; i < 200; i += 1) {
      clearIntent(scratch);
      scratch.slide = 1;
      stepYard(byKey.match, byKey.yard, scratch, STEP, byKey.rng);
      clearIntent(scratch);
      scratch.aimActive = true;
      scratch.aim = CARRY_REACH;
      stepYard(byThumb.match, byThumb.yard, scratch, STEP, byThumb.rng);
      expect(byThumb.yard.held.across).toBeCloseTo(byKey.yard.held.across, 9);
    }
    expect(byKey.yard.held.across).toBe(CARRY_REACH);
  });

  it('stops at the end of the crane reach, both ways', () => {
    // The crane clock is held back each step so the animal is not let go part way, which is
    // the only thing this is asking about.
    const { match, yard, rng } = carrying();
    clearIntent(scratch);
    scratch.slide = 1;
    for (let i = 0; i < 150; i += 1) {
      yard.carry = 0;
      stepYard(match, yard, scratch, STEP, rng);
    }
    expect(yard.held.across).toBe(CARRY_REACH);
    clearIntent(scratch);
    scratch.slide = -1;
    for (let i = 0; i < 150; i += 1) {
      yard.carry = 0;
      stepYard(match, yard, scratch, STEP, rng);
    }
    expect(yard.held.across).toBe(-CARRY_REACH);
  });

  it('turns the animal round when asked, and leaves it where it was', () => {
    const { match, yard, rng } = carrying();
    yard.held.across = 30;
    const before = yard.held.facing;
    clearIntent(scratch);
    scratch.turn = true;
    stepYard(match, yard, scratch, STEP, rng);
    expect(yard.held.facing).toBe(-before);
    expect(yard.held.across).toBe(30);
  });

  it('turns it back again on a second ask', () => {
    const { match, yard, rng } = carrying();
    const before = yard.held.facing;
    clearIntent(scratch);
    scratch.turn = true;
    stepYard(match, yard, scratch, STEP, rng);
    stepYard(match, yard, scratch, STEP, rng);
    expect(yard.held.facing).toBe(before);
  });

  it('ignores everything asked of a yard that is not carrying', () => {
    const { match, rng } = started();
    const yard = match.p1;
    expect(yard.stance).toBe('settling');
    clearIntent(scratch);
    scratch.slide = 1;
    scratch.turn = true;
    scratch.drop = true;
    const across = yard.held.across;
    stepYard(match, yard, scratch, STEP, rng);
    expect(yard.held.across).toBe(across);
  });
});

/* ================================================================== *
 * The grip: one gesture, two instruments
 * ================================================================== */

describe('the grip', () => {
  /** A press held for `steps` steps and then let go. Returns what the release meant. */
  function hold(steps: number): number {
    const grip = createGrip();
    expect(gripStep(grip, true, true, false, STEP)).toBe(GRIP_NONE);
    for (let i = 1; i < steps; i += 1) {
      expect(gripStep(grip, false, true, false, STEP)).toBe(GRIP_NONE);
    }
    return gripStep(grip, false, false, true, STEP);
  }

  it('turns the animal on a tap', () => {
    expect(hold(1)).toBe(GRIP_TURN);
    expect(hold(4)).toBe(GRIP_TURN);
  });

  it('drops it on a press that is held and then let go', () => {
    expect(hold(20)).toBe(GRIP_DROP);
    expect(hold(200)).toBe(GRIP_DROP);
  });

  it('puts the boundary between two whole steps, so no float decides it', () => {
    // Eleven steps is 0.18333 s and twelve is 0.2 s, and the threshold is 0.19: a threshold
    // sitting on a step boundary would be decided by whether thirty additions of a sixtieth
    // land a hair above or below it.
    expect(TAP_SECONDS).toBeGreaterThan(11 * STEP);
    expect(TAP_SECONDS).toBeLessThan(12 * STEP);
    expect(hold(10)).toBe(GRIP_TURN);
    expect(hold(11)).toBe(GRIP_TURN);
    expect(hold(12)).toBe(GRIP_DROP);
    expect(hold(13)).toBe(GRIP_DROP);
    let sum = 0;
    for (let i = 0; i < 11; i += 1) sum += STEP;
    expect(Math.abs(sum - TAP_SECONDS)).toBeGreaterThan(1e-6);
  });

  it('counts a press and a release that land inside the same step as a tap', () => {
    // Which is most taps on a touchscreen: the engine latches both and hands them over
    // together, and a gesture that read only "is it down now" would miss the lot.
    const grip = createGrip();
    expect(gripStep(grip, true, false, true, STEP)).toBe(GRIP_TURN);
  });

  it('says nothing while a press is still being held', () => {
    const grip = createGrip();
    expect(gripStep(grip, true, true, false, STEP)).toBe(GRIP_NONE);
    for (let i = 0; i < 60; i += 1) {
      expect(gripStep(grip, false, true, false, STEP)).toBe(GRIP_NONE);
    }
  });

  it('says nothing at all when nothing is pressed', () => {
    const grip = createGrip();
    for (let i = 0; i < 60; i += 1) {
      expect(gripStep(grip, false, false, false, STEP)).toBe(GRIP_NONE);
    }
  });

  it('ignores a release it never saw the press of', () => {
    const grip = createGrip();
    expect(gripStep(grip, false, false, true, STEP)).toBe(GRIP_NONE);
  });

  it('answers a second gesture as freshly as the first', () => {
    const grip = createGrip();
    gripStep(grip, true, true, false, STEP);
    expect(gripStep(grip, false, false, true, STEP)).toBe(GRIP_TURN);
    gripStep(grip, true, true, false, STEP);
    for (let i = 0; i < 30; i += 1) gripStep(grip, false, true, false, STEP);
    expect(gripStep(grip, false, false, true, STEP)).toBe(GRIP_DROP);
  });

  it('forgets a press that is thrown away', () => {
    const grip = createGrip();
    gripStep(grip, true, true, false, STEP);
    for (let i = 0; i < 30; i += 1) gripStep(grip, false, true, false, STEP);
    resetGrip(grip);
    expect(gripStep(grip, false, false, true, STEP)).toBe(GRIP_NONE);
    expect(grip.held).toBe(false);
    expect(grip.seconds).toBe(0);
  });

  it('gives a key and a thumb the same answer for the same shaped gesture', () => {
    // There is nothing in here that knows which instrument raised the press: the engine has
    // already folded a key and a pointer into one action before this is called.
    for (const steps of [1, 5, 11, 12, 30]) {
      const key = createGrip();
      const thumb = createGrip();
      let a = gripStep(key, true, true, false, STEP);
      let b = gripStep(thumb, true, true, false, STEP);
      for (let i = 1; i < steps; i += 1) {
        a = gripStep(key, false, true, false, STEP);
        b = gripStep(thumb, false, true, false, STEP);
      }
      expect(gripStep(key, false, false, true, STEP)).toBe(
        gripStep(thumb, false, false, true, STEP),
      );
      expect(a).toBe(b);
    }
  });
});

/* ================================================================== *
 * The deal
 * ================================================================== */

describe('the deal', () => {
  it('hands the two seats the same animals by number, whatever pace they play at', () => {
    // Seat one spends its animals fast and seat two slowly, so they are never on the same
    // number at the same time — and still get the identical run of animals.
    const seen: Record<SeatId, string[]> = { p1: [], p2: [] };
    const { match, rng } = started(4711);
    const a = createIntent();
    const b = createIntent();
    let lastDealt: Record<SeatId, number> = { p1: 0, p2: 0 };
    for (let i = 0; i < GUARD_STEPS && match.winner === null; i += 1) {
      careful(match.p1, a);
      if (i % 3 === 0) middling(match.p2, b);
      else clearIntent(b);
      step(match, a, b, STEP, rng);
      for (const seat of SEATS) {
        const yard = yardOf(match, seat);
        if (yard.dealt === lastDealt[seat]) continue;
        lastDealt = { ...lastDealt, [seat]: yard.dealt };
        seen[seat].push(`${String(yard.held.species)}:${String(yard.held.facing)}`);
      }
    }
    const shorter = Math.min(seen.p1.length, seen.p2.length);
    expect(shorter).toBeGreaterThan(3);
    expect(seen.p1.slice(0, shorter)).toEqual(seen.p2.slice(0, shorter));
  });

  it('draws each animal from the stream exactly once', () => {
    const { match, rng } = started(21);
    const a = createIntent();
    const b = createIntent();
    for (let i = 0; i < GUARD_STEPS && match.winner === null; i += 1) {
      careful(match.p1, a);
      middling(match.p2, b);
      step(match, a, b, STEP, rng);
      expect(match.drawn).toBeLessThanOrEqual(MAX_ANIMALS);
    }
    expect(match.drawn).toBe(Math.max(match.p1.dealt, match.p2.dealt));
  });

  it('opens with the easy animals and ends with the awkward ones', () => {
    const early: number[] = [];
    const late: number[] = [];
    for (let seed = 1; seed <= 40; seed += 1) {
      const { match, rng } = started(seed * 131);
      const a = createIntent();
      for (let i = 0; i < GUARD_STEPS && match.p1.dealt < MAX_ANIMALS; i += 1) {
        careful(match.p1, a);
        stepYard(match, match.p1, a, STEP, rng);
        // Stood back up after a fall, because what is being read here is the run of animals
        // the match deals rather than how far anybody got through it.
        if (stanceOf(match.p1) !== 'fallen') continue;
        match.p1.stance = 'settling';
        match.p1.rest = 0;
        match.p1.count = 0;
        match.p1.top = 0;
      }
      for (let i = 0; i < MAX_ANIMALS; i += 1) {
        const species = match.species[i] ?? 0;
        if (i < 4) early.push(species);
        if (i >= MAX_ANIMALS - 4) late.push(species);
      }
    }
    const mean = (values: number[]): number =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(Math.max(...early)).toBeLessThanOrEqual(2);
    expect(Math.min(...late)).toBeGreaterThanOrEqual(3);
    expect(mean(late)).toBeGreaterThan(mean(early) + 2);
  });

  it('delivers every animal well off the middle of the platform', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const { match, rng } = started(seed * 97 + 1);
      coast(match, rng, 60 * 90);
      for (let i = 0; i < match.drawn; i += 1) {
        const start = Math.abs(match.starts[i] ?? 0);
        expect(start).toBeGreaterThanOrEqual(0.4 * startReachFor(i) - 1e-9);
        expect(start).toBeLessThanOrEqual(startReachFor(i) + 1e-9);
      }
    }
  });

  it('delivers them further out as the tower grows', () => {
    expect(startReachFor(0)).toBe(START_NEAR);
    expect(startReachFor(MAX_ANIMALS - 1)).toBe(START_FAR);
    for (let i = 1; i < MAX_ANIMALS; i += 1) {
      expect(startReachFor(i)).toBeGreaterThan(startReachFor(i - 1));
    }
  });

  it('starts them beyond half a platform, so doing nothing loses', () => {
    expect(START_FAR).toBeGreaterThan(PLATFORM_HALF);
  });

  it('gives the crane less patience as the tower grows, down to a floor', () => {
    expect(carrySecondsFor(0)).toBe(CARRY_START);
    for (let i = 1; i < MAX_ANIMALS; i += 1) {
      expect(carrySecondsFor(i)).toBeLessThanOrEqual(carrySecondsFor(i - 1));
      expect(carrySecondsFor(i)).toBeGreaterThanOrEqual(CARRY_MIN);
    }
    expect(carrySecondsFor(999)).toBe(CARRY_MIN);
    expect(CARRY_STEP).toBeGreaterThan(0);
  });

  it('always leaves time to walk an animal the whole way in', () => {
    // If the crane clock ever fell below the time it takes to cross the reach, a placement
    // would be impossible rather than hard, and the game would be deciding matches by
    // arithmetic nobody could see.
    for (let i = 0; i < MAX_ANIMALS; i += 1) {
      const crossing = (startReachFor(i) + CARRY_REACH) / SLIDE_SPEED;
      expect(carrySecondsFor(i), `animal ${String(i)}`).toBeGreaterThan(crossing);
    }
  });
});

/* ================================================================== *
 * Termination
 * ================================================================== */

describe('a match', () => {
  it('closes its own arithmetic against the guard ceiling', () => {
    // Multiplied out rather than asserted from a feeling. The dearest an animal can be made
    // to cost is the whole crane clock, then the fall, then the rest — a player who holds
    // every animal to the brink. One extra step of slack per clock, because each is checked
    // after it is advanced.
    let worst = READY_SECONDS;
    for (let i = 0; i < MAX_ANIMALS; i += 1) {
      worst += carrySecondsFor(i) + FALL_SECONDS + REST_SECONDS + 3 * STEP;
    }
    expect(worst).toBeLessThan(ROUND_SECONDS);
    expect(worst).toBeLessThan(600);
    expect(worst).toBeGreaterThan(60);
    expect(worst).toBeLessThan(63);
  });

  it('ends when neither player touches anything', () => {
    // The case a stacking game has to earn: nothing arrives on its own. Every animal is
    // dropped by the crane where it was delivered, and by the second one that is over the
    // side.
    const { match, steps } = play(12, idle, idle);
    expect(match.winner).toBe('draw');
    expect(match.p1.stance).toBe('fallen');
    expect(match.p2.stance).toBe('fallen');
    expect(steps / 60).toBeLessThan(ROUND_SECONDS);
    // Measured over 200 seeds: 9.9 s to 33.6 s, two to eight animals, and a draw every time.
    expect(steps / 60).toBeLessThan(40);
    expect(match.p1).toEqual(match.p2);
  });

  it('ends when both players hold every animal to the brink of the crane clock', () => {
    const brink: Policy = (yard, intent) => {
      clearIntent(intent);
      if (yard.stance !== 'carrying') return;
      intent.aimActive = true;
      intent.aim = bestAim(yard);
      if (yard.carry >= yard.limit - 2 * STEP) intent.drop = true;
    };
    const { match, steps } = play(13, brink, brink);
    expect(match.winner).not.toBeNull();
    expect(steps / 60).toBeLessThan(ROUND_SECONDS);
  });

  it('ends when both players let go the instant an animal arrives', () => {
    const instant: Policy = (yard, intent) => {
      clearIntent(intent);
      if (yard.stance === 'carrying') intent.drop = true;
    };
    const { match, steps } = play(14, instant, instant);
    expect(match.winner).not.toBeNull();
    expect(steps / 60).toBeLessThan(30);
  });

  it('ends a match two of the weakest bots play, on every seed', () => {
    const run = ladder('easy', 'easy', 24);
    expect(run.open).toBe(0);
    expect(run.longest / 60).toBeLessThan(ROUND_SECONDS);
  });

  it('ends a match two of the strongest bots play, on every seed', () => {
    const run = ladder('hard', 'hard', 24);
    expect(run.open).toBe(0);
    expect(run.longest / 60).toBeLessThan(ROUND_SECONDS);
  });

  it('ends a mismatched pairing, on every seed', () => {
    const run = ladder('hard', 'easy', 24);
    expect(run.open).toBe(0);
    expect(run.longest / 60).toBeLessThan(ROUND_SECONDS);
  });

  it('is called if it somehow outlasts the clock', () => {
    // Nothing reaches this today; it is here because a game whose only guarantee lives in
    // its pacing constants is one change away from running for ever.
    const { match, rng } = started();
    match.elapsed = ROUND_SECONDS;
    step(match, IDLE, IDLE, STEP, rng);
    expect(match.phase).toBe('over');
    expect(match.winner).not.toBeNull();
  });

  it('gives the taller tower the win when the clock runs out mid-match', () => {
    const { match, rng } = started();
    tower(match.p1, [
      { species: 0, facing: 1, across: 0 },
      { species: 0, facing: 1, across: 0 },
    ]);
    tower(match.p2, [{ species: 0, facing: 1, across: 0 }]);
    match.elapsed = ROUND_SECONDS;
    step(match, IDLE, IDLE, STEP, rng);
    expect(match.winner).toBe('p1');
  });

  it('stops stepping once it is over', () => {
    const { match, rng } = started();
    match.phase = 'over';
    match.winner = 'p1';
    const before = match.elapsed;
    const outcome = step(match, IDLE, IDLE, STEP, rng);
    expect(match.elapsed).toBe(before);
    expect(outcome.p1).toBe('none');
    expect(outcome.p2).toBe('none');
  });
});

/* ================================================================== *
 * The win condition
 * ================================================================== */

describe('the win condition', () => {
  it('gives the match to the other seat the moment a tower goes', () => {
    const { match, rng } = started();
    tower(match.p1, [{ species: 0, facing: 1, across: 0 }]);
    match.p1.stance = 'carrying';
    match.p1.limit = CARRY_START;
    dropAt(match, match.p1, rng, 5, 1, CARRY_REACH);
    decide(match);
    expect(fallenOf(match.p1)).toBe(true);
    expect(match.winner).toBe('p2');
  });

  it('gives it the other way round just as readily', () => {
    const { match, rng } = started();
    match.p2.stance = 'carrying';
    match.p2.limit = CARRY_START;
    dropAt(match, match.p2, rng, 5, 1, CARRY_REACH);
    decide(match);
    expect(match.winner).toBe('p1');
  });

  it('calls two towers that go in the same step a draw', () => {
    const { match } = started();
    match.p1.stance = 'fallen';
    match.p2.stance = 'fallen';
    decide(match);
    expect(match.winner).toBe('draw');
  });

  it('leaves the match open while both towers are standing', () => {
    const { match, rng } = started();
    coast(match, rng, 30);
    expect(winnerOf(match)).toBeNull();
    expect(match.phase).toBe('playing');
  });

  it('settles two survivors on the steadier tower', () => {
    const { match } = started();
    // Two towers of the same height; p2 has put its animal further off centre.
    tower(match.p1, [{ species: 0, facing: 1, across: 0 }]);
    tower(match.p2, [{ species: 0, facing: 1, across: 70 }]);
    match.p1.dealt = MAX_ANIMALS;
    match.p2.dealt = MAX_ANIMALS;
    match.p1.stance = 'safe';
    match.p2.stance = 'safe';
    expect(spent(match)).toBe(true);
    expect(towerMargin(match.p1)).toBeGreaterThan(towerMargin(match.p2));
    decide(match);
    expect(match.winner).toBe('p1');
  });

  it('settles it the other way when the other tower is steadier', () => {
    const { match } = started();
    tower(match.p1, [{ species: 0, facing: 1, across: -55 }]);
    tower(match.p2, [{ species: 0, facing: 1, across: 4 }]);
    match.p1.stance = 'safe';
    match.p2.stance = 'safe';
    decide(match);
    expect(match.winner).toBe('p2');
  });

  it('calls two towers standing exactly as steadily a draw', () => {
    const { match } = started();
    tower(match.p1, [{ species: 2, facing: 1, across: 11 }]);
    tower(match.p2, [{ species: 2, facing: 1, across: 11 }]);
    match.p1.stance = 'safe';
    match.p2.stance = 'safe';
    expect(breakTie(match)).toBe('draw');
    decide(match);
    expect(match.winner).toBe('draw');
  });

  it('never breaks a tie between two towers that both came down', () => {
    const { match } = started();
    tower(match.p1, [{ species: 0, facing: 1, across: 0 }]);
    match.p1.stance = 'fallen';
    match.p2.stance = 'fallen';
    expect(breakTie(match)).toBe('draw');
  });

  it('does not call the match while one seat is still placing animals', () => {
    const { match } = started();
    match.p1.stance = 'safe';
    match.p1.dealt = MAX_ANIMALS;
    match.p2.stance = 'carrying';
    expect(spent(match)).toBe(false);
    decide(match);
    expect(match.winner).toBeNull();
  });

  it('never rewrites a decision it has already made', () => {
    const { match } = started();
    match.p1.stance = 'fallen';
    decide(match);
    expect(match.winner).toBe('p2');
    match.p2.stance = 'fallen';
    decide(match);
    expect(match.winner).toBe('p2');
  });
});

/* ================================================================== *
 * The two seats
 * ================================================================== */

describe('the two seats', () => {
  it('hold byte-identical yards when they are played identically', () => {
    // Because everything is platform-local, this is an equality on two records rather than
    // mirror arithmetic that could itself be wrong.
    const { match } = play(77, careful, careful);
    expect(match.p1).toEqual(match.p2);
    expect(match.winner).toBe('draw');
  });

  it('mirror exactly when two different players swap seats', () => {
    for (let seed = 1; seed <= 16; seed += 1) {
      const forward = play(seed * 313 + 7, careful, wide).match;
      const swapped = play(seed * 313 + 7, wide, careful).match;
      expect(swapped.p2.count).toBe(forward.p1.count);
      expect(swapped.p1.count).toBe(forward.p2.count);
      expect(swapped.p2.dealt).toBe(forward.p1.dealt);
      expect(swapped.p1.dealt).toBe(forward.p2.dealt);
      expect(swapped.p2.stance).toBe(forward.p1.stance);
      expect(swapped.p1.stance).toBe(forward.p2.stance);
      const flip = (winner: SeatId | 'draw' | null): SeatId | 'draw' | null =>
        winner === 'p1' ? 'p2' : winner === 'p2' ? 'p1' : winner;
      expect(flip(swapped.winner)).toBe(forward.winner);
    }
  });

  it('really are two different players, or the mirror is passing on two copies of one', () => {
    let apart = 0;
    for (let seed = 1; seed <= 16; seed += 1) {
      const { match } = play(seed * 313 + 7, careful, wide);
      if (match.p1.count !== match.p2.count) apart += 1;
    }
    expect(apart).toBeGreaterThan(10);
  });

  it('cannot touch one another, however differently they play', () => {
    const { match, rng } = started(9001);
    const a = createIntent();
    for (let i = 0; i < 600; i += 1) {
      careful(match.p1, a);
      stepYard(match, match.p1, a, STEP, rng);
    }
    expect(match.p1.dealt).toBeGreaterThan(1);
    expect(match.p2.dealt).toBe(0);
    expect(match.p2.count).toBe(0);
    expect(match.p2.stance).toBe('settling');
  });
});

/* ================================================================== *
 * Determinism
 * ================================================================== */

describe('the simulation', () => {
  it('replays a match exactly from one seed', () => {
    const a = play(2468, careful, wide).match;
    const b = play(2468, careful, wide).match;
    expect(a.p1).toEqual(b.p1);
    expect(a.p2).toEqual(b.p2);
    expect(a.winner).toBe(b.winner);
    expect(a.elapsed).toBeCloseTo(b.elapsed, 12);
  });

  it('plays a different match from a different seed', () => {
    const a = play(2468, careful, wide).match;
    const b = play(1357, careful, wide).match;
    expect(a.species.join(',')).not.toBe(b.species.join(','));
  });

  it('deals the same animals however differently the match is played', () => {
    const a = play(5150, careful, wide).match;
    const b = play(5150, middling, idle).match;
    const shorter = Math.min(a.drawn, b.drawn);
    expect(shorter).toBeGreaterThan(1);
    expect(a.species.slice(0, shorter)).toEqual(b.species.slice(0, shorter));
    expect(a.starts.slice(0, shorter)).toEqual(b.starts.slice(0, shorter));
  });

  it('lands a finger on the same point at 60 Hz and at 120 Hz', () => {
    // The walk is a constant-velocity integral, and it *snaps* onto a point once it is
    // within one step of it — so a placement arrives at exactly the same place however the
    // steps fall, which is the only thing the outcome is decided on.
    const target = 37.5;
    const arrive = (delta: number): number => {
      const { match, rng } = started();
      toCrane(match, match.p1, rng);
      match.p1.held.across = -CARRY_REACH;
      clearIntent(scratch);
      scratch.aimActive = true;
      scratch.aim = target;
      for (let i = 0; i < 5000 && match.p1.held.across !== target; i += 1) {
        stepYard(match, match.p1, scratch, delta, rng);
      }
      return match.p1.held.across;
    };
    expect(arrive(STEP)).toBe(target);
    expect(arrive(1 / 120)).toBe(target);
    expect(arrive(1 / 90)).toBe(target);
  });

  it('counts every clock in simulated seconds off the fixed step', () => {
    const { match, rng } = started();
    const before = match.elapsed;
    step(match, IDLE, IDLE, STEP, rng);
    expect(match.elapsed).toBeCloseTo(before + STEP, 12);
    expect(match.p1.since).toBeCloseTo(STEP, 12);
  });

  it('allocates nothing per step', () => {
    // The stacks and the deal arrays are sized once for the whole match and the step result
    // is one record rewritten in place. Both are checked because both are the classic
    // offender.
    const { match, rng } = started();
    expect(match.species).toHaveLength(MAX_ANIMALS);
    expect(match.facings).toHaveLength(MAX_ANIMALS);
    expect(match.starts).toHaveLength(MAX_ANIMALS);
    expect(match.p1.stack).toHaveLength(MAX_ANIMALS);
    expect(match.p2.stack).toHaveLength(MAX_ANIMALS);
    const first = step(match, IDLE, IDLE, STEP, rng);
    const second = step(match, IDLE, IDLE, STEP, rng);
    expect(first).toBe(second);
  });

  it('keeps the stack the same objects for the whole match', () => {
    const { match, rng } = started(606);
    const identity = match.p1.stack.map((placed) => placed);
    const a = createIntent();
    const b = createIntent();
    for (let i = 0; i < GUARD_STEPS && match.winner === null; i += 1) {
      careful(match.p1, a);
      wide(match.p2, b);
      step(match, a, b, STEP, rng);
    }
    for (let i = 0; i < MAX_ANIMALS; i += 1) expect(match.p1.stack[i]).toBe(identity[i]);
  });

  it('leaves a reset match indistinguishable from a fresh one', () => {
    const { match, rng } = started(31);
    const a = createIntent();
    for (let i = 0; i < 900; i += 1) {
      careful(match.p1, a);
      step(match, a, IDLE, STEP, rng);
    }
    resetMatch(match);
    expect(match).toEqual(createMatch());
  });
});

/* ================================================================== *
 * The bot
 * ================================================================== */

describe('the bot', () => {
  it('orders its knobs the same way across the three tiers', () => {
    const easy = BOT_PROFILES.easy;
    const normal = BOT_PROFILES.normal;
    const hard = BOT_PROFILES.hard;
    expect(easy.reaction).toBeGreaterThan(normal.reaction);
    expect(normal.reaction).toBeGreaterThan(hard.reaction);
    expect(easy.error).toBeGreaterThan(normal.error);
    expect(normal.error).toBeGreaterThan(hard.error);
    expect(easy.blunder).toBeGreaterThan(normal.blunder);
    expect(normal.blunder).toBeGreaterThan(hard.blunder);
    expect(easy.tries).toBeLessThan(normal.tries);
    expect(normal.tries).toBeLessThan(hard.tries);
    expect(easy.tolerance).toBeGreaterThan(normal.tolerance);
    expect(normal.tolerance).toBeGreaterThan(hard.tolerance);
  });

  it('gives no tier a wider platform, a longer clock or a slower animal', () => {
    // Every tier plays the identical rules. The only asymmetry a difficulty may have is in
    // how well it decides, which is what the profile is.
    const keys = Object.keys(BOT_PROFILES.easy).sort();
    expect(keys).toEqual(['blunder', 'error', 'reaction', 'tolerance', 'tries']);
  });

  it('draws its misjudgement once an animal and holds it', () => {
    // The bug the SDK s `misjudgement` exists to prevent: a fresh error sixty times a second
    // averages to zero and every tier plays the same.
    const { match, rng } = started();
    toCrane(match, match.p1, rng);
    const state = createBotState();
    const out = createIntent();
    botIntent(match.p1, 'easy', state, STEP, rng, out);
    const first = state.bias;
    for (let i = 0; i < 40; i += 1) botIntent(match.p1, 'easy', state, STEP, rng, out);
    expect(state.bias).toBe(first);
  });

  it('draws a fresh one for the next animal', () => {
    const { match, rng } = started();
    toCrane(match, match.p1, rng);
    const state = createBotState();
    const out = createIntent();
    botIntent(match.p1, 'easy', state, STEP, rng, out);
    const first = state.bias;
    match.p1.stance = 'settling';
    botIntent(match.p1, 'easy', state, STEP, rng, out);
    expect(state.armed).toBe(false);
    match.p1.stance = 'carrying';
    botIntent(match.p1, 'easy', state, STEP, rng, out);
    expect(state.bias).not.toBe(first);
  });

  it('asks for nothing at all when there is nothing on the crane', () => {
    const { match, rng } = started();
    const state = createBotState();
    const out = createIntent();
    expect(match.p1.stance).toBe('settling');
    botIntent(match.p1, 'hard', state, STEP, rng, out);
    expect(out).toEqual(createIntent());
  });

  it('never touches the other seat, because it is never handed it', () => {
    const { match, rng } = started();
    toCrane(match, match.p1, rng);
    const state = createBotState();
    const out = createIntent();
    const before = JSON.stringify(match.p2);
    for (let i = 0; i < 200; i += 1) botIntent(match.p1, 'hard', state, STEP, rng, out);
    expect(JSON.stringify(match.p2)).toBe(before);
  });

  it('never changes the yard it is reading', () => {
    const { match, rng } = started();
    toCrane(match, match.p1, rng);
    const state = createBotState();
    const out = createIntent();
    const before = JSON.stringify(match.p1);
    for (let i = 0; i < 60; i += 1) botIntent(match.p1, 'normal', state, STEP, rng, out);
    expect(JSON.stringify(match.p1)).toBe(before);
  });

  it('turns the animal before it starts walking it, never both at once', () => {
    // A thumb has to come off the glass to tap, so a bot that turned mid-drag would be using
    // a gesture no player has.
    let turns = 0;
    const state = createBotState();
    const out = createIntent();
    for (let seed = 1; seed <= 80; seed += 1) {
      const { match, rng } = started(seed * 271 + 13);
      resetBotState(state);
      toCrane(match, match.p1, rng);
      for (let i = 0; i < 30; i += 1) {
        botIntent(match.p1, 'hard', state, STEP, rng, out);
        if (!out.turn) continue;
        turns += 1;
        expect(out.aimActive).toBe(false);
        expect(out.drop).toBe(false);
        match.p1.held.facing = -match.p1.held.facing;
      }
    }
    expect(turns).toBeGreaterThan(20);
  });

  it('stops asking for anything while it is blundering', () => {
    const { match, rng } = started();
    toCrane(match, match.p1, rng);
    const state = createBotState();
    const out = createIntent();
    botIntent(match.p1, 'easy', state, STEP, rng, out);
    state.frozen = BLUNDER_SECONDS;
    botIntent(match.p1, 'easy', state, STEP, rng, out);
    expect(out.drop).toBe(false);
    expect(out.aimActive).toBe(false);
    expect(state.frozen).toBeLessThan(BLUNDER_SECONDS);
  });

  it('lets go before the crane does, so it is never dropped from wherever', () => {
    const { match, rng } = started(4);
    toCrane(match, match.p1, rng);
    const state = createBotState();
    const out = createIntent();
    let dropped = false;
    for (let i = 0; i < 8 && !dropped; i += 1) {
      match.p1.carry = match.p1.limit - STEP;
      botIntent(match.p1, 'easy', state, STEP, rng, out);
      if (out.turn) match.p1.held.facing = -match.p1.held.facing;
      dropped = out.drop;
    }
    expect(dropped).toBe(true);
  });

  it('looks on a wandering interval rather than a metronome', () => {
    const { match, rng } = started(55);
    toCrane(match, match.p1, rng);
    const state = createBotState();
    const out = createIntent();
    const seen = new Set<string>();
    let previous = 0;
    for (let i = 0; i < 900; i += 1) {
      botIntent(match.p1, 'normal', state, STEP, rng, out);
      // Only the value a fresh look was just set to; every other reading is that same
      // interval part way through counting down.
      if (state.look > previous) seen.add(state.look.toFixed(9));
      previous = state.look;
      if (match.p1.stance !== 'carrying') {
        match.p1.stance = 'carrying';
        match.p1.carry = 0;
      }
    }
    expect(seen.size).toBeGreaterThan(3);
    for (const value of seen) {
      const look = Number(value);
      expect(look).toBeLessThanOrEqual(BOT_PROFILES.normal.reaction * (1 + LOOK_JITTER) + 1e-9);
      expect(look).toBeGreaterThanOrEqual(BOT_PROFILES.normal.reaction * (1 - LOOK_JITTER) - 1e-9);
    }
  });

  it('is forgotten completely when it is reset', () => {
    const state = createBotState();
    state.look = 3;
    state.bias = 9;
    state.armed = true;
    state.frozen = 2;
    state.target = 40;
    state.facing = -1;
    state.chosen = true;
    resetBotState(state);
    expect(state).toEqual(createBotState());
  });
});

describe('the difficulty tiers', () => {
  it('stack more animals the stronger they are', () => {
    const stacked = (tier: BotDifficulty): number => {
      let animals = 0;
      for (let seed = 1; seed <= 30; seed += 1) {
        const { match } = botMatch(tier, tier, seed * 601 + 11);
        animals += match.p1.dealt + match.p2.dealt;
      }
      return animals / 60;
    };
    const easy = stacked('easy');
    const normal = stacked('normal');
    const hard = stacked('hard');
    expect(easy).toBeLessThan(normal);
    expect(normal).toBeLessThan(hard);
  });

  it('beats a weaker tier over a run of seeded matches', () => {
    // The ladder, measured rather than asserted from the profile numbers. SPEC.md records
    // the same figures at many more seeds.
    const hardOverEasy = ladder('hard', 'easy', 30);
    expect(hardOverEasy.p1).toBeGreaterThan(hardOverEasy.p2);
    expect(hardOverEasy.open).toBe(0);

    const normalOverEasy = ladder('normal', 'easy', 30);
    expect(normalOverEasy.p1).toBeGreaterThan(normalOverEasy.p2);

    const hardOverNormal = ladder('hard', 'normal', 30);
    expect(hardOverNormal.p1).toBeGreaterThan(hardOverNormal.p2);
  });

  it('is beaten just as soundly from the other seat', () => {
    const easyUnderHard = ladder('easy', 'hard', 30);
    expect(easyUnderHard.p2).toBeGreaterThan(easyUnderHard.p1);
    expect(easyUnderHard.open).toBe(0);
  });

  it('is even against itself, from either seat', () => {
    const level = ladder('normal', 'normal', 60, 1013);
    expect(level.open).toBe(0);
    expect(Math.abs(level.p1 - level.p2)).toBeLessThanOrEqual(24);
  });
});

/* ================================================================== *
 * The mechanic itself
 * ================================================================== */

describe('animals actually stack, and actually fall off', () => {
  /**
   * The check the whole game rests on, and it is deliberately **not** read off a counter.
   *
   * Every animal a seat is dealt either ends up standing on its platform or it went over
   * the side, so `dealt - count` is how many left — two pieces of bookkeeping that know
   * nothing about falling, rather than a `falls` field that could be wrong in the same way
   * the rule is. A game that reported a winner in every match while nothing ever fell would
   * pass every global guard there is; this is what says it does not.
   */
  it('drops animals off the platform in nearly every seeded match', () => {
    let withFall = 0;
    let matches = 0;
    let off = 0;
    for (const a of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      for (const b of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
        const run = ladder(a, b, 20);
        withFall += run.withFall;
        off += run.off;
        matches += 20;
      }
    }
    expect(matches).toBe(180);
    expect(withFall / matches).toBeGreaterThan(0.9);
    expect(off / matches).toBeGreaterThan(1.5);
  });

  it('builds real towers before it knocks them down', () => {
    let peak = 0;
    let matches = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const { match } = botMatch('normal', 'hard', seed * 353 + 9);
      peak += match.p1.dealt + match.p2.dealt;
      matches += 1;
    }
    expect(peak / matches).toBeGreaterThan(12);
  });

  it('drops one off when a player does nothing at all, from the second animal', () => {
    const { match } = play(21, idle, idle);
    expect(match.p1.dealt).toBeGreaterThanOrEqual(2);
    expect(match.p1.dealt - match.p1.count).toBeGreaterThan(0);
    expect(match.p2.dealt - match.p2.count).toBeGreaterThan(0);
  });

  it('never leaves a tower standing that the statics say should have gone', () => {
    // Checked every step of every match against the longhand restatement, which is the one
    // place a bookkeeping mistake would show up as a tower that cannot exist.
    for (let seed = 1; seed <= 12; seed += 1) {
      const { match, rng } = started(seed * 89 + 1);
      const sa = createBotState();
      const sb = createBotState();
      const ia = createIntent();
      const ib = createIntent();
      for (let i = 0; i < GUARD_STEPS && match.winner === null; i += 1) {
        botIntent(match.p1, 'normal', sa, STEP, rng, ia);
        botIntent(match.p2, 'easy', sb, STEP, rng, ib);
        step(match, ia, ib, STEP, rng);
        expect(independentBreak(match.p1)).toBe(-1);
        expect(independentBreak(match.p2)).toBe(-1);
      }
      expect(match.winner).not.toBeNull();
    }
  });

  it('leaves the whole budget reachable, so the animals are not decoration', () => {
    // Rarely, but it happens: a player who weighs every placement does sometimes get all
    // eighteen animals down. If this were zero the budget would be a fiction and the game
    // would have exactly one way to end.
    let survived = 0;
    let animals = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const { match } = play(seed * 47 + 5, careful, careful);
      if (match.p1.stance === 'safe') survived += 1;
      animals += match.p1.dealt;
    }
    expect(survived).toBeGreaterThan(0);
    expect(animals / 30).toBeGreaterThan(10);
  });

  it('gets a careful player a great deal further than a sloppy one', () => {
    const reach = (policy: Policy): number => {
      let animals = 0;
      for (let seed = 1; seed <= 30; seed += 1) {
        animals += play(seed * 47 + 5, policy, policy).match.p1.dealt;
      }
      return animals / 30;
    };
    const good = reach(careful);
    const bad = reach(wide);
    expect(good).toBeGreaterThan(bad * 1.5);
    expect(bad).toBeLessThan(8);
  });
});
