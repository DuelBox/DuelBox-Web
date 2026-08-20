import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  BOT_PROFILES,
  CELLS,
  COLUMNS,
  MAX_ROUNDS,
  ROWS,
  TARGET,
  bothCommitted,
  botDive,
  botKick,
  cellAt,
  columnOf,
  createBotMemory,
  createGame,
  dive,
  blindGoalChance,
  hardness,
  isCell,
  keeperOf,
  kick,
  otherOf,
  rememberRound,
  resetBotMemory,
  resetGame,
  resolve,
  rowOf,
  saves,
  scoreOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

describe('the goal', () => {
  it('is a three by three grid', () => {
    expect(CELLS).toBe(COLUMNS * ROWS);
    expect(CELLS).toBe(9);
  });

  it('converts between cells and coordinates', () => {
    for (let cell = 0; cell < CELLS; cell += 1) {
      expect(cellAt(columnOf(cell), rowOf(cell))).toBe(cell);
    }
  });

  it('knows what is a cell', () => {
    expect(isCell(0)).toBe(true);
    expect(isCell(CELLS - 1)).toBe(true);
    expect(isCell(-1)).toBe(false);
    expect(isCell(CELLS)).toBe(false);
    expect(isCell(1.5)).toBe(false);
  });
});

describe('a save', () => {
  it('stops a shot the keeper dived at', () => {
    for (let cell = 0; cell < CELLS; cell += 1) {
      expect(saves(cell, cell), `dived at ${String(cell)}`).toBe(true);
    }
  });

  it('reaches one cell either side in the same row', () => {
    // A dive is a body's length, not a point. Without the reach the whole game is a
    // one-in-nine guess and the keeper is a spectator.
    expect(saves(cellAt(0, 1), cellAt(1, 1)), 'reaching left').toBe(true);
    expect(saves(cellAt(2, 1), cellAt(1, 1)), 'reaching right').toBe(true);
  });

  it('does not reach across the goal', () => {
    expect(saves(cellAt(0, 1), cellAt(2, 1))).toBe(false);
  });

  it('does not reach the wrong height', () => {
    expect(saves(cellAt(1, 0), cellAt(1, 2))).toBe(false);
    expect(saves(cellAt(1, 0), cellAt(1, 1))).toBe(false);
  });

  it('stops nothing when either side has not committed', () => {
    expect(saves(-1, 4)).toBe(false);
    expect(saves(4, -1)).toBe(false);
  });

  it('makes the corners twice as hard as the middle', () => {
    // A corner needs the keeper in one of two cells; the middle of a row is covered by
    // all three. Which is exactly why real penalties go there.
    const covers = (shot: number): number => {
      let count = 0;
      for (let d = 0; d < CELLS; d += 1) if (saves(shot, d)) count += 1;
      return count;
    };
    expect(covers(cellAt(0, 1)), 'a corner is saved from two cells').toBe(2);
    expect(covers(cellAt(1, 1)), 'the middle from all three').toBe(3);
    expect(hardness(cellAt(0, 1))).toBeGreaterThan(hardness(cellAt(1, 1)));
  });
});

describe('taking a penalty', () => {
  it('starts with p1 kicking and p2 in goal', () => {
    const game = createGame();
    expect(game.kicker).toBe('p1');
    expect(keeperOf(game)).toBe('p2');
  });

  it('takes a kick and a dive', () => {
    const game = createGame();
    expect(kick(game, 4)).toBe(true);
    expect(dive(game, 0)).toBe(true);
    expect(bothCommitted(game)).toBe(true);
  });

  it('refuses a second kick, so nobody can change their mind', () => {
    const game = createGame();
    kick(game, 4);
    expect(kick(game, 0)).toBe(false);
    expect(game.shot).toBe(4);
  });

  it('refuses a second dive', () => {
    const game = createGame();
    dive(game, 4);
    expect(dive(game, 0)).toBe(false);
    expect(game.dive).toBe(4);
  });

  it('refuses a cell that is not a cell', () => {
    const game = createGame();
    expect(kick(game, -1)).toBe(false);
    expect(kick(game, CELLS)).toBe(false);
    expect(dive(game, 2.5)).toBe(false);
  });

  it('is not committed until both have chosen', () => {
    const game = createGame();
    kick(game, 4);
    expect(bothCommitted(game)).toBe(false);
  });
});

describe('resolving a round', () => {
  /**
   * Fixtures aim at the **bottom** row throughout, where the miss chance is 1–10%. The
   * top corners miss three times in ten, so a test about saves that kicks there is really
   * a test about the dice.
   */
  const SAFE_LEFT = cellAt(0, ROWS - 1);
  const SAFE_MIDDLE = cellAt(1, ROWS - 1);
  const SAFE_RIGHT = cellAt(2, ROWS - 1);

  function played(shot: number, diveAt: number): Game {
    const game = createGame();
    kick(game, shot);
    dive(game, diveAt);
    return game;
  }

  /** A seeded roll that does not miss, found once rather than assumed. */
  function onTarget(): Rng {
    for (let seed = 0; seed < 200; seed += 1) {
      const probe = createGame();
      kick(probe, SAFE_LEFT);
      dive(probe, SAFE_RIGHT);
      if (!resolve(probe, new Rng(seed)).missed) return new Rng(seed);
    }
    throw new Error('no seed kept the ball on target');
  }

  it('scores when the keeper goes the wrong way', () => {
    const game = played(SAFE_LEFT, SAFE_RIGHT);
    const result = resolve(game, onTarget());
    expect(result.scored).toBe(true);
    expect(scoreOf(game, 'p1')).toBe(1);
  });

  it('saves when the keeper reads it', () => {
    const game = played(SAFE_LEFT, SAFE_LEFT);
    const result = resolve(game, onTarget());
    expect(result.scored).toBe(false);
    expect(result.missed, 'saved, not skied').toBe(false);
    expect(scoreOf(game, 'p1')).toBe(0);
  });

  it('tells a miss from a save', () => {
    // A ball over the bar is not a save, and telling a player they were saved when they
    // skied it would be a lie.
    const rng = new Rng(5);
    let sawMiss = false;
    for (let i = 0; i < 200 && !sawMiss; i += 1) {
      const game = played(cellAt(0, 0), SAFE_RIGHT); // top corner: misses three in ten
      const result = resolve(game, rng);
      if (result.missed) {
        sawMiss = true;
        expect(result.scored, 'a miss is not a goal').toBe(false);
        expect(game.missed).toBe(true);
      }
    }
    expect(sawMiss, 'the top corner does go wide sometimes').toBe(true);
  });

  it('swaps the roles every round, whatever happened', () => {
    // A shoot-out where one player kicks until they miss is a different game and a worse
    // one on a shared screen: the other player would sit and watch.
    const scored = played(SAFE_LEFT, SAFE_RIGHT);
    resolve(scored, onTarget());
    expect(scored.kicker, 'after a goal').toBe('p2');

    const stopped = played(SAFE_LEFT, SAFE_LEFT);
    resolve(stopped, onTarget());
    expect(stopped.kicker, 'after a save').toBe('p2');
  });

  it('clears both choices for the next round', () => {
    const game = played(SAFE_MIDDLE, SAFE_LEFT);
    resolve(game, onTarget());
    expect(game.shot).toBe(-1);
    expect(game.dive).toBe(-1);
    expect(bothCommitted(game)).toBe(false);
  });

  it('does nothing until both have committed', () => {
    const game = createGame();
    kick(game, SAFE_MIDDLE);
    const result = resolve(game, new Rng(1));
    expect(result.scored).toBe(false);
    expect(game.kicker, 'the round has not happened').toBe('p1');
    expect(game.round).toBe(0);
  });

  it('counts the round', () => {
    const game = played(SAFE_MIDDLE, SAFE_LEFT);
    resolve(game, onTarget());
    expect(game.round).toBe(1);
  });
});

describe('winning', () => {
  it('is won by reaching the target', () => {
    const game = createGame();
    game.scoreP1 = TARGET;
    expect(winnerOf(game)).toBe('p1');
  });

  it('has no winner before that', () => {
    const game = createGame();
    game.scoreP1 = TARGET - 1;
    game.scoreP2 = TARGET - 1;
    expect(winnerOf(game)).toBeNull();
  });

  it('stops the match the moment it is decided', () => {
    // On a **pair boundary**: p1 kicks first, so p1 reaching the target mid-pair decides
    // nothing until p2 has had the same number of kicks.
    const game = createGame();
    game.scoreP1 = TARGET;
    game.scoreP2 = TARGET - 1;
    game.round = 1; // p2 is about to level the pair
    game.kicker = 'p2';
    expect(winnerOf(game), 'mid-pair, nothing is decided').toBeNull();

    kick(game, cellAt(1, ROWS - 1));
    dive(game, cellAt(1, ROWS - 1)); // saved, so p2 does not level it
    const result = resolve(game, new Rng(3));
    expect(result.winner).toBe('p1');
    expect(game.phase).toBe('over');
  });

  it('does not hand the match to whoever kicks first', () => {
    // First to five, checked after every single kick, gave the first kicker 63.7% of
    // matches between two *identical* bots. A real shoot-out has both sides take the same
    // number of kicks before anyone has won.
    const game = createGame();
    game.scoreP1 = TARGET;
    game.round = 1;
    expect(winnerOf(game), 'p1 is a kick ahead, which is not a win').toBeNull();
    game.round = 2;
    expect(winnerOf(game), 'and now the pair is complete').toBe('p1');
  });

  it('refuses to play on once it is over', () => {
    const game = createGame();
    game.phase = 'over';
    expect(kick(game, 4)).toBe(false);
    expect(dive(game, 4)).toBe(false);
  });

  it('is called at the round cap, on the higher score', () => {
    // Two players who both save everything would never finish, and `roundSeconds` in the
    // manifest is read only by the catalogue card — it ends nothing.
    const game = createGame();
    game.round = MAX_ROUNDS;
    game.scoreP1 = 2;
    game.scoreP2 = 1;
    expect(winnerOf(game)).toBe('p1');
  });

  it('has an even cap, so the cap itself is not a first-kicker win', () => {
    expect(MAX_ROUNDS % 2, 'both players get the same number of kicks').toBe(0);
  });

  it('is a draw at the cap when the two are level', () => {
    const game = createGame();
    game.round = MAX_ROUNDS;
    expect(winnerOf(game)).toBe('draw');
  });

  it('always reaches an end, whatever the two players do', () => {
    // Every round either scores or does not; either way the cap comes closer.
    const game = createGame();
    const rng = new Rng(7);
    for (let i = 0; i < MAX_ROUNDS * 3 && winnerOf(game) === null; i += 1) {
      kick(game, cellAt(1, 1));
      dive(game, cellAt(1, 1)); // saved every time
      resolve(game, rng);
    }
    expect(winnerOf(game), 'a match of nothing but saves still ends').not.toBeNull();
  });

  it('starts over on reset', () => {
    const game = createGame();
    game.scoreP1 = 3;
    game.round = 9;
    game.kicker = 'p2';
    game.phase = 'over';
    resetGame(game);
    expect(game.scoreP1).toBe(0);
    expect(game.round).toBe(0);
    expect(game.kicker).toBe('p1');
    expect(game.phase).toBe('aiming');
  });
});

describe('the bot', () => {
  const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('always names a real cell', () => {
    for (const difficulty of DIFFICULTIES) {
      const memory = createBotMemory();
      const rng = new Rng(11);
      for (let i = 0; i < 200; i += 1) {
        expect(isCell(botKick(memory, rng, difficulty)), `${difficulty} kick`).toBe(true);
        expect(isCell(botDive(memory, rng, difficulty)), `${difficulty} dive`).toBe(true);
      }
    }
  });

  it('does not always pick the same cell', () => {
    // A penalty is a guessing game. A bot that always takes the single best cell is one a
    // human beats twice and then reads for ever.
    for (const difficulty of DIFFICULTIES) {
      const memory = createBotMemory();
      const rng = new Rng(13);
      const seen = new Set<number>();
      for (let i = 0; i < 60; i += 1) seen.add(botKick(memory, rng, difficulty));
      expect(seen.size, `${difficulty} mixes it up`).toBeGreaterThan(2);
    }
  });

  it('aims where goals actually come from, not simply at the corners', () => {
    // The two are different, and telling them apart is the whole skill: the top corners
    // are the hardest to save *and* the easiest to put over the bar, so they score less
    // often than the bottom ones despite being the hardest to reach.
    const bottomRate = (difficulty: BotDifficulty): number => {
      const memory = createBotMemory();
      const rng = new Rng(17);
      let low = 0;
      const tries = 4000;
      for (let i = 0; i < tries; i += 1) {
        if (rowOf(botKick(memory, rng, difficulty)) === ROWS - 1) low += 1;
      }
      return low / tries;
    };
    const easy = bottomRate('easy');
    const hard = bottomRate('hard');
    expect(easy, 'easy is uniform, so a third by chance').toBeCloseTo(1 / 3, 1);
    expect(
      hard,
      `hard ${hard.toFixed(2)} keeps it down against easy ${easy.toFixed(2)}`,
    ).toBeGreaterThan(easy);
    expect(BOT_PROFILES.easy.focus).toBe(0);
  });

  it('rates the bottom corners above the top ones', () => {
    // Which is the whole point of the miss chance: without it the top corners would be
    // strictly best, everyone would aim there, and the game would be a coin flip.
    expect(blindGoalChance(cellAt(0, ROWS - 1))).toBeGreaterThan(blindGoalChance(cellAt(0, 0)));
    expect(hardness(cellAt(0, 0)), 'even though the top corner is harder to save').toBe(
      hardness(cellAt(0, ROWS - 1)),
    );
  });

  it('only the hardest tier reads a pattern', () => {
    expect(BOT_PROFILES.hard.reads).toBe(true);
    expect(BOT_PROFILES.normal.reads).toBe(false);
    expect(BOT_PROFILES.hard.focus).toBeGreaterThan(BOT_PROFILES.normal.focus);
  });

  it('avoids a keeper who always dives the same way', () => {
    // Reading a pattern is a skill, not extra information — a human watching the same
    // keeper would learn the same thing (rule 6).
    const memory = createBotMemory();
    const corner = cellAt(0, 1);
    for (let i = 0; i < 40; i += 1) rememberRound(memory, -1, corner);

    const rng = new Rng(19);
    let intoTheDive = 0;
    const tries = 400;
    for (let i = 0; i < tries; i += 1) {
      if (saves(botKick(memory, rng, 'hard'), corner)) intoTheDive += 1;
    }
    expect(intoTheDive / tries, 'it stops kicking where they keep going').toBeLessThan(0.25);
  });

  it('dives where a kicker keeps kicking', () => {
    const memory = createBotMemory();
    const corner = cellAt(2, 0);
    for (let i = 0; i < 40; i += 1) rememberRound(memory, corner, -1);

    const rng = new Rng(23);
    let stopped = 0;
    const tries = 400;
    for (let i = 0; i < tries; i += 1) {
      if (saves(corner, botDive(memory, rng, 'hard'))) stopped += 1;
    }
    expect(stopped / tries, 'it goes where the ball keeps going').toBeGreaterThan(0.5);
  });

  it('ignores a pattern on the tiers that do not read', () => {
    const memory = createBotMemory();
    const corner = cellAt(2, 0);
    for (let i = 0; i < 40; i += 1) rememberRound(memory, corner, -1);

    const rate = (difficulty: BotDifficulty): number => {
      const rng = new Rng(29);
      let stopped = 0;
      const tries = 600;
      for (let i = 0; i < tries; i += 1) {
        if (saves(corner, botDive(memory, rng, difficulty))) stopped += 1;
      }
      return stopped / tries;
    };
    expect(rate('hard'), 'hard reads it').toBeGreaterThan(rate('normal'));
  });

  it('forgets everything when its memory is reset', () => {
    const memory = createBotMemory();
    rememberRound(memory, 3, 5);
    resetBotMemory(memory);
    expect(memory.shotsFaced.every((n) => n === 0)).toBe(true);
    expect(memory.divesFaced.every((n) => n === 0)).toBe(true);
  });

  it('ignores a round nobody committed to', () => {
    const memory = createBotMemory();
    rememberRound(memory, -1, -1);
    expect(memory.shotsFaced.every((n) => n === 0)).toBe(true);
  });

  it('replays identically from the same seed', () => {
    const trace = (difficulty: BotDifficulty): string => {
      const memory = createBotMemory();
      const rng = new Rng(31);
      const out: number[] = [];
      for (let i = 0; i < 40; i += 1) out.push(botKick(memory, rng, difficulty));
      return out.join(',');
    };
    expect(trace('hard')).toBe(trace('hard'));
  });

  it('wins more often the harder it is', () => {
    const play = (a: BotDifficulty, b: BotDifficulty): number => {
      let aWins = 0;
      const matches = 400;
      for (let seed = 0; seed < matches; seed += 1) {
        const game = createGame();
        const rng = new Rng(seed * 7919 + 3);
        const memA = createBotMemory();
        const memB = createBotMemory();
        while (winnerOf(game) === null) {
          const kickerIsA = game.kicker === 'p1';
          const kickMem = kickerIsA ? memA : memB;
          const diveMem = kickerIsA ? memB : memA;
          const shot = botKick(kickMem, rng, kickerIsA ? a : b);
          const dived = botDive(diveMem, rng, kickerIsA ? b : a);
          kick(game, shot);
          dive(game, dived);
          rememberRound(kickMem, -1, dived);
          rememberRound(diveMem, shot, -1);
          // One rng threaded through, not a fresh one a round: a new `Rng(1)` every call
          // makes every miss roll identical and the match deterministic in the one place
          // it must not be.
          resolve(game, rng);
        }
        if (winnerOf(game) === 'p1') aWins += 1;
      }
      return aWins / matches;
    };
    const hardOverEasy = play('hard', 'easy');
    expect(hardOverEasy, `hard took ${hardOverEasy.toFixed(2)} against easy`).toBeGreaterThan(0.5);
  });
});

describe('seats', () => {
  it('has two, and they swap', () => {
    expect(otherOf('p1')).toBe('p2');
    const game = createGame();
    expect(keeperOf(game)).toBe(otherOf(game.kicker));
  });
});
