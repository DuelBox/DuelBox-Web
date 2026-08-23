import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  AIM_SPREAD,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOT_DRAWS_PER_NEEDLE,
  BOT_PROFILES,
  CENTRED_WORTH,
  CLEAN_WORTH,
  GAP_HALF_WIDTH,
  MID_Y,
  PUCKS_PER_SEAT,
  PUCK_RADIUS,
  READY_SECONDS,
  SHOTS_PER_SEAT,
  angleOf,
  botPress,
  createBotState,
  createGame,
  forwardOf,
  onSideOf,
  ownSide,
  pickLoaded,
  powerOf,
  resetGame,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

function started(): Game {
  const game = createGame();
  resetGame(game);
  return game;
}

/** A whole match between two bots, mirroring how `game.ts` drives it. */
function playOut(t1: BotDifficulty, t2: BotDifficulty, seed: number): Game {
  const match = new Rng(seed);
  const rng: Record<SeatId, Rng> = {
    p1: new Rng(match.next() | 0),
    p2: new Rng(match.next() | 0),
  };
  const game = started();
  const state = { p1: createBotState(), p2: createBotState() };
  const tier: Record<SeatId, BotDifficulty> = { p1: t1, p2: t2 };
  // Deliberately no frame cap: if the rules do not end the match, this hangs rather than
  // quietly reporting a pass.
  while (game.phase !== 'over') {
    const seat = game.active;
    const pressed = botPress(game, seat, tier[seat], state[seat], rng[seat]);
    step(game, STEP, pressed ? seat : null);
  }
  return game;
}

describe('the board', () => {
  it('racks both seats point-symmetrically', () => {
    const game = started();
    const mine = game.pucks.filter((puck) => puck.owner === 'p1');
    const theirs = game.pucks.filter((puck) => puck.owner === 'p2');
    expect(mine).toHaveLength(PUCKS_PER_SEAT);
    expect(theirs).toHaveLength(PUCKS_PER_SEAT);
    for (let i = 0; i < PUCKS_PER_SEAT; i += 1) {
      const a = mine[i];
      const b = theirs[i];
      if (a === undefined || b === undefined) throw new Error('missing puck');
      // The far seat's rack is the near one's, reflected in the wall.
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(MID_Y - a.y).toBeCloseTo(b.y - MID_Y, 6);
    }
  });

  it('starts every puck on its owner side, clear of the wall and the rails', () => {
    for (const puck of started().pucks) {
      expect(ownSide(puck.owner, puck.y)).toBe(true);
      expect(puck.x).toBeGreaterThanOrEqual(PUCK_RADIUS);
      expect(puck.x).toBeLessThanOrEqual(BOARD_WIDTH - PUCK_RADIUS);
      expect(puck.y).toBeGreaterThanOrEqual(PUCK_RADIUS);
      expect(puck.y).toBeLessThanOrEqual(BOARD_HEIGHT - PUCK_RADIUS);
    }
  });

  it('racks nothing where the needle cannot point at the gap', () => {
    // The first rack put two pucks 0.74 rad off straight against a needle that sweeps 0.62,
    // so they could not be aimed at the gap at all — by anyone. Since the rack empties from
    // the front they were always the second shot, and crossings on shot two measured 0.20
    // against 0.96 either side of it, at every tier. A shot nobody can reach the answer with
    // is not a hard shot.
    for (const puck of started().pucks) {
      const depth = puck.owner === 'p1' ? MID_Y - puck.y : puck.y - MID_Y;
      const across = Math.abs(puck.x - BOARD_WIDTH / 2);
      const needed = Math.atan2(across, depth);
      expect(needed, `a puck ${across.toFixed(0)} across at ${depth.toFixed(0)} back`).toBeLessThan(
        AIM_SPREAD,
      );
    }
  });

  it('leaves a gap a puck actually fits through', () => {
    expect(GAP_HALF_WIDTH).toBeGreaterThan(PUCK_RADIUS);
  });

  it('loads the puck nearest the gap, and only its owner’s', () => {
    const game = started();
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const index = pickLoaded(game, seat);
      const puck = game.pucks[index];
      if (puck === undefined) throw new Error('nothing loaded');
      expect(puck.owner).toBe(seat);
      const depth = seat === 'p1' ? MID_Y - puck.y : puck.y - MID_Y;
      for (const other of game.pucks) {
        if (other.owner !== seat) continue;
        const theirs = seat === 'p1' ? MID_Y - other.y : other.y - MID_Y;
        expect(depth).toBeLessThanOrEqual(theirs);
      }
    }
  });
});

describe('the needles', () => {
  it('reads the middle of the sweep as straight ahead, either way up', () => {
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const angle = angleOf(seat, 0.5);
      expect(Math.cos(angle)).toBeCloseTo(0, 6);
      expect(Math.sin(angle)).toBeCloseTo(forwardOf(seat), 6);
    }
  });

  it('sweeps the same width to either side for both seats', () => {
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const straight = angleOf(seat, 0.5);
      expect(Math.abs(angleOf(seat, 0) - straight)).toBeCloseTo(AIM_SPREAD, 6);
      expect(Math.abs(angleOf(seat, 1) - straight)).toBeCloseTo(AIM_SPREAD, 6);
    }
  });

  it('turns a stronger sweep into a faster puck, always forwards', () => {
    expect(powerOf(0)).toBeGreaterThan(0);
    expect(powerOf(1)).toBeGreaterThan(powerOf(0.5));
    expect(powerOf(0.5)).toBeGreaterThan(powerOf(0));
  });

  it('holds still at the start of a turn, and for longer than the board takes to turn', () => {
    // The shell refuses a person's input while the board turns, and a bot does not go through
    // the shell — so without this the bot had the first third of a second of every turn to
    // itself. It lives in the rules rather than the presentation because `seatView` reports
    // no rotation in single-seat play, and the two presentations would step different matches.
    const game = started();
    expect(game.ready).toBeGreaterThan(0.36);
    expect(READY_SECONDS).toBeGreaterThan(0.36);
    const still = Math.floor(READY_SECONDS * 60);
    for (let i = 0; i < still; i += 1) {
      step(game, STEP, null);
      expect(game.sweep, `moved on frame ${i}`).toBe(0);
    }
    // Within a frame or two of the pause ending — the exact frame is a rounding of 0.45 s
    // into sixtieths and not something worth asserting.
    let moved = 0;
    for (let i = 0; i < 4 && moved === 0; i += 1) {
      step(game, STEP, null);
      moved = game.sweep;
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('ignores the seat whose turn it is not', () => {
    const game = started();
    for (let i = 0; i < 40; i += 1) step(game, STEP, 'p2');
    expect(game.phase).toBe('aim');
    expect(game.p2Shots).toBe(0);
  });
});

describe('the match', () => {
  it('ends on its own from every seed, with no frame cap doing the work', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const game = playOut('easy', 'hard', seed);
      expect(game.phase).toBe('over');
      expect(game.p1Shots).toBe(SHOTS_PER_SEAT);
      expect(game.p2Shots).toBe(SHOTS_PER_SEAT);
    }
  });

  it('gives both seats the same number of shots, and the ends of the match to different seats', () => {
    // A race in which one player starts first is not a race. The lead alternates each round,
    // and with an even number of rounds seat one takes both the first shot and the last —
    // both ends of the match — so the count is odd.
    const order: SeatId[] = [];
    const game = started();
    const match = new Rng(4);
    const rng: Record<SeatId, Rng> = {
      p1: new Rng(match.next() | 0),
      p2: new Rng(match.next() | 0),
    };
    const state = { p1: createBotState(), p2: createBotState() };
    let last: SeatId | null = null;
    while (game.phase !== 'over') {
      const seat = game.active;
      const pressed = botPress(game, seat, 'normal', state[seat], rng[seat]);
      const wasPower = game.phase === 'power';
      step(game, STEP, pressed ? seat : null);
      if (pressed && wasPower) {
        order.push(seat);
        last = seat;
      }
    }
    expect(order.filter((seat) => seat === 'p1')).toHaveLength(SHOTS_PER_SEAT);
    expect(order.filter((seat) => seat === 'p2')).toHaveLength(SHOTS_PER_SEAT);
    expect(order[0]).not.toBe(last);
  });

  it('pays three for the middle, two for clean and one for a rattle', () => {
    expect(CENTRED_WORTH).toBeGreaterThan(CLEAN_WORTH);
    expect(CLEAN_WORTH).toBeGreaterThan(1);
  });

  it('never scores a puck twice, and never puts one back in play', () => {
    for (let seed = 0; seed < 12; seed += 1) {
      const game = playOut('hard', 'hard', seed);
      for (const puck of game.pucks) {
        if (!puck.through) continue;
        expect(puck.vx).toBe(0);
        expect(puck.vy).toBe(0);
      }
      const left = onSideOf(game, 'p1') + onSideOf(game, 'p2');
      const gone = game.pucks.filter((puck) => puck.through).length;
      expect(left + gone).toBe(PUCKS_PER_SEAT * 2);
    }
  });

  it('gives the win to whoever put more through', () => {
    for (let seed = 0; seed < 24; seed += 1) {
      const game = playOut('easy', 'hard', seed);
      const winner = winnerOf(game);
      if (game.p1Through > game.p2Through) expect(winner).toBe('p1');
      else if (game.p2Through > game.p1Through) expect(winner).toBe('p2');
      else expect(winner).toBe('draw');
    }
  });

  it('replays a seed exactly, and deals a different match from a different one', () => {
    const trace = (seed: number): string => {
      const game = playOut('normal', 'hard', seed);
      return `${game.p1Through}:${game.p2Through}`;
    };
    expect(trace(11)).toBe(trace(11));
    expect(new Set([trace(1), trace(2), trace(3), trace(4), trace(5)]).size).toBeGreaterThan(1);
  });
});

describe('the bot', () => {
  it('draws the same number of values whatever it decides', () => {
    for (const tier of TIERS) {
      const game = started();
      const state = createBotState();
      const rng = new Rng(7);
      let drawn = 0;
      const counted = {
        next: () => rng.next(),
        float: () => {
          drawn += 1;
          return rng.float();
        },
      } as unknown as Rng;
      let needles = 0;
      for (let i = 0; i < 60 * 40 && game.phase !== 'over'; i += 1) {
        const seat = game.active;
        if (seat !== 'p1') {
          step(game, STEP, null);
          continue;
        }
        const wasSweeping = game.phase === 'aim' || game.phase === 'power';
        const pressed = botPress(game, 'p1', tier, state, counted);
        if (pressed && wasSweeping) needles += 1;
        step(game, STEP, pressed ? 'p1' : null);
      }
      expect(needles).toBeGreaterThan(0);
      expect(drawn, `${tier} drew ${drawn} for ${needles} needles`).toBe(
        needles * BOT_DRAWS_PER_NEEDLE,
      );
    }
  });

  it('cannot stop a needle finer than the frame it is shown', () => {
    // Rule 6. It picks a value and waits, exactly as a person does — a frame of the needle's
    // own travel is the whole of its resolution.
    const game = started();
    const state = createBotState();
    const rng = new Rng(3);
    let pressedAt = -1;
    for (let i = 0; i < 600 && pressedAt < 0; i += 1) {
      const before = game.sweep;
      if (botPress(game, 'p1', 'hard', state, rng)) pressedAt = before;
      step(game, STEP, null);
    }
    expect(pressedAt).toBeGreaterThanOrEqual(0);
    expect(pressedAt).toBeLessThanOrEqual(1);
  });

  it('is balanced against itself', () => {
    for (const tier of TIERS) {
      let p1 = 0;
      let decided = 0;
      for (let seed = 0; seed < 240; seed += 1) {
        const game = playOut(tier, tier, seed * 101 + 7);
        const winner = winnerOf(game);
        if (winner === 'draw') continue;
        decided += 1;
        if (winner === 'p1') p1 += 1;
      }
      const share = p1 / decided;
      expect(share, `${tier} gave seat one ${(share * 100).toFixed(0)}%`).toBeGreaterThan(0.4);
      expect(share, `${tier} gave seat one ${(share * 100).toFixed(0)}%`).toBeLessThan(0.6);
    }
  });

  it('beats a weaker tier from either seat', () => {
    const share = (strong: BotDifficulty, weak: BotDifficulty, swap: boolean): number => {
      let wins = 0;
      let decided = 0;
      for (let seed = 0; seed < 80; seed += 1) {
        const game = swap ? playOut(weak, strong, seed) : playOut(strong, weak, seed);
        const winner = winnerOf(game);
        if (winner === 'draw') continue;
        decided += 1;
        if (winner === (swap ? 'p2' : 'p1')) wins += 1;
      }
      return wins / decided;
    };
    for (const [strong, weak] of [
      ['hard', 'normal'],
      ['normal', 'easy'],
      ['hard', 'easy'],
    ] as const) {
      for (const swap of [false, true]) {
        expect(
          share(strong, weak, swap),
          `${strong} over ${weak}, swapped ${swap}`,
        ).toBeGreaterThan(0.6);
      }
    }
  });

  it('does not always draw when the two tiers are identical', () => {
    // Same rack, same needles, same start, and no interaction at all — without a wander the
    // two seats would play the identical match every time and every match would be level.
    let drawn = 0;
    for (let seed = 0; seed < 60; seed += 1) {
      if (winnerOf(playOut('hard', 'hard', seed)) === 'draw') drawn += 1;
    }
    expect(drawn).toBeLessThan(40);
  });

  it('aims closer to the middle of the gap as the tier goes up', () => {
    expect(BOT_PROFILES.hard.aim).toBeLessThan(BOT_PROFILES.normal.aim);
    expect(BOT_PROFILES.normal.aim).toBeLessThan(BOT_PROFILES.easy.aim);
    expect(BOT_PROFILES.hard.power).toBeLessThan(BOT_PROFILES.normal.power);
    expect(BOT_PROFILES.normal.power).toBeLessThan(BOT_PROFILES.easy.power);
    expect(BOT_PROFILES.easy.reads).toBeLessThan(BOT_PROFILES.hard.reads);
  });

  it('has an aim wander wide enough to cost it something', () => {
    // A wander narrower than the target it has to hit is not a difficulty axis, it is a
    // number that reads like one. The gap leaves a puck ten units of clearance and the
    // nearest rack puck is 130 back, so anything under about 0.077 rad always goes through.
    const clearance = GAP_HALF_WIDTH - PUCK_RADIUS;
    const free = Math.atan2(clearance, 130);
    expect(BOT_PROFILES.hard.aim).toBeGreaterThan(free * 0.4);
    expect(BOT_PROFILES.easy.aim).toBeGreaterThan(free);
  });

  it('puts more through a shot as the tier goes up', () => {
    const rate = (tier: BotDifficulty): number => {
      let through = 0;
      for (let seed = 0; seed < 60; seed += 1) {
        const game = playOut(tier, tier, seed * 31 + 3);
        through += game.p1Through + game.p2Through;
      }
      return through / (60 * SHOTS_PER_SEAT * 2);
    };
    const easy = rate('easy');
    const normal = rate('normal');
    const hard = rate('hard');
    expect(normal, `easy ${easy.toFixed(2)} normal ${normal.toFixed(2)}`).toBeGreaterThan(easy);
    expect(hard, `normal ${normal.toFixed(2)} hard ${hard.toFixed(2)}`).toBeGreaterThan(normal);
  });
});
