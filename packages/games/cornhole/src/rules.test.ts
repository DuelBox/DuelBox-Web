import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BAGS_PER_ROUND,
  BAG_RADIUS,
  BOARD_BOTTOM,
  BOARD_LEFT,
  BOARD_RIGHT,
  BOARD_TOP,
  BOT_PROFILES,
  FLIGHT_SECONDS,
  HOLE_RADIUS,
  HOLE_X,
  HOLE_Y,
  IN_HOLE,
  ON_BOARD,
  PERFECT_ANGLE,
  PERFECT_POWER,
  ROUNDS,
  SHOVE,
  TARGET_SCORE,
  THROW_X,
  THROW_Y,
  botAim,
  createGame,
  inHole,
  landingOf,
  onBoard,
  otherOf,
  rawScoreOf,
  resetGame,
  roundOver,
  settle,
  settleRound,
  step,
  throwBag,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;
const landing = { x: 0, y: 0 };
const aim = { angle: 0, power: 0 };

/** Runs the flight out so the next seat may throw. */
function land(game: Game): void {
  for (let i = 0; i < Math.ceil(FLIGHT_SECONDS / STEP) + 2; i += 1) step(game, STEP);
}

function put(game: Game, seat: SeatId, x: number, y: number): void {
  game.bags.push({ seat, x, y, holed: false });
}

describe('the board', () => {
  it('puts the hole on the board, clear of its edges', () => {
    expect(onBoard(HOLE_X, HOLE_Y)).toBe(true);
    expect(HOLE_Y - HOLE_RADIUS).toBeGreaterThan(BOARD_TOP);
    expect(HOLE_X - HOLE_RADIUS).toBeGreaterThan(BOARD_LEFT);
    expect(HOLE_X + HOLE_RADIUS).toBeLessThan(BOARD_RIGHT);
  });

  it('knows what is on the board and what is on the ground', () => {
    expect(onBoard(HOLE_X, BOARD_BOTTOM - 1)).toBe(true);
    expect(onBoard(HOLE_X, BOARD_BOTTOM + 1), 'past the near edge is the ground').toBe(false);
    expect(onBoard(BOARD_LEFT - 1, HOLE_Y)).toBe(false);
    expect(onBoard(HOLE_X, BOARD_TOP - 1)).toBe(false);
  });

  it('throws from below the board', () => {
    expect(THROW_Y).toBeGreaterThan(BOARD_BOTTOM);
    expect(onBoard(THROW_X, THROW_Y), 'nobody starts on the board').toBe(false);
  });

  it('starts with four bags each and nothing thrown', () => {
    const game = createGame();
    expect(game.left).toEqual({ p1: BAGS_PER_ROUND, p2: BAGS_PER_ROUND });
    expect(game.bags.length).toBe(0);
    expect(game.phase).toBe('aiming');
    expect(game.toThrow).toBe('p1');
  });

  it('resets in place', () => {
    const game = createGame();
    throwBag(game, 'p1', 0, 0.6, new Rng(1));
    resetGame(game);
    expect(game.bags.length).toBe(0);
    expect(game.score).toEqual({ p1: 0, p2: 0 });
    expect(game.round).toBe(0);
  });
});

describe('throwing', () => {
  it('lands further away for more power', () => {
    const soft = { x: 0, y: 0 };
    const hard = { x: 0, y: 0 };
    landingOf(soft, 0, 0.1, new Rng(1));
    landingOf(hard, 0, 0.9, new Rng(1));
    expect(hard.y, 'more power reaches further up the board').toBeLessThan(soft.y);
  });

  it('drifts sideways with the aim', () => {
    const left = { x: 0, y: 0 };
    const right = { x: 0, y: 0 };
    landingOf(left, -1, 0.6, new Rng(1));
    landingOf(right, 1, 0.6, new Rng(1));
    expect(left.x).toBeLessThan(THROW_X);
    expect(right.x).toBeGreaterThan(THROW_X);
  });

  it('clamps an aim or power beyond its range', () => {
    const wild = { x: 0, y: 0 };
    const edge = { x: 0, y: 0 };
    landingOf(wild, 9, 9, new Rng(1));
    landingOf(edge, 1, 1, new Rng(1));
    expect(wild.x).toBeCloseTo(edge.x, 6);
    expect(wild.y).toBeCloseTo(edge.y, 6);
  });

  it('holes a perfectly aimed throw', () => {
    // The aim and power that would drop a bag straight in, so the numbers the bot uses
    // are checked against the geometry rather than assumed.
    landingOf(landing, PERFECT_ANGLE, PERFECT_POWER, new Rng(3));
    expect(inHole(landing.x, landing.y)).toBe(true);
  });

  it('varies, so two identical throws are not identical', () => {
    // Enough that the game is a game rather than a calibration exercise.
    const rng = new Rng(5);
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    landingOf(a, 0, 0.6, rng);
    landingOf(b, 0, 0.6, rng);
    expect(a.x === b.x && a.y === b.y).toBe(false);
  });

  it('refuses a throw from the seat that is not up', () => {
    const game = createGame();
    expect(throwBag(game, 'p2', 0, 0.6, new Rng(1)), 'and a refusal is distinct').toBe(false);
    expect(game.bags.length).toBe(0);
  });

  it('refuses a throw while one is in the air', () => {
    const game = createGame();
    expect(throwBag(game, 'p1', 0, 0.6, new Rng(1))).toBe(true);
    expect(game.phase).toBe('flying');
    expect(throwBag(game, 'p1', 0, 0.6, new Rng(1))).toBe(false);
  });

  it('refuses a throw from a seat with no bags left', () => {
    const game = createGame();
    game.left.p1 = 0;
    expect(throwBag(game, 'p1', 0, 0.6, new Rng(1))).toBe(false);
  });

  it('hands over to the other seat once the bag lands', () => {
    const game = createGame();
    throwBag(game, 'p1', 0, 0.6, new Rng(1));
    land(game);
    expect(game.phase).toBe('aiming');
    expect(game.toThrow).toBe('p2');
  });

  it('stays with a seat when the other has run out', () => {
    const game = createGame();
    game.left.p2 = 0;
    throwBag(game, 'p1', 0, 0.6, new Rng(1));
    land(game);
    expect(game.toThrow, 'p2 has nothing to throw').toBe('p1');
  });
});

describe('bags shoving each other', () => {
  it('pushes a bag it lands on away', () => {
    const game = createGame();
    put(game, 'p2', HOLE_X, BOARD_BOTTOM - 60);
    const target = game.bags[0];
    if (!target) throw new Error('no bag');
    const before = target.y;

    const landed = { seat: 'p1' as SeatId, x: HOLE_X, y: BOARD_BOTTOM - 50, holed: false };
    game.bags.push(landed);
    settle(game, landed);
    expect(target.y, 'shoved clear').not.toBe(before);
    expect(Math.hypot(target.x - landed.x, target.y - landed.y)).toBeGreaterThan(BAG_RADIUS);
  });

  it('leaves a bag well clear of the landing alone', () => {
    const game = createGame();
    put(game, 'p2', BOARD_LEFT + 20, BOARD_BOTTOM - 20);
    const far = game.bags[0];
    if (!far) throw new Error('no bag');
    const before = { x: far.x, y: far.y };
    const landed = { seat: 'p1' as SeatId, x: BOARD_RIGHT - 20, y: BOARD_TOP + 20, holed: false };
    game.bags.push(landed);
    settle(game, landed);
    expect(far.x).toBe(before.x);
    expect(far.y).toBe(before.y);
  });

  it('can shove a bag into the hole', () => {
    // The throw that wins a round without going in itself.
    const game = createGame();
    put(game, 'p1', HOLE_X, HOLE_Y + SHOVE);
    const sitting = game.bags[0];
    if (!sitting) throw new Error('no bag');
    // Within touching distance: two bags only interact inside `BAG_RADIUS * 2`, and the
    // first version of this fixture sat two units outside it and shoved nothing.
    const landed = {
      seat: 'p1' as SeatId,
      x: HOLE_X,
      y: HOLE_Y + SHOVE + BAG_RADIUS,
      holed: false,
    };
    game.bags.push(landed);
    settle(game, landed);
    expect(sitting.holed, 'shoved up and in').toBe(true);
  });

  it('holes a bag that lands in the hole itself', () => {
    const game = createGame();
    const landed = { seat: 'p1' as SeatId, x: HOLE_X, y: HOLE_Y, holed: false };
    game.bags.push(landed);
    settle(game, landed);
    expect(landed.holed).toBe(true);
  });

  it('shoves a bag directly underneath rather than dividing by zero', () => {
    const game = createGame();
    put(game, 'p2', HOLE_X, BOARD_BOTTOM - 60);
    const under = game.bags[0];
    if (!under) throw new Error('no bag');
    const landed = { seat: 'p1' as SeatId, x: under.x, y: under.y, holed: false };
    game.bags.push(landed);
    settle(game, landed);
    expect(Number.isFinite(under.x)).toBe(true);
    expect(Number.isFinite(under.y)).toBe(true);
    expect(under.y, 'pushed up the board').toBeLessThan(landed.y);
  });
});

describe('scoring', () => {
  it('is three in the hole and one on the board', () => {
    const game = createGame();
    put(game, 'p1', HOLE_X, BOARD_BOTTOM - 30);
    const holed = { seat: 'p1' as SeatId, x: HOLE_X, y: HOLE_Y, holed: true };
    game.bags.push(holed);
    expect(rawScoreOf(game, 'p1')).toBe(ON_BOARD + IN_HOLE);
  });

  it('is nothing on the ground', () => {
    const game = createGame();
    put(game, 'p1', BOARD_LEFT - 100, BOARD_BOTTOM + 100);
    expect(rawScoreOf(game, 'p1')).toBe(0);
  });

  it('cancels, so only the difference counts', () => {
    // Eight against seven scores one. This is what stops a runaway.
    const game = createGame();
    for (let i = 0; i < 3; i += 1) put(game, 'p1', BOARD_LEFT + 40 + i * 90, BOARD_BOTTOM - 40);
    put(game, 'p2', BOARD_LEFT + 40, BOARD_TOP + 40);
    expect(rawScoreOf(game, 'p1')).toBe(3);
    expect(rawScoreOf(game, 'p2')).toBe(1);
    settleRound(game);
    expect(game.score, 'three against one is two').toEqual({ p1: 2, p2: 0 });
  });

  it('scores nothing for a tied round', () => {
    const game = createGame();
    put(game, 'p1', BOARD_LEFT + 40, BOARD_BOTTOM - 40);
    put(game, 'p2', BOARD_RIGHT - 40, BOARD_BOTTOM - 40);
    settleRound(game);
    expect(game.score).toEqual({ p1: 0, p2: 0 });
  });

  it('clears the board and refills both seats for the next round', () => {
    const game = createGame();
    put(game, 'p1', HOLE_X, BOARD_BOTTOM - 40);
    game.left.p1 = 0;
    game.left.p2 = 0;
    settleRound(game);
    expect(game.bags.length).toBe(0);
    expect(game.left).toEqual({ p1: BAGS_PER_ROUND, p2: BAGS_PER_ROUND });
    expect(game.round).toBe(1);
  });

  it('alternates who throws first each round', () => {
    const game = createGame();
    expect(game.toThrow).toBe('p1');
    settleRound(game);
    expect(game.toThrow, 'the other seat opens the next round').toBe('p2');
    settleRound(game);
    expect(game.toThrow).toBe('p1');
  });

  it('knows when a round is done', () => {
    const game = createGame();
    expect(roundOver(game)).toBe(false);
    game.left.p1 = 0;
    expect(roundOver(game)).toBe(false);
    game.left.p2 = 0;
    expect(roundOver(game)).toBe(true);
  });
});

describe('winning', () => {
  it('is undecided while rounds remain', () => {
    expect(winnerOf(createGame())).toBeNull();
  });

  it('is won early by reaching the target', () => {
    const game = createGame();
    game.score.p1 = TARGET_SCORE;
    expect(winnerOf(game)).toBe('p1');
  });

  it('is decided on points once the rounds run out', () => {
    const game = createGame();
    game.round = ROUNDS;
    game.score.p1 = 5;
    game.score.p2 = 3;
    expect(winnerOf(game)).toBe('p1');
  });

  it('is a draw on level points at the end', () => {
    const game = createGame();
    game.round = ROUNDS;
    game.score.p1 = 4;
    game.score.p2 = 4;
    expect(winnerOf(game)).toBe('draw');
  });
});

describe('the bot', () => {
  it('aims within range whatever its error', () => {
    const rng = new Rng(11);
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      for (let i = 0; i < 200; i += 1) {
        botAim(aim, BOT_PROFILES[tier], rng);
        expect(aim.angle, tier).toBeGreaterThanOrEqual(-1);
        expect(aim.angle).toBeLessThanOrEqual(1);
        expect(aim.power).toBeGreaterThanOrEqual(0);
        expect(aim.power).toBeLessThanOrEqual(1);
      }
    }
  });

  it('holes more often the harder it is', () => {
    // Measured rather than assumed, over two thousand throws each.
    const rate = (tier: BotDifficulty): number => {
      const rng = new Rng(7);
      let holed = 0;
      for (let i = 0; i < 2000; i += 1) {
        botAim(aim, BOT_PROFILES[tier], rng);
        landingOf(landing, aim.angle, aim.power, rng);
        if (inHole(landing.x, landing.y)) holed += 1;
      }
      return holed / 2000;
    };
    const easy = rate('easy');
    const normal = rate('normal');
    const hard = rate('hard');
    expect(normal, `easy ${easy.toFixed(2)} normal ${normal.toFixed(2)}`).toBeGreaterThan(easy);
    expect(hard, `normal ${normal.toFixed(2)} hard ${hard.toFixed(2)}`).toBeGreaterThan(normal);
    // And the hard tier is beatable. A bot that always succeeds is as bad as one that
    // always fails: the first version of this holed 99% of its throws.
    expect(hard, `hard holed ${(hard * 100).toFixed(0)}%`).toBeLessThan(0.8);
  });

  it('cannot see the wobble it is about to suffer', () => {
    // It commits to an aim, and the wobble is drawn afterwards — so a hard bot is a steady
    // hand rather than a cheat.
    const rng = new Rng(13);
    botAim(aim, BOT_PROFILES.hard, rng);
    const first = { ...aim };
    const other = new Rng(13);
    botAim(aim, BOT_PROFILES.hard, other);
    expect(aim).toEqual(first);
  });

  it('declares its tiers in a sensible order', () => {
    expect(BOT_PROFILES.easy.angleError).toBeGreaterThan(BOT_PROFILES.normal.angleError);
    expect(BOT_PROFILES.normal.angleError).toBeGreaterThan(BOT_PROFILES.hard.angleError);
    expect(BOT_PROFILES.hard.angleError, 'never perfect').toBeGreaterThan(0);
  });
});

describe('a whole match', () => {
  it('finishes', () => {
    const game = createGame();
    const rng = new Rng(21);
    for (let turn = 0; turn < 6000 && winnerOf(game) === null; turn += 1) {
      if (game.phase === 'round-over') {
        settleRound(game);
        continue;
      }
      if (game.phase === 'aiming') {
        botAim(aim, BOT_PROFILES.normal, rng);
        throwBag(game, game.toThrow, aim.angle, aim.power, rng);
      }
      step(game, STEP);
    }
    expect(winnerOf(game)).not.toBeNull();
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = createGame();
      const rng = new Rng(31);
      const out: string[] = [];
      // A flight is 45 steps and a match is four rounds of eight throws, so the bound
      // has to allow for the time as well as the moves.
      for (let turn = 0; turn < 6000 && winnerOf(game) === null; turn += 1) {
        if (game.phase === 'round-over') {
          settleRound(game);
          continue;
        }
        if (game.phase === 'aiming') {
          botAim(aim, BOT_PROFILES.normal, rng);
          throwBag(game, game.toThrow, aim.angle, aim.power, rng);
          out.push(`${String(Math.round(game.to.x))},${String(Math.round(game.to.y))}`);
        }
        step(game, STEP);
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('has two seats that alternate', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});
