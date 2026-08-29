import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BELT_FORWARD,
  BELT_SPEED,
  BELT_TARGETS,
  BIG_POINTS,
  BIG_RADIUS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOT_DRAWS_PER_TURN,
  BOT_PROFILES,
  CENTRE_X,
  CENTRE_Y,
  CLEAN_SHARE,
  MAX_ROUNDS,
  P1_MUZZLE_Y,
  P2_MUZZLE_Y,
  PELLET_RADIUS,
  RANGE_MAX,
  RANGE_MIN,
  RANGE_RATE,
  READY_SECONDS,
  SETTLE_SECONDS,
  SHOT_SPEED,
  SMALL_POINTS,
  SMALL_RADIUS,
  TARGET_POINTS,
  TRACK_HALF,
  TRACK_SPAN,
  TURN_SECONDS,
  boardXOf,
  boardYOf,
  chooseQuarry,
  cleanBy,
  createBotRngs,
  createBotState,
  createGame,
  driveBot,
  fireToleranceOf,
  firingSign,
  flightTimeOf,
  gaugeOf,
  hitsBy,
  lateralAt,
  leadOf,
  muzzleYOf,
  nextCrossing,
  otherOf,
  pointsBy,
  press,
  pressWithin,
  rangeOf,
  rangeToleranceOf,
  resetGame,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game, Target } from './rules.js';

const STEP = 1 / 60;
const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];
const SEATS: SeatId[] = ['p1', 'p2'];

function started(opener: SeatId = 'p1', seed = 1): Game {
  const game = createGame();
  resetGame(game, opener, new Rng(seed));
  return game;
}

/** Step until `done`, or give up. */
function until(game: Game, done: () => boolean, limit = 10_000): number {
  let steps = 0;
  for (; steps < limit && !done(); steps += 1) step(game, STEP);
  return steps;
}

/**
 * Judge a shot without flying it.
 *
 * Sets the arrival directly and steps once, which is the property under test as much as it is
 * a convenience: `land` reads `impactClock` and never the live clock, so a shot resolves
 * against the gallery at the exact moment it arrives rather than at the frame the animation
 * happened to finish on.
 */
function judge(game: Game, seat: SeatId, range: number, impactClock: number): void {
  game.active = seat;
  game.phase = 'flying';
  game.keptRange = range;
  game.impactClock = impactClock;
  game.flight = 0;
  game.flightTime = 0;
  // `fire` counts the turn; this stands in for it, so a match driven through here books the
  // same number of shots as one driven through the presses.
  if (seat === 'p1') game.p1Turns += 1;
  else game.p2Turns += 1;
  step(game, STEP);
}

/** One bot-versus-bot match with no frame cap: the guard throws rather than returning. */
function playMatch(
  seed: number,
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  opener: SeatId = 'p1',
  reversePoll = false,
): Game {
  const game = createGame();
  const source = new Rng(seed);
  const rngs = createBotRngs(source);
  resetGame(game, opener, source);
  const states = { p1: createBotState(), p2: createBotState() };
  const tiers: Record<SeatId, BotDifficulty> = { p1: p1Tier, p2: p2Tier };
  const order: SeatId[] = reversePoll ? ['p2', 'p1'] : ['p1', 'p2'];

  let steps = 0;
  while (game.phase !== 'over') {
    for (const seat of order) driveBot(game, seat, tiers[seat], states[seat], rngs[seat], STEP);
    step(game, STEP);
    steps += 1;
    if (steps > 200_000) throw new Error(`seed ${String(seed)} never finished`);
  }
  return game;
}

function playSeries(
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  matches: number,
): { p1: number; p2: number; draw: number } {
  const wins = { p1: 0, p2: 0, draw: 0 };
  for (let seed = 1; seed <= matches; seed += 1) {
    const winner = winnerOf(playMatch(seed * 7919, p1Tier, p2Tier));
    if (winner === 'p1') wins.p1 += 1;
    else if (winner === 'p2') wins.p2 += 1;
    else wins.draw += 1;
  }
  return wins;
}

/** Points a tier scores per turn over whole matches — the measure the ladder is built on. */
function pointsPerTurn(tier: BotDifficulty): number {
  let turns = 0;
  let points = 0;
  for (let seed = 1; seed <= 12; seed += 1) {
    const game = playMatch(2000 + seed * 31, tier, tier);
    turns += game.p1Turns + game.p2Turns;
    points += game.p1Points + game.p2Points;
  }
  return points / Math.max(1, turns);
}

describe('the range', () => {
  it('puts the two muzzles and the two lanes symmetrically about the centre', () => {
    // Everything a seat faces has to be the rotation of what the other seat faces, or the
    // half-turn the shell makes would hand one of them a different problem.
    expect(P1_MUZZLE_Y - CENTRE_Y).toBe(CENTRE_Y - P2_MUZZLE_Y);
    expect(firingSign('p1')).toBe(-firingSign('p2'));
    for (const forward of [0, 120, RANGE_MAX]) {
      for (const lateral of [-TRACK_HALF, -40, 0, 55, TRACK_HALF]) {
        expect(boardXOf('p1', lateral) - CENTRE_X).toBeCloseTo(
          CENTRE_X - boardXOf('p2', lateral),
          9,
        );
        expect(boardYOf('p1', forward) - CENTRE_Y).toBeCloseTo(
          CENTRE_Y - boardYOf('p2', forward),
          9,
        );
      }
    }
  });

  it('keeps every belt and every target inside the board', () => {
    const game = started();
    for (const seat of SEATS) {
      for (const target of game.targets) {
        for (const clock of [0, 0.4, 1.7, 5.3]) {
          const x = boardXOf(seat, lateralAt(target, clock));
          const y = boardYOf(seat, target.forward);
          expect(x).toBeGreaterThan(target.radius);
          expect(x).toBeLessThan(BOARD_WIDTH - target.radius);
          expect(y).toBeGreaterThan(target.radius);
          expect(y).toBeLessThan(BOARD_HEIGHT - target.radius);
        }
      }
      // And the far end of the gauge stops on the centre line, so the two lanes never overlap.
      expect(Math.abs(boardYOf(seat, RANGE_MAX) - CENTRE_Y)).toBeCloseTo(0, 9);
    }
  });

  it('puts both belts inside the gauge, with clear lane on either side of each', () => {
    // A belt the marker cannot be stopped on is a belt that is only ever missed, and a belt
    // at the end of the travel would be reachable by pressing carelessly.
    for (const forward of BELT_FORWARD) {
      expect(forward - RANGE_MIN).toBeGreaterThan(BIG_RADIUS + PELLET_RADIUS);
      expect(RANGE_MAX - forward).toBeGreaterThan(BIG_RADIUS + PELLET_RADIUS);
      const gauge = gaugeOf(forward);
      expect(gauge).toBeGreaterThan(0.1);
      expect(gauge).toBeLessThan(0.9);
      expect(rangeOf(gauge)).toBeCloseTo(forward, 9);
    }
  });

  it('never lets one shot be inside two belts at once', () => {
    // Cups in Cup Pong touch, so its nearest-cup rule is a formality. Here the belts are
    // separated by more than two hit radii, which is what makes a landing unambiguous.
    const gap = Math.abs((BELT_FORWARD[1] as number) - (BELT_FORWARD[0] as number));
    expect(gap).toBeGreaterThan(2 * (BIG_RADIUS + PELLET_RADIUS));
  });

  it('starts level, frozen, with the seat the shell nominated', () => {
    for (const opener of SEATS) {
      const game = started(opener);
      expect(game.active).toBe(opener);
      expect(game.opener).toBe(opener);
      expect(game.phase).toBe('ready');
      expect(pointsBy(game, 'p1')).toBe(0);
      expect(pointsBy(game, 'p2')).toBe(0);
      expect(winnerOf(game)).toBeNull();
    }
  });
});

describe('the gallery', () => {
  it('is one gallery, read by both seats in their own frames', () => {
    // The fairness claim in one assertion: a target's position is stated in the shooter's own
    // frame and nothing about it depends on the seat, so at any instant the two seats face the
    // identical problem — and the two drawn galleries are one shape under the half-turn.
    const game = started();
    for (const target of game.targets) {
      for (const clock of [0, 0.31, 2.02, 7.5]) {
        const lateral = lateralAt(target, clock);
        expect(boardXOf('p1', lateral) - CENTRE_X).toBeCloseTo(
          CENTRE_X - boardXOf('p2', lateral),
          9,
        );
      }
    }
  });

  it('alternates big and small along each belt, evenly spaced', () => {
    const game = started();
    expect(game.targets.length).toBe((BELT_TARGETS[0] as number) + (BELT_TARGETS[1] as number));
    for (let belt = 0; belt < BELT_FORWARD.length; belt += 1) {
      const onBelt = game.targets.filter((target) => target.belt === belt);
      expect(onBelt.length).toBe(BELT_TARGETS[belt] as number);
      expect(onBelt.filter((target) => target.points === SMALL_POINTS).length).toBe(
        onBelt.length / 2,
      );
      const spacing = TRACK_SPAN / onBelt.length;
      for (let i = 1; i < onBelt.length; i += 1) {
        const step = (onBelt[i] as Target).phase - (onBelt[i - 1] as Target).phase;
        expect(((step % TRACK_SPAN) + TRACK_SPAN) % TRACK_SPAN).toBeCloseTo(spacing, 6);
      }
    }
  });

  it('runs the two belts at the same speed in opposite directions', () => {
    // Equal, so neither belt is the better shot at any tier; opposite, so the two patterns
    // never lock together. A first pass at 190 against 240 had the bot on the slower belt in
    // every single turn.
    expect(Math.abs(BELT_SPEED[0] as number)).toBe(Math.abs(BELT_SPEED[1] as number));
    expect((BELT_SPEED[0] as number) * (BELT_SPEED[1] as number)).toBeLessThan(0);
  });

  it('is a function of the clock and nothing else', () => {
    // Nothing accumulates, so a target asked for twice at the same moment answers the same
    // thing however much play happened in between. This is what makes the bot's closed-form
    // solve and the referee's judgement the same arithmetic.
    const game = started();
    const target = game.targets[0] as Target;
    const before = lateralAt(target, 4.5);
    until(game, () => game.clock > 20);
    expect(lateralAt(target, 4.5)).toBe(before);
  });

  it('keeps every target on its own belt, inside the span', () => {
    const game = started();
    for (const target of game.targets) {
      for (let i = 0; i < 200; i += 1) {
        const lateral = lateralAt(target, i * 0.037);
        expect(lateral).toBeGreaterThanOrEqual(-TRACK_HALF);
        expect(lateral).toBeLessThan(TRACK_HALF);
      }
    }
  });

  it('opens on a different gallery for a different seed, and the same one for the same seed', () => {
    const phases = (seed: number): string =>
      started('p1', seed)
        .targets.map((target) => target.phase.toFixed(6))
        .join(',');
    expect(phases(11)).toBe(phases(11));
    expect(phases(11)).not.toBe(phases(12));
  });
});

describe('solving for a crossing', () => {
  it('finds the next moment a target is on the lane, in closed form', () => {
    const game = started();
    for (const target of game.targets) {
      for (let k = 0; k < 8; k += 1) {
        const after = k * 0.83;
        const crossing = nextCrossing(target, after);
        expect(crossing).toBeGreaterThanOrEqual(after);
        expect(lateralAt(target, crossing)).toBeCloseTo(0, 9);
        // And it is the *next* one: nothing between `after` and it.
        expect(crossing - after).toBeLessThanOrEqual(TRACK_SPAN / Math.abs(target.speed) + 1e-9);
      }
    }
  });

  it('agrees with the simulation exactly, which is what issue #2465 was about', () => {
    // The bot solves for a crossing analytically; the referee judges the shot against the
    // gallery numerically. Fire at exactly `crossing - flight` and the two must meet dead
    // centre, or the bot is aiming at a game slightly different from the one being played.
    const game = started();
    for (const target of game.targets) {
      const flight = flightTimeOf(target.forward);
      const crossing = nextCrossing(target, 1.5);
      judge(game, 'p1', target.forward, crossing);
      expect(game.hitIndex, 'the solved shot missed').toBeGreaterThanOrEqual(0);
      expect((game.targets[game.hitIndex] as Target).forward).toBe(target.forward);
      expect(game.lastOutcome).toBe('clean');
      expect(Math.abs(game.hitLateral)).toBeLessThan(1e-9);
      // The fire moment implied by that arrival is a real one: it is not in the past.
      expect(crossing - flight).toBeGreaterThan(0);
    }
  });

  it('judges the shot at the moment it arrives, never at the frame it lands on', () => {
    // A frame of belt is 3.3 units against a small target's 17 of slack, and it would always
    // be late in the same direction. `land` reads `impactClock`, which is why the clock here
    // can be nowhere near it and the answer is still right.
    const game = started();
    const target = game.targets.find((candidate) => candidate.points === SMALL_POINTS) as Target;
    const crossing = nextCrossing(target, 3);
    until(game, () => game.clock > 12);
    judge(game, 'p1', target.forward, crossing);
    expect(game.lastOutcome).toBe('clean');
    // One frame late is a different shot, and on a small target it is a measurably worse one.
    const early = Math.abs(lateralAt(target, crossing));
    const late = Math.abs(lateralAt(target, crossing + STEP));
    expect(late - early).toBeCloseTo(Math.abs(target.speed) * STEP, 6);
  });
});

describe('the two presses', () => {
  it("freezes the marker for the ready pause, and it outlasts the shell's seat flip", () => {
    // The whole point: the shell refuses a person's input while the board turns, and a bot
    // never goes through the shell. Both are stopped here instead, by the same amount.
    const SEAT_FLIP_SECONDS = 0.36;
    expect(READY_SECONDS).toBeGreaterThan(SEAT_FLIP_SECONDS);
    // And the margin is not decoration: the marker reaches the near belt a hair *after* the
    // flip would have finished, so without the freeze a person would have had one frame to
    // take the near belt on its first pass.
    const nearBeltAt = gaugeOf(BELT_FORWARD[0] as number) / RANGE_RATE;
    expect(nearBeltAt).toBeGreaterThan(SEAT_FLIP_SECONDS);
    expect(nearBeltAt - SEAT_FLIP_SECONDS).toBeLessThan(STEP);

    const game = started();
    for (let i = 0; i < Math.floor(SEAT_FLIP_SECONDS * 60); i += 1) {
      step(game, STEP);
      expect(game.phase).toBe('ready');
      expect(game.marker).toBe(0);
      expect(press(game, 'p1'), 'a press was taken during the ready pause').toBe(false);
    }
  });

  it('parks the marker at the near end, never on a belt', () => {
    // Parked on a belt, an instant press would be a free perfect distance.
    const game = started();
    expect(game.marker).toBe(0);
    expect(rangeOf(0)).toBe(RANGE_MIN);
    for (const forward of BELT_FORWARD) expect(gaugeOf(forward)).toBeGreaterThan(0);
  });

  it('sweeps between the ends of the gauge and turns round', () => {
    const game = started();
    let low = Infinity;
    let high = -Infinity;
    until(game, () => game.phase === 'aiming');
    for (let i = 0; i < 150; i += 1) {
      low = Math.min(low, game.marker);
      high = Math.max(high, game.marker);
      step(game, STEP);
    }
    expect(high).toBeCloseTo(1, 2);
    expect(low).toBeCloseTo(0, 2);
  });

  it('takes one press for the distance and a second for the shot', () => {
    const game = started();
    until(game, () => game.phase === 'aiming');
    game.marker = gaugeOf(BELT_FORWARD[1] as number);
    expect(press(game, 'p1')).toBe(true);
    expect(game.phase).toBe('laying');
    expect(game.keptRange).toBeCloseTo(BELT_FORWARD[1] as number, 9);
    const firedAt = game.clock;
    expect(press(game, 'p1')).toBe(true);
    expect(game.phase).toBe('flying');
    // The arrival is closed form, fixed at the press: clock plus the distance over the speed.
    expect(game.impactClock).toBe(firedAt + game.keptRange / SHOT_SPEED);
  });

  it('holds the marker still once the distance is kept', () => {
    const game = started();
    until(game, () => game.phase === 'aiming');
    press(game, 'p1');
    const kept = game.marker;
    for (let i = 0; i < 30; i += 1) step(game, STEP);
    expect(game.marker).toBe(kept);
    expect(game.phase).toBe('laying');
  });

  it('ignores a press from the seat that is not shooting', () => {
    const game = started();
    until(game, () => game.phase === 'aiming');
    expect(press(game, 'p2')).toBe(false);
    expect(game.phase).toBe('aiming');
  });

  it('ignores a press while the shot is in the air', () => {
    const game = started();
    until(game, () => game.phase === 'aiming');
    press(game, 'p1');
    press(game, 'p1');
    expect(game.phase).toBe('flying');
    expect(press(game, 'p1')).toBe(false);
  });

  it('keeps the marker inside its gauge', () => {
    const game = started();
    until(game, () => game.phase === 'aiming');
    for (let i = 0; i < 400; i += 1) {
      step(game, STEP);
      if (game.phase !== 'aiming') break;
      expect(game.marker).toBeGreaterThanOrEqual(0);
      expect(game.marker).toBeLessThanOrEqual(1);
    }
  });

  it('spends the turn when the deadline passes with a press still owed', () => {
    const game = started();
    const steps = until(game, () => game.phase === 'settling', 2000);
    expect(steps * STEP).toBeCloseTo(READY_SECONDS + TURN_SECONDS, 1);
    expect(game.lastOutcome).toBe('timeout');
    expect(game.lastPoints).toBe(0);
    expect(game.p1Turns).toBe(1);
    expect(game.hitIndex).toBe(-1);
  });

  it('spends the turn when only the first press is ever made', () => {
    const game = started();
    until(game, () => game.phase === 'aiming');
    press(game, 'p1');
    until(game, () => game.phase !== 'laying', 2000);
    expect(game.phase).toBe('settling');
    expect(game.lastOutcome).toBe('timeout');
  });
});

describe('a shot', () => {
  it('takes the target it arrives on, and scores what that target is worth', () => {
    const game = started();
    for (const points of [BIG_POINTS, SMALL_POINTS]) {
      const fresh = started();
      const target = fresh.targets.find((candidate) => candidate.points === points) as Target;
      judge(fresh, 'p1', target.forward, nextCrossing(target, 2));
      expect(fresh.lastPoints).toBe(points);
      expect(pointsBy(fresh, 'p1')).toBe(points);
      expect(hitsBy(fresh, 'p1')).toBe(1);
      expect(pointsBy(fresh, 'p2')).toBe(0);
    }
    expect(game.targets.some((target) => target.points === SMALL_POINTS)).toBe(true);
  });

  it('counts a clean hit and one that caught the edge apart, and scores both', () => {
    const game = started();
    const target = game.targets.find((candidate) => candidate.points === BIG_POINTS) as Target;
    const crossing = nextCrossing(target, 2);
    const edge = target.radius * ((CLEAN_SHARE + 1) / 2);
    judge(game, 'p1', target.forward + edge, crossing);
    expect(game.lastOutcome).toBe('edge');
    expect(pointsBy(game, 'p1')).toBe(BIG_POINTS);
    expect(cleanBy(game, 'p1')).toBe(0);
    expect(hitsBy(game, 'p1')).toBe(1);
  });

  it('misses when the distance is further out than the target is wide', () => {
    const game = started();
    const target = game.targets.find((candidate) => candidate.points === BIG_POINTS) as Target;
    judge(game, 'p1', target.forward + target.radius + PELLET_RADIUS + 1, nextCrossing(target, 2));
    expect(game.lastOutcome).toBe('miss');
    expect(game.hitIndex).toBe(-1);
    expect(pointsBy(game, 'p1')).toBe(0);
  });

  it('misses when the moment is off, however well the distance was kept', () => {
    // The second press is the aim, and this is what says so: a perfect distance and a late
    // press is a miss, which is the whole reason the lead exists.
    const game = started();
    const target = game.targets.find((candidate) => candidate.points === SMALL_POINTS) as Target;
    const late = (target.radius + PELLET_RADIUS + 2) / Math.abs(target.speed);
    judge(game, 'p1', target.forward, nextCrossing(target, 2) + late);
    expect(game.lastOutcome).toBe('miss');
  });

  it('leaves the gallery exactly as it found it', () => {
    // Nothing a shot does changes a target, which is what keeps the two seats' problems
    // identical for the whole match rather than only at the start.
    const game = started();
    const before = game.targets.map((target) => target.phase);
    const target = game.targets[0] as Target;
    judge(game, 'p1', target.forward, nextCrossing(target, 2));
    expect(game.targets.map((candidate) => candidate.phase)).toEqual(before);
  });

  it('scores for whichever seat fired it', () => {
    const game = started();
    const target = game.targets[0] as Target;
    judge(game, 'p2', target.forward, nextCrossing(target, 2));
    expect(pointsBy(game, 'p2')).toBe(target.points);
    expect(pointsBy(game, 'p1')).toBe(0);
  });
});

describe('turns', () => {
  it('pass to the other seat after the shot has been shown', () => {
    const game = started();
    until(game, () => game.phase === 'aiming');
    press(game, 'p1');
    press(game, 'p1');
    until(game, () => game.phase === 'settling');
    const steps = until(game, () => game.active === 'p2');
    expect(steps * STEP).toBeCloseTo(SETTLE_SECONDS, 1);
    expect(game.phase).toBe('ready');
  });

  it('alternate the lead from the seat the shell nominated', () => {
    for (const opener of SEATS) {
      expect(leadOf(opener, 1)).toBe(opener);
      expect(leadOf(opener, 2)).toBe(otherOf(opener));
      for (let round = 1; round < 20; round += 1) {
        expect(leadOf(opener, round + 1)).toBe(otherOf(leadOf(opener, round)));
      }
    }
  });

  it('give both seats the same number of shots, whoever wins', () => {
    for (const tier of TIERS) {
      for (const opener of SEATS) {
        for (let seed = 1; seed <= 12; seed += 1) {
          const game = playMatch(seed * 7919, tier, tier, opener);
          expect(game.p1Turns, `${tier} ${opener} seed ${String(seed)}`).toBe(game.p2Turns);
          expect(game.p1Turns).toBeLessThanOrEqual(MAX_ROUNDS);
        }
      }
    }
  });
});

describe('the match ending', () => {
  it('waits for the round to finish before ten points wins it', () => {
    // Ending on the point would hand the match to whoever happened to be leading that round.
    const game = started();
    const target = game.targets.find((candidate) => candidate.points === SMALL_POINTS) as Target;
    game.p1Points = TARGET_POINTS;
    game.p1Clean = 0;
    game.round = 4;
    // Seat one has already shot this round; seat two's shot is the one that completes it.
    game.turnsThisRound = 1;
    game.p1Turns = 4;
    game.p2Turns = 3;
    game.active = 'p2';
    game.p2Points = TARGET_POINTS - SMALL_POINTS;
    judge(game, 'p2', target.forward, nextCrossing(target, game.clock + 1));
    expect(pointsBy(game, 'p2')).toBe(TARGET_POINTS);
    until(game, () => game.phase === 'over' || game.phase === 'ready');
    expect(game.phase).toBe('over');
    expect(game.p1Turns).toBe(game.p2Turns);
    // Level on ten points each, so the clean-hit tiebreak is what settles it — and seat two's
    // owed shot was clean.
    expect(pointsBy(game, 'p1')).toBe(pointsBy(game, 'p2'));
    expect(winnerOf(game)).toBe('p2');
  });

  it('is a draw when the points and the clean hits both tie', () => {
    const game = started();
    game.round = MAX_ROUNDS;
    game.turnsThisRound = 1;
    game.active = 'p2';
    game.p1Points = 4;
    game.p2Points = 4;
    game.p1Clean = 2;
    game.p2Clean = 2;
    until(game, () => game.phase === 'over', 2000);
    expect(winnerOf(game)).toBe('draw');
  });

  it('is decided by the clean hits when the points are level', () => {
    const game = started();
    game.round = MAX_ROUNDS;
    game.turnsThisRound = 1;
    game.active = 'p2';
    game.p1Points = 4;
    game.p2Points = 4;
    game.p1Clean = 3;
    game.p2Clean = 1;
    until(game, () => game.phase === 'over', 2000);
    expect(winnerOf(game)).toBe('p1');
  });

  it('gives the higher score the match when the rounds run out', () => {
    const game = started();
    game.round = MAX_ROUNDS;
    game.turnsThisRound = 1;
    game.active = 'p2';
    game.p1Points = 3;
    game.p2Points = 6;
    until(game, () => game.phase === 'over', 2000);
    expect(winnerOf(game)).toBe('p2');
    expect(game.p2Points).toBeLessThan(TARGET_POINTS);
  });

  it('always ends, with nobody pressing anything at all and no frame cap', () => {
    // Structural: at most twenty-two rounds of one shot each, and nothing about how it is
    // played can add one. The loop below has no ceiling, so a match that failed to terminate
    // would hang this test rather than pass it quietly.
    const game = started();
    while (game.phase !== 'over') step(game, STEP);
    expect(winnerOf(game)).toBe('draw');
    expect(game.p1Turns).toBe(MAX_ROUNDS);
    expect(game.p2Turns).toBe(MAX_ROUNDS);
    // Each of a turn's three timed phases can overrun its own deadline by up to one step,
    // which is the only slack in the bound.
    expect(game.clock).toBeLessThan(
      MAX_ROUNDS * 2 * (READY_SECONDS + TURN_SECONDS + SETTLE_SECONDS + 3 * STEP) + 0.5,
    );
  });

  it('stops simulating once it is decided', () => {
    const game = started();
    game.phase = 'over';
    game.winner = 'p1';
    const clock = game.clock;
    step(game, STEP);
    expect(game.clock).toBe(clock);
  });
});

describe('the bot', () => {
  it('draws the same number of values for every turn, whatever it decides', () => {
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 25; seed += 1) {
        const game = started('p1', seed);
        const counter = new Rng(seed);
        let draws = 0;
        const counted = {
          float: () => {
            draws += 1;
            return counter.float();
          },
        } as unknown as Rng;
        until(game, () => game.phase === 'aiming');
        driveBot(game, 'p1', tier, createBotState(), counted, STEP);
        expect(draws, `${tier} seed ${String(seed)}`).toBe(BOT_DRAWS_PER_TURN);
      }
    }
  });

  it('draws the same number again over a whole match, however the turns went', () => {
    // The other half of the guarantee: a turn costs exactly this whether the shot was taken,
    // fumbled, or run out of time altogether.
    const game = createGame();
    const source = new Rng(97);
    const other = createBotRngs(source).p2;
    resetGame(game, 'p1', source);
    const counter = new Rng(5);
    let draws = 0;
    const counted = {
      float: () => {
        draws += 1;
        return counter.float();
      },
    } as unknown as Rng;
    const states = { p1: createBotState(), p2: createBotState() };
    while (game.phase !== 'over') {
      driveBot(game, 'p1', 'easy', states.p1, counted, STEP);
      driveBot(game, 'p2', 'easy', states.p2, other, STEP);
      step(game, STEP);
    }
    expect(game.p1Turns).toBeGreaterThan(5);
    expect(draws).toBe(game.p1Turns * BOT_DRAWS_PER_TURN);
  });

  it('reads only what is on the board, and how steady its own hand is', () => {
    // Rule 6, as arithmetic: a tier's press error is several frames wide, so none of them can
    // stop a marker or pick a moment more finely than a person can.
    for (const tier of TIERS) {
      expect(BOT_PROFILES[tier].timing, tier).toBeGreaterThan(STEP * 3);
      expect(BOT_PROFILES[tier].blunder, tier).toBeGreaterThan(0);
    }
    expect(BOT_PROFILES.hard.timing).toBeLessThan(BOT_PROFILES.normal.timing);
    expect(BOT_PROFILES.normal.timing).toBeLessThan(BOT_PROFILES.easy.timing);
    expect(BOT_PROFILES.hard.blunder).toBeLessThan(BOT_PROFILES.normal.blunder);
    expect(BOT_PROFILES.normal.blunder).toBeLessThan(BOT_PROFILES.easy.blunder);
  });

  it('values a press it is sure of at one and an impossible one at nothing', () => {
    expect(pressWithin(0.2, 0.2)).toBe(1);
    expect(pressWithin(0.2, 0.5)).toBe(1);
    expect(pressWithin(0.2, 0)).toBe(0);
    // Monotone in both arguments, which is the only property the choice rule leans on.
    expect(pressWithin(0.2, 0.1)).toBeGreaterThan(pressWithin(0.2, 0.05));
    expect(pressWithin(0.2, 0.1)).toBeGreaterThan(pressWithin(0.3, 0.1));
  });

  it('shoots at the big targets when its hand is loose and the small ones when it is steady', () => {
    // Nobody told it to. The two value curves cross at about 0.165 s of press error, which is
    // between `normal` and `hard`, and that crossing is what the target radii were fitted to.
    const game = started();
    const sizeChosen = (tier: BotDifficulty): number[] => {
      const seen: number[] = [];
      for (let seed = 1; seed <= 40; seed += 1) {
        const fresh = started('p1', seed);
        fresh.clock = seed * 0.041;
        const quarry = chooseQuarry(fresh, tier, fresh.clock);
        expect(quarry, `${tier} found nothing to shoot at`).toBeGreaterThanOrEqual(0);
        seen.push((fresh.targets[quarry] as Target).points);
      }
      return seen;
    };
    expect(sizeChosen('easy').every((points) => points === BIG_POINTS)).toBe(true);
    expect(sizeChosen('normal').every((points) => points === BIG_POINTS)).toBe(true);
    expect(sizeChosen('hard').every((points) => points === SMALL_POINTS)).toBe(true);
    expect(game.targets.length).toBeGreaterThan(4);
  });

  it('uses both belts, because neither is the better shot', () => {
    const belts = new Set<number>();
    for (let seed = 1; seed <= 60; seed += 1) {
      const game = started('p1', seed);
      game.clock = seed * 0.053;
      const quarry = chooseQuarry(game, 'hard', game.clock);
      belts.add((game.targets[quarry] as Target).belt);
    }
    expect(belts.size).toBe(BELT_FORWARD.length);
  });

  it('makes the same choice from either seat', () => {
    // The gallery is stated in the shooter's own frame, so the choice cannot depend on the
    // seat. Ranked in board coordinates instead it would, and the two seats would face
    // mirrored problems solved in different orders.
    for (let seed = 1; seed <= 20; seed += 1) {
      const game = started('p1', seed);
      game.clock = seed * 0.07;
      const asP1 = chooseQuarry(game, 'hard', game.clock);
      game.active = 'p2';
      expect(chooseQuarry(game, 'hard', game.clock)).toBe(asP1);
    }
  });

  it('never asks for a distance the marker cannot be stopped on', () => {
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const game = started('p1', seed);
        const state = createBotState();
        until(game, () => game.phase === 'aiming');
        driveBot(game, 'p1', tier, state, new Rng(seed), STEP);
        expect(state.wantGauge).toBeGreaterThanOrEqual(0);
        expect(state.wantGauge).toBeLessThanOrEqual(1);
      }
    }
  });

  it('clears the distance it chose when it presses, so the fire press reads its own number', () => {
    // `wantGauge` is a fraction of the range gauge and `fireTimer` is a number of seconds.
    // Leaving one standing in a field the other press reads is how a shot ends up fired at a
    // gauge fraction's worth of seconds.
    const game = started();
    const rng = new Rng(3);
    const state = createBotState();
    until(game, () => game.phase === 'aiming');
    driveBot(game, 'p1', 'hard', state, rng, STEP);
    expect(state.stage).toBe('range');
    expect(state.quarry).toBeGreaterThanOrEqual(0);
    expect(state.wantGauge).toBeGreaterThan(0);

    for (let i = 0; i < 600; i += 1) {
      if (driveBot(game, 'p1', 'hard', state, rng, STEP)) break;
      step(game, STEP);
    }
    expect(game.phase).toBe('laying');
    expect(state.stage).toBe('fire');
    expect(state.wantGauge, 'the distance it chose was left standing').toBe(0);
    expect(state.rangeOffset).toBe(0);
    expect(state.rangeTimer).toBe(0);
  });

  it('recomputes the lead from the distance it actually kept', () => {
    // A marker stopped short needs a shorter lead, and where the marker stopped is on the
    // board in front of a player. Taking the wanted distance instead would tie the two
    // presses' errors together.
    const game = started();
    const rng = new Rng(11);
    const state = createBotState();
    until(game, () => game.phase === 'aiming');
    driveBot(game, 'p1', 'hard', state, rng, STEP);
    const quarry = state.quarry;
    for (let i = 0; i < 600; i += 1) {
      if (driveBot(game, 'p1', 'hard', state, rng, STEP)) break;
      step(game, STEP);
    }
    const target = game.targets[quarry] as Target;
    const flight = flightTimeOf(game.keptRange);
    const arrival = nextCrossing(target, game.clock + flight);
    expect(state.fireTimer).toBeCloseTo(arrival - flight - game.clock + state.fireOffset - STEP, 9);
  });

  it('counts down to a moment rather than watching for a position', () => {
    // Watching for a position hangs: the error is added in whichever direction the marker is
    // going, so an error larger than the gauge is out of reach both ways. Two `easy` seats
    // would sweep for ever. A countdown cannot fail to expire, and this is the proof —
    // matches finish with no ceiling on the loop above.
    for (let seed = 1; seed <= 8; seed += 1) {
      const game = playMatch(seed * 3571, 'easy', 'easy');
      expect(game.phase).toBe('over');
    }
  });

  it('scores more points a turn as the tier goes up', () => {
    // Points a turn, not hits: `easy` and `normal` shoot at the big targets and `hard` at the
    // small ones, so `hard` hits *less* often and scores more. The hit rate is the wrong
    // measure of this ladder and would read as a regression.
    const rates = TIERS.map((tier) => pointsPerTurn(tier));
    const [easy, normal, hard] = rates as [number, number, number];
    expect(normal, `easy ${easy.toFixed(2)} normal ${normal.toFixed(2)}`).toBeGreaterThan(easy);
    expect(hard, `normal ${normal.toFixed(2)} hard ${hard.toFixed(2)}`).toBeGreaterThan(normal);
  });

  it('is balanced against itself, from either opening seat', () => {
    // The full measurement is 2000 seeds a tier a seat in the harness — 48.2% to 51.2% to seat
    // one — and is written into SPEC.md. This is the version that fits in a commit.
    for (const tier of TIERS) {
      const wins = playSeries(tier, tier, 60);
      const decided = wins.p1 + wins.p2;
      expect(decided, `${tier} decided nothing`).toBeGreaterThan(50);
      const share = wins.p1 / decided;
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeGreaterThan(
        0.35,
      );
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeLessThan(0.65);
    }
  });

  it('beats a weaker tier from either seat', () => {
    for (const [strong, weak, ratio] of [
      ['hard', 'easy', 4],
      ['normal', 'easy', 2],
      ['hard', 'normal', 2],
    ] as [BotDifficulty, BotDifficulty, number][]) {
      const asP1 = playSeries(strong, weak, 60);
      expect(asP1.p1, `${strong} as p1 v ${weak}`).toBeGreaterThan(asP1.p2 * ratio);
      const asP2 = playSeries(weak, strong, 60);
      expect(asP2.p2, `${strong} as p2 v ${weak}`).toBeGreaterThan(asP2.p1 * ratio);
    }
  });

  it('leaves few enough matches undecided that the score is doing work', () => {
    // Points alone drew 10.6%, 15.1% and 9.2% of 2000 matches a tier; the clean-hit tiebreak
    // is what takes it to 1.9%, 3.5% and 2.0%.
    for (const tier of TIERS) {
      const wins = playSeries(tier, tier, 60);
      expect(wins.draw / 60, `${tier} drew ${String(wins.draw)} of 60`).toBeLessThan(0.15);
    }
  });

  it('plays the bit-identical match whichever seat is polled first', () => {
    // A generator per seat, and a constant number of draws: between them, the order the two
    // seats are asked in cannot reach the simulation.
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const forward = playMatch(seed * 7919, tier, tier, 'p1', false);
        const reverse = playMatch(seed * 7919, tier, tier, 'p1', true);
        expect(reverse, `${tier} seed ${String(seed)}`).toEqual(forward);
      }
    }
  });

  it('gives each seat a stream of its own, seeded from the match', () => {
    const rngs = createBotRngs(new Rng(42));
    const p1 = [rngs.p1.float(), rngs.p1.float(), rngs.p1.float()];
    const p2 = [rngs.p2.float(), rngs.p2.float(), rngs.p2.float()];
    expect(p1).not.toEqual(p2);
    const again = createBotRngs(new Rng(42));
    expect([again.p1.float(), again.p1.float(), again.p1.float()]).toEqual(p1);
  });

  it('two of the same tier do not play the identical match', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed += 1) {
      const game = playMatch(seed * 7919, 'hard', 'hard');
      seen.add(`${String(game.p1Points)}:${String(game.p1Clean)}:${String(game.p2Points)}`);
    }
    expect(seen.size).toBeGreaterThan(6);
  });
});

describe('the tolerances the ladder is built on', () => {
  it('are the radius over the rate, in seconds, for both dials', () => {
    const game = started();
    const big = game.targets.find((target) => target.points === BIG_POINTS) as Target;
    const small = game.targets.find((target) => target.points === SMALL_POINTS) as Target;
    expect(big.radius).toBe(BIG_RADIUS);
    expect(small.radius).toBe(SMALL_RADIUS);
    for (const target of [big, small]) {
      expect(rangeToleranceOf(target)).toBeCloseTo(
        (target.radius + PELLET_RADIUS) / (RANGE_RATE * (RANGE_MAX - RANGE_MIN)),
        9,
      );
      expect(fireToleranceOf(target)).toBeCloseTo(
        (target.radius + PELLET_RADIUS) / Math.abs(target.speed),
        9,
      );
    }
    // Every one of the four is inside the band a person's timing error actually lives in, and
    // none of them is close to a single frame, which is where a lattice would take over.
    for (const target of [big, small]) {
      for (const tolerance of [rangeToleranceOf(target), fireToleranceOf(target)]) {
        expect(tolerance).toBeGreaterThan(STEP * 4);
        expect(tolerance).toBeLessThan(0.25);
      }
    }
  });

  it('leaves the marker a grid finer than the target it has to stop on', () => {
    // Cup Pong's first version ran a needle whose one-frame grid was coarser than its cup, so
    // two neighbouring mouth radii gave the identical hit rate. Both windows here are eight
    // frames or more across.
    const game = started();
    const small = game.targets.find((target) => target.points === SMALL_POINTS) as Target;
    const window = 2 * (small.radius + PELLET_RADIUS);
    expect(window / (RANGE_RATE * (RANGE_MAX - RANGE_MIN) * STEP)).toBeGreaterThan(8);
    expect(window / (Math.abs(small.speed) * STEP)).toBeGreaterThan(8);
  });
});

describe('determinism', () => {
  it('replays a fixed script to the identical final state', () => {
    const play = (): Game => {
      const game = started();
      const script = new Rng(1234);
      for (let i = 0; i < 60 * 300 && game.phase !== 'over'; i += 1) {
        if (script.float() < 0.05) press(game, game.active);
        step(game, STEP);
      }
      return game;
    };
    expect(play()).toEqual(play());
  });

  it('plays a different match from a different seed', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed += 1) {
      const game = playMatch(seed * 7919, 'normal', 'normal');
      seen.add(
        `${String(game.p1Points)}:${String(game.p1Clean)}:${String(game.p2Points)}:${String(game.p2Clean)}`,
      );
    }
    expect(seen.size).toBeGreaterThan(15);
  });

  it('holds a state that is nothing but numbers, so it round-trips exactly', () => {
    // Issue #747: the state has to be serialisable and restorable exactly. The gallery is a
    // clock and a phase per target, so there is nothing in here a JSON round trip loses.
    const game = playMatch(31, 'normal', 'normal');
    expect(JSON.parse(JSON.stringify(game))).toEqual(game);
  });

  it('is level again after a reset, with the new opener to shoot', () => {
    const game = playMatch(9, 'hard', 'hard');
    expect(game.p1Turns).toBeGreaterThan(0);
    resetGame(game, 'p2', new Rng(4));
    expect(game.p1Points).toBe(0);
    expect(game.p2Points).toBe(0);
    expect(game.p1Turns).toBe(0);
    expect(game.round).toBe(1);
    expect(game.clock).toBe(0);
    expect(game.active).toBe('p2');
    expect(game.phase).toBe('ready');
    expect(winnerOf(game)).toBeNull();
  });

  it('never lets a point come from anywhere but a hit', () => {
    for (const tier of TIERS) {
      const game = playMatch(77, tier, tier);
      for (const seat of SEATS) {
        expect(pointsBy(game, seat)).toBeGreaterThanOrEqual(hitsBy(game, seat));
        expect(pointsBy(game, seat)).toBeLessThanOrEqual(hitsBy(game, seat) * SMALL_POINTS);
        expect(cleanBy(game, seat)).toBeLessThanOrEqual(hitsBy(game, seat));
      }
    }
  });

  it('keeps the muzzle where the manifest can find it', () => {
    for (const seat of SEATS) {
      expect(boardYOf(seat, 0)).toBe(muzzleYOf(seat));
      expect(boardXOf(seat, 0)).toBe(CENTRE_X);
    }
  });
});
