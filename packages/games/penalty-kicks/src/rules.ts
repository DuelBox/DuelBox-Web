import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Penalty Kicks, as pure rules.
 *
 * One player takes the kick, the other keeps goal. Both commit at the same moment and
 * neither sees the other's choice until it is made. Score or save, then the roles swap.
 * First to five goals wins.
 *
 * This is the first game here where **the two players are doing different things at the
 * same time**. Everything else in this collection is symmetric — both push, both aim, both
 * steer. Here one seat is choosing where to put a ball and the other is choosing where to
 * throw themselves, and the whole game is that neither knows.
 *
 * That asymmetry is why the roles have to swap every round rather than every match: a
 * player who only ever keeps goal is playing a different, worse game. **[ours]**
 *
 * No rendering, no timing, no DOM.
 */

export const GOAL_WIDTH = 720;
export const GOAL_HEIGHT = 300;
export const BALL_RADIUS = 22;

/** Goals that win the match. */
export const TARGET = 5;

/**
 * Where a kick can be placed and where a keeper can dive, as a three-by-three grid.
 *
 * Continuous aim was the first thought and it is wrong for this: a keeper diving to a
 * continuous point either always covers the ball or never does, depending on one radius,
 * and the game becomes a coin-flip on a number nobody can see. Nine cells is a guess
 * both players can reason about. **[ours]**
 */
export const COLUMNS = 3;
export const ROWS = 3;
export const CELLS = COLUMNS * ROWS;

/**
 * The chance a kick at each cell misses the goal altogether.
 *
 * **This is what makes the game have skill in it**, and without it there is none.
 *
 * A penalty is a simultaneous guess. If a corner is simply harder to save than the middle
 * and costs nothing, every player aims at a corner and the game is a coin flip on which
 * corner — and it is provably a coin flip: two *identical* bots scored 50.2% against each
 * other, and so did a hard bot against an easy one. Difficulty was worth nothing, because
 * against an opponent mixing at random no strategy beats the base rate.
 *
 * A cost changes that. The corners are harder to save **and** harder to hit, so choosing
 * one is a judgement rather than a free lunch, and judging it well is a skill a bot can
 * have more or less of. The top corners are the worst of both.
 */
export const MISS_CHANCE: readonly number[] = Object.freeze([
  // top row: the hardest to reach and the easiest to put over the bar
  0.3, 0.12, 0.3,
  // middle
  0.14, 0.02, 0.14,
  // bottom row: the safest to hit
  0.1, 0.01, 0.1,
]);

export type Phase = 'aiming' | 'resolving' | 'over';

export interface Game {
  /** The seat taking the kick this round. The other keeps goal. */
  kicker: SeatId;
  phase: Phase;
  /** Where the kick was placed, or -1 before it is taken. */
  shot: number;
  /** Where the keeper went, or -1. */
  dive: number;
  /** Whether the last kick missed the goal altogether. */
  missed: boolean;
  scoreP1: number;
  scoreP2: number;
  /** Rounds played, so a match cannot run for ever. */
  round: number;
}

export function createGame(): Game {
  return {
    kicker: 'p1',
    phase: 'aiming',
    shot: -1,
    dive: -1,
    missed: false,
    scoreP1: 0,
    scoreP2: 0,
    round: 0,
  };
}

export function resetGame(game: Game): void {
  game.kicker = 'p1';
  game.phase = 'aiming';
  game.shot = -1;
  game.dive = -1;
  game.missed = false;
  game.scoreP1 = 0;
  game.scoreP2 = 0;
  game.round = 0;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function keeperOf(game: Game): SeatId {
  return otherOf(game.kicker);
}

export function scoreOf(game: Game, seat: SeatId): number {
  return seat === 'p1' ? game.scoreP1 : game.scoreP2;
}

export function columnOf(cell: number): number {
  return cell % COLUMNS;
}

export function rowOf(cell: number): number {
  return Math.floor(cell / COLUMNS);
}

export function cellAt(column: number, row: number): number {
  return row * COLUMNS + column;
}

export function isCell(cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < CELLS;
}

/** Place the kick. Returns false for a cell that is not a cell, or a second attempt. */
export function kick(game: Game, cell: number): boolean {
  if (game.phase !== 'aiming') return false;
  if (!isCell(cell)) return false;
  if (game.shot >= 0) return false;
  game.shot = cell;
  return true;
}

/** Commit the keeper. Same rules. */
export function dive(game: Game, cell: number): boolean {
  if (game.phase !== 'aiming') return false;
  if (!isCell(cell)) return false;
  if (game.dive >= 0) return false;
  game.dive = cell;
  return true;
}

export function bothCommitted(game: Game): boolean {
  return game.shot >= 0 && game.dive >= 0;
}

/**
 * Whether a dive at `dive` stops a shot at `shot`.
 *
 * A keeper covers the cell they dove to **and the one beside it in the same row** — a
 * dive is a body's length, not a point. Without that reach the whole game is a one-in-nine
 * guess and the keeper is a spectator; with it, guessing the right side is worth
 * something even when the height is wrong.
 */
export function saves(shot: number, dive: number): boolean {
  if (!isCell(shot) || !isCell(dive)) return false;
  if (rowOf(shot) !== rowOf(dive)) return false;
  return Math.abs(columnOf(shot) - columnOf(dive)) <= 1;
}

export interface RoundResult {
  readonly scored: boolean;
  /** True when the kick missed the goal, which is different from being saved. */
  readonly missed: boolean;
  /** The seat that took the kick, whatever the outcome. */
  readonly kicker: SeatId;
  /** Set when the match is decided. */
  readonly winner: SeatId | 'draw' | null;
}

/**
 * Resolve the round and swap the roles.
 *
 * Roles swap **every round**, so both players take the same number of kicks whatever the
 * score. A shoot-out where one player kicks until they miss is a different game and a
 * worse one on a shared screen: the other player would sit and watch.
 */
export function resolve(game: Game, rng: Rng): RoundResult {
  const kicker = game.kicker;
  if (game.phase === 'over' || !bothCommitted(game)) {
    return { scored: false, missed: false, kicker, winner: null };
  }

  // Off target is decided before the keeper matters: a ball over the bar is not a save,
  // and telling a player they were saved when they skied it would be a lie.
  const missed = rng.bool(MISS_CHANCE[game.shot] ?? 0);
  game.missed = missed;

  const scored = !missed && !saves(game.shot, game.dive);
  if (scored) {
    if (kicker === 'p1') game.scoreP1 += 1;
    else game.scoreP2 += 1;
  }

  game.round += 1;
  game.shot = -1;
  game.dive = -1;

  const winner = winnerOf(game);
  if (winner !== null) {
    game.phase = 'over';
    return { scored, missed, kicker, winner };
  }

  game.kicker = otherOf(kicker);
  game.phase = 'aiming';
  return { scored, missed, kicker, winner: null };
}

/**
 * The most rounds a match can run.
 *
 * Two players who both save everything would otherwise never finish, and nothing else
 * here would end such a match — `roundSeconds` in the manifest is validated by the schema
 * and read only by the catalogue card. At the cap the higher score takes it, drawn if
 * level.
 */
export const MAX_ROUNDS = 24;

/**
 * The winner, or null while the match is live.
 *
 * **Decided only when both players have taken the same number of kicks.** This is not a
 * refinement, it is the whole fairness of the game.
 *
 * First to five, checked after every single kick, hands the match to whoever kicks first:
 * two *identical* bots, playing each other, gave the first kicker **63.7%** of matches. The
 * tiers looked like they were worth 63% too — until identical bots were measured against
 * each other and it turned out the difficulty was worth nothing at all and the seat order
 * was worth everything.
 *
 * A real shoot-out has both sides take the same number of kicks before anyone has won, and
 * that is the fix.
 */
export function winnerOf(game: Game): SeatId | 'draw' | null {
  // Mid-pair: one player is a kick ahead, so nothing is decided yet.
  if (game.round % 2 !== 0) return null;

  if (game.scoreP1 >= TARGET && game.scoreP1 > game.scoreP2) return 'p1';
  if (game.scoreP2 >= TARGET && game.scoreP2 > game.scoreP1) return 'p2';
  if (game.round < MAX_ROUNDS) return null;
  if (game.scoreP1 === game.scoreP2) return 'draw';
  return game.scoreP1 > game.scoreP2 ? 'p1' : 'p2';
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * How sharply it concentrates on the best cells, as an exponent on their value.
   *
   * 0 is uniform — every cell equally likely. Higher narrows onto the cells that actually
   * score, which is what a player who has thought about it does.
   *
   * An exponent rather than a linear weight, because the values are close together (the
   * best cell scores 70% blind and the worst 54%) and a linear bias on numbers that close
   * is almost no preference at all: the first version produced weights in a 1.3 ratio and
   * the tiers were indistinguishable.
   */
  readonly focus: number;
  /** Whether it remembers where the opponent has been going. */
  readonly reads: boolean;
}

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { focus: 0, reads: false },
  normal: { focus: 6, reads: false },
  hard: { focus: 11, reads: true },
});

/**
 * What the bot has seen the other player do.
 *
 * Counts per cell, one history for kicks against it and one for dives it has kicked at.
 * This is the only thing the bot knows that a human could not know equally well — which
 * is the point: reading a pattern is a skill, not extra information (rule 6).
 */
export interface BotMemory {
  readonly shotsFaced: number[];
  readonly divesFaced: number[];
}

export function createBotMemory(): BotMemory {
  return {
    shotsFaced: new Array<number>(CELLS).fill(0),
    divesFaced: new Array<number>(CELLS).fill(0),
  };
}

export function resetBotMemory(memory: BotMemory): void {
  memory.shotsFaced.fill(0);
  memory.divesFaced.fill(0);
}

export function rememberRound(memory: BotMemory, shot: number, dive: number): void {
  if (isCell(shot)) memory.shotsFaced[shot] = (memory.shotsFaced[shot] ?? 0) + 1;
  if (isCell(dive)) memory.divesFaced[dive] = (memory.divesFaced[dive] ?? 0) + 1;
}

/**
 * How hard a cell is to save, ignoring what the keeper does.
 *
 * A corner needs the keeper in one of two cells; the middle of a row is covered by all
 * three. So the corners are worth twice the middle, which is exactly why real penalties go
 * there.
 */
export function hardness(cell: number): number {
  const column = columnOf(cell);
  return column === 1 ? 1 : 2;
}

/**
 * The chance a kick at this cell scores against a keeper who has no idea where it is
 * going — on target, and not covered by a dive chosen at random.
 *
 * This is the number a good player is actually weighing, and it is not maximised at the
 * corners: the top corners are the hardest to save and so wild that they score less often
 * than the bottom ones.
 */
export function blindGoalChance(cell: number): number {
  let covered = 0;
  for (let d = 0; d < CELLS; d += 1) {
    if (saves(cell, d)) covered += 1;
  }
  return (1 - (MISS_CHANCE[cell] ?? 0)) * (1 - covered / CELLS);
}

/**
 * How likely a sensible kicker is to aim at this cell, as a share.
 *
 * The keeper's mirror of `blindGoalChance`: cover the cells a thinking opponent uses.
 */
export function expectedShots(cell: number): number {
  let total = 0;
  for (let c = 0; c < CELLS; c += 1) total += blindGoalChance(c);
  return total > 0 ? blindGoalChance(cell) / total : 1 / CELLS;
}

const weightScratch: number[] = new Array<number>(CELLS).fill(0);

function pickWeighted(weights: readonly number[], rng: Rng): number {
  let total = 0;
  for (const weight of weights) total += weight;
  if (total <= 0) return rng.int(0, CELLS);
  let roll = rng.float() * total;
  for (let cell = 0; cell < CELLS; cell += 1) {
    roll -= weights[cell] ?? 0;
    if (roll <= 0) return cell;
  }
  return CELLS - 1;
}

/**
 * Where the bot puts its kick.
 *
 * Weighted rather than chosen: a penalty is a guessing game, and a bot that always picks
 * the single best cell is one a human beats twice and then reads for ever.
 */
export function botKick(memory: BotMemory, rng: Rng, difficulty: BotDifficulty): number {
  const profile = BOT_PROFILES[difficulty];
  let seen = 0;
  for (const count of memory.divesFaced) seen += count;

  for (let cell = 0; cell < CELLS; cell += 1) {
    // Weighted by how often the cell actually scores, not by how hard it is to save. The
    // two are different, and telling them apart is the whole skill: the top corners are
    // the hardest to reach and the easiest to put over the bar.
    let weight = Math.pow(blindGoalChance(cell), profile.focus);
    if (profile.reads && seen > 0) {
      // Avoid where this keeper keeps going. A cell they have dived at often is a cell
      // they are likely to cover again.
      let covered = 0;
      for (let their = 0; their < CELLS; their += 1) {
        if (saves(cell, their)) covered += memory.divesFaced[their] ?? 0;
      }
      weight *= 1 - 0.7 * (covered / seen);
    }
    weightScratch[cell] = Math.max(0.001, weight);
  }
  return pickWeighted(weightScratch, rng);
}

const beliefScratch: number[] = new Array<number>(CELLS).fill(0);

/**
 * Where the bot dives.
 *
 * Valued by **the shots a dive would actually stop**, not by how good the dive's own cell
 * is. Those are different: diving at the middle of a row covers all three cells of it, so
 * against a kicker who mixes it is worth more than a corner even though a corner is the
 * more dangerous place for the ball to go.
 *
 * A keeper also **mixes far more than a kicker does**. A kicker who concentrates on the
 * best cells is playing well; a keeper who concentrates is predictable, and being read is
 * the only way a keeper loses badly. That asymmetry is why the exponent here is a fraction
 * of the kicker's — the version that shared it made the hardest tier *worse* than the
 * middle one, 48.8% against it.
 */
export function botDive(memory: BotMemory, rng: Rng, difficulty: BotDifficulty): number {
  const profile = BOT_PROFILES[difficulty];
  let seen = 0;
  for (const count of memory.shotsFaced) seen += count;

  // What this keeper believes the kicker will do: what a thinking kicker would do, pulled
  // toward what this one has actually been doing.
  for (let shot = 0; shot < CELLS; shot += 1) {
    const prior = expectedShots(shot);
    if (!profile.reads || seen === 0) {
      beliefScratch[shot] = prior;
      continue;
    }
    const observed = (memory.shotsFaced[shot] ?? 0) / seen;
    // Weighted by how much has been seen, so one kick does not convince it of anything.
    const trust = Math.min(0.85, seen / (seen + 6));
    beliefScratch[shot] = prior * (1 - trust) + observed * trust;
  }

  for (let cell = 0; cell < CELLS; cell += 1) {
    let stopped = 0;
    for (let shot = 0; shot < CELLS; shot += 1) {
      if (saves(shot, cell)) stopped += beliefScratch[shot] ?? 0;
    }
    weightScratch[cell] = Math.max(0.001, Math.pow(stopped, profile.focus / 3));
  }
  return pickWeighted(weightScratch, rng);
}
