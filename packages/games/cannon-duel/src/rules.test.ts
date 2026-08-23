import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  AIM_SWEEP,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOT_DRAWS_PER_SHOT,
  BOT_PROFILES,
  CENTRE_X,
  CENTRE_Y,
  HIT_RADIUS,
  MAX_POWER,
  MAX_VOLLEYS,
  MAX_WIND,
  MIN_POWER,
  P1_CANNON_Y,
  P2_CANNON_Y,
  SETTLE_SECONDS,
  TARGET_HITS,
  botPresses,
  cannonYOf,
  createBotState,
  createGame,
  firingSign,
  hitsOf,
  otherOf,
  planShot,
  predictLanding,
  press,
  resetGame,
  rollWind,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;

function started(seed = 1): { game: Game; rng: Rng } {
  const game = createGame();
  const rng = new Rng(seed);
  resetGame(game, rng);
  return { game, rng };
}

/** Step until `done`, or give up. */
function until(game: Game, rng: Rng, done: () => boolean, limit = 6000): number {
  let steps = 0;
  for (; steps < limit && !done(); steps += 1) step(game, STEP, rng);
  return steps;
}

/** Fire the active seat's shot at a chosen angle and power, and run it to the ground. */
function shoot(game: Game, rng: Rng, angle: number, power: number): void {
  game.aim = angle;
  press(game, game.active);
  game.power = power;
  press(game, game.active);
  until(game, rng, () => game.phase !== 'flying');
}

describe('the field', () => {
  it('puts the two cannons on the centre line, equally far from it', () => {
    // On the same vertical line deliberately: a shot then travels straight down the board
    // and the crosswind pushes it sideways, so both players face the identical problem in
    // the identical wind.
    expect(P1_CANNON_Y - CENTRE_Y).toBe(CENTRE_Y - P2_CANNON_Y);
    expect(cannonYOf('p1')).toBe(P1_CANNON_Y);
    expect(cannonYOf('p2')).toBe(P2_CANNON_Y);
    expect(P1_CANNON_Y).toBeLessThan(BOARD_HEIGHT);
    expect(P2_CANNON_Y).toBeGreaterThan(0);
  });

  it('fires the two seats in opposite directions', () => {
    expect(firingSign('p1')).toBe(-firingSign('p2'));
  });

  it('starts level, with p1 to fire', () => {
    const { game } = started();
    expect(game.p1Hits).toBe(0);
    expect(game.p2Hits).toBe(0);
    expect(game.active).toBe('p1');
    expect(game.phase).toBe('aiming');
    expect(winnerOf(game)).toBeNull();
  });
});

describe('the needles', () => {
  it('sweep between their limits and turn round', () => {
    const { game, rng } = started();
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < 600; i += 1) {
      step(game, STEP, rng);
      low = Math.min(low, game.aim);
      high = Math.max(high, game.aim);
    }
    expect(high).toBeCloseTo(AIM_SWEEP, 2);
    expect(low).toBeCloseTo(-AIM_SWEEP, 2);
  });

  it('take one press for the angle and a second for the power', () => {
    const { game } = started();
    game.aim = 0.3;
    expect(press(game, 'p1')).toBe(true);
    expect(game.phase).toBe('powering');
    expect(game.lockedAim).toBe(0.3);
    expect(press(game, 'p1')).toBe(true);
    expect(game.phase).toBe('flying');
  });

  it('ignore a press from the seat that is not firing', () => {
    const { game } = started();
    expect(press(game, 'p2')).toBe(false);
    expect(game.phase).toBe('aiming');
  });

  it('ignore a press while a shot is in the air', () => {
    const { game } = started();
    press(game, 'p1');
    press(game, 'p1');
    expect(game.phase).toBe('flying');
    expect(press(game, 'p1')).toBe(false);
  });

  it('keep the power needle inside its range', () => {
    const { game, rng } = started();
    press(game, 'p1');
    for (let i = 0; i < 600; i += 1) {
      step(game, STEP, rng);
      expect(game.power).toBeGreaterThanOrEqual(0);
      expect(game.power).toBeLessThanOrEqual(1);
    }
  });
});

describe('a shot', () => {
  it('lands where the prediction says it will', () => {
    // The bot uses the closed form; if the two disagreed the bot would be aiming at a
    // different game from the one being played.
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      for (const angle of [-0.4, 0, 0.5]) {
        for (const power of [0.3, 0.7, 1]) {
          const { game, rng } = started(3);
          game.wind = 90;
          game.active = seat;
          const predicted = predictLanding(seat, angle, power, game.wind);
          // A shot that would land off the board never gets there — it leaves sideways
          // first, and comparing where it happened to exit against where it would have
          // landed compares two different things. That mistake is what this line prevents.
          if (!Number.isFinite(predicted)) continue;
          if (predicted < 60 || predicted > BOARD_WIDTH - 60) continue;

          shoot(game, rng, angle, power);
          const actual = game.shot.x;
          const arrivedAtTheLine = Math.abs(game.shot.y - cannonYOf(otherOf(seat))) < 120;
          if (!arrivedAtTheLine) continue;
          expect(
            Math.abs(actual - predicted),
            `${seat} at ${String(angle)}/${String(power)}`,
          ).toBeLessThan(40);
        }
      }
    }
  });

  it('counts as a hit near the opposing cannon and not far from it', () => {
    const { game, rng } = started(2);
    game.wind = 0;
    // Drop it right on the target.
    game.phase = 'flying';
    game.shot.x = CENTRE_X;
    game.shot.y = cannonYOf('p2') + HIT_RADIUS * 0.5;
    game.shot.vx = 0;
    game.shot.vy = -400;
    const outcome = step(game, STEP, rng);
    expect(outcome.landed).toBe(true);
    expect(outcome.hit).toBe(true);
    expect(hitsOf(game, 'p1')).toBe(1);
  });

  it('is spent once it leaves the board', () => {
    const { game, rng } = started(2);
    game.phase = 'flying';
    game.shot.x = -100;
    game.shot.y = CENTRE_Y;
    game.shot.vx = -600;
    game.shot.vy = 0;
    const outcome = step(game, STEP, rng);
    expect(outcome.landed).toBe(true);
    expect(outcome.hit).toBe(false);
  });

  it('is pushed sideways by the wind, the same way for both seats', () => {
    // The crosswind is the one thing both players must read, and it must not be kinder to
    // one of them. Same angle, same power, opposite seats: the two shots must be pushed by
    // the same distance.
    // At full power, so both shots genuinely reach the far cannon and there is a landing
    // point to compare.
    const drift = (seat: SeatId): number => {
      const still = predictLanding(seat, 0, 1, 0);
      const blown = predictLanding(seat, 0, 1, MAX_WIND);
      return blown - still;
    };
    expect(drift('p1')).toBeCloseTo(drift('p2'), 6);
    expect(Math.abs(drift('p1'))).toBeGreaterThan(10);
  });
});

describe('the wind', () => {
  it('changes between volleys and never between the two shots of one', () => {
    // A match is a sequence of identical problems posed to two people, rather than a
    // sequence of different problems handed out in turn.
    const { game, rng } = started(5);
    const first = game.wind;
    shoot(game, rng, 0.1, 0.5);
    until(game, rng, () => game.active === 'p2');
    expect(game.wind, 'the wind changed between the two shots of a volley').toBe(first);

    shoot(game, rng, 0.1, 0.5);
    until(game, rng, () => game.active === 'p1' || game.phase === 'over');
    expect(game.volleys).toBe(2);
  });

  it('blows both ways, and never harder than its limit', () => {
    const game = createGame();
    const rng = new Rng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i += 1) {
      rollWind(game, rng);
      expect(Math.abs(game.wind)).toBeLessThanOrEqual(MAX_WIND);
      seen.add(Math.sign(game.wind));
    }
    expect(seen.has(1)).toBe(true);
    expect(seen.has(-1)).toBe(true);
  });
});

describe('turns', () => {
  it('pass to the other seat after the shot has been shown', () => {
    const { game, rng } = started();
    shoot(game, rng, 0, 0.5);
    expect(game.phase).toBe('settling');
    const steps = until(game, rng, () => game.active === 'p2');
    expect(steps * STEP).toBeCloseTo(SETTLE_SECONDS, 1);
    expect(game.phase).toBe('aiming');
  });

  it('alternate, so neither seat fires twice running', () => {
    const { game, rng } = started();
    const order: SeatId[] = [];
    for (let i = 0; i < 8 && game.phase !== 'over'; i += 1) {
      order.push(game.active);
      shoot(game, rng, 0.2, 0.5);
      until(game, rng, () => game.phase === 'aiming' || game.phase === 'over');
    }
    for (let i = 1; i < order.length; i += 1) expect(order[i]).toBe(otherOf(order[i - 1]!));
  });
});

describe('the match ending', () => {
  it('waits for the volley to finish before it is won', () => {
    // First-to-three would otherwise be won by whoever fires first whenever both players
    // are good — the trap Knife Thrower fell into, and the answer darts and cricket reach.
    const { game, rng } = started();
    game.p1Hits = TARGET_HITS - 1;
    // p1 has fired one more than p2, which is what makes the volley incomplete. Set by
    // hand because the shot below is placed rather than fired.
    game.p1Shots = 5;
    game.p2Shots = 4;
    game.phase = 'flying';
    game.shot.x = CENTRE_X;
    game.shot.y = cannonYOf('p2') + HIT_RADIUS * 0.5;
    game.shot.vy = -400;
    step(game, STEP, rng);
    expect(hitsOf(game, 'p1')).toBe(TARGET_HITS);
    until(game, rng, () => game.phase === 'aiming' || game.phase === 'over');
    // p2 has a shot in hand, so it is not over.
    expect(game.phase).toBe('aiming');
    expect(game.active).toBe('p2');

    shoot(game, rng, 0.7, 1);
    until(game, rng, () => game.phase === 'over' || game.phase === 'aiming');
    expect(winnerOf(game)).toBe('p1');
  });

  it('plays on while the two are level at the target', () => {
    const { game, rng } = started();
    game.p1Hits = TARGET_HITS;
    game.p2Hits = TARGET_HITS;
    game.p1Shots = 5;
    game.p2Shots = 5;
    game.active = 'p1';
    game.volleys = 2;
    shoot(game, rng, 0.6, 1);
    until(game, rng, () => game.phase === 'aiming' || game.phase === 'over');
    expect(game.active).toBe('p2');
    shoot(game, rng, 0.6, 1);
    until(game, rng, () => game.phase === 'aiming' || game.phase === 'over');
    expect(game.p1Hits).toBe(game.p2Hits);
    expect(game.phase).toBe('aiming');
  });

  it('always ends, even between two players who never hit anything', () => {
    // Structural: twelve volleys, and nothing about how it is played can add one.
    const { game, rng } = started(11);
    let steps = 0;
    for (; steps < 60 * 900 && game.phase !== 'over'; steps += 1) {
      // Fire wide, every time.
      if (game.phase === 'aiming') {
        game.aim = AIM_SWEEP;
        press(game, game.active);
      } else if (game.phase === 'powering') {
        game.power = 1;
        press(game, game.active);
      }
      step(game, STEP, rng);
    }
    expect(game.phase).toBe('over');
    expect(winnerOf(game)).toBe('draw');
    expect(game.volleys).toBeLessThanOrEqual(MAX_VOLLEYS + 1);
  });

  it('stops simulating once it is decided', () => {
    const { game, rng } = started();
    game.phase = 'over';
    game.winner = 'p1';
    const aim = game.aim;
    step(game, STEP, rng);
    expect(game.aim).toBe(aim);
  });
});

describe('the bot', () => {
  const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('draws the same number of values for every shot', () => {
    // Both bots share one Rng: a seat whose draw count depends on what it chose shifts the
    // other seat's stream, which is a seat bias made of arithmetic.
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 25; seed += 1) {
        const { game } = started(seed);
        const counter = new Rng(seed);
        let draws = 0;
        const counted = {
          float: () => {
            draws += 1;
            return counter.float();
          },
        } as unknown as Rng;
        planShot(game, 'p1', tier, createBotState(), counted);
        expect(draws, `${tier} seed ${String(seed)}`).toBe(BOT_DRAWS_PER_SHOT);
      }
    }
  });

  it('only ever asks for a shot the needles can produce', () => {
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const { game, rng } = started(seed);
        const state = createBotState();
        planShot(game, 'p1', tier, state, rng);
        expect(state.wantAim).toBeGreaterThanOrEqual(-AIM_SWEEP);
        expect(state.wantAim).toBeLessThanOrEqual(AIM_SWEEP);
        expect(state.wantPower).toBeGreaterThanOrEqual(0);
        expect(state.wantPower).toBeLessThanOrEqual(1);
      }
    }
  });

  it('finds a shot that would land on the target in still air', () => {
    // The search is over the same two dials a player is watching, and nothing else.
    const { game, rng } = started(4);
    game.wind = 0;
    const state = createBotState();
    planShot(game, 'p1', 'hard', state, rng);
    const landing = predictLanding('p1', state.wantAim, state.wantPower, 0);
    expect(Math.abs(landing - CENTRE_X)).toBeLessThan(HIT_RADIUS);
  });

  it('hits a larger share of its shots as the tier goes up', () => {
    const rates = TIERS.map((tier) => hitRate(tier));
    const [easy, normal, hard] = rates as [number, number, number];
    expect(normal, `easy ${easy.toFixed(2)} normal ${normal.toFixed(2)}`).toBeGreaterThan(easy);
    expect(hard, `normal ${normal.toFixed(2)} hard ${hard.toFixed(2)}`).toBeGreaterThan(normal);
  });

  it('is balanced against itself', () => {
    for (const tier of TIERS) {
      const wins = playSeries(tier, tier, 40);
      const decided = wins.p1 + wins.p2;
      expect(decided, `${tier} decided nothing`).toBeGreaterThan(25);
      const share = wins.p1 / decided;
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeGreaterThan(
        0.35,
      );
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeLessThan(0.65);
    }
  });

  it('beats a weaker tier from either seat', () => {
    // `hard` against `normal` is deliberately closer than the others — both tiers can find
    // the shot and differ only in how accurately they stop the needle — so it is held to a
    // clear majority rather than to the 2:1 the easy pairings meet comfortably.
    for (const [strong, weak, ratio] of [
      ['hard', 'easy', 2],
      ['normal', 'easy', 2],
      ['hard', 'normal', 1.5],
    ] as [BotDifficulty, BotDifficulty, number][]) {
      const asP1 = playSeries(strong, weak, 40);
      expect(asP1.p1, `${strong} as p1 v ${weak}`).toBeGreaterThan(asP1.p2 * ratio);
      const asP2 = playSeries(weak, strong, 40);
      expect(asP2.p2, `${strong} as p2 v ${weak}`).toBeGreaterThan(asP2.p1 * ratio);
    }
  });

  it('never presses more accurately than its own timing allows', () => {
    for (const tier of TIERS) expect(BOT_PROFILES[tier].timing).toBeGreaterThan(0);
    expect(BOT_PROFILES.hard.timing).toBeLessThan(BOT_PROFILES.normal.timing);
    expect(BOT_PROFILES.normal.timing).toBeLessThan(BOT_PROFILES.easy.timing);
  });
});

/** The share of one tier's shots that land on the target. */
function hitRate(tier: BotDifficulty): number {
  let landed = 0;
  let hit = 0;
  for (let seed = 0; seed < 20; seed += 1) {
    const { game, rng } = started(2000 + seed);
    const state = createBotState();
    for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
      const active = game.active;
      if (game.phase === 'aiming' && !state.planned) planShot(game, active, tier, state, rng);
      if (game.phase === 'aiming' || game.phase === 'powering') {
        if (botPresses(game, state, STEP)) press(game, active);
      } else {
        state.planned = false;
      }
      const outcome = step(game, STEP, rng);
      if (!outcome.landed) continue;
      landed += 1;
      if (outcome.hit) hit += 1;
    }
  }
  return hit / Math.max(1, landed);
}

function playSeries(
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  matches: number,
): { p1: number; p2: number; draw: number } {
  const wins = { p1: 0, p2: 0, draw: 0 };
  for (let match = 0; match < matches; match += 1) {
    const { game, rng } = started(4000 + match);
    const states = { p1: createBotState(), p2: createBotState() };
    const tiers: Record<SeatId, BotDifficulty> = { p1: p1Tier, p2: p2Tier };

    for (let i = 0; i < 60 * 600 && game.phase !== 'over'; i += 1) {
      const active = game.active;
      const state = states[active];
      if (game.phase === 'aiming' && !state.planned) {
        planShot(game, active, tiers[active], state, rng);
      }
      if (game.phase === 'aiming' || game.phase === 'powering') {
        if (botPresses(game, state, STEP)) press(game, active);
      } else {
        state.planned = false;
      }
      step(game, STEP, rng);
    }
    if (game.winner === 'p1') wins.p1 += 1;
    else if (game.winner === 'p2') wins.p2 += 1;
    else wins.draw += 1;
  }
  return wins;
}

describe('determinism', () => {
  it('replays a fixed script to the identical final state', () => {
    const play = (): Game => {
      const game = createGame();
      const rng = new Rng(20260823);
      resetGame(game, rng);
      const script = new Rng(1234);
      for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
        if (script.float() < 0.03) press(game, game.active);
        step(game, STEP, rng);
      }
      return game;
    };
    expect(play()).toEqual(play());
  });

  it('deals a different wind from a different seed', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed += 1) {
      const { game } = started(seed);
      seen.add(game.wind.toFixed(4));
    }
    expect(seen.size).toBeGreaterThan(20);
  });

  it('keeps the power range meaningful', () => {
    expect(MIN_POWER).toBeGreaterThan(0);
    expect(MAX_POWER).toBeGreaterThan(MIN_POWER * 1.5);
  });
});
