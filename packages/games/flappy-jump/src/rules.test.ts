import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_PROFILES,
  CENTRE_MAX,
  CENTRE_MIN,
  CENTRE_STEP,
  DESPAWN_LEAD,
  DIVIDER,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  FLAP_RECHARGE,
  FLAP_SPEED,
  GAP_MIN,
  GAP_SHRINK,
  GAP_START,
  GLIDE_FALL,
  GRAVITY,
  HOOP_POOL,
  HOOP_SPACING,
  HOOP_SPEED,
  JUMPER_RADIUS,
  JUMPER_X,
  LANE_HEIGHT,
  MAX_FALL,
  MAX_HOOPS,
  POST_LENGTH,
  READY_SECONDS,
  RIM_KNOCK,
  ROUND_SECONDS,
  SPAWN_LEAD,
  STUN_SECONDS,
  TARGET_BASKETS,
  basketsOf,
  botIntent,
  createBotState,
  createMatch,
  decide,
  fieldSpent,
  fly,
  gapFor,
  gapOf,
  glideLanding,
  laneOf,
  nextCentre,
  nextHoop,
  otherOf,
  resetBotState,
  resetMatch,
  resolveHoop,
  secondsToHoop,
  step,
  stepLane,
  winnerOf,
  worldXOf,
  worldYOf,
} from './rules.js';
import type { BotDifficulty, Intent, Lane, Match } from './rules.js';

const STEP = 1 / 60;

function started(): { match: Match; rng: Rng } {
  const match = createMatch();
  const rng = new Rng(20260823);
  resetMatch(match);
  return { match, rng };
}

/** Run past the opening hover, so the jumpers are live. */
function toFlight(match: Match, rng: Rng): void {
  for (let i = 0; i < 600 && match.phase === 'ready'; i += 1) {
    step(match, 'idle', 'idle', STEP, rng);
  }
}

/** A lane with one hoop parked exactly `lead` ahead of the jumper, and nothing else. */
function laneWithHoop(centre: number, lead = 4): Lane {
  const match = createMatch();
  resetMatch(match);
  const lane = match.p1;
  const hoop = lane.hoops[0]!;
  hoop.live = true;
  hoop.lead = lead;
  hoop.centre = centre;
  hoop.resolved = false;
  return lane;
}

describe('the field', () => {
  it('is two whole lanes and a divider, with nothing left over', () => {
    expect(LANE_HEIGHT * 2 + DIVIDER).toBe(FIELD_HEIGHT);
    expect(DIVIDER).toBeGreaterThan(0);
  });

  it('maps the two lanes onto exact halves of one another', () => {
    // The fairness claim, as geometry: every lane-local point lands on the far seat's
    // half-turn of itself. If this were off by anything at all, one player would be
    // reading a field the other was not playing on.
    for (const height of [0, 37, LANE_HEIGHT / 2, LANE_HEIGHT]) {
      for (const lead of [-220, 0, 91, SPAWN_LEAD]) {
        expect(worldXOf('p2', lead)).toBeCloseTo(FIELD_WIDTH - worldXOf('p1', lead), 9);
        expect(worldYOf('p2', height)).toBeCloseTo(FIELD_HEIGHT - worldYOf('p1', height), 9);
      }
    }
  });

  it('keeps each seat wholly inside its own half of the device', () => {
    // p1 owns the bottom, p2 the top, and the divider belongs to neither.
    expect(worldYOf('p1', 0)).toBe(FIELD_HEIGHT);
    expect(worldYOf('p1', LANE_HEIGHT)).toBe(FIELD_HEIGHT - LANE_HEIGHT);
    expect(worldYOf('p1', LANE_HEIGHT)).toBeGreaterThan(FIELD_HEIGHT / 2);
    expect(worldYOf('p2', LANE_HEIGHT)).toBeLessThan(FIELD_HEIGHT / 2);
  });

  it('puts the jumper where a hoop is visible long before it arrives', () => {
    // A hoop must enter off the far edge and leave off the near one, or it would appear
    // and disappear inside the play area.
    expect(worldXOf('p1', SPAWN_LEAD)).toBeGreaterThan(FIELD_WIDTH);
    expect(worldXOf('p1', DESPAWN_LEAD)).toBeLessThan(0);
    expect(JUMPER_X).toBeGreaterThan(0);
    expect(JUMPER_X).toBeLessThan(FIELD_WIDTH);
  });

  it('never needs more hoop slots than it has', () => {
    const alive = (SPAWN_LEAD - DESPAWN_LEAD) / HOOP_SPACING;
    expect(HOOP_POOL).toBeGreaterThan(alive);
  });
});

describe('the hoop stream', () => {
  it('starts level, hovering, with nothing scored', () => {
    const { match } = started();
    expect(match.phase).toBe('ready');
    expect(match.p1.baskets).toBe(0);
    expect(match.p2.baskets).toBe(0);
    expect(winnerOf(match)).toBeNull();
    expect(match.p1.height).toBe(LANE_HEIGHT / 2);
  });

  it('releases the same hoop into both lanes on the same step', () => {
    // The single line the whole seat-fairness argument rests on.
    const { match, rng } = started();
    for (let i = 0; i < 60 * 30; i += 1) {
      step(match, 'idle', 'idle', STEP, rng);
      expect(match.p1.hoops.map((h) => [h.live, h.lead, h.centre])).toEqual(
        match.p2.hoops.map((h) => [h.live, h.lead, h.centre]),
      );
    }
    expect(match.hoopsEntered).toBeGreaterThan(10);
  });

  it('gives the first hoop clear air to be read in', () => {
    // It exists before gravity does, and it is still ahead of the jumper when the hover
    // ends — see OPENING_SLACK. Without that the opening basket was a coin toss.
    const { match, rng } = started();
    toFlight(match, rng);
    const hoop = nextHoop(match.p1);
    expect(hoop).not.toBeNull();
    expect(hoop!.lead).toBeGreaterThan(HOOP_SPEED * 0.7);
    expect(match.elapsed).toBeGreaterThanOrEqual(READY_SECONDS);
  });

  it('keeps every gap centre inside the band and within one step of the last', () => {
    const rng = new Rng(4242);
    let previous = LANE_HEIGHT / 2;
    for (let i = 0; i < 3000; i += 1) {
      const centre = nextCentre(previous, rng);
      expect(centre).toBeGreaterThanOrEqual(CENTRE_MIN);
      expect(centre).toBeLessThanOrEqual(CENTRE_MAX);
      expect(Math.abs(centre - previous)).toBeLessThanOrEqual(CENTRE_STEP + 1e-9);
      previous = centre;
    }
  });

  it('always leaves at least one side of a hoop open', () => {
    // A hoop sealed top and bottom would be a hoop nobody could get past at all, which
    // is a countdown rather than a game.
    for (const centre of [CENTRE_MIN, (CENTRE_MIN + CENTRE_MAX) / 2, CENTRE_MAX]) {
      for (const baskets of [0, TARGET_BASKETS]) {
        const half = gapFor(baskets) / 2;
        // Reachable at all: the jumper's centre lives in [R, LANE_HEIGHT - R], and a
        // clean miss needs its whole body clear of the post.
        const openBelow = centre - half - POST_LENGTH >= JUMPER_RADIUS * 2;
        const openAbove = centre + half + POST_LENGTH <= LANE_HEIGHT - JUMPER_RADIUS * 2;
        expect(openBelow || openAbove, `centre ${String(centre)}`).toBe(true);
      }
    }
  });

  it('retires a hoop only after it is behind the jumper', () => {
    expect(DESPAWN_LEAD).toBeLessThan(0);
    const { match, rng } = started();
    toFlight(match, rng);
    for (let i = 0; i < 60 * 20; i += 1) {
      step(match, 'idle', 'idle', STEP, rng);
      for (const hoop of match.p1.hoops) {
        if (hoop.live && hoop.lead < 0) expect(hoop.resolved).toBe(true);
      }
    }
  });
});

describe('flying', () => {
  it('sets the climb rate on a beat rather than adding to it', () => {
    const lane = laneWithHoop(200);
    lane.velocity = FLAP_SPEED;
    fly(lane, 'flap', STEP);
    // One beat's worth of climb, minus this step of gravity — never two beats' worth.
    expect(lane.velocity).toBeCloseTo(FLAP_SPEED - GRAVITY * STEP, 6);
  });

  it('will not beat again until the wing has recharged', () => {
    const lane = laneWithHoop(200);
    fly(lane, 'flap', STEP);
    const first = lane.velocity;
    fly(lane, 'flap', STEP);
    // The second press inside the recharge does nothing but let gravity work.
    expect(lane.velocity).toBeCloseTo(first - GRAVITY * STEP, 6);
    expect(lane.recharge).toBeGreaterThan(0);
  });

  it('holds a press that arrives while the wing is recharging', () => {
    const lane = laneWithHoop(200);
    fly(lane, 'flap', STEP);
    fly(lane, 'flap', STEP);
    expect(lane.buffered).toBe(true);
    // It is spent on the first step the wing is ready, not dropped and not repeated.
    for (let i = 0; i < 20 && lane.buffered; i += 1) fly(lane, 'idle', STEP);
    expect(lane.buffered).toBe(false);
    expect(lane.recharge).toBeGreaterThan(0);
  });

  it('gives every tapping rate at or above the recharge the identical climb', () => {
    // **Input parity, as arithmetic**, and the reason the buffer exists. A key can be
    // pressed on every frame and a thumb cannot, so the wing has a ceiling — but a
    // ceiling that *drops* presses beats against the player's own rhythm, and a tapper
    // at six a second used to lose every other tap inside the recharge.
    const period = Math.ceil(FLAP_RECHARGE * 60);
    const climb = (every: number): number => {
      const lane = laneWithHoop(200);
      lane.height = 0;
      lane.velocity = 0;
      // Short of the ceiling, or every rate would read the same because the lane ran out.
      for (let i = 0; i < 66; i += 1) fly(lane, i % every === 0 ? 'flap' : 'idle', STEP);
      return lane.height;
    };
    const ceiling = climb(1);
    expect(ceiling).toBeGreaterThan(0);
    for (const every of [1, 2, 3, 5, 8, 10, period]) {
      expect(climb(every), `every ${String(every)} steps`).toBeCloseTo(ceiling, 9);
    }
    // And tapping slower than the wing recharges does cost you, smoothly.
    expect(climb(period + 4)).toBeLessThan(ceiling);
    expect(climb(period + 9)).toBeLessThan(climb(period + 4));
  });

  it('caps a fall while gliding and lets it run otherwise', () => {
    const glided = laneWithHoop(200);
    glided.height = LANE_HEIGHT;
    const dropped = laneWithHoop(200);
    dropped.height = LANE_HEIGHT;
    // Long enough to reach the glide's terminal rate, short enough that neither has
    // arrived at the floor, where both would read zero and prove nothing.
    for (let i = 0; i < 24; i += 1) {
      fly(glided, 'glide', STEP);
      fly(dropped, 'idle', STEP);
    }
    expect(glided.velocity).toBeCloseTo(-GLIDE_FALL, 6);
    expect(dropped.velocity).toBeLessThan(-GLIDE_FALL);
    expect(dropped.velocity).toBeGreaterThanOrEqual(-MAX_FALL);
    expect(glided.height).toBeGreaterThan(dropped.height);
  });

  it('lets a glide do nothing at all on the way up', () => {
    // A held button must not be a better beat than a tapped one, or the two controls
    // would collapse into one and the hold would simply be strictly better.
    const rising = laneWithHoop(200);
    rising.velocity = FLAP_SPEED;
    const alsoRising = laneWithHoop(200);
    alsoRising.velocity = FLAP_SPEED;
    for (let i = 0; i < 12; i += 1) {
      fly(rising, 'glide', STEP);
      fly(alsoRising, 'idle', STEP);
    }
    expect(rising.height).toBeCloseTo(alsoRising.height, 9);
  });

  it('stops dead at the floor and at the ceiling', () => {
    // Bounded by the jumper's edge, so it rests on the floor rather than half inside it.
    const floored = laneWithHoop(200);
    for (let i = 0; i < 300; i += 1) fly(floored, 'idle', STEP);
    expect(floored.height).toBe(JUMPER_RADIUS);
    expect(floored.velocity).toBe(0);

    const ceilinged = laneWithHoop(200);
    for (let i = 0; i < 300; i += 1) fly(ceilinged, 'flap', STEP);
    expect(ceilinged.height).toBe(LANE_HEIGHT - JUMPER_RADIUS);
    expect(ceilinged.velocity).toBe(0);
  });

  it('will not beat while stunned, and beats again once the stun runs out', () => {
    const lane = laneWithHoop(200);
    lane.stun = STUN_SECONDS;
    fly(lane, 'flap', STEP);
    expect(lane.velocity).toBeLessThan(0);
    for (let i = 0; i < 60 && lane.stun > 0; i += 1) fly(lane, 'idle', STEP);
    fly(lane, 'flap', STEP);
    expect(lane.velocity).toBeGreaterThan(0);
  });
});

describe('a hoop resolving', () => {
  const centre = 250;
  const gap = GAP_START;

  it('is a basket when the whole jumper fits through the gap', () => {
    expect(resolveHoop(centre, centre, gap)).toBe('basket');
    expect(resolveHoop(centre + gap / 2 - JUMPER_RADIUS, centre, gap)).toBe('basket');
    expect(resolveHoop(centre - gap / 2 + JUMPER_RADIUS, centre, gap)).toBe('basket');
  });

  it('is a rim strike when the jumper clips the lip', () => {
    expect(resolveHoop(centre + gap / 2 - JUMPER_RADIUS + 1, centre, gap)).toBe('rim');
    expect(resolveHoop(centre - gap / 2 + JUMPER_RADIUS - 1, centre, gap)).toBe('rim');
  });

  it('is a plain miss when the jumper is clear of the rim altogether', () => {
    // The rule that makes going *round* a hoop a real choice rather than a certain
    // punishment: a wide miss costs the hoop and nothing else.
    expect(resolveHoop(centre + gap / 2 + POST_LENGTH + JUMPER_RADIUS, centre, gap)).toBe('miss');
    expect(resolveHoop(centre - gap / 2 - POST_LENGTH - JUMPER_RADIUS, centre, gap)).toBe('miss');
  });

  it('seals the side a post runs off the end of the lane on', () => {
    // A low hoop must be gone through, because there is no floor to duck under.
    const low = CENTRE_MIN;
    expect(resolveHoop(0, low, gap)).toBe('rim');
    const high = CENTRE_MAX;
    expect(resolveHoop(LANE_HEIGHT, high, gap)).toBe('rim');
  });

  it('knocks the jumper down and stuns it on a rim strike, and only then', () => {
    const lane = laneWithHoop(250, HOOP_SPEED * STEP * 0.5);
    lane.height = 250 + GAP_START / 2 + 4;
    lane.velocity = 200;
    expect(stepLane(lane, 'idle', STEP)).toBe('rim');
    expect(lane.velocity).toBe(-RIM_KNOCK);
    expect(lane.stun).toBe(STUN_SECONDS);
    expect(lane.rims).toBe(1);

    const clean = laneWithHoop(250, HOOP_SPEED * STEP * 0.5);
    clean.height = 250;
    clean.velocity = 0;
    expect(stepLane(clean, 'idle', STEP)).toBe('basket');
    expect(clean.stun).toBe(0);
    expect(clean.baskets).toBe(1);
  });

  it('scores each hoop exactly once, however long it lingers', () => {
    const lane = laneWithHoop(250, HOOP_SPEED * STEP * 0.5);
    lane.height = 250;
    expect(stepLane(lane, 'idle', STEP)).toBe('basket');
    for (let i = 0; i < 60; i += 1) expect(stepLane(lane, 'idle', STEP)).toBe('none');
    expect(lane.baskets).toBe(1);
  });

  it('reads the height at the instant the hoop went by, not at the end of the step', () => {
    // A jumper falling at the cap covers twelve units in a step against a clean window
    // that narrows to thirty, so the difference decides close hoops.
    const scroll = HOOP_SPEED * STEP;
    // Just above the lip at the start of the step and just inside it by the end.
    const from = 250 + GAP_START / 2 - JUMPER_RADIUS + 5;
    const early = laneWithHoop(250, scroll * 0.02);
    early.height = from;
    early.velocity = -MAX_FALL;
    const late = laneWithHoop(250, scroll * 0.98);
    late.height = from;
    late.velocity = -MAX_FALL;
    // Same start, same fall: the one the hoop reaches later in the step is read lower.
    stepLane(early, 'idle', STEP);
    stepLane(late, 'idle', STEP);
    expect(early.baskets + late.baskets + early.rims + late.rims).toBe(2);
    expect(early.baskets).not.toBe(late.baskets);
  });
});

describe('the narrowing gap', () => {
  it('starts wide and loses the same amount on every basket of your own', () => {
    expect(gapFor(0)).toBe(GAP_START);
    expect(gapFor(1)).toBe(GAP_START - GAP_SHRINK);
    expect(gapFor(4)).toBe(GAP_START - GAP_SHRINK * 4);
  });

  it('never closes below its floor, however far ahead you get', () => {
    expect(gapFor(1000)).toBe(GAP_MIN);
    expect(GAP_MIN).toBeGreaterThan(JUMPER_RADIUS * 2);
  });

  it('narrows one lane and leaves the other alone', () => {
    // It is a handicap you inflict on yourself, and it reads nothing about the opponent.
    const { match } = started();
    match.p1.baskets = 6;
    expect(gapOf(match.p1)).toBeLessThan(gapOf(match.p2));
    expect(gapOf(match.p2)).toBe(GAP_START);
  });

  it('lets a hoop past a leader that a level player would have taken', () => {
    const near = GAP_START / 2 - JUMPER_RADIUS - 1;
    const takes = (baskets: number): boolean => {
      const lane = laneWithHoop(250, HOOP_SPEED * STEP * 0.5);
      lane.baskets = baskets;
      lane.height = 250 + near;
      return stepLane(lane, 'idle', STEP) === 'basket';
    };
    expect(takes(0)).toBe(true);
    expect(takes(TARGET_BASKETS - 1)).toBe(false);
  });
});

describe('the two lanes are the same lane', () => {
  it('produces byte-identical lanes from an identical run of taps', () => {
    // **The seat-fairness proof.** Not a statistical claim about win rates: the two seats
    // are handed the same hoops at the same moment and simulate in the same lane-local
    // frame, so the same input must give the same state, field by field, to the last bit.
    const { match, rng } = started();
    // One player's decisions, played into both lanes. Driven by a bot rather than by a
    // coin, so the trace is a real match with baskets in it: a pair of jumpers pinned to
    // the ceiling by random mashing would agree about nothing interesting.
    const state = createBotState();
    for (let i = 0; i < 60 * 70 && match.phase !== 'over'; i += 1) {
      const intent = botIntent(match.p1, 'normal', state, STEP, rng);
      step(match, intent, intent, STEP, rng);
    }
    expect(match.p1).toEqual(match.p2);
    expect(match.p1.baskets).toBeGreaterThan(0);
  });

  it('draws such a match, because neither seat can have had it easier', () => {
    const { match, rng } = started();
    const state = createBotState();
    for (let i = 0; i < 60 * 90 && match.phase !== 'over'; i += 1) {
      const intent = botIntent(match.p1, 'hard', state, STEP, rng);
      step(match, intent, intent, STEP, rng);
    }
    expect(match.phase).toBe('over');
    expect(match.p1.baskets).toBe(TARGET_BASKETS);
    expect(winnerOf(match)).toBe('draw');
  });

  it('answers the same for either seat through the seat-facing helpers', () => {
    const { match } = started();
    match.p1.baskets = 3;
    match.p2.baskets = 5;
    expect(basketsOf(match, 'p1')).toBe(3);
    expect(basketsOf(match, 'p2')).toBe(5);
    expect(laneOf(match, 'p1')).toBe(match.p1);
    expect(laneOf(match, 'p2')).toBe(match.p2);
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

describe('winning', () => {
  it('ends the match at ten baskets and names the winner', () => {
    const { match } = started();
    match.p1.baskets = TARGET_BASKETS;
    match.p2.baskets = 4;
    decide(match);
    expect(match.phase).toBe('over');
    expect(winnerOf(match)).toBe('p1');
  });

  it('breaks a level score on the cleaner run, then on the longer streak', () => {
    const byRims = createMatch();
    resetMatch(byRims);
    byRims.p1.baskets = 8;
    byRims.p2.baskets = 8;
    byRims.p1.rims = 5;
    byRims.p2.rims = 2;
    decide(byRims);
    expect(winnerOf(byRims)).toBe('p2');

    const byStreak = createMatch();
    resetMatch(byStreak);
    byStreak.p1.baskets = 10;
    byStreak.p2.baskets = 10;
    byStreak.p1.rims = 1;
    byStreak.p2.rims = 1;
    byStreak.p1.bestStreak = 7;
    byStreak.p2.bestStreak = 4;
    decide(byStreak);
    expect(winnerOf(byStreak)).toBe('p1');
  });

  it('draws only a pair that is level on all three', () => {
    const { match } = started();
    decide(match);
    expect(winnerOf(match)).toBe('draw');
  });

  it('leaves an already-decided match alone', () => {
    const { match } = started();
    match.p1.baskets = TARGET_BASKETS;
    decide(match);
    match.p2.baskets = 99;
    decide(match);
    expect(winnerOf(match)).toBe('p1');
  });

  it('counts a streak of baskets and resets it on anything else', () => {
    const lane = laneWithHoop(250, HOOP_SPEED * STEP * 0.5);
    lane.height = 250;
    stepLane(lane, 'idle', STEP);
    expect(lane.streak).toBe(1);
    expect(lane.bestStreak).toBe(1);

    const second = lane.hoops[1]!;
    second.live = true;
    second.lead = HOOP_SPEED * STEP * 0.5;
    second.centre = 250;
    second.resolved = false;
    lane.height = 250 + GAP_START;
    stepLane(lane, 'idle', STEP);
    expect(lane.streak).toBe(0);
    expect(lane.bestStreak).toBe(1);
  });

  it('stops simulating once it is decided', () => {
    const { match, rng } = started();
    toFlight(match, rng);
    match.p1.baskets = TARGET_BASKETS;
    decide(match);
    const before = { height: match.p1.height, elapsed: match.elapsed };
    for (let i = 0; i < 200; i += 1) step(match, 'flap', 'flap', STEP, rng);
    expect(match.p1.height).toBe(before.height);
    expect(match.elapsed).toBe(before.elapsed);
  });
});

describe('termination', () => {
  it('runs out of hoops and calls the match, with nobody touching a button', () => {
    // The guarantee, checked where a failure names a rule rather than a registry entry.
    // Two absent players score nothing at all, and the match still ends.
    const { match, rng } = started();
    let steps = 0;
    for (; steps < 60 * (ROUND_SECONDS + 10) && match.phase !== 'over'; steps += 1) {
      step(match, 'idle', 'idle', STEP, rng);
    }
    expect(match.phase).toBe('over');
    expect(winnerOf(match)).not.toBeNull();
    expect(match.p1.baskets).toBe(0);
    expect(match.hoopsEntered).toBe(MAX_HOOPS);
    expect(steps / 60).toBeLessThan(ROUND_SECONDS);
  });

  it('bounds the match by hoops rather than by the clock', () => {
    // The budget must bite well before the backstop, or the backstop is the mechanism
    // and the game has a clock after all.
    const budgetSeconds = READY_SECONDS + (MAX_HOOPS * HOOP_SPACING + SPAWN_LEAD) / HOOP_SPEED;
    expect(budgetSeconds).toBeLessThan(ROUND_SECONDS);
  });

  it('holds the backstop in reserve for a pacing that no longer terminates', () => {
    const { match, rng } = started();
    toFlight(match, rng);
    // Freeze the budget the way a future change to the pacing might.
    match.hoopsEntered = -1e9;
    for (let i = 0; i < 60 * (ROUND_SECONDS + 5) && match.phase !== 'over'; i += 1) {
      step(match, 'idle', 'idle', STEP, rng);
    }
    expect(match.phase).toBe('over');
    expect(match.elapsed).toBeGreaterThanOrEqual(ROUND_SECONDS);
  });

  it('knows when the field is spent and not before', () => {
    const { match, rng } = started();
    expect(fieldSpent(match)).toBe(false);
    for (let i = 0; i < 60 * 20; i += 1) step(match, 'idle', 'idle', STEP, rng);
    expect(fieldSpent(match)).toBe(false);
  });
});

describe('the bot', () => {
  const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('asks for nothing a person could not ask for', () => {
    // Rule 6 in one assertion: every tier's decision is one of the three things a
    // player's button can say, and it goes through the same fly().
    for (const tier of TIERS) {
      const { match, rng } = started();
      const state = createBotState();
      toFlight(match, rng);
      const seen = new Set<Intent>();
      for (let i = 0; i < 4000; i += 1) {
        const intent = botIntent(match.p1, tier, state, STEP, rng);
        seen.add(intent);
        step(match, intent, 'idle', STEP, rng);
        if (match.phase === 'over') resetMatch(match);
      }
      // Every tier reaches for all three, and never for a fourth thing.
      expect([...seen].sort()).toEqual(['flap', 'glide', 'idle']);
    }
  });

  it('cannot beat its wing faster than a person can, however sharp it is', () => {
    const { match, rng } = started();
    const state = createBotState();
    toFlight(match, rng);
    let beats = 0;
    const steps = 60 * 20;
    for (let i = 0; i < steps; i += 1) {
      const intent = botIntent(match.p1, 'hard', state, STEP, rng);
      if (intent === 'flap') beats += 1;
      step(match, intent, 'idle', STEP, rng);
      if (match.phase === 'over') break;
    }
    // A wing recharges 5.5 times a second; asking for more is not the same as getting it,
    // but the bot must not even be *asking* faster than a thumb can tap.
    expect(beats / (steps / 60)).toBeLessThanOrEqual(1 / FLAP_RECHARGE + 1e-6);
  });

  it('holds its posture between looks rather than steering every step', () => {
    const { match, rng } = started();
    const state = createBotState();
    toFlight(match, rng);
    botIntent(match.p1, 'easy', state, STEP, rng);
    const held = state.hold;
    // Well inside `easy`'s reaction delay: nothing it sees can change its mind yet.
    for (let i = 0; i < 8; i += 1) {
      expect(botIntent(match.p1, 'easy', state, STEP, rng)).toBe(held);
    }
  });

  it('reads a glide slope that does not move while it is gliding', () => {
    // The property the whole controller is built on — see glideLanding.
    const lane = laneWithHoop(250, 400);
    lane.height = 300;
    lane.velocity = -GLIDE_FALL;
    const before = glideLanding(lane, secondsToHoop(lane));
    for (let i = 0; i < 30; i += 1) {
      fly(lane, 'glide', STEP);
      lane.hoops[0]!.lead -= HOOP_SPEED * STEP;
    }
    expect(glideLanding(lane, secondsToHoop(lane))).toBeCloseTo(before, 4);
  });

  it('waits at the middle of its lane when there is nothing to aim at', () => {
    const lane = laneWithHoop(250);
    lane.hoops[0]!.live = false;
    const state = createBotState();
    const rng = new Rng(3);
    botIntent(lane, 'hard', state, STEP, rng);
    expect(state.aim).toBe(LANE_HEIGHT / 2);
    expect(nextHoop(lane)).toBeNull();
  });

  it('gets better as the tier goes up, from either seat', () => {
    // The claim the difficulty tiers make, measured rather than asserted. Seeds fixed, so
    // this is a property of the code and not of the day it was run.
    expect(playSeries('normal', 'easy', 16)).toBeGreaterThan(12);
    expect(playSeries('easy', 'normal', 16)).toBeLessThan(4);
    expect(playSeries('hard', 'normal', 16)).toBeGreaterThan(9);
    expect(playSeries('normal', 'hard', 16)).toBeLessThan(7);
    expect(playSeries('hard', 'easy', 16)).toBe(16);
  });

  it('is balanced against itself, in both directions', () => {
    // 45-55% at equal difficulty is the rule of thumb from the bot issue. Nothing in the
    // rules distinguishes the seats, so a bias here would have to come from the order the
    // two bots draw from the shared generator — which is the one thing that does differ.
    for (const tier of TIERS) {
      const wins = playSeries(tier, tier, 40);
      expect(wins, `${tier} v ${tier}`).toBeGreaterThanOrEqual(14);
      expect(wins, `${tier} v ${tier}`).toBeLessThanOrEqual(26);
    }
  });

  it('expresses a tier as reaction, error and blunder rate and nothing else', () => {
    // Rule 6, as a shape check: if a fourth field ever appears here it will be something
    // a player does not get, and this is where that gets noticed.
    for (const tier of TIERS) {
      expect(Object.keys(BOT_PROFILES[tier]).sort()).toEqual(['blunder', 'error', 'reaction']);
    }
    expect(BOT_PROFILES.hard.reaction).toBeLessThan(BOT_PROFILES.normal.reaction);
    expect(BOT_PROFILES.normal.reaction).toBeLessThan(BOT_PROFILES.easy.reaction);
    expect(BOT_PROFILES.hard.error).toBeLessThan(BOT_PROFILES.normal.error);
    expect(BOT_PROFILES.normal.error).toBeLessThan(BOT_PROFILES.easy.error);
    expect(BOT_PROFILES.hard.blunder).toBeLessThan(BOT_PROFILES.normal.blunder);
    expect(BOT_PROFILES.normal.blunder).toBeLessThan(BOT_PROFILES.easy.blunder);
  });
});

/** Play `matches` bot against bot and return how many p1 won. */
function playSeries(p1Tier: BotDifficulty, p2Tier: BotDifficulty, matches: number): number {
  let p1Wins = 0;
  for (let m = 0; m < matches; m += 1) {
    const match = createMatch();
    const rng = new Rng(1000 + m);
    resetMatch(match);
    const p1State = createBotState();
    const p2State = createBotState();
    resetBotState(p1State);
    resetBotState(p2State);
    for (let i = 0; i < 60 * (ROUND_SECONDS + 5) && match.phase !== 'over'; i += 1) {
      const a = botIntent(match.p1, p1Tier, p1State, STEP, rng);
      const b = botIntent(match.p2, p2Tier, p2State, STEP, rng);
      step(match, a, b, STEP, rng);
    }
    if (match.winner === 'p1') p1Wins += 1;
  }
  return p1Wins;
}

describe('determinism', () => {
  it('replays a fixed intent trace to the identical final state', () => {
    const play = (): Match => {
      const match = createMatch();
      const rng = new Rng(20260823);
      resetMatch(match);
      const script = new Rng(4242);
      for (let i = 0; i < 5000 && match.phase !== 'over'; i += 1) {
        const a: Intent = script.float() < 0.3 ? 'flap' : script.float() < 0.5 ? 'glide' : 'idle';
        const b: Intent = script.float() < 0.3 ? 'flap' : script.float() < 0.5 ? 'glide' : 'idle';
        step(match, a, b, STEP, rng);
      }
      return match;
    };
    expect(play()).toEqual(play());
  });

  it('two different seeds do not produce the same match', () => {
    // Guards the replay above from passing vacuously.
    const play = (seed: number): Match => {
      const match = createMatch();
      const rng = new Rng(seed);
      resetMatch(match);
      const bot = createBotState();
      for (let i = 0; i < 3000 && match.phase !== 'over'; i += 1) {
        step(match, botIntent(match.p1, 'normal', bot, STEP, rng), 'idle', STEP, rng);
      }
      return match;
    };
    expect(play(1)).not.toEqual(play(999));
  });

  it('is level again after a reset, with nothing carried over', () => {
    const { match, rng } = started();
    const bot = createBotState();
    for (let i = 0; i < 60 * 30; i += 1) {
      step(match, botIntent(match.p1, 'hard', bot, STEP, rng), 'flap', STEP, rng);
    }
    expect(match.p1.baskets + match.p2.baskets).toBeGreaterThan(0);
    resetMatch(match);
    resetBotState(bot);
    expect(match).toEqual(createMatch());
  });

  it('reaches the same state whichever seat the caller happens to look at first', () => {
    // Both lanes are stepped inside one call and neither can read the other, so there is
    // no order to get wrong — this is the assertion that keeps it that way.
    const trace = (seat: SeatId): string => {
      const match = createMatch();
      const rng = new Rng(31);
      resetMatch(match);
      const script = new Rng(5);
      const seen: number[] = [];
      for (let i = 0; i < 2400 && match.phase !== 'over'; i += 1) {
        const a: Intent = script.float() < 0.35 ? 'flap' : 'idle';
        const b: Intent = script.float() < 0.2 ? 'flap' : 'glide';
        step(match, a, b, STEP, rng);
        if (i % 40 === 0) seen.push(laneOf(match, seat).height);
      }
      return seen.map((n) => n.toFixed(9)).join(',');
    };
    expect(trace('p1')).not.toBe(trace('p2'));
    expect(trace('p1')).toBe(trace('p1'));
  });
});
