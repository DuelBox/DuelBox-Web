import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  BOT_PROFILES,
  CELL_COUNT,
  FLEET,
  FLEET_CELLS,
  GRID,
  botShot,
  canPlace,
  cellAt,
  columnOf,
  createBotMemory,
  createGame,
  fire,
  fleetDestroyed,
  fleetOf,
  hitCount,
  inBounds,
  nextShipLength,
  place,
  placeRandomFleet,
  recordPlacement,
  rememberShot,
  resetBotMemory,
  resetGame,
  rowOf,
  shipCells,
  shipsRemaining,
  smallestAfloat,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Fleet, Game } from './rules.js';

function fleetWith(...ships: { cell: number; length: number; across?: boolean }[]): Fleet {
  const game = createGame();
  const fleet = game.p1;
  for (const ship of ships) {
    const placed = place(fleet, ship.cell, ship.length, ship.across === false ? 'down' : 'across');
    if (!placed) throw new Error(`fixture ship at ${String(ship.cell)} does not fit`);
  }
  return fleet;
}

describe('the grid', () => {
  it('is ten by ten', () => {
    expect(GRID).toBe(10);
    expect(CELL_COUNT).toBe(100);
  });

  it('converts between cells and coordinates', () => {
    expect(columnOf(cellAt(3, 7))).toBe(3);
    expect(rowOf(cellAt(3, 7))).toBe(7);
  });

  it('knows what is off the grid', () => {
    expect(inBounds(-1, 0)).toBe(false);
    expect(inBounds(0, GRID)).toBe(false);
    expect(inBounds(GRID - 1, GRID - 1)).toBe(true);
  });
});

describe('laying out a ship', () => {
  it('occupies the cells it covers', () => {
    const cells: number[] = [];
    shipCells(cells, cellAt(2, 3), 4, 'across');
    expect(cells).toEqual([cellAt(2, 3), cellAt(3, 3), cellAt(4, 3), cellAt(5, 3)]);
  });

  it('runs down as well as across', () => {
    const cells: number[] = [];
    shipCells(cells, cellAt(2, 3), 3, 'down');
    expect(cells).toEqual([cellAt(2, 3), cellAt(2, 4), cellAt(2, 5)]);
  });

  it('refuses to hang off the edge', () => {
    const cells: number[] = [];
    expect(shipCells(cells, cellAt(7, 0), 5, 'across'), '7 + 5 is past the tenth column').toBe(0);
    expect(shipCells(cells, cellAt(0, 8), 3, 'down')).toBe(0);
  });

  it('refuses to overlap another ship', () => {
    const fleet = fleetWith({ cell: cellAt(2, 2), length: 4 });
    expect(canPlace(fleet, cellAt(4, 2), 3, 'across')).toBe(false);
  });

  it('refuses to touch another ship, even at a corner', () => {
    // The no-touching rule is what makes "a sunk ship's neighbours are water" sound, and
    // the hard bot's deduction rests on it.
    const fleet = fleetWith({ cell: cellAt(4, 4), length: 3 });
    expect(canPlace(fleet, cellAt(3, 3), 2, 'across'), 'diagonally adjacent').toBe(false);
    expect(canPlace(fleet, cellAt(4, 3), 2, 'across'), 'directly above').toBe(false);
  });

  it('allows a ship one clear cell away', () => {
    const fleet = fleetWith({ cell: cellAt(4, 4), length: 3 });
    expect(canPlace(fleet, cellAt(4, 6), 3, 'across')).toBe(true);
  });

  it('refuses a cell that is not a cell', () => {
    const fleet = fleetWith();
    expect(canPlace(fleet, -1, 3, 'across')).toBe(false);
    expect(canPlace(fleet, CELL_COUNT, 3, 'across')).toBe(false);
    expect(canPlace(fleet, 4.5, 3, 'across')).toBe(false);
  });

  it('reports a refusal rather than silently doing nothing', () => {
    const fleet = fleetWith({ cell: cellAt(0, 0), length: 4 });
    expect(place(fleet, cellAt(0, 0), 3, 'across')).toBe(false);
    expect(fleet.ships.length, 'and nothing was added').toBe(1);
  });
});

describe('a random fleet', () => {
  it('places every ship, legally, from any seed', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const game = createGame();
      placeRandomFleet(game.p1, new Rng(seed));
      expect(game.p1.ships.length, `seed ${String(seed)}`).toBe(FLEET.length);

      let occupied = 0;
      for (let cell = 0; cell < CELL_COUNT; cell += 1) {
        if ((game.p1.occupancy[cell] ?? -1) >= 0) occupied += 1;
      }
      expect(occupied, 'no ship overlaps another').toBe(FLEET_CELLS);
    }
  });

  it('never lets two ships touch', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const game = createGame();
      placeRandomFleet(game.p1, new Rng(seed));
      for (let cell = 0; cell < CELL_COUNT; cell += 1) {
        const here = game.p1.occupancy[cell] ?? -1;
        if (here < 0) continue;
        const column = columnOf(cell);
        const row = rowOf(cell);
        for (let dRow = -1; dRow <= 1; dRow += 1) {
          for (let dColumn = -1; dColumn <= 1; dColumn += 1) {
            const nc = column + dColumn;
            const nr = row + dRow;
            if (!inBounds(nc, nr)) continue;
            const other = game.p1.occupancy[cellAt(nc, nr)] ?? -1;
            if (other >= 0 && other !== here) {
              expect.fail(`seed ${String(seed)}: ships ${String(here)} and ${String(other)} touch`);
            }
          }
        }
      }
    }
  });

  it('replays identically from the same seed', () => {
    const layout = (): string => {
      const game = createGame();
      placeRandomFleet(game.p1, new Rng(77));
      return game.p1.ships.map((s) => `${String(s.cell)}${s.orientation}`).join(',');
    };
    expect(layout()).toBe(layout());
  });
});

describe('firing', () => {
  function ready(): Game {
    const game = createGame();
    place(game.p2, cellAt(0, 0), 2, 'across');
    game.phase = 'firing';
    return game;
  }

  it('misses empty water', () => {
    expect(fire(ready(), 'p2', cellAt(5, 5)).result).toBe('miss');
  });

  it('hits a ship', () => {
    expect(fire(ready(), 'p2', cellAt(0, 0)).result).toBe('hit');
  });

  it('sinks a ship on its last cell', () => {
    const game = ready();
    expect(fire(game, 'p2', cellAt(0, 0)).result).toBe('hit');
    const last = fire(game, 'p2', cellAt(1, 0));
    expect(last.result).toBe('sunk');
    expect(last.sunk?.length).toBe(2);
  });

  it('refuses a cell already called', () => {
    const game = ready();
    fire(game, 'p2', cellAt(5, 5));
    expect(fire(game, 'p2', cellAt(5, 5)).result, 'a repeat is not a free miss').toBe('repeat');
  });

  it('refuses to fire before the fleets are laid out', () => {
    const game = createGame();
    place(game.p2, cellAt(0, 0), 2, 'across');
    expect(game.phase).toBe('placing');
    expect(fire(game, 'p2', cellAt(0, 0)).result).toBe('repeat');
  });

  it('refuses a cell that is not a cell', () => {
    const game = ready();
    expect(fire(game, 'p2', -1).result).toBe('repeat');
    expect(fire(game, 'p2', CELL_COUNT).result).toBe('repeat');
  });

  it('counts damage', () => {
    const game = ready();
    fire(game, 'p2', cellAt(0, 0));
    expect(hitCount(game.p2)).toBe(1);
  });
});

describe('the match', () => {
  it('starts firing only once both fleets are laid out', () => {
    const game = createGame();
    for (let i = 0; i < FLEET.length; i += 1) recordPlacement(game, 'p1');
    expect(game.phase, 'seat two has not finished').toBe('placing');
    for (let i = 0; i < FLEET.length; i += 1) recordPlacement(game, 'p2');
    expect(game.phase).toBe('firing');
    expect(game.seat, 'seat one calls the first shot').toBe('p1');
  });

  it('walks each seat through the fleet in order', () => {
    const game = createGame();
    for (const length of FLEET) {
      expect(nextShipLength(game, 'p1')).toBe(length);
      recordPlacement(game, 'p1');
    }
    expect(nextShipLength(game, 'p1'), 'the fleet is laid out').toBe(0);
  });

  it('has no winner while a ship is afloat', () => {
    const game = createGame();
    placeRandomFleet(game.p1, new Rng(1));
    placeRandomFleet(game.p2, new Rng(2));
    game.phase = 'firing';
    expect(winnerOf(game)).toBeNull();
  });

  it('gives the match to whoever sinks the last ship', () => {
    const game = createGame();
    placeRandomFleet(game.p1, new Rng(3));
    placeRandomFleet(game.p2, new Rng(4));
    game.phase = 'firing';
    for (let cell = 0; cell < CELL_COUNT; cell += 1) fire(game, 'p2', cell);
    expect(fleetDestroyed(game.p2)).toBe(true);
    expect(winnerOf(game)).toBe('p1');
  });

  it('does not call an empty fleet destroyed', () => {
    // Before placement every fleet has no ships, and "all of nothing is sunk" would end
    // the match before it began.
    const game = createGame();
    expect(fleetDestroyed(game.p1)).toBe(false);
    expect(winnerOf(game)).toBeNull();
  });

  it('counts the ships still afloat', () => {
    const game = createGame();
    place(game.p2, cellAt(0, 0), 2, 'across');
    place(game.p2, cellAt(0, 3), 3, 'across');
    game.phase = 'firing';
    expect(shipsRemaining(game.p2)).toBe(2);
    fire(game, 'p2', cellAt(0, 0));
    fire(game, 'p2', cellAt(1, 0));
    expect(shipsRemaining(game.p2)).toBe(1);
  });

  it('starts over on reset', () => {
    const game = createGame();
    placeRandomFleet(game.p1, new Rng(5));
    game.phase = 'firing';
    game.placedP1 = FLEET.length;
    resetGame(game);
    expect(game.phase).toBe('placing');
    expect(game.p1.ships.length).toBe(0);
    expect(game.placedP1).toBe(0);
  });
});

describe('the bot', () => {
  const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('only ever names a cell it has not called', () => {
    for (const difficulty of DIFFICULTIES) {
      const game = createGame();
      placeRandomFleet(game.p2, new Rng(11));
      game.phase = 'firing';
      const memory = createBotMemory();
      const rng = new Rng(13);
      const called = new Set<number>();
      for (let i = 0; i < CELL_COUNT; i += 1) {
        const cell = botShot(game.p2, memory, rng, difficulty);
        if (cell < 0) break;
        expect(called.has(cell), `${difficulty} repeated cell ${String(cell)}`).toBe(false);
        called.add(cell);
        rememberShot(memory, difficulty, cell, fire(game, 'p2', cell));
      }
      expect(called.size, `${difficulty} kept firing until the board was done`).toBeGreaterThan(50);
    }
  });

  it('follows up a hit in an adjacent cell', () => {
    const game = createGame();
    place(game.p2, cellAt(4, 4), 4, 'across');
    game.phase = 'firing';
    const memory = createBotMemory();
    rememberShot(memory, 'hard', cellAt(4, 4), fire(game, 'p2', cellAt(4, 4)));

    const next = botShot(game.p2, memory, new Rng(17), 'hard');
    const around = [cellAt(5, 4), cellAt(3, 4), cellAt(4, 5), cellAt(4, 3)];
    expect(around, 'it shot next to the damage').toContain(next);
  });

  it('does not follow up on easy, which is the whole of the difference', () => {
    expect(BOT_PROFILES.easy.hunts).toBe(false);
    expect(BOT_PROFILES.normal.hunts).toBe(true);
  });

  it('writes off the ring around a ship it has sunk', () => {
    const game = createGame();
    place(game.p2, cellAt(4, 4), 2, 'across');
    game.phase = 'firing';
    const memory = createBotMemory();
    rememberShot(memory, 'hard', cellAt(4, 4), fire(game, 'p2', cellAt(4, 4)));
    rememberShot(memory, 'hard', cellAt(5, 4), fire(game, 'p2', cellAt(5, 4)));

    // Ships may not touch, so every cell around the wreck is water and a person with a
    // pencil crosses them off.
    expect(memory.ruledOut[cellAt(3, 4)], 'the cell before the bow').toBe(true);
    expect(memory.ruledOut[cellAt(6, 4)], 'the cell after the stern').toBe(true);
    expect(memory.ruledOut[cellAt(4, 3)], 'and the row above').toBe(true);
    expect(memory.ruledOut[cellAt(3, 3)], 'corners included').toBe(true);
  });

  it('does not write the ring off on normal', () => {
    const game = createGame();
    place(game.p2, cellAt(4, 4), 2, 'across');
    game.phase = 'firing';
    const memory = createBotMemory();
    rememberShot(memory, 'normal', cellAt(4, 4), fire(game, 'p2', cellAt(4, 4)));
    rememberShot(memory, 'normal', cellAt(5, 4), fire(game, 'p2', cellAt(5, 4)));
    expect(memory.ruledOut[cellAt(3, 4)]).toBe(false);
  });

  it('stops hunting once the damage is accounted for', () => {
    const game = createGame();
    place(game.p2, cellAt(4, 4), 2, 'across');
    game.phase = 'firing';
    const memory = createBotMemory();
    rememberShot(memory, 'hard', cellAt(4, 4), fire(game, 'p2', cellAt(4, 4)));
    expect(memory.openHits.length).toBe(1);
    rememberShot(memory, 'hard', cellAt(5, 4), fire(game, 'p2', cellAt(5, 4)));
    expect(memory.openHits.length, 'a sunk ship is no longer live damage').toBe(0);
  });

  it('knows the smallest ship still afloat, which sets its sweep', () => {
    const game = createGame();
    place(game.p2, cellAt(0, 0), 2, 'across');
    place(game.p2, cellAt(0, 3), 5, 'across');
    game.phase = 'firing';
    expect(smallestAfloat(game.p2)).toBe(2);
    fire(game, 'p2', cellAt(0, 0));
    fire(game, 'p2', cellAt(1, 0));
    expect(smallestAfloat(game.p2), 'with the two sunk, the five is the smallest').toBe(5);
  });

  it('sweeps a lattice no ship can slip through, on hard', () => {
    const game = createGame();
    place(game.p2, cellAt(0, 0), 2, 'across');
    game.phase = 'firing';
    const memory = createBotMemory();
    const rng = new Rng(19);
    // With the smallest ship afloat at 2, hard only considers cells where (column + row)
    // is even — half the board, and no two-cell ship can hide between them.
    for (let i = 0; i < 20; i += 1) {
      const cell = botShot(game.p2, memory, rng, 'hard');
      if (cell < 0) break;
      if (memory.openHits.length === 0) {
        expect((columnOf(cell) + rowOf(cell)) % 2, 'a lattice cell').toBe(0);
      }
      rememberShot(memory, 'hard', cell, fire(game, 'p2', cell));
    }
  });

  it('takes fewer shots the harder it is', () => {
    // Shots needed to clear a whole fleet, averaged over many layouts. Lower is better,
    // so the ordering runs the other way from most games here.
    const averageFor = (difficulty: BotDifficulty): number => {
      let total = 0;
      const rounds = 120;
      for (let seed = 0; seed < rounds; seed += 1) {
        const game = createGame();
        placeRandomFleet(game.p2, new Rng(seed * 31 + 7));
        game.phase = 'firing';
        const memory = createBotMemory();
        const rng = new Rng(seed * 97 + 3);
        let shots = 0;
        while (!fleetDestroyed(game.p2) && shots < CELL_COUNT) {
          const cell = botShot(game.p2, memory, rng, difficulty);
          if (cell < 0) break;
          shots += 1;
          rememberShot(memory, difficulty, cell, fire(game, 'p2', cell));
        }
        total += shots;
      }
      return total / rounds;
    };

    const easy = averageFor('easy');
    const normal = averageFor('normal');
    const hard = averageFor('hard');
    expect(normal, `normal ${String(normal)} beats easy ${String(easy)}`).toBeLessThan(easy);
    expect(hard, `hard ${String(hard)} beats normal ${String(normal)}`).toBeLessThan(normal);
  });

  it('forgets everything when its memory is reset', () => {
    const memory = createBotMemory();
    memory.openHits.push(5);
    memory.ruledOut[9] = true;
    resetBotMemory(memory);
    expect(memory.openHits.length).toBe(0);
    expect(memory.ruledOut[9]).toBe(false);
  });

  it('never reads a ship it has not hit', () => {
    // Rule 6, stated as a property: the bot's choice depends only on the shot record, so
    // moving the fleet without changing that record cannot change where it fires.
    const shotsFor = (shipCell: number): number => {
      const game = createGame();
      place(game.p2, shipCell, 3, 'across');
      game.phase = 'firing';
      const memory = createBotMemory();
      // A fixed record of misses, none of them touching either candidate ship.
      for (const cell of [cellAt(0, 9), cellAt(1, 9), cellAt(2, 9)]) {
        rememberShot(memory, 'hard', cell, fire(game, 'p2', cell));
      }
      return botShot(fleetOf(game, 'p2'), memory, new Rng(23), 'hard');
    };
    expect(shotsFor(cellAt(2, 2))).toBe(shotsFor(cellAt(6, 6)));
  });

  it('is not sunk by a fleet it has already cleared', () => {
    const game = createGame();
    place(game.p2, cellAt(0, 0), 2, 'across');
    game.phase = 'firing';
    const memory = createBotMemory();
    for (let cell = 0; cell < CELL_COUNT; cell += 1) fire(game, 'p2', cell);
    expect(botShot(game.p2, memory, new Rng(29), 'hard'), 'nothing left to call').toBe(-1);
  });

  it('sinks a ship it has found rather than wandering off', () => {
    const game = createGame();
    place(game.p2, cellAt(3, 3), 4, 'across');
    game.phase = 'firing';
    const memory = createBotMemory();
    const rng = new Rng(31);
    let shots = 0;
    // Seed it with a hit, then let it work.
    rememberShot(memory, 'hard', cellAt(3, 3), fire(game, 'p2', cellAt(3, 3)));
    while (!fleetDestroyed(game.p2) && shots < 30) {
      const cell = botShot(game.p2, memory, rng, 'hard');
      if (cell < 0) break;
      shots += 1;
      rememberShot(memory, 'hard', cell, fire(game, 'p2', cell));
    }
    expect(fleetDestroyed(game.p2), 'it finished what it started').toBe(true);
    expect(shots, 'and did not take the long way round').toBeLessThan(12);
  });
});
