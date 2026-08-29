import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_PROFILE,
  COLUMNS,
  DECK,
  FACE_DOWN_START,
  HIDDEN,
  MAX_POTENTIAL,
  MOVE_BANK_COLUMN,
  MOVE_BANK_WASTE,
  MOVE_COLUMN_TO_COLUMN,
  MOVE_COUNT,
  MOVE_DRAW,
  MOVE_NONE,
  MOVE_WASTE_TO_COLUMN,
  NONE,
  RANKS,
  REVEAL_COUNT,
  STOCK_SIZE,
  SUITS,
  TABLEAU_CARDS,
  applyMove,
  banked,
  cardAt,
  cardsTaken,
  chooseMove,
  chooseWith,
  colourOf,
  copyPosition,
  createMatch,
  createPosition,
  faceDownIn,
  faceDownTotal,
  goesUp,
  hasAnyMove,
  isLegal,
  legalMoves,
  letGo,
  play,
  potential,
  rankOf,
  redact,
  runBottom,
  suitOf,
  topOf,
  valueOf,
  wasteTop,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, MatchState, Position } from './rules.js';

/** Long enough for the sweeps below, which play several hundred matches each. */
const SERIES_TIMEOUT_MS = 60_000;

const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

function other(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/**
 * One whole match at the rules level: no timing, no rendering, just alternating choices.
 *
 * The harness the balance numbers in SPEC.md were taken with, kept here so the numbers can be
 * reproduced from the repository rather than from a script in someone's `/tmp`.
 */
interface Played {
  readonly winner: SeatId | 'draw' | null;
  readonly p1: number;
  readonly p2: number;
  readonly turns: number;
  readonly banked: number;
  readonly moves: string[];
  readonly state: MatchState;
}

function playMatch(
  seed: number,
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  opening: SeatId = 'p1',
  seatSeeds?: readonly [number, number],
): Played {
  const rng = new Rng(seed);
  const state = createMatch(rng, opening);
  const rngP1 = new Rng(seatSeeds ? seatSeeds[0] : rng.int(1, 0x7fff_ffff));
  const rngP2 = new Rng(seatSeeds ? seatSeeds[1] : rng.int(1, 0x7fff_ffff));
  const view = createPosition();
  const moves: string[] = [];
  let turns = 0;

  while (!state.over) {
    // No cap at all beyond this one, which is well above the structural bound proved below: a
    // match that failed to finish must hang the suite rather than pass quietly.
    if (turns > 1000) throw new Error('the match did not end');
    const seat = state.active;
    redact(view, state);
    const move = chooseMove(view, seat === 'p1' ? rngP1 : rngP2, seat === 'p1' ? p1Tier : p2Tier);
    moves.push(`${seat}:${String(move)}`);
    if (move === MOVE_NONE || !play(state, move)) letGo(state);
    turns += 1;
  }

  return {
    winner: winnerOf(state),
    p1: state.p1,
    p2: state.p2,
    turns,
    banked: banked(state),
    moves,
    state,
  };
}

/** Walk the generator's own clearing order and send every card up. */
function clearDeal(state: MatchState): number {
  for (let i = 0; i < DECK; i += 1) {
    const card = state.solution[i] as number;
    let done = false;
    for (let column = 0; column < COLUMNS && !done; column += 1) {
      if (topOf(state, column) === card) done = play(state, MOVE_BANK_COLUMN + column);
    }
    if (done) continue;
    if (wasteTop(state) !== card && !play(state, MOVE_DRAW)) break;
    if (wasteTop(state) !== card) break;
    if (!play(state, MOVE_BANK_WASTE)) break;
  }
  return banked(state);
}

describe('the deck', () => {
  it('splits fifty-two cards into four suits of thirteen', () => {
    expect(DECK).toBe(52);
    expect(RANKS * SUITS).toBe(DECK);
    const seen = new Set<string>();
    for (let card = 0; card < DECK; card += 1) {
      seen.add(`${String(suitOf(card))}:${String(rankOf(card))}`);
      expect(suitOf(card)).toBeGreaterThanOrEqual(0);
      expect(suitOf(card)).toBeLessThan(SUITS);
      expect(rankOf(card)).toBeGreaterThanOrEqual(0);
      expect(rankOf(card)).toBeLessThan(RANKS);
    }
    expect(seen.size).toBe(DECK);
  });

  it('gives every suit a colour, two of each', () => {
    const blacks = [0, 1, 2, 3].filter((suit) => colourOf(suit * RANKS) === 0);
    expect(blacks).toEqual([0, 1]);
    // The colour of a card never depends on its rank, only on its suit.
    for (let card = 0; card < DECK; card += 1) {
      expect(colourOf(card)).toBe(suitOf(card) >> 1);
    }
  });

  it('scores a card at its face value, ace one to king thirteen', () => {
    expect(valueOf(0)).toBe(1);
    expect(valueOf(RANKS - 1)).toBe(13);
    let total = 0;
    for (let card = 0; card < DECK; card += 1) total += valueOf(card);
    // Four suits of 1 + 2 + ... + 13. This is the whole pool a match is played for.
    expect(total).toBe(SUITS * 91);
  });
});

describe('the deal', () => {
  it('lays out seven columns of one to seven, one card face up on each', () => {
    const state = createMatch(new Rng(9));
    let cards = 0;
    for (let column = 0; column < COLUMNS; column += 1) {
      expect(state.pileLen[column]).toBe(column + 1);
      expect(state.faceUp[column]).toBe(1);
      cards += column + 1;
    }
    expect(cards).toBe(TABLEAU_CARDS);
    expect(faceDownTotal(state)).toBe(FACE_DOWN_START);
    expect(state.stockLeft).toBe(STOCK_SIZE);
    expect(state.wasteLen).toBe(0);
    expect(banked(state)).toBe(0);
    expect(state.p1).toBe(0);
    expect(state.p2).toBe(0);
    expect(winnerOf(state)).toBeNull();
  });

  it('uses each of the fifty-two cards exactly once', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const state = createMatch(new Rng(seed * 31));
      const seen = new Set<number>();
      for (let column = 0; column < COLUMNS; column += 1) {
        for (let depth = 0; depth < (state.pileLen[column] as number); depth += 1) {
          seen.add(cardAt(state, column, depth));
        }
      }
      for (let i = 0; i < state.stockLeft; i += 1) seen.add(state.stock[i] as number);
      expect(seen.size, `seed ${String(seed)}`).toBe(DECK);
    }
  });

  it('opens with the seat the shell nominated, not always p1', () => {
    expect(createMatch(new Rng(4), 'p1').active).toBe('p1');
    expect(createMatch(new Rng(4), 'p2').active).toBe('p2');
    // And the opening seat does not disturb the deal itself.
    const one = createMatch(new Rng(4), 'p1');
    const two = createMatch(new Rng(4), 'p2');
    expect([...two.pile]).toEqual([...one.pile]);
    expect([...two.stock]).toEqual([...one.stock]);
  });

  it('is a pure function of the seed, and different seeds deal differently', () => {
    const a = createMatch(new Rng(77));
    const b = createMatch(new Rng(77));
    const c = createMatch(new Rng(78));
    expect([...b.pile]).toEqual([...a.pile]);
    expect([...b.stock]).toEqual([...a.stock]);
    expect([...c.pile]).not.toEqual([...a.pile]);
  });
});

describe('every deal we ship can be cleared, by construction', () => {
  it('names a clearing order that respects each suit from ace to king', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const state = createMatch(new Rng(seed * 977));
      const next = [0, 0, 0, 0];
      const seen = new Set<number>();
      for (let i = 0; i < DECK; i += 1) {
        const card = state.solution[i] as number;
        seen.add(card);
        expect(rankOf(card), `seed ${String(seed)} step ${String(i)}`).toBe(next[suitOf(card)]);
        next[suitOf(card)] = (next[suitOf(card)] as number) + 1;
      }
      expect(seen.size).toBe(DECK);
    }
  });

  it(
    'sends all fifty-two up when that order is played out, on every seed',
    { timeout: SERIES_TIMEOUT_MS },
    () => {
      for (let seed = 1; seed <= 400; seed += 1) {
        const state = createMatch(new Rng(seed * 104_729));
        expect(clearDeal(state), `seed ${String(seed)} could not be cleared`).toBe(DECK);
        expect(state.over).toBe(true);
        expect(potential(state)).toBe(MAX_POTENTIAL);
      }
    },
  );

  it('clears just as completely at every reveal count, not only the one we ship', () => {
    for (const reveal of [1, 2, 3, 4, 6]) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const state = createMatch(new Rng(seed * 104_729), 'p1', reveal);
        expect(clearDeal(state), `reveal ${String(reveal)} seed ${String(seed)}`).toBe(DECK);
      }
    }
  });

  it('can tell a clearable deal from an unclearable one, so the test above can fail', () => {
    // A negative control. Swapping two cards inside one column breaks the property the
    // generator was built for — the earliest card of a column must be on top — and the clear
    // stops short. Without this, "the walk clears everything" might only mean the walk is
    // being generous.
    const state = createMatch(new Rng(5));
    const column = 6;
    const top = (state.pileLen[column] as number) - 1;
    const swap = cardAt(state, column, top);
    state.pile[column * DECK + top] = cardAt(state, column, 0);
    state.pile[column * DECK] = swap;
    expect(clearDeal(state)).toBeLessThan(DECK);
  });
});

describe('what may be played', () => {
  it('sends a card up only when its foundation is waiting for it', () => {
    const pos = createPosition();
    pos.pileLen[0] = 1;
    pos.faceUp[0] = 1;
    pos.pile[0] = 0; // ace of spades
    expect(goesUp(pos, 0)).toBe(true);
    expect(isLegal(pos, MOVE_BANK_COLUMN + 0)).toBe(true);
    pos.foundation[0] = 1;
    expect(goesUp(pos, 0)).toBe(false);
    expect(goesUp(pos, 1)).toBe(true);
    expect(isLegal(pos, MOVE_BANK_COLUMN + 0)).toBe(false);
  });

  it('builds down in rank and alternating in colour, and lets anything into a gap', () => {
    const pos = createPosition();
    // Column 0 shows a red six; column 1 is empty.
    pos.pileLen[0] = 1;
    pos.faceUp[0] = 1;
    pos.pile[0] = 2 * RANKS + 5; // six of hearts
    pos.waste[0] = 4; // five of spades, black
    pos.wasteLen = 1;
    expect(isLegal(pos, MOVE_WASTE_TO_COLUMN + 0)).toBe(true);
    expect(isLegal(pos, MOVE_WASTE_TO_COLUMN + 1)).toBe(true); // the gap takes anything
    pos.waste[0] = 3 * RANKS + 4; // five of diamonds, red on red
    expect(isLegal(pos, MOVE_WASTE_TO_COLUMN + 0)).toBe(false);
    pos.waste[0] = 6; // seven of spades: right colour, wrong rank
    expect(isLegal(pos, MOVE_WASTE_TO_COLUMN + 0)).toBe(false);
  });

  it('moves a column only when doing so turns a card over', () => {
    const pos = createPosition();
    // Column 0: one face-down card under a red six. Column 1: a black seven, nothing beneath.
    pos.pileLen[0] = 2;
    pos.faceUp[0] = 1;
    pos.pile[0] = 12;
    pos.pile[1] = 2 * RANKS + 5;
    pos.pileLen[1] = 1;
    pos.faceUp[1] = 1;
    pos.pile[DECK] = 6;
    const down = MOVE_COLUMN_TO_COLUMN + 0 * COLUMNS + 1;
    const up = MOVE_COLUMN_TO_COLUMN + 1 * COLUMNS + 0;
    expect(isLegal(pos, down)).toBe(true);
    // The reverse would turn nothing over — column 1 has no face-down card — so it is refused,
    // and that refusal is the whole termination argument.
    expect(isLegal(pos, up)).toBe(false);
    expect(isLegal(pos, MOVE_COLUMN_TO_COLUMN + 0 * COLUMNS + 0)).toBe(false);
  });

  it('moves a column as one whole run, landing on the deepest card that is face up', () => {
    const pos = createPosition();
    // Column 0: a face-down card, then a black eight with a red seven on it.
    pos.pileLen[0] = 3;
    pos.faceUp[0] = 2;
    pos.pile[0] = 25;
    pos.pile[1] = 7; // eight of spades
    pos.pile[2] = 2 * RANKS + 6; // seven of hearts
    expect(runBottom(pos, 0)).toBe(7);
    // Column 1 shows a red nine, which the eight fits under.
    pos.pileLen[1] = 1;
    pos.faceUp[1] = 1;
    pos.pile[DECK] = 2 * RANKS + 8;
    const move = MOVE_COLUMN_TO_COLUMN + 0 * COLUMNS + 1;
    expect(isLegal(pos, move)).toBe(true);
    expect(applyMove(pos, move, REVEAL_COUNT)).toBe(NONE);
    expect(pos.pileLen[1]).toBe(3);
    expect(pos.faceUp[1]).toBe(3);
    expect(pos.pileLen[0]).toBe(1);
    expect(pos.faceUp[0]).toBe(1);
    expect(topOf(pos, 0)).toBe(25);
  });

  it('refuses a move index that is not a move', () => {
    const state = createMatch(new Rng(2));
    for (const move of [-1, MOVE_COUNT, MOVE_COUNT + 40, 1.5, Number.NaN]) {
      expect(isLegal(state, move)).toBe(false);
      expect(play(state, move)).toBe(false);
    }
  });

  it('will not turn the stock over a card that is ready to go up', () => {
    const state = createMatch(new Rng(3));
    // Turn cards until one is showing that its foundation wants.
    let guard = 0;
    while (!goesUp(state, wasteTop(state)) && state.stockLeft > 0 && guard < 60) {
      if (!play(state, MOVE_DRAW)) break;
      guard += 1;
    }
    expect(goesUp(state, wasteTop(state))).toBe(true);
    expect(state.stockLeft).toBeGreaterThan(0);
    // The stock is shut while that card is showing, and the only way past it is to take it or
    // to lay it on the tableau — never to bury it.
    expect(isLegal(state, MOVE_DRAW)).toBe(false);
    expect(isLegal(state, MOVE_BANK_WASTE)).toBe(true);
    // And there is always something to do, so shutting the stock cannot end a match early.
    expect(hasAnyMove(state)).toBe(true);
  });

  it('lists exactly the moves that are legal, and puts the stock last', () => {
    const buffer = new Int8Array(MOVE_COUNT);
    for (let seed = 1; seed <= 30; seed += 1) {
      const state = createMatch(new Rng(seed * 13));
      const view = createPosition();
      for (let turn = 0; turn < 40 && !state.over; turn += 1) {
        const count = legalMoves(buffer, state);
        const listed = new Set<number>();
        for (let i = 0; i < count; i += 1) {
          const move = buffer[i] as number;
          expect(isLegal(state, move)).toBe(true);
          listed.add(move);
        }
        expect(listed.size).toBe(count);
        for (let move = 0; move < MOVE_COUNT; move += 1) {
          if (isLegal(state, move)) expect(listed.has(move)).toBe(true);
        }
        expect(count > 0).toBe(hasAnyMove(state));
        if (count > 1 && listed.has(MOVE_DRAW)) expect(buffer[count - 1]).toBe(MOVE_DRAW);
        redact(view, state);
        const move = chooseMove(view, new Rng(seed + turn), 'easy');
        if (move === MOVE_NONE || !play(state, move)) break;
      }
    }
  });
});

describe('the match cannot run for ever', () => {
  it('starts and finishes the potential where the arithmetic says it must', () => {
    const state = createMatch(new Rng(11));
    expect(potential(state)).toBe(STOCK_SIZE);
    expect(MAX_POTENTIAL).toBe(2 * DECK + FACE_DOWN_START + 2 * STOCK_SIZE + STOCK_SIZE);
    clearDeal(state);
    expect(potential(state)).toBe(MAX_POTENTIAL);
  });

  it(
    'raises the potential on every single move anybody ever makes',
    { timeout: SERIES_TIMEOUT_MS },
    () => {
      // The whole termination argument, checked move by move rather than asserted in prose.
      const buffer = new Int8Array(MOVE_COUNT);
      for (let seed = 1; seed <= 120; seed += 1) {
        const rng = new Rng(seed * 6151);
        const state = createMatch(rng);
        let before = potential(state);
        let turns = 0;
        while (!state.over) {
          if (turns > MAX_POTENTIAL) throw new Error('more moves than the potential allows');
          // Deliberately a random legal move rather than a bot's: the bound must hold for the
          // worst play anybody could produce, not for play that happens to be sensible.
          const count = legalMoves(buffer, state);
          const move = buffer[rng.int(0, count)] as number;
          expect(play(state, move)).toBe(true);
          const after = potential(state);
          expect(after, `seed ${String(seed)} move ${String(move)}`).toBeGreaterThan(before);
          before = after;
          turns += 1;
        }
        expect(before).toBeLessThanOrEqual(MAX_POTENTIAL);
        expect(turns).toBeLessThanOrEqual(MAX_POTENTIAL - STOCK_SIZE);
      }
    },
  );

  it('ends the deal when two turns in a row are let go', () => {
    const state = createMatch(new Rng(21));
    letGo(state);
    expect(state.over).toBe(false);
    expect(state.active).toBe('p2');
    letGo(state);
    expect(state.over).toBe(true);
    expect(winnerOf(state)).not.toBeNull();
    // And nothing happens afterwards.
    const turns = state.turns;
    letGo(state);
    expect(state.turns).toBe(turns);
    expect(play(state, MOVE_DRAW)).toBe(false);
  });

  it('forgets a let-go turn as soon as somebody plays', () => {
    const state = createMatch(new Rng(22));
    letGo(state);
    expect(state.passes).toBe(1);
    expect(play(state, MOVE_DRAW)).toBe(true);
    expect(state.passes).toBe(0);
    letGo(state);
    expect(state.over).toBe(false);
  });

  it(
    'finishes with two easy bots, with no ceiling on the loop at all',
    { timeout: SERIES_TIMEOUT_MS },
    () => {
      // `playMatch` throws past a thousand turns, which is five times the structural bound. A
      // regression that stalled would hang this suite rather than pass quietly.
      for (let seed = 1; seed <= 60; seed += 1) {
        const played = playMatch(seed * 883, 'easy', 'easy', seed % 2 === 0 ? 'p1' : 'p2');
        expect(played.winner).not.toBeNull();
        expect(played.turns).toBeLessThanOrEqual(MAX_POTENTIAL - STOCK_SIZE);
      }
    },
  );
});

describe('the score', () => {
  it('pays a card to whoever sends it up, and records who took it', () => {
    const state = createMatch(new Rng(31));
    let sent = 0;
    for (let turn = 0; turn < 120 && sent < 4 && !state.over; turn += 1) {
      const mover = state.active;
      let played = -1;
      for (let column = 0; column < COLUMNS && played < 0; column += 1) {
        if (isLegal(state, MOVE_BANK_COLUMN + column)) played = MOVE_BANK_COLUMN + column;
      }
      if (played < 0 && isLegal(state, MOVE_BANK_WASTE)) played = MOVE_BANK_WASTE;
      if (played < 0) {
        expect(play(state, MOVE_DRAW)).toBe(true);
        continue;
      }
      const card =
        played === MOVE_BANK_WASTE ? wasteTop(state) : topOf(state, played - MOVE_BANK_COLUMN);
      const before = mover === 'p1' ? state.p1 : state.p2;
      const upBefore = state.foundation[suitOf(card)] as number;
      expect(play(state, played)).toBe(true);
      expect(mover === 'p1' ? state.p1 : state.p2).toBe(before + valueOf(card));
      expect(state.owner[card]).toBe(mover === 'p1' ? 1 : 2);
      expect(state.lastCard).toBe(card);
      expect(state.foundation[suitOf(card)]).toBe(upBefore + 1);
      expect(state.active).toBe(mover === 'p1' ? 'p2' : 'p1');
      sent += 1;
    }
    expect(sent).toBe(4);
  });

  it('records no owner for a move that sends nothing up', () => {
    const state = createMatch(new Rng(32));
    expect(play(state, MOVE_DRAW)).toBe(true);
    expect(state.lastCard).toBe(NONE);
    expect(state.p1).toBe(0);
    expect(state.p2).toBe(0);
    expect([...state.owner].every((mark) => mark === 0)).toBe(true);
  });

  it('gives the match to the higher score, then to more cards, then calls it a draw', () => {
    const state = createMatch(new Rng(33));
    state.over = true;
    state.p1 = 40;
    state.p2 = 39;
    expect(winnerOf(state)).toBe('p1');
    state.p2 = 41;
    expect(winnerOf(state)).toBe('p2');
    state.p2 = 40;
    expect(winnerOf(state)).toBe('draw');
    state.owner[0] = 1;
    expect(cardsTaken(state, 'p1')).toBe(1);
    expect(winnerOf(state)).toBe('p1');
    state.owner[1] = 2;
    state.owner[2] = 2;
    expect(winnerOf(state)).toBe('p2');
  });

  it('reports nothing while the deal is still live', () => {
    const state = createMatch(new Rng(34));
    expect(winnerOf(state)).toBeNull();
    play(state, MOVE_DRAW);
    expect(winnerOf(state)).toBeNull();
  });

  it(
    'ends the deal with the cards shared out unevenly, so a match is decided',
    { timeout: SERIES_TIMEOUT_MS },
    () => {
      let draws = 0;
      let gap = 0;
      for (let seed = 1; seed <= 120; seed += 1) {
        const played = playMatch(seed * 197, 'normal', 'normal', seed % 2 === 0 ? 'p1' : 'p2');
        if (played.winner === 'draw') draws += 1;
        gap += Math.abs(played.p1 - played.p2);
      }
      // Measured at 0.25% over 800 matches; this is the loose version of the same claim.
      expect(draws / 120).toBeLessThan(0.05);
      // And the winner wins by a real margin rather than by a point.
      expect(gap / 120).toBeGreaterThan(15);
    },
  );
});

describe('the bot knows only what a player at the table knows', () => {
  it('hides the face-down cards and the whole stock, and shows the waste', () => {
    const state = createMatch(new Rng(41));
    play(state, MOVE_DRAW);
    const view = createPosition();
    redact(view, state);
    for (let column = 0; column < COLUMNS; column += 1) {
      const down = faceDownIn(state, column);
      for (let depth = 0; depth < down; depth += 1) {
        expect(cardAt(view, column, depth)).toBe(HIDDEN);
      }
      // The card showing is untouched, and so is the whole face-up run.
      expect(topOf(view, column)).toBe(topOf(state, column));
    }
    for (let i = 0; i < view.stockLeft; i += 1) expect(view.stock[i]).toBe(HIDDEN);
    expect(wasteTop(view)).toBe(wasteTop(state));
  });

  it('cannot play a hidden card, and nothing can be laid on one', () => {
    const pos = createPosition();
    pos.pileLen[0] = 1;
    pos.faceUp[0] = 1;
    pos.pile[0] = HIDDEN;
    pos.waste[0] = 6;
    pos.wasteLen = 1;
    expect(isLegal(pos, MOVE_BANK_COLUMN + 0)).toBe(false);
    expect(isLegal(pos, MOVE_WASTE_TO_COLUMN + 0)).toBe(false);
    expect(goesUp(pos, HIDDEN)).toBe(false);
  });

  it(
    'plays the identical move when what is underneath is scrambled',
    { timeout: SERIES_TIMEOUT_MS },
    () => {
      // Rule 6, checked on behaviour as well as on the shape of the data. The face-down cards
      // and the stock are replaced with completely different cards; if the bot could reach any
      // of them at all, its choice would move.
      for (const tier of TIERS) {
        for (let seed = 1; seed <= 40; seed += 1) {
          const state = createMatch(new Rng(seed * 71));
          for (let turn = 0; turn < 12 && !state.over; turn += 1) {
            const view = createPosition();
            redact(view, state);
            const honest = chooseMove(view, new Rng(9), tier);

            const scrambled = createPosition();
            copyPosition(scrambled, state);
            for (let column = 0; column < COLUMNS; column += 1) {
              const down = faceDownIn(state, column);
              for (let depth = 0; depth < down; depth += 1) {
                scrambled.pile[column * DECK + depth] = (depth * 7 + column) % DECK;
              }
            }
            for (let i = 0; i < scrambled.stockLeft; i += 1) scrambled.stock[i] = (i * 5) % DECK;
            const scrambledView = createPosition();
            redact(scrambledView, scrambled);
            expect(chooseMove(scrambledView, new Rng(9), tier)).toBe(honest);

            if (!play(state, honest)) break;
          }
        }
      }
    },
  );

  it('draws exactly two values from its generator every turn, whatever the position', () => {
    // A fixed draw count, taken before anything branches, is what keeps a seat's play from
    // becoming a function of the position it happens to face — or of how its opponent plays.
    for (const tier of TIERS) {
      const state = createMatch(new Rng(53));
      const view = createPosition();
      for (let turn = 0; turn < 25 && !state.over; turn += 1) {
        const counter = new Rng(101);
        const counted = new Rng(101);
        redact(view, state);
        const move = chooseMove(view, counter, tier);
        counted.float();
        counted.float();
        // Both generators must now be in the same place: draw one more from each and compare.
        expect(counter.float()).toBe(counted.float());
        if (!play(state, move)) break;
      }
    }
  });

  it('only ever offers a move that is legal right now', () => {
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 25; seed += 1) {
        const state = createMatch(new Rng(seed * 311), seed % 2 === 0 ? 'p1' : 'p2');
        const rng = new Rng(seed);
        const view = createPosition();
        while (!state.over) {
          redact(view, state);
          const move = chooseMove(view, rng, tier);
          expect(move).not.toBe(MOVE_NONE);
          expect(isLegal(state, move), `${tier} offered ${String(move)}`).toBe(true);
          play(state, move);
        }
      }
    }
  });

  it('has nothing to say about a position with no moves in it', () => {
    const dead = createPosition();
    expect(hasAnyMove(dead)).toBe(false);
    expect(chooseMove(dead, new Rng(1), 'hard')).toBe(MOVE_NONE);
  });
});

describe('the two seats are the same seat', () => {
  it(
    'plays the mirror-image match when the two chairs are swapped',
    { timeout: SERIES_TIMEOUT_MS },
    () => {
      // The strongest fairness statement this game can make, and the one that found nothing
      // only because the board is genuinely shared: relabel the seats, swap the two generators
      // and the opening seat, and every move, every score and the result must come back
      // mirrored. Snowball Throw's two defects were both invisible to a win-rate ladder and
      // both would have shown up here.
      for (const tier of TIERS) {
        for (let seed = 1; seed <= 40; seed += 1) {
          const a = playMatch(seed * 7919, tier, tier, 'p1', [111 + seed, 222 + seed]);
          const b = playMatch(seed * 7919, tier, tier, 'p2', [222 + seed, 111 + seed]);
          expect(a.moves).toEqual(
            b.moves.map((entry) =>
              entry.startsWith('p1') ? `p2${entry.slice(2)}` : `p1${entry.slice(2)}`,
            ),
          );
          expect(a.p1).toBe(b.p2);
          expect(a.p2).toBe(b.p1);
          expect(a.winner).toBe(
            b.winner === 'draw' || b.winner === null ? b.winner : other(b.winner),
          );
          expect([...a.state.owner]).toEqual(
            [...b.state.owner].map((mark) => (mark === 1 ? 2 : mark === 2 ? 1 : 0)),
          );
        }
      }
    },
  );

  it(
    'wins with either seat about equally often at equal skill',
    { timeout: SERIES_TIMEOUT_MS },
    () => {
      // The loose version of SPEC.md's table, which was measured at 400 seeds a tier.
      for (const tier of TIERS) {
        let seatOne = 0;
        let decided = 0;
        for (let seed = 1; seed <= 90; seed += 1) {
          for (const opening of ['p1', 'p2'] as const) {
            const played = playMatch(seed * 7919, tier, tier, opening);
            if (played.winner === 'draw' || played.winner === null) continue;
            decided += 1;
            if (played.winner === 'p1') seatOne += 1;
          }
        }
        const share = seatOne / decided;
        expect(share, `${tier}: seat one took ${(share * 100).toFixed(1)}%`).toBeGreaterThan(0.4);
        expect(share, `${tier}: seat one took ${(share * 100).toFixed(1)}%`).toBeLessThan(0.6);
      }
    },
  );
});

describe('the bot ladder', () => {
  it('is monotone from both seat orders', { timeout: SERIES_TIMEOUT_MS }, () => {
    const share = (strong: BotDifficulty, weak: BotDifficulty): number => {
      let wins = 0;
      let decided = 0;
      for (let seed = 1; seed <= 70; seed += 1) {
        for (const order of [0, 1]) {
          const p1 = order === 0 ? strong : weak;
          const p2 = order === 0 ? weak : strong;
          const played = playMatch(seed * 7919, p1, p2, order === 0 ? 'p1' : 'p2');
          if (played.winner === 'draw' || played.winner === null) continue;
          decided += 1;
          const strongSeat = order === 0 ? 'p1' : 'p2';
          if (played.winner === strongSeat) wins += 1;
        }
      }
      return wins / decided;
    };
    const hardEasy = share('hard', 'easy');
    const hardNormal = share('hard', 'normal');
    const normalEasy = share('normal', 'easy');
    expect(hardEasy, `hard v easy ${(hardEasy * 100).toFixed(1)}%`).toBeGreaterThan(0.8);
    expect(normalEasy, `normal v easy ${(normalEasy * 100).toFixed(1)}%`).toBeGreaterThan(0.7);
    expect(hardNormal, `hard v normal ${(hardNormal * 100).toFixed(1)}%`).toBeGreaterThan(0.6);
    expect(hardEasy).toBeGreaterThan(hardNormal);
  });

  it('looks further ahead the harder it is, always an odd number of plies', () => {
    for (const tier of TIERS) {
      expect(BOT_PROFILE[tier].plies % 2).toBe(1);
    }
    expect(BOT_PROFILE.easy.plies).toBeLessThan(BOT_PROFILE.normal.plies);
    expect(BOT_PROFILE.normal.plies).toBeLessThan(BOT_PROFILE.hard.plies);
    expect(BOT_PROFILE.easy.slip).toBeGreaterThan(BOT_PROFILE.normal.slip);
    expect(BOT_PROFILE.normal.slip).toBeGreaterThan(BOT_PROFILE.hard.slip);
  });

  it(
    'gets stronger as the slip falls, over the whole range of the knob',
    { timeout: SERIES_TIMEOUT_MS },
    () => {
      // The knob swept alone, which is the only way to know its sign. SPEC.md has it at 250
      // seeds; this is the coarse version, and it fails if the knob ever runs backwards.
      const against = BOT_PROFILE.normal;
      const measure = (slip: number): number => {
        let wins = 0;
        let decided = 0;
        for (let seed = 1; seed <= 45; seed += 1) {
          for (const opening of ['p1', 'p2'] as const) {
            const rng = new Rng(seed * 7919);
            const state = createMatch(rng, opening);
            const seats = {
              p1: new Rng(rng.int(1, 0x7fff_ffff)),
              p2: new Rng(rng.int(1, 0x7fff_ffff)),
            };
            const view = createPosition();
            while (!state.over) {
              const seat = state.active;
              redact(view, state);
              const move = chooseWith(
                view,
                seats[seat],
                seat === 'p1' ? { plies: 5, slip } : against,
              );
              if (move === MOVE_NONE || !play(state, move)) letGo(state);
            }
            const winner = winnerOf(state);
            if (winner === 'draw' || winner === null) continue;
            decided += 1;
            if (winner === 'p1') wins += 1;
          }
        }
        return wins / decided;
      };
      const sharp = measure(0);
      const middling = measure(0.3);
      const hopeless = measure(1);
      expect(sharp).toBeGreaterThan(middling);
      expect(middling).toBeGreaterThan(hopeless);
      expect(hopeless).toBeLessThan(0.1);
    },
  );

  it('gains nothing from two more exchanges, because the horizon is the face-down cards', () => {
    // Two whole exchanges deeper than the shipped `hard`, and it plays 98.3% of the same moves.
    // Not because both run out of nodes — the budget is reached on only 1.2% of `hard`'s turns —
    // but because the extra exchange lands among cards the bot cannot see, so there is nothing
    // new at the leaf to change its mind. The horizon is set by the face-down cards. Measured
    // strength agrees: seven plies is worth 68.6% against `normal` where five is worth 68.7%,
    // so this is what says the ladder tops out at five for a reason rather than by taste.
    const deeper = { plies: 7, slip: 0 };
    let same = 0;
    let turns = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const state = createMatch(new Rng(seed * 613));
      const view = createPosition();
      for (let turn = 0; turn < 25 && !state.over; turn += 1) {
        redact(view, state);
        const shipped = chooseMove(view, new Rng(7), 'hard');
        redact(view, state);
        if (chooseWith(view, new Rng(7), deeper) === shipped) same += 1;
        turns += 1;
        if (!play(state, shipped)) break;
      }
    }
    expect(turns).toBeGreaterThan(100);
    expect(same / turns, `${String(same)} of ${String(turns)} moves agreed`).toBeGreaterThan(0.9);
  });
});

describe('a position', () => {
  it('copies exactly, and the copy is independent', () => {
    const state = createMatch(new Rng(71));
    play(state, MOVE_DRAW);
    const copy: Position = createPosition();
    copyPosition(copy, state);
    expect([...copy.pile]).toEqual([...state.pile]);
    expect(copy.stockLeft).toBe(state.stockLeft);
    expect(copy.active).toBe(state.active);
    play(state, MOVE_DRAW);
    expect(copy.stockLeft).not.toBe(state.stockLeft);
  });

  it('answers sensibly about an empty column', () => {
    const pos = createPosition();
    expect(topOf(pos, 0)).toBe(NONE);
    expect(runBottom(pos, 0)).toBe(NONE);
    expect(wasteTop(pos)).toBe(NONE);
    expect(faceDownIn(pos, 0)).toBe(0);
    expect(banked(pos)).toBe(0);
  });

  it('turns the next card over when the last face-up one is taken', () => {
    const state = createMatch(new Rng(81));
    // Column 6 has six cards face down under the one that is showing.
    expect(faceDownIn(state, 6)).toBe(6);
    // Open that column's foundation so its top card can go up.
    state.foundation[suitOf(topOf(state, 6))] = rankOf(topOf(state, 6));
    expect(isLegal(state, MOVE_BANK_COLUMN + 6)).toBe(true);
    expect(play(state, MOVE_BANK_COLUMN + 6)).toBe(true);
    expect(state.pileLen[6]).toBe(6);
    expect(state.faceUp[6]).toBe(1);
    expect(faceDownIn(state, 6)).toBe(5);
    expect(topOf(state, 6)).toBeGreaterThanOrEqual(0);
  });
});

describe('the reveal count is a property of the deal, not of a bot', () => {
  it('is one, and both seats are dealt from the same stock', () => {
    expect(REVEAL_COUNT).toBe(1);
    const state = createMatch(new Rng(91));
    expect(state.reveal).toBe(REVEAL_COUNT);
  });

  it('turns that many cards at once, and never more than the stock holds', () => {
    for (const reveal of [1, 2, 3, 5]) {
      const state = createMatch(new Rng(93), 'p1', reveal);
      expect(play(state, MOVE_DRAW)).toBe(true);
      expect(state.wasteLen).toBe(Math.min(reveal, STOCK_SIZE));
      expect(state.stockLeft).toBe(STOCK_SIZE - state.wasteLen);
      let guard = 0;
      while (state.stockLeft > 0 && guard < 200) {
        if (!play(state, MOVE_DRAW)) {
          // The stock is shut because the card showing is ready; take it and carry on.
          expect(play(state, MOVE_BANK_WASTE)).toBe(true);
        }
        guard += 1;
      }
      expect(state.stockLeft).toBe(0);
      expect(state.wasteLen).toBeLessThanOrEqual(STOCK_SIZE);
    }
  });

  it('rejects a nonsense reveal count rather than dealing a broken match', () => {
    expect(createMatch(new Rng(95), 'p1', 0).reveal).toBe(1);
    expect(createMatch(new Rng(95), 'p1', -3).reveal).toBe(1);
    expect(createMatch(new Rng(95), 'p1', 2.7).reveal).toBe(2);
  });
});
