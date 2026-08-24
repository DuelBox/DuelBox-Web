import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_PROFILES,
  HULL_CELLS,
  HULL_COLUMNS,
  HULL_ROWS,
  RECHARGE_TURNS,
  SHIELD_CHARGES,
  SHIELD_HALF_X,
  SHIELD_HALF_Y,
  SHIELD_MAX_X,
  SHIELD_MAX_Y,
  SHIELD_MIN_X,
  SHIELD_MIN_Y,
  SHIELD_SPEED,
  SHIELD_START_X,
  SHIELD_START_Y,
  aimAt,
  beginDefence,
  botTarget,
  breachCount,
  cellAt,
  cellCentreX,
  cellCentreY,
  clampShield,
  columnOf,
  coverX,
  coverY,
  createGame,
  createShip,
  defenderOf,
  inHull,
  intactCount,
  interceptX,
  interceptY,
  isBreached,
  nearestIntact,
  nudgeShield,
  openingAttacker,
  otherOf,
  parkX,
  parkY,
  passTurn,
  plateDistance,
  requiredTravel,
  resetGame,
  resolveShot,
  rowOf,
  shieldCovers,
  shieldLive,
  shipOf,
  steerShield,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game, Ship } from './rules.js';

/** Put the plate on a section, dead centre, the way a defender who arrived in time would. */
function coverCell(ship: Ship, cell: number): void {
  ship.shieldX = coverX(cell);
  ship.shieldY = coverY(cell);
}

/** Breach every section but the ones named, for stating an endgame directly. */
function breachAllExcept(ship: Ship, keep: readonly number[]): void {
  for (let cell = 0; cell < HULL_CELLS; cell += 1) {
    ship.breached[cell] = !keep.includes(cell);
  }
}

/** Fire the shot the game is currently set up for and hand the turn on. */
function shoot(game: Game, cell: number): void {
  aimAt(game, cell);
  beginDefence(game);
  resolveShot(game);
  passTurn(game);
}

describe('the hull', () => {
  it('is long and shallow, which is what the plate cannot cover', () => {
    expect(HULL_COLUMNS).toBe(6);
    expect(HULL_ROWS).toBe(2);
    expect(HULL_CELLS).toBe(12);
    expect(HULL_COLUMNS).toBeGreaterThan(HULL_ROWS * 2);
  });

  it('converts between sections and coordinates', () => {
    for (let cell = 0; cell < HULL_CELLS; cell += 1) {
      expect(cellAt(columnOf(cell), rowOf(cell))).toBe(cell);
    }
    expect(columnOf(cellAt(4, 1))).toBe(4);
    expect(rowOf(cellAt(4, 1))).toBe(1);
  });

  it('puts a section centre half a cell in from its corner', () => {
    expect(cellCentreX(cellAt(0, 0))).toBeCloseTo(0.5, 10);
    expect(cellCentreY(cellAt(0, 0))).toBeCloseTo(0.5, 10);
    expect(cellCentreX(cellAt(5, 1))).toBeCloseTo(5.5, 10);
    expect(cellCentreY(cellAt(5, 1))).toBeCloseTo(1.5, 10);
  });

  it('knows what is off the hull', () => {
    expect(inHull(0, 0)).toBe(true);
    expect(inHull(HULL_COLUMNS - 1, HULL_ROWS - 1)).toBe(true);
    expect(inHull(-1, 0)).toBe(false);
    expect(inHull(0, HULL_ROWS)).toBe(false);
    expect(inHull(HULL_COLUMNS, 0)).toBe(false);
  });

  it('starts whole, and counts what is left', () => {
    const ship = createShip();
    expect(intactCount(ship)).toBe(HULL_CELLS);
    expect(breachCount(ship)).toBe(0);
    ship.breached[3] = true;
    expect(intactCount(ship)).toBe(HULL_CELLS - 1);
    expect(breachCount(ship)).toBe(1);
  });

  it('treats a section that is not a section as gone, rather than as a hole to shoot at', () => {
    const ship = createShip();
    expect(isBreached(ship, -1)).toBe(true);
    expect(isBreached(ship, HULL_CELLS)).toBe(true);
    expect(isBreached(ship, 1.5)).toBe(true);
    expect(isBreached(ship, 0)).toBe(false);
  });
});

describe('the plate', () => {
  it('starts in the middle of the upper deck, identically for both seats', () => {
    const game = createGame();
    expect(game.p1.shieldX).toBe(game.p2.shieldX);
    expect(game.p1.shieldY).toBe(game.p2.shieldY);
    expect(shieldCovers(game.p1, cellAt(3, 0))).toBe(true);
  });

  it('stays wholly over the hull', () => {
    const ship = createShip();
    ship.shieldX = -50;
    ship.shieldY = 99;
    clampShield(ship);
    expect(ship.shieldX).toBe(SHIELD_MIN_X);
    expect(ship.shieldY).toBe(SHIELD_MAX_Y);
    expect(SHIELD_MIN_X).toBeCloseTo(SHIELD_HALF_X, 10);
    expect(SHIELD_MAX_X).toBeCloseTo(HULL_COLUMNS - SHIELD_HALF_X, 10);
  });

  it('covers a section it is standing over and not the one beside it', () => {
    const ship = createShip();
    coverCell(ship, cellAt(2, 0));
    expect(shieldCovers(ship, cellAt(2, 0))).toBe(true);
    expect(shieldCovers(ship, cellAt(3, 0))).toBe(false);
    expect(shieldCovers(ship, cellAt(2, 1))).toBe(false);
  });

  it('covers neither deck when it is left between them', () => {
    // The whole reason the plate is shorter than a deck: parking in the middle has to be
    // a mistake, or choosing a deck would cost nothing.
    const ship = createShip();
    ship.shieldX = 2.5;
    ship.shieldY = HULL_ROWS / 2;
    expect(shieldCovers(ship, cellAt(2, 0))).toBe(false);
    expect(shieldCovers(ship, cellAt(2, 1))).toBe(false);
    expect(SHIELD_HALF_Y).toBeLessThan(0.5);
  });

  it('is wider than a section, so a slide along the hull is forgiven a little', () => {
    const ship = createShip();
    coverCell(ship, cellAt(2, 0));
    ship.shieldX += 0.19;
    expect(shieldCovers(ship, cellAt(2, 0))).toBe(true);
    expect(SHIELD_HALF_X).toBeGreaterThan(0.5);
  });

  it('covers nothing at all once it has been knocked out', () => {
    const ship = createShip();
    coverCell(ship, cellAt(2, 0));
    ship.charges = 0;
    ship.downTurns = RECHARGE_TURNS;
    expect(shieldLive(ship)).toBe(false);
    expect(shieldCovers(ship, cellAt(2, 0))).toBe(false);
  });

  it('refuses a section that is not one', () => {
    const ship = createShip();
    expect(shieldCovers(ship, -3)).toBe(false);
    expect(shieldCovers(ship, HULL_CELLS + 2)).toBe(false);
  });

  it('can reach every section on the hull, or a shot would be unanswerable', () => {
    const ship = createShip();
    for (let cell = 0; cell < HULL_CELLS; cell += 1) {
      coverCell(ship, cell);
      expect(shieldCovers(ship, cell), `section ${String(cell)}`).toBe(true);
      expect(ship.shieldX).toBeGreaterThanOrEqual(SHIELD_MIN_X);
      expect(ship.shieldX).toBeLessThanOrEqual(SHIELD_MAX_X);
      expect(ship.shieldY).toBeGreaterThanOrEqual(SHIELD_MIN_Y);
      expect(ship.shieldY).toBeLessThanOrEqual(SHIELD_MAX_Y);
    }
  });

  it('asks for no travel at all to cover what it already covers', () => {
    const ship = createShip();
    coverCell(ship, cellAt(4, 1));
    expect(requiredTravel(ship, cellAt(4, 1))).toBeCloseTo(0, 10);
    expect(requiredTravel(ship, cellAt(0, 0))).toBeGreaterThan(2);
  });

  it('asks for less travel than the eye judges, because the plate has width', () => {
    // What separates the hardest tier from the middle one: "far from the plate" and "out
    // of the plate's reach" are different numbers, and only the second one decides a shot.
    const ship = createShip();
    coverCell(ship, cellAt(0, 0));
    const cell = cellAt(3, 0);
    expect(requiredTravel(ship, cell)).toBeLessThan(plateDistance(ship, cell));
    expect(requiredTravel(ship, cell)).toBeCloseTo(plateDistance(ship, cell) - SHIELD_HALF_X, 6);
  });
});

describe('sliding the plate', () => {
  it('arrives when the destination is within reach, and stops there', () => {
    const ship = createShip();
    const arrived = steerShield(ship, 4.5, 1.5, 10);
    expect(arrived).toBe(true);
    expect(ship.shieldX).toBeCloseTo(4.5, 10);
    expect(ship.shieldY).toBeCloseTo(1.5, 10);
  });

  it('travels exactly its reach when the destination is further', () => {
    const ship = createShip();
    ship.shieldX = 1;
    ship.shieldY = 1;
    const arrived = steerShield(ship, 5, 1, 0.4);
    expect(arrived).toBe(false);
    expect(ship.shieldX).toBeCloseTo(1.4, 10);
    expect(ship.shieldY).toBeCloseTo(1, 10);
  });

  it('never leaves the hull, however far away the destination is', () => {
    const ship = createShip();
    steerShield(ship, -900, 900, 100);
    expect(ship.shieldX).toBe(SHIELD_MIN_X);
    expect(ship.shieldY).toBe(SHIELD_MAX_Y);
  });

  it('ignores a destination that is not a number', () => {
    const ship = createShip();
    const before = ship.shieldX;
    expect(steerShield(ship, Number.NaN, 1, 1)).toBe(false);
    expect(steerShield(ship, 1, Number.POSITIVE_INFINITY, 1)).toBe(false);
    expect(steerShield(ship, 1, 1, Number.NaN)).toBe(false);
    expect(steerShield(ship, 1, 1, 0)).toBe(false);
    expect(ship.shieldX).toBe(before);
  });

  it('pushes along a direction, for the keys', () => {
    const ship = createShip();
    ship.shieldX = 3;
    nudgeShield(ship, 1, 0, 0.5);
    expect(ship.shieldX).toBeCloseTo(3.5, 10);
    nudgeShield(ship, -1, 0, 0.5);
    expect(ship.shieldX).toBeCloseTo(3, 10);
  });

  it('gives a diagonal no more ground than a straight push', () => {
    const straight = createShip();
    const diagonal = createShip();
    nudgeShield(straight, 1, 0, 1);
    nudgeShield(diagonal, 1, 1, 1);
    const dx = diagonal.shieldX - 3;
    const dy = diagonal.shieldY - 0.5;
    expect(Math.sqrt(dx * dx + dy * dy)).toBeCloseTo(straight.shieldX - 3, 10);
  });

  it('ignores a push of nothing', () => {
    const ship = createShip();
    const x = ship.shieldX;
    nudgeShield(ship, 0, 0, 1);
    nudgeShield(ship, Number.NaN, 0, 1);
    expect(ship.shieldX).toBe(x);
  });

  it('covers the same ground in a second whether that second is sixty steps or a hundred and twenty', () => {
    // Rule 8. The slide is linear in time, so its integral is step-size independent; a
    // per-step multiplier would make the plate quicker on a faster screen.
    const slow = createShip();
    const fast = createShip();
    slow.shieldX = 0.7;
    fast.shieldX = 0.7;
    for (let i = 0; i < 60; i += 1) steerShield(slow, 5.3, 0.5, SHIELD_SPEED / 60);
    for (let i = 0; i < 120; i += 1) steerShield(fast, 5.3, 0.5, SHIELD_SPEED / 120);
    expect(fast.shieldX).toBeCloseTo(slow.shieldX, 6);
    expect(slow.shieldX - 0.7).toBeCloseTo(SHIELD_SPEED, 6);
  });

  it('gives a pointer and a key the same speed, which is the whole of input parity', () => {
    const thumb = createShip();
    const keys = createShip();
    for (let i = 0; i < 30; i += 1) {
      steerShield(thumb, SHIELD_MAX_X, 0.5, SHIELD_SPEED / 60);
      nudgeShield(keys, 1, 0, SHIELD_SPEED / 60);
    }
    expect(thumb.shieldX).toBeCloseTo(keys.shieldX, 10);
  });
});

describe('aiming', () => {
  it('snaps to the section under the sight when it is still standing', () => {
    const game = createGame();
    expect(aimAt(game, cellAt(4, 1))).toBe(cellAt(4, 1));
    expect(game.target).toBe(cellAt(4, 1));
  });

  it('snaps to the nearest section still standing rather than to a hole', () => {
    const game = createGame();
    const defender = shipOf(game, defenderOf(game));
    defender.breached[cellAt(3, 0)] = true;
    // Along the hull and down a deck are the same distance away, and the tie breaks to
    // the lower index — arbitrary, but decided, which is what two devices need.
    expect(aimAt(game, cellAt(3, 0))).toBe(cellAt(2, 0));
    defender.breached[cellAt(2, 0)] = true;
    expect(aimAt(game, cellAt(3, 0))).toBe(cellAt(4, 0));
  });

  it('breaks a tie the same way every time, because two devices must snap alike', () => {
    const ship = createShip();
    ship.breached[cellAt(2, 0)] = true;
    expect(nearestIntact(ship, cellAt(2, 0))).toBe(cellAt(1, 0));
    expect(nearestIntact(ship, cellAt(2, 0))).toBe(cellAt(1, 0));
  });

  it('reports nothing left when the hull is gone', () => {
    const ship = createShip();
    ship.breached.fill(true);
    expect(nearestIntact(ship, 0)).toBe(-1);
  });

  it('holds its aim rather than throwing when there is nothing left to aim at', () => {
    const game = createGame();
    shipOf(game, 'p2').breached.fill(true);
    game.target = 5;
    expect(aimAt(game, 0)).toBe(5);
  });

  it('takes a section that is not a section as the near end of the hull', () => {
    const ship = createShip();
    expect(nearestIntact(ship, -12)).toBe(0);
    expect(nearestIntact(ship, HULL_CELLS + 4)).toBe(0);
  });
});

describe('a shot', () => {
  it('breaches a section the plate is nowhere near', () => {
    const game = createGame();
    aimAt(game, cellAt(5, 1));
    beginDefence(game);
    expect(resolveShot(game)).toBe('breach');
    expect(shipOf(game, 'p2').breached[cellAt(5, 1)]).toBe(true);
    expect(game.lastResult).toBe('breach');
  });

  it('is stopped by the plate, at the cost of a charge', () => {
    const game = createGame();
    const defender = shipOf(game, 'p2');
    coverCell(defender, cellAt(1, 1));
    aimAt(game, cellAt(1, 1));
    beginDefence(game);
    expect(resolveShot(game)).toBe('blocked');
    expect(defender.breached[cellAt(1, 1)]).toBe(false);
    expect(defender.charges).toBe(SHIELD_CHARGES - 1);
  });

  it('knocks the plate out when the last charge goes', () => {
    const game = createGame();
    const defender = shipOf(game, 'p2');
    defender.charges = 1;
    coverCell(defender, cellAt(1, 1));
    aimAt(game, cellAt(1, 1));
    beginDefence(game);
    resolveShot(game);
    expect(defender.charges).toBe(0);
    expect(defender.downTurns).toBe(RECHARGE_TURNS);
    expect(shieldLive(defender)).toBe(false);
  });

  it('gets through a plate that is being rebuilt, wherever it is standing', () => {
    const game = createGame();
    const defender = shipOf(game, 'p2');
    defender.charges = 0;
    defender.downTurns = RECHARGE_TURNS;
    coverCell(defender, cellAt(1, 1));
    aimAt(game, cellAt(1, 1));
    beginDefence(game);
    expect(resolveShot(game)).toBe('breach');
  });

  it('rebuilds the plate over exactly the turns it says it does', () => {
    const game = createGame();
    const defender = shipOf(game, 'p2');
    defender.charges = 1;
    coverCell(defender, cellAt(1, 1));
    shoot(game, cellAt(1, 1));
    expect(shieldLive(defender)).toBe(false);

    // Two turns of that ship being shot at, and the plate is back with a full set.
    let live = 0;
    for (let turn = 0; turn < RECHARGE_TURNS; turn += 1) {
      passTurn(game);
      expect(shieldLive(defender), `turn ${String(turn)}`).toBe(false);
      shoot(game, cellAt(turn, 0));
      if (shieldLive(defender)) live += 1;
    }
    expect(live).toBe(1);
    expect(defender.charges).toBe(SHIELD_CHARGES);
  });

  it('does nothing at all to a section already gone', () => {
    const game = createGame();
    const defender = shipOf(game, 'p2');
    defender.breached[3] = true;
    game.target = 3;
    beginDefence(game);
    expect(resolveShot(game)).toBe('none');
    expect(breachCount(defender)).toBe(1);
  });

  it('counts a turn whatever it found', () => {
    const game = createGame();
    aimAt(game, 0);
    beginDefence(game);
    resolveShot(game);
    expect(game.turns).toBe(1);
    passTurn(game);
    aimAt(game, 0);
    beginDefence(game);
    resolveShot(game);
    expect(game.turns).toBe(2);
  });

  it('leaves the board showing the result until the turn is passed', () => {
    const game = createGame();
    aimAt(game, 0);
    beginDefence(game);
    expect(game.phase).toBe('flight');
    resolveShot(game);
    expect(game.phase).toBe('reveal');
    passTurn(game);
    expect(game.phase).toBe('aim');
    expect(game.lastResult).toBe('none');
  });
});

describe('the turn', () => {
  it('changes hands the moment the shell is away', () => {
    const game = createGame();
    game.attacker = 'p1';
    expect(defenderOf(game)).toBe('p2');
    beginDefence(game);
    expect(game.phase).toBe('flight');
    expect(defenderOf(game)).toBe('p2');
  });

  it('passes to the other seat, trained on something still standing', () => {
    const game = createGame();
    game.target = cellAt(2, 0);
    shipOf(game, 'p1').breached[cellAt(2, 0)] = true;
    passTurn(game);
    expect(game.attacker).toBe('p2');
    expect(isBreached(shipOf(game, 'p1'), game.target)).toBe(false);
  });

  it('alternates for as long as the match runs', () => {
    const game = createGame();
    const seen: SeatId[] = [];
    for (let turn = 0; turn < 6; turn += 1) {
      seen.push(game.attacker);
      passTurn(game);
    }
    expect(seen).toEqual(['p1', 'p2', 'p1', 'p2', 'p1', 'p2']);
  });

  it('tosses for who fires first, from the seeded stream', () => {
    expect(openingAttacker(new Rng(4))).toBe(openingAttacker(new Rng(4)));
    const seats = new Set<SeatId>();
    for (let seed = 0; seed < 40; seed += 1) seats.add(openingAttacker(new Rng(seed)));
    expect(seats.size, 'both seats must be able to win the toss').toBe(2);
  });
});

describe('the match', () => {
  it('has no winner while both ships float', () => {
    const game = createGame();
    expect(winnerOf(game)).toBeNull();
    shipOf(game, 'p1').breached[0] = true;
    expect(winnerOf(game)).toBeNull();
  });

  it('goes to whoever breached the last section', () => {
    const game = createGame();
    shipOf(game, 'p2').breached.fill(true);
    expect(winnerOf(game)).toBe('p1');
    const other = createGame();
    shipOf(other, 'p1').breached.fill(true);
    expect(winnerOf(other)).toBe('p2');
  });

  it('cannot be drawn, because one shell lands at a time', () => {
    const game = createGame();
    breachAllExcept(shipOf(game, 'p1'), [0]);
    breachAllExcept(shipOf(game, 'p2'), [0]);
    expect(winnerOf(game)).toBeNull();
    shipOf(game, 'p2').breached[0] = true;
    expect(winnerOf(game)).toBe('p1');
  });

  it('starts over on reset', () => {
    const game = createGame();
    shipOf(game, 'p1').breached[4] = true;
    game.attacker = 'p2';
    game.phase = 'over';
    game.turns = 9;
    resetGame(game);
    expect(intactCount(game.p1)).toBe(HULL_CELLS);
    expect(intactCount(game.p2)).toBe(HULL_CELLS);
    expect(game.attacker).toBe('p1');
    expect(game.phase).toBe('aim');
    expect(game.turns).toBe(0);
    expect(game.p1.charges).toBe(SHIELD_CHARGES);
  });

  it('names the other seat, both ways', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });

  it('reads the same ship for a seat whichever way it is asked', () => {
    const game = createGame();
    expect(shipOf(game, 'p1')).toBe(game.p1);
    expect(shipOf(game, 'p2')).toBe(game.p2);
  });

  it('cannot be defended for ever: two shots in four always get through', () => {
    // The stalemate argument, run rather than asserted. A defender who covers every shot
    // it is offered still loses its plate every second turn, so the hull always falls.
    const game = createGame();
    let guard = 0;
    while (winnerOf(game) === null && guard < 400) {
      guard += 1;
      const defender = shipOf(game, defenderOf(game));
      const cell = nearestIntact(defender, 0);
      // The strongest possible defence: the plate is already exactly where the shell is
      // going, every single time.
      coverCell(defender, cell);
      shoot(game, cell);
    }
    expect(winnerOf(game)).not.toBeNull();
    expect(game.turns).toBeLessThanOrEqual(HULL_CELLS * 4);
  });
});

describe('the bot', () => {
  const tiers: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('only ever names a section that is still standing', () => {
    for (const tier of tiers) {
      const ship = createShip();
      const rng = new Rng(11);
      for (let shot = 0; shot < HULL_CELLS; shot += 1) {
        const cell = botTarget(ship, rng, tier);
        expect(cell, tier).toBeGreaterThanOrEqual(0);
        expect(isBreached(ship, cell), tier).toBe(false);
        ship.breached[cell] = true;
      }
      expect(botTarget(ship, rng, tier), tier).toBe(-1);
    }
  });

  it('fires out of the plate reach on hard', () => {
    const ship = createShip();
    coverCell(ship, cellAt(0, 0));
    const cell = botTarget(ship, new Rng(3), 'hard');
    expect(columnOf(cell)).toBe(HULL_COLUMNS - 1);
    expect(requiredTravel(ship, cell)).toBeGreaterThan(2);
  });

  it('never fires under the plate on hard, from any position', () => {
    for (let parked = 0; parked < HULL_CELLS; parked += 1) {
      const ship = createShip();
      coverCell(ship, parked);
      const cell = botTarget(ship, new Rng(parked + 1), 'hard');
      expect(shieldCovers(ship, cell), `parked on ${String(parked)}`).toBe(false);
    }
  });

  it('fires wherever it likes on easy, which is the whole of the difference', () => {
    const ship = createShip();
    coverCell(ship, cellAt(0, 0));
    const rng = new Rng(9);
    const seen = new Set<number>();
    for (let shot = 0; shot < 40; shot += 1) seen.add(botTarget(ship, rng, 'easy'));
    expect(seen.size).toBeGreaterThan(6);
  });

  it('picks one section again and again on hard, because one is right', () => {
    const ship = createShip();
    coverCell(ship, cellAt(0, 0));
    const rng = new Rng(9);
    const seen = new Set<number>();
    for (let shot = 0; shot < 40; shot += 1) seen.add(botTarget(ship, rng, 'hard'));
    expect(seen.size).toBe(1);
  });

  it('strays sometimes on normal and never on hard', () => {
    const ship = createShip();
    coverCell(ship, cellAt(0, 0));
    const best = botTarget(ship, new Rng(1), 'hard');
    let strayed = 0;
    const rng = new Rng(21);
    for (let shot = 0; shot < 120; shot += 1) {
      if (botTarget(ship, rng, 'normal') !== best) strayed += 1;
    }
    expect(strayed).toBeGreaterThan(10);
    expect(strayed).toBeLessThan(90);
  });

  it('reads the plate width only on hard', () => {
    expect(BOT_PROFILES.hard.readsReach).toBe(true);
    expect(BOT_PROFILES.normal.readsReach).toBe(false);
    expect(BOT_PROFILES.easy.readsReach).toBe(false);
  });

  it('gets quicker, steadier and more accurate as it gets harder', () => {
    expect(BOT_PROFILES.easy.reactSeconds).toBeGreaterThan(BOT_PROFILES.normal.reactSeconds);
    expect(BOT_PROFILES.normal.reactSeconds).toBeGreaterThan(BOT_PROFILES.hard.reactSeconds);
    expect(BOT_PROFILES.easy.aimSpread).toBeGreaterThan(BOT_PROFILES.normal.aimSpread);
    expect(BOT_PROFILES.normal.aimSpread).toBeGreaterThan(BOT_PROFILES.hard.aimSpread);
    expect(BOT_PROFILES.easy.strayShots).toBeGreaterThan(BOT_PROFILES.normal.strayShots);
    expect(BOT_PROFILES.normal.strayShots).toBeGreaterThan(BOT_PROFILES.hard.strayShots);
    expect(BOT_PROFILES.easy.fireSeconds).toBeGreaterThan(BOT_PROFILES.hard.fireSeconds);
  });

  it('misjudges wide enough to miss the plate on easy and not on hard', () => {
    // The spread has to be measured against the plate: an error smaller than the plate's
    // own half-width cannot cost a block, so a tier whose spread is inside it is precise.
    expect(BOT_PROFILES.easy.aimSpread).toBeGreaterThan(SHIELD_HALF_X);
    expect(BOT_PROFILES.normal.aimSpread).toBeGreaterThan(SHIELD_HALF_Y);
    expect(BOT_PROFILES.hard.aimSpread).toBeLessThan(SHIELD_HALF_Y);
  });

  it('replays identically from the same seed', () => {
    const one: number[] = [];
    const two: number[] = [];
    for (const out of [one, two]) {
      const ship = createShip();
      const rng = new Rng(2026);
      for (let shot = 0; shot < 30; shot += 1) out.push(botTarget(ship, rng, 'normal'));
    }
    expect(two).toEqual(one);
  });

  it('parks over the middle of what it has left', () => {
    const ship = createShip();
    expect(parkX(ship)).toBeCloseTo(HULL_COLUMNS / 2, 10);
    breachAllExcept(ship, [cellAt(0, 0), cellAt(1, 0)]);
    expect(parkX(ship)).toBeCloseTo(1, 10);
  });

  it('never parks between the two decks, where it would cover neither', () => {
    const ship = createShip();
    const y = parkY(ship);
    expect(shieldCovers({ ...ship, shieldY: y }, cellAt(3, 0))).toBe(true);
    breachAllExcept(ship, [cellAt(3, 1)]);
    const lower = { ...ship, shieldX: parkX(ship), shieldY: parkY(ship) };
    expect(shieldCovers(lower, cellAt(3, 1))).toBe(true);
  });

  it('parks somewhere legal even with nothing left to protect', () => {
    const ship = createShip();
    ship.breached.fill(true);
    expect(parkX(ship)).toBeGreaterThanOrEqual(SHIELD_MIN_X);
    expect(parkX(ship)).toBeLessThanOrEqual(SHIELD_MAX_X);
    expect(parkY(ship)).toBeGreaterThanOrEqual(SHIELD_MIN_Y);
    expect(parkY(ship)).toBeLessThanOrEqual(SHIELD_MAX_Y);
  });

  it('reads only the hull and the plate, which are both drawn on the screen', () => {
    // Rule 6, as a property: the bot's choice may depend on what is breached and where
    // the plate is, and there is nothing else in a ship for it to have read.
    const ship = createShip();
    coverCell(ship, cellAt(0, 0));
    const before = botTarget(ship, new Rng(5), 'hard');
    const copy: Ship = {
      breached: [...ship.breached],
      shieldX: ship.shieldX,
      shieldY: ship.shieldY,
      charges: 0,
      downTurns: 99,
    };
    expect(botTarget(copy, new Rng(5), 'hard')).toBe(before);
  });
});

describe('both seats', () => {
  it('play the same game, mirrored', () => {
    // Seat symmetry, stated rather than assumed: the same shots against the same hull
    // give the same answers whichever seat is holding the gun.
    const left = createGame();
    const right = createGame();
    left.attacker = 'p1';
    right.attacker = 'p2';
    const shots = [cellAt(0, 0), cellAt(3, 1), cellAt(5, 0), cellAt(2, 1)];

    for (const cell of shots) {
      coverCell(shipOf(left, defenderOf(left)), cellAt(0, 0));
      coverCell(shipOf(right, defenderOf(right)), cellAt(0, 0));
      aimAt(left, cell);
      aimAt(right, cell);
      beginDefence(left);
      beginDefence(right);
      expect(resolveShot(right)).toBe(resolveShot(left));
      passTurn(left);
      passTurn(right);
      passTurn(left);
      passTurn(right);
    }

    expect(shipOf(right, 'p1').breached).toEqual(shipOf(left, 'p2').breached);
    expect(shipOf(right, 'p1').charges).toBe(shipOf(left, 'p2').charges);
  });

  it('are handed the same bot, on the same seed', () => {
    const ship = createShip();
    const mirrored = createShip();
    coverCell(ship, cellAt(2, 0));
    coverCell(mirrored, cellAt(2, 0));
    expect(botTarget(mirrored, new Rng(77), 'hard')).toBe(botTarget(ship, new Rng(77), 'hard'));
  });
});

/**
 * The hull is symmetric end to end, so every rule about it must be too.
 *
 * Mirroring is the sharpest form of the seat question this game can be asked. The two
 * seats hold identical ships, and if any rule preferred one end of a hull over the other
 * then which end a player happened to be defending would matter — which is the same
 * unfairness as one seat being favoured, expressed on one ship instead of two.
 */
function mirrorCell(cell: number): number {
  return cellAt(HULL_COLUMNS - 1 - columnOf(cell), rowOf(cell));
}

function mirrorShip(ship: Ship): Ship {
  const breached = new Array<boolean>(HULL_CELLS).fill(false);
  for (let cell = 0; cell < HULL_CELLS; cell += 1) {
    breached[mirrorCell(cell)] = ship.breached[cell] === true;
  }
  return {
    breached,
    shieldX: HULL_COLUMNS - ship.shieldX,
    shieldY: ship.shieldY,
    charges: ship.charges,
    downTurns: ship.downTurns,
  };
}

describe('the hull read from the other end', () => {
  it('asks the plate for the same slide either way round', () => {
    const ship = createShip();
    ship.shieldX = 1.4;
    ship.shieldY = 1.5;
    const flipped = mirrorShip(ship);
    for (let cell = 0; cell < HULL_CELLS; cell += 1) {
      expect(requiredTravel(flipped, mirrorCell(cell)), `section ${String(cell)}`).toBeCloseTo(
        requiredTravel(ship, cell),
        10,
      );
      expect(plateDistance(flipped, mirrorCell(cell)), `section ${String(cell)}`).toBeCloseTo(
        plateDistance(ship, cell),
        10,
      );
    }
  });

  it('covers the mirrored section when the plate is mirrored', () => {
    const ship = createShip();
    coverCell(ship, cellAt(1, 1));
    const flipped = mirrorShip(ship);
    for (let cell = 0; cell < HULL_CELLS; cell += 1) {
      expect(shieldCovers(flipped, mirrorCell(cell)), `section ${String(cell)}`).toBe(
        shieldCovers(ship, cell),
      );
    }
  });

  it('sends the bot to the mirrored section', () => {
    // `hard` only, and for a reason worth stating: the other two tiers stray, and a stray
    // shot is drawn as an *index* into what is left standing. Two mirrored hulls hand the
    // same index to the same seeded draw, so the stray lands on the same section rather
    // than on its mirror — which is the RNG behaving, not the rule being asymmetric.
    const ship = createShip();
    coverCell(ship, cellAt(0, 0));
    const flipped = mirrorShip(ship);
    for (let seed = 1; seed <= 8; seed += 1) {
      const chosen = botTarget(ship, new Rng(seed), 'hard');
      expect(botTarget(flipped, new Rng(seed), 'hard'), `seed ${String(seed)}`).toBe(
        mirrorCell(chosen),
      );
    }
  });

  it('parks the plate at the mirrored point', () => {
    const ship = createShip();
    breachAllExcept(ship, [cellAt(0, 0), cellAt(1, 0), cellAt(2, 1)]);
    const flipped = mirrorShip(ship);
    expect(parkX(flipped)).toBeCloseTo(HULL_COLUMNS - parkX(ship), 10);
    expect(parkY(flipped)).toBeCloseTo(parkY(ship), 10);
  });

  it('plays the mirrored match to the mirrored end', () => {
    const left = createGame();
    const right = createGame();
    const shots = [cellAt(0, 0), cellAt(5, 1), cellAt(2, 0), cellAt(3, 1), cellAt(1, 1)];
    for (const cell of shots) {
      // Both defenders hold the same station, one read from each end of the hull.
      coverCell(shipOf(left, defenderOf(left)), cellAt(2, 0));
      const rightShip = shipOf(right, defenderOf(right));
      rightShip.shieldX = HULL_COLUMNS - coverX(cellAt(2, 0));
      rightShip.shieldY = coverY(cellAt(2, 0));
      aimAt(left, cell);
      aimAt(right, mirrorCell(cell));
      beginDefence(left);
      beginDefence(right);
      expect(resolveShot(right), `section ${String(cell)}`).toBe(resolveShot(left));
      passTurn(left);
      passTurn(right);
      passTurn(left);
      passTurn(right);
    }
    const target = shipOf(left, 'p2');
    const flipped = shipOf(right, 'p2');
    for (let cell = 0; cell < HULL_CELLS; cell += 1) {
      expect(flipped.breached[mirrorCell(cell)], `section ${String(cell)}`).toBe(
        target.breached[cell],
      );
    }
    expect(flipped.charges).toBe(target.charges);
  });
});

describe('the edge of the plate', () => {
  it('stops covering a section exactly a half-width away, on both axes', () => {
    // A knife edge either way, and it has to fall in the same place on every device: the
    // rule is a comparison against the half-extents and nothing else, so two devices
    // resolving the same shell from the same plate position always agree.
    const ship = createShip();
    const cell = cellAt(2, 0);
    ship.shieldY = cellCentreY(cell);
    ship.shieldX = cellCentreX(cell) + SHIELD_HALF_X - 1e-9;
    expect(shieldCovers(ship, cell), 'a hair inside the edge is covered').toBe(true);
    ship.shieldX = cellCentreX(cell) + SHIELD_HALF_X + 1e-9;
    expect(shieldCovers(ship, cell), 'a hair outside it is not').toBe(false);

    ship.shieldX = cellCentreX(cell);
    ship.shieldY = cellCentreY(cell) + SHIELD_HALF_Y - 1e-9;
    expect(shieldCovers(ship, cell), 'and the same across the decks').toBe(true);
    ship.shieldY = cellCentreY(cell) + SHIELD_HALF_Y + 1e-9;
    expect(shieldCovers(ship, cell)).toBe(false);
  });

  it('needs no slide at all for a section it is exactly touching', () => {
    const ship = createShip();
    const cell = cellAt(4, 0);
    ship.shieldX = cellCentreX(cell) - SHIELD_HALF_X;
    ship.shieldY = cellCentreY(cell);
    expect(requiredTravel(ship, cell)).toBeCloseTo(0, 10);
  });

  it('cannot be asked to stand off the hull to cover an end section', () => {
    // `interceptX` is clamped to the plate's own travel, so the answer for a section at
    // the very end of the hull is a place the plate can actually be.
    const ship = createShip();
    for (const cell of [cellAt(0, 0), cellAt(HULL_COLUMNS - 1, HULL_ROWS - 1)]) {
      expect(interceptX(ship, cell)).toBeGreaterThanOrEqual(SHIELD_MIN_X);
      expect(interceptX(ship, cell)).toBeLessThanOrEqual(SHIELD_MAX_X);
      expect(interceptY(ship, cell)).toBeGreaterThanOrEqual(SHIELD_MIN_Y);
      expect(interceptY(ship, cell)).toBeLessThanOrEqual(SHIELD_MAX_Y);
    }
  });

  it('punishes a plate left at one end and forgives one kept in the middle', () => {
    // **This is the game.** A shell is in the air for 1.4 seconds and the plate covers
    // 2.52 hull cells in that time, so whether a shot can be answered at all is decided
    // before it is fired, by where the defender chose to leave the plate. From an end of
    // the hull the far end is out of reach and the gunner takes a section for free; from
    // the middle every section is answerable and the defender is only racing.
    const flightReach = SHIELD_SPEED * 1.4;
    const worstFrom = (x: number, y: number): number => {
      const ship = createShip();
      ship.shieldX = x;
      ship.shieldY = y;
      let worst = -1;
      for (let cell = 0; cell < HULL_CELLS; cell += 1) {
        worst = Math.max(worst, requiredTravel(ship, cell));
      }
      return worst;
    };
    expect(
      worstFrom(SHIELD_MIN_X, 0.5),
      'parked at the bow, the stern is unanswerable',
    ).toBeGreaterThan(flightReach);
    expect(worstFrom(SHIELD_MAX_X, 1.5), 'and the same at the other end').toBeGreaterThan(
      flightReach,
    );
    expect(
      worstFrom(SHIELD_START_X, SHIELD_START_Y),
      'from where a fresh plate sits, every section is reachable in a flight',
    ).toBeLessThan(flightReach);
    // And the section that costs the most from the middle is at an end of the hull, which
    // is why the hull is long and shallow in the first place.
    const ship = createShip();
    let worstCell = -1;
    let worst = -1;
    for (let cell = 0; cell < HULL_CELLS; cell += 1) {
      const travel = requiredTravel(ship, cell);
      if (travel > worst) {
        worst = travel;
        worstCell = cell;
      }
    }
    expect(columnOf(worstCell) === 0 || columnOf(worstCell) === HULL_COLUMNS - 1).toBe(true);
  });
});

describe('the shell at the boundary', () => {
  it('leaves a plate that is standing over a hole with nothing to do', () => {
    const game = createGame();
    const defender = shipOf(game, 'p2');
    defender.breached[cellAt(1, 1)] = true;
    coverCell(defender, cellAt(1, 1));
    aimAt(game, cellAt(1, 1));
    game.target = cellAt(1, 1);
    beginDefence(game);
    expect(resolveShot(game)).toBe('none');
    expect(defender.charges, 'a charge is not spent on a hole').toBe(SHIELD_CHARGES);
  });

  it('spends the plate on the twelfth section as readily as on the first', () => {
    const game = createGame();
    const defender = shipOf(game, 'p2');
    breachAllExcept(defender, [cellAt(5, 1)]);
    coverCell(defender, cellAt(5, 1));
    aimAt(game, cellAt(5, 1));
    beginDefence(game);
    expect(resolveShot(game)).toBe('blocked');
    expect(winnerOf(game), 'a block on the last section is a reprieve').toBeNull();
    expect(intactCount(defender)).toBe(1);
  });

  it('stops two shells in every four, however perfectly it is played', () => {
    // The termination argument as a measurement. A block costs a charge and a spent plate
    // is out for two defensive turns, so a defender who never misses still lets half
    // through — and the ceiling is what makes a stalemate impossible rather than unlikely.
    //
    // Counted per hull rather than over the match: the match stops the instant one hull is
    // gone, which can leave the *other* defender mid-block and put a whole-match ratio a
    // shot or two either side of a half for a reason that says nothing about the rule.
    const game = createGame();
    const blocked = { p1: 0, p2: 0 };
    const breached = { p1: 0, p2: 0 };
    let shots = 0;
    while (winnerOf(game) === null && shots < 400) {
      const seat = defenderOf(game);
      const defender = shipOf(game, seat);
      const cell = nearestIntact(defender, 0);
      coverCell(defender, cell);
      aimAt(game, cell);
      beginDefence(game);
      const result = resolveShot(game);
      if (result === 'blocked') blocked[seat] += 1;
      if (result === 'breach') breached[seat] += 1;
      shots += 1;
      passTurn(game);
    }
    const sunk: SeatId = winnerOf(game) === 'p1' ? 'p2' : 'p1';
    expect(winnerOf(game), 'somebody sank').not.toBeNull();
    expect(breached[sunk], 'twelve sections went').toBe(HULL_CELLS);
    expect(
      blocked[sunk],
      `${sunk} blocked ${String(blocked[sunk])} and lost ${String(breached[sunk])}`,
    ).toBeLessThanOrEqual(breached[sunk]);
    expect(blocked[sunk], 'and a perfect defender does reach the ceiling').toBe(HULL_CELLS);
  });

  it('never lets a plate recharge on a turn it stopped something', () => {
    // The plate comes back one turn at a time, and only on turns it did not block —
    // otherwise a defender could hold a shell off and rebuild in the same breath.
    const game = createGame();
    const defender = shipOf(game, 'p2');
    defender.charges = 0;
    defender.downTurns = RECHARGE_TURNS;
    coverCell(defender, cellAt(0, 0));
    aimAt(game, cellAt(0, 0));
    beginDefence(game);
    expect(resolveShot(game)).toBe('breach');
    expect(defender.downTurns).toBe(RECHARGE_TURNS - 1);
    expect(shieldLive(defender)).toBe(false);
  });
});

describe('the toss', () => {
  it('falls close to even over many matches', () => {
    let p1 = 0;
    const matches = 600;
    for (let seed = 0; seed < matches; seed += 1) {
      if (openingAttacker(new Rng(seed * 31 + 7)) === 'p1') p1 += 1;
    }
    const share = p1 / matches;
    expect(share, `p1 won the toss ${String(p1)} times in ${String(matches)}`).toBeGreaterThan(
      0.42,
    );
    expect(share).toBeLessThan(0.58);
  });

  it('does not depend on which seat asks', () => {
    // Both devices toss the same coin: the seat is read out of the stream, never out of
    // who happens to be calling.
    for (let seed = 0; seed < 20; seed += 1) {
      expect(openingAttacker(new Rng(seed))).toBe(openingAttacker(new Rng(seed)));
    }
  });
});
