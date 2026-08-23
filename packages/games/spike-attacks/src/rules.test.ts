import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_DRAWS_PER_LOOK,
  BOT_MARGIN,
  BOT_PROFILES,
  FIELD_DURABILITY,
  FIRST_WARN,
  LEFT,
  LIVES,
  MAX_ROUNDS,
  MAX_VOLLEYS,
  MIN_WARN,
  PINCER,
  PINCER_FROM,
  POCKET,
  RIGHT,
  ROUND_DRAWS,
  ROW_LENGTH,
  SLOTS,
  SPACING,
  START_X,
  STONE_HALF_WIDTH,
  STONE_HITS,
  TARGET_ROUNDS,
  WALK_SPEED,
  bearingOf,
  botAsk,
  coveredAt,
  createBotState,
  createGame,
  dealRound,
  driveField,
  fieldOf,
  isUp,
  otherOf,
  pincerChanceAt,
  resetGame,
  shelterAt,
  slotX,
  step,
  warnAt,
  winnerOf,
} from './rules.js';
import type { Ask, BotDifficulty, Field, Game, Stone } from './rules.js';

const STEP = 1 / 60;
const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];

function started(seed: number): Game {
  const game = createGame();
  resetGame(game, new Rng(seed));
  return game;
}

/** Every stone's lean and life, as one string, so a whole field compares in one assertion. */
function describeField(field: Readonly<Field>): string {
  return field.stones
    .map((stone) => `${String(stone.x)}${stone.shields === LEFT ? '<' : '>'}${String(stone.hits)}`)
    .join('|');
}

describe('the row', () => {
  it('is evenly spaced, and the player may stand anywhere on it', () => {
    const game = started(1);
    for (let i = 0; i < SLOTS; i += 1) expect(game.p1.stones[i]!.x).toBe(i * SPACING);
    expect(ROW_LENGTH).toBe((SLOTS - 1) * SPACING);
    expect(START_X).toBe(ROW_LENGTH / 2);
  });

  it('gives a stone reach over its neighbour and no further', () => {
    // The one relation the whole design rests on. Below the spacing, no two pockets would
    // ever overlap and a pincer would be unsurvivable from the first volley; above two
    // spacings every stone would reach its second neighbour and nooks would be everywhere.
    expect(POCKET).toBeGreaterThan(SPACING);
    expect(POCKET).toBeLessThan(SPACING * 2);
  });

  it('shelters the ground behind a stone and not the ground in front of it', () => {
    const field = started(2).p1;
    // One left-leaning stone in a row of right-leaning ones, so the answer names it alone.
    for (const other of field.stones) other.shields = RIGHT;
    const stone = field.stones[4]!;
    stone.shields = LEFT;
    expect(shelterAt(field, stone.x + 1, LEFT)).toBe(4);
    expect(shelterAt(field, stone.x + POCKET, LEFT)).toBe(4);
    expect(shelterAt(field, stone.x + POCKET + 1, LEFT)).toBe(-1);
    // In front of it — between the stone and the end the spikes come from — is not cover.
    expect(shelterAt(field, stone.x - STONE_HALF_WIDTH - 1, LEFT)).toBe(-1);
    // And it holds off one end only: a left-leaning stone is no use against the right.
    expect(shelterAt(field, stone.x + 10, RIGHT)).not.toBe(4);
  });

  it('puts the blow on the nearest stone that would hold it', () => {
    // Physical — it is the stone you are actually behind — and a lever: standing nearer one
    // of two stones that both cover you chooses which of them you spend.
    const field = started(5).p1;
    for (const other of field.stones) other.shields = LEFT;
    expect(shelterAt(field, slotX(6), LEFT)).toBe(6);
    field.stones[6]!.hits = 0;
    expect(shelterAt(field, slotX(6), LEFT)).toBe(5);
  });

  it('counts standing against a stone as being behind it', () => {
    /*
     * The regression the first measured bots died of. A pocket that started exactly at the
     * stone's centre made the safest-looking spot on the board a knife-edge with the
     * killing side three units away — one step of walk — so a bot that walked to the stone
     * it liked best wobbled two units past the middle and was spiked there. Cover you can
     * stand against is cover.
     */
    const field = started(3).p1;
    const stone = field.stones[2]!;
    stone.shields = RIGHT;
    for (let offset = -STONE_HALF_WIDTH; offset <= STONE_HALF_WIDTH; offset += 1) {
      expect(shelterAt(field, stone.x + offset, RIGHT), `offset ${String(offset)}`).toBe(2);
    }
  });

  it('shelters nothing once it is rubble', () => {
    const field = started(4).p1;
    const stone = field.stones[3]!;
    stone.shields = LEFT;
    stone.hits = 0;
    expect(shelterAt(field, stone.x + 4, LEFT)).not.toBe(3);
  });

  it('always deals at least one stone each way, and one adjacent pair leaning apart', () => {
    // A row leaning entirely one way happens once in 256 and is a round nobody plays: the
    // first volley from the other end kills both seats before either has taken a step.
    // Both being equally robbed is not a defence.
    for (let seed = 0; seed < 400; seed += 1) {
      const stones = started(seed).p1.stones;
      const leans = stones.map((stone) => stone.shields);
      expect(leans, `seed ${String(seed)}`).toContain(LEFT);
      expect(leans).toContain(RIGHT);
      let nook = false;
      for (let i = 0; i < SLOTS - 1 && !nook; i += 1) {
        nook = leans[i] === LEFT && leans[i + 1] === RIGHT;
      }
      expect(nook, `seed ${String(seed)} was dealt no nook`).toBe(true);
    }
  });

  it('leaves ground that is safe from either end wherever two stones lean apart', () => {
    const field = started(7).p1;
    for (const stone of field.stones) stone.shields = RIGHT;
    field.stones[3]!.shields = LEFT;
    // Between a left-leaning stone and the right-leaning one after it: safe from both.
    expect(coveredAt(field, slotX(4), PINCER)).toBe(true);
    // And in front of the left-leaning one, safe from the right alone.
    expect(coveredAt(field, slotX(2), PINCER)).toBe(false);
    expect(coveredAt(field, slotX(2), RIGHT)).toBe(true);
  });
});

describe('both seats get one field, dealt once', () => {
  it('deals them the same stones, stone for stone, in every round', () => {
    // Two fields drawn independently from the same generator would be fair on average and
    // a round is played once. Dealing one and copying it deletes the question: the two rows
    // are not similar in difficulty, they are the same stones leaning the same ways.
    for (let seed = 0; seed < 300; seed += 1) {
      const game = started(seed);
      expect(describeField(game.p2), `seed ${String(seed)}`).toBe(describeField(game.p1));
    }
  });

  it('deals them the same stones on the second and third rounds too', () => {
    const game = createGame();
    const rng = new Rng(11);
    resetGame(game, rng);
    for (let round = 0; round < 3; round += 1) {
      expect(describeField(game.p2)).toBe(describeField(game.p1));
      // Chip one seat's field so a shared array would show up as a difference next deal.
      game.p1.stones[0]!.hits = 0;
      dealRound(game, rng);
    }
  });

  it('keeps them separate objects, so a crack in one is not a crack in the other', () => {
    // The other half of the design, and the reason the equality above needs a test at all:
    // a stone is spent by the player who hides behind it, so one shared array would mean
    // one seat's shelter crumbling under the other seat's blows.
    const game = started(13);
    expect(game.p1.stones).not.toBe(game.p2.stones);
    game.p1.stones[0]!.hits -= 1;
    expect(game.p2.stones[0]!.hits).toBe(STONE_HITS);
  });

  it('lets the two fields come apart, but only through the players', () => {
    const game = started(21);
    const stone = game.p1.stones.find((candidate) => candidate.shields === LEFT)!;
    game.p1.x = stone.x + 4;
    game.p2.x = stone.x + 4;
    // Both sheltered by the same stone: the fields stay level.
    while (bearingOf(game) !== LEFT) game.volley += 1;
    step(game, FIRST_WARN + STEP, 0, 0, new Rng(1));
    expect(describeField(game.p2)).toBe(describeField(game.p1));
    expect(game.p1.survived).toBe(1);
  });

  it('deals the whole volley schedule before either player moves', () => {
    /*
     * Which is worth more than it looks. The schedule is drawn from the seeded stream at a
     * fixed point, so the same seed deals the same volleys whether the seats hold two
     * people, two bots or one of each — a schedule rolled per volley would be a different
     * schedule depending on who was playing, and a bot's own draws would move the world.
     */
    const play = (script: (i: number) => Ask): string => {
      const game = createGame();
      resetGame(game, new Rng(404));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 60 && game.phase === 'live'; i += 1) {
        const bearing = bearingOf(game);
        if (step(game, STEP, script(i), 0, new Rng(1)).landed) {
          seen.push(`${String(i)}:${String(bearing)}`);
        }
      }
      return seen.join('|');
    };
    const still = play(() => 0);
    expect(play((i) => (i % 40 < 20 ? RIGHT : LEFT) as Ask)).toBe(still);
    expect(play(() => RIGHT)).toBe(still);
    expect(still.length).toBeGreaterThan(0);
  });

  it('spends a fixed number of values on a deal', () => {
    // Constant, so the shape of a round cannot depend on how the last one was played.
    const game = createGame();
    let draws = 0;
    const counted = {
      float: () => {
        draws += 1;
        return 0.5;
      },
    } as unknown as Rng;
    dealRound(game, counted);
    expect(draws).toBe(ROUND_DRAWS);
    expect(ROUND_DRAWS).toBe(1 + SLOTS + MAX_VOLLEYS);
  });
});

describe('the volleys', () => {
  it('come faster and faster, down to a floor', () => {
    expect(warnAt(0)).toBe(FIRST_WARN);
    for (let i = 1; i < MAX_VOLLEYS; i += 1) {
      expect(warnAt(i), `volley ${String(i)}`).toBeLessThanOrEqual(warnAt(i - 1));
      expect(warnAt(i)).toBeGreaterThanOrEqual(MIN_WARN);
    }
    expect(warnAt(MAX_VOLLEYS - 1)).toBe(MIN_WARN);
  });

  it('leaves a reach that falls from most of the row to about one stone', () => {
    // The whole difficulty curve, as two numbers: nothing becomes impossible, everything
    // becomes near.
    expect(warnAt(0) * WALK_SPEED).toBeGreaterThan(SPACING * 4);
    expect(MIN_WARN * WALK_SPEED).toBeLessThan(SPACING * 1.5);
  });

  it('opens from one end only, then starts arriving from both', () => {
    for (let i = 0; i <= PINCER_FROM; i += 1) expect(pincerChanceAt(i)).toBe(0);
    expect(pincerChanceAt(PINCER_FROM + 1)).toBeGreaterThan(0);
    expect(pincerChanceAt(MAX_VOLLEYS)).toBeGreaterThan(pincerChanceAt(PINCER_FROM + 2));
  });

  it('favours neither end of the row, at any density', () => {
    // A player who has learned to prefer one side has learned nothing.
    let left = 0;
    let right = 0;
    for (let seed = 0; seed < 600; seed += 1) {
      for (const bearing of started(seed).schedule) {
        if (bearing === LEFT) left += 1;
        else if (bearing === RIGHT) right += 1;
      }
    }
    const total = left + right;
    expect(total).toBeGreaterThan(5000);
    expect(Math.abs(left - right) / total).toBeLessThan(0.04);
  });
});

describe('taking cover', () => {
  /** Wind the game on to the next landing without moving anybody. */
  function land(game: Game): void {
    step(game, game.timer + STEP, 0, 0, new Rng(1));
  }

  it('costs the stone that held, and only that stone', () => {
    const game = started(31);
    const stone = game.p1.stones.find((candidate) => candidate.shields === LEFT)!;
    while (bearingOf(game) !== LEFT) game.volley += 1;
    game.p1.x = stone.x + 5;
    game.p2.x = stone.x + 5;
    land(game);
    expect(stone.hits).toBe(STONE_HITS - 1);
    expect(game.p1.stones.reduce((sum, s) => sum + s.hits, 0)).toBe(FIELD_DURABILITY - 1);
    expect(isUp(game.p1)).toBe(true);
    expect(game.p1.survived).toBe(1);
  });

  it('costs two stones when the spikes come from both ends', () => {
    const game = started(32);
    for (const stone of game.p1.stones) stone.shields = RIGHT;
    game.p1.stones[3]!.shields = LEFT;
    game.schedule[game.volley] = PINCER;
    game.p1.x = slotX(4);
    game.p2.x = slotX(4);
    land(game);
    expect(game.p1.stones.reduce((sum, s) => sum + s.hits, 0)).toBe(FIELD_DURABILITY - 2);
    expect(isUp(game.p1)).toBe(true);
  });

  it('costs a life and no stone at all when there is no cover', () => {
    /*
     * The asymmetry that lets two rounds come apart. Every survived volley costs the same
     * durability on both rows, so two players who never miss run out of cover on the
     * identical volley; a player who is hit spends nothing, and from there the two fields
     * are no longer the same field.
     */
    const game = started(33);
    for (const stone of game.p1.stones) stone.shields = RIGHT;
    game.schedule[game.volley] = LEFT;
    land(game);
    expect(game.p1.lives).toBe(LIVES - 1);
    expect(game.p1.stones.reduce((sum, s) => sum + s.hits, 0)).toBe(FIELD_DURABILITY);
    expect(game.p1.survived).toBe(0);
  });

  it('ends the round when a player is out, and draws it when both are', () => {
    const game = started(34);
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const field = fieldOf(game, seat);
      field.lives = 1;
      for (const stone of field.stones) stone.shields = RIGHT;
    }
    game.schedule[game.volley] = LEFT;
    land(game);
    expect(game.phase).toBe('settling');
    expect(game.lastRound).toBe('draw');
    expect(game.p1Rounds).toBe(0);
    expect(game.p2Rounds).toBe(0);
  });

  it('gives the round to the seat still standing', () => {
    const game = started(35);
    game.p2.lives = 1;
    for (const stone of game.p2.stones) stone.shields = RIGHT;
    const held = game.p1.stones.find((stone) => stone.shields === LEFT)!;
    game.p1.x = held.x + 3;
    game.schedule[game.volley] = LEFT;
    land(game);
    expect(game.lastRound).toBe('p1');
    expect(game.p1Rounds).toBe(1);
  });

  it('walks a player at one speed whatever asked for it', () => {
    const field = started(36).p1;
    const from = field.x;
    for (let i = 0; i < 30; i += 1) driveField(field, RIGHT, STEP);
    expect(field.x - from).toBeCloseTo(WALK_SPEED * STEP * 30, 6);
    // And it never leaves the row.
    for (let i = 0; i < 600; i += 1) driveField(field, RIGHT, STEP);
    expect(field.x).toBe(ROW_LENGTH);
    for (let i = 0; i < 600; i += 1) driveField(field, LEFT, STEP);
    expect(field.x).toBe(0);
  });

  it('names the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

describe('termination', () => {
  it('ends a round even for a player who could be anywhere at any instant', () => {
    /*
     * The structural argument, and it contains no clock. Every volley costs a seat one of
     * exactly two finite things — a point of durability if it took cover, a life if it did
     * not — and neither is ever replaced. The player driven here is better than any player
     * could be: it is simply placed in cover whenever cover exists. It still runs out.
     */
    for (let seed = 0; seed < 120; seed += 1) {
      const game = started(seed);
      const rng = new Rng(seed);
      let steps = 0;
      for (; steps < 60 * 200 && game.phase === 'live'; steps += 1) {
        expect(game.volley, `seed ${String(seed)} read past the schedule`).toBeLessThan(
          MAX_VOLLEYS,
        );
        const from = bearingOf(game);
        for (const seat of ['p1', 'p2'] as SeatId[]) {
          const field = fieldOf(game, seat);
          for (let i = 0; i < SLOTS; i += 1) {
            if (!coveredAt(field, slotX(i), from)) continue;
            field.x = slotX(i);
            break;
          }
        }
        step(game, STEP, 0, 0, rng);
      }
      expect(game.phase, `seed ${String(seed)} never ended a round`).not.toBe('live');
      expect(game.volley).toBeLessThanOrEqual(MAX_VOLLEYS);
    }
  });

  it('sizes the schedule from the arithmetic rather than from a measurement', () => {
    expect(MAX_VOLLEYS).toBe(FIELD_DURABILITY + LIVES);
    expect(FIELD_DURABILITY).toBe(SLOTS * STONE_HITS);
  });

  it('finishes a match between two players who never move', () => {
    const game = started(41);
    const rng = new Rng(41);
    let steps = 0;
    for (; steps < 60 * 600 && game.winner === null; steps += 1) step(game, STEP, 0, 0, rng);
    expect(winnerOf(game)).not.toBeNull();
    expect(game.rounds).toBeLessThanOrEqual(MAX_ROUNDS);
    // Neither of them ever took cover, so nobody took a round.
    expect(game.p1Rounds).toBe(0);
    expect(game.p2Rounds).toBe(0);
    expect(steps / 60).toBeLessThan(120);
  });

  it('stops the match at the target, or at the cap', () => {
    const game = started(42);
    game.p1Rounds = TARGET_ROUNDS;
    game.phase = 'settling';
    game.hold = 0;
    step(game, STEP, 0, 0, new Rng(1));
    expect(game.phase).toBe('over');
    expect(winnerOf(game)).toBe('p1');
  });

  it('stops simulating once it is decided', () => {
    const game = started(43);
    game.phase = 'over';
    game.winner = 'draw';
    const before = game.p1.x;
    step(game, STEP, RIGHT, RIGHT, new Rng(1));
    expect(game.p1.x).toBe(before);
  });
});

describe('the bot', () => {
  function countedRng(source: Rng): { rng: Rng; draws: () => number } {
    let draws = 0;
    const rng = {
      float: () => {
        draws += 1;
        return source.float();
      },
    } as unknown as Rng;
    return { rng, draws: () => draws };
  }

  it('draws the same number of values whatever it decides', () => {
    // Two bots share one Rng: a seat whose draw count depends on its decision shifts the
    // other seat's stream, which is a seat bias made of arithmetic.
    for (const tier of TIERS) {
      const game = started(51);
      const state = createBotState();
      const source = new Rng(7);
      for (let i = 0; i < 500 && game.phase !== 'over'; i += 1) {
        const counter = countedRng(source);
        state.cooldown = 0;
        botAsk(game, 'p1', tier, state, STEP, counter.rng);
        expect(counter.draws(), `${tier} step ${String(i)}`).toBe(BOT_DRAWS_PER_LOOK);
        step(game, STEP, RIGHT, LEFT, source);
      }
    }
  });

  it('spends nothing on a step it is not looking', () => {
    const game = started(52);
    const state = createBotState();
    state.cooldown = 10;
    const counter = countedRng(new Rng(1));
    botAsk(game, 'p1', 'hard', state, STEP, counter.rng);
    expect(counter.draws()).toBe(0);
  });

  it('never consults a volley that has not been announced', () => {
    /*
     * Rule 6, in the only form that can actually be proved: the rest of the schedule is
     * rewritten under the bot and it must not notice. A bot that read one volley ahead
     * would know where to stand for a bearing nobody on the screen can see.
     */
    for (const tier of TIERS) {
      for (let seed = 0; seed < 40; seed += 1) {
        const game = started(seed);
        for (let i = 0; i < 90; i += 1) step(game, STEP, RIGHT, 0, new Rng(1));
        const state = createBotState();
        const asked = botAsk(game, 'p1', tier, state, STEP, new Rng(9));
        const target = state.target;

        for (let i = game.volley + 1; i < MAX_VOLLEYS; i += 1) {
          game.schedule[i] = (i % 3) - 1;
        }
        const after = createBotState();
        expect(
          botAsk(game, 'p1', tier, after, STEP, new Rng(9)),
          `${tier} seed ${String(seed)}`,
        ).toBe(asked);
        expect(after.target).toBe(target);
      }
    }
  });

  it('never looks at the other seat', () => {
    for (const tier of TIERS) {
      const game = started(61);
      for (let i = 0; i < 120; i += 1) step(game, STEP, LEFT, RIGHT, new Rng(1));
      const state = createBotState();
      const asked = botAsk(game, 'p1', tier, state, STEP, new Rng(3));

      game.p2.x = ROW_LENGTH;
      game.p2.lives = 0;
      for (const stone of game.p2.stones) {
        stone.hits = 0;
        stone.shields = LEFT;
      }
      const after = createBotState();
      expect(botAsk(game, 'p1', tier, after, STEP, new Rng(3)), tier).toBe(asked);
      expect(after.target).toBe(state.target);
    }
  });

  it('asks for nothing a person could not ask for', () => {
    // It returns a direction, never a distance: the same `driveField` moves it, at the same
    // WALK_SPEED, as moves a person.
    for (const tier of TIERS) {
      const game = started(62);
      const state = createBotState();
      const rng = new Rng(5);
      for (let i = 0; i < 900 && game.phase !== 'over'; i += 1) {
        const ask = botAsk(game, 'p1', tier, state, STEP, rng);
        expect([LEFT, 0, RIGHT]).toContain(ask);
        step(game, STEP, ask, 0, rng);
      }
    }
  });

  it('is ordered by accuracy and reach, never by nerve', () => {
    /*
     * Slot Cars ordered its tiers by how near the limit each was willing to run and its
     * `hard` lost, because one misjudgement cost more than the boldness bought. The
     * equivalent knob here is how much of a volley's flight a bot will spend walking, and
     * every tier shares it — a tier is better only by being righter.
     */
    expect(BOT_PROFILES.hard.reaction).toBeLessThan(BOT_PROFILES.normal.reaction);
    expect(BOT_PROFILES.normal.reaction).toBeLessThan(BOT_PROFILES.easy.reaction);
    expect(BOT_PROFILES.hard.wander).toBeLessThan(BOT_PROFILES.easy.wander);
    expect(BOT_PROFILES.hard.foresight).toBeGreaterThan(BOT_PROFILES.normal.foresight);
    expect(BOT_PROFILES.easy.foresight).toBe(0);
    expect(BOT_MARGIN).toBeLessThan(1);
  });

  it('lives longer as the tier goes up', () => {
    const survival = TIERS.map((tier) => soloSurvival(tier));
    const [easy, normal, hard] = survival as [number, number, number];
    expect(normal, `easy ${easy.toFixed(2)} normal ${normal.toFixed(2)}`).toBeGreaterThan(easy);
    expect(hard, `normal ${normal.toFixed(2)} hard ${hard.toFixed(2)}`).toBeGreaterThan(normal);
    // And the gap is a gap rather than a rounding: 6.50, 6.95, 7.37 over 300 seeds.
    expect(hard - easy).toBeGreaterThan(0.5);
  });

  it('is balanced against itself, over enough seeds to mean it', () => {
    /*
     * Four hundred rather than sixty. This game is decided by a handful of volleys and the
     * first four hundred seeds put `easy` at 56% — a figure that twelve hundred returned to
     * 51.8%. Sixty would have reported a bias that is not there, and a wider band would
     * have hidden the question rather than answered it. The full twelve hundred are in
     * SPEC.md; four hundred is what fits in a test that runs on every commit.
     */
    for (const tier of TIERS) {
      const wins = playSeries(tier, tier, 400);
      const decided = wins.p1 + wins.p2;
      expect(decided, `${tier} decided nothing`).toBeGreaterThan(200);
      const share = wins.p1 / decided;
      const detail = `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`;
      expect(share, detail).toBeGreaterThan(0.4);
      expect(share, detail).toBeLessThan(0.6);
    }
  });

  it('beats a weaker tier from either seat', () => {
    for (const [strong, weak] of [
      ['hard', 'easy'],
      ['normal', 'easy'],
      ['hard', 'normal'],
    ] as [BotDifficulty, BotDifficulty][]) {
      const asP1 = playSeries(strong, weak, 100);
      expect(asP1.p1, `${strong} as p1 v ${weak}`).toBeGreaterThan(asP1.p2 * 2);
      const asP2 = playSeries(weak, strong, 100);
      expect(asP2.p2, `${strong} as p2 v ${weak}`).toBeGreaterThan(asP2.p1 * 2);
    }
  });
});

/**
 * Volleys a tier survives, on average, against an opponent that cannot lose first.
 *
 * The far seat is *placed* in cover every step rather than played, because a round ends
 * when either seat runs out and an idle opponent ends it in two volleys — which measures
 * the opponent's absence and not the tier. The first version of this did exactly that and
 * put all three tiers within a fifth of a volley of each other.
 */
function soloSurvival(tier: BotDifficulty): number {
  let survived = 0;
  const runs = 300;
  for (let seed = 0; seed < runs; seed += 1) {
    const game = started(900 + seed);
    const rng = new Rng(900 + seed);
    const state = createBotState();
    for (let i = 0; i < 60 * 200 && game.phase === 'live'; i += 1) {
      const from = bearingOf(game);
      for (let slot = 0; slot < SLOTS; slot += 1) {
        if (!coveredAt(game.p2, slotX(slot), from)) continue;
        game.p2.x = slotX(slot);
        break;
      }
      step(game, STEP, botAsk(game, 'p1', tier, state, STEP, rng), 0, rng);
    }
    survived += game.p1.survived;
  }
  return survived / runs;
}

function playSeries(
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  matches: number,
): { p1: number; p2: number; draw: number } {
  const wins = { p1: 0, p2: 0, draw: 0 };
  for (let match = 0; match < matches; match += 1) {
    const rng = new Rng(match);
    const game = createGame();
    resetGame(game, rng);
    const p1State = createBotState();
    const p2State = createBotState();
    for (let i = 0; i < 60 * 600 && game.winner === null; i += 1) {
      const p1 = botAsk(game, 'p1', p1Tier, p1State, STEP, rng);
      const p2 = botAsk(game, 'p2', p2Tier, p2State, STEP, rng);
      step(game, STEP, p1, p2, rng);
    }
    if (game.winner === 'p1') wins.p1 += 1;
    else if (game.winner === 'p2') wins.p2 += 1;
    else wins.draw += 1;
  }
  return wins;
}

describe('determinism', () => {
  it('replays a fixed script to the identical final state', () => {
    const play = (): Game => {
      const game = createGame();
      const rng = new Rng(4242);
      resetGame(game, rng);
      const script = new Rng(99);
      for (let i = 0; i < 60 * 200 && game.winner === null; i += 1) {
        const p1 = (Math.round(script.float() * 2) - 1) as Ask;
        const p2 = (Math.round(script.float() * 2) - 1) as Ask;
        step(game, STEP, p1, p2, rng);
      }
      return game;
    };
    expect(play()).toEqual(play());
  });

  it('reports the same field for the same seat', () => {
    const game = started(88);
    expect(fieldOf(game, 'p1')).toBe(game.p1);
    expect(fieldOf(game, 'p2')).toBe(game.p2);
  });

  it('holds a stone at the position its slot names', () => {
    const game = started(89);
    for (let i = 0; i < SLOTS; i += 1) expect((game.p1.stones[i] as Stone).x).toBe(slotX(i));
  });
});
