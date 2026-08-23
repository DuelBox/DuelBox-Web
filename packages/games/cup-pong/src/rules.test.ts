import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  AIM_RATE,
  AIM_SWEEP,
  BALL_RADIUS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOT_DRAWS_PER_THROW,
  BOT_PROFILES,
  CENTRE_X,
  CENTRE_Y,
  CUPS_PER_RACK,
  CUP_RADIUS,
  MAX_RANGE,
  MIN_RANGE,
  MOUTH_RADIUS,
  P1_THROW_Y,
  P2_THROW_Y,
  READY_SECONDS,
  ROUNDS,
  SETTLE_SECONDS,
  STRENGTH_RATE,
  SWISH_RADIUS,
  aimAt,
  cleanBy,
  createBotRngs,
  createBotState,
  createGame,
  driveBot,
  firingSign,
  landingOf,
  leadOf,
  madeBy,
  otherOf,
  press,
  rackOf,
  resetGame,
  step,
  throwYOf,
  winnerOf,
} from './rules.js';
import type { Ball, BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;
const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];

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

/** Put the active seat's throw exactly on a point, and run it to the table. */
function throwAt(game: Game, x: number, y: number): void {
  const out: Ball = { x: 0, y: 0 };
  const angle = aimAt(out, game.active, x, y);
  until(game, () => game.phase === 'aiming');
  game.aim = angle;
  press(game, game.active);
  game.strength = out.x;
  press(game, game.active);
  until(game, () => game.phase !== 'flying');
}

/** One bot-versus-bot match with no frame cap: the guard throws rather than returning. */
function playMatch(
  seed: number,
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  reversePoll = false,
): Game {
  const game = started();
  const rngs = createBotRngs(new Rng(seed));
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
    const winner = winnerOf(playMatch(seed, p1Tier, p2Tier));
    if (winner === 'p1') wins.p1 += 1;
    else if (winner === 'p2') wins.p2 += 1;
    else wins.draw += 1;
  }
  return wins;
}

describe('the table', () => {
  it('puts the two throw lines and the two racks symmetrically about the centre', () => {
    // Everything a seat faces has to be the rotation of what the other seat faces, or the
    // half-turn the shell makes would hand one of them a different problem.
    expect(P1_THROW_Y - CENTRE_Y).toBe(CENTRE_Y - P2_THROW_Y);
    const game = started();
    const mine = rackOf(game, 'p1');
    const theirs = rackOf(game, 'p2');
    expect(mine.length).toBe(CUPS_PER_RACK);
    expect(theirs.length).toBe(CUPS_PER_RACK);
    // As sets, not index by index: the racks are laid out left to right in *board* order, so
    // a cup and its mirror partner are at different indices. That distinction is the reason
    // the bot ranks cups in the thrower's own frame — see `planThrow`.
    const mirrored = theirs
      .map((cup) => `${(CENTRE_X - cup.x).toFixed(6)}:${(CENTRE_Y - cup.y).toFixed(6)}`)
      .sort();
    const own = mine
      .map((cup) => `${(cup.x - CENTRE_X).toFixed(6)}:${(cup.y - CENTRE_Y).toFixed(6)}`)
      .sort();
    expect(own).toEqual(mirrored);
  });

  it('keeps every cup on the table and out of the throw lines', () => {
    const game = started();
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      for (const cup of rackOf(game, seat)) {
        expect(cup.x).toBeGreaterThan(CUP_RADIUS);
        expect(cup.x).toBeLessThan(BOARD_WIDTH - CUP_RADIUS);
        expect(cup.y).toBeGreaterThan(CUP_RADIUS);
        expect(cup.y).toBeLessThan(BOARD_HEIGHT - CUP_RADIUS);
        expect(Math.abs(cup.y - throwYOf(seat))).toBeGreaterThan(CUP_RADIUS * 2);
      }
    }
  });

  it('puts every cup inside the reach of both needles', () => {
    // A cup a needle cannot be stopped on is a cup that is only ever missed, and it would
    // read as a difficulty problem rather than as a gauge fitted to the wrong table.
    const out: Ball = { x: 0, y: 0 };
    const game = started();
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      for (const cup of rackOf(game, otherOf(seat))) {
        const angle = aimAt(out, seat, cup.x, cup.y);
        expect(Math.abs(angle)).toBeLessThan(AIM_SWEEP);
        expect(out.x).toBeGreaterThan(0);
        expect(out.x).toBeLessThan(1);
        // And the gauge is fitted, not merely large enough: the reachable band is a real
        // fraction of it rather than a sliver at one end.
        expect(out.y).toBeGreaterThan(MIN_RANGE);
        expect(out.y).toBeLessThan(MAX_RANGE);
      }
    }
  });

  it('throws the two seats in opposite directions', () => {
    expect(firingSign('p1')).toBe(-firingSign('p2'));
  });

  it('starts level, frozen, with p1 to throw', () => {
    const game = started();
    expect(madeBy(game, 'p1')).toBe(0);
    expect(madeBy(game, 'p2')).toBe(0);
    expect(game.active).toBe('p1');
    expect(game.phase).toBe('ready');
    expect(winnerOf(game)).toBeNull();
  });
});

describe('the needles', () => {
  it("are frozen for the ready pause, and it outlasts the shell's seat flip", () => {
    // The whole point: the shell refuses a person's input while the table turns, and a bot
    // never goes through the shell. Both are stopped here instead, by the same amount.
    const SEAT_FLIP_SECONDS = 0.36;
    expect(READY_SECONDS).toBeGreaterThan(SEAT_FLIP_SECONDS);

    const game = started();
    const parked = game.aim;
    for (let i = 0; i < Math.floor(SEAT_FLIP_SECONDS * 60); i += 1) {
      step(game, STEP);
      expect(game.phase).toBe('ready');
      expect(game.aim).toBe(parked);
      expect(game.strength).toBe(0);
      expect(press(game, 'p1'), 'a press was taken during the ready pause').toBe(false);
    }
  });

  it('start the aim needle at one end, never in the middle', () => {
    // Parked at zero it would already be on the apex cup the moment the freeze lifted, and
    // an instant press would be a free perfect line.
    const game = started();
    expect(game.aim).toBe(-AIM_SWEEP);
    expect(Math.abs(game.aim)).toBe(AIM_SWEEP);
  });

  it('sweep between their limits and turn round', () => {
    const game = started();
    let low = Infinity;
    let high = -Infinity;
    until(game, () => game.phase === 'aiming');
    for (let i = 0; i < 400; i += 1) {
      step(game, STEP);
      low = Math.min(low, game.aim);
      high = Math.max(high, game.aim);
    }
    expect(high).toBeCloseTo(AIM_SWEEP, 2);
    expect(low).toBeCloseTo(-AIM_SWEEP, 2);
  });

  it('take one press for the line and a second for the throw', () => {
    const game = started();
    until(game, () => game.phase === 'aiming');
    game.aim = 0.03;
    expect(press(game, 'p1')).toBe(true);
    expect(game.phase).toBe('throwing');
    expect(game.lockedAim).toBe(0.03);
    expect(press(game, 'p1')).toBe(true);
    expect(game.phase).toBe('flying');
  });

  it('ignore a press from the seat that is not throwing', () => {
    const game = started();
    until(game, () => game.phase === 'aiming');
    expect(press(game, 'p2')).toBe(false);
    expect(game.phase).toBe('aiming');
  });

  it('ignore a press while the ball is in the air', () => {
    const game = started();
    until(game, () => game.phase === 'aiming');
    press(game, 'p1');
    press(game, 'p1');
    expect(game.phase).toBe('flying');
    expect(press(game, 'p1')).toBe(false);
  });

  it('keep the range needle inside its gauge', () => {
    const game = started();
    until(game, () => game.phase === 'aiming');
    press(game, 'p1');
    for (let i = 0; i < 400; i += 1) {
      step(game, STEP);
      expect(game.strength).toBeGreaterThanOrEqual(0);
      expect(game.strength).toBeLessThanOrEqual(1);
    }
  });

  it('cross in about the same time as each other, so neither press is the harder one', () => {
    const aimCrossing = (AIM_SWEEP * 2) / AIM_RATE;
    const rangeCrossing = 1 / STRENGTH_RATE;
    expect(Math.abs(aimCrossing - rangeCrossing)).toBeLessThan(0.1);
  });
});

describe('a throw', () => {
  it('lands where the two needles said it would, for both seats', () => {
    // `landingOf` is what the bot aims with and what the marker draws; if it disagreed with
    // the ball, both would be describing a different game from the one being played.
    const out: Ball = { x: 0, y: 0 };
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      for (const angle of [-0.08, 0, 0.05]) {
        for (const strength of [0.2, 0.55, 0.9]) {
          const game = started();
          game.active = seat;
          until(game, () => game.phase === 'aiming');
          game.aim = angle;
          press(game, seat);
          game.strength = strength;
          press(game, seat);
          until(game, () => game.phase !== 'flying');
          landingOf(out, seat, angle, strength);
          expect(game.ball.x, `${seat} ${String(angle)}/${String(strength)}`).toBeCloseTo(out.x, 6);
          expect(game.ball.y).toBeCloseTo(out.y, 6);
        }
      }
    }
  });

  it('is the identical throw from either seat, mirrored', () => {
    const a: Ball = { x: 0, y: 0 };
    const b: Ball = { x: 0, y: 0 };
    for (const angle of [-0.1, -0.02, 0, 0.07]) {
      for (const strength of [0.1, 0.5, 1]) {
        landingOf(a, 'p1', angle, strength);
        landingOf(b, 'p2', angle, strength);
        expect(a.x - CENTRE_X).toBeCloseTo(CENTRE_X - b.x, 9);
        expect(a.y - CENTRE_Y).toBeCloseTo(CENTRE_Y - b.y, 9);
      }
    }
  });

  it('is inverted exactly by the aim the bot and the marker share', () => {
    const solved: Ball = { x: 0, y: 0 };
    const landed: Ball = { x: 0, y: 0 };
    const game = started();
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      for (const cup of rackOf(game, otherOf(seat))) {
        const angle = aimAt(solved, seat, cup.x, cup.y);
        landingOf(landed, seat, angle, solved.x);
        expect(landed.x).toBeCloseTo(cup.x, 6);
        expect(landed.y).toBeCloseTo(cup.y, 6);
      }
    }
  });

  it('takes the cup it lands in, and only that one', () => {
    const game = started();
    const target = rackOf(game, 'p2')[0] as { x: number; y: number; standing: boolean };
    throwAt(game, target.x, target.y);
    expect(game.lastOutcome).toBe('swish');
    expect(target.standing).toBe(false);
    expect(madeBy(game, 'p1')).toBe(1);
    expect(rackOf(game, 'p2').filter((cup) => cup.standing).length).toBe(CUPS_PER_RACK - 1);
    // And the other rack is untouched: a seat only ever throws at the opposite end.
    expect(rackOf(game, 'p1').every((cup) => cup.standing)).toBe(true);
  });

  it('counts a clean drop and a rim throw apart, and takes the cup either way', () => {
    const game = started();
    const cup = rackOf(game, 'p2')[0] as { x: number; y: number; standing: boolean };
    throwAt(game, cup.x + (SWISH_RADIUS + MOUTH_RADIUS) / 2, cup.y);
    expect(game.lastOutcome).toBe('rattle');
    expect(madeBy(game, 'p1')).toBe(1);
    expect(cleanBy(game, 'p1')).toBe(0);
    expect(cup.standing).toBe(false);
  });

  it('misses when the ball would not fit in the mouth', () => {
    const game = started();
    const cup = rackOf(game, 'p2')[0] as { x: number; y: number; standing: boolean };
    throwAt(game, cup.x + MOUTH_RADIUS + 1, cup.y);
    expect(game.lastOutcome).toBe('miss');
    expect(madeBy(game, 'p1')).toBe(0);
    expect(cup.standing).toBe(true);
  });

  it('judges the mouth by the ball that has to fit through it', () => {
    // The one place the drawn cup and the scoring target are allowed to differ, and the
    // reason they do is visible on the table: the ball is drawn, and it has to fit.
    expect(MOUTH_RADIUS).toBe(CUP_RADIUS - BALL_RADIUS);
    expect(SWISH_RADIUS).toBeLessThan(MOUTH_RADIUS);
  });

  it('cannot take a cup that is already gone', () => {
    const game = started();
    const cup = rackOf(game, 'p2')[0] as { x: number; y: number; standing: boolean };
    throwAt(game, cup.x, cup.y);
    until(game, () => game.active === 'p2');
    until(game, () => game.active === 'p1', 12_000);
    throwAt(game, cup.x, cup.y);
    expect(game.lastOutcome).toBe('miss');
    expect(madeBy(game, 'p1')).toBe(1);
  });
});

describe('turns', () => {
  it('pass to the other seat after the throw has been shown', () => {
    const game = started();
    throwAt(game, CENTRE_X, CENTRE_Y);
    expect(game.phase).toBe('settling');
    const steps = until(game, () => game.active === 'p2');
    expect(steps * STEP).toBeCloseTo(SETTLE_SECONDS, 1);
    expect(game.phase).toBe('ready');
  });

  it('alternate the lead, so neither seat always opens a round', () => {
    expect(leadOf(1)).toBe('p1');
    expect(leadOf(2)).toBe('p2');
    expect(leadOf(3)).toBe('p1');
    for (let round = 1; round < 20; round += 1) {
      expect(leadOf(round + 1)).toBe(otherOf(leadOf(round)));
    }
  });

  it('give the first throw of a match and the last to different seats', () => {
    // An even round count would give seat one both. The odd count is the only split of the
    // two that gives one each.
    expect(ROUNDS % 2).toBe(1);
    expect(leadOf(1)).toBe('p1');
    expect(otherOf(leadOf(ROUNDS))).toBe('p2');
  });

  it('give both seats the same number of throws, whoever wins', () => {
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const game = playMatch(seed, tier, tier);
        expect(game.p1Throws, `${tier} seed ${String(seed)}`).toBe(game.p2Throws);
        expect(game.p1Throws).toBeLessThanOrEqual(ROUNDS);
      }
    }
  });
});

describe('the match ending', () => {
  it('waits for the round to finish before a cleared rack wins it', () => {
    // Ending on the make would hand the match to whoever happened to be leading that round.
    const game = started();
    for (const cup of rackOf(game, 'p2')) cup.standing = false;
    game.p1Made = CUPS_PER_RACK;
    game.p1Clean = CUPS_PER_RACK;
    game.round = 4;
    // Seat one has already thrown this round; seat two's throw is the one that completes it.
    game.thrownThisRound = 1;
    game.active = 'p2';
    game.p1Throws = 4;
    game.p2Throws = 3;

    throwAt(game, CENTRE_X, CENTRE_Y);
    until(game, () => game.phase === 'over' || game.phase === 'ready');
    expect(game.phase).toBe('over');
    expect(winnerOf(game)).toBe('p1');
    expect(game.p1Throws).toBe(game.p2Throws);
  });

  it('is a draw only when the cups and the clean throws both tie', () => {
    const game = started();
    game.round = ROUNDS;
    game.thrownThisRound = 1;
    game.active = 'p2';
    game.p1Made = 3;
    game.p2Made = 3;
    game.p1Clean = 2;
    game.p2Clean = 2;
    throwAt(game, 0, 0);
    until(game, () => game.phase === 'over');
    expect(winnerOf(game)).toBe('draw');
  });

  it('is decided by the clean throws when the cups are level', () => {
    const game = started();
    game.round = ROUNDS;
    game.thrownThisRound = 1;
    game.active = 'p2';
    game.p1Made = 3;
    game.p2Made = 3;
    game.p1Clean = 1;
    game.p2Clean = 2;
    throwAt(game, 0, 0);
    until(game, () => game.phase === 'over');
    expect(winnerOf(game)).toBe('p2');
  });

  it('always ends, on a fixed budget of throws and no clock at all', () => {
    // Structural: nine rounds, one throw each, and nothing about how it is played can add
    // one. Run with no frame cap — the loop below has no ceiling, so a match that did not
    // terminate would hang this test rather than pass it quietly.
    const game = started();
    while (game.phase !== 'over') {
      // Throw wide, every time, from both seats.
      if (game.phase === 'aiming') {
        game.aim = AIM_SWEEP;
        press(game, game.active);
      } else if (game.phase === 'throwing') {
        game.strength = 1;
        press(game, game.active);
      }
      step(game, STEP);
    }
    expect(winnerOf(game)).toBe('draw');
    expect(game.p1Throws).toBe(ROUNDS);
    expect(game.p2Throws).toBe(ROUNDS);
  });

  it('stops simulating once it is decided', () => {
    const game = started();
    game.phase = 'over';
    game.winner = 'p1';
    const aim = game.aim;
    step(game, STEP);
    expect(game.aim).toBe(aim);
  });
});

describe('the bot', () => {
  it('aims at mirrored cups from the two seats', () => {
    // Ranked in board order instead, the two seats picked opposite ends of the back row —
    // the same throw geometrically, but one reached a third of the way through the sweep and
    // the other two thirds, so a large fumble was truncated for one seat and not the other.
    const game = started();
    const p1State = createBotState();
    const p2State = createBotState();
    const quiet = { float: () => 0.5 } as unknown as Rng;
    until(game, () => game.phase === 'aiming');
    driveBot(game, 'p1', 'hard', p1State, quiet, STEP);
    game.active = 'p2';
    game.phase = 'aiming';
    driveBot(game, 'p2', 'hard', p2State, quiet, STEP);
    expect(p2State.wantAim).toBeCloseTo(p1State.wantAim, 9);
    expect(p2State.wantStrength).toBeCloseTo(p1State.wantStrength, 9);
  });

  it('draws the same number of values for every throw, whatever it decides', () => {
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 25; seed += 1) {
        const game = started();
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
        expect(draws, `${tier} seed ${String(seed)}`).toBe(BOT_DRAWS_PER_THROW);
      }
    }
  });

  it('draws the same number again when the rack is nearly empty', () => {
    // The count must not depend on what there is left to aim at either.
    const game = started();
    const rack = rackOf(game, 'p2');
    for (let i = 0; i < rack.length - 1; i += 1)
      (rack[i] as { standing: boolean }).standing = false;
    const counter = new Rng(7);
    let draws = 0;
    const counted = {
      float: () => {
        draws += 1;
        return counter.float();
      },
    } as unknown as Rng;
    until(game, () => game.phase === 'aiming');
    driveBot(game, 'p1', 'hard', createBotState(), counted, STEP);
    expect(draws).toBe(BOT_DRAWS_PER_THROW);
  });

  it('clears the line it chose when it presses, so the range needle reads its own number', () => {
    // Leaving the line's answer standing is how the second needle came to be stopped at a
    // quantity in the wrong unit: radians read as a fraction of the range gauge.
    const game = started();
    const rng = new Rng(3);
    const state = createBotState();
    until(game, () => game.phase === 'aiming');
    driveBot(game, 'p1', 'hard', state, rng, STEP);
    expect(state.stage).toBe('line');
    const wantStrength = state.wantStrength;
    expect(wantStrength).toBeGreaterThan(0);

    // Run the bot until it takes the first press, which is when the clearing happens.
    for (let i = 0; i < 600; i += 1) {
      if (driveBot(game, 'p1', 'hard', state, rng, STEP)) break;
      step(game, STEP);
    }
    expect(game.phase).toBe('throwing');
    expect(state.stage).toBe('range');
    expect(state.wantAim, 'the line it chose was left standing').toBe(0);
    expect(state.aimOffset).toBe(0);
    expect(state.lineTimer).toBe(0);
    // The range press is counting down from the range's own number, not the line's.
    expect(state.rangeTimer).toBeCloseTo(
      wantStrength / STRENGTH_RATE + state.strengthOffset - STEP,
      9,
    );
  });

  it('never asks for a throw the needles cannot produce', () => {
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const game = started();
        const state = createBotState();
        until(game, () => game.phase === 'aiming');
        driveBot(game, 'p1', tier, state, new Rng(seed), STEP);
        expect(state.wantAim).toBeGreaterThanOrEqual(-AIM_SWEEP);
        expect(state.wantAim).toBeLessThanOrEqual(AIM_SWEEP);
        expect(state.wantStrength).toBeGreaterThanOrEqual(0);
        expect(state.wantStrength).toBeLessThanOrEqual(1);
      }
    }
  });

  it('cannot stop a needle more finely than one frame', () => {
    // Rule 6, as arithmetic: a press only ever happens on a step boundary, and every tier's
    // own error is wider than a step anyway.
    for (const tier of TIERS) {
      expect(BOT_PROFILES[tier].timing, tier).toBeGreaterThan(STEP);
      expect(BOT_PROFILES[tier].blunder, tier).toBeGreaterThan(0);
    }
    expect(BOT_PROFILES.hard.timing).toBeLessThan(BOT_PROFILES.normal.timing);
    expect(BOT_PROFILES.normal.timing).toBeLessThan(BOT_PROFILES.easy.timing);
    expect(BOT_PROFILES.hard.blunder).toBeLessThan(BOT_PROFILES.normal.blunder);
    expect(BOT_PROFILES.normal.blunder).toBeLessThan(BOT_PROFILES.easy.blunder);
  });

  it('two of the same tier do not play the identical match', () => {
    // Seeded wander per decision: without it every match between equal bots would be one
    // match played over and over.
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed += 1) {
      const game = playMatch(seed, 'hard', 'hard');
      seen.add(`${String(game.p1Made)}:${String(game.p1Clean)}:${String(game.p2Made)}`);
    }
    expect(seen.size).toBeGreaterThan(6);
  });

  it('plays the bit-identical match whichever seat is polled first', () => {
    // A generator per seat, and a constant number of draws: between them, the order the two
    // seats are asked in cannot reach the simulation.
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 25; seed += 1) {
        const forward = playMatch(seed, tier, tier, false);
        const reverse = playMatch(seed, tier, tier, true);
        expect(reverse, `${tier} seed ${String(seed)}`).toEqual(forward);
      }
    }
  });

  it('gives each seat a stream of its own, seeded from the match', () => {
    const rngs = createBotRngs(new Rng(42));
    const p1 = [rngs.p1.float(), rngs.p1.float(), rngs.p1.float()];
    const p2 = [rngs.p2.float(), rngs.p2.float(), rngs.p2.float()];
    expect(p1).not.toEqual(p2);
    // And the pair is a function of the match seed, so a replay reproduces both.
    const again = createBotRngs(new Rng(42));
    expect([again.p1.float(), again.p1.float(), again.p1.float()]).toEqual(p1);
  });

  it("plays seat two's own game whatever the opponent's tier is", () => {
    // The property the per-seat stream exists for: a seat's throws are its own. Measured on
    // one shared stream with a conditional draw, seat two matched itself in 148 matches of
    // 500; here it must be all of them.
    for (let seed = 1; seed <= 15; seed += 1) {
      const versusEasy = playMatch(seed, 'easy', 'normal');
      const versusHard = playMatch(seed, 'hard', 'normal');
      const shorter = Math.min(versusEasy.p2Throws, versusHard.p2Throws);
      expect(shorter).toBeGreaterThan(0);
      if (versusEasy.p2Throws === versusHard.p2Throws) {
        expect(versusHard.p2Made, `seed ${String(seed)}`).toBe(versusEasy.p2Made);
        expect(versusHard.p2Clean).toBe(versusEasy.p2Clean);
      }
    }
  });

  it('takes a larger share of its throws as the tier goes up', () => {
    const rates = TIERS.map((tier) => makeRate(tier));
    const [easy, normal, hard] = rates as [number, number, number];
    expect(normal, `easy ${easy.toFixed(2)} normal ${normal.toFixed(2)}`).toBeGreaterThan(easy);
    expect(hard, `normal ${normal.toFixed(2)} hard ${hard.toFixed(2)}`).toBeGreaterThan(normal);
  });

  it('is balanced against itself', () => {
    // The full measurement is 1200 seeds a tier in the harness — 50.1%, 50.7% and 49.5% to
    // seat one — and is written into SPEC.md. This is the version that fits in a commit.
    for (const tier of TIERS) {
      const wins = playSeries(tier, tier, 60);
      const decided = wins.p1 + wins.p2;
      expect(decided, `${tier} decided nothing`).toBeGreaterThan(45);
      const share = wins.p1 / decided;
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeGreaterThan(
        0.35,
      );
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeLessThan(0.65);
    }
  });

  it('beats a weaker tier from either seat', () => {
    for (const [strong, weak, ratio] of [
      ['hard', 'easy', 3],
      ['normal', 'easy', 1.8],
      ['hard', 'normal', 2.5],
    ] as [BotDifficulty, BotDifficulty, number][]) {
      const asP1 = playSeries(strong, weak, 60);
      expect(asP1.p1, `${strong} as p1 v ${weak}`).toBeGreaterThan(asP1.p2 * ratio);
      const asP2 = playSeries(weak, strong, 60);
      expect(asP2.p2, `${strong} as p2 v ${weak}`).toBeGreaterThan(asP2.p1 * ratio);
    }
  });

  it('leaves few enough matches undecided that the score is doing work', () => {
    // Cups alone drew 22.9% of `easy` matches; the clean-throw tiebreak is what takes it to
    // single figures.
    for (const tier of TIERS) {
      const wins = playSeries(tier, tier, 60);
      expect(wins.draw / 60, `${tier} drew ${String(wins.draw)} of 60`).toBeLessThan(0.2);
    }
  });
});

/** The share of one tier's throws that go in, over whole matches. */
function makeRate(tier: BotDifficulty): number {
  let thrown = 0;
  let made = 0;
  for (let seed = 1; seed <= 12; seed += 1) {
    const game = playMatch(2000 + seed, tier, tier);
    thrown += game.p1Throws + game.p2Throws;
    made += game.p1Made + game.p2Made;
  }
  return made / Math.max(1, thrown);
}

describe('determinism', () => {
  it('replays a fixed script to the identical final state', () => {
    const play = (): Game => {
      const game = started();
      const script = new Rng(1234);
      for (let i = 0; i < 60 * 200 && game.phase !== 'over'; i += 1) {
        if (script.float() < 0.04) press(game, game.active);
        step(game, STEP);
      }
      return game;
    };
    expect(play()).toEqual(play());
  });

  it('plays a different match from a different seed', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed += 1) {
      const game = playMatch(seed, 'normal', 'normal');
      seen.add(
        `${String(game.p1Made)}:${String(game.p1Clean)}:${String(game.p2Made)}:${String(game.p2Clean)}`,
      );
    }
    expect(seen.size).toBeGreaterThan(15);
  });

  it('is level again after a reset', () => {
    const game = playMatch(9, 'hard', 'hard');
    expect(game.p1Throws).toBeGreaterThan(0);
    resetGame(game);
    expect(game.p1Made).toBe(0);
    expect(game.p2Made).toBe(0);
    expect(game.p1Throws).toBe(0);
    expect(game.round).toBe(1);
    expect(game.active).toBe('p1');
    expect(winnerOf(game)).toBeNull();
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      expect(rackOf(game, seat).every((cup) => cup.standing)).toBe(true);
    }
  });
});
