import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  BOT_PROFILES,
  CATEGORIES,
  DICE,
  DIE_FACES,
  FULL_HOUSE_SCORE,
  LARGE_STRAIGHT_SCORE,
  ROLLS_PER_TURN,
  SMALL_STRAIGHT_SCORE,
  UPPER,
  UPPER_BONUS,
  UPPER_BONUS_THRESHOLD,
  YATZY_SCORE,
  botCategory,
  botHold,
  bonusFor,
  categoriesLeft,
  counts,
  createGame,
  isTaken,
  longestRun,
  resetGame,
  roll,
  score,
  scoreFor,
  sheetOf,
  toggleHold,
  totalFor,
  upperTotal,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Category, Game, Sheet } from './rules.js';

function handOf(game: Game, ...dice: number[]): void {
  game.dice.length = 0;
  for (const die of dice) game.dice.push(die);
}

describe('scoring a hand', () => {
  const cases: [Category, number[], number][] = [
    ['ones', [1, 1, 3, 4, 5], 2],
    ['twos', [2, 2, 2, 4, 5], 6],
    ['threes', [1, 1, 1, 4, 5], 0],
    ['fours', [4, 4, 4, 4, 5], 16],
    ['fives', [5, 5, 3, 4, 5], 15],
    ['sixes', [6, 6, 6, 6, 6], 30],
    ['three-of-a-kind', [4, 4, 4, 2, 1], 15],
    ['three-of-a-kind', [4, 4, 2, 2, 1], 0],
    ['four-of-a-kind', [4, 4, 4, 4, 1], 17],
    ['four-of-a-kind', [4, 4, 4, 2, 1], 0],
    ['full-house', [3, 3, 3, 5, 5], FULL_HOUSE_SCORE],
    ['full-house', [3, 3, 3, 5, 6], 0],
    ['small-straight', [1, 2, 3, 4, 6], SMALL_STRAIGHT_SCORE],
    ['small-straight', [1, 2, 3, 5, 6], 0],
    ['large-straight', [2, 3, 4, 5, 6], LARGE_STRAIGHT_SCORE],
    ['large-straight', [1, 2, 3, 4, 6], 0],
    ['yatzy', [4, 4, 4, 4, 4], YATZY_SCORE],
    ['yatzy', [4, 4, 4, 4, 1], 0],
    ['chance', [1, 2, 3, 4, 5], 15],
  ];

  for (const [category, dice, expected] of cases) {
    it(`${category} on ${dice.join('')} is ${String(expected)}`, () => {
      expect(scoreFor(category, dice)).toBe(expected);
    });
  }

  it('counts five of a kind as a full house, because it is three and two', () => {
    expect(scoreFor('full-house', [6, 6, 6, 6, 6])).toBe(FULL_HOUSE_SCORE);
  });

  it('scores an empty hand as nothing rather than throwing', () => {
    expect(scoreFor('chance', [])).toBe(0);
  });

  it('finds the longest run of faces', () => {
    const c: number[] = [];
    expect(longestRun(counts(c, [1, 2, 3, 4, 6]))).toBe(4);
    expect(longestRun(counts(c, [2, 3, 4, 5, 6]))).toBe(5);
    expect(longestRun(counts(c, [1, 1, 1, 1, 1]))).toBe(1);
  });
});

describe('the upper bonus', () => {
  it('is nothing below the threshold', () => {
    const sheet: Sheet = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 12 };
    expect(upperTotal(sheet)).toBe(57);
    expect(bonusFor(sheet)).toBe(0);
  });

  it('is paid at the threshold exactly', () => {
    const sheet: Sheet = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 };
    expect(upperTotal(sheet)).toBe(UPPER_BONUS_THRESHOLD);
    expect(bonusFor(sheet)).toBe(UPPER_BONUS);
  });

  it('is counted in the total', () => {
    const sheet: Sheet = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 };
    expect(totalFor(sheet)).toBe(UPPER_BONUS_THRESHOLD + UPPER_BONUS);
  });

  it('counts a zero in the upper section as taken, not as missing', () => {
    const sheet: Sheet = { ones: 0 };
    expect(isTaken(sheet, 'ones'), 'a scored zero is a spent category').toBe(true);
  });
});

describe('rolling', () => {
  it('rolls five dice in range', () => {
    const game = createGame();
    roll(game, new Rng(3));
    expect(game.dice.length).toBe(DICE);
    for (const die of game.dice) {
      expect(die).toBeGreaterThanOrEqual(1);
      expect(die).toBeLessThanOrEqual(DIE_FACES);
    }
  });

  it('re-rolls only the dice that are not held', () => {
    const game = createGame();
    roll(game, new Rng(5));
    handOf(game, 6, 6, 1, 2, 3);
    game.held[0] = true;
    game.held[1] = true;
    roll(game, new Rng(7));
    expect(game.dice[0], 'a held die does not change').toBe(6);
    expect(game.dice[1]).toBe(6);
  });

  it('allows three rolls and no more', () => {
    const game = createGame();
    const rng = new Rng(11);
    for (let i = 0; i < ROLLS_PER_TURN; i += 1) expect(roll(game, rng)).toBe(true);
    expect(roll(game, rng), 'the fourth is refused').toBe(false);
    expect(game.rollsUsed).toBe(ROLLS_PER_TURN);
  });

  it('makes the hand final after the third roll', () => {
    const game = createGame();
    const rng = new Rng(13);
    for (let i = 0; i < ROLLS_PER_TURN; i += 1) roll(game, rng);
    expect(game.phase).toBe('choosing');
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = createGame();
      const rng = new Rng(17);
      const out: string[] = [];
      for (let i = 0; i < ROLLS_PER_TURN; i += 1) {
        roll(game, rng);
        out.push(game.dice.join(''));
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });
});

describe('holding dice', () => {
  it('toggles a die', () => {
    const game = createGame();
    roll(game, new Rng(19));
    expect(toggleHold(game, 2)).toBe(true);
    expect(game.held[2]).toBe(true);
    expect(toggleHold(game, 2)).toBe(true);
    expect(game.held[2]).toBe(false);
  });

  it('refuses before the first roll, when there is nothing to hold', () => {
    const game = createGame();
    expect(toggleHold(game, 0)).toBe(false);
  });

  it('refuses after the last roll, when holding decides nothing', () => {
    const game = createGame();
    const rng = new Rng(23);
    for (let i = 0; i < ROLLS_PER_TURN; i += 1) roll(game, rng);
    expect(toggleHold(game, 0), 'the hand is final').toBe(false);
  });

  it('refuses a die that is not a die', () => {
    const game = createGame();
    roll(game, new Rng(29));
    expect(toggleHold(game, -1)).toBe(false);
    expect(toggleHold(game, DICE)).toBe(false);
    expect(toggleHold(game, 1.5)).toBe(false);
  });
});

describe('spending a hand', () => {
  it('writes the score and hands over', () => {
    const game = createGame();
    roll(game, new Rng(31));
    handOf(game, 5, 5, 5, 2, 1);
    expect(score(game, 'fives')).toBe(true);
    expect(game.sheetP1.fives).toBe(15);
    expect(game.seat).toBe('p2');
    expect(game.phase).toBe('rolling');
    expect(game.rollsUsed, 'the next player starts fresh').toBe(0);
  });

  it('writes a zero, which is ordinary late-game play', () => {
    const game = createGame();
    roll(game, new Rng(37));
    handOf(game, 1, 1, 2, 3, 4);
    expect(score(game, 'yatzy')).toBe(true);
    expect(game.sheetP1.yatzy, 'a spent category worth nothing').toBe(0);
  });

  it('refuses a category already used, which is not the same as scoring zero', () => {
    const game = createGame();
    roll(game, new Rng(41));
    handOf(game, 1, 1, 2, 3, 4);
    score(game, 'ones');
    game.seat = 'p1';
    handOf(game, 1, 1, 1, 3, 4);
    expect(score(game, 'ones')).toBe(false);
    expect(game.sheetP1.ones, 'and the old score stands').toBe(2);
  });

  it('refuses with no hand at all', () => {
    const game = createGame();
    expect(score(game, 'chance')).toBe(false);
  });

  it('clears the held dice for the next player', () => {
    const game = createGame();
    roll(game, new Rng(43));
    game.held[0] = true;
    handOf(game, 1, 2, 3, 4, 5);
    score(game, 'chance');
    expect(game.held.some(Boolean)).toBe(false);
  });
});

describe('the match', () => {
  function playOut(game: Game, seat: 'p1' | 'p2' | 'both'): void {
    for (const category of CATEGORIES) {
      if (seat !== 'p2') {
        game.seat = 'p1';
        handOf(game, 1, 2, 3, 4, 5);
        score(game, category);
      }
      if (seat !== 'p1') {
        game.seat = 'p2';
        handOf(game, 1, 2, 3, 4, 5);
        score(game, category);
      }
    }
  }

  it('runs thirteen turns each', () => {
    const game = createGame();
    expect(categoriesLeft(game.sheetP1)).toBe(CATEGORIES.length);
    playOut(game, 'both');
    expect(game.phase).toBe('over');
  });

  it('is not over while one player still has a category', () => {
    const game = createGame();
    playOut(game, 'p1');
    expect(game.phase, 'seat two has thirteen still to spend').not.toBe('over');
    expect(winnerOf(game)).toBeNull();
  });

  it('gives the match to the higher total', () => {
    const game = createGame();
    playOut(game, 'both');
    game.sheetP1.yatzy = YATZY_SCORE;
    game.sheetP2.yatzy = 0;
    expect(winnerOf(game)).toBe('p1');
  });

  it('calls equal totals a draw', () => {
    const game = createGame();
    playOut(game, 'both');
    expect(totalFor(game.sheetP1)).toBe(totalFor(game.sheetP2));
    expect(winnerOf(game)).toBe('draw');
  });

  it('starts over on reset', () => {
    const game = createGame();
    playOut(game, 'both');
    resetGame(game);
    expect(game.phase).toBe('rolling');
    expect(game.seat).toBe('p1');
    expect(categoriesLeft(game.sheetP1)).toBe(CATEGORIES.length);
    expect(totalFor(game.sheetP1)).toBe(0);
  });
});

describe('the bot', () => {
  const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('keeps the biggest group', () => {
    const game = createGame();
    handOf(game, 5, 5, 5, 2, 1);
    const held: boolean[] = [];
    botHold(held, game, 'hard');
    expect(held).toEqual([true, true, true, false, false]);
  });

  it('keeps a run of four over a pair', () => {
    const game = createGame();
    handOf(game, 2, 3, 4, 5, 5);
    const held: boolean[] = [];
    botHold(held, game, 'hard');
    // The run is 2-3-4-5; one of the fives is kept for it and the other let go.
    expect(held.filter(Boolean).length).toBe(4);
    expect(held[0], 'the two is part of the run').toBe(true);
  });

  it('keeps nothing on easy, which is the whole of the difference', () => {
    const game = createGame();
    handOf(game, 6, 6, 6, 6, 1);
    const held: boolean[] = [];
    botHold(held, game, 'easy');
    expect(held.some(Boolean), 'it has not worked out that holding is allowed').toBe(false);
    expect(BOT_PROFILES.easy.keepsPairs).toBe(false);
  });

  it('takes the best open category', () => {
    const game = createGame();
    handOf(game, 6, 6, 6, 6, 6);
    expect(botCategory(game, 'hard')).toBe('yatzy');
  });

  it('does not take a category already spent', () => {
    const game = createGame();
    game.sheetP1.yatzy = YATZY_SCORE;
    handOf(game, 6, 6, 6, 6, 6);
    expect(botCategory(game, 'hard')).not.toBe('yatzy');
  });

  it('spends a wasted turn on the cheapest category rather than the first', () => {
    // Nothing scores here except chance and the numbers. With ones and yatzy both open, a
    // zero belongs in ones — throwing away yatzy for the same nothing is the beginner's
    // mistake this guards against.
    const game = createGame();
    for (const category of CATEGORIES) {
      if (category !== 'ones' && category !== 'yatzy') game.sheetP1[category] = 0;
    }
    handOf(game, 2, 3, 4, 6, 6);
    expect(botCategory(game, 'hard')).toBe('ones');
  });

  it('chases the upper bonus only on hard', () => {
    expect(BOT_PROFILES.hard.chasesUpperBonus).toBe(true);
    expect(BOT_PROFILES.normal.chasesUpperBonus).toBe(false);
  });

  it('scores higher the harder it is', () => {
    const averageFor = (difficulty: BotDifficulty): number => {
      let total = 0;
      const rounds = 200;
      for (let seed = 0; seed < rounds; seed += 1) {
        const game = createGame();
        const rng = new Rng(seed * 7919 + 11);
        const held: boolean[] = [];
        for (let turn = 0; turn < CATEGORIES.length; turn += 1) {
          game.seat = 'p1';
          game.phase = 'rolling';
          game.rollsUsed = 0;
          game.dice.length = 0;
          game.held.fill(false);
          for (let r = 0; r < ROLLS_PER_TURN; r += 1) {
            roll(game, rng);
            if (r < ROLLS_PER_TURN - 1) {
              botHold(held, game, difficulty);
              for (let i = 0; i < DICE; i += 1) game.held[i] = held[i] === true;
            }
          }
          score(game, botCategory(game, difficulty));
        }
        total += totalFor(game.sheetP1);
      }
      return total / rounds;
    };

    const easy = averageFor('easy');
    const normal = averageFor('normal');
    const hard = averageFor('hard');
    expect(normal, `normal ${String(normal)} beats easy ${String(easy)}`).toBeGreaterThan(easy);
    expect(hard, `hard ${String(hard)} beats normal ${String(normal)}`).toBeGreaterThan(normal);
  });

  it('never reads a die it has not rolled', () => {
    // Rule 6, as a property: the choice depends only on the hand and the sheet.
    for (const difficulty of DIFFICULTIES) {
      const a = createGame();
      handOf(a, 3, 3, 5, 5, 5);
      const b = createGame();
      handOf(b, 3, 3, 5, 5, 5);
      expect(botCategory(a, difficulty)).toBe(botCategory(b, difficulty));
    }
  });

  it('always names an open category, whatever the hand', () => {
    for (const difficulty of DIFFICULTIES) {
      const game = createGame();
      const rng = new Rng(53);
      for (let turn = 0; turn < CATEGORIES.length; turn += 1) {
        game.seat = 'p1';
        game.phase = 'rolling';
        game.rollsUsed = 0;
        game.dice.length = 0;
        roll(game, rng);
        const chosen = botCategory(game, difficulty);
        expect(isTaken(sheetOf(game, 'p1'), chosen), `${difficulty} reused ${chosen}`).toBe(false);
        expect(score(game, chosen)).toBe(true);
      }
    }
  });
});

describe('the upper section list', () => {
  it('is the six number categories, in order', () => {
    expect(UPPER).toEqual(['ones', 'twos', 'threes', 'fours', 'fives', 'sixes']);
  });
});
