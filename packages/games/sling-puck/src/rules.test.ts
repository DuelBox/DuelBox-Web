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
  REST_SPEED,
  SHOTS_PER_SEAT,
  SLIDE_RATE,
  acrossOf,
  angleOf,
  botPress,
  createBotState,
  createGame,
  forwardOf,
  onSideOf,
  otherOf,
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

  /** One puck sliding straight along the board, with everything else racked out of the way. */
  function lone(speed: number): Game {
    const game = createGame();
    for (let i = 1; i < game.pucks.length; i += 1) {
      const other = game.pucks[i];
      if (other !== undefined) other.through = true;
    }
    const puck = game.pucks[0];
    if (puck === undefined) throw new Error('no fixture');
    // Across the board rather than up it: p1's own half, well clear of the middle wall, so
    // what is measured is the slide and not a bounce or a crossing.
    puck.x = 60;
    puck.y = 300;
    puck.vx = speed;
    puck.vy = 0;
    game.phase = 'sliding';
    return game;
  }

  it('slides the same distance whatever the step size', () => {
    // Rule 8: one match, stepped identically on every device. The retention is a
    // per-second power and was always exact; the *travel* was `v · dt`, a rectangle rule
    // under a falling curve, which runs long by `dt · SLIDE_RATE / 2` — 0.59% a frame here,
    // held down that far only by the four substeps. Integrated as
    // `(v_before - v_after) / SLIDE_RATE` the terms telescope and every rate agrees to
    // floating point.
    //
    // This game had no such test at all before, which is why the drift went unrecorded
    // while Bowling's, Pool's and Mini Soccer's were merely tolerated.
    const restingX = (dt: number): number => {
      const game = lone(900);
      const puck = game.pucks[0];
      if (puck === undefined) throw new Error('no fixture');
      for (let i = 0; i < Math.round(20 / dt); i += 1) {
        step(game, dt, null);
        if (game.phase !== 'sliding') break;
      }
      return puck.x;
    };
    const reference = restingX(1 / 60);
    for (const hz of [90, 120, 240]) {
      expect(restingX(1 / hz), `${hz} Hz agrees with 60 Hz`).toBeCloseTo(reference, 9);
    }
  });

  it('slides exactly the distance the closed-form law predicts', () => {
    // The defect issue #2465 is about. `sweepForPower` is the one bot in the four games the
    // issue names that touches the decay constant at all — but it asks for
    // `sqrt(2 · run · SLIDE_RATE · meanPower)`, a constant-deceleration shape, not this
    // model's inverse, and it is 6–45% away from the exact law across the range it is
    // actually used over. So the 0.59% was never what was making it miss. The law is worth
    // being true regardless, and this is what holds it.
    //
    // It also pins the substep count out of the distance law. `SUBSTEPS` is there to stop
    // two pucks passing through one another, not to set how far one travels — but with the
    // travel as `v · dt` it did both, and the 0.59% above is the 2.3% a single pass would
    // have carried, divided by four. Since this asserts the closed form rather than one
    // measured number, changing `SUBSTEPS` cannot move it.
    for (const speed of [400, 600, 800, 1010]) {
      const game = lone(speed);
      const puck = game.pucks[0];
      if (puck === undefined) throw new Error('no fixture');
      const start = puck.x;
      for (let i = 0; i < 60 * 20; i += 1) {
        step(game, STEP, null);
        if (puck.vx === 0 && puck.vy === 0) break;
      }
      expect(puck.x - start, `a puck at ${speed} runs (v - REST_SPEED) / SLIDE_RATE`).toBeCloseTo(
        (speed - REST_SPEED) / SLIDE_RATE,
        9,
      );
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

/* ------------------------------------------------------------------ the half turn */

/**
 * The half turn, and why it is the only seat swap this game may be checked against.
 *
 * Written before the fix it gates. Sling Puck measured **34.1% for seat one** on the
 * balance harness (#2502) under either opening seat, and its own
 * `'is balanced against itself'` test above passed the whole time — because that test opens
 * every match with `p1` and asks only that the two totals come out level on average, which
 * an asymmetry sitting in the *board* rather than in the *order* sails straight through.
 *
 * The board is one coordinate system, not two. Swapping the seats means turning the device
 * half a turn: `x -> 640 - x`, `y -> 1000 - y`, every velocity negated. It is **not** a
 * reflection in the wall, and the difference is the whole finding. `angleOf` is covariant
 * under the half turn and only under the half turn — `angleOf('p2', s)` is exactly
 * `angleOf('p1', s) + pi`, for the same `s` — so every rule in this file has to be, and two
 * were not:
 *
 * 1. **`pickLoaded` broke its tie in board coordinates.** The rack is four rows of two, so
 *    every shot at an untouched rack is a tie between two pucks equally near the gap, and
 *    the tie went to whichever came first in `game.pucks` — the smaller `x`. Both seats
 *    therefore slung from `x = 260`, where the half turn sends `x = 260` to `x = 380`. The
 *    two seats were shooting mirror-image lanes into a rotationally-symmetric needle, and
 *    the needle's own quantisation — it sweeps up from zero and is stopped at or just short
 *    of the value wanted — then leaned towards the middle of the gap for one seat and away
 *    from it for the other, against a top-band window 3.3 units wide.
 * 2. **`sweepForAngle` folded an absolute angle back to the seat's base direction.** The far
 *    seat's `Math.atan2` arguments are the near seat's negated, and `Math.atan2(-a, -b)` is
 *    not the double `Math.atan2(a, b) - Math.PI` — the two seats' targets came out a couple
 *    of ULPs apart on mirror-image boards. Both seats now hand `atan2` the identical pair.
 *
 * `park` walked its slots in board `x` for the same reason and is fixed the same way, though
 * nothing had yet been measured on it.
 *
 * What the last two tests below assert is stronger than any win rate: a match opened by `p2`
 * *is* the match opened by `p1`, turned half a turn. Every discrete decision — who is
 * active, which puck is loaded, which frame the needle is stopped on, whether a crossing was
 * clean, what it scored — has to agree, and the positions have to agree to floating point.
 * Seat one's share is then 50% by construction at any sample size.
 */

/** Board coordinates, turned half a turn. */
function mirrorX(x: number): number {
  return BOARD_WIDTH - x;
}
function mirrorY(y: number): number {
  return BOARD_HEIGHT - y;
}

/**
 * A puck's index under the half turn.
 *
 * The rack is built seat by seat, and inside a seat row by row, two pucks a row at `-across`
 * then `+across`. The half turn flips `x` as well as `y`, so it swaps the seats *and* swaps
 * the two pucks within each row: `0 <-> 9`, `1 <-> 8`, `2 <-> 11`, and so on. Getting this
 * wrong gives a mirror that is a reflection in the wall, which is exactly the symmetry this
 * game does not have.
 */
function mirrorIndex(index: number): number {
  return ((index + PUCKS_PER_SEAT) % (PUCKS_PER_SEAT * 2)) ^ 1;
}

/**
 * Every discrete decision a frame has made, as one string, read in the near seat's frame.
 *
 * `seatOf` and `indexOf` are the identity for the near match and the half turn for the far
 * one, so the two strings are directly comparable and any difference is a decision the two
 * seats did not share. Continuous state — positions, velocities, the aim angle — is checked
 * separately and with a tolerance, because `640 - x` is not lossless.
 *
 * `sweep` and `ready` are in here rather than in the tolerance bucket on purpose: both are
 * driven by the same fixed arithmetic on both sides, so they must be bit-identical, and the
 * frame the needle is stopped on depends on `sweep` exactly.
 */
function decisionsOf(
  game: Game,
  seatOf: (seat: SeatId) => SeatId,
  indexOf: (index: number) => number,
): string {
  const parts = [
    `active=${seatOf(game.active)}`,
    `lead=${seatOf(game.lead)}`,
    `phase=${game.phase}`,
    `sweep=${game.sweep.toString()}${game.sweepUp ? 'u' : 'd'}`,
    `ready=${game.ready.toString()}`,
    `shots=${String(seatOf('p1') === 'p1' ? game.p1Shots : game.p2Shots)}/${String(
      seatOf('p1') === 'p1' ? game.p2Shots : game.p1Shots,
    )}`,
    `loaded=${game.loaded < 0 ? '-1' : String(indexOf(game.loaded))}`,
  ];
  for (let i = 0; i < game.pucks.length; i += 1) {
    const puck = game.pucks[indexOf(i)] as Game['pucks'][number];
    parts.push(`${String(i)}:${puck.through ? 'T' : 'f'}${puck.clean ? 'C' : 'r'}`);
  }
  return parts.join(' ');
}

const SAME = (seat: SeatId): SeatId => seat;
const SAME_INDEX = (index: number): number => index;

describe('the half turn', () => {
  it('measures across in the shooter’s own frame', () => {
    // The same board point is the same distance to the shooter's right for one seat as it is
    // to the other's, once the board has been turned round.
    for (const x of [0, 26, 200, 320, 380, 614, 640]) {
      expect(acrossOf('p2', mirrorX(x)), `x=${String(x)}`).toBe(acrossOf('p1', x));
    }
    // And never `-0`, from either seat, on the one x that could produce it. `-0` is what
    // `Math.atan2` carries into a different answer for the two seats.
    expect(Object.is(acrossOf('p1', BOARD_WIDTH / 2), 0)).toBe(true);
    expect(Object.is(acrossOf('p2', BOARD_WIDTH / 2), 0)).toBe(true);
  });

  it('maps the rack onto itself, puck for puck', () => {
    const game = started();
    for (let i = 0; i < game.pucks.length; i += 1) {
      const puck = game.pucks[i] as Game['pucks'][number];
      const twin = game.pucks[mirrorIndex(i)] as Game['pucks'][number];
      expect(mirrorIndex(mirrorIndex(i)), 'the half turn is its own inverse').toBe(i);
      expect(twin.owner, `puck ${String(i)}`).toBe(otherOf(puck.owner));
      expect(twin.x, `puck ${String(i)} x`).toBeCloseTo(mirrorX(puck.x), 9);
      expect(twin.y, `puck ${String(i)} y`).toBeCloseTo(mirrorY(puck.y), 9);
    }
  });

  it('loads the mirrored puck, not the one with the same board x', () => {
    // The failing case in one line. Both seats have two pucks 130 back; the half turn sends
    // p1's left one to p2's *right* one, and a tie broken on the raw index sent it to p2's
    // left one instead.
    const game = started();
    const mine = pickLoaded(game, 'p1');
    const theirs = pickLoaded(game, 'p2');
    expect(theirs).toBe(mirrorIndex(mine));
    const a = game.pucks[mine] as Game['pucks'][number];
    const b = game.pucks[theirs] as Game['pucks'][number];
    expect(b.x).toBeCloseTo(mirrorX(a.x), 9);
    expect(acrossOf('p2', b.x), 'the same lane in each seat’s own frame').toBeCloseTo(
      acrossOf('p1', a.x),
      9,
    );
  });

  it.each(TIERS)('aims a %s bot at bit-identical targets from the two seats', (tier) => {
    // `sweepForAngle` is not exported, so this reads its answer where it lands: `BotState.want`
    // is the sweep value the bot is waiting for, and it is that value exactly.
    //
    // The rack is fixed by the half turn, so puck `i` for seat one and puck `mirrorIndex(i)`
    // for seat two are the same shot seen from the two chairs and must want the same number.
    // Written as an absolute angle folded back to the seat's base direction they did not:
    // the far seat's `Math.atan2` arguments are the near seat's negated, and
    // `Math.atan2(-a, -b)` is not the double `Math.atan2(a, b) - Math.PI`. `Object.is`, not
    // `toBeCloseTo` — the whole finding is in the last two bits, and the needle is stopped by
    // a strict comparison that can tell them apart.
    for (const phase of ['aim', 'power'] as const) {
      for (let i = 0; i < PUCKS_PER_SEAT; i += 1) {
        const game = started();
        game.phase = phase;
        game.ready = 0;
        game.sweep = 0.5;

        game.active = 'p1';
        game.loaded = i;
        const mine = createBotState();
        botPress(game, 'p1', tier, mine, new Rng(4242));

        game.active = 'p2';
        game.loaded = mirrorIndex(i);
        const theirs = createBotState();
        botPress(game, 'p2', tier, theirs, new Rng(4242));

        expect(
          Object.is(mine.want, theirs.want),
          `${phase} puck ${String(i)}: seat one wants ${String(mine.want)} and seat two ` +
            `wants ${String(theirs.want)} for the same shot`,
        ).toBe(true);
      }
    }
  });

  it.each(TIERS)(
    'plays a %s match opened by p2 as the same match opened by p1, turned half a turn',
    (tier) => {
      // The whole argument, run frame by frame. Two matches from the same seed: one opened
      // by p1, one opened by p2, with the two bot streams handed out by *opener* exactly as
      // `game.ts` does it. If the game is covariant the second is the first turned round,
      // and every discrete decision in it has to agree with the first's.
      for (let seed = 0; seed < 6; seed += 1) {
        const near = createGame();
        resetGame(near, 'p1');
        const far = createGame();
        resetGame(far, 'p2');
        const nearState = { p1: createBotState(), p2: createBotState() };
        const farState = { p1: createBotState(), p2: createBotState() };
        const nearRng: Record<SeatId, Rng> = {
          p1: new Rng(seed * 101 + 7),
          p2: new Rng(seed * 101 + 8),
        };
        // The seat that opens `far` is the seat that opens `near`, in the other chair.
        const farRng: Record<SeatId, Rng> = {
          p2: new Rng(seed * 101 + 7),
          p1: new Rng(seed * 101 + 8),
        };

        let frames = 0;
        let drift = 0;
        while ((near.phase !== 'over' || far.phase !== 'over') && frames < 60 * 900) {
          frames += 1;
          const here = near.active;
          const there = far.active;
          expect(there, `seed ${String(seed)} frame ${String(frames)}`).toBe(otherOf(here));
          const pressedHere = botPress(near, here, tier, nearState[here], nearRng[here]);
          const pressedThere = botPress(far, there, tier, farState[there], farRng[there]);
          expect(
            pressedThere,
            `seed ${String(seed)} frame ${String(frames)}: the needle was stopped on a ` +
              `different frame in the mirrored match`,
          ).toBe(pressedHere);
          step(near, STEP, pressedHere ? here : null);
          step(far, STEP, pressedThere ? there : null);

          expect(
            decisionsOf(far, otherOf, mirrorIndex),
            `seed ${String(seed)} frame ${String(frames)}`,
          ).toBe(decisionsOf(near, SAME, SAME_INDEX));

          for (let i = 0; i < near.pucks.length; i += 1) {
            const a = near.pucks[i] as Game['pucks'][number];
            const b = far.pucks[mirrorIndex(i)] as Game['pucks'][number];
            drift = Math.max(drift, Math.abs(mirrorX(a.x) - b.x), Math.abs(mirrorY(a.y) - b.y));
          }
        }
        // Board units, on a 640x1000 board: the mirror is exact to a hundred-millionth of a
        // unit. It is not bit-exact and cannot be — `640 - x` is not a lossless operation —
        // which is precisely why every *discrete* decision above is asserted exactly and
        // only the continuous state is given a tolerance.
        expect(drift, `seed ${String(seed)} drifted`).toBeLessThan(1e-6);
        expect(far.p1Through, `seed ${String(seed)}`).toBe(near.p2Through);
        expect(far.p2Through, `seed ${String(seed)}`).toBe(near.p1Through);
        const won = winnerOf(near);
        expect(winnerOf(far), `seed ${String(seed)}`).toBe(
          won === 'draw' ? 'draw' : otherOf(won as SeatId),
        );
      }
    },
  );

  it.each(TIERS)('gives seat one exactly half of the decided %s matches', (tier) => {
    // The consequence, stated as the number the balance harness reports. Because a seed's
    // two rounds are the same match seen from the two chairs, a decided seed contributes one
    // win to each seat and this is 50% at any sample size — a proof rather than a
    // measurement. It was 34.1%.
    let seatOne = 0;
    let decided = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      for (const opener of ['p1', 'p2'] as SeatId[]) {
        const game = createGame();
        resetGame(game, opener);
        const state = { p1: createBotState(), p2: createBotState() };
        const first = new Rng(seed * 977 + 11);
        const second = new Rng(seed * 977 + 12);
        const rng: Record<SeatId, Rng> =
          opener === 'p1' ? { p1: first, p2: second } : { p1: second, p2: first };
        while (game.phase !== 'over') {
          const seat = game.active;
          const pressed = botPress(game, seat, tier, state[seat], rng[seat]);
          step(game, STEP, pressed ? seat : null);
        }
        const winner = winnerOf(game);
        if (winner === 'draw') continue;
        decided += 1;
        if (winner === 'p1') seatOne += 1;
      }
    }
    expect(decided, `${tier} decided nothing`).toBeGreaterThan(0);
    expect(
      seatOne / decided,
      `${tier} gave seat one ${String(seatOne)} of ${String(decided)}`,
    ).toBe(0.5);
  });
});
