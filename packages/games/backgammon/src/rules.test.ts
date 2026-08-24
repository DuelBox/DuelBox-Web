import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BAR,
  BEAR_OFF,
  BOT_PROFILES,
  CHECKERS,
  DIE_FACES,
  HOME_START,
  MAX_TURNS,
  POINTS,
  START_PIPS,
  allHome,
  applyMove,
  barOf,
  boardIndex,
  botMove,
  canMove,
  createPosition,
  destinationOf,
  encodeMove,
  endTurn,
  exposure,
  foeAt,
  hasMove,
  legalMoves,
  moveDie,
  moveFrom,
  moveTo,
  offOf,
  otherOf,
  ownAt,
  passTurn,
  pipsGained,
  pipsLeft,
  resetPosition,
  roll,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Position } from './rules.js';

interface Spec {
  /** Checkers as [travel index, count], stated in that seat's own direction. */
  readonly p1?: readonly (readonly [number, number])[];
  readonly p2?: readonly (readonly [number, number])[];
  readonly bar?: readonly [number, number];
  readonly off?: readonly [number, number];
  readonly dice?: readonly number[];
  readonly seat?: SeatId;
  readonly turns?: number;
}

/**
 * A position stated in each seat's own travel indices, so a test reads the way the rules
 * are written rather than in shared point numbers nobody plays in.
 */
function at(spec: Spec): Position {
  const position = createPosition();
  position.points.fill(0);
  for (const [travel, count] of spec.p1 ?? []) {
    position.points[boardIndex('p1', travel)] = count;
  }
  for (const [travel, count] of spec.p2 ?? []) {
    position.points[boardIndex('p2', travel)] = -count;
  }
  position.barP1 = spec.bar?.[0] ?? 0;
  position.barP2 = spec.bar?.[1] ?? 0;
  position.offP1 = spec.off?.[0] ?? 0;
  position.offP2 = spec.off?.[1] ?? 0;
  position.seat = spec.seat ?? 'p1';
  position.turns = spec.turns ?? 0;
  position.dice.length = 0;
  for (const die of spec.dice ?? []) position.dice.push(die);
  position.phase = position.dice.length > 0 ? 'moving' : 'rolling';
  return position;
}

/** The same game seen from the other seat: every point turned round, the seats swapped. */
function mirrored(position: Position): Position {
  const copy = createPosition();
  for (let index = 0; index < POINTS; index += 1) {
    copy.points[index] = -(position.points[POINTS - 1 - index] ?? 0);
  }
  copy.barP1 = position.barP2;
  copy.barP2 = position.barP1;
  copy.offP1 = position.offP2;
  copy.offP2 = position.offP1;
  copy.seat = otherOf(position.seat);
  copy.phase = position.phase;
  copy.turns = position.turns;
  copy.dice.length = 0;
  for (const die of position.dice) copy.dice.push(die);
  return copy;
}

function checkersOn(position: Position, seat: SeatId): number {
  let total = barOf(position, seat) + offOf(position, seat);
  for (let travel = 0; travel < POINTS; travel += 1) total += ownAt(position, seat, travel);
  return total;
}

const scratch: number[] = [];

function movesOf(position: Position, seat: SeatId = position.seat): number[] {
  legalMoves(scratch, position, seat);
  return scratch.slice();
}

describe('the opening position', () => {
  it('gives each seat fifteen checkers', () => {
    const position = createPosition();
    expect(checkersOn(position, 'p1')).toBe(CHECKERS);
    expect(checkersOn(position, 'p2')).toBe(CHECKERS);
  });

  it('sets them out on the standard four points', () => {
    const position = createPosition();
    expect(ownAt(position, 'p1', 0), 'two on the furthest point').toBe(2);
    expect(ownAt(position, 'p1', 11), 'five on the mid point').toBe(5);
    expect(ownAt(position, 'p1', 16), 'three on the bar point').toBe(3);
    expect(ownAt(position, 'p1', 18), 'five on the six point').toBe(5);
  });

  it('is the identical position read from either end', () => {
    // The whole reason travel indices exist: both seats describe the opening the same way.
    const position = createPosition();
    for (let travel = 0; travel < POINTS; travel += 1) {
      expect(ownAt(position, 'p2', travel), `travel ${String(travel)}`).toBe(
        ownAt(position, 'p1', travel),
      );
    }
  });

  it('starts both seats one hundred and sixty-seven pips from home', () => {
    const position = createPosition();
    expect(pipsLeft(position, 'p1')).toBe(START_PIPS);
    expect(pipsLeft(position, 'p2')).toBe(START_PIPS);
    expect(pipsGained(position, 'p1'), 'and nought gained').toBe(0);
  });

  it('has nobody on the bar and nobody borne off', () => {
    const position = createPosition();
    expect(barOf(position, 'p1') + barOf(position, 'p2')).toBe(0);
    expect(offOf(position, 'p1') + offOf(position, 'p2')).toBe(0);
    expect(position.phase).toBe('rolling');
    expect(position.seat).toBe('p1');
  });
});

describe('reading the board', () => {
  it('maps a seat travel index onto the shared point', () => {
    expect(boardIndex('p1', 0)).toBe(0);
    expect(boardIndex('p1', 23)).toBe(23);
    expect(boardIndex('p2', 0), 'the two run opposite ways').toBe(23);
    expect(boardIndex('p2', 23)).toBe(0);
  });

  it('shows one point as mine to one seat and theirs to the other', () => {
    const position = at({ p1: [[7, 3]] });
    expect(ownAt(position, 'p1', 7)).toBe(3);
    expect(foeAt(position, 'p2', POINTS - 1 - 7), 'the same three, from the other end').toBe(3);
    expect(ownAt(position, 'p2', POINTS - 1 - 7)).toBe(0);
  });

  it('counts nothing outside the board', () => {
    const position = createPosition();
    expect(ownAt(position, 'p1', BAR)).toBe(0);
    expect(ownAt(position, 'p1', POINTS)).toBe(0);
  });

  it('puts the home board on the last six points', () => {
    expect(POINTS - HOME_START).toBe(6);
    expect(BEAR_OFF).toBe(POINTS);
  });
});

describe('what a checker may do', () => {
  it('refuses a die that is not a die', () => {
    const position = at({ p1: [[4, 1]], dice: [3] });
    expect(canMove(position, 'p1', 4, 0)).toBe(false);
    expect(canMove(position, 'p1', 4, DIE_FACES + 1)).toBe(false);
  });

  it('refuses a point it has nothing on', () => {
    const position = at({ p1: [[4, 1]], dice: [3] });
    expect(canMove(position, 'p1', 5, 3)).toBe(false);
    expect(canMove(position, 'p1', -4, 3), 'and nowhere at all').toBe(false);
    expect(canMove(position, 'p1', POINTS, 3)).toBe(false);
  });

  it('is blocked by two or more of theirs', () => {
    const position = at({ p1: [[4, 1]], p2: [[POINTS - 1 - 7, 2]], dice: [3] });
    expect(foeAt(position, 'p1', 7)).toBe(2);
    expect(canMove(position, 'p1', 4, 3), 'a point of two is a wall').toBe(false);
  });

  it('may land on a lone checker of theirs', () => {
    const position = at({ p1: [[4, 1]], p2: [[POINTS - 1 - 7, 1]], dice: [3] });
    expect(canMove(position, 'p1', 4, 3), 'one of theirs is a blot').toBe(true);
  });

  it('may land on its own stack, however deep', () => {
    const position = at({
      p1: [
        [4, 1],
        [7, 6],
      ],
      dice: [3],
    });
    expect(canMove(position, 'p1', 4, 3)).toBe(true);
  });

  it('holds everything else until the bar is cleared', () => {
    const position = at({ p1: [[4, 2]], bar: [1, 0], dice: [3] });
    expect(canMove(position, 'p1', 4, 3), 'the board waits').toBe(false);
    expect(canMove(position, 'p1', BAR, 3), 'the bar moves').toBe(true);
  });

  it('enters from the bar onto the point the die names', () => {
    const position = at({ bar: [1, 0], dice: [4] });
    expect(destinationOf(BAR, 4)).toBe(3);
    applyMove(position, encodeMove(BAR, 4));
    expect(ownAt(position, 'p1', 3), 'a four enters on the fourth point').toBe(1);
    expect(barOf(position, 'p1')).toBe(0);
  });

  it('cannot enter onto a point they have closed', () => {
    const position = at({ p2: [[POINTS - 1 - 3, 2]], bar: [1, 0], dice: [4, 2] });
    expect(canMove(position, 'p1', BAR, 4), 'that entry is shut').toBe(false);
    expect(canMove(position, 'p1', BAR, 2), 'this one is not').toBe(true);
  });

  it('will not bear off while anything is still outside the home board', () => {
    const position = at({
      p1: [
        [17, 1],
        [20, 4],
      ],
      dice: [4],
    });
    expect(allHome(position, 'p1')).toBe(false);
    expect(canMove(position, 'p1', 20, 4)).toBe(false);
  });

  it('will not bear off with a checker on the bar', () => {
    const position = at({ p1: [[20, 4]], bar: [1, 0], dice: [4] });
    expect(allHome(position, 'p1')).toBe(false);
  });

  it('bears off on the exact roll', () => {
    const position = at({ p1: [[20, 2]], dice: [4] });
    expect(allHome(position, 'p1')).toBe(true);
    expect(destinationOf(20, 4)).toBe(BEAR_OFF);
    expect(canMove(position, 'p1', 20, 4)).toBe(true);
  });

  it('bears off with a bigger die from the furthest point back', () => {
    const position = at({ p1: [[21, 2]], dice: [6] });
    expect(canMove(position, 'p1', 21, 6), 'nothing is further back').toBe(true);
  });

  it('refuses the overshoot while something is further back', () => {
    const position = at({
      p1: [
        [19, 1],
        [21, 1],
      ],
      dice: [6],
    });
    expect(canMove(position, 'p1', 21, 6), 'bring the back one in first').toBe(false);
    expect(canMove(position, 'p1', 19, 6), 'and that one bears off').toBe(true);
  });
});

describe('the legal move list', () => {
  it('is empty before the dice are thrown', () => {
    const position = at({ p1: [[4, 1]] });
    expect(legalMoves(scratch, position, 'p1')).toBe(0);
  });

  it('is ordered by point and then by die', () => {
    const position = at({
      p1: [
        [4, 1],
        [9, 1],
      ],
      dice: [5, 2],
    });
    expect(movesOf(position)).toEqual([
      encodeMove(4, 2),
      encodeMove(4, 5),
      encodeMove(9, 2),
      encodeMove(9, 5),
    ]);
  });

  it('offers only the bar while a checker is on it', () => {
    const position = at({ p1: [[4, 2]], bar: [2, 0], dice: [5, 2] });
    expect(movesOf(position)).toEqual([encodeMove(BAR, 2), encodeMove(BAR, 5)]);
  });

  it('says the same thing as hasMove', () => {
    const shut = at({ p1: [[4, 1]], p2: [[POINTS - 1 - 7, 2]], dice: [3] });
    expect(legalMoves(scratch, shut, 'p1')).toBe(0);
    expect(hasMove(shut, 'p1')).toBe(false);
    const open = at({ p1: [[4, 1]], dice: [3] });
    expect(hasMove(open, 'p1')).toBe(true);
  });

  it('never offers more moves than the cursor grid can hold', () => {
    // Thirty-six cells against a ceiling of fifteen points times two dice. Asserted rather
    // than assumed, because the keyboard walks the list and a longer one would be unreachable.
    const rng = new Rng(4242);
    const position = createPosition();
    let worst = 0;
    for (let step = 0; step < 4000 && position.winner === null; step += 1) {
      if (position.phase === 'rolling') {
        roll(position, rng);
        continue;
      }
      const count = legalMoves(scratch, position, position.seat);
      worst = count > worst ? count : worst;
      if (count === 0) passTurn(position);
      else applyMove(position, scratch[rng.int(0, count)] ?? 0);
    }
    expect(worst).toBeGreaterThan(4);
    expect(worst).toBeLessThanOrEqual(30);
  });
});

describe('the dice', () => {
  it('throws two dice inside the faces', () => {
    const rng = new Rng(11);
    const position = createPosition();
    for (let i = 0; i < 200; i += 1) {
      position.phase = 'rolling';
      roll(position, rng);
      for (const die of position.rolled) {
        expect(die).toBeGreaterThanOrEqual(1);
        expect(die).toBeLessThanOrEqual(DIE_FACES);
      }
    }
  });

  it('plays a double four times and a pair twice', () => {
    const rng = new Rng(7);
    const position = createPosition();
    let doubles = 0;
    let pairs = 0;
    for (let i = 0; i < 400; i += 1) {
      position.phase = 'rolling';
      roll(position, rng);
      const [a, b] = position.rolled;
      if (a === b) {
        doubles += 1;
        expect(position.dice.length).toBe(4);
      } else {
        pairs += 1;
        expect(position.dice.length).toBe(2);
        expect(position.dice[0], 'larger die first').toBeGreaterThan(position.dice[1] ?? 0);
      }
    }
    expect(doubles, 'a sixth of the throws, near enough').toBeGreaterThan(30);
    expect(pairs).toBeGreaterThan(250);
  });

  it('refuses to throw twice in one turn', () => {
    const position = createPosition();
    roll(position, new Rng(5));
    expect(roll(position, new Rng(9)), 'the dice are already down').toBe(0);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const rng = new Rng(23);
      const position = createPosition();
      const out: number[] = [];
      for (let i = 0; i < 60; i += 1) {
        position.phase = 'rolling';
        roll(position, rng);
        out.push(...position.rolled);
      }
      return out.join(',');
    };
    expect(trace()).toBe(trace());
  });
});

describe('moving', () => {
  it('advances by the die and spends it', () => {
    const position = at({ p1: [[4, 1]], dice: [5, 3] });
    const result = applyMove(position, encodeMove(4, 3));
    expect(result.moved).toBe(true);
    expect(ownAt(position, 'p1', 7)).toBe(1);
    expect(position.dice, 'the three is gone').toEqual([5]);
  });

  it('hands the turn over when the dice are spent', () => {
    const position = at({ p1: [[4, 2]], dice: [3] });
    applyMove(position, encodeMove(4, 3));
    expect(position.seat).toBe('p2');
    expect(position.phase).toBe('rolling');
    expect(position.turns).toBe(1);
  });

  it('refuses an illegal move, and says so', () => {
    const position = at({ p1: [[4, 1]], p2: [[POINTS - 1 - 7, 2]], dice: [3] });
    const result = applyMove(position, encodeMove(4, 3));
    expect(result.moved, 'a refusal is not a move that hit nothing').toBe(false);
    expect(ownAt(position, 'p1', 4)).toBe(1);
    expect(position.dice, 'and nothing was spent').toEqual([3]);
  });

  it('refuses to move before the dice are thrown', () => {
    const position = at({ p1: [[4, 1]] });
    expect(applyMove(position, encodeMove(4, 3)).moved).toBe(false);
  });

  it('lets a double move four times', () => {
    const position = at({ p1: [[4, 4]], dice: [2, 2, 2, 2] });
    for (let i = 0; i < 4; i += 1) applyMove(position, encodeMove(4, 2));
    expect(ownAt(position, 'p1', 6)).toBe(4);
    expect(position.seat, 'and only then changes hands').toBe('p2');
  });

  it('reads a move code back the way it went in', () => {
    for (const from of [BAR, 0, 7, 23]) {
      for (let die = 1; die <= DIE_FACES; die += 1) {
        const code = encodeMove(from, die);
        expect(moveFrom(code), 'from').toBe(from);
        expect(moveDie(code), 'die').toBe(die);
        expect(moveTo(code)).toBe(destinationOf(from, die));
      }
    }
  });
});

describe('hitting', () => {
  it('sends a lone checker to the bar', () => {
    const position = at({ p1: [[4, 1]], p2: [[POINTS - 1 - 7, 1]], dice: [3] });
    const result = applyMove(position, encodeMove(4, 3));
    expect(result.hit).toBe(true);
    expect(barOf(position, 'p2')).toBe(1);
    expect(ownAt(position, 'p1', 7), 'and takes the point').toBe(1);
  });

  it('leaves a point of two alone', () => {
    const position = at({ p1: [[4, 1]], p2: [[POINTS - 1 - 7, 2]], dice: [3] });
    expect(applyMove(position, encodeMove(4, 3)).hit).toBe(false);
    expect(barOf(position, 'p2')).toBe(0);
  });

  it('never hits its own', () => {
    const position = at({
      p1: [
        [4, 1],
        [7, 1],
      ],
      dice: [3],
    });
    const result = applyMove(position, encodeMove(4, 3));
    expect(result.hit).toBe(false);
    expect(ownAt(position, 'p1', 7), 'they stack up instead').toBe(2);
  });

  it('costs the victim twenty-five pips', () => {
    const position = at({ p1: [[4, 1]], p2: [[POINTS - 1 - 7, 1]], dice: [3] });
    const before = pipsLeft(position, 'p2');
    applyMove(position, encodeMove(4, 3));
    // The checker stood on their sixteenth point, nine pips from home, and now has the
    // whole board plus the bar to cross again.
    expect(pipsLeft(position, 'p2') - before).toBe(POINTS + 1 - (POINTS - (POINTS - 1 - 7)));
    expect(pipsGained(position, 'p2'), 'so the HUD number falls').toBeLessThan(START_PIPS - before);
  });

  it('brings the checker back on from the bar', () => {
    const position = at({ p1: [[4, 1]], p2: [[POINTS - 1 - 7, 1]], dice: [3] });
    applyMove(position, encodeMove(4, 3));
    position.seat = 'p2';
    position.phase = 'moving';
    position.dice.length = 0;
    position.dice.push(5);
    expect(canMove(position, 'p2', BAR, 5)).toBe(true);
    applyMove(position, encodeMove(BAR, 5));
    expect(ownAt(position, 'p2', 4)).toBe(1);
    expect(barOf(position, 'p2')).toBe(0);
  });
});

describe('bearing off and winning', () => {
  it('is won by bearing off all fifteen', () => {
    const position = at({ p1: [[23, 1]], off: [CHECKERS - 1, 0], dice: [1] });
    const result = applyMove(position, encodeMove(23, 1));
    expect(result.borneOff).toBe(true);
    expect(result.won).toBe(true);
    expect(winnerOf(position)).toBe('p1');
    expect(position.phase).toBe('over');
  });

  it('has no winner before that', () => {
    expect(winnerOf(createPosition())).toBeNull();
    expect(winnerOf(at({ off: [CHECKERS - 1, CHECKERS - 1] }))).toBeNull();
  });

  it('accepts nothing once it is decided', () => {
    const position = at({ p1: [[23, 1]], off: [CHECKERS - 1, 0], dice: [1, 1, 1, 1] });
    applyMove(position, encodeMove(23, 1));
    expect(applyMove(position, encodeMove(23, 1)).moved).toBe(false);
    expect(passTurn(position)).toBe(false);
  });

  it('settles the race on pips when the turn cap arrives', () => {
    const position = at({ p1: [[20, 1]], p2: [[2, 1]], turns: MAX_TURNS - 1 });
    expect(winnerOf(position), 'not yet').toBeNull();
    endTurn(position);
    expect(position.turns).toBe(MAX_TURNS);
    expect(pipsGained(position, 'p1')).toBeGreaterThan(pipsGained(position, 'p2'));
    expect(winnerOf(position), 'the one that has come furthest').toBe('p1');
  });

  it('calls a level race at the cap a draw', () => {
    const position = at({ p1: [[9, 3]], p2: [[9, 3]], turns: MAX_TURNS - 1 });
    endTurn(position);
    expect(winnerOf(position)).toBe('draw');
  });

  it('starts over on reset', () => {
    const position = at({ p1: [[23, 1]], off: [CHECKERS - 1, 3], bar: [2, 1], turns: 40 });
    position.winner = 'p1';
    position.phase = 'over';
    resetPosition(position);
    expect(checkersOn(position, 'p1')).toBe(CHECKERS);
    expect(position.winner).toBeNull();
    expect(position.phase).toBe('rolling');
    expect(position.turns).toBe(0);
    expect(pipsLeft(position, 'p2')).toBe(START_PIPS);
  });
});

describe('a turn with nothing in it', () => {
  it('passes', () => {
    const position = at({ p1: [[4, 1]], p2: [[POINTS - 1 - 7, 2]], dice: [3] });
    expect(passTurn(position)).toBe(true);
    expect(position.seat).toBe('p2');
    expect(position.phase).toBe('rolling');
  });

  it('refuses to pass a turn with a move in it', () => {
    // Otherwise a player could sit out a roll they did not like.
    const position = at({ p1: [[4, 1]], dice: [3] });
    expect(passTurn(position)).toBe(false);
    expect(position.seat).toBe('p1');
  });

  it('refuses to pass before the dice are thrown', () => {
    expect(passTurn(at({ p1: [[4, 1]] }))).toBe(false);
  });

  it('is what a closed home board does to a checker on the bar', () => {
    const shut: (readonly [number, number])[] = [];
    for (let travel = 0; travel < 6; travel += 1) shut.push([POINTS - 1 - travel, 2]);
    const position = at({ p1: [[10, 1]], p2: shut, bar: [1, 0], dice: [6, 3] });
    expect(hasMove(position, 'p1'), 'shut out entirely').toBe(false);
    expect(passTurn(position)).toBe(true);
  });
});

describe('the two seats are playing the same game', () => {
  it('offers a mirrored position the mirrored moves', () => {
    const position = at({
      p1: [
        [4, 1],
        [16, 3],
      ],
      p2: [
        [7, 2],
        [11, 1],
      ],
      bar: [0, 1],
      dice: [5, 2],
    });
    const mine = movesOf(position);
    const theirs = movesOf(mirrored(position));
    expect(theirs, 'the same moves, in the same order').toEqual(mine);
  });

  it('plays the mirrored move to the mirrored square', () => {
    const position = at({ p1: [[4, 1]], p2: [[POINTS - 1 - 7, 1]], dice: [3] });
    const other = mirrored(position);
    applyMove(position, encodeMove(4, 3));
    applyMove(other, encodeMove(4, 3));
    expect(ownAt(other, 'p2', 7)).toBe(ownAt(position, 'p1', 7));
    expect(barOf(other, 'p1'), 'and hits the same blot').toBe(barOf(position, 'p2'));
  });

  it('counts the same pips from either end', () => {
    const position = at({ p1: [[4, 2]], p2: [[9, 3]], bar: [1, 0] });
    const other = mirrored(position);
    expect(pipsLeft(other, 'p2')).toBe(pipsLeft(position, 'p1'));
    expect(pipsLeft(other, 'p1')).toBe(pipsLeft(position, 'p2'));
  });

  it('makes the same bot play the same move for either seat', () => {
    const position = at({
      p1: [
        [4, 1],
        [12, 2],
        [16, 1],
      ],
      p2: [
        [6, 1],
        [10, 2],
      ],
      dice: [6, 3],
    });
    for (const difficulty of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const mine = botMove(position, new Rng(19), difficulty);
      const theirs = botMove(mirrored(position), new Rng(19), difficulty);
      expect(theirs, `${difficulty} plays the seats differently`).toBe(mine);
    }
  });
});

describe('the bot', () => {
  const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('only ever names a move it may play', () => {
    for (const difficulty of DIFFICULTIES) {
      const rng = new Rng(31);
      const position = createPosition();
      for (let step = 0; step < 3000 && position.winner === null; step += 1) {
        if (position.phase === 'rolling') {
          roll(position, rng);
          continue;
        }
        const code = botMove(position, rng, difficulty);
        if (code < 0) {
          expect(hasMove(position, position.seat), `${difficulty} gave up with a move left`).toBe(
            false,
          );
          passTurn(position);
          continue;
        }
        expect(
          canMove(position, position.seat, moveFrom(code), moveDie(code)),
          `${difficulty} named an illegal move`,
        ).toBe(true);
        applyMove(position, code);
      }
    }
  });

  it('has nothing to say when it is shut out', () => {
    const position = at({ p1: [[4, 1]], p2: [[POINTS - 1 - 7, 2]], dice: [3] });
    expect(botMove(position, new Rng(3), 'hard')).toBe(-1);
  });

  it('takes a checker off when it can', () => {
    const position = at({
      p1: [
        [18, 1],
        [23, 1],
      ],
      off: [10, 0],
      dice: [1],
    });
    expect(botMove(position, new Rng(5), 'hard'), 'the one that comes off').toBe(encodeMove(23, 1));
  });

  it('hunts a blot on hard and does not on easy', () => {
    // The hit is the shorter move: only a bot that values hitting takes it.
    const build = (): Position =>
      at({
        p1: [
          [3, 1],
          [10, 1],
        ],
        p2: [[POINTS - 1 - 5, 1]],
        dice: [2],
      });
    const hit = encodeMove(3, 2);
    let hardHits = 0;
    let easyHits = 0;
    for (let seed = 1; seed <= 24; seed += 1) {
      if (botMove(build(), new Rng(seed), 'hard') === hit) hardHits += 1;
      if (botMove(build(), new Rng(seed), 'easy') === hit) easyHits += 1;
    }
    expect(hardHits, 'hard takes it every time').toBe(24);
    expect(easyHits, 'easy only stumbles onto it').toBeLessThan(hardHits);
  });

  it('keeps off a point the other seat can reach', () => {
    // The exposed move is the longer one, so only a bot that counts shots declines it.
    const build = (): Position =>
      at({
        p1: [
          [4, 1],
          [7, 1],
        ],
        p2: [[POINTS - 1 - 14, 1]],
        dice: [2],
      });
    const safe = encodeMove(4, 2);
    const exposed = encodeMove(7, 2);
    expect(exposure(build(), 'p1', 9), 'the far landing is under a direct shot').toBe(1);
    expect(exposure(build(), 'p1', 6), 'the near one is not').toBe(0);
    let hardSafe = 0;
    let easyExposed = 0;
    for (let seed = 1; seed <= 24; seed += 1) {
      if (botMove(build(), new Rng(seed), 'hard') === safe) hardSafe += 1;
      if (botMove(build(), new Rng(seed), 'easy') === exposed) easyExposed += 1;
    }
    expect(hardSafe, 'hard plays safe every time').toBe(24);
    expect(easyExposed, 'easy walks into it').toBeGreaterThan(0);
  });

  it('counts the direct shots on a point', () => {
    const position = at({
      p2: [
        [POINTS - 1 - 11, 1],
        [POINTS - 1 - 16, 1],
      ],
    });
    expect(exposure(position, 'p1', 10), 'both of them bear on it').toBe(2);
    expect(exposure(position, 'p1', 12), 'only the further one does').toBe(1);
    expect(exposure(position, 'p1', 17), 'both are past it').toBe(0);
    expect(exposure(position, 'p1', BAR), 'and the bar is not a point').toBe(0);
  });

  it('counts a re-entry from the bar as a shot', () => {
    const position = at({ bar: [0, 1] });
    // Their four enters on this seat's twenty-first point, which is travel index 20.
    expect(exposure(position, 'p1', POINTS - 4)).toBe(1);
    expect(exposure(position, 'p1', 5), 'they cannot enter that far in').toBe(0);
  });

  it('blunders more often the easier it is', () => {
    expect(BOT_PROFILES.easy.blunder).toBeGreaterThan(BOT_PROFILES.normal.blunder);
    expect(BOT_PROFILES.normal.blunder).toBeGreaterThan(BOT_PROFILES.hard.blunder);
    expect(BOT_PROFILES.hard.blunder).toBe(0);
  });

  it('reads more of the board the harder it is', () => {
    expect(BOT_PROFILES.easy.hits).toBe(false);
    expect(BOT_PROFILES.normal.hits).toBe(true);
    expect(BOT_PROFILES.hard.safety).toBeGreaterThan(BOT_PROFILES.normal.safety);
    expect(BOT_PROFILES.easy.safety).toBe(0);
  });

  it('wins more often the harder it is', () => {
    const play = (a: BotDifficulty, b: BotDifficulty): number => {
      let wins = 0;
      const games = 150;
      for (let seed = 0; seed < games; seed += 1) {
        const position = createPosition();
        const rng = new Rng(seed * 7919 + 13);
        for (let step = 0; step < 20_000 && position.winner === null; step += 1) {
          if (position.phase === 'rolling') {
            roll(position, rng);
            continue;
          }
          const code = botMove(position, rng, position.seat === 'p1' ? a : b);
          if (code < 0) passTurn(position);
          else applyMove(position, code);
        }
        if (position.winner === 'p1') wins += 1;
      }
      return wins / games;
    };
    const hardOverEasy = play('hard', 'easy');
    const normalOverEasy = play('normal', 'easy');
    const hardOverNormal = play('hard', 'normal');
    expect(hardOverEasy, `hard took ${String(hardOverEasy)} against easy`).toBeGreaterThan(0.8);
    expect(normalOverEasy, `normal took ${String(normalOverEasy)}`).toBeGreaterThan(0.75);
    expect(hardOverNormal, `hard took ${String(hardOverNormal)} against normal`).toBeGreaterThan(
      0.55,
    );
    expect(hardOverEasy).toBeGreaterThan(hardOverNormal);
  });

  it('always finishes a match, at every tier', () => {
    // Backgammon has no draw and no clock of its own: two weak players can hit each other
    // back and forth for a very long time, so the turn cap is what makes this true.
    for (const difficulty of DIFFICULTIES) {
      const position = createPosition();
      const rng = new Rng(97);
      for (let step = 0; step < 40_000 && position.winner === null; step += 1) {
        if (position.phase === 'rolling') {
          roll(position, rng);
          continue;
        }
        const code = botMove(position, rng, difficulty);
        if (code < 0) passTurn(position);
        else applyMove(position, code);
      }
      expect(position.winner, `${difficulty} never finished`).not.toBeNull();
      expect(position.turns).toBeLessThanOrEqual(MAX_TURNS);
    }
  });
});

describe('seats', () => {
  it('has two of them', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});
