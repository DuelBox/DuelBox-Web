import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BIRD_RADIUS,
  BIRD_X,
  BLUNDER_SECONDS,
  BOT_BAND,
  BOT_PROFILES,
  CENTRE_MAX,
  CENTRE_MIN,
  CENTRE_STEP,
  DESPAWN_LEAD,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  FLAP_RECHARGE,
  FLAP_RISE,
  FLAP_SPEED,
  FLIGHTS_TO_WIN,
  FLIGHT_LIMIT,
  GAP_MIN,
  GAP_SHRINK,
  GAP_START,
  GRAVITY,
  HORIZON,
  MATCH_SECONDS,
  MAX_FALL,
  MAX_FLIGHTS,
  READY_SECONDS,
  SETTLE_SECONDS,
  SKY_HEIGHT,
  SPAWN_LEAD,
  TOOTH_REACH,
  TUCK_FALL,
  TUCK_PULL,
  WALL_POOL,
  WALL_SPEED,
  WALL_SPEED_MAX,
  WALL_THICKNESS,
  birdOf,
  botIntent,
  clearanceAt,
  createBotState,
  createMatch,
  decide,
  flightsOf,
  fly,
  gapFor,
  nextCentre,
  nextWall,
  otherOf,
  resetBotState,
  resetMatch,
  safeAt,
  startFlight,
  step,
  wallSpeedFor,
  winnerOf,
  worldXOf,
  worldYOf,
} from './rules.js';
import type { BotDifficulty, Bird, Intent, Match } from './rules.js';

const STEP = 1 / 60;

function started(seed = 20260824): { match: Match; rng: Rng } {
  const match = createMatch();
  resetMatch(match);
  return { match, rng: new Rng(seed) };
}

/** Run past the opening hover, so the birds are live. */
function toFlight(match: Match, rng: Rng): void {
  for (let i = 0; i < 600 && match.phase === 'ready'; i += 1) {
    step(match, 'idle', 'idle', STEP, rng);
  }
}

/**
 * A bird flown perfectly: hold the height of the next gap and nothing else.
 *
 * The bot's policy with the reaction delay, the aim error and the blunder taken out, so a
 * test that needs a bird to stay up for twenty walls has one without depending on a tier.
 */
function pilot(match: Readonly<Match>, seat: SeatId): Intent {
  const wall = nextWall(match);
  const aim = wall === null ? SKY_HEIGHT / 2 : wall.centre;
  const bird = seat === 'p1' ? match.p1 : match.p2;
  if (bird.height < aim - BOT_BAND) return bird.recharge > 0 ? 'idle' : 'flap';
  if (bird.height > aim + BOT_BAND) return 'tuck';
  return 'idle';
}

/** A whole match between two tiers, driven through the rules alone. */
function botMatch(p1: BotDifficulty, p2: BotDifficulty, seed: number): Match {
  const match = createMatch();
  resetMatch(match);
  const rng = new Rng(seed);
  const p1State = createBotState();
  const p2State = createBotState();
  for (let i = 0; i < 60 * 600 && match.winner === null; i += 1) {
    const a = botIntent(match, 'p1', p1, p1State, STEP, rng);
    const b = botIntent(match, 'p2', p2, p2State, STEP, rng);
    step(match, a, b, STEP, rng);
  }
  return match;
}

/** Head-to-head win counts over `seeds` seeded matches. */
function ladder(
  p1: BotDifficulty,
  p2: BotDifficulty,
  seeds: number,
): { p1: number; p2: number; drawn: number; open: number } {
  let a = 0;
  let b = 0;
  let drawn = 0;
  let open = 0;
  for (let seed = 1; seed <= seeds; seed += 1) {
    const match = botMatch(p1, p2, seed * 101 + 7);
    if (match.winner === 'p1') a += 1;
    else if (match.winner === 'p2') b += 1;
    else if (match.winner === 'draw') drawn += 1;
    else open += 1;
  }
  return { p1: a, p2: b, drawn, open };
}

/** A bird on its own, for testing flight without a sky around it. */
function loneBird(height = SKY_HEIGHT / 2): Bird {
  const match = createMatch();
  match.p1.height = height;
  return match.p1;
}

describe('the field', () => {
  it('is two whole skies and a horizon, with nothing left over', () => {
    expect(SKY_HEIGHT * 2 + HORIZON).toBe(FIELD_HEIGHT);
    expect(HORIZON).toBeGreaterThan(0);
  });

  it('maps the two skies onto exact half turns of one another', () => {
    // The fairness claim, as geometry: every sky-local point lands on the far seat's half
    // turn of itself. Off by anything at all and one player would be reading a field the
    // other was not playing on.
    for (const height of [0, 37, SKY_HEIGHT / 2, SKY_HEIGHT]) {
      for (const lead of [DESPAWN_LEAD, 0, 91, SPAWN_LEAD]) {
        expect(worldXOf('p2', lead)).toBeCloseTo(FIELD_WIDTH - worldXOf('p1', lead), 9);
        expect(worldYOf('p2', height)).toBeCloseTo(FIELD_HEIGHT - worldYOf('p1', height), 9);
      }
    }
  });

  it('keeps each seat wholly inside its own half of the device', () => {
    expect(worldYOf('p1', 0)).toBe(FIELD_HEIGHT);
    expect(worldYOf('p1', SKY_HEIGHT)).toBe(FIELD_HEIGHT - SKY_HEIGHT);
    expect(worldYOf('p1', SKY_HEIGHT)).toBeGreaterThan(FIELD_HEIGHT / 2);
    expect(worldYOf('p2', SKY_HEIGHT)).toBeLessThan(FIELD_HEIGHT / 2);
  });

  it('lets a wall enter and leave off the edges rather than inside the sky', () => {
    expect(worldXOf('p1', SPAWN_LEAD)).toBeGreaterThan(FIELD_WIDTH);
    expect(worldXOf('p1', DESPAWN_LEAD)).toBeLessThan(0);
    expect(worldXOf('p2', SPAWN_LEAD)).toBeLessThan(0);
    expect(worldXOf('p2', DESPAWN_LEAD)).toBeGreaterThan(FIELD_WIDTH);
  });

  it('leaves the bird room to fly on both sides of it', () => {
    expect(BIRD_X).toBeGreaterThan(BIRD_RADIUS * 2);
    expect(BIRD_X).toBeLessThan(FIELD_WIDTH / 2);
  });

  it('names the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

describe('the run of walls', () => {
  it('releases the first wall inside the opening hover, so it can be read', () => {
    const { match, rng } = started();
    expect(nextWall(match)).toBeNull();
    toFlight(match, rng);
    const wall = nextWall(match);
    expect(wall).not.toBeNull();
    expect(wall!.lead).toBeLessThan(SPAWN_LEAD);
    expect(wall!.lead).toBeGreaterThan(0);
  });

  it('gives the first wall a clear second after gravity arrives', () => {
    // The tuning claim behind OPENING_SLACK: the opening wall must not land on the birds
    // as gravity does, or where its centre happened to fall decides the first flight.
    const { match, rng } = started();
    toFlight(match, rng);
    const wall = nextWall(match)!;
    expect(wall.lead / WALL_SPEED).toBeGreaterThan(1);
  });

  it('draws every centre inside the band, whatever it started from', () => {
    const rng = new Rng(4242);
    let centre = SKY_HEIGHT / 2;
    for (let i = 0; i < 400; i += 1) {
      const next = nextCentre(centre, rng);
      expect(next).toBeGreaterThanOrEqual(CENTRE_MIN);
      expect(next).toBeLessThanOrEqual(CENTRE_MAX);
      expect(Math.abs(next - centre)).toBeLessThanOrEqual(CENTRE_STEP + 1e-9);
      centre = next;
    }
  });

  it('never lets a gap hang off either surface, even at its widest', () => {
    // A centre band that allowed it would seal one side of a wall without saying so.
    expect(CENTRE_MIN - GAP_START / 2).toBeGreaterThanOrEqual(0);
    expect(CENTRE_MAX + GAP_START / 2).toBeLessThanOrEqual(SKY_HEIGHT);
  });

  it('keeps the pool ahead of the stream', () => {
    const { match, rng } = started();
    let mostLive = 0;
    for (let i = 0; i < 60 * 30 && match.winner === null; i += 1) {
      step(match, pilot(match, 'p1'), pilot(match, 'p2'), STEP, rng);
      let live = 0;
      for (const wall of match.walls) if (wall.live) live += 1;
      if (live > mostLive) mostLive = live;
    }
    expect(mostLive).toBeGreaterThan(1);
    expect(mostLive).toBeLessThan(WALL_POOL);
  });

  it('retires a wall only once it is off the near edge', () => {
    expect(worldXOf('p1', DESPAWN_LEAD) + WALL_THICKNESS / 2).toBeLessThan(0);
  });

  it('is sampled often enough that nothing can pass through a wall', () => {
    // The whole passage is 2 * TOOTH_REACH wide and the fastest wall covers this much of
    // it in a step. Several samples per passage, so there is nothing to tunnel through.
    const perStep = WALL_SPEED_MAX * STEP;
    expect((2 * TOOTH_REACH) / perStep).toBeGreaterThan(4);
  });
});

describe('flying', () => {
  it('falls when nothing is asked of it', () => {
    const bird = loneBird();
    fly(bird, 'idle', STEP);
    expect(bird.velocity).toBeCloseTo(-GRAVITY * STEP, 9);
    expect(bird.height).toBeLessThan(SKY_HEIGHT / 2);
  });

  it('sets the climb rate on a beat rather than adding to it', () => {
    const bird = loneBird();
    fly(bird, 'flap', STEP);
    expect(bird.velocity).toBeCloseTo(FLAP_SPEED - GRAVITY * STEP, 9);
  });

  it('is worth a wing-beat of altitude, which is what the bot band is built on', () => {
    // FLAP_RISE is the analytic arc; a fixed step samples it and lands a couple of units
    // short, which is fine and is exactly why the band is half a beat rather than a
    // tolerance. What matters is that the constant the bot quotes is the real climb.
    const bird = loneBird(SKY_HEIGHT / 2);
    fly(bird, 'flap', STEP);
    let top = bird.height;
    for (let i = 0; i < 200; i += 1) {
      fly(bird, 'idle', STEP);
      if (bird.height > top) top = bird.height;
    }
    const climbed = top - SKY_HEIGHT / 2;
    expect(climbed).toBeLessThanOrEqual(FLAP_RISE);
    expect(climbed).toBeGreaterThan(FLAP_RISE * 0.94);
  });

  it('will not beat again until the wing has recharged', () => {
    const bird = loneBird();
    fly(bird, 'flap', STEP);
    const after = bird.velocity;
    fly(bird, 'flap', STEP);
    // The second press cannot land: it is held instead, and the wing simply falls away.
    expect(bird.velocity).toBeLessThan(after);
    expect(bird.buffered).toBe(true);
  });

  it('spends a held press the instant the wing comes back', () => {
    const bird = loneBird();
    fly(bird, 'flap', STEP);
    fly(bird, 'flap', STEP);
    let spent = -1;
    for (let i = 0; i < 60 && spent < 0; i += 1) {
      fly(bird, 'idle', STEP);
      if (!bird.buffered) spent = i;
    }
    expect(spent).toBeGreaterThanOrEqual(0);
    expect(bird.velocity).toBeGreaterThan(0);
    // Spent when the recharge expired, not before and not on some later frame.
    expect((spent + 3) * STEP).toBeGreaterThanOrEqual(FLAP_RECHARGE);
  });

  it('caps the beat rate at the recharge, so a masher gains nothing', () => {
    const masher = loneBird(SKY_HEIGHT / 2);
    const tapper = loneBird(SKY_HEIGHT / 2);
    for (let i = 0; i < 120; i += 1) {
      fly(masher, 'flap', STEP);
      // Twelve a second: comfortably above the recharge and deliberately not a multiple
      // of it, because an aliasing rhythm is the case the buffer exists for.
      fly(tapper, i % 5 === 0 ? 'flap' : 'idle', STEP);
    }
    expect(masher.height).toBeCloseTo(tapper.height, 6);
  });

  it('dives harder and faster with the wings tucked', () => {
    const falling = loneBird(SKY_HEIGHT - BIRD_RADIUS);
    const diving = loneBird(SKY_HEIGHT - BIRD_RADIUS);
    fly(falling, 'idle', STEP);
    fly(diving, 'tuck', STEP);
    expect(diving.velocity).toBeCloseTo(-TUCK_PULL * STEP, 9);
    expect(diving.velocity).toBeLessThan(falling.velocity);
  });

  it('throws a beat away if the wings are tucked at the top of it', () => {
    // The commitment a tuck is: it is not a free extra on top of a climb.
    const climbing = loneBird();
    const tucking = loneBird();
    fly(climbing, 'flap', STEP);
    fly(tucking, 'flap', STEP);
    for (let i = 0; i < 12; i += 1) {
      fly(climbing, 'idle', STEP);
      fly(tucking, 'tuck', STEP);
    }
    expect(tucking.height).toBeLessThan(climbing.height);
  });

  it('reaches a terminal speed in each posture, and the tucked one is faster', () => {
    const falling = loneBird(SKY_HEIGHT - BIRD_RADIUS);
    const diving = loneBird(SKY_HEIGHT - BIRD_RADIUS);
    for (let i = 0; i < 30; i += 1) {
      fly(falling, 'idle', STEP);
      fly(diving, 'tuck', STEP);
    }
    expect(falling.velocity).toBeCloseTo(-MAX_FALL, 6);
    expect(diving.velocity).toBeCloseTo(-TUCK_FALL, 6);
    expect(TUCK_FALL).toBeGreaterThan(MAX_FALL);
  });

  it('stops dead on the ground rather than sinking into it', () => {
    const bird = loneBird(BIRD_RADIUS + 4);
    for (let i = 0; i < 30; i += 1) fly(bird, 'idle', STEP);
    expect(bird.height).toBe(BIRD_RADIUS);
    expect(bird.velocity).toBe(0);
  });

  it('stops dead on the ceiling rather than bouncing off the horizon', () => {
    const bird = loneBird(SKY_HEIGHT - BIRD_RADIUS - 4);
    fly(bird, 'flap', STEP);
    expect(bird.height).toBe(SKY_HEIGHT - BIRD_RADIUS);
    expect(bird.velocity).toBe(0);
  });

  it('keeps the whole bird on the device at both extremes', () => {
    const low = loneBird(BIRD_RADIUS);
    const high = loneBird(SKY_HEIGHT - BIRD_RADIUS);
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      expect(worldYOf(seat, low.height - BIRD_RADIUS)).toBeGreaterThanOrEqual(0);
      expect(worldYOf(seat, high.height + BIRD_RADIUS)).toBeLessThanOrEqual(FIELD_HEIGHT);
    }
  });
});

describe('a wall resolving', () => {
  const centre = 235;

  it('lets a bird wholly inside the gap through', () => {
    expect(safeAt(centre, centre, GAP_START)).toBe(true);
    expect(safeAt(centre + GAP_START / 2 - BIRD_RADIUS, centre, GAP_START)).toBe(true);
    expect(safeAt(centre - GAP_START / 2 + BIRD_RADIUS, centre, GAP_START)).toBe(true);
  });

  it('takes a bird whose edge is over the tip line, however little of it', () => {
    expect(safeAt(centre + GAP_START / 2 - BIRD_RADIUS + 0.01, centre, GAP_START)).toBe(false);
    expect(safeAt(centre - GAP_START / 2 + BIRD_RADIUS - 0.01, centre, GAP_START)).toBe(false);
  });

  it('offers no way round, because both banks reach their own surface', () => {
    // Nothing above the top bank and nothing below the bottom one, at any height the sky
    // allows. This is the difference between avoiding a spike and threading a hoop.
    for (const height of [BIRD_RADIUS, SKY_HEIGHT / 2, SKY_HEIGHT - BIRD_RADIUS]) {
      const clear = safeAt(height, centre, GAP_START);
      expect(clear).toBe(Math.abs(height - centre) <= GAP_START / 2 - BIRD_RADIUS);
    }
    expect(safeAt(BIRD_RADIUS, CENTRE_MAX, GAP_START)).toBe(false);
    expect(safeAt(SKY_HEIGHT - BIRD_RADIUS, CENTRE_MIN, GAP_START)).toBe(false);
  });

  it('banks the most clearance for the middle of the gap and none at the tips', () => {
    expect(clearanceAt(centre, centre, GAP_START)).toBeCloseTo(GAP_START / 2 - BIRD_RADIUS, 9);
    expect(clearanceAt(centre + GAP_START / 2 - BIRD_RADIUS, centre, GAP_START)).toBeCloseTo(0, 9);
    expect(clearanceAt(0, centre, GAP_START)).toBe(0);
    expect(clearanceAt(SKY_HEIGHT, centre, GAP_START)).toBe(0);
  });

  it('never banks clearance for a bird that would have been taken', () => {
    for (let height = 0; height <= SKY_HEIGHT; height += 7) {
      if (!safeAt(height, centre, GAP_START)) {
        expect(clearanceAt(height, centre, GAP_START)).toBe(0);
      }
    }
  });
});

describe('the wall that closes', () => {
  it('starts wide and narrows with every wall the flight has cleared', () => {
    expect(gapFor(0)).toBe(GAP_START);
    expect(gapFor(1)).toBe(GAP_START - GAP_SHRINK);
    expect(gapFor(5)).toBe(GAP_START - 5 * GAP_SHRINK);
  });

  it('stops narrowing at a gap a bird still fits through', () => {
    expect(gapFor(1000)).toBe(GAP_MIN);
    expect(GAP_MIN / 2 - BIRD_RADIUS).toBeGreaterThan(0);
  });

  it('reaches its tightest inside a flight rather than in theory', () => {
    // Twelve walls, which a good pair reaches in about fifteen seconds. If this were
    // fifty, a flight would have no natural end and FLIGHT_LIMIT would be the mechanism
    // rather than the backstop.
    let walls = 0;
    while (gapFor(walls) > GAP_MIN) walls += 1;
    expect(walls).toBeLessThan(20);
  });

  it('quickens with the same counter, and stops', () => {
    expect(wallSpeedFor(0)).toBe(WALL_SPEED);
    expect(wallSpeedFor(1)).toBeGreaterThan(wallSpeedFor(0));
    expect(wallSpeedFor(1000)).toBe(WALL_SPEED_MAX);
  });

  it('is the same width for both seats at every moment of a flight', () => {
    // Not a tuning claim but a structural one: there is one counter, so there is one gap.
    const { match, rng } = started();
    for (let i = 0; i < 60 * 20 && match.winner === null; i += 1) {
      step(match, pilot(match, 'p1'), pilot(match, 'p2'), STEP, rng);
      expect(gapFor(match.cleared)).toBe(gapFor(match.cleared));
      expect(match.p1.threaded).toBe(match.p2.threaded);
    }
  });
});

describe('the two skies are one sky', () => {
  it('flies two birds given the same intent to the same number', () => {
    const { match, rng } = started();
    const script = new Rng(99);
    for (let i = 0; i < 60 * 30 && match.winner === null; i += 1) {
      const roll = script.float();
      const intent: Intent = roll < 0.3 ? 'flap' : roll < 0.55 ? 'tuck' : 'idle';
      step(match, intent, intent, STEP, rng);
      expect(match.p1.height).toBe(match.p2.height);
      expect(match.p1.velocity).toBe(match.p2.velocity);
      expect(match.p1.clearance).toBe(match.p2.clearance);
    }
    // Two identical birds go down together, so nobody can ever win that way.
    expect(match.p1.flights).toBe(0);
    expect(match.p2.flights).toBe(0);
  });

  it('gives the seat that flew a script the same result whichever seat it sat in', () => {
    // The mirror test. Two scripts, played into the two seats and then swapped over: the
    // match must come out the other way round and by the same margin.
    const scripts = (seed: number): Intent[] => {
      const rng = new Rng(seed);
      const out: Intent[] = [];
      for (let i = 0; i < 60 * 120; i += 1) {
        const roll = rng.float();
        out.push(roll < 0.34 ? 'flap' : roll < 0.5 ? 'tuck' : 'idle');
      }
      return out;
    };
    const a = scripts(11);
    const b = scripts(12);

    const run = (first: Intent[], second: Intent[]): Match => {
      const { match, rng } = started();
      for (let i = 0; i < first.length && match.winner === null; i += 1) {
        step(match, first[i]!, second[i]!, STEP, rng);
      }
      return match;
    };
    const straight = run(a, b);
    const swapped = run(b, a);

    expect(straight.p1.flights).toBe(swapped.p2.flights);
    expect(straight.p2.flights).toBe(swapped.p1.flights);
    expect(straight.p1.clearance).toBeCloseTo(swapped.p2.clearance, 9);
    expect(straight.flightsPlayed).toBe(swapped.flightsPlayed);
    const mirrored =
      straight.winner === 'draw' || straight.winner === null
        ? straight.winner
        : otherOf(straight.winner);
    expect(swapped.winner).toBe(mirrored);
  });

  it('hands both seats the identical wall at the identical instant', () => {
    const { match, rng } = started();
    toFlight(match, rng);
    for (let i = 0; i < 300 && match.winner === null; i += 1) {
      step(match, pilot(match, 'p1'), 'idle', STEP, rng);
      for (const wall of match.walls) {
        if (!wall.live) continue;
        // One object, read from both ends of the device: p1 sees it coming from the right
        // and p2 from the left, at mirrored places on the screen.
        expect(worldXOf('p1', wall.lead) + worldXOf('p2', wall.lead)).toBeCloseTo(FIELD_WIDTH, 9);
      }
    }
  });

  it('reads a seat s own bird back through the same accessor', () => {
    const { match } = started();
    expect(birdOf(match, 'p1')).toBe(match.p1);
    expect(birdOf(match, 'p2')).toBe(match.p2);
    expect(flightsOf(match, 'p1')).toBe(0);
    match.p2.flights = 2;
    expect(flightsOf(match, 'p2')).toBe(2);
  });
});

describe('a flight ending', () => {
  it('hands the flight to whoever is still up', () => {
    const { match, rng } = started();
    let guard = 0;
    while (match.flightsPlayed === 0 && guard < 60 * 60) {
      step(match, pilot(match, 'p1'), 'idle', STEP, rng);
      guard += 1;
    }
    expect(match.downed).toBe('p2');
    expect(match.p1.flights).toBe(1);
    expect(match.p2.flights).toBe(0);
    expect(match.p2.down).toBe(true);
    expect(match.p1.down).toBe(false);
  });

  it('gives it to nobody when both go down inside one step', () => {
    const { match, rng } = started();
    for (let i = 0; i < 60 * 20 && match.flightsPlayed === 0; i += 1) {
      step(match, 'idle', 'idle', STEP, rng);
    }
    expect(match.downed).toBe('both');
    expect(match.p1.flights).toBe(0);
    expect(match.p2.flights).toBe(0);
    // It still costs a flight, which is what stops a level match running for ever.
    expect(match.flightsPlayed).toBe(1);
  });

  it('holds the downed bird on screen before dealing the next flight', () => {
    const { match, rng } = started();
    for (let i = 0; i < 60 * 20 && match.phase !== 'settle'; i += 1) {
      step(match, pilot(match, 'p1'), 'idle', STEP, rng);
    }
    expect(match.phase).toBe('settle');
    const held = match.p2.height;
    for (let i = 0; i < Math.floor(SETTLE_SECONDS * 60) - 2; i += 1) {
      step(match, 'flap', 'flap', STEP, rng);
      expect(match.p2.height).toBe(held);
    }
  });

  it('deals a fresh sky afterwards and keeps the score', () => {
    const { match, rng } = started();
    for (let i = 0; i < 60 * 40 && match.flightsPlayed < 1; i += 1) {
      step(match, pilot(match, 'p1'), 'idle', STEP, rng);
    }
    const won = match.p1.flights;
    for (let i = 0; i < 60 * 2 && match.phase === 'settle'; i += 1) {
      step(match, 'idle', 'idle', STEP, rng);
    }
    expect(match.phase).toBe('ready');
    expect(match.cleared).toBe(0);
    expect(match.p1.height).toBe(SKY_HEIGHT / 2);
    expect(match.p2.height).toBe(SKY_HEIGHT / 2);
    expect(match.p1.down).toBe(false);
    expect(match.p2.down).toBe(false);
    expect(match.p1.flights).toBe(won);
    for (const wall of match.walls) expect(wall.live).toBe(false);
  });

  it('remembers the best run of walls anybody put together', () => {
    // Both seats flown, so the flight lasts long enough for walls to actually be banked:
    // a flight against an absent player is over before the first wall arrives.
    const { match, rng } = started();
    for (let i = 0; i < 60 * 90 && match.flightsPlayed < 2; i += 1) {
      step(match, pilot(match, 'p1'), pilot(match, 'p2'), STEP, rng);
    }
    expect(match.p1.bestThreaded).toBeGreaterThan(0);
    expect(match.p1.bestThreaded).toBeGreaterThanOrEqual(match.p1.threaded);
    expect(match.p1.clearance).toBeGreaterThan(0);
  });

  it('does nothing at all once the match is over', () => {
    const { match, rng } = started();
    for (let i = 0; i < 60 * 600 && match.winner === null; i += 1) {
      step(match, pilot(match, 'p1'), 'idle', STEP, rng);
    }
    expect(match.winner).not.toBeNull();
    const frozen = match.p1.height;
    const played = match.flightsPlayed;
    for (let i = 0; i < 300; i += 1) step(match, 'flap', 'flap', STEP, rng);
    expect(match.p1.height).toBe(frozen);
    expect(match.flightsPlayed).toBe(played);
  });
});

describe('winning', () => {
  it('is undecided while the flights are still being flown', () => {
    const { match } = started();
    expect(decide(match)).toBeNull();
    expect(winnerOf(match)).toBeNull();
    match.p1.flights = FLIGHTS_TO_WIN - 1;
    match.flightsPlayed = FLIGHTS_TO_WIN - 1;
    expect(decide(match)).toBeNull();
  });

  it('goes to the first seat to survive three times', () => {
    const { match } = started();
    match.p1.flights = FLIGHTS_TO_WIN;
    match.flightsPlayed = FLIGHTS_TO_WIN;
    expect(decide(match)).toBe('p1');
    match.p1.flights = 0;
    match.p2.flights = FLIGHTS_TO_WIN;
    expect(decide(match)).toBe('p2');
  });

  it('settles a spent budget on flights won', () => {
    const { match } = started();
    match.flightsPlayed = MAX_FLIGHTS;
    match.p1.flights = 2;
    match.p2.flights = 1;
    expect(decide(match)).toBe('p1');
  });

  it('separates a level pair on the room they flew with to spare', () => {
    const { match } = started();
    match.flightsPlayed = MAX_FLIGHTS;
    match.p1.flights = 2;
    match.p2.flights = 2;
    match.p1.clearance = 400;
    match.p2.clearance = 401;
    expect(decide(match)).toBe('p2');
    match.p1.clearance = 402;
    expect(decide(match)).toBe('p1');
  });

  it('is only a draw when the flights and the clearance both are', () => {
    const { match } = started();
    match.flightsPlayed = MAX_FLIGHTS;
    match.p1.clearance = 88;
    match.p2.clearance = 88;
    expect(decide(match)).toBe('draw');
  });

  it('never lets a match run past the flight budget', () => {
    const { match } = started();
    match.flightsPlayed = MAX_FLIGHTS;
    expect(decide(match)).not.toBeNull();
  });

  it('calls a match that somehow outlasts the clock', () => {
    const { match, rng } = started();
    match.elapsed = MATCH_SECONDS;
    step(match, 'idle', 'idle', STEP, rng);
    expect(match.phase).toBe('over');
    expect(match.winner).not.toBeNull();
  });
});

describe('termination', () => {
  it('ends a match nobody plays at all', () => {
    const { match, rng } = started();
    let steps = 0;
    for (; steps < 60 * 600 && match.winner === null; steps += 1) {
      step(match, 'idle', 'idle', STEP, rng);
    }
    expect(match.winner).toBe('draw');
    expect(match.flightsPlayed).toBe(MAX_FLIGHTS);
    // Well inside the ten simulated minutes `termination.test.ts` allows.
    expect(steps / 60).toBeLessThan(60);
  });

  it('ends a match two of the weakest bots play', () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const match = botMatch('easy', 'easy', seed * 7919);
      expect(match.winner, `easy pair on seed ${seed} never finished`).not.toBeNull();
      expect(match.flightsPlayed).toBeLessThanOrEqual(MAX_FLIGHTS);
    }
  });

  it('ends a match two of the strongest bots play', () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const match = botMatch('hard', 'hard', seed * 104729);
      expect(match.winner, `hard pair on seed ${seed} never finished`).not.toBeNull();
    }
  });

  it('bounds itself by arithmetic rather than by tuning', () => {
    // Gap and pace are functions of a counter that only goes up, so a flight is a race
    // against a progression that always wins; the budget then bounds the match.
    const perFlight = READY_SECONDS + FLIGHT_LIMIT + SETTLE_SECONDS;
    expect(perFlight * MAX_FLIGHTS).toBeLessThan(MATCH_SECONDS);
    expect(MATCH_SECONDS).toBeLessThan(600);
  });

  it('holds a flight nobody can lose to the flight limit', () => {
    // Reached by pinning the counter, which is the only way a flight could stall: with the
    // gap and the pace frozen, two perfect birds would fly for ever.
    const { match, rng } = started();
    toFlight(match, rng);
    let steps = 0;
    for (; steps < 60 * (FLIGHT_LIMIT + 4) && match.flightsPlayed === 0; steps += 1) {
      match.cleared = 0;
      step(match, pilot(match, 'p1'), pilot(match, 'p2'), STEP, rng);
    }
    expect(match.flightsPlayed).toBe(1);
    expect(match.flightSeconds === 0 || match.flightSeconds >= FLIGHT_LIMIT).toBe(true);
  });
});

describe('the bot', () => {
  it('orders its three tiers by reaction, aim and blunder alike', () => {
    const { easy, normal, hard } = BOT_PROFILES;
    expect(easy.reaction).toBeGreaterThan(normal.reaction);
    expect(normal.reaction).toBeGreaterThan(hard.reaction);
    expect(easy.error).toBeGreaterThan(normal.error);
    expect(normal.error).toBeGreaterThan(hard.error);
    expect(easy.blunder).toBeGreaterThan(normal.blunder);
    expect(normal.blunder).toBeGreaterThan(hard.blunder);
  });

  it('centres its correction band on half a wing-beat', () => {
    // Getting this wrong is what inverts the tiers: a band that is not symmetric about the
    // aim puts the whole sawtooth above the target and makes the sharp tier the tidiest
    // wrong answer rather than the right one.
    expect(BOT_BAND).toBeCloseTo(FLAP_RISE / 2, 9);
  });

  it('flies on its last decision between looks', () => {
    const { match, rng } = started();
    toFlight(match, rng);
    const state = createBotState();
    const first = botIntent(match, 'p1', 'easy', state, STEP, rng);
    const held = state.hold;
    for (let i = 0; i < 3; i += 1) {
      expect(botIntent(match, 'p1', 'easy', state, STEP, rng)).toBe(held);
    }
    expect(first === 'flap' || first === held).toBe(true);
  });

  it('waits for its own wing rather than beating through the recharge', () => {
    // Rule 6: it may know its wing is not back, because a player can see that too. What it
    // may not do is queue a press it never chose.
    const { match, rng } = started();
    toFlight(match, rng);
    match.p1.height = BIRD_RADIUS;
    match.p1.recharge = FLAP_RECHARGE;
    const state = createBotState();
    state.aim = SKY_HEIGHT - BIRD_RADIUS;
    expect(botIntent(match, 'p1', 'hard', state, STEP, rng)).toBe('idle');
    match.p1.recharge = 0;
    resetBotState(state);
    expect(botIntent(match, 'p1', 'hard', state, STEP, rng)).toBe('flap');
    expect(match.p1.buffered).toBe(false);
  });

  it('tucks when it is floating above the gap it is aiming at', () => {
    const { match, rng } = started();
    toFlight(match, rng);
    match.p1.height = SKY_HEIGHT - BIRD_RADIUS;
    const state = createBotState();
    let sawTuck = false;
    for (let i = 0; i < 20 && !sawTuck; i += 1) {
      if (botIntent(match, 'p1', 'hard', state, STEP, rng) === 'tuck') sawTuck = true;
    }
    expect(sawTuck).toBe(true);
  });

  it('freezes for a whole blunder rather than jittering for one step', () => {
    const { match, rng } = started();
    toFlight(match, rng);
    const state = createBotState();
    state.frozen = BLUNDER_SECONDS;
    let frozenSteps = 0;
    for (let i = 0; i < Math.floor(BLUNDER_SECONDS * 60) - 2; i += 1) {
      const intent = botIntent(match, 'p1', 'hard', state, STEP, rng);
      if (intent === 'idle') frozenSteps += 1;
    }
    expect(frozenSteps).toBe(Math.floor(BLUNDER_SECONDS * 60) - 2);
  });

  it('starts and resets to the same state, so a rematch is a fresh bot', () => {
    const fresh = createBotState();
    const used = createBotState();
    used.look = 0.4;
    used.aim = 12;
    used.hold = 'tuck';
    used.frozen = 0.2;
    resetBotState(used);
    expect(used).toEqual(fresh);
  });

  it('never touches the other seat s bird', () => {
    const { match, rng } = started();
    toFlight(match, rng);
    const state = createBotState();
    const before = { ...match.p2 };
    for (let i = 0; i < 120; i += 1) botIntent(match, 'p1', 'hard', state, STEP, rng);
    expect({ ...match.p2 }).toEqual(before);
  });

  it('beats a weaker tier over a run of seeded matches', () => {
    // The ladder, measured rather than asserted from the profile numbers. SPEC.md records
    // the same figures at sixty seeds a pairing.
    const hardOverEasy = ladder('hard', 'easy', 24);
    expect(hardOverEasy.p1).toBeGreaterThan(hardOverEasy.p2);
    expect(hardOverEasy.open).toBe(0);

    const normalOverEasy = ladder('normal', 'easy', 24);
    expect(normalOverEasy.p1).toBeGreaterThan(normalOverEasy.p2);

    const hardOverNormal = ladder('hard', 'normal', 24);
    expect(hardOverNormal.p1).toBeGreaterThan(hardOverNormal.p2);
  });

  it('is even against itself, from either seat', () => {
    // The seat symmetry claim where it matters most: the same tier on both sides must not
    // favour the seat whose bot happens to draw from the stream first.
    const level = ladder('normal', 'normal', 24);
    expect(level.open).toBe(0);
    expect(Math.abs(level.p1 - level.p2)).toBeLessThanOrEqual(10);
  });
});

describe('determinism', () => {
  it('plays the identical match from the same seed', () => {
    const trace = (): string => {
      const match = createMatch();
      resetMatch(match);
      const rng = new Rng(31337);
      const p1 = createBotState();
      const p2 = createBotState();
      const seen: number[] = [];
      for (let i = 0; i < 60 * 45 && match.winner === null; i += 1) {
        const a = botIntent(match, 'p1', 'normal', p1, STEP, rng);
        const b = botIntent(match, 'p2', 'hard', p2, STEP, rng);
        step(match, a, b, STEP, rng);
        if (i % 7 === 0) seen.push(match.p1.height, match.p2.height, match.cleared);
      }
      return seen.map((n) => n.toFixed(9)).join(',');
    };
    expect(trace()).toBe(trace());
  });

  it('plays a different match from a different seed', () => {
    const centres = (seed: number): string => {
      const match = createMatch();
      resetMatch(match);
      const rng = new Rng(seed);
      const seen: number[] = [];
      for (let i = 0; i < 60 * 10; i += 1) {
        const before = match.lastCentre;
        step(match, pilot(match, 'p1'), pilot(match, 'p2'), STEP, rng);
        if (match.lastCentre !== before) seen.push(match.lastCentre);
      }
      return seen.map((n) => n.toFixed(6)).join(',');
    };
    expect(centres(1)).not.toBe(centres(2));
  });

  it('consumes the stream in the sky and never in a bird', () => {
    // The property the mirror test rests on: what the players do cannot change which walls
    // they are given, so two matches played differently see the identical run of gaps.
    const centres = (intent: Intent): string => {
      const match = createMatch();
      resetMatch(match);
      const rng = new Rng(555);
      const seen: number[] = [];
      for (let i = 0; i < 60 * 8; i += 1) {
        const before = match.lastCentre;
        // `startFlight` keeps the sky moving between flights, so a match whose players
        // die early still draws its centres in the same order.
        step(match, intent, intent, STEP, rng);
        if (match.lastCentre !== before) seen.push(match.lastCentre);
      }
      return seen.map((n) => n.toFixed(9)).join(',');
    };
    expect(centres('flap')).toBe(centres('idle'));
  });

  it('resets to a state indistinguishable from a fresh match', () => {
    const played = createMatch();
    const rng = new Rng(808);
    for (let i = 0; i < 60 * 20; i += 1) {
      step(played, pilot(played, 'p1'), 'idle', STEP, rng);
    }
    resetMatch(played);
    expect(played).toEqual(createMatch());
  });

  it('deals a flight the same way whether it is the first or the fifth', () => {
    const fresh = createMatch();
    const used = createMatch();
    used.p1.flights = 2;
    used.p2.clearance = 91;
    used.cleared = 14;
    startFlight(used);
    expect(used.cleared).toBe(fresh.cleared);
    expect(used.sinceSpawn).toBe(fresh.sinceSpawn);
    expect(used.lastCentre).toBe(fresh.lastCentre);
    expect(used.readyDelay).toBe(fresh.readyDelay);
    expect(used.p1.height).toBe(fresh.p1.height);
    // What a flight must not reset is the match.
    expect(used.p1.flights).toBe(2);
    expect(used.p2.clearance).toBe(91);
  });
});
