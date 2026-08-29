import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  AIR_THRESHOLD,
  BALLS_PER_INNINGS,
  BAT_AIM_SPAN,
  BAT_REACH,
  BOUNDARY_R,
  CATCH_RADIUS,
  BOT_PROFILES,
  CONTACT_FLOOR,
  FIELDERS,
  GROUND_CX,
  GROUND_CY,
  HEIGHT_MAX,
  HEIGHT_MIN,
  MAX_AIM_ANGLE,
  PACE_MAX,
  PACE_MIN,
  PITCH_AT,
  RANGE_BASE,
  RELEASE_DISTANCE,
  RELEASE_Y,
  STUMP_HALF_WIDTH,
  SKY_THRESHOLD,
  STUMP_HEIGHT,
  SWING_WINDOW,
  WICKETS_PER_INNINGS,
  WIDE_HALF_WIDTH,
  aimForBatX,
  arrivalHeight,
  arrivalX,
  ballX,
  ballY,
  battingSeat,
  botAim,
  botBatX,
  botBowl,
  botTimingError,
  bowlingSeat,
  contactQuality,
  countsAsBall,
  createDelivery,
  createInnings,
  createShot,
  flightSeconds,
  gaussian,
  heightAt,
  inningsComplete,
  isDismissal,
  isWide,
  nearestFielderDistance,
  recordBall,
  resetInnings,
  resolveShot,
  rollSwing,
  runsFor,
  runsForRange,
  scoreMiss,
  scoreShot,
  shotLandingX,
  shotLandingY,
  swingFraction,
  widestGapAngle,
  winnerOf,
} from './rules.js';
import type { BallOutcome, BotDifficulty, BotProfile, Delivery, InningsState } from './rules.js';

/** A delivery stated as data, so a test never has to bowl one to describe it. */
function delivery(over: Partial<Delivery> = {}): Delivery {
  return { ...createDelivery(), pace: 420, ...over };
}

describe('the flight', () => {
  it('leaves the hand on the stumps and arrives on the line the bowler chose', () => {
    const ball = delivery({ line: GROUND_CX + 40, swing: 0 });
    expect(ballX(ball, 0)).toBe(GROUND_CX);
    expect(ballX(ball, 1)).toBeCloseTo(GROUND_CX + 40, 6);
    expect(arrivalX(ball)).toBeCloseTo(GROUND_CX + 40, 6);
  });

  it('adds the whole of the swing by the time the ball arrives, and none of it at release', () => {
    const ball = delivery({ line: GROUND_CX, swing: 30 });
    expect(ballX(ball, 0)).toBe(GROUND_CX);
    expect(arrivalX(ball)).toBeCloseTo(GROUND_CX + 30, 6);
  });

  it('moves the ball late rather than evenly, which is what makes swing worth watching', () => {
    // Quadratic: at the halfway point a linear drift would have moved half the swing.
    expect(swingFraction(0.5)).toBeCloseTo(0.25, 6);
    expect(swingFraction(0.5)).toBeLessThan(0.5);
  });

  it('clamps progress at both ends rather than extrapolating off the pitch', () => {
    const ball = delivery({ line: GROUND_CX + 50, swing: 20 });
    expect(ballX(ball, -3)).toBe(ballX(ball, 0));
    expect(ballX(ball, 9)).toBe(ballX(ball, 1));
    expect(ballY(-3)).toBe(RELEASE_Y);
    expect(ballY(9)).toBe(RELEASE_Y + RELEASE_DISTANCE);
    expect(swingFraction(-1)).toBe(0);
    expect(swingFraction(4)).toBe(1);
  });

  it('runs down the pitch from the release point to the striker', () => {
    expect(ballY(0)).toBe(RELEASE_Y);
    expect(ballY(1)).toBe(GROUND_CY);
  });

  it('takes longer at slow pace than at fast, and never divides by a bad pace', () => {
    expect(flightSeconds(delivery({ pace: PACE_MIN }))).toBeGreaterThan(
      flightSeconds(delivery({ pace: PACE_MAX })),
    );
    expect(flightSeconds(delivery({ pace: 0 }))).toBe(RELEASE_DISTANCE / PACE_MIN);
    expect(flightSeconds(delivery({ pace: -5 }))).toBeGreaterThan(0);
  });
});

describe('length', () => {
  it('spans the yorker and the bouncer, and clamps outside', () => {
    expect(arrivalHeight(delivery({ length: 0 }))).toBeCloseTo(HEIGHT_MIN, 6);
    expect(arrivalHeight(delivery({ length: 1 }))).toBeCloseTo(HEIGHT_MAX, 6);
    expect(arrivalHeight(delivery({ length: -2 }))).toBeCloseTo(HEIGHT_MIN, 6);
    expect(arrivalHeight(delivery({ length: 4 }))).toBeCloseTo(HEIGHT_MAX, 6);
  });

  it('only a full ball can hit the stumps; a short one passes over them', () => {
    expect(arrivalHeight(delivery({ length: 0 }))).toBeLessThan(STUMP_HEIGHT);
    expect(arrivalHeight(delivery({ length: 1 }))).toBeGreaterThan(STUMP_HEIGHT);
  });

  it('pitches on the way through: down to the ground, then up to the arrival height', () => {
    const ball = delivery({ length: 0.8 });
    expect(heightAt(ball, 0)).toBeCloseTo(STUMP_HEIGHT, 6);
    expect(heightAt(ball, PITCH_AT)).toBeCloseTo(0, 6);
    expect(heightAt(ball, 1)).toBeCloseTo(arrivalHeight(ball), 6);
    // Rising once it has pitched, so the striker can read the length off the screen.
    expect(heightAt(ball, 0.85)).toBeGreaterThan(heightAt(ball, 0.75));
  });
});

describe('wides', () => {
  it('calls a ball wide exactly outside the line, and not on it', () => {
    expect(isWide(delivery({ line: GROUND_CX + WIDE_HALF_WIDTH }))).toBe(false);
    expect(isWide(delivery({ line: GROUND_CX + WIDE_HALF_WIDTH + 0.5 }))).toBe(true);
    expect(isWide(delivery({ line: GROUND_CX - WIDE_HALF_WIDTH - 0.5 }))).toBe(true);
  });

  it('judges the wide on where the ball arrived, not on where it was aimed', () => {
    // Aimed at the stumps, swung a long way away: that is a wide, as it is on a field.
    const swung = delivery({ line: GROUND_CX, swing: WIDE_HALF_WIDTH + 10 });
    expect(isWide(swung)).toBe(true);
  });

  it('is re-bowled rather than counted, and gives the batting side a run', () => {
    expect(countsAsBall('wide')).toBe(false);
    expect(runsFor('wide')).toBe(1);
    expect(countsAsBall('dot')).toBe(true);
    expect(countsAsBall('bowled')).toBe(true);
  });

  it('rolls swing inside its band and scales it with pace', () => {
    const rng = new Rng(7);
    const slow = delivery({ pace: PACE_MIN });
    const fast = delivery({ pace: PACE_MAX });
    let slowTotal = 0;
    let fastTotal = 0;
    for (let i = 0; i < 400; i += 1) {
      rollSwing(slow, rng);
      rollSwing(fast, rng);
      slowTotal += Math.abs(slow.swing);
      fastTotal += Math.abs(fast.swing);
    }
    expect(fastTotal).toBeGreaterThan(slowTotal);
  });
});

describe('meeting the ball', () => {
  it('middles it only when the timing and the placement are both perfect', () => {
    expect(contactQuality(0, 0)).toBe(1);
  });

  it('is a product, so being in the right place at the wrong moment is still a miss', () => {
    expect(contactQuality(SWING_WINDOW, 0)).toBe(0);
    expect(contactQuality(0, BAT_REACH)).toBe(0);
    expect(contactQuality(SWING_WINDOW * 2, 0)).toBe(0);
    expect(contactQuality(0, -BAT_REACH * 3)).toBe(0);
  });

  it('degrades smoothly inside both tolerances', () => {
    const half = contactQuality(SWING_WINDOW / 2, 0);
    expect(half).toBeCloseTo(0.5, 6);
    expect(contactQuality(SWING_WINDOW / 2, BAT_REACH / 2)).toBeCloseTo(0.25, 6);
  });

  it('treats early and late, off side and leg, alike', () => {
    expect(contactQuality(0.04, 10)).toBeCloseTo(contactQuality(-0.04, -10), 12);
  });

  it('scores a NaN as a miss rather than propagating it into the shot', () => {
    expect(contactQuality(Number.NaN, 0)).toBe(0);
    expect(contactQuality(0, Number.NaN)).toBe(0);
  });
});

describe('where a shot goes', () => {
  it('ties direction to where the bat met the ball, and clamps at square', () => {
    expect(aimForBatX(GROUND_CX)).toBe(0);
    expect(aimForBatX(GROUND_CX + BAT_AIM_SPAN)).toBeCloseTo(MAX_AIM_ANGLE, 6);
    expect(aimForBatX(GROUND_CX - BAT_AIM_SPAN)).toBeCloseTo(-MAX_AIM_ANGLE, 6);
    // Nobody hits behind themselves a ball they met in front.
    expect(aimForBatX(GROUND_CX + BAT_AIM_SPAN * 9)).toBeCloseTo(MAX_AIM_ANGLE, 6);
    expect(Math.abs(aimForBatX(GROUND_CX - 5000))).toBeLessThanOrEqual(MAX_AIM_ANGLE);
  });

  it('sends a middled ball further than a mishit', () => {
    const good = createShot();
    const bad = createShot();
    resolveShot(good, 1, 0, delivery());
    resolveShot(bad, 0.2, 0, delivery());
    expect(good.range).toBeGreaterThan(bad.range);
  });

  it('never pays for mistiming: range rises with contact quality, at every ball', () => {
    // The defect this asserts against was real and it inverted the bot ladder. Loft was one
    // number, it came mostly from mishitting, and range was *multiplied* by it - so the
    // model paid for the mistake it exists to punish, and the tier that middled the most
    // scored the least. Range is now a product of three factors that all rise with quality.
    const shot = createShot();
    for (const length of [0, 0.3, 0.6, 1]) {
      for (const pace of [PACE_MIN, 420, PACE_MAX]) {
        const ball = delivery({ length, pace });
        let previous = -1;
        for (let q = 0; q <= 1.0001; q += 0.02) {
          resolveShot(shot, q, 0, ball);
          expect(shot.range).toBeGreaterThan(previous);
          previous = shot.range;
        }
      }
    }
  });

  it('sends a mishit up and nowhere, not up and further', () => {
    const shot = createShot();
    // A total mishit off a good-length ball: steepling, and not worth a single run.
    resolveShot(shot, 0.02, 0, delivery({ length: 0.3 }));
    expect(shot.loft).toBeGreaterThan(SKY_THRESHOLD);
    expect(shot.range).toBeLessThan(RANGE_BASE);
    expect(runsForRange(shot.range)).toBe(0);
  });

  it('makes carry the only route to the rope, and never a mishit', () => {
    const shot = createShot();
    // A middled pull off a bouncer clears the rope in the air. That is a six.
    resolveShot(shot, 1, 0, delivery({ length: 1, pace: PACE_MAX }));
    expect(shot.range).toBeGreaterThanOrEqual(BOUNDARY_R);
    expect(shot.loft).toBeGreaterThan(AIR_THRESHOLD);
    expect(scoreShot(shot)).toBe('six');
    // Nothing a mishit can be given reaches the rope, whatever the length or the pace.
    for (const length of [0, 0.3, 0.6, 1]) {
      for (const q of [0.05, 0.2, 0.4]) {
        resolveShot(shot, q, 0, delivery({ length, pace: PACE_MAX }));
        expect(shot.range).toBeLessThan(BOUNDARY_R);
      }
    }
  });

  it('puts a mishit in the air and keeps a middled ball down', () => {
    const good = createShot();
    const bad = createShot();
    const full = delivery({ length: 0 });
    resolveShot(good, 1, 0, full);
    resolveShot(bad, 0.1, 0, full);
    expect(good.loft).toBeLessThan(bad.loft);
  });

  it('lofts a short ball more than a full one at the same quality', () => {
    const short = createShot();
    const full = createShot();
    resolveShot(short, 0.8, 0, delivery({ length: 1 }));
    resolveShot(full, 0.8, 0, delivery({ length: 0 }));
    expect(short.loft).toBeGreaterThan(full.loft);
  });

  it('gives a faster ball more to work with off the bat', () => {
    const fast = createShot();
    const slow = createShot();
    resolveShot(fast, 1, 0, delivery({ pace: PACE_MAX }));
    resolveShot(slow, 1, 0, delivery({ pace: PACE_MIN }));
    expect(fast.range).toBeGreaterThan(slow.range);
  });

  it('clamps quality rather than trusting a caller', () => {
    const over = createShot();
    const under = createShot();
    resolveShot(over, 9, 0, delivery());
    resolveShot(under, -4, 0, delivery());
    expect(Number.isFinite(over.range)).toBe(true);
    expect(over.loft).toBeLessThanOrEqual(1);
    expect(under.loft).toBeLessThanOrEqual(1);
    expect(under.range).toBeGreaterThan(0);
  });

  it('sends a straight shot back past the bowler and a square one across', () => {
    const straight = createShot();
    straight.angle = 0;
    straight.range = 100;
    expect(shotLandingX(straight)).toBeCloseTo(GROUND_CX, 6);
    expect(shotLandingY(straight)).toBeCloseTo(GROUND_CY - 100, 6);

    const square = createShot();
    square.angle = Math.PI / 2;
    square.range = 100;
    expect(shotLandingX(square)).toBeCloseTo(GROUND_CX + 100, 6);
    expect(shotLandingY(square)).toBeCloseTo(GROUND_CY, 6);
  });
});

describe('what a ball is worth', () => {
  /** A shot stated as data: no delivery has to be bowled to score one. */
  function shot(range: number, loft: number, angle = 0) {
    const value = createShot();
    value.range = range;
    value.loft = loft;
    value.angle = angle;
    return value;
  }

  it('is six over the rope and four along the ground', () => {
    expect(scoreShot(shot(BOUNDARY_R, 1))).toBe('six');
    expect(scoreShot(shot(BOUNDARY_R + 50, 1))).toBe('six');
    expect(scoreShot(shot(BOUNDARY_R, 0))).toBe('four');
  });

  it('lets nothing catch a ball that has already crossed the rope', () => {
    // Aimed straight at a fielder, but past them: the laws do not care where they stood.
    const straightAtLongOn = Math.atan2(0, 1) * 0;
    expect(scoreShot(shot(BOUNDARY_R + 1, 1, straightAtLongOn))).toBe('six');
  });

  it('is caught when a ball in the air comes down on a fielder', () => {
    const fielder = FIELDERS[0];
    expect(fielder).toBeDefined();
    if (!fielder) return;
    const angle = Math.atan2(fielder.x - GROUND_CX, GROUND_CY - fielder.y);
    const range = Math.hypot(fielder.x - GROUND_CX, fielder.y - GROUND_CY);
    // Deliberately below SKY_THRESHOLD, so this asks about the field rather than about the
    // steepler rule below: a lofted drive, out to a fielder who happened to be under it.
    const lofted = (AIR_THRESHOLD + SKY_THRESHOLD) / 2;
    expect(lofted).toBeLessThan(SKY_THRESHOLD);
    expect(scoreShot(shot(range, lofted, angle))).toBe('caught');
    // The same ball along the ground goes past them for runs instead.
    expect(scoreShot(shot(range, 0, angle))).not.toBe('caught');
  });

  it('catches a steepler wherever it comes down, because somebody gets under it', () => {
    // A top edge lands at the striker's feet, nowhere near a fielding station. Without this
    // rule it would be a dot ball, and a mishit would cost nothing at all.
    const nowhere = shot(20, SKY_THRESHOLD, 0.4);
    expect(nearestFielderDistance(shotLandingX(nowhere), shotLandingY(nowhere))).toBeGreaterThan(
      CATCH_RADIUS,
    );
    expect(scoreShot(nowhere)).toBe('caught');
    // And a ball that is merely in the air, rather than straight up, is not.
    expect(scoreShot(shot(20, SKY_THRESHOLD - 0.01, 0.4))).not.toBe('caught');
  });

  it('does not catch a ball that is barely off the ground', () => {
    const fielder = FIELDERS[0];
    if (!fielder) return;
    const angle = Math.atan2(fielder.x - GROUND_CX, GROUND_CY - fielder.y);
    const range = Math.hypot(fielder.x - GROUND_CX, fielder.y - GROUND_CY);
    expect(scoreShot(shot(range, AIR_THRESHOLD, angle))).not.toBe('caught');
  });

  it('pays more runs the further the ball is pushed', () => {
    expect(runsForRange(0)).toBe(0);
    expect(runsForRange(119)).toBe(0);
    expect(runsForRange(120)).toBe(1);
    expect(runsForRange(200)).toBe(2);
    expect(runsForRange(275)).toBe(3);
    expect(runsForRange(10_000)).toBe(3);
  });

  it('finds the nearest fielder, and reports a real distance from anywhere', () => {
    const fielder = FIELDERS[0];
    if (!fielder) return;
    expect(nearestFielderDistance(fielder.x, fielder.y)).toBeCloseTo(0, 6);
    expect(Number.isFinite(nearestFielderDistance(0, 0))).toBe(true);
  });
});

describe('beating the bat', () => {
  it('bowls the striker with a full ball on the stumps', () => {
    expect(scoreMiss(delivery({ line: GROUND_CX, length: 0 }))).toBe('bowled');
  });

  it('cannot bowl anybody with a ball over the stumps, however straight', () => {
    expect(scoreMiss(delivery({ line: GROUND_CX, length: 1 }))).toBe('dot');
  });

  it('cannot bowl anybody with a ball past the stumps, however full', () => {
    const past = delivery({ line: GROUND_CX + STUMP_HALF_WIDTH + 1, length: 0 });
    expect(scoreMiss(past)).toBe('dot');
  });

  it('hits the stumps right on their edge', () => {
    expect(scoreMiss(delivery({ line: GROUND_CX + STUMP_HALF_WIDTH, length: 0 }))).toBe('bowled');
  });

  it('is a wide before it is anything else', () => {
    const wide = delivery({ line: GROUND_CX + WIDE_HALF_WIDTH + 20, length: 0 });
    expect(scoreMiss(wide)).toBe('wide');
  });

  it('leaves the ball safely, which is why a bowler cannot win by bowling short', () => {
    // The whole reason a striker is allowed to do nothing: it costs runs, never a wicket.
    expect(scoreMiss(delivery({ length: 1, line: GROUND_CX }))).toBe('dot');
    expect(runsFor('dot')).toBe(0);
    expect(isDismissal('dot')).toBe(false);
  });
});

describe('the card', () => {
  it('counts runs, wickets and legal balls', () => {
    const innings = createInnings();
    recordBall(innings, 'four');
    recordBall(innings, 'wide');
    recordBall(innings, 'six');
    recordBall(innings, 'bowled');
    expect(innings.runs).toBe(11);
    expect(innings.wickets).toBe(1);
    expect(innings.balls).toBe(3);
    expect(innings.fours).toBe(1);
    expect(innings.sixes).toBe(1);
  });

  it('ends an innings on the overs or on the wickets, whichever comes first', () => {
    const overs = createInnings();
    for (let i = 0; i < BALLS_PER_INNINGS; i += 1) recordBall(overs, 'dot');
    expect(inningsComplete(overs)).toBe(true);

    const wickets = createInnings();
    for (let i = 0; i < WICKETS_PER_INNINGS; i += 1) recordBall(wickets, 'caught');
    expect(inningsComplete(wickets)).toBe(true);
  });

  it('does not let a stream of wides end an innings', () => {
    const innings = createInnings();
    for (let i = 0; i < 40; i += 1) recordBall(innings, 'wide');
    expect(innings.balls).toBe(0);
    expect(inningsComplete(innings)).toBe(false);
  });

  it('resets to an empty card', () => {
    const innings = createInnings();
    recordBall(innings, 'six');
    recordBall(innings, 'bowled');
    resetInnings(innings);
    expect(innings).toEqual(createInnings());
  });
});

describe('who bats', () => {
  it('gives the first innings to the opener and the second to the other seat', () => {
    expect(battingSeat(0, 'p1')).toBe('p1');
    expect(battingSeat(1, 'p1')).toBe('p2');
    expect(bowlingSeat(0, 'p1')).toBe('p2');
    expect(bowlingSeat(1, 'p1')).toBe('p1');
  });

  it('reads the opener rather than assuming seat one — the fix behind issue #2466', () => {
    expect(battingSeat(0, 'p2')).toBe('p2');
    expect(battingSeat(1, 'p2')).toBe('p1');
    expect(bowlingSeat(0, 'p2')).toBe('p1');
  });

  it('always has one seat batting and the other bowling', () => {
    for (const opener of ['p1', 'p2'] as const) {
      for (let innings = 0; innings < 4; innings += 1) {
        expect(battingSeat(innings, opener)).not.toBe(bowlingSeat(innings, opener));
      }
    }
  });
});

describe('the result', () => {
  function card(over: Partial<InningsState>): InningsState {
    return { ...createInnings(), ...over };
  }

  it('gives it to the bigger total', () => {
    expect(winnerOf(card({ runs: 20 }), card({ runs: 12 }), true)).toBe('p1');
    expect(winnerOf(card({ runs: 4 }), card({ runs: 19 }), true)).toBe('p2');
  });

  it('breaks a tie on boundaries', () => {
    const p1 = card({ runs: 14, fours: 2, sixes: 1 });
    const p2 = card({ runs: 14, fours: 1, sixes: 0 });
    expect(winnerOf(p1, p2, true)).toBe('p1');
  });

  it('calls a match tied on runs and on boundaries a draw, because it is one', () => {
    const p1 = card({ runs: 14, fours: 2 });
    const p2 = card({ runs: 14, fours: 2 });
    expect(winnerOf(p1, p2, true)).toBe('draw');
  });

  it('declares nobody while the match is still on', () => {
    expect(winnerOf(card({ runs: 20 }), card({ runs: 1 }), false)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// The bots
// ---------------------------------------------------------------------------

/**
 * One innings, played by two bots through the pure rules alone.
 *
 * This is the balance harness. It mirrors `game.ts` exactly — the same six calls in the
 * same order — but without a clock or a canvas, so four hundred matches run in a test
 * rather than in an afternoon. The timing error is negated because the game turns the
 * bot's intended instant into a swing time and then measures back from the arrival.
 */
function playInnings(
  bat: BotProfile,
  bowl: BotProfile,
  rng: Rng,
  observe?: (outcome: BallOutcome) => void,
): InningsState {
  const innings = createInnings();
  const ball = createDelivery();
  const shot = createShot();
  let safety = 0;
  while (!inningsComplete(innings) && safety < 400) {
    safety += 1;
    botBowl(ball, bowl, rng);
    rollSwing(ball, rng);
    const batX = botBatX(ball, bat, rng);
    const timingError = -botTimingError(bat, rng);
    const quality = contactQuality(timingError, batX - arrivalX(ball));
    let outcome: BallOutcome;
    if (quality > CONTACT_FLOOR) {
      resolveShot(shot, quality, aimForBatX(batX), ball);
      outcome = scoreShot(shot);
    } else {
      outcome = scoreMiss(ball);
    }
    observe?.(outcome);
    recordBall(innings, outcome);
  }
  return innings;
}

/** Mean runs an innings for a batting tier against a bowling tier, over `matches` innings. */
function meanRuns(bat: BotProfile, bowl: BotProfile, matches: number, seed: number): number {
  const rng = new Rng(seed);
  let total = 0;
  for (let i = 0; i < matches; i += 1) total += playInnings(bat, bowl, rng).runs;
  return total / matches;
}

const TIERS = ['easy', 'normal', 'hard'] as const satisfies readonly BotDifficulty[];

type Ladder = Record<BotDifficulty, Record<BotDifficulty, number>>;

/** Mean runs for every batting tier against every bowling tier: the whole ladder at once. */
function ladder(matches: number, seed: number): Ladder {
  const grid = {} as Ladder;
  for (const bat of TIERS) {
    grid[bat] = {} as Record<BotDifficulty, number>;
    for (const bowl of TIERS) {
      grid[bat][bowl] = meanRuns(BOT_PROFILES[bat], BOT_PROFILES[bowl], matches, seed);
    }
  }
  return grid;
}

/** The share of balls that ended in each outcome, for one tier batting against its own. */
function outcomeMix(tier: BotDifficulty, matches = 1200, seed = 4242): Record<BallOutcome, number> {
  const counts = new Map<BallOutcome, number>();
  const rng = new Rng(seed);
  let balls = 0;
  for (let i = 0; i < matches; i += 1) {
    playInnings(BOT_PROFILES[tier], BOT_PROFILES[tier], rng, (outcome) => {
      counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
      balls += 1;
    });
  }
  const share = {} as Record<BallOutcome, number>;
  for (const outcome of OUTCOMES) share[outcome] = (counts.get(outcome) ?? 0) / balls;
  return share;
}

const OUTCOMES: readonly BallOutcome[] = [
  'dot',
  'one',
  'two',
  'three',
  'four',
  'six',
  'bowled',
  'caught',
  'wide',
];

describe('the bots', () => {
  it('draws a finite normal from the seeded stream, never a log of zero', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 2000; i += 1) expect(Number.isFinite(gaussian(rng))).toBe(true);
  });

  it('bowls inside the laws: a real pace, a length on the scale, a line on the ground', () => {
    const rng = new Rng(11);
    const ball = createDelivery();
    for (const profile of Object.values(BOT_PROFILES)) {
      for (let i = 0; i < 300; i += 1) {
        botBowl(ball, profile, rng);
        expect(ball.length).toBeGreaterThanOrEqual(0);
        expect(ball.length).toBeLessThanOrEqual(1);
        expect(ball.pace).toBeGreaterThanOrEqual(PACE_MIN);
        expect(ball.pace).toBeLessThanOrEqual(PACE_MAX);
        expect(Number.isFinite(ball.line)).toBe(true);
      }
    }
  });

  it('aims at a gap it could actually reach, never behind square', () => {
    for (const profile of Object.values(BOT_PROFILES)) {
      expect(Math.abs(botAim(profile))).toBeLessThanOrEqual(MAX_AIM_ANGLE);
    }
    expect(Number.isFinite(widestGapAngle())).toBe(true);
  });

  it('puts the bat somewhere real, whatever the tier', () => {
    const rng = new Rng(5);
    const ball = delivery({ swing: 30 });
    for (const profile of Object.values(BOT_PROFILES)) {
      for (let i = 0; i < 200; i += 1) {
        expect(Number.isFinite(botBatX(ball, profile, rng))).toBe(true);
        expect(Number.isFinite(botTimingError(profile, rng))).toBe(true);
      }
    }
  });

  it('reads more of the swing at hard than at easy, but never all of it', () => {
    expect(BOT_PROFILES.hard.swingRead).toBeGreaterThan(BOT_PROFILES.easy.swingRead);
    // Rule 6: a bot may not read a ball better than the person watching the same screen.
    expect(BOT_PROFILES.hard.swingRead).toBeLessThan(1);
  });

  it('is deterministic: the same seed plays the same innings', () => {
    const first = playInnings(BOT_PROFILES.normal, BOT_PROFILES.normal, new Rng(42));
    const second = playInnings(BOT_PROFILES.normal, BOT_PROFILES.normal, new Rng(42));
    expect(first).toEqual(second);
  });

  it('orders the whole ladder in both directions, so it cannot silently invert', () => {
    // The nine-cell grid, not two rows of it. `hard` used to bat *worse* than `normal`
    // against every bowling tier and `easy` bowling used to concede *less* than `hard`,
    // and both inversions were invisible to a check that only compared the tiers a pair at
    // a time along one axis. SPEC.md carries the measured table.
    //
    // Eight hundred innings a cell, three seeds. Measured rather than guessed: at three
    // hundred a cell the closest pair - `hard` batting against `normal` against `hard` -
    // swaps on about one seed in fifteen, and at six hundred none of fifteen seeds does.
    for (const seed of [101, 202, 303]) {
      const grid = ladder(800, seed);
      for (const bowl of TIERS) {
        expect(grid.easy[bowl], `easy < normal against ${bowl}`).toBeLessThan(grid.normal[bowl]);
        expect(grid.normal[bowl], `normal < hard against ${bowl}`).toBeLessThan(grid.hard[bowl]);
      }
      for (const bat of TIERS) {
        expect(grid[bat].easy, `${bat} scores less as the bowling improves`).toBeGreaterThan(
          grid[bat].normal,
        );
        expect(grid[bat].normal, `${bat} scores less as the bowling improves`).toBeGreaterThan(
          grid[bat].hard,
        );
      }
    }
  });

  it('gives every tier the innings its profile describes, not merely a different one', () => {
    // The outcome mix is the evidence that the tiers differ in the way they are *meant* to.
    // A ladder can be ordered and still be nonsense - a `hard` bot that scored more only by
    // facing more balls would pass the ordering above and fail here.
    const mix = {
      easy: outcomeMix('easy'),
      normal: outcomeMix('normal'),
      hard: outcomeMix('hard'),
    };
    for (const tier of TIERS) {
      // Every tier is dismissed sometimes, and no tier is dismissed nearly every ball.
      const out = mix[tier].caught + mix[tier].bowled;
      expect(out, `${tier} is dismissed sometimes`).toBeGreaterThan(0.01);
      expect(out, `${tier} is not a procession`).toBeLessThan(0.3);
    }
    // A weak bat plays and misses; a strong one puts bat on ball and rotates the strike.
    expect(mix.easy.dot).toBeGreaterThan(mix.normal.dot);
    expect(mix.normal.dot).toBeGreaterThan(mix.hard.dot);
    // A weak bat mishits, and a mishit is what gets caught.
    expect(mix.easy.caught).toBeGreaterThan(mix.normal.caught);
    expect(mix.normal.caught).toBeGreaterThan(mix.hard.caught);
    // A weak bowler sprays it wide; a strong one does not give runs away for nothing.
    expect(mix.easy.wide).toBeGreaterThan(mix.hard.wide);
  });

  it('leaves every tier a real innings rather than a procession', () => {
    // A tier that cannot score, or cannot be dismissed, is not a difficulty — it is a bug.
    for (const profile of Object.values(BOT_PROFILES)) {
      const runs = meanRuns(profile, BOT_PROFILES.normal, 200, 303);
      expect(runs).toBeGreaterThan(0);
      expect(runs).toBeLessThan(BALLS_PER_INNINGS * 6);
    }
  });
});
