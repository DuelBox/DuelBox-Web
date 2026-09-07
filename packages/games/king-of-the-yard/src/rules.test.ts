import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import { invalidate } from '@duelbox/game-sdk';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_PROFILES,
  CROWN_DRAG,
  CROWN_RADIUS,
  LOOSE_SECONDS,
  PLAYER_RADIUS,
  SPEED,
  STEAL_COOLDOWN,
  TARGET_SECONDS,
  WALL,
  YARD_HEIGHT,
  YARD_WIDTH,
  botHeading,
  createBotState,
  createGame,
  distanceBetween,
  dropCrown,
  move,
  otherOf,
  resetBotState,
  resetGame,
  step,
  touching,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;
const heading = { x: 0, y: 0 };

/** Runs the loose-crown delay out. */
function settle(game: Game, rng = new Rng(1)): void {
  for (let i = 0; i < Math.ceil(LOOSE_SECONDS / STEP) + 2; i += 1) step(game, STEP, rng);
}

function play(p1: BotDifficulty, p2: BotDifficulty, seed: number): Game {
  const rng = new Rng(seed);
  const game = createGame(rng);
  const botP1 = createBotState();
  const botP2 = createBotState();
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 0 };
  for (let i = 0; i < 60 * 300 && winnerOf(game) === null; i += 1) {
    botHeading(a, game, botP1, 'p1', BOT_PROFILES[p1], STEP, rng.float());
    botHeading(b, game, botP2, 'p2', BOT_PROFILES[p2], STEP, rng.float());
    move(game, 'p1', a.x, a.y, STEP);
    move(game, 'p2', b.x, b.y, STEP);
    step(game, STEP, rng);
  }
  return game;
}

describe('the yard', () => {
  it('starts both players inside the walls with the crown loose', () => {
    const game = createGame(new Rng(1));
    expect(game.wearer).toBeNull();
    expect(game.p1.x).toBeGreaterThan(WALL);
    expect(game.p2.x).toBeLessThan(YARD_WIDTH - WALL);
    expect(game.worn).toEqual({ p1: 0, p2: 0 });
  });

  it('keeps a player inside the walls however long they run', () => {
    const game = createGame(new Rng(1));
    for (let i = 0; i < 600; i += 1) move(game, 'p1', 1, 1, STEP);
    expect(game.p1.x).toBeLessThanOrEqual(YARD_WIDTH - WALL - PLAYER_RADIUS + 1e-6);
    expect(game.p1.y).toBeLessThanOrEqual(YARD_HEIGHT - WALL - PLAYER_RADIUS + 1e-6);
    for (let i = 0; i < 600; i += 1) move(game, 'p1', -1, -1, STEP);
    expect(game.p1.x).toBeGreaterThanOrEqual(WALL + PLAYER_RADIUS - 1e-6);
  });

  it('does not let a diagonal run faster than a straight one', () => {
    const straight = createGame(new Rng(1));
    const diagonal = createGame(new Rng(1));
    for (let i = 0; i < 30; i += 1) {
      move(straight, 'p1', 1, 0, STEP);
      move(diagonal, 'p1', 1, 1, STEP);
    }
    const a = distanceBetween(straight.p1, { x: YARD_WIDTH * 0.25, y: YARD_HEIGHT * 0.5 });
    const b = distanceBetween(diagonal.p1, { x: YARD_WIDTH * 0.25, y: YARD_HEIGHT * 0.5 });
    expect(b).toBeCloseTo(a, 4);
  });

  it('resets in place', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    game.worn.p1 = 9;
    resetGame(game, rng);
    expect(game.worn).toEqual({ p1: 0, p2: 0 });
    expect(game.wearer).toBeNull();
  });
});

describe('the crown', () => {
  it('cannot be picked up until it has settled', () => {
    const game = createGame(new Rng(1));
    game.p1.x = game.crown.x;
    game.p1.y = game.crown.y;
    step(game, STEP, new Rng(1));
    expect(game.wearer, 'it is still settling').toBeNull();
  });

  it('goes to whoever reaches it', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    game.p2.x = game.crown.x;
    game.p2.y = game.crown.y;
    step(game, STEP, rng);
    expect(game.wearer).toBe('p2');
  });

  it('goes to the closer player when both arrive at once', () => {
    // "A tie goes to nobody" was the first rule and it deadlocked the whole game: the two
    // start symmetric, the crown drops on the centre line, and two bots of the same tier
    // move identically — so they arrived together on every step and nobody ever picked it
    // up. Measured, normal against normal spent three hundred seconds untouched.
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    game.p1.x = game.crown.x + 5;
    game.p1.y = game.crown.y;
    game.p2.x = game.crown.x - 20;
    game.p2.y = game.crown.y;
    step(game, STEP, rng);
    expect(game.wearer, 'the closer one').toBe('p1');
  });

  it('breaks an exact tie in favour of whoever has worn it less', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    game.p1.x = game.crown.x - 10;
    game.p1.y = game.crown.y;
    game.p2.x = game.crown.x + 10;
    game.p2.y = game.crown.y;
    game.worn.p1 = 5;
    game.worn.p2 = 1;
    step(game, STEP, rng);
    expect(game.wearer, 'the seat that is behind').toBe('p2');
  });

  it('breaks a total tie the same way every replay', () => {
    // Something has to decide, and whatever it is must replay identically.
    const pick = (): SeatId | null => {
      const rng = new Rng(7);
      const game = createGame(rng);
      settle(game, rng);
      game.p1.x = game.crown.x - 10;
      game.p1.y = game.crown.y;
      game.p2.x = game.crown.x + 10;
      game.p2.y = game.crown.y;
      step(game, STEP, rng);
      return game.wearer;
    };
    expect(pick()).toBe(pick());
  });

  it('rides on its wearer', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    game.p1.x = game.crown.x;
    game.p1.y = game.crown.y;
    step(game, STEP, rng);
    expect(game.wearer).toBe('p1');
    for (let i = 0; i < 30; i += 1) {
      move(game, 'p1', 1, 0, STEP);
      step(game, STEP, rng);
    }
    expect(game.crown.x, 'anything asking where it is gets one answer').toBe(game.p1.x);
  });
});

describe('stealing', () => {
  it('takes the crown on a touch', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    game.wearer = 'p1';
    game.cooldown = 0;
    game.p2.x = game.p1.x;
    game.p2.y = game.p1.y;
    expect(step(game, STEP, rng)).toBe('stolen');
    expect(game.wearer).toBe('p2');
  });

  it('will not change hands again until the cooldown has run', () => {
    // Two circles that overlap stay overlapping for many steps; without this the crown
    // flips every step while they touch, which reads as the game having a seizure.
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    game.wearer = 'p1';
    game.cooldown = 0;
    game.p2.x = game.p1.x;
    game.p2.y = game.p1.y;
    step(game, STEP, rng);
    expect(game.wearer).toBe('p2');
    expect(game.cooldown).toBeCloseTo(STEAL_COOLDOWN, 6);
    step(game, STEP, rng);
    expect(game.wearer, 'not straight back').toBe('p2');
  });

  it('slows the wearer down', () => {
    // Without this the game has no tension: whoever takes it first runs away with it, and
    // a chase nobody can win is not a chase.
    const rng = new Rng(1);
    const bare = createGame(rng);
    const crowned = createGame(rng);
    crowned.wearer = 'p1';
    for (let i = 0; i < 30; i += 1) {
      move(bare, 'p1', 1, 0, STEP);
      move(crowned, 'p1', 1, 0, STEP);
    }
    expect(crowned.p1.x).toBeLessThan(bare.p1.x);
    expect(CROWN_DRAG).toBeLessThan(1);
    expect(SPEED * CROWN_DRAG).toBeLessThan(SPEED);
  });

  it('banks time only for the wearer', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    game.wearer = 'p1';
    game.cooldown = STEAL_COOLDOWN;
    for (let i = 0; i < 60; i += 1) step(game, STEP, rng);
    expect(game.worn.p1).toBeGreaterThan(0.9);
    expect(game.worn.p2).toBe(0);
  });
});

describe('winning', () => {
  it('is undecided at the start', () => {
    expect(winnerOf(createGame(new Rng(1)))).toBeNull();
  });

  it('is won at the target', () => {
    const game = createGame(new Rng(1));
    game.worn.p2 = TARGET_SECONDS;
    expect(winnerOf(game)).toBe('p2');
  });

  it('has two seats', () => {
    expect(otherOf('p1')).toBe('p2');
  });
});

describe('the bot', () => {
  it('runs for the crown when nobody has it', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    game.crown.x = WALL + CROWN_RADIUS;
    game.crown.y = game.p1.y;
    const bot = createBotState();
    botHeading(heading, game, bot, 'p1', { reaction: 0.1, wobble: 0, lead: 0 }, STEP, 0.5);
    expect(heading.x, 'it heads left, toward the crown').toBeLessThan(0);
  });

  it('runs away when it is wearing it', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    game.wearer = 'p1';
    game.p2.x = WALL + PLAYER_RADIUS;
    game.p2.y = WALL + PLAYER_RADIUS;
    const bot = createBotState();
    botHeading(heading, game, bot, 'p1', { reaction: 0.1, wobble: 0, lead: 0 }, STEP, 0.5);
    expect(heading.x, 'away from the chaser in the top-left').toBeGreaterThan(0);
    expect(heading.y).toBeGreaterThan(0);
  });

  it('commits to a heading between decisions', () => {
    // Re-choosing every step averages the wobble to zero and makes the tiers meaningless,
    // which is a mistake this codebase has now made in three separate games.
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    const bot = createBotState();
    const profile = { reaction: 0.5, wobble: 1.2, lead: 0 };
    botHeading(heading, game, bot, 'p1', profile, STEP, 0.1);
    const first = { x: heading.x, y: heading.y };
    game.crown.x = YARD_WIDTH - WALL;
    botHeading(heading, game, bot, 'p1', profile, STEP, 0.9);
    expect(heading.x, 'it has not looked again yet').toBe(first.x);
  });

  it('never reacts faster than a person', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      expect(BOT_PROFILES[tier].reaction, tier).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('leads its target more, and wobbles less, as the tier rises', () => {
    // Chasing where somebody *is* means always arriving where they were.
    expect(BOT_PROFILES.hard.lead).toBeGreaterThan(BOT_PROFILES.easy.lead);
    expect(BOT_PROFILES.hard.wobble).toBeLessThan(BOT_PROFILES.easy.wobble);
    expect(BOT_PROFILES.hard.reaction).toBeLessThan(BOT_PROFILES.easy.reaction);
  });

  it('clears its state on reset', () => {
    const bot = createBotState();
    bot.headingX = 1;
    bot.judgement.remaining = 5;
    bot.judgement.decided = true;
    resetBotState(bot);
    expect(bot.headingX).toBe(0);
    expect(bot.judgement.remaining).toBe(0);
    expect(bot.judgement.decided).toBe(false);
  });

  it('beats the weaker tier over a series', { timeout: 240_000 }, () => {
    let wins = 0;
    const games = 12;
    for (let i = 0; i < games; i += 1) {
      const hardIsP1 = i % 2 === 0;
      const finished = play(hardIsP1 ? 'hard' : 'easy', hardIsP1 ? 'easy' : 'hard', 900 + i);
      if (winnerOf(finished) === (hardIsP1 ? 'p1' : 'p2')) wins += 1;
    }
    // Measured at 100% against easy and 90% against normal over thirty matches.
    expect(wins, `hard won ${String(wins)} of ${String(games)}`).toBeGreaterThan(games * 0.7);
  });
});

describe('a whole match', () => {
  it('always finishes', { timeout: 240_000 }, () => {
    for (const seed of [11, 22, 33]) {
      expect(winnerOf(play('normal', 'normal', seed)), `seed ${String(seed)}`).not.toBeNull();
    }
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const rng = new Rng(44);
      const game = createGame(rng);
      const bot = createBotState();
      const out: string[] = [];
      for (let i = 0; i < 60 * 60; i += 1) {
        botHeading(heading, game, bot, 'p1', BOT_PROFILES.normal, STEP, rng.float());
        move(game, 'p1', heading.x, heading.y, STEP);
        step(game, STEP, rng);
        if (i % 30 === 0) out.push(`${String(Math.round(game.p1.x))},${game.wearer ?? '-'}`);
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('drops the crown inside the yard', () => {
    const rng = new Rng(3);
    const game = createGame(rng);
    for (let i = 0; i < 200; i += 1) {
      dropCrown(game, rng);
      expect(game.crown.y).toBeGreaterThanOrEqual(WALL);
      expect(game.crown.y).toBeLessThanOrEqual(YARD_HEIGHT - WALL);
      expect(touching(game.crown, game.crown, 1), 'sanity').toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ the mirror */

/**
 * The reflection, and the three things that were not covariant under it.
 *
 * Written before the fix it gates. King of the Yard was recorded at **38.9% for seat one**
 * over a thousand seeds, and the opening seat had nothing to do with it: this is a real-time
 * game with no opener, and the two halves of every seed pair came out identical.
 *
 * The yard is one square with the two seats side by side, so swapping them is the reflection
 * `x -> 900 - x`; `y` is untouched. Both starting positions, the walls, the crown's drop
 * column and the clamp range are all fixed by it, so if every rule were covariant the game
 * would be fair by construction. Three were not, and none of them is in the rules module's
 * arithmetic:
 *
 * 1. **The two seats were resolved one after the other** — heading, move, heading, move — in
 *    `game.ts`. In a chase the whole decision is where the other player is, so seat two was
 *    aiming at where seat one had already moved to *this* step while seat one aimed at where
 *    seat two had been at the end of the last one. Worth **ten points** on its own, measured
 *    by putting it back: 39.7% against 50.0% over a thousand seeds. `rules.test.ts`'s own
 *    `play` helper had always read both headings before moving either player, which is why
 *    every test in this file passed while the shipped game did the other thing.
 * 2. **`lastTargetX/Y` started at `0`,** and `0` is a point in board coordinates — the
 *    top-left corner. The first frame of every chase differenced the prey's position against
 *    it and called the result a velocity, giving a phantom 1700 units a second pointing at
 *    increasing `x` and `y`, and the bot then led its shot by a quarter of a second of that.
 *    A wrong answer with a fixed compass bearing is a seat bias in a mirrored yard. Worth
 *    3.3 points: 46.7% with it back.
 * 3. **The wearer picked its escape corner against the yard's midline**, `chaser.x < 450`.
 *    `chaser.x` does not change sign under the reflection but `chaser.x - me.x` does, and the
 *    crown is dropped on `x = 450` every single match, so the chaser stands on that knife
 *    edge by construction rather than by coincidence. Worth 1.2 points: 51.2% with it back.
 *
 * The wobble is the one thing here that cannot be covariant and does not need to be: a
 * mirrored heading needs the *negated* angular error, so the mirror below feeds `1 - roll`,
 * which is exactly `-misjudgement(roll, spread)`. Over a seeded stream the two are the same
 * distribution, which is why this is a fair coin rather than a defect.
 */

const MIRROR_TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

/** Make the bot look again on the next call, whatever its reaction time says. */
function resetJudgementFor(bot: ReturnType<typeof createBotState>): void {
  invalidate(bot.judgement);
}

function mirrorX(x: number): number {
  return YARD_WIDTH - x;
}

/** `from` seen from the other chair: reflected in x, with the two seats swapped. */
function mirrorInto(from: Readonly<Game>, to: Game): void {
  to.p1.x = mirrorX(from.p2.x);
  to.p1.y = from.p2.y;
  to.p2.x = mirrorX(from.p1.x);
  to.p2.y = from.p1.y;
  to.crown.x = mirrorX(from.crown.x);
  to.crown.y = from.crown.y;
  to.wearer = from.wearer === null ? null : otherOf(from.wearer);
  to.cooldown = from.cooldown;
  to.looseFor = from.looseFor;
  to.worn.p1 = from.worn.p2;
  to.worn.p2 = from.worn.p1;
}

/** Everything that has to agree, read in the near seat's frame. */
function describeYard(game: Readonly<Game>): string {
  return [
    `p1=${game.p1.x.toFixed(9)},${game.p1.y.toFixed(9)}`,
    `p2=${game.p2.x.toFixed(9)},${game.p2.y.toFixed(9)}`,
    `crown=${game.crown.x.toFixed(9)},${game.crown.y.toFixed(9)}`,
    `wearer=${String(game.wearer)}`,
    `cooldown=${game.cooldown.toFixed(9)}`,
    `loose=${game.looseFor.toFixed(9)}`,
    `worn=${game.worn.p1.toFixed(9)}/${game.worn.p2.toFixed(9)}`,
  ].join(' ');
}

/** The mirror of `game`, read through the reflection, so it prints as its own near frame. */
function describeMirrored(game: Readonly<Game>, scratch: Game): string {
  mirrorInto(game, scratch);
  return describeYard(scratch);
}

/**
 * A yard that has been played into for a while, so the states under test are reachable ones.
 *
 * A fabricated pair of coordinates can be a position the game can never produce, and a
 * position the game can never produce is a weak witness.
 */
function reachable(seed: number, frames: number): Game {
  const rng = new Rng(seed);
  const game = createGame(rng);
  const bots = { p1: createBotState(), p2: createBotState() };
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 0 };
  for (let i = 0; i < frames && winnerOf(game) === null; i += 1) {
    botHeading(a, game, bots.p1, 'p1', BOT_PROFILES.normal, STEP, rng.float());
    botHeading(b, game, bots.p2, 'p2', BOT_PROFILES.normal, STEP, rng.float());
    move(game, 'p1', a.x, a.y, STEP);
    move(game, 'p2', b.x, b.y, STEP);
    step(game, STEP, rng);
  }
  return game;
}

describe('the reflection', () => {
  it('fixes the yard, the walls and the opening position', () => {
    const game = createGame(new Rng(3));
    expect(mirrorX(game.p1.x)).toBeCloseTo(game.p2.x, 9);
    expect(game.p1.y).toBeCloseTo(game.p2.y, 9);
    // The crown drops on the midline, which is why the midline is a knife edge that gets
    // stood on rather than one that never comes up.
    expect(game.crown.x).toBe(YARD_WIDTH / 2);
    expect(mirrorX(game.crown.x)).toBe(game.crown.x);
    // And the clamp the movement uses is symmetric, so nothing is lost at the walls.
    expect(mirrorX(WALL + PLAYER_RADIUS)).toBe(YARD_WIDTH - WALL - PLAYER_RADIUS);
  });

  it('moves a mirrored yard to the mirror of the moved yard', () => {
    const other = createGame(new Rng(1));
    const expected = createGame(new Rng(1));
    for (let seed = 1; seed <= 60; seed += 1) {
      const game = reachable(seed * 7919, seed * 7);
      mirrorInto(game, other);
      // The same run, in each seat's own reading of it: x reversed, y as it was.
      const dx = ((seed % 5) - 2) / 2;
      const dy = ((seed % 7) - 3) / 3;
      move(game, 'p1', dx, dy, STEP);
      move(other, 'p2', -dx, dy, STEP);
      mirrorInto(game, expected);
      expect(other.p2.x, `seed ${String(seed)}`).toBeCloseTo(expected.p2.x, 9);
      expect(other.p2.y, `seed ${String(seed)}`).toBeCloseTo(expected.p2.y, 9);
    }
  });

  it('steps a mirrored yard to the mirror of the stepped yard', () => {
    const other = createGame(new Rng(1));
    const scratch = createGame(new Rng(1));
    for (let seed = 1; seed <= 120; seed += 1) {
      const game = reachable(seed * 104_729, seed * 11);
      mirrorInto(game, other);
      // The same seed on both sides. The only draw `step` makes is the deadlock coin, and
      // a coin cannot be covariant — see the note above the suite. Every path that does not
      // reach it must be.
      step(game, STEP, new Rng(5));
      step(other, STEP, new Rng(5));
      expect(describeMirrored(other, scratch), `seed ${String(seed)}`).toBe(describeYard(game));
    }
  });

  it.each(MIRROR_TIERS)('heads a %s bot the mirrored way on a mirrored yard', (tier) => {
    const other = createGame(new Rng(1));
    const mine = { x: 0, y: 0 };
    const theirs = { x: 0, y: 0 };
    for (let seed = 1; seed <= 120; seed += 1) {
      const game = reachable(seed * 7919, seed * 13);
      mirrorInto(game, other);
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        const a = createBotState();
        const b = createBotState();
        // Two decisions, not one: the second is the first that has a velocity to work with,
        // and the bug this catches lived entirely in what the first one assumed.
        for (let look = 0; look < 2; look += 1) {
          const roll = 0.2 + look * 0.55;
          botHeading(mine, game, a, seat, BOT_PROFILES[tier], STEP, roll);
          // `1 - roll` is `-misjudgement(roll, spread)`: a heading reflected in x needs its
          // angular error reflected too.
          botHeading(theirs, other, b, otherOf(seat), BOT_PROFILES[tier], STEP, 1 - roll);
        }
        expect(theirs.x, `seed ${String(seed)} ${seat} x`).toBeCloseTo(-mine.x, 9);
        expect(theirs.y, `seed ${String(seed)} ${seat} y`).toBeCloseTo(mine.y, 9);
      }
    }
  });

  it('treats one look at the prey as a position and not as a velocity', () => {
    // The `lastTarget = 0` bug in one assertion. A bot that has just started chasing has
    // seen the prey once, and one observation carries no velocity — so it must head straight
    // at the prey, not a quarter of a second past where a phantom 1700-units-a-second
    // reading says the prey is going.
    const game = createGame(new Rng(9));
    settle(game);
    game.wearer = 'p1';
    game.p1.x = 300;
    game.p1.y = 300;
    game.p2.x = 600;
    game.p2.y = 300;
    const bot = createBotState();
    const out = { x: 0, y: 0 };
    // A wobble-free profile with a long lead, so any lead at all is visible in the heading.
    const profile = { reaction: 0.26, wobble: 0, lead: 0.5 };
    botHeading(out, game, bot, 'p2', profile, STEP, 0.5);
    expect(out.x, 'the first look must point straight at the prey').toBeCloseTo(-1, 9);
    expect(out.y).toBeCloseTo(0, 9);
    expect(bot.tracking, 'and it must remember whom it looked at').toBe('p1');

    // Now it has two looks and a real velocity: the prey went up, so the chaser leads up.
    game.p1.y = 240;
    resetJudgementFor(bot);
    botHeading(out, game, bot, 'p2', profile, STEP, 0.5);
    expect(out.y, 'the second look leads the prey').toBeLessThan(-0.1);
  });

  it('forgets the prey when it stops chasing, rather than keeping a stale reading', () => {
    // The other half of the same bug: nothing used to clear `lastTarget` between chases, so
    // a bot that had worn the crown for five seconds came back to the chase and differenced
    // the prey's position against where it had been five seconds earlier.
    const game = createGame(new Rng(9));
    settle(game);
    game.wearer = 'p1';
    game.p1.x = 300;
    game.p1.y = 300;
    game.p2.x = 600;
    game.p2.y = 300;
    const bot = createBotState();
    const out = { x: 0, y: 0 };
    const profile = { reaction: 0.26, wobble: 0, lead: 0.5 };
    botHeading(out, game, bot, 'p2', profile, STEP, 0.5);
    expect(bot.tracking).toBe('p1');

    // p2 takes the crown and runs for a while.
    game.wearer = 'p2';
    resetJudgementFor(bot);
    botHeading(out, game, bot, 'p2', profile, STEP, 0.5);
    expect(bot.tracking, 'wearing the crown is not watching anybody').toBeNull();

    // And when it loses it again, the first look is a position once more.
    game.wearer = 'p1';
    game.p1.x = 300;
    game.p1.y = 120;
    resetJudgementFor(bot);
    botHeading(out, game, bot, 'p2', profile, STEP, 0.5);
    const straight = Math.hypot(game.p1.x - game.p2.x, game.p1.y - game.p2.y);
    expect(out.x).toBeCloseTo((game.p1.x - game.p2.x) / straight, 9);
    expect(out.y).toBeCloseTo((game.p1.y - game.p2.y) / straight, 9);
  });

  it.each(MIRROR_TIERS)('gives neither seat the %s yard', (tier) => {
    // The measurement the harness makes, made here so it fails in this package first. This
    // game cannot turn its balance into a proof the way a turn game can — the two bots wobble
    // on separate streams and a chase amplifies a last-bit difference into a different match
    // — so it is a sample, and the band is the sample's own three sigma.
    let seatOne = 0;
    let decided = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const winner = winnerOf(play(tier, tier, 1_000_003 + seed * 7919));
      if (winner === null) continue;
      decided += 1;
      if (winner === 'p1') seatOne += 1;
    }
    expect(decided, `${tier} decided nothing`).toBeGreaterThan(150);
    const share = seatOne / decided;
    const allowance = 3 * Math.sqrt(0.25 / decided);
    expect(
      Math.abs(share - 0.5),
      `${tier} gave seat one ${(share * 100).toFixed(1)}% of ${String(decided)} matches, ` +
        `outside three sigma (${(allowance * 100).toFixed(1)} points) of a fair yard`,
    ).toBeLessThanOrEqual(allowance);
  });
});
