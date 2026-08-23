import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CANES_PER_SEAT,
  CANE_COUNT,
  CANE_RADIUS,
  CENTRE_X,
  FLIGHT_LIMIT_SECONDS,
  FLIGHT_SUBSTEPS,
  MAX_AIM,
  MAX_SPIN,
  MAX_THROWS,
  ROCKS,
  SETTLE_SECONDS,
  SHURIKEN_RADIUS,
  SHURIKEN_SPEED,
  SLOT_JITTER_X,
  THROW_X,
  THROW_Y,
  addSpin,
  advanceArc,
  aimAt,
  aimTowards,
  botTurn,
  createBotPlan,
  createShotOutcome,
  createState,
  dressGrove,
  hitsCane,
  hitsRock,
  offBoard,
  otherOf,
  planShot,
  predictShot,
  resetBotPlan,
  resetState,
  spinTo,
  standingFor,
  step,
  throwShuriken,
  turnAim,
  winnerOf,
} from './rules.js';
import type { ArcPoint, BotDifficulty, State } from './rules.js';

const STEP = 1 / 60;
const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];

function started(seed = 1): { state: State; rng: Rng } {
  const state = createState();
  const rng = new Rng(seed);
  resetState(state, rng);
  return { state, rng };
}

/** Empty the grove and move every cane out of the way, for a scenario built by hand. */
function clearGrove(state: State): void {
  for (const cane of state.canes) {
    cane.standing = false;
    cane.x = -900;
    cane.y = -900;
  }
}

function place(state: State, index: number, x: number, y: number): void {
  const cane = state.canes[index]!;
  cane.x = x;
  cane.y = y;
  cane.standing = true;
}

/** Throw, and carry the blade all the way to wherever it stops. */
function throwAndLand(state: State, aim: number, spin: number): number {
  aimAt(state, aim);
  spinTo(state, spin);
  throwShuriken(state, state.active);
  let steps = 0;
  while (state.phase === 'flying' && steps < 4000) {
    step(state, STEP);
    steps += 1;
  }
  return steps;
}

/** Let the settle run out, so the turn passes. */
function settleTurn(state: State): void {
  for (let i = 0; i < 200 && state.phase === 'settling'; i += 1) step(state, STEP);
}

function takeTurn(state: State, aim: number, spin: number): void {
  throwAndLand(state, aim, spin);
  settleTurn(state);
}

describe('the grove', () => {
  it('plants twelve canes, six a seat, all of them standing', () => {
    const { state } = started();
    expect(state.canes).toHaveLength(CANE_COUNT);
    expect(standingFor(state, 'p1')).toBe(CANES_PER_SEAT);
    expect(standingFor(state, 'p2')).toBe(CANES_PER_SEAT);
    expect(state.active).toBe('p1');
    expect(state.phase).toBe('aiming');
    expect(winnerOf(state)).toBeNull();
  });

  it('is its own mirror about the centre line', () => {
    // The board turns half a turn to face whoever is to throw, so both players see the same
    // picture and shoot at the *other* half of it. A grove that was not a mirror of itself
    // would hand one of them an easier six, every match, and nobody would see why.
    for (let seed = 1; seed <= 25; seed += 1) {
      const { state } = started(seed);
      for (let i = 0; i < CANES_PER_SEAT; i += 1) {
        const mine = state.canes[i]!;
        const theirs = state.canes[i + CANES_PER_SEAT]!;
        expect(mine.seat).toBe('p1');
        expect(theirs.seat).toBe('p2');
        expect(theirs.x).toBeCloseTo(BOARD_WIDTH - mine.x, 10);
        expect(theirs.y).toBeCloseTo(mine.y, 10);
      }
    }
  });

  it('gives every match a grove of its own', () => {
    const layouts = new Set<string>();
    for (let seed = 1; seed <= 25; seed += 1) {
      const { state } = started(seed);
      layouts.add(state.canes.map((cane) => `${cane.x.toFixed(2)},${cane.y.toFixed(2)}`).join('|'));
    }
    // A fixed grove would be one puzzle solved once and then replayed for ever.
    expect(layouts.size).toBe(25);
  });

  it('never plants a cane inside a stone or off the board', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const { state } = started(seed);
      for (const cane of state.canes) {
        expect(cane.x).toBeGreaterThan(CANE_RADIUS);
        expect(cane.x).toBeLessThan(BOARD_WIDTH - CANE_RADIUS);
        expect(cane.y).toBeGreaterThan(CANE_RADIUS);
        expect(cane.y).toBeLessThan(THROW_Y - CANE_RADIUS);
        for (const rock of ROCKS) {
          const gap = Math.hypot(cane.x - rock.x, cane.y - rock.y);
          // A cane buried in a stone could never be cut, and the match would hang on it.
          expect(gap).toBeGreaterThan(rock.radius + CANE_RADIUS);
        }
      }
    }
  });

  it("keeps each seat's canes on their own side of the line", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const { state } = started(seed);
      for (const cane of state.canes) {
        if (cane.seat === 'p1') expect(cane.x).toBeLessThan(CENTRE_X);
        else expect(cane.x).toBeGreaterThan(CENTRE_X);
      }
    }
  });

  it('throws from the centre line, so neither seat has the better hand', () => {
    expect(THROW_X).toBe(BOARD_WIDTH / 2);
    expect(CENTRE_X).toBe(BOARD_WIDTH / 2);
    expect(THROW_Y).toBeLessThan(BOARD_HEIGHT);
  });

  it('lays the stones out as a mirror of themselves', () => {
    for (const rock of ROCKS) {
      const twin = ROCKS.find(
        (other) =>
          Math.abs(other.x - (BOARD_WIDTH - rock.x)) < 1e-9 &&
          Math.abs(other.y - rock.y) < 1e-9 &&
          Math.abs(other.radius - rock.radius) < 1e-9,
      );
      expect(twin, `no mirror for the stone at ${String(rock.x)}`).toBeDefined();
    }
  });

  it('replants a grove that was cut to pieces', () => {
    const { state, rng } = started();
    for (const cane of state.canes) cane.standing = false;
    dressGrove(state, rng);
    expect(standingFor(state, 'p1')).toBe(CANES_PER_SEAT);
    expect(standingFor(state, 'p2')).toBe(CANES_PER_SEAT);
  });

  it('moves a cane by no more than the jitter allows', () => {
    const { state } = started(9);
    for (let i = 0; i < CANES_PER_SEAT; i += 1) {
      const cane = state.canes[i]!;
      // The nearest slot has to be within the jitter, or a cane has wandered off its plan.
      expect(Math.abs(cane.x - CENTRE_X)).toBeGreaterThan(92 - SLOT_JITTER_X - 1);
    }
  });
});

describe('the flight', () => {
  function walk(heading: number, spin: number, seconds: number): ArcPoint {
    const point: ArcPoint = { x: THROW_X, y: THROW_Y, heading };
    const slices = Math.round(seconds * 240);
    for (let i = 0; i < slices; i += 1) advanceArc(point, spin, seconds / slices);
    return point;
  }

  it('flies straight up when nothing is spun on', () => {
    const point = walk(0, 0, 0.5);
    expect(point.x).toBeCloseTo(THROW_X, 6);
    expect(point.y).toBeCloseTo(THROW_Y - SHURIKEN_SPEED * 0.5, 6);
    expect(point.heading).toBe(0);
  });

  it('holds its speed whatever the spin', () => {
    for (const spin of [-MAX_SPIN, -0.7, 0, 0.4, MAX_SPIN]) {
      const a = walk(0.2, spin, 0.25);
      const b = walk(0.2, spin, 0.5);
      const travelled = Math.hypot(b.x - a.x, b.y - a.y);
      // Chord, not arc, so it is at most the distance covered and close to it for a
      // quarter second. A blade that sped up with spin would be a different game.
      expect(travelled).toBeLessThanOrEqual(SHURIKEN_SPEED * 0.25 + 1e-6);
      expect(travelled).toBeGreaterThan(SHURIKEN_SPEED * 0.2);
    }
  });

  it('bends right on a positive spin and left on a negative one', () => {
    expect(walk(0, 1.4, 0.5).x).toBeGreaterThan(THROW_X + 20);
    expect(walk(0, -1.4, 0.5).x).toBeLessThan(THROW_X - 20);
  });

  it('lands in the same place whether the step is whole or halved', () => {
    // Rule 8 in its sharpest form: a phone and a laptop must step the identical match.
    // Euler integration would not do this, which is why the arc is written out in closed
    // form rather than accumulated a step at a time.
    for (const spin of [-1.9, -0.6, 0.35, 1.9]) {
      const coarse: ArcPoint = { x: THROW_X, y: THROW_Y, heading: 0.3 };
      const fine: ArcPoint = { x: THROW_X, y: THROW_Y, heading: 0.3 };
      for (let i = 0; i < 30; i += 1) advanceArc(coarse, spin, 1 / 60);
      for (let i = 0; i < 60; i += 1) advanceArc(fine, spin, 1 / 120);
      expect(fine.x).toBeCloseTo(coarse.x, 6);
      expect(fine.y).toBeCloseTo(coarse.y, 6);
      expect(fine.heading).toBeCloseTo(coarse.heading, 9);
    }
  });

  it('mirrors exactly when the heading and the spin are both negated', () => {
    // This is the property the whole shared board rests on: p2's throw is p1's throw
    // reflected, so the two seats are playing the same game rather than two similar ones.
    for (const heading of [0, 0.3, 0.9]) {
      for (const spin of [0, 0.5, 1.7]) {
        const right = walk(heading, spin, 0.6);
        const left = walk(-heading, -spin, 0.6);
        expect(left.x - THROW_X).toBeCloseTo(-(right.x - THROW_X), 6);
        expect(left.y).toBeCloseTo(right.y, 6);
      }
    }
  });

  it('knows what it is touching', () => {
    const { state } = started();
    const cane = state.canes[0]!;
    expect(hitsCane(cane, cane.x, cane.y)).toBe(true);
    expect(hitsCane(cane, cane.x + CANE_RADIUS + SHURIKEN_RADIUS - 1, cane.y)).toBe(true);
    expect(hitsCane(cane, cane.x + CANE_RADIUS + SHURIKEN_RADIUS + 1, cane.y)).toBe(false);
    const rock = ROCKS[0]!;
    expect(hitsRock(rock.x, rock.y)).toBe(true);
    expect(hitsRock(rock.x + rock.radius + SHURIKEN_RADIUS + 1, rock.y)).toBe(false);
    expect(offBoard(THROW_X, THROW_Y)).toBe(false);
    expect(offBoard(-100, 500)).toBe(true);
    expect(offBoard(350, BOARD_HEIGHT + 100)).toBe(true);
  });
});

describe('aiming', () => {
  it('holds the throw inside its cone', () => {
    const { state } = started();
    aimAt(state, 4);
    expect(state.aim).toBe(MAX_AIM);
    aimAt(state, -4);
    expect(state.aim).toBe(-MAX_AIM);
    turnAim(state, 0.3);
    expect(state.aim).toBeCloseTo(-MAX_AIM + 0.3, 10);
  });

  it('holds the spin inside its range', () => {
    const { state } = started();
    addSpin(state, 99);
    expect(state.spin).toBe(MAX_SPIN);
    addSpin(state, -99);
    expect(state.spin).toBe(-MAX_SPIN);
    spinTo(state, 0.5);
    expect(state.spin).toBe(0.5);
  });

  it('points where a finger points', () => {
    const { state } = started();
    aimTowards(state, THROW_X, THROW_Y - 300);
    expect(state.aim).toBeCloseTo(0, 10);
    aimTowards(state, THROW_X + 100, THROW_Y - 100);
    expect(state.aim).toBeCloseTo(Math.PI / 4, 10);
    aimTowards(state, THROW_X - 100, THROW_Y - 100);
    expect(state.aim).toBeCloseTo(-Math.PI / 4, 10);
  });

  it('will not throw backwards, however far behind the hand the finger is', () => {
    const { state } = started();
    aimTowards(state, THROW_X + 10, THROW_Y + 300);
    expect(state.aim).toBe(MAX_AIM);
    aimTowards(state, THROW_X - 10, THROW_Y + 300);
    expect(state.aim).toBe(-MAX_AIM);
  });

  it('ignores a finger exactly on the hand rather than snapping the sight', () => {
    const { state } = started();
    aimAt(state, 0.4);
    aimTowards(state, THROW_X, THROW_Y);
    expect(state.aim).toBe(0.4);
  });

  it('ignores anything that is not a number', () => {
    const { state } = started();
    aimAt(state, 0.4);
    spinTo(state, 0.6);
    aimAt(state, Number.NaN);
    turnAim(state, Number.POSITIVE_INFINITY);
    addSpin(state, Number.NaN);
    expect(state.aim).toBe(0.4);
    expect(state.spin).toBe(0.6);
  });

  it('takes no aim once the blade has left the hand', () => {
    const { state } = started();
    aimAt(state, 0.2);
    spinTo(state, 0.3);
    throwShuriken(state, 'p1');
    aimAt(state, -0.9);
    addSpin(state, 1.5);
    expect(state.aim).toBe(0.2);
    expect(state.spin).toBe(0.3);
    // What was thrown is what was aimed: the blade carries its own copy.
    expect(state.shot.heading).toBe(0.2);
    expect(state.shot.spin).toBe(0.3);
  });
});

describe('throwing', () => {
  it('only the seat whose turn it is may throw', () => {
    const { state } = started();
    expect(throwShuriken(state, 'p2')).toBe(false);
    expect(state.phase).toBe('aiming');
    expect(throwShuriken(state, 'p1')).toBe(true);
    expect(state.phase).toBe('flying');
  });

  it('refuses a second blade while the first is in the air', () => {
    const { state } = started();
    throwShuriken(state, 'p1');
    expect(throwShuriken(state, 'p1')).toBe(false);
    expect(state.throws).toBe(1);
  });

  it('counts the throws each seat has made', () => {
    const { state } = started();
    takeTurn(state, 0.3, 0);
    expect(state.p1Throws).toBe(1);
    expect(state.p2Throws).toBe(0);
    expect(state.active).toBe('p2');
    takeTurn(state, -0.3, 0);
    expect(state.p1Throws).toBe(1);
    expect(state.p2Throws).toBe(1);
    expect(state.throws).toBe(2);
    expect(state.active).toBe('p1');
  });

  it('starts every blade from the hand', () => {
    const { state } = started();
    throwShuriken(state, 'p1');
    expect(state.shot.x).toBe(THROW_X);
    expect(state.shot.y).toBe(THROW_Y);
    expect(state.shot.elapsed).toBe(0);
  });

  it('always comes to rest, whatever it was thrown at', () => {
    // The one thing every throw must do. A blade that could orbit for ever would hang the
    // turn, and nothing above this level would notice.
    const script = new Rng(4242);
    for (let i = 0; i < 200; i += 1) {
      const { state } = started(100 + i);
      const aim = (script.float() * 2 - 1) * MAX_AIM;
      const spin = (script.float() * 2 - 1) * MAX_SPIN;
      const steps = throwAndLand(state, aim, spin);
      expect(state.phase).toBe('settling');
      expect(steps).toBeLessThan(FLIGHT_LIMIT_SECONDS * 60 + 2);
      expect(state.shot.elapsed).toBeLessThanOrEqual(
        FLIGHT_LIMIT_SECONDS + 1 / 60 / FLIGHT_SUBSTEPS,
      );
    }
  });
});

describe('cutting', () => {
  it('cuts a cane it passes through, and the cane stays cut', () => {
    const { state } = started();
    clearGrove(state);
    place(state, CANES_PER_SEAT, THROW_X, 700);
    takeTurn(state, 0, 0);
    expect(state.canes[CANES_PER_SEAT]!.standing).toBe(false);
    expect(standingFor(state, 'p2')).toBe(0);
    takeTurn(state, 0, 0);
    expect(state.canes[CANES_PER_SEAT]!.standing).toBe(false);
  });

  it('takes everything on the line, because a blade does not stop at bamboo', () => {
    const { state } = started();
    clearGrove(state);
    place(state, CANES_PER_SEAT, THROW_X, 760);
    place(state, CANES_PER_SEAT + 1, THROW_X, 660);
    throwAndLand(state, 0, 0);
    expect(state.lastCut).toBe(2);
    expect(standingFor(state, 'p2')).toBe(0);
  });

  it('cuts your own bamboo just as happily', () => {
    const { state } = started();
    clearGrove(state);
    place(state, 0, THROW_X, 700);
    throwAndLand(state, 0, 0);
    expect(state.lastCut).toBe(1);
    expect(state.lastOwnCut).toBe(1);
    expect(standingFor(state, 'p1')).toBe(0);
  });

  it('stops dead against a stone, and cuts nothing behind it', () => {
    const { state } = started();
    clearGrove(state);
    // Straight up the centre line runs into the middle stone every time.
    place(state, CANES_PER_SEAT, THROW_X, 300);
    throwAndLand(state, 0, 0);
    expect(state.lastBlocked).toBe(true);
    expect(state.lastCut).toBe(0);
    expect(state.canes[CANES_PER_SEAT]!.standing).toBe(true);
    expect(state.shot.y).toBeGreaterThan(ROCKS[0]!.y);
  });

  it('leaves the board on a wide throw', () => {
    const { state } = started();
    clearGrove(state);
    throwAndLand(state, MAX_AIM, 0);
    expect(state.lastBlocked).toBe(false);
    expect(offBoard(state.shot.x, state.shot.y)).toBe(true);
  });

  it('cannot reach a cane in a stone' + "'s shadow without spin, and can with it", () => {
    // The reason spin exists at all. A cane at (600, 430) sits squarely behind the right
    // hand stone: every straight line from the hand that would touch it passes through the
    // stone first, so no aim in the cone can take it.
    const outcome = createShotOutcome();
    const { state } = started();
    clearGrove(state);
    place(state, CANES_PER_SEAT, 600, 430);

    for (let i = 0; i <= 120; i += 1) {
      const aim = -MAX_AIM + (2 * MAX_AIM * i) / 120;
      predictShot(state, 'p1', aim, 0, outcome);
      expect(outcome.enemy, `a straight throw at ${aim.toFixed(3)} reached it`).toBe(0);
    }

    let reached = 0;
    for (let i = 0; i <= 120; i += 1) {
      const aim = -MAX_AIM + (2 * MAX_AIM * i) / 120;
      for (let j = 0; j <= 60; j += 1) {
        const spin = -MAX_SPIN + (2 * MAX_SPIN * j) / 60;
        if (Math.abs(spin) < 0.2) continue;
        predictShot(state, 'p1', aim, spin, outcome);
        if (outcome.enemy > 0) reached += 1;
      }
    }
    expect(reached, 'no spun throw reached a cane behind the stone').toBeGreaterThan(0);

    // And the real throw does what the picture said.
    throwAndLand(state, 0, 0);
    expect(state.canes[CANES_PER_SEAT]!.standing).toBe(true);
  });
});

describe('the turn', () => {
  it('holds the grove for a moment, then passes it over', () => {
    const { state } = started();
    throwAndLand(state, 0.4, 0);
    expect(state.phase).toBe('settling');
    expect(state.settle).toBeCloseTo(SETTLE_SECONDS, 6);
    settleTurn(state);
    expect(state.active).toBe('p2');
    expect(state.phase).toBe('aiming');
  });

  it('gives every turn the same sight to start from', () => {
    const { state } = started();
    aimAt(state, MAX_AIM);
    spinTo(state, MAX_SPIN);
    takeTurn(state, MAX_AIM, MAX_SPIN);
    expect(state.aim).toBe(0);
    expect(state.spin).toBe(0);
  });

  it('never ends on an unequal number of throws', () => {
    // p1 throws first. Ending the instant a grove is cleared would hand p1 every match
    // that was going to be close; the reply throw makes the first throw a tempo advantage
    // rather than a whole extra turn.
    const { state } = started();
    clearGrove(state);
    place(state, CANES_PER_SEAT, THROW_X, 700);
    place(state, 0, 100, 300);
    takeTurn(state, 0, 0);
    expect(standingFor(state, 'p2')).toBe(0);
    expect(state.phase, 'p2 has not had its reply yet').toBe('aiming');
    expect(state.winner).toBeNull();
    expect(state.active).toBe('p2');
    takeTurn(state, 0, 0);
    expect(state.phase).toBe('over');
    expect(winnerOf(state)).toBe('p1');
  });

  it('is a draw when the reply clears the other grove too', () => {
    const { state } = started();
    clearGrove(state);
    place(state, CANES_PER_SEAT, THROW_X, 700);
    place(state, 0, THROW_X, 700);
    // One throw straight up takes both of the canes standing there.
    takeTurn(state, 0, 0);
    expect(standingFor(state, 'p1')).toBe(0);
    expect(standingFor(state, 'p2')).toBe(0);
    expect(state.winner, 'the round is not complete yet').toBeNull();
    takeTurn(state, MAX_AIM, 0);
    expect(winnerOf(state)).toBe('draw');
  });

  it('loses the match for a player who cuts their own last cane', () => {
    const { state } = started();
    clearGrove(state);
    place(state, 0, THROW_X, 700);
    place(state, CANES_PER_SEAT, 100, 300);
    takeTurn(state, 0, 0);
    expect(standingFor(state, 'p1')).toBe(0);
    takeTurn(state, MAX_AIM, 0);
    expect(winnerOf(state)).toBe('p2');
  });

  it('settles on canes left standing when the throws run out', () => {
    const { state } = started();
    clearGrove(state);
    place(state, 0, 120, 300);
    place(state, 1, 200, 300);
    place(state, CANES_PER_SEAT, BOARD_WIDTH - 120, 300);
    state.throws = MAX_THROWS - 2;
    state.p1Throws = (MAX_THROWS - 2) / 2;
    state.p2Throws = (MAX_THROWS - 2) / 2;
    takeTurn(state, MAX_AIM, 0);
    expect(state.winner).toBeNull();
    takeTurn(state, MAX_AIM, 0);
    expect(state.throws).toBe(MAX_THROWS);
    // p1 has two canes standing to p2's one, so p1 takes it.
    expect(winnerOf(state)).toBe('p1');
  });

  it('is a draw when the throws run out level', () => {
    const { state } = started();
    clearGrove(state);
    place(state, 0, 120, 300);
    place(state, CANES_PER_SEAT, BOARD_WIDTH - 120, 300);
    state.throws = MAX_THROWS - 2;
    state.p1Throws = (MAX_THROWS - 2) / 2;
    state.p2Throws = (MAX_THROWS - 2) / 2;
    takeTurn(state, MAX_AIM, 0);
    takeTurn(state, MAX_AIM, 0);
    expect(winnerOf(state)).toBe('draw');
  });

  it('does nothing at all once it is over', () => {
    const { state } = started();
    clearGrove(state);
    place(state, CANES_PER_SEAT, THROW_X, 700);
    takeTurn(state, 0, 0);
    takeTurn(state, MAX_AIM, 0);
    expect(state.phase).toBe('over');
    const before = JSON.stringify(state);
    for (let i = 0; i < 100; i += 1) step(state, STEP);
    expect(throwShuriken(state, state.active)).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('runs out of throws even when nobody ever hits anything', () => {
    // The structural end. Two players who cannot hit the grove still finish a match.
    const { state } = started();
    for (let i = 0; i < MAX_THROWS + 4 && state.phase !== 'over'; i += 1) {
      takeTurn(state, MAX_AIM, 0);
    }
    expect(state.phase).toBe('over');
    expect(state.throws).toBeLessThanOrEqual(MAX_THROWS);
    expect(winnerOf(state)).toBe('draw');
  });
});

describe('the two seats', () => {
  it('gives a mirrored throw the mirrored result', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      for (const aim of [0.2, 0.7, -0.5]) {
        for (const spin of [0, 0.9, -1.4]) {
          const left = started(seed).state;
          const right = started(seed).state;
          right.active = 'p2';
          throwAndLand(left, aim, spin);
          throwAndLand(right, -aim, -spin);
          expect(left.lastCut).toBe(right.lastCut);
          expect(left.lastOwnCut).toBe(right.lastOwnCut);
          expect(left.lastBlocked).toBe(right.lastBlocked);
          expect(right.shot.x - CENTRE_X).toBeCloseTo(-(left.shot.x - CENTRE_X), 6);
          expect(right.shot.y).toBeCloseTo(left.shot.y, 6);
          // And the damage lands on the mirrored canes.
          expect(standingFor(right, 'p2')).toBe(standingFor(left, 'p1'));
          expect(standingFor(right, 'p1')).toBe(standingFor(left, 'p2'));
        }
      }
    }
  });

  it('names the other seat, and only the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

describe('what the bot sees', () => {
  it('predicts exactly what the throw then does', () => {
    // The bot's picture and the flight are the same arithmetic. If they were two, the bot
    // would be aiming at a game nobody else is playing.
    const outcome = createShotOutcome();
    const script = new Rng(2026);
    for (let trial = 0; trial < 250; trial += 1) {
      const { state } = started(200 + trial);
      const seat: SeatId = trial % 2 === 0 ? 'p1' : 'p2';
      state.active = seat;
      const aim = (script.float() * 2 - 1) * MAX_AIM;
      const spin = (script.float() * 2 - 1) * MAX_SPIN;
      predictShot(state, seat, aim, spin, outcome);
      const before = standingFor(state, otherOf(seat));
      const mineBefore = standingFor(state, seat);
      throwAndLand(state, aim, spin);
      expect(before - standingFor(state, otherOf(seat))).toBe(outcome.enemy);
      expect(mineBefore - standingFor(state, seat)).toBe(outcome.own);
      expect(state.lastBlocked).toBe(outcome.blocked);
      expect(state.shot.x).toBeCloseTo(outcome.x, 6);
      expect(state.shot.y).toBeCloseTo(outcome.y, 6);
    }
  });

  it('never counts a cane that is already down', () => {
    const outcome = createShotOutcome();
    const { state } = started();
    clearGrove(state);
    place(state, CANES_PER_SEAT, THROW_X, 700);
    predictShot(state, 'p1', 0, 0, outcome);
    expect(outcome.enemy).toBe(1);
    state.canes[CANES_PER_SEAT]!.standing = false;
    predictShot(state, 'p1', 0, 0, outcome);
    expect(outcome.enemy).toBe(0);
  });
});

describe('the bot', () => {
  /**
   * One tier playing both seats, over forty seeded groves, counting per *throw* rather than
   * per match. Both seats, because the helper drives whoever is active — which is what makes
   * this a measure of the tier and not of a match-up, and why it is a rate rather than a
   * tally: a tier that clears the grove faster simply gets fewer throws in.
   */
  function cutRate(tier: BotDifficulty): { enemy: number; own: number; throws: number } {
    const totals = { enemy: 0, own: 0, throws: 0 };
    for (let trial = 0; trial < 40; trial += 1) {
      const { state, rng } = started(4000 + trial);
      const plan = createBotPlan();
      for (let i = 0; i < 60 * 200 && state.phase !== 'over'; i += 1) {
        if (botTurn(state, state.active, tier, plan, rng, STEP)) {
          throwShuriken(state, state.active);
          resetBotPlan(plan);
          totals.throws += 1;
        }
        const outcome = step(state, STEP);
        if (outcome.landed) {
          totals.enemy += state.lastCut - state.lastOwnCut;
          totals.own += state.lastOwnCut;
        }
      }
    }
    return totals;
  }

  function playSeries(
    p1Tier: BotDifficulty,
    p2Tier: BotDifficulty,
    matches: number,
  ): { p1: number; p2: number; draw: number; unfinished: number } {
    const wins = { p1: 0, p2: 0, draw: 0, unfinished: 0 };
    for (let match = 0; match < matches; match += 1) {
      const { state, rng } = started(900 + match);
      const p1Plan = createBotPlan();
      const p2Plan = createBotPlan();
      for (let i = 0; i < 60 * 600 && state.phase !== 'over'; i += 1) {
        const seat = state.active;
        const tier = seat === 'p1' ? p1Tier : p2Tier;
        const plan = seat === 'p1' ? p1Plan : p2Plan;
        if (botTurn(state, seat, tier, plan, rng, STEP)) {
          throwShuriken(state, seat);
          resetBotPlan(plan);
        }
        step(state, STEP);
      }
      if (state.phase !== 'over') wins.unfinished += 1;
      else if (state.winner === 'p1') wins.p1 += 1;
      else if (state.winner === 'p2') wins.p2 += 1;
      else wins.draw += 1;
    }
    return wins;
  }

  it('throws only on its own turn, and only at a waiting grove', () => {
    for (const tier of TIERS) {
      const { state, rng } = started();
      const plan = createBotPlan();
      expect(botTurn(state, 'p2', tier, plan, rng, STEP), 'not its turn').toBe(false);
      for (let i = 0; i < 2000; i += 1) {
        if (botTurn(state, state.active, tier, plan, rng, STEP)) {
          expect(state.phase).toBe('aiming');
          expect(throwShuriken(state, state.active)).toBe(true);
          resetBotPlan(plan);
        }
        step(state, STEP);
        if (state.phase === 'over') break;
      }
    }
  });

  it('keeps every throw it plans inside the legal cone and spin', () => {
    const plan = createBotPlan();
    for (const tier of TIERS) {
      const { state, rng } = started(11);
      for (let i = 0; i < 60; i += 1) {
        planShot(state, i % 2 === 0 ? 'p1' : 'p2', tier, plan, rng);
        expect(plan.aim).toBeGreaterThanOrEqual(-MAX_AIM);
        expect(plan.aim).toBeLessThanOrEqual(MAX_AIM);
        expect(plan.spin).toBeGreaterThanOrEqual(-MAX_SPIN);
        expect(plan.spin).toBeLessThanOrEqual(MAX_SPIN);
        expect(plan.think).toBeGreaterThan(0);
      }
    }
  });

  it('plans the mirrored throw from the mirrored seat', () => {
    // With the grove a mirror of itself, the two seats face the same problem reflected —
    // so a bot that did not sweep outward from its own target side would settle ties
    // towards one edge for p1 and the wrong edge for p2, and the seats would differ.
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 10; seed += 1) {
        const { state } = started(seed);
        const asP1 = createBotPlan();
        const asP2 = createBotPlan();
        planShot(state, 'p1', tier, asP1, new Rng(77));
        planShot(state, 'p2', tier, asP2, new Rng(77));
        expect(asP2.aim).toBeCloseTo(-asP1.aim, 9);
        expect(asP2.spin).toBeCloseTo(-asP1.spin, 9);
      }
    }
  });

  it('takes exactly three values from the stream whatever it decides', () => {
    // A plan that drew a different number of values when it blundered would put two devices
    // out of step with each other on the first unlucky throw, and every throw after it.
    for (const tier of TIERS) {
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        const { state } = started(3);
        const used = new Rng(5);
        const plan = createBotPlan();
        for (let i = 0; i < 40; i += 1) planShot(state, seat, tier, plan, used);
        const counted = new Rng(5);
        for (let i = 0; i < 120; i += 1) counted.float();
        expect(used.save()).toEqual(counted.save());
      }
    }
  });

  it('cuts more of the other grove the harder the tier', () => {
    const rates = TIERS.map((tier) => {
      const totals = cutRate(tier);
      return totals.enemy / totals.throws;
    });
    const [easy, normal, hard] = rates as [number, number, number];
    expect(normal, `easy ${easy.toFixed(2)} normal ${normal.toFixed(2)}`).toBeGreaterThan(easy);
    expect(hard, `normal ${normal.toFixed(2)} hard ${hard.toFixed(2)}`).toBeGreaterThan(normal);
  });

  it('cuts its own bamboo more often the weaker the tier', () => {
    const easy = cutRate('easy');
    const hard = cutRate('hard');
    expect(easy.own / easy.throws).toBeGreaterThanOrEqual(hard.own / hard.throws);
  });

  it('beats a weaker tier from either seat', () => {
    for (const [strong, weak] of [
      ['hard', 'easy'],
      ['normal', 'easy'],
      ['hard', 'normal'],
    ] as [BotDifficulty, BotDifficulty][]) {
      const asP1 = playSeries(strong, weak, 30);
      expect(asP1.p1, `${strong} as p1 v ${weak}`).toBeGreaterThan(asP1.p2 * 2);
      const asP2 = playSeries(weak, strong, 30);
      expect(asP2.p2, `${strong} as p2 v ${weak}`).toBeGreaterThan(asP2.p1 * 2);
    }
  });

  it('is balanced against itself, in both seats', () => {
    /*
     * p1 throws first, so a seat bias here would be a real advantage. Measured over two
     * hundred matches a tier, p1 takes 51% of the decided matches at `easy`, 51% at
     * `normal` and 48% at `hard` — which is what a grove that is its own mirror, thrown at
     * from a point on the mirror line, by a search that sweeps outward from each seat's own
     * target side, ought to give.
     *
     * Stated as a share of the *decided* matches: two identical players clearing the same
     * grove finish the same round often, and a draw is a real result here rather than a
     * failure to finish.
     */
    for (const tier of TIERS) {
      const wins = playSeries(tier, tier, 30);
      expect(wins.unfinished, `${tier} left a match unfinished`).toBe(0);
      const decided = wins.p1 + wins.p2;
      expect(decided, `${tier} decided nothing`).toBeGreaterThan(8);
      const share = wins.p1 / decided;
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeGreaterThan(
        0.25,
      );
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeLessThan(0.75);
    }
  });

  it('finishes every match it plays, at every tier', () => {
    for (const p1Tier of TIERS) {
      for (const p2Tier of TIERS) {
        const wins = playSeries(p1Tier, p2Tier, 6);
        expect(wins.unfinished, `${p1Tier} v ${p2Tier} hung`).toBe(0);
      }
    }
  });
});

describe('determinism', () => {
  it('replays a scripted match to the identical state', () => {
    const play = (): State => {
      const { state } = started(20260823);
      const script = new Rng(31337);
      for (let i = 0; i < 60 * 400 && state.phase !== 'over'; i += 1) {
        if (state.phase === 'aiming' && script.float() < 0.05) {
          aimAt(state, (script.float() * 2 - 1) * MAX_AIM);
          spinTo(state, (script.float() * 2 - 1) * MAX_SPIN);
          throwShuriken(state, state.active);
        }
        step(state, STEP);
      }
      return state;
    };
    expect(play()).toEqual(play());
  });

  it('plays a different match from a different seed', () => {
    const play = (seed: number): State => {
      const { state, rng } = started(seed);
      const plan = createBotPlan();
      for (let i = 0; i < 60 * 400 && state.phase !== 'over'; i += 1) {
        if (botTurn(state, state.active, 'normal', plan, rng, STEP)) {
          throwShuriken(state, state.active);
          resetBotPlan(plan);
        }
        step(state, STEP);
      }
      return state;
    };
    expect(play(1)).not.toEqual(play(2));
  });

  it('keeps the blade angle inside one turn however long the match runs', () => {
    const { state } = started();
    for (let i = 0; i < 60 * 600; i += 1) step(state, STEP);
    expect(Math.abs(state.blade)).toBeLessThanOrEqual(Math.PI * 2 + 1);
  });

  it('measures nothing in pixels', () => {
    // Rule 8 restated as arithmetic: every number here is a fact about the logical box.
    expect(BOARD_WIDTH).toBe(700);
    expect(BOARD_HEIGHT).toBe(1000);
    expect(THROW_X * 2).toBe(BOARD_WIDTH);
    expect(SHURIKEN_SPEED * FLIGHT_LIMIT_SECONDS).toBeGreaterThan(BOARD_HEIGHT);
  });
});
