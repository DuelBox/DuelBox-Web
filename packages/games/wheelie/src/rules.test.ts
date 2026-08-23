import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_DRAWS_PER_DECISION,
  BOT_PROFILES,
  BUMPS,
  BUMP_DRAWS,
  BUMP_JOLT,
  BUMP_KICK_MAX,
  BUMP_KICK_MIN,
  COURSE_LENGTH,
  DRAG,
  FALL_SECONDS,
  FLIP_PITCH,
  GRAVITY_TORQUE,
  KICK_REFERENCE,
  LEAN_RATE,
  LEAN_TORQUE,
  PITCH_GAIN,
  RATE_GAIN,
  REJOIN_SPEED,
  SECTORS,
  THRUST_HIGH,
  THRUST_LOW,
  VISIBLE_AHEAD,
  WHEEL_DOWN_PITCH,
  botLean,
  createBotState,
  createGame,
  driveLean,
  holdingLean,
  kickOf,
  otherOf,
  resetGame,
  riderOf,
  sectorOf,
  speedAt,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;
const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];

function started(seed = 1): Game {
  const game = createGame();
  resetGame(game, new Rng(seed));
  return game;
}

/** Run a match to its own end. No frame cap: the caller is asserting there is one. */
function runOut(game: Game, drive?: (game: Game) => void): number {
  let frames = 0;
  while (game.phase !== 'over') {
    drive?.(game);
    step(game, STEP);
    frames += 1;
    if (frames > 60 * 3000) throw new Error('never finished');
  }
  return frames;
}

describe('the course', () => {
  it('deals exactly as many bumps as it promised, in order, before the line', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const game = started(seed);
      expect(game.bumps.length).toBe(BUMPS);
      let last = 0;
      for (const bump of game.bumps) {
        expect(bump.position, `seed ${String(seed)} bumps out of order`).toBeGreaterThan(last);
        expect(bump.position).toBeLessThan(COURSE_LENGTH);
        expect(bump.kick).toBeGreaterThanOrEqual(BUMP_KICK_MIN);
        expect(bump.kick).toBeLessThanOrEqual(BUMP_KICK_MAX);
        last = bump.position;
      }
    }
  });

  it('draws the same number of values for every bump', () => {
    // A variable count would shift everything after it, which is the seat bias made of
    // arithmetic that this repo has now been caught by twice.
    const counter = new Rng(9);
    let draws = 0;
    const counted = {
      float: () => {
        draws += 1;
        return counter.float();
      },
    } as unknown as Rng;
    resetGame(createGame(), counted);
    expect(draws).toBe(BUMPS * BUMP_DRAWS);
  });

  it('is dealt before anybody moves and never touched again', () => {
    // The strongest form of the separation Star Catcher had to argue for: there is no
    // world stream left to share, because `step` takes no generator at all. A tier that
    // makes more decisions therefore cannot deal itself a different course.
    const game = started(4);
    const dealt = game.bumps.map((bump) => `${bump.position.toFixed(6)}:${bump.kick.toFixed(6)}`);
    runOut(game);
    expect(game.bumps.map((bump) => `${bump.position.toFixed(6)}:${bump.kick.toFixed(6)}`)).toEqual(
      dealt,
    );
  });

  it('deals a different course from a different seed', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed += 1) {
      seen.add(
        started(seed)
          .bumps.map((bump) => bump.position.toFixed(2))
          .join(','),
      );
    }
    expect(seen.size).toBe(30);
  });
});

describe('the pendulum', () => {
  it('can lift the front wheel at all, which the torques have to allow', () => {
    // Structural rather than tuned: at full lean the nose rises only while the lean beats
    // gravity, and gravity is at its strongest with the wheel on the ground. At any ratio
    // of one or less the wheel never leaves the ground and the only control does nothing.
    expect(LEAN_TORQUE).toBeGreaterThan(GRAVITY_TORQUE);
    const game = started(2);
    for (let i = 0; i < 60; i += 1) {
      driveLean(game.p1, 1, STEP);
      step(game, STEP);
    }
    expect(game.p1.pitch).toBeGreaterThan(WHEEL_DOWN_PITCH);
  });

  it('gives full lean no equilibrium anywhere, so pinning the control goes over', () => {
    const game = started(2);
    let fell = 0;
    for (let i = 0; i < 60 * 20 && game.phase !== 'over'; i += 1) {
      driveLean(game.p1, 1, STEP);
      const outcome = step(game, STEP);
      if (outcome.fell.includes('p1')) fell += 1;
    }
    expect(fell).toBeGreaterThan(2);
  });

  it('holds an angle at the lean that holds it', () => {
    // The number a rider learns by feel, and the one the gauge draws.
    for (const pitch of [0.3, 0.8, 1.2]) {
      const game = started(3);
      game.p1.pitch = pitch;
      game.p1.lean = holdingLean(pitch);
      for (const bump of game.bumps) bump.position = COURSE_LENGTH * 10;
      for (let i = 0; i < 120; i += 1) {
        driveLean(game.p1, holdingLean(game.p1.pitch), STEP);
        step(game, STEP);
      }
      expect(Math.abs(game.p1.pitch - pitch), `drifted from ${String(pitch)}`).toBeLessThan(0.2);
    }
  });

  it('needs less lean the higher it is, which is the whole craft', () => {
    expect(holdingLean(0)).toBeGreaterThan(holdingLean(0.8));
    expect(holdingLean(0.8)).toBeGreaterThan(holdingLean(1.4));
    expect(holdingLean(FLIP_PITCH)).toBeLessThan(0.05);
  });

  it('costs a fall the moment it reaches the balance point', () => {
    const game = started(3);
    game.p1.pitch = FLIP_PITCH - 0.01;
    game.p1.pitchRate = 4;
    const outcome = step(game, STEP);
    expect(outcome.fell).toContain('p1');
    expect(game.p1.down).toBeCloseTo(FALL_SECONDS, 5);
    expect(game.p1.falls).toBe(1);
  });

  it('picks the bike back up moving, so a fall is a cost and never a stop', () => {
    // Without this the game could stall at nought, and termination would depend on the
    // player rather than on the course.
    const game = started(3);
    game.p1.pitch = FLIP_PITCH;
    step(game, STEP);
    for (let i = 0; i < 60 * 2; i += 1) step(game, STEP);
    expect(game.p1.down).toBe(0);
    expect(game.p1.speed).toBeGreaterThanOrEqual(REJOIN_SPEED * 0.9);
  });
});

describe('speed', () => {
  it('rises with the angle, so a wheelie is what the race is made of', () => {
    expect(speedAt(0)).toBeCloseTo(THRUST_LOW / DRAG, 5);
    expect(speedAt(FLIP_PITCH)).toBeCloseTo(THRUST_HIGH / DRAG, 5);
    expect(speedAt(0.8)).toBeGreaterThan(speedAt(0.3));
  });

  it('is only ever scrubbed on the step the front wheel actually lands', () => {
    // It was charged on every step the wheel was already down, which billed a stationary
    // bike 165 units a second — an idle rider then never finished the course at all, and
    // the whole termination argument failed on one missing edge test.
    const game = started(5);
    for (const bump of game.bumps) bump.position = COURSE_LENGTH * 10;
    for (let i = 0; i < 60 * 4; i += 1) step(game, STEP);
    const rolling = game.p1.speed;
    for (let i = 0; i < 60 * 4; i += 1) step(game, STEP);
    expect(game.p1.pitch).toBe(0);
    expect(game.p1.speed).toBeGreaterThanOrEqual(rolling - 1e-9);
    expect(game.p1.speed).toBeCloseTo(speedAt(0), 0);
  });
});

describe('bumps', () => {
  it('kicks harder the faster it is hit, which is what joins the two halves of the game', () => {
    expect(kickOf(4, KICK_REFERENCE)).toBeCloseTo(4, 6);
    expect(kickOf(4, KICK_REFERENCE * 2)).toBeCloseTo(8, 6);
    expect(kickOf(4, 0)).toBe(0);
  });

  it('lofts the nose whether it was wanted or not', () => {
    const game = started(6);
    const bump = game.bumps[0]!;
    game.p1.distance = bump.position - 1;
    game.p1.speed = 300;
    game.p1.pitch = 0.6;
    step(game, STEP);
    expect(game.p1.nextBump).toBe(1);
    expect(game.p1.pitchRate).toBeGreaterThan(1);
  });

  it('costs speed only when the front wheel is down to meet it', () => {
    const flat = started(6);
    const up = started(6);
    for (const [game, pitch] of [
      [flat, 0],
      [up, 0.5],
    ] as const) {
      const bump = game.bumps[0]!;
      game.p1.distance = bump.position - 1;
      game.p1.speed = 300;
      game.p1.pitch = pitch;
      step(game, STEP);
    }
    expect(flat.p1.jolts).toBe(1);
    expect(up.p1.jolts).toBe(0);
    expect(up.p1.speed - flat.p1.speed).toBeGreaterThan(BUMP_JOLT * 0.9);
  });

  it('is taken once, in order, and never again', () => {
    const game = started(7);
    runOut(game);
    expect(game.p1.nextBump).toBe(BUMPS);
    expect(game.p2.nextBump).toBe(BUMPS);
  });
});

describe('the lean', () => {
  it('never moves faster than a rider can shift their weight', () => {
    const game = started(8);
    driveLean(game.p1, 1, STEP);
    expect(game.p1.lean).toBeCloseTo(LEAN_RATE * STEP, 6);
    driveLean(game.p1, 0, STEP);
    expect(game.p1.lean).toBeCloseTo(0, 6);
  });

  it('stays a level between nothing and everything', () => {
    const game = started(8);
    for (let i = 0; i < 600; i += 1) driveLean(game.p1, 99, STEP);
    expect(game.p1.lean).toBe(1);
    for (let i = 0; i < 600; i += 1) driveLean(game.p1, -99, STEP);
    expect(game.p1.lean).toBe(0);
  });

  it('arrives exactly when it is within reach, rather than overshooting', () => {
    const game = started(8);
    game.p1.lean = 0.5;
    driveLean(game.p1, 0.501, STEP);
    expect(game.p1.lean).toBe(0.501);
  });

  it('cannot be reached faster by asking for it more often', () => {
    // Rule 10, at the level the rules can state it: `driveLean` is a rate, so a control
    // asked for every step and one asked for on alternate steps differ only in that the
    // second is slower. There is no repeat rate in the game for an instrument to win.
    const held = started(8);
    const mashed = started(8);
    for (let i = 0; i < 8; i += 1) {
      driveLean(held.p1, 1, STEP);
      if (i % 2 === 0) driveLean(mashed.p1, 1, STEP);
    }
    expect(held.p1.lean).toBeLessThan(1);
    expect(mashed.p1.lean).toBeLessThan(held.p1.lean);
  });
});

describe('the match', () => {
  it('finishes from every seed with nobody touching the controls', () => {
    // Termination is structural: the course is a fixed length and the motor holds a speed
    // even at rest, so two absent riders still cross. No frame cap does any of the work —
    // `runOut` throws rather than returning if one is ever needed.
    for (let seed = 1; seed <= 60; seed += 1) {
      const game = started(seed);
      runOut(game);
      expect(winnerOf(game), `seed ${String(seed)}`).toBe('draw');
      expect(game.p1.distance).toBeGreaterThanOrEqual(COURSE_LENGTH);
    }
  });

  it('finishes from every seed with the control pinned wide open', () => {
    // The other extreme, and the one that used to loop: a rider who flips at every bump
    // still moves forward between them.
    for (let seed = 1; seed <= 40; seed += 1) {
      const game = started(seed);
      runOut(game, (state) => {
        driveLean(state.p1, 1, STEP);
        driveLean(state.p2, 1, STEP);
      });
      expect(game.p1.falls, `seed ${String(seed)} never fell`).toBeGreaterThan(0);
    }
  });

  it('is won by whoever crosses first, and called there', () => {
    const game = started(9);
    game.p1.distance = COURSE_LENGTH - 1;
    game.p1.speed = 400;
    step(game, STEP);
    expect(winnerOf(game)).toBe('p1');
    expect(game.p2.distance).toBeLessThan(COURSE_LENGTH);
  });

  it('calls a dead heat a dead heat', () => {
    const game = started(9);
    game.p1.distance = COURSE_LENGTH - 1;
    game.p2.distance = COURSE_LENGTH - 1;
    game.p1.speed = 400;
    game.p2.speed = 400;
    step(game, STEP);
    expect(winnerOf(game)).toBe('draw');
  });

  it('stops simulating once it is decided', () => {
    const game = started(9);
    game.phase = 'over';
    game.winner = 'p1';
    const where = game.p1.distance;
    step(game, STEP);
    expect(game.p1.distance).toBe(where);
  });

  it('counts marker posts from nothing to all of them', () => {
    const game = started(9);
    expect(sectorOf(game.p1)).toBe(0);
    game.p1.distance = COURSE_LENGTH / 2;
    expect(sectorOf(game.p1)).toBe(SECTORS / 2);
    game.p1.distance = COURSE_LENGTH * 2;
    expect(sectorOf(game.p1)).toBe(SECTORS);
  });

  it('names the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });

  it('replays a fixed script to the identical final state', () => {
    const play = (): Game => {
      const game = started(20260823);
      const script = new Rng(77);
      runOut(game, (state) => {
        driveLean(state.p1, script.float(), STEP);
        driveLean(state.p2, script.float(), STEP);
      });
      return game;
    };
    expect(play()).toEqual(play());
  });

  it('gives both riders the same race from the same riding', () => {
    // The plainest statement of the shared course: one lean stream, two identical riders,
    // a dead heat every time.
    const game = started(31);
    const script = new Rng(13);
    runOut(game, (state) => {
      const lean = script.float();
      driveLean(state.p1, lean, STEP);
      driveLean(state.p2, lean, STEP);
    });
    expect(game.p1.distance).toBeCloseTo(game.p2.distance, 9);
    expect(winnerOf(game)).toBe('draw');
  });
});

/** One match between two tiers, played to its own end. */
function playMatch(
  seed: number,
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  order: readonly SeatId[] = ['p1', 'p2'],
): Game {
  const seeds = new Rng(seed);
  const game = createGame();
  resetGame(game, new Rng(seeds.next() | 0));
  const bots: Record<SeatId, Rng> = {
    p1: new Rng(seeds.next() | 0),
    p2: new Rng(seeds.next() | 0),
  };
  const states = { p1: createBotState(), p2: createBotState() };
  const tiers: Record<SeatId, BotDifficulty> = { p1: p1Tier, p2: p2Tier };
  runOut(game, (state) => {
    for (const seat of order) {
      const lean = botLean(state, seat, tiers[seat], states[seat], bots[seat], STEP);
      driveLean(riderOf(state, seat), lean, STEP);
    }
  });
  return game;
}

function series(
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  matches: number,
): { p1: number; p2: number; draw: number } {
  const wins = { p1: 0, p2: 0, draw: 0 };
  for (let match = 0; match < matches; match += 1) {
    const winner = playMatch(match * 7 + 1, p1Tier, p2Tier).winner;
    if (winner === 'p1') wins.p1 += 1;
    else if (winner === 'p2') wins.p2 += 1;
    else wins.draw += 1;
  }
  return wins;
}

/**
 * One tier riding alone, with the far lane driven by the same decisions.
 *
 * **Both riders are driven, and that is not cosmetic.** Leaving the far rider idle ends the
 * match the moment *it* crosses, and `step` then stops before the near rider's finish is
 * ever recorded — so a measurement of a tier that falls a lot hangs on a loop waiting for a
 * time that will never be written. The lanes do not interact, so copying the lean into both
 * changes nothing about what is measured and removes the trap.
 */
function soloRide(tier: BotDifficulty, seed: number): Game {
  const seeds = new Rng(41000 + seed);
  const game = createGame();
  resetGame(game, new Rng(seeds.next() | 0));
  const rng = new Rng(seeds.next() | 0);
  const state = createBotState();
  runOut(game, (state_) => {
    const lean = botLean(state_, 'p1', tier, state, rng, STEP);
    driveLean(state_.p1, lean, STEP);
    driveLean(state_.p2, lean, STEP);
  });
  return game;
}

/** Seconds to the line, averaged. No ceiling in it, unlike distance or marker posts. */
function soloSeconds(tier: BotDifficulty, runs: number): number {
  let total = 0;
  for (let seed = 0; seed < runs; seed += 1) total += soloRide(tier, seed).p1.finished;
  return total / runs;
}

describe('the bot', () => {
  it('draws the same number of values whatever it sees', () => {
    for (const tier of TIERS) {
      const game = started(11);
      const rng = new Rng(11);
      const state = createBotState();
      for (let i = 0; i < 400 && game.phase !== 'over'; i += 1) {
        const counter = new Rng(i + 1);
        let draws = 0;
        const counted = {
          float: () => {
            draws += 1;
            return counter.float();
          },
        } as unknown as Rng;
        state.cooldown = 0;
        botLean(game, 'p1', tier, state, counted, STEP);
        expect(draws, `${tier} step ${String(i)}`).toBe(BOT_DRAWS_PER_DECISION);
        driveLean(game.p1, botLean(game, 'p1', tier, state, rng, STEP), STEP);
        step(game, STEP);
      }
    }
  });

  it('spends nothing on a step it is not looking', () => {
    const game = started(11);
    const state = createBotState();
    state.cooldown = 10;
    let draws = 0;
    const counted = {
      float: () => {
        draws += 1;
        return 0.5;
      },
    } as unknown as Rng;
    botLean(game, 'p1', 'hard', state, counted, STEP);
    expect(draws).toBe(0);
  });

  it('only ever asks for a lean the control can give', () => {
    for (const tier of TIERS) {
      const game = started(12);
      const rng = new Rng(12);
      const state = createBotState();
      while (game.phase !== 'over') {
        const lean = botLean(game, 'p1', tier, state, rng, STEP);
        expect(lean).toBeGreaterThanOrEqual(0);
        expect(lean).toBeLessThanOrEqual(1);
        driveLean(game.p1, lean, STEP);
        step(game, STEP);
      }
    }
  });

  it('cannot see the other lane', () => {
    // Rule 6, proved rather than asserted: rewrite the half of the world the bot has no
    // business knowing and check its answer does not move.
    for (const tier of TIERS) {
      const game = started(13);
      const other = started(13);
      for (let i = 0; i < 60 * 6; i += 1) {
        driveLean(game.p1, 0.7, STEP);
        driveLean(other.p1, 0.7, STEP);
        step(game, STEP);
        step(other, STEP);
      }
      other.p2.distance = COURSE_LENGTH * 0.9;
      other.p2.speed = 999;
      other.p2.pitch = 1.4;
      other.p2.falls = 7;
      other.p2.nextBump = BUMPS;
      const a = botLean(game, 'p1', tier, createBotState(), new Rng(5), STEP);
      const b = botLean(other, 'p1', tier, createBotState(), new Rng(5), STEP);
      expect(b, `${tier} read the other lane`).toBe(a);
    }
  });

  it('cannot see further up the lane than the lane is drawn', () => {
    for (const tier of TIERS) {
      const game = started(14);
      const other = started(14);
      for (let i = 0; i < 60 * 6; i += 1) {
        driveLean(game.p1, 0.7, STEP);
        driveLean(other.p1, 0.7, STEP);
        step(game, STEP);
        step(other, STEP);
      }
      let moved = 0;
      for (const bump of other.bumps) {
        if (bump.position - other.p1.distance <= VISIBLE_AHEAD) continue;
        bump.kick = BUMP_KICK_MAX * 4;
        moved += 1;
      }
      expect(moved, 'nothing was out of sight, so this proves nothing').toBeGreaterThan(3);
      const a = botLean(game, 'p1', tier, createBotState(), new Rng(6), STEP);
      const b = botLean(other, 'p1', tier, createBotState(), new Rng(6), STEP);
      expect(b, `${tier} planned for a bump it could not see`).toBe(a);
    }
  });

  it('rides the identical course whichever tier is riding it', () => {
    // The course is a function of the seed and nothing else. On a stream shared with the
    // bots it was not: the tiers make different numbers of decisions, draw different
    // numbers of floats, and the bumps land in different places — so a human would ride a
    // different course from the one every balance figure was measured on.
    const trace = (tier: BotDifficulty): string[] => {
      const game = createGame();
      resetGame(game, new Rng(4242));
      const rng = new Rng(99);
      const state = createBotState();
      const marks: string[] = [];
      let frames = 0;
      while (game.phase !== 'over') {
        driveLean(game.p1, botLean(game, 'p1', tier, state, rng, STEP), STEP);
        step(game, STEP);
        frames += 1;
        if (frames % 30 === 0) {
          for (const bump of game.bumps) marks.push(bump.position.toFixed(6));
        }
      }
      return marks;
    };
    const slow = trace('easy');
    const quick = trace('hard');
    // Compared over the frames both rode: a sharper tier reaches the line sooner and so
    // stops watching earlier, which is a difference in the race, not in the course.
    const shared = Math.min(slow.length, quick.length);
    expect(shared).toBeGreaterThan(BUMPS * 20);
    expect(slow.slice(0, shared)).toEqual(quick.slice(0, shared));
  });

  it('cannot tell which seat was asked first', () => {
    // A stream each. Sharing one and drawing a constant number of values per decision is
    // not enough — whichever seat is polled first still takes the earlier value every
    // time. With a stream each the reversed run is bit-identical.
    for (const [a, b] of [
      ['normal', 'hard'],
      ['easy', 'normal'],
      ['hard', 'hard'],
    ] as [BotDifficulty, BotDifficulty][]) {
      for (let seed = 0; seed < 25; seed += 1) {
        const forward = playMatch(seed * 13 + 3, a, b, ['p1', 'p2']);
        const backward = playMatch(seed * 13 + 3, a, b, ['p2', 'p1']);
        expect(backward.p1.finished).toBe(forward.p1.finished);
        expect(backward.p2.finished).toBe(forward.p2.finished);
        expect(backward.winner).toBe(forward.winner);
      }
    }
  });

  it('does not dead-heat two riders of the same ability', () => {
    // One course, one start, and a bot with no randomness in it is a pure function of the
    // state — so before `REACTION_WANDER` existed, 60 matches of `normal` against itself
    // were 60 draws.
    const wins = series('normal', 'normal', 200);
    expect(wins.draw).toBeLessThan(30);
    expect(wins.p1).toBeGreaterThan(60);
    expect(wins.p2).toBeGreaterThan(60);
  });

  it('reaches the line sooner as the tier goes up', () => {
    // Time rather than distance or marker posts. Both of those saturate — every tier
    // finishes the whole course, so "distance at the end" says all three are identical.
    const [easy, normal, hard] = TIERS.map((tier) => soloSeconds(tier, 24)) as [
      number,
      number,
      number,
    ];
    expect(normal, `easy ${easy.toFixed(1)}s normal ${normal.toFixed(1)}s`).toBeLessThan(easy);
    expect(hard, `normal ${normal.toFixed(1)}s hard ${hard.toFixed(1)}s`).toBeLessThan(normal);
  });

  it('falls less often as the tier goes up', () => {
    const falls = TIERS.map((tier) => {
      let total = 0;
      for (let seed = 0; seed < 24; seed += 1) total += soloRide(tier, seed).p1.falls;
      return total / 24;
    });
    expect(falls[1]!).toBeLessThan(falls[0]!);
    expect(falls[2]!).toBeLessThan(falls[1]!);
  });
});

describe('the bot profiles', () => {
  it('looks more often, further and more carefully as the tier goes up', () => {
    expect(BOT_PROFILES.easy.reaction).toBeGreaterThan(BOT_PROFILES.normal.reaction);
    expect(BOT_PROFILES.normal.reaction).toBeGreaterThan(BOT_PROFILES.hard.reaction);
    expect(BOT_PROFILES.easy.foresight).toBeLessThan(BOT_PROFILES.normal.foresight);
    expect(BOT_PROFILES.normal.foresight).toBeLessThan(BOT_PROFILES.hard.foresight);
    expect(BOT_PROFILES.easy.read).toBeLessThan(BOT_PROFILES.normal.read);
    expect(BOT_PROFILES.normal.read).toBeLessThan(BOT_PROFILES.hard.read);
  });

  it('keeps every tier inside the sight its own lane gives it', () => {
    // `foresight` is in seconds of travel and is capped at `VISIBLE_AHEAD`, but a tier
    // whose nominal reach was miles past the lane would be a number that reads as an axis
    // and is not one.
    for (const tier of TIERS) {
      const topSpeed = speedAt(BOT_PROFILES[tier].ride * FLIP_PITCH);
      expect(BOT_PROFILES[tier].foresight * topSpeed, `${tier}`).toBeLessThanOrEqual(
        VISIBLE_AHEAD * 1.05,
      );
    }
  });

  it('rides higher as the tier goes up, and pays for it if it cannot hold it', () => {
    // `ride` is the one field that is **not** a difficulty axis. Swept alone it is worth
    // under a second to `hard` across its whole plateau, and it is ruinous to `easy`: this
    // is the measurement, in miniature. It is here so that the ordering in the table
    // cannot be mistaken for a claim that braver is better.
    expect(BOT_PROFILES.easy.ride).toBeLessThan(BOT_PROFILES.normal.ride);
    expect(BOT_PROFILES.normal.ride).toBeLessThan(BOT_PROFILES.hard.ride);

    // The bot's own hold — `holdingLean` plus the same two gains — aimed at each tier's
    // height in turn, with everything else identical. It is the sweep in miniature.
    const fallsAiming = (ride: number): number => {
      let total = 0;
      const runs = 12;
      const target = ride * FLIP_PITCH;
      for (let seed = 0; seed < runs; seed += 1) {
        const game = createGame();
        resetGame(game, new Rng(41000 + seed));
        runOut(game, (live) => {
          const lean =
            holdingLean(target) +
            PITCH_GAIN * (target - live.p1.pitch) -
            RATE_GAIN * live.p1.pitchRate;
          driveLean(live.p1, lean, STEP);
          driveLean(live.p2, lean, STEP);
        });
        total += game.p1.falls;
      }
      return total / runs;
    };
    expect(fallsAiming(BOT_PROFILES.hard.ride)).toBeGreaterThan(
      fallsAiming(BOT_PROFILES.easy.ride),
    );
  });
});

describe('balance', () => {
  it.each(TIERS)('is even between two %s riders', (tier) => {
    /*
     * Seven hundred here, against the 2,400 the figure in SPEC.md comes from. Four hundred
     * was demonstrably not enough — one tier read 56 % over 400 seeds and 51 % over 2,400,
     * because a race is decided by a single fall and one unlucky course moves the whole
     * result. But this file shares a five-second cap with a suite that already has a game
     * running at 4.2 s of it, so the standing measurement lives in the harness and what
     * runs on every commit is the regression guard: a band wide enough to be quiet at this
     * sample size and narrow enough to catch a seat bias worth the name.
     */
    const wins = series(tier, tier, 700);
    const decided = wins.p1 + wins.p2;
    expect(decided, `${tier} decided nothing`).toBeGreaterThan(600);
    const share = wins.p1 / decided;
    expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeGreaterThan(0.44);
    expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeLessThan(0.56);
  });

  it('is won by the stronger tier from either seat', () => {
    for (const [strong, weak] of [
      ['hard', 'easy'],
      ['normal', 'easy'],
      ['hard', 'normal'],
    ] as [BotDifficulty, BotDifficulty][]) {
      const asP1 = series(strong, weak, 90);
      expect(asP1.p1, `${strong} as p1 v ${weak}`).toBeGreaterThan(asP1.p2 * 2);
      const asP2 = series(weak, strong, 90);
      expect(asP2.p2, `${strong} as p2 v ${weak}`).toBeGreaterThan(asP2.p1 * 2);
    }
  });
});
