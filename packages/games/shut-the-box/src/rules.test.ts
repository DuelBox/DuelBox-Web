import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_PROFILES,
  DIE_FACES,
  ONE_DIE_BELOW,
  TILE_COUNT,
  botPick,
  botTakesOneDie,
  canMake,
  commitPick,
  createGame,
  endTurn,
  highestOpen,
  isPicked,
  legalSets,
  oneDieAllowed,
  openTotal,
  otherOf,
  pickComplete,
  pickedTotal,
  resetGame,
  roll,
  rollTotal,
  tilesOfMask,
  togglePick,
  turnIsDead,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

/** A game with exactly these tiles open, so a test states its own position. */
function withOpen(...tiles: number[]): Game {
  const game = createGame();
  game.open.fill(false);
  for (const tile of tiles) game.open[tile - 1] = true;
  return game;
}

function setRoll(game: Game, ...dice: number[]): void {
  game.dice.length = 0;
  for (const die of dice) game.dice.push(die);
  game.picked.length = 0;
  game.phase = 'choosing';
}

describe('the box', () => {
  it('starts with all nine tiles open', () => {
    const game = createGame();
    expect(game.open.filter(Boolean).length).toBe(TILE_COUNT);
    expect(openTotal(game), '1 through 9').toBe(45);
    expect(highestOpen(game)).toBe(9);
  });

  it('reports the total of what is still open', () => {
    expect(openTotal(withOpen(2, 3, 7))).toBe(12);
  });

  it('reports an empty box as nothing open', () => {
    const game = withOpen();
    expect(highestOpen(game)).toBe(0);
    expect(openTotal(game)).toBe(0);
  });
});

describe('making a roll', () => {
  it('knows a roll it can make', () => {
    expect(canMake(withOpen(1, 4, 9), 5), '1 + 4').toBe(true);
  });

  it('knows a roll it cannot', () => {
    expect(canMake(withOpen(1, 4, 9), 8), 'no subset of 1, 4, 9 makes 8').toBe(false);
  });

  it('will not make a roll from a shut tile', () => {
    expect(canMake(withOpen(2, 3), 7), '7 is shut, and 2 + 3 is 5').toBe(false);
  });

  it('finds every way of making a roll, and no others', () => {
    const game = withOpen(1, 2, 3, 4, 7);
    const found: number[] = [];
    const count = legalSets(found, game, 7);
    const asTiles = found.map((mask) => {
      const tiles: number[] = [];
      tilesOfMask(tiles, mask);
      return tiles.join('+');
    });
    expect(asTiles.sort()).toEqual(['1+2+4', '3+4', '7'].sort());
    expect(count).toBe(3);
  });

  it('finds nothing for a roll it cannot make', () => {
    const found: number[] = [];
    expect(legalSets(found, withOpen(2, 4), 9)).toBe(0);
  });

  it('never offers a set containing a shut tile', () => {
    const game = withOpen(1, 5, 6);
    const found: number[] = [];
    legalSets(found, game, 6);
    const tiles: number[] = [];
    for (const mask of found) {
      tilesOfMask(tiles, mask);
      for (const tile of tiles) {
        expect(game.open[tile - 1], `tile ${String(tile)} is open`).toBe(true);
      }
    }
  });
});

describe('picking tiles', () => {
  it('picks and unpicks', () => {
    const game = withOpen(1, 2, 3, 4, 5);
    setRoll(game, 3, 4);
    expect(togglePick(game, 3)).toBe(true);
    expect(isPicked(game, 3)).toBe(true);
    expect(togglePick(game, 3), 'a second tap takes it back').toBe(true);
    expect(isPicked(game, 3)).toBe(false);
  });

  it('refuses a shut tile', () => {
    const game = withOpen(1, 2);
    setRoll(game, 3, 4);
    expect(togglePick(game, 5), '5 is already shut').toBe(false);
  });

  it('refuses a tile that would overshoot the roll', () => {
    const game = withOpen(1, 2, 9);
    setRoll(game, 1, 2); // a roll of 3
    expect(togglePick(game, 9), '9 alone is past 3').toBe(false);
    expect(pickedTotal(game)).toBe(0);
  });

  it('refuses a tile that would overshoot once others are picked', () => {
    const game = withOpen(1, 2, 3, 4);
    setRoll(game, 2, 3); // a roll of 5
    expect(togglePick(game, 4)).toBe(true);
    expect(togglePick(game, 3), '4 + 3 is past 5').toBe(false);
    expect(togglePick(game, 1), '4 + 1 is exactly 5').toBe(true);
  });

  it('is complete only on an exact match', () => {
    const game = withOpen(1, 2, 3, 4);
    setRoll(game, 2, 3);
    togglePick(game, 4);
    expect(pickComplete(game), '4 is not yet 5').toBe(false);
    togglePick(game, 1);
    expect(pickComplete(game)).toBe(true);
  });

  it('refuses to pick outside a choosing phase', () => {
    const game = createGame();
    game.phase = 'rolling';
    expect(togglePick(game, 4)).toBe(false);
  });

  it('refuses a tile that is not a tile', () => {
    const game = createGame();
    setRoll(game, 3, 3);
    expect(togglePick(game, 0)).toBe(false);
    expect(togglePick(game, TILE_COUNT + 1)).toBe(false);
    expect(togglePick(game, 2.5)).toBe(false);
  });
});

describe('shutting them', () => {
  it('shuts exactly the tiles picked', () => {
    const game = withOpen(1, 2, 3, 4, 5, 6, 7, 8, 9);
    setRoll(game, 3, 4);
    togglePick(game, 3);
    togglePick(game, 4);
    expect(commitPick(game).shut).toBe(true);
    expect(game.open[2], 'tile 3 is shut').toBe(false);
    expect(game.open[3], 'tile 4 is shut').toBe(false);
    expect(game.open[6], 'tile 7 is untouched').toBe(true);
  });

  it('refuses an incomplete pick', () => {
    const game = createGame();
    setRoll(game, 3, 4);
    togglePick(game, 3);
    expect(commitPick(game).shut, '3 is not 7').toBe(false);
    expect(game.open[2], 'and nothing was shut').toBe(true);
  });

  it('returns to rolling with tiles left', () => {
    const game = withOpen(1, 2, 3);
    setRoll(game, 1, 1);
    togglePick(game, 2);
    commitPick(game);
    expect(game.phase).toBe('rolling');
  });

  it('recognises a shut box and scores it zero', () => {
    const game = withOpen(5);
    setRoll(game, 2, 3);
    togglePick(game, 5);
    const result = commitPick(game);
    expect(result.boxShut, 'nothing is left').toBe(true);
    expect(game.scoreP1, 'a perfect round scores nothing').toBe(0);
  });
});

describe('a dead turn', () => {
  it('is dead when the roll cannot be made', () => {
    const game = withOpen(2, 5);
    setRoll(game, 4, 5); // 9, and 2 + 5 is 7
    expect(turnIsDead(game)).toBe(true);
  });

  it('is not dead when it can', () => {
    const game = withOpen(2, 5, 9);
    setRoll(game, 4, 5);
    expect(turnIsDead(game)).toBe(false);
  });

  it('scores the tiles left standing', () => {
    const game = withOpen(2, 5, 8);
    setRoll(game, 6, 6);
    endTurn(game);
    expect(game.scoreP1, '2 + 5 + 8').toBe(15);
  });
});

describe('the two turns', () => {
  it('hands the box over to seat two, reopened', () => {
    const game = withOpen(3, 4);
    endTurn(game);
    expect(game.seat).toBe('p2');
    expect(game.open.filter(Boolean).length, 'a fresh box for the second player').toBe(TILE_COUNT);
    expect(game.phase).toBe('rolling');
  });

  it('ends the match after seat two', () => {
    const game = createGame();
    endTurn(game);
    endTurn(game);
    expect(game.phase).toBe('over');
  });

  it('gives both seats a turn whichever of them opened', () => {
    // The regression this game shipped with. `endTurn` read `game.seat === 'p2'` to decide
    // the match was over, so with a `p2` opener the very first turn ended it: seat one
    // never played, its score stayed at the -1 sentinel, and -1 is lower than anything.
    // It won 100 matches of 100 the moment the game started reading `context.openingSeat`.
    for (const opener of ['p1', 'p2'] as SeatId[]) {
      const game = createGame();
      resetGame(game, opener);
      expect(game.seat).toBe(opener);

      endTurn(game);
      expect(game.phase, 'the opener is not the whole match').toBe('rolling');
      expect(game.seat, 'the other seat gets the box, reopened').toBe(otherOf(opener));
      expect(game.open.filter(Boolean).length).toBe(TILE_COUNT);

      endTurn(game);
      expect(game.phase).toBe('over');
      expect(game.scoreP1, 'seat one played').toBeGreaterThanOrEqual(0);
      expect(game.scoreP2, 'seat two played').toBeGreaterThanOrEqual(0);
    }
  });

  it('gives the match to the lower score', () => {
    const game = createGame();
    game.phase = 'over';
    game.scoreP1 = 6;
    game.scoreP2 = 21;
    expect(winnerOf(game), 'low wins, which is the whole point of the game').toBe('p1');
    game.scoreP1 = 30;
    expect(winnerOf(game)).toBe('p2');
  });

  it('calls equal scores a draw', () => {
    const game = createGame();
    game.phase = 'over';
    game.scoreP1 = 12;
    game.scoreP2 = 12;
    expect(winnerOf(game)).toBe('draw');
  });

  it('has no winner while it is live', () => {
    expect(winnerOf(createGame())).toBeNull();
  });

  it('starts over on reset', () => {
    const game = createGame();
    endTurn(game);
    endTurn(game);
    resetGame(game);
    expect(game.phase).toBe('rolling');
    expect(game.seat).toBe('p1');
    expect(game.scoreP1).toBe(-1);
    expect(game.open.filter(Boolean).length).toBe(TILE_COUNT);
  });
});

describe('the dice', () => {
  it('rolls two, in range', () => {
    const rng = new Rng(11);
    const game = createGame();
    for (let i = 0; i < 200; i += 1) {
      roll(game, rng);
      expect(game.dice.length).toBe(2);
      for (const die of game.dice) {
        expect(die).toBeGreaterThanOrEqual(1);
        expect(die).toBeLessThanOrEqual(DIE_FACES);
      }
    }
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const rng = new Rng(23);
      const game = createGame();
      const out: string[] = [];
      for (let i = 0; i < 40; i += 1) {
        roll(game, rng);
        out.push(String(rollTotal(game)));
      }
      return out.join(',');
    };
    expect(trace()).toBe(trace());
  });

  it('offers one die only once the high tiles are shut', () => {
    expect(oneDieAllowed(withOpen(1, 2, 9)), 'the 9 is still standing').toBe(false);
    expect(oneDieAllowed(withOpen(1, 2, 6))).toBe(true);
    expect(highestOpen(withOpen(1, 2, 6))).toBeLessThan(ONE_DIE_BELOW);
  });

  it('rolls one die when asked and allowed', () => {
    const game = withOpen(1, 2, 3);
    roll(game, new Rng(5), 1);
    expect(game.dice.length).toBe(1);
  });

  it('refuses one die while a high tile stands', () => {
    const game = withOpen(1, 9);
    roll(game, new Rng(5), 1);
    expect(game.dice.length, 'the 9 forces two dice').toBe(2);
  });

  it('clears the previous pick when it rolls', () => {
    const game = createGame();
    setRoll(game, 2, 2);
    togglePick(game, 4);
    roll(game, new Rng(7));
    expect(game.picked.length).toBe(0);
    expect(game.phase).toBe('choosing');
  });
});

describe('the bot', () => {
  const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('picks a set that makes the roll', () => {
    for (const difficulty of DIFFICULTIES) {
      const rng = new Rng(31);
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const game = createGame();
        roll(game, rng);
        const mask = botPick(game, rng, difficulty);
        if (mask === 0) continue;
        const tiles: number[] = [];
        tilesOfMask(tiles, mask);
        let total = 0;
        for (const tile of tiles) {
          expect(game.open[tile - 1], `${difficulty} picked an open tile`).toBe(true);
          total += tile;
        }
        expect(total, `${difficulty} picked a set summing to the roll`).toBe(rollTotal(game));
      }
    }
  });

  it('returns nothing when the roll cannot be made', () => {
    const game = withOpen(2, 3);
    setRoll(game, 6, 6);
    expect(botPick(game, new Rng(3), 'hard')).toBe(0);
  });

  it('scores lower the harder it is', () => {
    // A full turn played by each tier over many seeds. Lower is better here, so the
    // ordering runs the other way from every other game in this repository.
    const averageFor = (difficulty: BotDifficulty): number => {
      let total = 0;
      const rounds = 300;
      for (let seed = 0; seed < rounds; seed += 1) {
        const rng = new Rng(seed * 7919 + 13);
        const game = createGame();
        for (;;) {
          roll(game, rng, botTakesOneDie(game, difficulty) ? 1 : 2);
          const mask = botPick(game, rng, difficulty);
          if (mask === 0) break;
          const tiles: number[] = [];
          tilesOfMask(tiles, mask);
          for (const tile of tiles) togglePick(game, tile);
          const result = commitPick(game);
          if (result.boxShut) break;
        }
        total += openTotal(game);
      }
      return total / rounds;
    };

    const easy = averageFor('easy');
    const normal = averageFor('normal');
    const hard = averageFor('hard');
    expect(normal, `normal ${String(normal)} beats easy ${String(easy)}`).toBeLessThan(easy);
    expect(hard, `hard ${String(hard)} beats normal ${String(normal)}`).toBeLessThan(normal);
  });

  it('takes the one-die option only when it improves the odds', () => {
    // With just the 1 open, one die makes it one time in six; two dice never can.
    expect(botTakesOneDie(withOpen(1), 'hard')).toBe(true);
    // With the 9 standing the option is not on offer at all.
    expect(botTakesOneDie(withOpen(1, 9), 'hard')).toBe(false);
  });

  it('never takes the one-die option on easy', () => {
    // The tiers differ by judgement, and this is one of the judgements.
    expect(botTakesOneDie(withOpen(1), 'easy')).toBe(false);
  });

  it('blunders more often the easier it is', () => {
    expect(BOT_PROFILES.easy.blunder).toBeGreaterThan(BOT_PROFILES.normal.blunder);
    expect(BOT_PROFILES.normal.blunder).toBeGreaterThan(BOT_PROFILES.hard.blunder);
    expect(BOT_PROFILES.hard.blunder, 'the hardest tier never throws one away').toBe(0);
  });

  it('prefers keeping a makeable box over shutting the biggest tile', () => {
    // Open 1, 2, 4, 5, 6, 8 and a roll of 11.
    //
    //   shut the highest → 1 + 2 + 8, leaving 4, 5, 6 — which cannot make 2, 3, 7, 12 and
    //                      so survives the next roll only half the time
    //   look ahead       → 5 + 6, leaving 1, 2, 4, 8 — every roll from 2 to 12 makeable
    //
    // The first version of this test used a position where both heuristics happened to
    // choose the same tile, so it passed with the lookahead term deleted outright. This
    // position was found by sweeping all 512 boxes against all eleven rolls for the pair
    // that separates them most.
    const game = withOpen(1, 2, 4, 5, 6, 8);
    setRoll(game, 5, 6);
    const mask = botPick(game, new Rng(9), 'hard');
    const tiles: number[] = [];
    tilesOfMask(tiles, mask);
    expect(tiles, 'it spent the middle tiles, not the 8').toEqual([5, 6]);

    // And what it kept really is makeable, whatever comes next.
    for (const tile of tiles) togglePick(game, tile);
    commitPick(game);
    for (let total = 2; total <= 12; total += 1) {
      expect(canMake(game, total), `a roll of ${String(total)} can still be made`).toBe(true);
    }
  });
});
