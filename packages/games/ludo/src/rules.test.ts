import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  AT_START,
  BOT_PROFILES,
  DIE_FACES,
  ENTRY,
  HOME,
  HOME_RUN,
  RELEASE_ROLL,
  TOKENS,
  TRACK,
  botMove,
  canMove,
  createGame,
  hasMove,
  isHome,
  isThreatened,
  leadOf,
  legalMoves,
  loopSquare,
  move,
  otherOf,
  passTurn,
  resetGame,
  roll,
  tokensHome,
  tokensOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

/** A game with the named token progresses, so a test states its own position. */
function at(p1: number[], p2: number[], die = 0): Game {
  const game = createGame();
  for (let i = 0; i < TOKENS; i += 1) {
    game.p1[i] = p1[i] ?? AT_START;
    game.p2[i] = p2[i] ?? AT_START;
  }
  if (die > 0) {
    game.die = die;
    game.phase = 'choosing';
  }
  return game;
}

describe('the board', () => {
  it('gives each seat three tokens, all at the start', () => {
    const game = createGame();
    expect(game.p1.length).toBe(TOKENS);
    expect(game.p1.every((p) => p === AT_START)).toBe(true);
  });

  it('joins the two seats opposite each other, so both laps are the same', () => {
    expect(ENTRY.p2 - ENTRY.p1).toBe(TRACK / 2);
  });

  it('maps progress to a square of the shared loop', () => {
    expect(loopSquare('p1', 0)).toBe(ENTRY.p1);
    expect(loopSquare('p2', 0)).toBe(ENTRY.p2);
    expect(loopSquare('p1', 5)).toBe((ENTRY.p1 + 5) % TRACK);
  });

  it('wraps the loop rather than running off the end', () => {
    expect(loopSquare('p2', TRACK - 1)).toBe((ENTRY.p2 + TRACK - 1) % TRACK);
  });

  it('puts a token at the start on no square at all', () => {
    expect(loopSquare('p1', AT_START)).toBe(-1);
  });

  it('puts a token in its home column on no square of the loop', () => {
    // Which is exactly what makes the home column worth reaching: nothing can catch you.
    expect(loopSquare('p1', TRACK)).toBe(-1);
    expect(loopSquare('p1', HOME)).toBe(-1);
  });

  it('has a home column beyond the loop', () => {
    expect(HOME).toBe(TRACK + HOME_RUN);
  });
});

describe('what a token may do', () => {
  it('needs a six to come out', () => {
    const game = createGame();
    for (let die = 1; die < RELEASE_ROLL; die += 1) {
      expect(canMove(game, 'p1', 0, die), `a ${String(die)} does not release`).toBe(false);
    }
    expect(canMove(game, 'p1', 0, RELEASE_ROLL)).toBe(true);
  });

  it('moves freely once it is out', () => {
    const game = at([4], []);
    expect(canMove(game, 'p1', 0, 3)).toBe(true);
  });

  it('must land on home exactly', () => {
    // Overshooting is not a move, which is what makes the last few squares a decision.
    const game = at([HOME - 2], []);
    expect(canMove(game, 'p1', 0, 2), 'exactly home').toBe(true);
    expect(canMove(game, 'p1', 0, 3), 'one past').toBe(false);
  });

  it('will not move a token that is already home', () => {
    const game = at([HOME], []);
    expect(canMove(game, 'p1', 0, 1)).toBe(false);
  });

  it('refuses a die that is not a die', () => {
    const game = at([4], []);
    expect(canMove(game, 'p1', 0, 0)).toBe(false);
    expect(canMove(game, 'p1', 0, DIE_FACES + 1)).toBe(false);
  });

  it('lists every legal token and no others', () => {
    const game = at([AT_START, 4, HOME], []);
    const out: number[] = [];
    expect(legalMoves(out, game, 'p1', 3), 'only the one on the track').toBe(1);
    expect(out).toEqual([1]);
    expect(legalMoves(out, game, 'p1', RELEASE_ROLL), 'the six frees the one at the start').toBe(2);
  });

  it('knows when a seat is stuck', () => {
    const game = createGame();
    expect(hasMove(game, 'p1', 3), 'all at the start and no six').toBe(false);
    expect(hasMove(game, 'p1', RELEASE_ROLL)).toBe(true);
  });
});

describe('moving', () => {
  it('brings a token out onto the entry square', () => {
    const game = at([], [], RELEASE_ROLL);
    expect(move(game, 0).moved).toBe(true);
    expect(game.p1[0]).toBe(0);
    expect(loopSquare('p1', 0)).toBe(ENTRY.p1);
  });

  it('advances a token by the die', () => {
    const game = at([4], [], 3);
    move(game, 0);
    expect(game.p1[0]).toBe(7);
  });

  it('refuses an illegal move, and says so', () => {
    const game = at([AT_START], [], 3);
    const result = move(game, 0);
    expect(result.moved, 'a refusal is not a move that captured nothing').toBe(false);
    expect(game.p1[0]).toBe(AT_START);
  });

  it('refuses to move before a roll', () => {
    const game = at([4], []);
    expect(move(game, 0).moved).toBe(false);
  });

  it('passes the turn on anything but a six', () => {
    const game = at([4], [], 3);
    move(game, 0);
    expect(game.seat).toBe('p2');
    expect(game.phase).toBe('rolling');
  });

  it('earns another roll on a six', () => {
    // Which is what stops a bad run of dice from being hopeless.
    const game = at([4], [], RELEASE_ROLL);
    move(game, 0);
    expect(game.seat, 'still your turn').toBe('p1');
    expect(game.phase).toBe('rolling');
  });
});

describe('capturing', () => {
  it('sends an opponent on the same square back to the start', () => {
    // p1 at progress 4 is on square 4; p2 needs the same square, which is 4 - ENTRY.p2
    // around the loop.
    const theirProgress = (4 - ENTRY.p2 + TRACK) % TRACK;
    const game = at([2], [theirProgress], 2);
    expect(loopSquare('p2', theirProgress)).toBe(4);
    move(game, 0);
    expect(game.p1[0]).toBe(4);
    expect(game.p2[0], 'sent home').toBe(AT_START);
  });

  it('reports how many it took', () => {
    const theirProgress = (4 - ENTRY.p2 + TRACK) % TRACK;
    const game = at([2], [theirProgress, theirProgress], 2);
    expect(move(game, 0).captured).toBe(2);
  });

  it('takes nothing from an empty square', () => {
    const game = at([2], [], 2);
    expect(move(game, 0).captured).toBe(0);
  });

  it('cannot reach a token in its home column', () => {
    // The home column is off the shared loop, so nothing can catch you there.
    const game = at([2], [TRACK + 1], 2);
    move(game, 0);
    expect(game.p2[0], 'safe up the column').toBe(TRACK + 1);
  });

  it('cannot reach a token at the start', () => {
    const game = at([2], [AT_START], 2);
    move(game, 0);
    expect(game.p2[0]).toBe(AT_START);
  });

  it('never captures its own', () => {
    const game = at([2, 4], [], 2);
    move(game, 0);
    expect(game.p1[1], 'your own token is not taken').toBe(4);
  });
});

describe('winning', () => {
  it('is won by getting one token home', () => {
    const game = at([HOME - 3], [], 3);
    const result = move(game, 0);
    expect(result.won).toBe(true);
    expect(winnerOf(game)).toBe('p1');
    expect(game.phase).toBe('over');
  });

  it('has no winner before that', () => {
    expect(winnerOf(createGame())).toBeNull();
  });

  it('counts tokens home', () => {
    const game = at([HOME, 4], []);
    expect(tokensHome(game, 'p1')).toBe(1);
    expect(isHome(HOME)).toBe(true);
  });

  it('reports how far the leading token has come', () => {
    const game = at([2, 19, AT_START], []);
    expect(leadOf(game, 'p1')).toBe(19);
  });

  it('starts over on reset', () => {
    const game = at([HOME], [4]);
    game.winner = 'p1';
    game.phase = 'over';
    resetGame(game);
    expect(game.p1.every((p) => p === AT_START)).toBe(true);
    expect(game.winner).toBeNull();
    expect(game.phase).toBe('rolling');
  });
});

describe('a turn with no move in it', () => {
  it('passes', () => {
    const game = at([], [], 3);
    expect(passTurn(game)).toBe(true);
    expect(game.seat).toBe('p2');
  });

  it('refuses to pass a turn that has a move in it', () => {
    // Otherwise a player could skip a move they did not like.
    const game = at([4], [], 3);
    expect(passTurn(game)).toBe(false);
    expect(game.seat).toBe('p1');
  });

  it('refuses to pass before a roll', () => {
    const game = at([], []);
    expect(passTurn(game)).toBe(false);
  });
});

describe('the die', () => {
  it('rolls in range', () => {
    const rng = new Rng(11);
    const game = createGame();
    for (let i = 0; i < 300; i += 1) {
      game.phase = 'rolling';
      const value = roll(game, rng);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(DIE_FACES);
    }
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const rng = new Rng(23);
      const game = createGame();
      const out: number[] = [];
      for (let i = 0; i < 40; i += 1) {
        game.phase = 'rolling';
        out.push(roll(game, rng));
      }
      return out.join(',');
    };
    expect(trace()).toBe(trace());
  });

  it('refuses to roll twice in a turn', () => {
    const game = createGame();
    roll(game, new Rng(5));
    expect(roll(game, new Rng(7)), 'the hand is already rolled').toBe(0);
  });
});

describe('the bot', () => {
  const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('only ever names a token it may move', () => {
    for (const difficulty of DIFFICULTIES) {
      const rng = new Rng(31);
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const game = at([AT_START, 4, HOME], [], 1 + (attempt % DIE_FACES));
        const token = botMove(game, rng, difficulty);
        if (token < 0) continue;
        expect(canMove(game, 'p1', token, game.die), `${difficulty} named an illegal token`).toBe(
          true,
        );
      }
    }
  });

  it('returns nothing when it is stuck', () => {
    const game = at([], [], 3);
    expect(botMove(game, new Rng(3), 'hard')).toBe(-1);
  });

  it('takes the win when it is there', () => {
    const game = at([2, HOME - 3], [], 3);
    expect(botMove(game, new Rng(5), 'hard'), 'the token that goes home').toBe(1);
  });

  it('takes the win over a capture, which is the only time the two conflict', () => {
    // Going home is worth more than anything else on the board, and it has to be said
    // explicitly: a capture scores 300 plus how far the victim had come, which can beat a
    // home move scored on distance alone. Without the special case the bot takes the
    // capture and declines to win the game.
    //
    // Token 0 goes home with a 2. Token 1 lands on a p2 token with the same 2.
    const theirProgress = (22 - ENTRY.p2 + TRACK) % TRACK;
    const game = at([HOME - 2, 20], [theirProgress], 2);
    expect(loopSquare('p1', 22), 'the two do meet on square 22').toBe(
      loopSquare('p2', theirProgress),
    );
    expect(botMove(game, new Rng(11), 'hard'), 'it goes home rather than taking one').toBe(0);
  });

  it('takes a capture over a longer walk', () => {
    const theirProgress = (6 - ENTRY.p2 + TRACK) % TRACK;
    const game = at([4, 20], [theirProgress], 2);
    expect(botMove(game, new Rng(7), 'hard'), 'the one that lands on them').toBe(0);
  });

  it('does not go looking for captures on easy', () => {
    expect(BOT_PROFILES.easy.capturesGladly).toBe(false);
    expect(BOT_PROFILES.normal.capturesGladly).toBe(true);
  });

  it('can see a threatened square, even though it does not act on one', () => {
    // `isThreatened(game, seat, square)` asks whether *seat's opponent* could land there.
    // Put one p2 token on the loop and check what it can and cannot reach.
    const q = 5;
    const game = at([], [q]);
    expect(isThreatened(game, 'p1', loopSquare('p2', q + 3)), 'three ahead is in range').toBe(true);
    expect(isThreatened(game, 'p1', loopSquare('p2', q + 6)), 'six ahead is in range').toBe(true);
    expect(isThreatened(game, 'p1', loopSquare('p2', q + 7)), 'seven is not').toBe(false);
    expect(isThreatened(game, 'p1', loopSquare('p2', q)), 'the square it is on is not').toBe(false);
    expect(isThreatened(game, 'p1', -1), 'and nowhere is not a square').toBe(false);
  });

  it('ignores that threat on purpose, which is the measured call', () => {
    // Avoiding capture is the main skill in ordinary Ludo and is not a skill in *this*
    // game: winning means getting one token home, so being sent back costs one of three
    // tokens rather than the race. Wiring it into the hard tier changed the chosen move on
    // almost every unforced turn and moved the win rate by −0.2 points against `easy` and
    // −0.7 against `normal`. Measured, then taken out rather than kept as decoration.
    //
    // Two moves: one lands on a square p2 can reach, the other is a shorter walk that is
    // safe. The bot takes the longer walk, because distance is what wins this game.
    const game = at([10, 2], [((14 - ENTRY.p2 + TRACK) % TRACK) - 3], 4);
    expect(botMove(game, new Rng(3), 'hard'), 'the token that has come furthest').toBe(0);
  });

  it('blunders more often the easier it is', () => {
    expect(BOT_PROFILES.easy.blunder).toBeGreaterThan(BOT_PROFILES.normal.blunder);
    expect(BOT_PROFILES.normal.blunder).toBeGreaterThan(BOT_PROFILES.hard.blunder);
    expect(BOT_PROFILES.hard.blunder).toBe(0);
  });

  it('wins more often the harder it is', () => {
    const play = (a: BotDifficulty, b: BotDifficulty): number => {
      let aWins = 0;
      const games = 200;
      for (let seed = 0; seed < games; seed += 1) {
        const game = createGame();
        const rng = new Rng(seed * 7919 + 13);
        for (let turn = 0; turn < 4000 && game.winner === null; turn += 1) {
          roll(game, rng);
          const difficulty = game.seat === 'p1' ? a : b;
          const token = botMove(game, rng, difficulty);
          if (token < 0) passTurn(game);
          else move(game, token);
        }
        if (game.winner === 'p1') aWins += 1;
      }
      return aWins / games;
    };
    const hardOverEasy = play('hard', 'easy');
    const normalOverEasy = play('normal', 'easy');
    expect(hardOverEasy, `hard took ${String(hardOverEasy)} against easy`).toBeGreaterThan(0.5);
    expect(normalOverEasy, `normal took ${String(normalOverEasy)}`).toBeGreaterThan(0.5);
    expect(hardOverEasy).toBeGreaterThan(normalOverEasy);
  });

  it('always finishes a match', () => {
    // Two players who can only move on a six could in principle roll for ever.
    for (const difficulty of DIFFICULTIES) {
      const game = createGame();
      const rng = new Rng(97);
      let turns = 0;
      for (; turns < 20_000 && game.winner === null; turns += 1) {
        roll(game, rng);
        const token = botMove(game, rng, difficulty);
        if (token < 0) passTurn(game);
        else move(game, token);
      }
      expect(game.winner, `${difficulty} never finished`).not.toBeNull();
    }
  });
});

describe('seats', () => {
  it('has two', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(tokensOf(createGame(), 'p2').length).toBe(TOKENS);
  });
});
