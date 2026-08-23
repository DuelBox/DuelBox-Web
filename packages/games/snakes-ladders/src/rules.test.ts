import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_PROFILES,
  COLUMNS,
  DICE,
  DIE_FACES,
  FIELDS,
  LADDERS,
  MAX_TURNS_PER_SEAT,
  ROWS,
  SNAKES,
  SNAKE_BUDGET,
  START,
  WIN_CONDITION,
  boardColumn,
  boardRow,
  botDie,
  chooseDie,
  createPosition,
  destinationFor,
  dieAt,
  endTurn,
  fieldOf,
  hasBitten,
  kindFor,
  ladderAt,
  landingFor,
  otherOf,
  outlook,
  progressOf,
  resetPosition,
  roll,
  scoreDie,
  settle,
  settleKind,
  snakeAt,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Position } from './rules.js';

/** Put a position in a chosen state without going through a turn to get there. */
function place(seat: SeatId, field: number, dice: readonly number[], bitten = 0): Position {
  const position = createPosition();
  position.seat = seat;
  if (seat === 'p1') {
    position.p1 = field;
    position.p1Bitten = bitten;
  } else {
    position.p2 = field;
    position.p2Bitten = bitten;
  }
  for (let i = 0; i < DICE; i += 1) position.dice[i] = dice[i] ?? 1;
  position.phase = 'choosing';
  return position;
}

interface MatchResult {
  readonly winner: SeatId | 'draw' | null;
  readonly turns: number;
}

/** One whole match through the rules alone: no renderer, no clock, no delays. */
function playMatch(seed: number, p1: BotDifficulty, p2: BotDifficulty): MatchResult {
  const rng = new Rng(seed);
  const position = createPosition();
  let turns = 0;
  while (position.phase !== 'over' && turns < 4000) {
    turns += 1;
    roll(position, rng);
    const index = botDie(position, rng, position.seat === 'p1' ? p1 : p2);
    chooseDie(position, index);
    endTurn(position);
  }
  return { winner: winnerOf(position), turns };
}

function winRate(p1: BotDifficulty, p2: BotDifficulty, matches: number): number {
  let wins = 0;
  for (let seed = 1; seed <= matches; seed += 1) {
    if (playMatch(seed * 7919, p1, p2).winner === 'p1') wins += 1;
  }
  return wins / matches;
}

describe('the board', () => {
  it('is eight rows of eight, numbered from one', () => {
    expect(COLUMNS).toBe(8);
    expect(ROWS).toBe(8);
    expect(FIELDS).toBe(64);
    expect(START).toBe(0);
  });

  it('starts at the bottom left and finishes at the top left', () => {
    // A boustrophedon: the bottom row runs right, every row after it doubles back, and the
    // last field therefore sits above the first rather than diagonally across from it.
    expect(boardColumn(1)).toBe(0);
    expect(boardRow(1)).toBe(0);
    expect(boardColumn(FIELDS)).toBe(0);
    expect(boardRow(FIELDS)).toBe(ROWS - 1);
  });

  it('turns the direction of travel at the end of every row', () => {
    expect(boardColumn(8)).toBe(COLUMNS - 1);
    expect(boardColumn(9)).toBe(COLUMNS - 1);
    expect(boardColumn(16)).toBe(0);
    expect(boardColumn(17)).toBe(0);
  });

  it('gives every field its own square', () => {
    const seen = new Set<string>();
    for (let field = 1; field <= FIELDS; field += 1) {
      seen.add(`${String(boardColumn(field))},${String(boardRow(field))}`);
    }
    expect(seen.size).toBe(FIELDS);
  });

  it('keeps a field off the edge of the grid however it is asked', () => {
    for (const field of [-5, 0, FIELDS + 1, FIELDS + 40]) {
      expect(boardColumn(field)).toBeGreaterThanOrEqual(0);
      expect(boardColumn(field)).toBeLessThan(COLUMNS);
      expect(boardRow(field)).toBeGreaterThanOrEqual(0);
      expect(boardRow(field)).toBeLessThan(ROWS);
    }
  });
});

describe('the snakes and the ladders', () => {
  it.each(LADDERS.map((ladder) => [ladder.from, ladder.to]))(
    'ladder %i climbs to %i',
    (from, to) => {
      expect(to).toBeGreaterThan(from);
      expect(settle(from, 0)).toBe(to);
      expect(settleKind(from, 0)).toBe('ladder');
    },
  );

  it.each(SNAKES.map((snake) => [snake.from, snake.to]))('snake %i drops to %i', (from, to) => {
    expect(to).toBeLessThan(from);
    expect(settle(from, 0)).toBe(to);
    expect(settleKind(from, 0)).toBe('snake');
  });

  it('never puts a snake head and a ladder foot on the same field', () => {
    for (const ladder of LADDERS) expect(snakeAt(ladder.from)).toBe(-1);
    for (const snake of SNAKES) expect(ladderAt(snake.from)).toBe(-1);
  });

  it('never lands one jump on the mouth of another', () => {
    // A chain would make a single roll fire twice, and a chain that came back on itself
    // would make it fire for ever. Forbidding it outright is cheaper than resolving it.
    for (const jump of [...LADDERS, ...SNAKES]) {
      expect(ladderAt(jump.to), `${String(jump.from)} lands on a ladder`).toBe(-1);
      expect(snakeAt(jump.to), `${String(jump.from)} lands on a snake`).toBe(-1);
    }
  });

  it('leaves the last field unguarded', () => {
    expect(snakeAt(FIELDS)).toBe(-1);
    expect(ladderAt(FIELDS)).toBe(-1);
  });

  it('gives every jump its own starting field', () => {
    const sources = [...LADDERS, ...SNAKES].map((jump) => jump.from);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it('finds a jump only where there is one', () => {
    let plain = 0;
    for (let field = 1; field <= FIELDS; field += 1) {
      if (ladderAt(field) < 0 && snakeAt(field) < 0) plain += 1;
    }
    expect(plain).toBe(FIELDS - LADDERS.length - SNAKES.length);
  });

  it('answers for a field that is not on the board at all', () => {
    expect(ladderAt(-3)).toBe(-1);
    expect(snakeAt(FIELDS + 9)).toBe(-1);
  });

  it('leaves a plain field alone', () => {
    expect(settle(2, 0)).toBe(2);
    expect(settleKind(2, 0)).toBe('none');
  });

  it('settles anything past the end on the end', () => {
    // Reaching **or passing** the last field wins, which is the observed rule and also the
    // first thing that keeps a match short: there is no bouncing back off the finish.
    expect(settle(FIELDS, 0)).toBe(FIELDS);
    expect(settle(FIELDS + 5, 0)).toBe(FIELDS);
    expect(settleKind(FIELDS + 5, 0)).toBe('none');
  });
});

describe('the dice', () => {
  it('rolls two of them, both from the seeded stream', () => {
    const position = createPosition();
    expect(roll(position, new Rng(1))).toBe(true);
    expect(position.dice).toHaveLength(DICE);
    for (const die of position.dice) {
      expect(die).toBeGreaterThanOrEqual(1);
      expect(die).toBeLessThanOrEqual(DIE_FACES);
    }
    expect(position.phase).toBe('choosing');
  });

  it('replays the same faces from the same seed', () => {
    const faces = (seed: number): string => {
      const rng = new Rng(seed);
      const position = createPosition();
      const out: number[] = [];
      for (let turn = 0; turn < 40; turn += 1) {
        position.phase = 'rolling';
        roll(position, rng);
        out.push(...position.dice);
      }
      return out.join(',');
    };
    expect(faces(4242)).toBe(faces(4242));
    expect(faces(4242)).not.toBe(faces(4243));
  });

  it('rolls every face over enough turns', () => {
    const rng = new Rng(99);
    const position = createPosition();
    const seen = new Set<number>();
    for (let turn = 0; turn < 200; turn += 1) {
      position.phase = 'rolling';
      roll(position, rng);
      for (const die of position.dice) seen.add(die);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rolls the six faces about equally often', () => {
    const rng = new Rng(2026);
    const position = createPosition();
    const counts = new Array<number>(DIE_FACES + 1).fill(0);
    const rolls = 12_000;
    for (let turn = 0; turn < rolls; turn += 1) {
      position.phase = 'rolling';
      roll(position, rng);
      for (const die of position.dice) counts[die] = (counts[die] ?? 0) + 1;
    }
    const expected = (rolls * DICE) / DIE_FACES;
    for (let face = 1; face <= DIE_FACES; face += 1) {
      expect(counts[face] ?? 0).toBeGreaterThan(expected * 0.9);
      expect(counts[face] ?? 0).toBeLessThan(expected * 1.1);
    }
  });

  it('refuses to roll when it is not the moment to', () => {
    const position = place('p1', 4, [2, 5]);
    expect(roll(position, new Rng(3))).toBe(false);
    expect(position.dice[0]).toBe(2);
  });

  it('reads a die that is not there as nothing', () => {
    const position = createPosition();
    expect(dieAt(position, 0)).toBe(0);
    expect(dieAt(position, 9)).toBe(0);
  });
});

describe('taking a turn', () => {
  it('moves by whichever die was chosen', () => {
    const position = place('p1', 10, [2, 5]);
    expect(chooseDie(position, 1)).toBe(true);
    expect(position.p1).toBe(15);
    expect(position.usedDie).toBe(1);
    expect(position.phase).toBe('resolving');
  });

  it('moves the seat that is to play, and only that one', () => {
    const position = place('p2', 10, [3, 3]);
    chooseDie(position, 0);
    expect(position.p2).toBe(13);
    expect(position.p1).toBe(START);
  });

  it('refuses an index that is not a die', () => {
    const position = place('p1', 10, [2, 5]);
    expect(chooseDie(position, -1)).toBe(false);
    expect(chooseDie(position, DICE)).toBe(false);
    expect(chooseDie(position, 1.5)).toBe(false);
    expect(position.p1).toBe(10);
  });

  it('refuses a move before the dice have been rolled', () => {
    const position = createPosition();
    expect(chooseDie(position, 0)).toBe(false);
    expect(position.phase).toBe('rolling');
  });

  it('climbs when the chosen die lands on a ladder', () => {
    const position = place('p1', 1, [2, 4]);
    chooseDie(position, 0);
    expect(position.p1).toBe(19);
    expect(position.lastKind).toBe('ladder');
    expect(position.lastLanding).toBe(3);
    expect(position.lastTo).toBe(19);
  });

  it('slides when the chosen die lands on a snake', () => {
    const position = place('p1', 19, [2, 1]);
    chooseDie(position, 0);
    expect(position.p1).toBe(6);
    expect(position.lastKind).toBe('snake');
    expect(position.lastFrom).toBe(19);
  });

  it('hands the board over once the slide has been seen', () => {
    const position = place('p1', 10, [2, 5]);
    chooseDie(position, 0);
    expect(position.seat, 'still yours while it is being shown').toBe('p1');
    expect(endTurn(position)).toBe(true);
    expect(position.seat).toBe('p2');
    expect(position.phase).toBe('rolling');
  });

  it('clears the dice at the end of a turn', () => {
    const position = place('p1', 10, [2, 5]);
    chooseDie(position, 0);
    endTurn(position);
    expect(position.dice).toEqual([0, 0]);
    expect(position.usedDie).toBe(-1);
    expect(position.lastKind).toBe('none');
  });

  it('refuses to change hands at any other moment', () => {
    const position = createPosition();
    expect(endTurn(position)).toBe(false);
    position.phase = 'choosing';
    expect(endTurn(position)).toBe(false);
    expect(position.seat).toBe('p1');
  });

  it('alternates the seats turn after turn', () => {
    const rng = new Rng(11);
    const position = createPosition();
    const seats: SeatId[] = [];
    for (let turn = 0; turn < 6; turn += 1) {
      seats.push(position.seat);
      roll(position, rng);
      chooseDie(position, 0);
      endTurn(position);
    }
    expect(seats).toEqual(['p1', 'p2', 'p1', 'p2', 'p1', 'p2']);
  });

  it('says in advance exactly what each die would do', () => {
    const position = place('p1', 1, [2, 4]);
    expect(landingFor(position, 'p1', 0)).toBe(3);
    expect(destinationFor(position, 'p1', 0)).toBe(19);
    expect(kindFor(position, 'p1', 0)).toBe('ladder');
    expect(landingFor(position, 'p1', 1)).toBe(5);
    expect(destinationFor(position, 'p1', 1)).toBe(5);
    expect(kindFor(position, 'p1', 1)).toBe('none');
  });

  it('reads a preview of an unrolled die as standing still', () => {
    const position = createPosition();
    expect(landingFor(position, 'p1', 0)).toBe(START);
    expect(destinationFor(position, 'p1', 0)).toBe(START);
    expect(kindFor(position, 'p1', 0)).toBe('none');
  });

  it('previews the same move it then makes', () => {
    const rng = new Rng(77);
    const position = createPosition();
    for (let turn = 0; turn < 60 && position.phase !== 'over'; turn += 1) {
      roll(position, rng);
      const seat = position.seat;
      const index = turn % DICE;
      const predicted = destinationFor(position, seat, index);
      chooseDie(position, index);
      expect(fieldOf(position, seat)).toBe(predicted);
      endTurn(position);
    }
  });

  it('reports progress as the field a seat stands on', () => {
    const position = place('p1', 33, [1, 1]);
    expect(progressOf(position, 'p1')).toBe(33);
    expect(progressOf(position, 'p2')).toBe(START);
  });

  it('names the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

describe('a snake that has already eaten', () => {
  it('bites once and is then spent for that player', () => {
    const position = place('p1', 19, [2, 2]);
    chooseDie(position, 0);
    expect(position.p1).toBe(6);
    expect(hasBitten(position, 'p1', snakeAt(21))).toBe(true);

    // Back up to the same head: the snake is full, so the token simply stands on it.
    endTurn(position);
    position.seat = 'p1';
    position.p1 = 19;
    position.phase = 'choosing';
    position.dice[0] = 2;
    chooseDie(position, 0);
    expect(position.p1).toBe(21);
    expect(position.lastKind).toBe('spent');
  });

  it('is spent for one player only', () => {
    const position = place('p1', 19, [2, 2]);
    chooseDie(position, 0);
    expect(hasBitten(position, 'p1', snakeAt(21))).toBe(true);
    expect(hasBitten(position, 'p2', snakeAt(21))).toBe(false);
    expect(settle(21, position.p2Bitten)).toBe(6);
  });

  it('counts each snake on its own', () => {
    const position = createPosition();
    position.p1Bitten = 1 << 0;
    expect(hasBitten(position, 'p1', 0)).toBe(true);
    expect(hasBitten(position, 'p1', 1)).toBe(false);
    expect(settle(SNAKES[0]?.from ?? 0, position.p1Bitten)).toBe(SNAKES[0]?.from);
    expect(settle(SNAKES[1]?.from ?? 0, position.p1Bitten)).toBe(SNAKES[1]?.to);
  });

  it('answers for a snake that does not exist', () => {
    const position = createPosition();
    expect(hasBitten(position, 'p1', -1)).toBe(false);
    expect(hasBitten(position, 'p1', SNAKES.length)).toBe(false);
  });

  it.each(SNAKES.map((snake, index) => [snake.from, index]))(
    'snake at %i stops biting after it has fed',
    (from, index) => {
      expect(settleKind(from, 0)).toBe('snake');
      expect(settleKind(from, 1 << index)).toBe('spent');
      expect(settle(from, 1 << index)).toBe(from);
    },
  );
});

describe('winning', () => {
  it('is decided by the SDK first-to condition, not by hand', () => {
    expect(WIN_CONDITION).toEqual({ kind: 'first-to', target: FIELDS });
  });

  it('wins on landing exactly on the last field', () => {
    const position = place('p1', FIELDS - 3, [3, 1]);
    chooseDie(position, 0);
    expect(position.p1).toBe(FIELDS);
    expect(position.winner).toBe('p1');
    expect(position.phase).toBe('over');
    expect(winnerOf(position)).toBe('p1');
  });

  it('wins on passing it, with no bouncing back', () => {
    const position = place('p1', FIELDS - 1, [6, 6]);
    chooseDie(position, 0);
    expect(position.p1).toBe(FIELDS);
    expect(winnerOf(position)).toBe('p1');
  });

  it('lets the second seat win too', () => {
    const position = place('p2', FIELDS - 2, [4, 4]);
    chooseDie(position, 0);
    expect(winnerOf(position)).toBe('p2');
  });

  it('has no winner while both are short of the end', () => {
    const position = place('p1', FIELDS - 8, [1, 1]);
    expect(winnerOf(position)).toBeNull();
  });

  it('stops accepting moves once it is over', () => {
    const position = place('p1', FIELDS - 1, [6, 6]);
    chooseDie(position, 0);
    expect(chooseDie(position, 1)).toBe(false);
    expect(endTurn(position)).toBe(false);
    expect(position.seat).toBe('p1');
  });

  it('comes back to the start when reset', () => {
    const position = place('p1', 40, [3, 4], 0b101);
    chooseDie(position, 0);
    resetPosition(position);
    expect(position.p1).toBe(START);
    expect(position.p2).toBe(START);
    expect(position.p1Bitten).toBe(0);
    expect(position.p2Bitten).toBe(0);
    expect(position.seat).toBe('p1');
    expect(position.phase).toBe('rolling');
    expect(position.winner).toBeNull();
    expect(winnerOf(position)).toBeNull();
  });
});

describe('the match always ends', () => {
  it('adds up the snake budget from the board itself', () => {
    let total = 0;
    for (const snake of SNAKES) total += snake.from - snake.to;
    expect(SNAKE_BUDGET).toBe(total);
    expect(MAX_TURNS_PER_SEAT).toBe(FIELDS + SNAKE_BUDGET);
  });

  it('finishes even if every die is a one for ever', () => {
    // The worst case a person could contrive, and the whole reason a snake only bites once:
    // moving a single field a turn, a player still walks off every snake head permanently
    // and reaches the end. With snakes that bite for ever this loop does not terminate.
    const position = createPosition();
    let turns = 0;
    while (position.phase !== 'over') {
      turns += 1;
      expect(turns, 'past the bound the snake rule sets').toBeLessThanOrEqual(MAX_TURNS_PER_SEAT);
      position.phase = 'choosing';
      position.dice[0] = 1;
      position.dice[1] = 1;
      chooseDie(position, 0);
      // Refused outright once the match is over, so it needs no guard of its own.
      endTurn(position);
      // One player walking alone, so the seat is handed straight back.
      position.seat = 'p1';
    }
    expect(position.p1).toBe(FIELDS);
    expect(turns).toBeLessThanOrEqual(MAX_TURNS_PER_SEAT);
  });

  it('never lets a player fall further behind than the budget allows', () => {
    const rng = new Rng(31337);
    const position = createPosition();
    let turns = 0;
    while (position.phase !== 'over' && turns < 4000) {
      turns += 1;
      roll(position, rng);
      const seat = position.seat;
      chooseDie(position, rng.int(0, DICE));
      // Position after T turns is at least T - SNAKE_BUDGET, whatever the dice did.
      const taken = Math.ceil(turns / 2);
      expect(fieldOf(position, seat)).toBeGreaterThanOrEqual(taken - SNAKE_BUDGET);
      endTurn(position);
    }
    expect(position.phase).toBe('over');
  });

  it('finishes every pairing of tiers, from many seeds, well inside the bound', () => {
    const tiers: BotDifficulty[] = ['easy', 'normal', 'hard'];
    let longest = 0;
    for (const p1 of tiers) {
      for (const p2 of tiers) {
        for (let seed = 1; seed <= 30; seed += 1) {
          const result = playMatch(seed * 613, p1, p2);
          expect(result.winner, `${p1} v ${p2} seed ${String(seed)}`).not.toBeNull();
          longest = Math.max(longest, result.turns);
        }
      }
    }
    // Measured, not guessed: the longest of these 270 matches was 54 turns in total. The
    // proved bound is 166 turns a seat, which is three times as much slack again.
    expect(longest).toBeLessThan(90);
  });
});

describe('the bot', () => {
  it('has nothing to say before the dice are rolled', () => {
    const position = createPosition();
    expect(botDie(position, new Rng(5), 'hard')).toBe(-1);
  });

  it('never touches the position while it is thinking', () => {
    const position = place('p1', 12, [3, 5]);
    const before = JSON.stringify(position);
    botDie(position, new Rng(9), 'hard');
    expect(JSON.stringify(position)).toBe(before);
  });

  it('always answers with one of the two dice', () => {
    const rng = new Rng(123);
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      for (let i = 0; i < 200; i += 1) {
        const position = place('p1', rng.int(0, FIELDS), [rng.int(1, 7), rng.int(1, 7)]);
        const index = botDie(position, rng, tier);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(DICE);
      }
    }
  });

  it('takes the ladder rather than the longer plain move', () => {
    // From 1: a two is the foot of the ladder at 3, a six is a plain 7. The plain move is
    // further along the track and much worse, which is the whole point of reading the board.
    const position = place('p1', 1, [2, 6]);
    expect(scoreDie(position, 'p1', 0, 0)).toBeGreaterThan(scoreDie(position, 'p1', 1, 0));
    expect(botDie(position, new Rng(1), 'hard')).toBe(0);
  });

  it('declines the snake even though it is the bigger number', () => {
    const position = place('p1', 19, [1, 2]);
    expect(destinationFor(position, 'p1', 0)).toBe(20);
    expect(destinationFor(position, 'p1', 1)).toBe(6);
    expect(botDie(position, new Rng(1), 'hard')).toBe(0);
  });

  it('walks onto a snake that is already spent without flinching', () => {
    const spent = 1 << snakeAt(21);
    const position = place('p1', 19, [1, 2], spent);
    expect(destinationFor(position, 'p1', 1)).toBe(21);
    expect(botDie(position, new Rng(1), 'hard')).toBe(1);
  });

  it('nothing outbids a move that finishes the match', () => {
    const position = place('p1', FIELDS - 2, [2, 1]);
    expect(scoreDie(position, 'p1', 0, 0.7)).toBeGreaterThan(scoreDie(position, 'p1', 1, 0.7));
    expect(botDie(position, new Rng(1), 'hard')).toBe(0);
  });

  it('rates a field below a ladder above a field below a snake', () => {
    // 43 is one short of the ladder at 44; 46 is one short of the snake at 47. Both are
    // plain squares, so only the square ahead separates them — which is what foresight is.
    expect(outlook(43, 0)).toBeGreaterThan(outlook(46, 0));
  });

  it('stops fearing a snake it has already been down', () => {
    const spent = 1 << snakeAt(47);
    expect(outlook(46, spent)).toBeGreaterThan(outlook(46, 0));
  });

  it('rates the end of the board as the end of the board', () => {
    expect(outlook(FIELDS, 0)).toBe(FIELDS);
    expect(outlook(FIELDS + 3, 0)).toBe(FIELDS);
  });

  it('only the hard tier looks past the square it lands on', () => {
    expect(BOT_PROFILES.easy.foresight).toBe(0);
    expect(BOT_PROFILES.normal.foresight).toBe(0);
    expect(BOT_PROFILES.hard.foresight).toBeGreaterThan(0);
    expect(BOT_PROFILES.easy.blunder).toBeGreaterThan(BOT_PROFILES.normal.blunder);
    expect(BOT_PROFILES.normal.blunder).toBeGreaterThan(BOT_PROFILES.hard.blunder);
  });

  it('takes the die a careful player would, far more often on hard than on easy', () => {
    // Agreement with the best immediate move, over the same thousand positions. This is the
    // difficulty made visible as a *decision* rate rather than as a win rate, so a change to
    // the board cannot quietly flatten the tiers while the win rates still look plausible.
    const agreement = (tier: BotDifficulty): number => {
      const rng = new Rng(4004);
      const bot = new Rng(9009);
      let agreed = 0;
      let counted = 0;
      for (let i = 0; i < 1000; i += 1) {
        const dice = [rng.int(1, 7), rng.int(1, 7)];
        const position = place('p1', rng.int(0, FIELDS - 6), dice);
        const one = destinationFor(position, 'p1', 0);
        const two = destinationFor(position, 'p1', 1);
        if (one === two) continue;
        counted += 1;
        const best = one > two ? 0 : 1;
        if (botDie(position, bot, tier) === best) agreed += 1;
      }
      return agreed / counted;
    };
    const easy = agreement('easy');
    const normal = agreement('normal');
    const hard = agreement('hard');
    expect(easy).toBeLessThan(0.75);
    expect(normal).toBeGreaterThan(easy + 0.1);
    expect(hard).toBeGreaterThan(0.9);
  });

  it('beats the weaker tier over enough matches to mean something', () => {
    // 240 matches a pairing. A dice race cannot be dominated the way a search game can, so
    // the numbers to expect are modest — the ordering is what matters, and it is stable.
    const hardVersusEasy = winRate('hard', 'easy', 240);
    const normalVersusEasy = winRate('normal', 'easy', 240);
    const hardVersusNormal = winRate('hard', 'normal', 240);
    expect(hardVersusEasy).toBeGreaterThan(0.75);
    expect(normalVersusEasy).toBeGreaterThan(0.7);
    expect(hardVersusNormal).toBeGreaterThan(0.58);
    expect(hardVersusEasy).toBeGreaterThan(hardVersusNormal);
  });

  it('leaves the seat that rolls first a small edge, and no more', () => {
    // A race decided in about nine turns a side is won by whoever gets there first, so the
    // seat that opens has an edge that no amount of skill removes. Measured rather than
    // assumed: 51.2% at easy, 53.5% at normal, 55.0% at hard over 400 matches a pairing.
    // It grows with skill because better play shortens the race. It is the same order as
    // moving first in Checkers, and it is small next to the 84.5% a hard tier takes off an
    // easy one — so the tiers, not the seat order, are what decides a match.
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const mirror = winRate(tier, tier, 240);
      expect(mirror, `${tier} against itself`).toBeGreaterThan(0.45);
      expect(mirror, `${tier} against itself`).toBeLessThan(0.62);
    }
  });
});
