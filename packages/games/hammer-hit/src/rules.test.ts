import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BANDS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOT_DRAWS_PER_SWING,
  BOT_PROFILES,
  CENTRE_X,
  CENTRE_Y,
  FLIP_SECONDS,
  FULL_CLIMB,
  GAMBLE_DEFICIT,
  MAX_ROUNDS,
  MAX_WINDS,
  MIN_ROUNDS,
  READY_SECONDS,
  SETTLE_SECONDS,
  SWEEP,
  TOWER_LENGTH,
  WIND_FACTORS,
  bandsFor,
  baseXOf,
  baseYOf,
  botPresses,
  chooseWind,
  climbFor,
  createBotState,
  createGame,
  expectedError,
  leaderOf,
  needleRate,
  otherOf,
  planSwing,
  powerAt,
  press,
  resetGame,
  scoreOf,
  seatSign,
  step,
  towerFootYOf,
  towerTopYOf,
  windFactor,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;

function started(): Game {
  const game = createGame();
  resetGame(game);
  return game;
}

/** Step until `done`, or give up. */
function until(game: Game, done: () => boolean, limit = 6000): number {
  let steps = 0;
  for (; steps < limit && !done(); steps += 1) step(game, STEP);
  return steps;
}

/** Let the ready pause run out, so the needle is live. */
function toLive(game: Game): void {
  until(game, () => game.phase !== 'ready');
}

/** Swing the active seat's hammer at a chosen needle angle, and watch the puck land. */
function swing(game: Game, needle: number, wind = 0): void {
  toLive(game);
  game.wind = wind;
  game.needle = needle;
  press(game, game.active);
  until(game, () => game.phase === 'settling' || game.phase === 'over');
}

describe('the board', () => {
  it('is its own mirror through its centre', () => {
    // The board makes a half-turn when the turn changes. Every position is `centre ±
    // offset`, so p1's striker lands exactly on p2's and the flip moves nothing at all.
    expect(baseXOf('p1') + baseXOf('p2')).toBe(BOARD_WIDTH);
    expect(baseYOf('p1') + baseYOf('p2')).toBe(BOARD_HEIGHT);
    expect(towerFootYOf('p1') + towerFootYOf('p2')).toBe(BOARD_HEIGHT);
    expect(towerTopYOf('p1') + towerTopYOf('p2')).toBe(BOARD_HEIGHT);
    expect(seatSign('p1')).toBe(-seatSign('p2'));
  });

  it('gives each seat a tower of the same length, climbing away from its own end', () => {
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const base = baseYOf(seat);
      const foot = towerFootYOf(seat);
      const top = towerTopYOf(seat);
      expect(Math.abs(top - foot)).toBeCloseTo(TOWER_LENGTH, 6);
      // The puck climbs away from the player who struck it, across the middle of the board
      // and towards the far end, which is "up" for whoever the board has turned to face.
      expect(Math.abs(top - base)).toBeGreaterThan(Math.abs(foot - base));
      expect((top - CENTRE_Y) * (base - CENTRE_Y)).toBeLessThan(0);
      // The two towers stand side by side rather than on one line, so neither is drawn on
      // top of the other once the board has turned.
      expect(Math.abs(baseXOf(seat) - CENTRE_X)).toBeGreaterThan(0);
      expect(Math.min(foot, top)).toBeGreaterThan(0);
      expect(Math.max(foot, top)).toBeLessThan(BOARD_HEIGHT);
    }
  });

  it('starts level, with p1 to swing', () => {
    const game = started();
    expect(game.p1Score).toBe(0);
    expect(game.p2Score).toBe(0);
    expect(game.active).toBe('p1');
    expect(game.phase).toBe('ready');
    expect(winnerOf(game)).toBeNull();
  });
});

describe('the ready pause', () => {
  it('outlasts the half-turn the board makes', () => {
    // Not a nicety. The shell refuses a person's press for the whole of the flip; if the
    // wind-up were running through it, a bot would be pressing in a window nobody else
    // could reach. Rule 6, held by a number rather than by good intentions.
    expect(READY_SECONDS).toBeGreaterThan(FLIP_SECONDS);
  });

  it('holds the needle completely still, and refuses every press', () => {
    const game = started();
    const start = game.needle;
    for (let i = 0; i < Math.round(FLIP_SECONDS * 60); i += 1) {
      expect(press(game, 'p1'), 'a press landed during the ready pause').toBe(false);
      step(game, STEP);
      expect(game.needle).toBe(start);
      expect(game.wind).toBe(0);
    }
    expect(game.phase).toBe('ready');
  });

  it('lets go of the needle once it has run out', () => {
    const game = started();
    const steps = until(game, () => game.phase !== 'ready');
    expect(steps * STEP).toBeCloseTo(READY_SECONDS, 1);
    step(game, STEP);
    expect(game.needle).toBeGreaterThan(-SWEEP);
  });
});

describe('the needle', () => {
  it('sweeps between its limits and turns round', () => {
    const game = started();
    toLive(game);
    let low = game.needle;
    let high = game.needle;
    for (let i = 0; i < 40; i += 1) {
      step(game, STEP);
      low = Math.min(low, game.needle);
      high = Math.max(high, game.needle);
    }
    expect(high).toBeGreaterThan(0);
    expect(low).toBeCloseTo(-SWEEP, 2);
    expect(high).toBeLessThanOrEqual(SWEEP + 1e-9);
  });

  it('winds a notch every time it turns round, and comes back faster', () => {
    const game = started();
    toLive(game);
    const seen: number[] = [];
    let previous = game.wind;
    for (let i = 0; i < 6000 && game.phase === 'winding'; i += 1) {
      step(game, STEP);
      if (game.wind !== previous) {
        seen.push(game.wind);
        previous = game.wind;
      }
    }
    expect(seen).toEqual([1, 2, 3, 4, MAX_WINDS]);
    for (let wind = 1; wind < MAX_WINDS; wind += 1) {
      expect(needleRate(wind)).toBeGreaterThan(needleRate(wind - 1));
    }
  });

  it('offers exactly one crossing of the mark per notch', () => {
    // The whole decision is *this* crossing or the next one, which only means anything if
    // each notch is worth exactly one chance.
    const game = started();
    toLive(game);
    const crossings = new Map<number, number>();
    let previous = game.needle;
    for (let i = 0; i < 6000 && game.phase === 'winding'; i += 1) {
      const wind = game.wind;
      step(game, STEP);
      if (previous < 0 !== game.needle < 0) crossings.set(wind, (crossings.get(wind) ?? 0) + 1);
      previous = game.needle;
    }
    for (let wind = 0; wind < MAX_WINDS; wind += 1) {
      expect(crossings.get(wind), `notch ${String(wind)}`).toBe(1);
    }
  });

  it('ignores a press from the seat that is not swinging', () => {
    const game = started();
    toLive(game);
    expect(press(game, 'p2')).toBe(false);
    expect(game.phase).toBe('winding');
    expect(press(game, 'p1')).toBe(true);
  });

  it('ignores a press once the puck is in the air', () => {
    const game = started();
    toLive(game);
    game.needle = 0;
    press(game, 'p1');
    expect(game.phase).toBe('striking');
    expect(press(game, 'p1')).toBe(false);
  });
});

describe('a hit', () => {
  it('is hardest at the mark and softest at the edges', () => {
    expect(powerAt(0)).toBe(1);
    expect(powerAt(SWEEP)).toBe(0);
    expect(powerAt(-SWEEP)).toBe(0);
    let previous = Infinity;
    for (let i = 0; i <= 20; i += 1) {
      const power = powerAt((i / 20) * SWEEP);
      expect(power).toBeLessThan(previous);
      previous = power;
    }
  });

  it('puts the puck up the tower from most of the dial, at every notch', () => {
    // Cannon Duel's first power range could not reach the target from two thirds of its
    // span — a gauge that is mostly a losing move is not a decision. Here the softest
    // four fifths of the sweep still score, and the share only grows as the hammer winds.
    let previous = 0;
    for (let wind = 0; wind < MAX_WINDS; wind += 1) {
      let live = 0;
      const samples = 400;
      for (let i = 0; i < samples; i += 1) {
        const angle = -SWEEP + (i / (samples - 1)) * SWEEP * 2;
        if (bandsFor(powerAt(angle), wind) >= 1) live += 1;
      }
      const share = live / samples;
      expect(
        share,
        `notch ${String(wind)} scores from only ${(100 * share).toFixed(0)}%`,
      ).toBeGreaterThan(0.8);
      expect(share).toBeGreaterThan(previous);
      previous = share;
    }
  });

  it('reaches the bell from the last notch and from no other', () => {
    // The top of the wind-up has to be worth choosing for something, or it is a rung
    // nobody would ever stand on.
    for (let wind = 0; wind < MAX_WINDS - 1; wind += 1) {
      expect(bandsFor(1, wind), `notch ${String(wind)} rang the bell`).toBeLessThan(BANDS);
      expect(windFactor(wind)).toBeLessThan(FULL_CLIMB);
    }
    expect(bandsFor(1, MAX_WINDS - 1)).toBe(BANDS);
    expect(windFactor(MAX_WINDS - 1)).toBeGreaterThan(FULL_CLIMB);
  });

  it('scores more from a later notch, for the same needle angle', () => {
    for (let wind = 1; wind < MAX_WINDS; wind += 1) {
      expect(WIND_FACTORS[wind]!).toBeGreaterThan(WIND_FACTORS[wind - 1]!);
      expect(climbFor(0.6, wind)).toBeGreaterThan(climbFor(0.6, wind - 1));
    }
  });

  it('sends the puck exactly as far up the tower as the strike decided', () => {
    // The score is settled at the moment of the strike, never by where a stepped flight
    // happened to stop: a climb that ended a unit short must not cost a band.
    const game = started();
    swing(game, 0.2, 2);
    const expected = climbFor(powerAt(0.2), 2) * TOWER_LENGTH;
    expect(game.puckTarget).toBeCloseTo(expected, 6);
    expect(game.puck).toBeCloseTo(expected, 6);
    expect(game.p1Score).toBe(bandsFor(powerAt(0.2), 2));
  });
});

describe('the wind-up running out', () => {
  it('is a slip: the swing is spent and scores nothing', () => {
    const game = started();
    toLive(game);
    const steps = until(game, () => game.phase !== 'winding');
    expect(steps).toBeLessThan(6000);
    expect(game.lastSlipped).toBe(true);
    expect(game.lastBands).toBe(0);
    expect(game.p1Score).toBe(0);
    expect(game.p1Swings).toBe(1);
  });

  it('still completes the round, so a player who never presses cannot stall the match', () => {
    const game = started();
    until(game, () => game.rounds === 2, 20000);
    expect(game.rounds).toBe(2);
    expect(game.p1Swings).toBe(1);
    expect(game.p2Swings).toBe(1);
    expect(game.p1Score).toBe(0);
    expect(game.p2Score).toBe(0);
  });
});

describe('turns', () => {
  it('pass once the swing has been shown', () => {
    const game = started();
    swing(game, 0);
    expect(game.phase).toBe('settling');
    const steps = until(game, () => game.active === 'p2');
    expect(steps * STEP).toBeCloseTo(SETTLE_SECONDS, 1);
    expect(game.phase).toBe('ready');
  });

  it('alternate, so neither seat swings twice inside a round', () => {
    const game = started();
    for (let round = 0; round < 3; round += 1) {
      const first = game.active;
      swing(game, 0.1);
      until(game, () => game.phase === 'ready' || game.phase === 'over');
      expect(game.active).toBe(otherOf(first));
      swing(game, 0.1);
      until(game, () => game.phase === 'ready' || game.phase === 'over');
      expect(game.p1Swings).toBe(game.p2Swings);
    }
  });

  it('hand the first swing of a round to the other seat each time', () => {
    // Whoever swings second has seen what they have to beat, and in a game whose only
    // decision is how far to push a gamble that is worth something. Alternating hands each
    // seat the informed swing exactly as often.
    expect(leaderOf(1)).toBe('p1');
    expect(leaderOf(2)).toBe('p2');
    expect(leaderOf(3)).toBe('p1');
    expect(MIN_ROUNDS % 2).toBe(0);
    expect(MAX_ROUNDS % 2).toBe(0);

    const game = started();
    const leaders: SeatId[] = [];
    for (let round = 0; round < 4 && game.phase !== 'over'; round += 1) {
      leaders.push(game.active);
      swing(game, 0.1);
      until(game, () => game.phase === 'ready' || game.phase === 'over');
      swing(game, 0.1);
      until(game, () => game.phase === 'ready' || game.phase === 'over');
    }
    expect(leaders).toEqual(['p1', 'p2', 'p1', 'p2']);
  });
});

describe('the match ending', () => {
  it('waits for the round to finish before it is won', () => {
    // Ending the instant somebody led would hand the match to whoever swung first whenever
    // both players were good — the trap Knife Thrower fell into.
    const game = started();
    game.rounds = MIN_ROUNDS;
    game.p1Score = 20;
    game.p2Score = 20;
    swing(game, 0);
    until(game, () => game.phase === 'ready' || game.phase === 'over');
    expect(scoreOf(game, 'p1')).toBeGreaterThan(20);
    // p2 has a swing in hand, so it is not over however far ahead p1 now is.
    expect(game.phase).toBe('ready');
    expect(game.active).toBe('p2');

    swing(game, SWEEP);
    until(game, () => game.phase === 'over' || game.phase === 'ready');
    expect(winnerOf(game)).toBe('p1');
  });

  it('plays on while the two are level at the minimum', () => {
    const game = started();
    game.rounds = MIN_ROUNDS;
    game.p1Score = 20;
    game.p2Score = 20;
    // Both strike identically, so the totals stay level and the match cannot be called.
    swing(game, 0.3);
    until(game, () => game.phase === 'ready' || game.phase === 'over');
    swing(game, 0.3);
    until(game, () => game.phase === 'ready' || game.phase === 'over');
    expect(game.p1Score).toBe(game.p2Score);
    expect(game.phase).toBe('ready');
    expect(game.rounds).toBeGreaterThan(MIN_ROUNDS);
  });

  it('is never called before the minimum, however lopsided it is', () => {
    const game = started();
    for (let round = 0; round < MIN_ROUNDS - 1; round += 1) {
      swing(game, 0);
      until(game, () => game.phase === 'ready' || game.phase === 'over');
      swing(game, SWEEP);
      until(game, () => game.phase === 'ready' || game.phase === 'over');
    }
    expect(game.p1Score).toBeGreaterThan(game.p2Score);
    expect(winnerOf(game)).toBeNull();
  });

  it('always ends, even between two players who never press a thing', () => {
    // Structural: eight rounds, and nothing about how it is played can add one. No clock
    // is involved, and a match of nothing but slips still finishes.
    const game = started();
    const steps = until(game, () => game.phase === 'over', 60 * 600);
    expect(game.phase).toBe('over');
    expect(steps).toBeLessThan(60 * 600);
    expect(winnerOf(game)).toBe('draw');
    expect(game.rounds).toBeLessThanOrEqual(MAX_ROUNDS + 1);
    expect(game.p1Swings).toBe(game.p2Swings);
  });

  it('stops simulating once it is decided', () => {
    const game = started();
    game.phase = 'over';
    game.winner = 'p1';
    const needle = game.needle;
    step(game, STEP);
    expect(game.needle).toBe(needle);
  });
});

describe('the ladder', () => {
  it('drops a notch at a time as the hand gets shakier, and uses every one of them', () => {
    // Trap six, answered with a measurement: a dial that is mostly a losing move is not a
    // decision. Each of the five notches is the best answer over its own band of accuracy.
    const seen = new Set<number>();
    let previous = MAX_WINDS;
    for (let error = 0; error < 0.5; error += 0.002) {
      const notch = chooseWind(error, 0);
      expect(notch, `notch rose again at ${error.toFixed(3)}s`).toBeLessThanOrEqual(previous);
      previous = notch;
      seen.add(notch);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('sends a player far enough behind to the top notch whatever their hand', () => {
    // The last notch is the only one that can reach the bell and much the widest in what
    // it might return, so it is where somebody who cannot win on averages belongs.
    expect(chooseWind(0.3, GAMBLE_DEFICIT)).toBe(MAX_WINDS - 1);
    expect(chooseWind(0.3, GAMBLE_DEFICIT - 1)).toBeLessThan(MAX_WINDS - 1);
  });

  it('picks a different notch for each tier, from what that tier knows about itself', () => {
    const notches = (['easy', 'normal', 'hard'] as BotDifficulty[]).map((tier) =>
      chooseWind(expectedError(BOT_PROFILES[tier]), 0),
    );
    expect(new Set(notches).size, `tiers all chose ${notches.join(', ')}`).toBe(3);
    expect(notches[0]!).toBeLessThan(notches[1]!);
    expect(notches[1]!).toBeLessThan(notches[2]!);
  });
});

describe('the bot', () => {
  const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('draws the same number of values for every swing', () => {
    // Both bots share one Rng: a seat whose draw count depends on what it chose shifts the
    // other seat's stream, which is a seat bias made of arithmetic. Fruit Duel was caught
    // by exactly that, so `chooseWind` draws nothing at all.
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 25; seed += 1) {
        const game = started();
        game.p1Score = seed;
        game.p2Score = seed * 2;
        const counter = new Rng(seed);
        let draws = 0;
        const counted = {
          float: () => {
            draws += 1;
            return counter.float();
          },
        } as unknown as Rng;
        planSwing(game, 'p1', tier, createBotState(), counted);
        expect(draws, `${tier} seed ${String(seed)}`).toBe(BOT_DRAWS_PER_SWING);
      }
    }
  });

  it('only ever asks for a notch that exists', () => {
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const game = started();
        const rng = new Rng(seed);
        const state = createBotState();
        planSwing(game, 'p1', tier, state, rng);
        expect(state.wantWind).toBeGreaterThanOrEqual(0);
        expect(state.wantWind).toBeLessThan(MAX_WINDS);
      }
    }
  });

  it('always presses on the notch it chose, even when it blunders', () => {
    // Without clamping the wanted angle into the sweep, a bad enough error would name an
    // angle the needle never reaches: the bot would sail past its notch in silence and the
    // difference between a bad swing and no swing at all would be an accident of
    // arithmetic. This is what proves the clamp is doing its job.
    for (const tier of TIERS) {
      let swings = 0;
      let wrongNotch = 0;
      let slips = 0;
      for (let seed = 1; seed <= 12; seed += 1) {
        const game = started();
        const rng = new Rng(seed);
        const state = createBotState();
        for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
          if (game.phase === 'winding' && !state.planned) {
            planSwing(game, game.active, tier, state, rng);
          }
          if (game.phase === 'winding' && botPresses(game, state, STEP)) {
            if (game.wind !== state.wantWind) wrongNotch += 1;
            press(game, game.active);
            swings += 1;
          } else if (game.phase !== 'winding' && game.phase !== 'ready') {
            state.planned = false;
          }
          if (step(game, STEP).slipped) slips += 1;
        }
      }
      expect(swings, `${tier} barely swung`).toBeGreaterThan(50);
      expect(wrongNotch, `${tier} pressed on a notch it had not chosen`).toBe(0);
      expect(slips, `${tier} let a wind-up run out`).toBe(0);
    }
  });

  it('scores more per swing as the tier goes up', () => {
    const rates = TIERS.map((tier) => bandsPerSwing(tier));
    const [easy, normal, hard] = rates as [number, number, number];
    expect(normal, `easy ${easy.toFixed(2)} normal ${normal.toFixed(2)}`).toBeGreaterThan(easy);
    expect(hard, `normal ${normal.toFixed(2)} hard ${hard.toFixed(2)}`).toBeGreaterThan(normal);
  });

  it('is balanced against itself, over enough seeds to mean something', () => {
    // Eighty seeds was not enough for Match Rush — it reported 58% where four hundred gave
    // 53%. Four hundred here, and from both seats at once, because an equal pairing is
    // already its own mirror.
    for (const tier of TIERS) {
      const wins = playSeries(tier, tier, 400);
      const decided = wins.p1 + wins.p2;
      expect(decided, `${tier} decided almost nothing`).toBeGreaterThan(350);
      const share = wins.p1 / decided;
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeGreaterThan(
        0.4,
      );
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeLessThan(0.6);
    }
  });

  it('beats a weaker tier from either seat', () => {
    for (const [strong, weak] of [
      ['hard', 'easy'],
      ['normal', 'easy'],
      ['hard', 'normal'],
    ] as [BotDifficulty, BotDifficulty][]) {
      const asP1 = playSeries(strong, weak, 120);
      expect(asP1.p1, `${strong} as p1 v ${weak}`).toBeGreaterThan(asP1.p2 * 2);
      const asP2 = playSeries(weak, strong, 120);
      expect(asP2.p2, `${strong} as p2 v ${weak}`).toBeGreaterThan(asP2.p1 * 2);
    }
  });

  it('never presses more accurately than its own timing allows', () => {
    for (const tier of TIERS) {
      expect(BOT_PROFILES[tier].timing).toBeGreaterThan(0);
      expect(BOT_PROFILES[tier].blunder).toBeGreaterThan(0);
    }
    expect(BOT_PROFILES.hard.timing).toBeLessThan(BOT_PROFILES.normal.timing);
    expect(BOT_PROFILES.normal.timing).toBeLessThan(BOT_PROFILES.easy.timing);
    expect(expectedError(BOT_PROFILES.hard)).toBeLessThan(expectedError(BOT_PROFILES.normal));
    expect(expectedError(BOT_PROFILES.normal)).toBeLessThan(expectedError(BOT_PROFILES.easy));
  });
});

/** Mean bands a tier takes from a swing, played out through the real simulation. */
function bandsPerSwing(tier: BotDifficulty): number {
  let bands = 0;
  let swings = 0;
  for (let seed = 0; seed < 12; seed += 1) {
    const game = started();
    const rng = new Rng(2000 + seed);
    const state = createBotState();
    for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
      if (game.phase === 'winding' && !state.planned)
        planSwing(game, game.active, tier, state, rng);
      if (game.phase === 'winding' && botPresses(game, state, STEP)) {
        press(game, game.active);
        bands += game.lastBands;
        swings += 1;
      } else if (game.phase !== 'winding' && game.phase !== 'ready') {
        state.planned = false;
      }
      step(game, STEP);
    }
  }
  return bands / Math.max(1, swings);
}

function playSeries(
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  matches: number,
): { p1: number; p2: number; draw: number } {
  const wins = { p1: 0, p2: 0, draw: 0 };
  for (let match = 0; match < matches; match += 1) {
    const game = started();
    const rng = new Rng(4000 + match);
    const states = { p1: createBotState(), p2: createBotState() };
    const tiers: Record<SeatId, BotDifficulty> = { p1: p1Tier, p2: p2Tier };

    for (let i = 0; i < 60 * 600 && game.phase !== 'over'; i += 1) {
      const active = game.active;
      const state = states[active];
      if (game.phase === 'winding' && !state.planned) {
        planSwing(game, active, tiers[active], state, rng);
      }
      if (game.phase === 'winding') {
        if (botPresses(game, state, STEP)) press(game, active);
      } else if (game.phase !== 'ready') {
        state.planned = false;
      }
      step(game, STEP);
    }
    if (game.winner === 'p1') wins.p1 += 1;
    else if (game.winner === 'p2') wins.p2 += 1;
    else wins.draw += 1;
  }
  return wins;
}

describe('determinism', () => {
  it('needs no randomness at all to play a match', () => {
    // Nothing in the rules draws: the only source of chance in a match is a bot's own
    // hand. Two identical scripts therefore have to reach the identical state.
    const play = (): Game => {
      const game = createGame();
      resetGame(game);
      const script = new Rng(1234);
      for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
        if (script.float() < 0.02) press(game, game.active);
        step(game, STEP);
      }
      return game;
    };
    expect(play()).toEqual(play());
  });

  it('reaches a different match from a different script', () => {
    // The comparison above is only worth anything if this harness can tell two matches
    // apart at all.
    const play = (seed: number): number => {
      const game = createGame();
      resetGame(game);
      const script = new Rng(seed);
      for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
        if (script.float() < 0.02) press(game, game.active);
        step(game, STEP);
      }
      return game.p1Score * 1000 + game.p2Score;
    };
    expect(play(1234)).not.toBe(play(99));
  });
});
