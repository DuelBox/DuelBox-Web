import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BALL_RADIUS,
  MAX_ANGLE_RATIO,
  MAX_BALL_SPEED,
  RACKET_HALF_HEIGHT,
  RACKET_MIN_HALF_WIDTH,
  RACKET_SHRINK_PER_HIT,
  P1_RACKET_Y,
  P2_RACKET_Y,
  RACKET_HALF_WIDTH,
  RACKET_MAX_X,
  RACKET_MIN_X,
  RACKET_SPEED,
  RAIL,
  ROUND_SECONDS,
  SERVE_SECONDS,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  TARGET_POINTS,
  botAim,
  callOnTime,
  clampRacket,
  createBotState,
  createGame,
  driveRacket,
  launch,
  otherOf,
  pointsOf,
  predictCrossing,
  hitsOf,
  racketHalfWidth,
  racketOf,
  racketYOf,
  reachOf,
  resetGame,
  serveTo,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;

function started(seed = 1): { game: Game; rng: Rng } {
  const game = createGame();
  const rng = new Rng(seed);
  resetGame(game);
  return { game, rng };
}

/** Run to the first live step, past the serve hang. */
function toRally(game: Game, rng: Rng): void {
  for (let i = 0; i < 200 && game.phase === 'serving'; i += 1) step(game, STEP, rng);
}

describe('the table', () => {
  it('starts level, with the ball waiting at the middle', () => {
    const { game } = started();
    expect(game.p1Points).toBe(0);
    expect(game.p2Points).toBe(0);
    expect(game.phase).toBe('serving');
    expect(game.ball.x).toBe(TABLE_WIDTH / 2);
    expect(game.ball.y).toBe(TABLE_HEIGHT / 2);
    expect(winnerOf(game)).toBeNull();
  });

  it('puts the two baselines the same distance from their own ends', () => {
    // If they were not, one player would have longer to react than the other, and the
    // whole game would be unfair in a way no amount of tuning could fix.
    expect(P1_RACKET_Y).toBe(TABLE_HEIGHT - P2_RACKET_Y);
    expect(racketYOf('p1')).toBe(P1_RACKET_Y);
    expect(racketYOf('p2')).toBe(P2_RACKET_Y);
  });

  it('keeps a racket wholly on the table', () => {
    expect(clampRacket(-500)).toBe(RACKET_MIN_X);
    expect(clampRacket(TABLE_WIDTH + 500)).toBe(RACKET_MAX_X);
    expect(RACKET_MIN_X - RACKET_HALF_WIDTH).toBeGreaterThanOrEqual(RAIL);
    expect(RACKET_MAX_X + RACKET_HALF_WIDTH).toBeLessThanOrEqual(TABLE_WIDTH - RAIL);
  });
});

describe('the serve', () => {
  it('hangs before it launches', () => {
    const { game, rng } = started();
    step(game, STEP, rng);
    expect(game.phase).toBe('serving');
    expect(game.serveDelay).toBeCloseTo(SERVE_SECONDS - STEP, 6);
  });

  it('launches toward the seat it was handed to', () => {
    for (const toward of ['p1', 'p2'] as SeatId[]) {
      const { game, rng } = started();
      serveTo(game, toward);
      toRally(game, rng);
      expect(game.phase).toBe('rally');
      expect(Math.sign(game.ball.vy)).toBe(toward === 'p1' ? 1 : -1);
    }
  });

  it('does not open every point down the same line', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const game = createGame();
      resetGame(game);
      launch(game, new Rng(seed));
      seen.add(Math.round(game.ball.vx));
    }
    expect(seen.size).toBeGreaterThan(4);
  });

  it('hands the serve to whoever conceded', () => {
    const { game, rng } = started();
    toRally(game, rng);
    // Put the ball past p1's baseline with nobody there.
    game.ball.y = TABLE_HEIGHT + BALL_RADIUS + 40;
    game.ball.vy = 400;
    const outcome = step(game, STEP, rng);
    expect(outcome.scored).toBe('p2');
    expect(game.p2Points).toBe(1);
    // p1 conceded, so p1 receives.
    expect(game.serveToward).toBe('p1');
  });
});

describe('the rally', () => {
  it('bounces off a side rail rather than sticking to it', () => {
    const { game, rng } = started();
    toRally(game, rng);
    game.ball.x = RAIL + BALL_RADIUS + 1;
    game.ball.vx = -900;
    const outcome = step(game, STEP, rng);
    expect(outcome.railed).toBe(true);
    expect(game.ball.vx).toBeGreaterThan(0);
    expect(game.ball.x).toBeGreaterThanOrEqual(RAIL + BALL_RADIUS);
  });

  it('returns a ball that meets a racket, and only one travelling toward it', () => {
    const { game, rng } = started();
    toRally(game, rng);
    game.ball.x = game.p1.x;
    game.ball.y = P1_RACKET_Y;
    game.ball.vy = 400;
    expect(step(game, STEP, rng).returned).toBe('p1');
    expect(game.ball.vy).toBeLessThan(0);

    // Now leaving the racket: it must not be caught again on the way out.
    expect(step(game, STEP, rng).returned).toBeNull();
  });

  it('speeds the ball up on every return, up to a ceiling', () => {
    const { game, rng } = started();
    toRally(game, rng);
    let previous = 0;
    for (let hit = 0; hit < 40; hit += 1) {
      const seat: SeatId = game.ball.vy > 0 ? 'p1' : 'p2';
      // A straight rally down the middle: the racket is where the ball will be, and the
      // ball is placed one step short of the baseline rather than on it, because `step`
      // advances before it tests for a strike. At the ceiling speed a step is 32 units
      // and the strike band is 52 deep, so a ball starting *on* the line lands past it.
      game.ball.vx = 0;
      game.ball.x = TABLE_WIDTH / 2;
      racketOf(game, seat).x = clampRacket(TABLE_WIDTH / 2);
      game.ball.y = racketYOf(seat) - game.ball.vy * STEP;
      const outcome = step(game, STEP, rng);
      expect(outcome.returned).toBe(seat);
      const speed = Math.hypot(game.ball.vx, game.ball.vy);
      expect(speed).toBeGreaterThanOrEqual(previous - 1e-6);
      expect(speed).toBeLessThanOrEqual(MAX_BALL_SPEED + 1e-6);
      previous = speed;
    }
    expect(previous).toBeCloseTo(MAX_BALL_SPEED, 3);
  });

  it('cannot pass through a racket, even at the ceiling speed', () => {
    // A ball that moves further in one step than the strike band is deep would sometimes
    // appear on the far side of a racket without touching it, and the point would be lost
    // to arithmetic rather than to play. The band is what bounds the speed ceiling.
    const band = (RACKET_HALF_HEIGHT + BALL_RADIUS) * 2;
    expect(MAX_BALL_SPEED * STEP).toBeLessThan(band);
  });

  it('never lets a return run the rails', () => {
    const { game, rng } = started();
    toRally(game, rng);
    // A racket sweeping at full speed into a ball met right on its edge — the most
    // sideways return the game can produce.
    game.p1.velocity = RACKET_SPEED;
    game.p1.x = TABLE_WIDTH / 2;
    game.ball.x = game.p1.x + RACKET_HALF_WIDTH;
    game.ball.y = P1_RACKET_Y;
    game.ball.vy = 500;
    step(game, STEP, rng);
    expect(Math.abs(game.ball.vx)).toBeLessThanOrEqual(
      Math.abs(game.ball.vy) * MAX_ANGLE_RATIO + 1e-6,
    );
  });

  it('sends the ball the way the racket was sweeping', () => {
    const outcomes: number[] = [];
    for (const sweep of [-RACKET_SPEED, 0, RACKET_SPEED]) {
      const { game, rng } = started();
      toRally(game, rng);
      game.p1.x = TABLE_WIDTH / 2;
      game.p1.velocity = sweep;
      game.ball.x = game.p1.x;
      game.ball.y = P1_RACKET_Y;
      game.ball.vx = 0;
      game.ball.vy = 500;
      step(game, STEP, rng);
      outcomes.push(game.ball.vx);
    }
    const [left, still, right] = outcomes as [number, number, number];
    expect(still).toBeCloseTo(0, 6);
    expect(left).toBeLessThan(still);
    expect(right).toBeGreaterThan(still);
  });

  it('bends the return toward the edge it was met on', () => {
    const { game, rng } = started();
    toRally(game, rng);
    game.p1.x = TABLE_WIDTH / 2;
    game.p1.velocity = 0;
    game.ball.x = game.p1.x + RACKET_HALF_WIDTH * 0.9;
    game.ball.y = P1_RACKET_Y;
    game.ball.vx = 0;
    game.ball.vy = 500;
    step(game, STEP, rng);
    expect(game.ball.vx).toBeGreaterThan(0);
  });
});

describe('the narrowing racket', () => {
  it('starts at full width and loses the same amount on every one of your own returns', () => {
    expect(racketHalfWidth(0)).toBe(RACKET_HALF_WIDTH);
    expect(racketHalfWidth(1)).toBe(RACKET_HALF_WIDTH - RACKET_SHRINK_PER_HIT);
    expect(racketHalfWidth(2)).toBe(RACKET_HALF_WIDTH - RACKET_SHRINK_PER_HIT * 2);
  });

  it('never goes below its floor, however long the rally runs', () => {
    expect(racketHalfWidth(1000)).toBe(RACKET_MIN_HALF_WIDTH);
    expect(racketHalfWidth(1000)).toBeGreaterThan(0);
  });

  it('counts each seat separately, so neither is the wider one every shot', () => {
    // The unfairness this replaced: counting the rally's total returns gave the receiver
    // the wider racket on all of their shots, because the two seats hit on alternate
    // counts. p1 receives the opening serve and won 13 of 24 against an identical
    // opponent until this changed.
    const { game, rng } = started();
    toRally(game, rng);
    for (let hit = 0; hit < 6; hit += 1) {
      const seat: SeatId = game.ball.vy > 0 ? 'p1' : 'p2';
      racketOf(game, seat).x = clampRacket(game.ball.x);
      game.ball.x = racketOf(game, seat).x;
      game.ball.y = racketYOf(seat);
      expect(step(game, STEP, rng).returned).toBe(seat);
    }
    expect(hitsOf(game, 'p1')).toBe(3);
    expect(hitsOf(game, 'p2')).toBe(3);
    expect(reachOf(game, 'p1')).toBe(reachOf(game, 'p2'));
  });

  it('goes back to full width at the next serve', () => {
    const { game, rng } = started();
    toRally(game, rng);
    game.p1Hits = 4;
    game.p2Hits = 2;
    serveTo(game, 'p1');
    expect(reachOf(game, 'p1')).toBe(RACKET_HALF_WIDTH);
    expect(reachOf(game, 'p2')).toBe(RACKET_HALF_WIDTH);
  });

  it('lets a ball past a narrowed racket that a full-width one would have reached', () => {
    // The mechanic's whole job. Same ball, same racket position, different rally length.
    const near = RACKET_HALF_WIDTH - 6;
    const reachedAtFullWidth = (ownHits: number): boolean => {
      const { game, rng } = started();
      toRally(game, rng);
      game.p1Hits = ownHits;
      game.p1.x = clampRacket(TABLE_WIDTH / 2);
      game.ball.x = game.p1.x + near;
      game.ball.y = P1_RACKET_Y;
      game.ball.vx = 0;
      game.ball.vy = 400;
      return step(game, STEP, rng).returned === 'p1';
    };
    expect(reachedAtFullWidth(0)).toBe(true);
    expect(reachedAtFullWidth(6)).toBe(false);
  });
});

describe('the racket', () => {
  it('never moves faster than its speed limit, whoever is driving it', () => {
    const racket = { x: TABLE_WIDTH / 2, velocity: 0 };
    driveRacket(racket, TABLE_WIDTH * 10, STEP);
    expect(racket.x - TABLE_WIDTH / 2).toBeCloseTo(RACKET_SPEED * STEP, 6);
    expect(racket.velocity).toBeCloseTo(RACKET_SPEED, 4);
  });

  it('reports the velocity it actually achieved, not the one it was asked for', () => {
    const racket = { x: TABLE_WIDTH / 2, velocity: 0 };
    driveRacket(racket, TABLE_WIDTH / 2 + 1, STEP);
    expect(racket.velocity).toBeCloseTo(60, 4);
  });

  it('stops at the table edge', () => {
    const racket = { x: TABLE_WIDTH / 2, velocity: 0 };
    for (let i = 0; i < 600; i += 1) driveRacket(racket, -9999, STEP);
    expect(racket.x).toBe(RACKET_MIN_X);
    expect(racket.velocity).toBe(0);
  });
});

describe('scoring', () => {
  it('awards the point to the far end when a ball goes past a baseline', () => {
    for (const conceding of ['p1', 'p2'] as SeatId[]) {
      const { game, rng } = started();
      toRally(game, rng);
      game.ball.y = conceding === 'p1' ? TABLE_HEIGHT + BALL_RADIUS + 5 : -BALL_RADIUS - 5;
      game.ball.vy = conceding === 'p1' ? 400 : -400;
      const outcome = step(game, STEP, rng);
      expect(outcome.scored).toBe(otherOf(conceding));
      expect(pointsOf(game, otherOf(conceding))).toBe(1);
      expect(pointsOf(game, conceding)).toBe(0);
    }
  });

  it('ends the match at the target and names the winner', () => {
    const { game, rng } = started();
    for (let point = 0; point < TARGET_POINTS; point += 1) {
      toRally(game, rng);
      game.ball.y = -BALL_RADIUS - 5;
      game.ball.vy = -400;
      step(game, STEP, rng);
    }
    expect(game.p1Points).toBe(TARGET_POINTS);
    expect(game.phase).toBe('over');
    expect(winnerOf(game)).toBe('p1');
  });

  it('scores nothing once the match is over', () => {
    const { game, rng } = started();
    game.phase = 'over';
    game.winner = 'p1';
    const before = { ...game.ball };
    expect(step(game, STEP, rng).scored).toBeNull();
    expect(game.ball).toEqual(before);
  });

  it('calls a match that runs out of time on points, and a level one a draw', () => {
    const level = createGame();
    resetGame(level);
    callOnTime(level);
    expect(winnerOf(level)).toBe('draw');

    const ahead = createGame();
    resetGame(ahead);
    ahead.p2Points = 3;
    callOnTime(ahead);
    expect(winnerOf(ahead)).toBe('p2');
  });

  it('leaves an already-decided match alone when the clock runs out', () => {
    const { game } = started();
    game.p1Points = TARGET_POINTS;
    game.phase = 'over';
    game.winner = 'p1';
    callOnTime(game);
    expect(winnerOf(game)).toBe('p1');
  });
});

describe('predicting where the ball will land', () => {
  it('agrees with the simulation when nothing is in the way', () => {
    const { game, rng } = started();
    toRally(game, rng);
    game.ball.x = TABLE_WIDTH / 2;
    game.ball.y = TABLE_HEIGHT / 2;
    game.ball.vx = 90;
    game.ball.vy = 400;
    const predicted = predictCrossing(game.ball, P1_RACKET_Y);

    // Walk it forward with nobody holding a racket in the way.
    game.p1.x = -1000;
    game.p2.x = -1000;
    let previous = game.ball.x;
    for (let i = 0; i < 600 && game.ball.y < P1_RACKET_Y; i += 1) {
      previous = game.ball.x;
      step(game, STEP, rng);
    }
    expect(Math.abs(previous - predicted)).toBeLessThan(20);
  });

  it('folds a path that meets the rails back onto the table', () => {
    const { game, rng } = started();
    toRally(game, rng);
    game.ball.x = TABLE_WIDTH / 2;
    game.ball.y = TABLE_HEIGHT / 2;
    game.ball.vx = 900;
    game.ball.vy = 300;
    const predicted = predictCrossing(game.ball, P1_RACKET_Y);
    expect(predicted).toBeGreaterThanOrEqual(RAIL + BALL_RADIUS - 1e-6);
    expect(predicted).toBeLessThanOrEqual(TABLE_WIDTH - RAIL - BALL_RADIUS + 1e-6);
  });

  it('answers with where the ball is when it is not going anywhere', () => {
    const ball = { x: 123, y: 456, vx: 10, vy: 0 };
    expect(predictCrossing(ball, 900)).toBe(123);
    // Or when the target is behind it.
    expect(predictCrossing({ x: 77, y: 456, vx: 0, vy: 100 }, 100)).toBe(77);
  });
});

describe('the bot', () => {
  const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('never asks for a racket position off the table', () => {
    for (const tier of TIERS) {
      const { game, rng } = started();
      const state = createBotState();
      toRally(game, rng);
      for (let i = 0; i < 3000; i += 1) {
        const wanted = botAim(game, 'p2', tier, state, STEP, rng);
        expect(wanted).toBeGreaterThanOrEqual(RACKET_MIN_X);
        expect(wanted).toBeLessThanOrEqual(RACKET_MAX_X);
        driveRacket(game.p2, wanted, STEP);
        step(game, STEP, rng);
        if (game.phase === 'over') resetGame(game);
      }
    }
  });

  it('goes back to the middle when the ball is not coming to it', () => {
    const { game, rng } = started();
    const state = createBotState();
    toRally(game, rng);
    game.ball.vy = 500; // toward p1, away from p2
    // Past the reaction delay of the slowest tier.
    for (let i = 0; i < 60; i += 1) botAim(game, 'p2', 'easy', state, STEP, rng);
    expect(state.aim).toBeCloseTo(TABLE_WIDTH / 2, 6);
  });

  it('holds its aim inside its reaction delay rather than tracking every step', () => {
    const { game, rng } = started();
    const state = createBotState();
    toRally(game, rng);
    game.ball.vy = -500;
    game.ball.x = 100;
    const first = botAim(game, 'p2', 'easy', state, STEP, rng);
    game.ball.x = TABLE_WIDTH - 100;
    const second = botAim(game, 'p2', 'easy', state, STEP, rng);
    expect(second).toBe(first);
  });

  it('gets better as the tier goes up, over a run of matches', () => {
    // The claim the difficulty tiers make. Measured rather than asserted: the same seat
    // plays every tier against the same opponent, and the harder tier must not lose
    // ground. Seeds fixed, so this is a property of the code and not of the day.
    const scores = TIERS.map((tier) => playSeries(tier, 'normal', 6));
    const [easy, normal, hard] = scores as [number, number, number];
    expect(normal).toBeGreaterThan(easy);
    expect(hard).toBeGreaterThan(easy);
    expect(hard).toBeGreaterThanOrEqual(normal - 1);
  });

  it('is balanced against itself', () => {
    // Rule of thumb from the bot issue: 45-55% at equal difficulty. p1 receives the
    // opening serve, so an imbalance here would be a real advantage to one seat.
    const wins = playSeries('normal', 'normal', 24);
    expect(wins).toBeGreaterThanOrEqual(8);
    expect(wins).toBeLessThanOrEqual(16);
  });
});

/** Play `matches` bot-against-bot and return how many p2 won. */
function playSeries(p2Tier: BotDifficulty, p1Tier: BotDifficulty, matches: number): number {
  let p2Wins = 0;
  for (let match = 0; match < matches; match += 1) {
    const game = createGame();
    const rng = new Rng(1000 + match);
    resetGame(game);
    const p1State = createBotState();
    const p2State = createBotState();

    for (let i = 0; i < 60 * ROUND_SECONDS + 60 && game.phase !== 'over'; i += 1) {
      driveRacket(game.p1, botAim(game, 'p1', p1Tier, p1State, STEP, rng), STEP);
      driveRacket(game.p2, botAim(game, 'p2', p2Tier, p2State, STEP, rng), STEP);
      step(game, STEP, rng);
      if (game.elapsed >= ROUND_SECONDS) callOnTime(game);
    }
    if (game.winner === 'p2') p2Wins += 1;
  }
  return p2Wins;
}

describe('determinism', () => {
  it('replays a fixed input trace to the identical final state', () => {
    const play = (): Game => {
      const game = createGame();
      const rng = new Rng(20260823);
      resetGame(game);
      const script = new Rng(4242);
      for (let i = 0; i < 4000 && game.phase !== 'over'; i += 1) {
        driveRacket(game.p1, script.float() * TABLE_WIDTH, STEP);
        driveRacket(game.p2, script.float() * TABLE_WIDTH, STEP);
        step(game, STEP, rng);
      }
      return game;
    };
    expect(play()).toEqual(play());
  });

  it('two different traces do not produce the same match', () => {
    // Guards the replay above from passing vacuously.
    const play = (seed: number): Game => {
      const game = createGame();
      const rng = new Rng(seed);
      resetGame(game);
      for (let i = 0; i < 2000 && game.phase !== 'over'; i += 1) step(game, STEP, rng);
      return game;
    };
    expect(play(1)).not.toEqual(play(999));
  });

  it('always reaches a decision, whoever is playing', () => {
    // The property `termination.test.ts` checks across the whole catalogue, checked here
    // where a failure names a rule rather than a registry entry. Nobody touches a racket:
    // the worst case for ending a point is a table with two absent players, which the
    // baseline handles, and the best case for *not* ending is the clock.
    const game = createGame();
    const rng = new Rng(7);
    resetGame(game);
    let steps = 0;
    for (; steps < 60 * (ROUND_SECONDS + 5) && game.phase !== 'over'; steps += 1) {
      step(game, STEP, rng);
      if (game.elapsed >= ROUND_SECONDS) callOnTime(game);
    }
    expect(game.phase).toBe('over');
    expect(winnerOf(game)).not.toBeNull();
  });
});
