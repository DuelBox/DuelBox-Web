import { describe, expect, it } from 'vitest';
import { Rng, otherSeat } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  ALL_LIVE,
  ARITY,
  ATTRIBUTES,
  BOT_PROFILES,
  CAST,
  CAST_ROWS,
  COLUMNS,
  DEALS,
  DEALS_TO_WIN,
  MAX_EFFORT,
  QUESTIONS,
  SLOTS,
  applyAction,
  attributeOfQuestion,
  boardOf,
  characterAt,
  chooseAction,
  chooseWithProfile,
  countBits,
  createAction,
  createMatch,
  dealAgain,
  dealWinner,
  dealsWon,
  effortOf,
  endTurn,
  isLive,
  legalQuestions,
  nthSetBit,
  openerOfDeal,
  playName,
  playQuestion,
  questionMask,
  questionOf,
  resetMatch,
  ruledOut,
  splitsQuestion,
  standing,
  targetOf,
  tileOf,
  valueOf,
  valueOfQuestion,
  winnerOf,
} from './rules.js';
import type { Action, BotDifficulty, BotProfile, Match } from './rules.js';

const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

/* --------------------------------------------------------------- the cast */

describe('the cast', () => {
  it('is every combination of the attributes, exactly once', () => {
    const seen = new Set<string>();
    for (let character = 0; character < CAST; character += 1) {
      const digits: number[] = [];
      for (let attribute = 0; attribute < ATTRIBUTES; attribute += 1) {
        const value = valueOf(character, attribute);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(ARITY[attribute] as number);
        digits.push(value);
      }
      seen.add(digits.join('/'));
    }
    // Distinctness is the whole game: two characters with the same three answers could
    // never be told apart by any question, so a deal holding both would be unwinnable.
    expect(seen.size).toBe(CAST);
  });

  it('fills the lattice exactly, with no dead cells for a keyboard to walk through', () => {
    expect(ARITY.reduce((a, b) => a * b, 1)).toBe(CAST);
    expect(ARITY.reduce((a, b) => a + b, 0)).toBe(QUESTIONS);
    expect(CAST % COLUMNS).toBe(0);
    expect(QUESTIONS).toBe(COLUMNS);
    expect(SLOTS).toBe(CAST + QUESTIONS);
    expect(CAST_ROWS).toBe(CAST / COLUMNS);
  });

  it('is deliberately unequal, which is what makes a question a choice', () => {
    // A cast whose attributes all had the same arity would make every question split the
    // board identically, and question quality would be worth nothing. Measured: on a
    // 3x3x3 cast the bot's question knob moved its win rate by 0.0 points.
    const arities = new Set(ARITY);
    expect(arities.size).toBeGreaterThan(1);
    const widths = new Set<number>();
    for (let question = 0; question < QUESTIONS; question += 1) {
      widths.add(countBits(questionMask(question)));
    }
    expect([...widths].sort((a, b) => a - b)).toEqual([6, 10, 15]);
  });

  it('rounds a question trip through attribute and value', () => {
    for (let attribute = 0; attribute < ATTRIBUTES; attribute += 1) {
      for (let value = 0; value < (ARITY[attribute] as number); value += 1) {
        const question = questionOf(attribute, value);
        expect(attributeOfQuestion(question)).toBe(attribute);
        expect(valueOfQuestion(question)).toBe(value);
      }
    }
  });

  it('answers a question with exactly the characters carrying that value', () => {
    for (let question = 0; question < QUESTIONS; question += 1) {
      const attribute = attributeOfQuestion(question);
      const value = valueOfQuestion(question);
      for (let character = 0; character < CAST; character += 1) {
        const inMask = (questionMask(question) & (1 << character)) !== 0;
        expect(inMask).toBe(valueOf(character, attribute) === value);
      }
    }
  });
});

describe('the bit-set helpers', () => {
  it('counts and indexes bits', () => {
    expect(countBits(0)).toBe(0);
    expect(countBits(ALL_LIVE)).toBe(CAST);
    expect(countBits(0b1011)).toBe(3);
    expect(nthSetBit(0b1011, 0)).toBe(0);
    expect(nthSetBit(0b1011, 1)).toBe(1);
    expect(nthSetBit(0b1011, 2)).toBe(3);
    expect(nthSetBit(0b1011, 3)).toBe(-1);
  });
});

/* ------------------------------------------------------------- a fresh deal */

function fresh(seed: number, opener: SeatId = 'p1'): Match {
  return createMatch(new Rng(seed), opener);
}

describe('a fresh deal', () => {
  it('puts the whole cast on the board, live for both seats', () => {
    const match = fresh(11);
    expect(match.p1.liveCount).toBe(CAST);
    expect(match.p2.liveCount).toBe(CAST);
    expect(ruledOut(match.p1)).toBe(0);
    expect(new Set(match.tiles).size).toBe(CAST);
    expect(match.tiles.slice().sort((a, b) => a - b)).toEqual(
      Array.from({ length: CAST }, (_, i) => i),
    );
  });

  it('reads the opening seat the shell gives it', () => {
    for (const opener of ['p1', 'p2'] as SeatId[]) {
      const match = fresh(12, opener);
      expect(match.setOpener).toBe(opener);
      expect(match.opener).toBe(opener);
      expect(match.seat).toBe(opener);
    }
  });

  it('alternates the opener between deals', () => {
    expect(openerOfDeal('p1', 0)).toBe('p1');
    expect(openerOfDeal('p1', 1)).toBe('p2');
    expect(openerOfDeal('p1', 2)).toBe('p1');
    expect(openerOfDeal('p2', 1)).toBe('p1');
  });

  it('puts every character on exactly one tile', () => {
    const match = fresh(13);
    for (let character = 0; character < CAST; character += 1) {
      expect(characterAt(match, tileOf(match, character))).toBe(character);
    }
  });

  it('never draws a target that is not on the board', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const match = fresh(seed * 977 + 3);
      expect(match.targetP1).toBeGreaterThanOrEqual(0);
      expect(match.targetP1).toBeLessThan(CAST);
      expect(match.targetP2).toBeGreaterThanOrEqual(0);
      expect(match.targetP2).toBeLessThan(CAST);
    }
  });
});

/* -------------------------------------------------------------- the answers */

describe('a question', () => {
  it('is answered truthfully from the hidden character, and never any other way', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const match = fresh(seed * 131 + 7);
      const seat = match.seat;
      const target = targetOf(match, seat);
      const question = legalQuestionList(match, seat)[0] as number;
      expect(playQuestion(match, question)).toBe(true);
      const expected = valueOf(target, attributeOfQuestion(question)) === valueOfQuestion(question);
      expect(match.lastAnswer).toBe(expected);
      // And the target survives it. That invariant is what makes the last candidate
      // standing necessarily the right one.
      expect(isLive(boardOf(match, seat), target)).toBe(true);
    }
  });

  it('is refused unless it divides the asker board', () => {
    const match = fresh(21);
    const seat = match.seat;
    // Ask everything about one attribute until that attribute is settled, then every
    // question about it must be refused.
    const board = boardOf(match, seat);
    const attribute = 0;
    let asked = 0;
    while (settled(match, seat, attribute) === -1 && asked < 10) {
      const value = firstUnsettledValue(match, seat, attribute);
      match.seat = seat;
      match.half = 0;
      expect(playQuestion(match, questionOf(attribute, value))).toBe(true);
      asked += 1;
    }
    match.seat = seat;
    match.half = 0;
    for (let value = 0; value < (ARITY[attribute] as number); value += 1) {
      expect(splitsQuestion(board, questionOf(attribute, value))).toBe(false);
      expect(playQuestion(match, questionOf(attribute, value))).toBe(false);
    }
  });

  it('refuses a question that is not one', () => {
    const match = fresh(22);
    expect(playQuestion(match, -1)).toBe(false);
    expect(playQuestion(match, QUESTIONS)).toBe(false);
    expect(playQuestion(match, 1.5)).toBe(false);
    expect(match.lastKind).toBe('none');
  });

  it('strictly narrows the asking seat and touches nothing else', () => {
    for (let seed = 0; seed < 120; seed += 1) {
      const match = fresh(seed * 313 + 11);
      const seat = match.seat;
      const mine = boardOf(match, seat);
      const theirs = boardOf(match, otherSeat(seat));
      const before = mine.liveCount;
      const theirsBefore = theirs.live;
      playQuestion(match, legalQuestionList(match, seat)[0] as number);
      expect(mine.liveCount).toBeLessThan(before);
      expect(mine.liveCount).toBeGreaterThan(0);
      expect(theirs.live).toBe(theirsBefore);
    }
  });
});

describe('naming a character', () => {
  it('takes the deal when it is right', () => {
    const match = fresh(31);
    const seat = match.seat;
    expect(playName(match, targetOf(match, seat))).toBe(true);
    expect(match.lastAnswer).toBe(true);
    expect(seat === 'p1' ? match.solvedRoundP1 : match.solvedRoundP2).toBe(1);
  });

  it('strikes the character out when it is wrong, and costs the turn', () => {
    const match = fresh(32);
    const seat = match.seat;
    const wrong = (targetOf(match, seat) + 1) % CAST;
    const board = boardOf(match, seat);
    expect(playName(match, wrong)).toBe(true);
    expect(match.lastAnswer).toBe(false);
    expect(isLive(board, wrong)).toBe(false);
    expect(board.liveCount).toBe(CAST - 1);
    expect(match.seat).not.toBe(seat);
  });

  it('refuses a character already struck out, so a turn cannot be thrown away', () => {
    const match = fresh(33);
    const seat = match.seat;
    const wrong = (targetOf(match, seat) + 1) % CAST;
    playName(match, wrong);
    match.seat = seat;
    match.half = 0;
    expect(playName(match, wrong)).toBe(false);
    expect(playName(match, -1)).toBe(false);
    expect(playName(match, CAST)).toBe(false);
  });

  it('is the only legal move once one candidate is left, and it cannot be wrong', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const match = fresh(seed * 613 + 5);
      const seat = match.seat;
      const board = boardOf(match, seat);
      // Strike out everything but the target by hand.
      board.live = 1 << targetOf(match, seat);
      board.liveCount = 1;
      expect(legalQuestions(board)).toBe(0);
      const only = nthSetBit(board.live, 0);
      expect(playName(match, only)).toBe(true);
      expect(match.lastAnswer).toBe(true);
    }
  });
});

/* ------------------------------------------------------------- termination */

/**
 * The potential function, stated as a test.
 *
 * Every action a seat can take lowers its own live count, except the one that ends its
 * search. That is the whole termination argument and it is checked over random play
 * rather than argued in a comment.
 */
describe('termination', () => {
  it('lowers the acting seat live count on every action but the last', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const rng = new Rng(seed * 7919 + 13);
      const match = createMatch(rng, seed % 2 === 0 ? 'p1' : 'p2');
      const stream = new Rng(rng.next() | 0);
      const action = createAction();
      let guard = 0;
      while (!match.over) {
        const seat = match.seat;
        const board = boardOf(match, seat);
        const before = board.liveCount;
        chooseAction(action, board, stream, 'easy');
        expect(applyAction(match, action)).toBe(true);
        const solved = seat === 'p1' ? match.solvedRoundP1 >= 0 : match.solvedRoundP2 >= 0;
        if (solved) expect(board.liveCount).toBe(before);
        else expect(board.liveCount).toBeLessThan(before);
        guard += 1;
        // Twice CAST turns is the arithmetic bound, and nothing may reach it.
        expect(guard).toBeLessThan(2 * CAST + 2);
      }
    }
  });

  it('finishes a whole best-of-three between two easy bots, with no ceiling at all', () => {
    // Deliberately unbounded: a match that could not end would hang the suite rather than
    // pass quietly. The counter is only read afterwards.
    let worst = 0;
    for (let seed = 0; seed < 120; seed += 1) {
      const played = playSet(seed * 4409 + 1, seed % 2 === 0 ? 'p1' : 'p2', 'easy', 'easy');
      worst = Math.max(worst, played.turns);
      expect(played.match.setOver).toBe(true);
      expect(winnerOf(played.match)).not.toBeNull();
    }
    // The arithmetic ceiling is three deals of CAST rounds, two turns each.
    expect(worst).toBeLessThan(DEALS * CAST * 2);
  });

  it('bounds a seat effort by the triangular number, whatever it does', () => {
    for (let seed = 0; seed < 80; seed += 1) {
      const played = playSet(seed * 977 + 3, 'p1', 'easy', 'hard');
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        expect(effortOf(played.match, seat)).toBeLessThanOrEqual(MAX_EFFORT);
        expect(standing(played.match, seat)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

/* ------------------------------------------------------- the round structure */

describe('a deal ends on a completed round', () => {
  it('gives the other seat the turn it is owed after a correct name', () => {
    const match = fresh(41, 'p1');
    expect(playName(match, targetOf(match, 'p1'))).toBe(true);
    // Half a round in: p2 has not moved, so nothing is settled.
    expect(match.over).toBe(false);
    expect(match.seat).toBe('p2');
    expect(dealWinner(match)).toBeNull();
    expect(playQuestion(match, legalQuestionList(match, 'p2')[0] as number)).toBe(true);
    expect(match.over).toBe(true);
    expect(dealWinner(match)).toBe('p1');
  });

  it('lets both seats finish in the same round, and separates them on effort', () => {
    const match = fresh(42, 'p1');
    // Both name straight away, from the identical thirty candidates: level effort, so a
    // genuine draw rather than a win for whoever the code happened to look at first.
    expect(playName(match, targetOf(match, 'p1'))).toBe(true);
    expect(playName(match, targetOf(match, 'p2'))).toBe(true);
    expect(match.over).toBe(true);
    expect(match.effortP1).toBe(CAST);
    expect(match.effortP2).toBe(CAST);
    expect(dealWinner(match)).toBe('draw');
  });

  it('gives the deal to the seat that weighed fewer candidates', () => {
    const match = fresh(43, 'p1');
    // p1 asks first and then names; p2 names straight off. Same round, different effort.
    playQuestion(match, legalQuestionList(match, 'p1')[0] as number);
    playName(match, (targetOf(match, 'p2') + 1) % CAST);
    playName(match, targetOf(match, 'p1'));
    playName(match, targetOf(match, 'p2'));
    expect(match.over).toBe(true);
    expect(match.effortP1).toBeLessThan(match.effortP2);
    expect(dealWinner(match)).toBe('p1');
  });

  it('never lets one seat take more turns than the other', () => {
    for (let seed = 0; seed < 80; seed += 1) {
      const played = playSet(seed * 313 + 7, seed % 2 === 0 ? 'p1' : 'p2', 'hard', 'easy');
      expect(played.turnsBySeat.p1).toBe(played.turnsBySeat.p2);
    }
  });
});

describe('a match is best of three deals', () => {
  it('stops as soon as a seat holds two, and never runs past three', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const played = playSet(seed * 6421 + 11, 'p1', 'normal', 'easy');
      const match = played.match;
      expect(match.deal + 1).toBeLessThanOrEqual(DEALS);
      const best = Math.max(match.dealsWonP1, match.dealsWonP2);
      expect(best === DEALS_TO_WIN || match.deal + 1 === DEALS).toBe(true);
      expect(match.dealsWonP1 + match.dealsWonP2).toBeLessThanOrEqual(match.deal + 1);
    }
  });

  it('gives the match to the seat with more deals', () => {
    const played = playSet(51, 'p1', 'hard', 'easy');
    const { match } = played;
    if (match.dealsWonP1 !== match.dealsWonP2) {
      expect(winnerOf(match)).toBe(match.dealsWonP1 > match.dealsWonP2 ? 'p1' : 'p2');
    }
  });

  it('falls back on total effort only when the deals are level', () => {
    const match = fresh(52, 'p1');
    match.setOver = true;
    match.dealsWonP1 = 2;
    match.dealsWonP2 = 1;
    match.totalEffortP1 = 400;
    match.totalEffortP2 = 100;
    // More deals wins even against far better effort: deals are the high digits.
    expect(winnerOf(match)).toBe('p1');
    match.dealsWonP2 = 2;
    expect(winnerOf(match)).toBe('p2');
    match.totalEffortP2 = 400;
    expect(winnerOf(match)).toBe('draw');
  });

  it('reports nothing until the match is actually over', () => {
    const match = fresh(53, 'p1');
    expect(winnerOf(match)).toBeNull();
    playName(match, targetOf(match, 'p1'));
    playName(match, (targetOf(match, 'p2') + 1) % CAST);
    expect(match.over).toBe(true);
    expect(dealWinner(match)).toBe('p1');
    expect(winnerOf(match)).toBeNull();
  });

  it('lays a fresh cast out for every deal and carries the tally across', () => {
    const rng = new Rng(54);
    const match = createMatch(rng, 'p1');
    playName(match, targetOf(match, 'p1'));
    playName(match, (targetOf(match, 'p2') + 1) % CAST);
    const wonFirst = dealsWon(match, 'p1');
    expect(wonFirst).toBe(1);
    dealAgain(match, rng);
    expect(match.deal).toBe(1);
    expect(match.opener).toBe('p2');
    expect(match.p1.liveCount).toBe(CAST);
    expect(match.p2.liveCount).toBe(CAST);
    expect(dealsWon(match, 'p1')).toBe(1);
    expect(match.over).toBe(false);
  });

  it('refuses to deal again while a deal is still running', () => {
    const rng = new Rng(55);
    const match = createMatch(rng, 'p1');
    dealAgain(match, rng);
    expect(match.deal).toBe(0);
  });
});

/* --------------------------------------------------------- the seat symmetry */

/**
 * The mirror test, and it is the one that matters most here.
 *
 * This game has no spatial mirror to take: it is a discrete race between two seats. The
 * symmetry it does have is **exchange** — swap which seat opens and everything about the
 * match should swap with it, exactly, on every seed. Written before the bot was tuned,
 * because a seat bias that only shows up as a win rate is a bias nobody can bisect.
 *
 * It holds only because every draw is keyed to a role rather than to a seat: the cast
 * arrangement belongs to the table, the first target goes to whoever opens, and the bots
 * draw from a stream each by role. Break any one of those and this goes red on the same
 * commit.
 */
describe('the two seats are exchangeable', () => {
  function mirrorSeat(seat: SeatId | 'draw' | null): SeatId | 'draw' | null {
    if (seat === 'p1') return 'p2';
    if (seat === 'p2') return 'p1';
    return seat;
  }

  it('plays the exact mirror image when the opening seat is swapped', () => {
    for (const tiers of [
      ['easy', 'easy'],
      ['normal', 'normal'],
      ['hard', 'hard'],
      ['hard', 'easy'],
    ] as [BotDifficulty, BotDifficulty][]) {
      for (let seed = 0; seed < 60; seed += 1) {
        const key = seed * 7919 + 17;
        const a = playSet(key, 'p1', tiers[0], tiers[1]);
        const b = playSet(key, 'p2', tiers[0], tiers[1]);
        expect(b.turns).toBe(a.turns);
        expect(b.match.deal).toBe(a.match.deal);
        expect(b.match.dealsWonP1).toBe(a.match.dealsWonP2);
        expect(b.match.dealsWonP2).toBe(a.match.dealsWonP1);
        expect(b.match.totalEffortP1).toBe(a.match.totalEffortP2);
        expect(b.match.totalEffortP2).toBe(a.match.totalEffortP1);
        expect(b.match.targetP1).toBe(a.match.targetP2);
        expect(b.match.targetP2).toBe(a.match.targetP1);
        expect(winnerOf(b.match)).toBe(mirrorSeat(winnerOf(a.match)));
      }
    }
  });

  it('hands seat one exactly half of everything it decides', () => {
    let seatOne = 0;
    let decided = 0;
    for (const tier of TIERS) {
      for (let seed = 0; seed < 60; seed += 1) {
        const key = seed * 4409 + 23;
        for (const opener of ['p1', 'p2'] as SeatId[]) {
          const winner = winnerOf(playSet(key, opener, tier, tier).match);
          if (winner === 'draw' || winner === null) continue;
          decided += 1;
          if (winner === 'p1') seatOne += 1;
        }
      }
    }
    expect(decided).toBeGreaterThan(300);
    // Not "close to half": exactly half, because each seed is played once from each
    // opening seat and the two runs are exact mirrors of one another.
    expect(seatOne * 2).toBe(decided);
  });

  it('gives the opener no edge worth having, which is why the round is completed', () => {
    // The seat share above is exact; this one is a measurement and is treated as one.
    // The three tiers share a seed, so they share the deal and are **not** independent
    // samples of it — a hundred and twenty seeds put this at 42.8% across all three at
    // once, which looks like a finding and is one seed family being unlucky. Four hundred
    // well-spread seeds a tier put it at 49.75%, and six thousand at 49.1-50.6% per tier.
    let openerWins = 0;
    let decided = 0;
    for (const tier of TIERS) {
      for (let seed = 0; seed < 400; seed += 1) {
        for (const opener of ['p1', 'p2'] as SeatId[]) {
          const played = playSet(1000003 + seed * 7919, opener, tier, tier);
          const winner = winnerOf(played.match);
          if (winner === 'draw' || winner === null) continue;
          decided += 1;
          if (winner === opener) openerWins += 1;
        }
      }
    }
    const share = openerWins / decided;
    expect(decided).toBeGreaterThan(2000);
    expect(share).toBeGreaterThan(0.45);
    expect(share).toBeLessThan(0.55);
  });
});

/* ----------------------------------------------------------------- the bot */

describe('the bot', () => {
  it('never sees either character, and cannot: it is not passed one', () => {
    // Structural, the way Sudoku does it. `chooseAction` takes a board and one public
    // count, so scrambling the hidden state cannot reach it. This test exists to fail the
    // day somebody adds a parameter that could.
    for (const tier of TIERS) {
      const match = fresh(61);
      const action = createAction();
      const before = createAction();
      chooseAction(action, match.p1, new Rng(5), tier);
      Object.assign(before, action);

      for (let bump = 1; bump <= CAST; bump += 1) {
        match.targetP1 = (match.targetP1 + 1) % CAST;
        match.targetP2 = (match.targetP2 + 3) % CAST;
        chooseAction(action, match.p1, new Rng(5), tier);
        expect(action.kind, tier).toBe(before.kind);
        expect(action.question, tier).toBe(before.question);
        expect(action.character, tier).toBe(before.character);
      }
    }
  });

  it('is wrong when it names early, which is what not cheating looks like', () => {
    let named = 0;
    let hit = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const played = playSet(seed * 313 + 31, 'p1', 'hard', 'hard');
      named += played.names;
      hit += played.hits;
    }
    expect(named).toBeGreaterThan(200);
    // A bot reading the target would name once and be right every time.
    expect(hit / named).toBeLessThan(0.85);
    expect(hit / named).toBeGreaterThan(0.15);
  });

  it('only ever offers a move the rules accept', () => {
    for (const tier of TIERS) {
      for (let seed = 0; seed < 60; seed += 1) {
        const played = playSet(seed * 977 + 37, 'p1', tier, tier);
        expect(played.refused).toBe(0);
      }
    }
  });

  it('picks the question that leaves the smaller half smallest, on hard', () => {
    const match = fresh(62);
    const action = createAction();
    chooseAction(action, match.p1, new Rng(9), 'hard');
    expect(action.kind).toBe('ask');
    // From the full cast that is the two-valued attribute: fifteen against fifteen.
    expect(countBits(questionMask(action.question))).toBe(15);
  });

  it('plays a seat identically whoever it is up against', () => {
    // The per-role streams, checked the way Cup Pong checks them: seat two's play must
    // not become a function of how seat one is playing.
    let same = 0;
    for (let seed = 0; seed < 120; seed += 1) {
      const key = seed * 4409 + 41;
      const soft = playSet(key, 'p1', 'easy', 'normal');
      const hard = playSet(key, 'p1', 'hard', 'normal');
      // Compare the answering seat first deal only, since the deals it sees afterwards
      // depend on how long the earlier ones ran.
      if (soft.firstMoves.p2 === hard.firstMoves.p2) same += 1;
    }
    expect(same).toBe(120);
  });

  it('does not look at the other seat at all, because looking measured as worthless', () => {
    // `chase` bumped the naming threshold while the rival's board was no wider than this
    // one — the one thing the bot ever took from the other seat, and a legal thing to take
    // since both boards are drawn pip by pip for everybody. It swept monotone and it is
    // still gone: naming at five always measured 63.1% against a fixed reference, and
    // five-when-behind-three-when-ahead measured 62.6%. It was `gambleAt` spelled twice.
    //
    // What is left is a bot whose whole input is its own board, which is the strongest
    // form rule 6 can take.
    expect(chooseAction.length).toBe(4);
    const match = fresh(63);
    const action = createAction();
    const patient = createAction();
    match.p1.live = 0b1111;
    match.p1.liveCount = 4;
    chooseWithProfile(action, match.p1, new Rng(3), { blunder: 0, gambleAt: 4 });
    chooseWithProfile(patient, match.p1, new Rng(3), { blunder: 0, gambleAt: 2 });
    expect(action.kind).toBe('name');
    expect(patient.kind).toBe('ask');
  });

  it('runs the tiers in the order they are named', () => {
    const won: Record<string, number> = {};
    for (const [strong, weak] of [
      ['hard', 'normal'],
      ['hard', 'easy'],
      ['normal', 'easy'],
    ] as [BotDifficulty, BotDifficulty][]) {
      let wins = 0;
      let decided = 0;
      for (let seed = 0; seed < 120; seed += 1) {
        for (const opener of ['p1', 'p2'] as SeatId[]) {
          // The stronger tier takes the opening seat in one arm and the answering seat in
          // the other, so a first-mover effect can never be read as strength.
          for (const strongOpens of [true, false]) {
            const played = playSet(
              seed * 6421 + 43 + (strongOpens ? 0 : 13),
              opener,
              strongOpens ? strong : weak,
              strongOpens ? weak : strong,
            );
            const strongSeat = strongOpens ? opener : otherSeat(opener);
            const winner = winnerOf(played.match);
            if (winner === 'draw' || winner === null) continue;
            decided += 1;
            if (winner === strongSeat) wins += 1;
          }
        }
      }
      won[`${strong} v ${weak}`] = wins / decided;
    }
    expect(won['hard v easy'], JSON.stringify(won)).toBeGreaterThan(0.68);
    expect(won['normal v easy'], JSON.stringify(won)).toBeGreaterThan(0.6);
    expect(won['hard v normal'], JSON.stringify(won)).toBeGreaterThan(0.56);
    expect(won['hard v easy'] as number).toBeGreaterThan(won['hard v normal'] as number);
    expect(won['hard v easy'] as number).toBeGreaterThan(won['normal v easy'] as number);
  });

  it('costs almost nothing to think', { timeout: 2000 }, () => {
    // Ten questions over thirty candidates, all in machine words — no search, no tree, no
    // per-step allocation. A hundred thousand hard-tier decisions inside the two seconds
    // this test allows itself is about a thousand matches' worth of thinking, which is why
    // `bot-cost.test.ts` has nothing to say about this game.
    //
    // The budget is the test timeout rather than a stopwatch on purpose: reading a clock
    // in a game package is what `no-restricted-globals` forbids, and CI runs several times
    // slower than a development machine anyway.
    const match = fresh(64);
    const action = createAction();
    const rng = new Rng(7);
    for (let i = 0; i < 100_000; i += 1) {
      chooseAction(action, match.p1, rng, 'hard');
      expect(action.question).toBeLessThan(QUESTIONS);
    }
    expect(action.character).toBeLessThan(CAST);
  });

  it('holds its profiles frozen, so no caller can retune the ladder', () => {
    expect(Object.isFrozen(BOT_PROFILES)).toBe(true);
    for (const tier of TIERS) {
      const profile = BOT_PROFILES[tier];
      expect(profile.blunder).toBeGreaterThanOrEqual(0);
      expect(profile.blunder).toBeLessThanOrEqual(1);
      expect(profile.gambleAt).toBeGreaterThanOrEqual(1);
    }
    expect(BOT_PROFILES.easy.blunder).toBeGreaterThan(BOT_PROFILES.normal.blunder);
    expect(BOT_PROFILES.normal.blunder).toBeGreaterThan(BOT_PROFILES.hard.blunder);
  });
});

describe('determinism', () => {
  it('plays the identical match from the identical seed', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const a = playSet(seed * 977 + 47, 'p1', 'normal', 'hard');
      const b = playSet(seed * 977 + 47, 'p1', 'normal', 'hard');
      expect(b.trace).toEqual(a.trace);
    }
  });

  it('plays a different match from a different seed', () => {
    const traces = new Set<string>();
    for (let seed = 0; seed < 40; seed += 1) {
      traces.add(playSet(seed * 977 + 53, 'p1', 'normal', 'hard').trace.join('|'));
    }
    expect(traces.size).toBeGreaterThan(30);
  });

  it('starts a reset match from exactly the same place as a fresh one', () => {
    const fresh1 = createMatch(new Rng(71), 'p2');
    const reused = createMatch(new Rng(999), 'p1');
    playQuestion(reused, legalQuestionList(reused, reused.seat)[0] as number);
    resetMatch(reused, new Rng(71), 'p2');
    expect(reused.tiles).toEqual(fresh1.tiles);
    expect(reused.targetP1).toBe(fresh1.targetP1);
    expect(reused.targetP2).toBe(fresh1.targetP2);
    expect(reused.dealsWonP1).toBe(0);
    expect(reused.totalEffortP2).toBe(0);
    expect(reused.setOver).toBe(false);
  });
});

describe('endTurn', () => {
  it('passes the board and then closes the round', () => {
    const match = fresh(81, 'p2');
    expect(match.seat).toBe('p2');
    endTurn(match);
    expect(match.seat).toBe('p1');
    expect(match.round).toBe(1);
    endTurn(match);
    expect(match.seat).toBe('p2');
    expect(match.round).toBe(2);
    expect(match.over).toBe(false);
  });
});

/* ------------------------------------------------------------------ harness */

interface Played {
  readonly match: Match;
  readonly turns: number;
  readonly turnsBySeat: Record<SeatId, number>;
  readonly names: number;
  readonly hits: number;
  readonly refused: number;
  readonly trace: string[];
  readonly firstMoves: Record<SeatId, string>;
}

/**
 * A whole match at rules level, driven exactly as `game.ts` drives it but with no timers.
 *
 * The generator layout is the shipped one and it is the point of the file: the deal comes
 * off `rng` in order, and the two bots draw from a stream each **by role**.
 */
function playSet(
  seed: number,
  openingSeat: SeatId,
  openerTier: BotDifficulty | BotProfile,
  answererTier: BotDifficulty | BotProfile,
): Played {
  const rng = new Rng(seed);
  const match = createMatch(rng, openingSeat);
  const openerRng = new Rng(rng.next() | 0);
  const answererRng = new Rng(rng.next() | 0);
  const action: Action = createAction();
  const turnsBySeat: Record<SeatId, number> = { p1: 0, p2: 0 };
  const firstMoves: Record<SeatId, string> = { p1: '', p2: '' };
  const trace: string[] = [];
  let turns = 0;
  let names = 0;
  let hits = 0;
  let refused = 0;

  for (;;) {
    while (!match.over) {
      const seat = match.seat;
      const tier = seat === openingSeat ? openerTier : answererTier;
      const stream = seat === match.opener ? openerRng : answererRng;
      const board = boardOf(match, seat);
      if (typeof tier === 'string') chooseAction(action, board, stream, tier);
      else chooseWithProfile(action, board, stream, tier);
      const move = `${action.kind}:${action.question}:${action.character}`;
      if (firstMoves[seat] === '') firstMoves[seat] = move;
      if (action.kind === 'name') {
        names += 1;
        if (action.character === targetOf(match, seat)) hits += 1;
      }
      if (!applyAction(match, action)) refused += 1;
      turnsBySeat[seat] += 1;
      turns += 1;
      trace.push(`${seat}:${move}:${board.liveCount}`);
      if (turns > 4 * CAST * DEALS) throw new Error('guess-the-person did not terminate');
    }
    trace.push(`deal:${match.dealsWonP1}:${match.dealsWonP2}`);
    if (match.setOver) break;
    dealAgain(match, rng);
  }
  return { match, turns, turnsBySeat, names, hits, refused, trace, firstMoves };
}

function legalQuestionList(match: Match, seat: SeatId): number[] {
  const legal = legalQuestions(boardOf(match, seat));
  const list: number[] = [];
  for (let question = 0; question < QUESTIONS; question += 1) {
    if ((legal & (1 << question)) !== 0) list.push(question);
  }
  return list;
}

/** The value an attribute has been pinned to on this seat board, or -1. */
function settled(match: Match, seat: SeatId, attribute: number): number {
  const board = boardOf(match, seat);
  let found = -1;
  for (let character = 0; character < CAST; character += 1) {
    if (!isLive(board, character)) continue;
    const value = valueOf(character, attribute);
    if (found === -1) found = value;
    else if (found !== value) return -1;
  }
  return found;
}

function firstUnsettledValue(match: Match, seat: SeatId, attribute: number): number {
  const board = boardOf(match, seat);
  for (let value = 0; value < (ARITY[attribute] as number); value += 1) {
    if (splitsQuestion(board, questionOf(attribute, value))) return value;
  }
  return 0;
}
