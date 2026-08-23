import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import { resolveSimultaneous } from '@duelbox/game-sdk';
import {
  BOT_DRAWS_PER_ROUND,
  BOT_PROFILES,
  FRUIT_COUNT,
  MAX_ROUNDS,
  MAX_WAIT,
  MIN_WAIT,
  REVEAL_SECONDS,
  SHOW_SECONDS,
  SUBJECTS,
  TARGET_POINTS,
  TIE_TOLERANCE,
  bladeAt,
  botCuts,
  createBotState,
  createGame,
  cut,
  isFalseStart,
  isFruit,
  nextRound,
  otherOf,
  planRound,
  pointsOf,
  resetGame,
  step,
  verdictOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game, Subject } from './rules.js';

const STEP = 1 / 60;

function started(seed = 1): { game: Game; rng: Rng } {
  const game = createGame();
  const rng = new Rng(seed);
  resetGame(game, rng);
  return { game, rng };
}

/** Run until the subject is on screen. */
function toShowing(game: Game, rng: Rng): void {
  for (let i = 0; i < 600 && game.phase === 'waiting'; i += 1) step(game, STEP, rng);
}

/** Force a specific subject onto a fresh round. */
function withSubject(seed: number, subject: Subject): { game: Game; rng: Rng } {
  const { game, rng } = started(seed);
  game.subject = subject;
  toShowing(game, rng);
  return { game, rng };
}

describe('what appears', () => {
  it('knows which of the five are fruit', () => {
    expect(SUBJECTS).toHaveLength(5);
    expect(SUBJECTS.filter(isFruit)).toEqual(['melon', 'pomegranate', 'orange']);
    expect(isFruit('bomb')).toBe(false);
    expect(isFruit('stone')).toBe(false);
  });

  it('shows fruit more often than not, but not so often that cutting on sight pays', () => {
    // At an even split the cheapest strategy is to keep still; at four in five a player may
    // as well cut everything. Between the two, both decisions cost something.
    const game = createGame();
    const rng = new Rng(11);
    let fruit = 0;
    const rounds = 4000;
    for (let i = 0; i < rounds; i += 1) {
      nextRound(game, rng);
      if (isFruit(game.subject)) fruit += 1;
    }
    const share = fruit / rounds;
    expect(share).toBeGreaterThan(0.55);
    expect(share).toBeLessThan(0.7);
  });

  it('uses every subject across a run', () => {
    const seen = new Set<Subject>();
    const game = createGame();
    const rng = new Rng(3);
    for (let i = 0; i < 500; i += 1) {
      nextRound(game, rng);
      seen.add(game.subject);
    }
    expect(seen.size).toBe(SUBJECTS.length);
  });

  it('waits a different length every round', () => {
    // A fixed delay is learnable in three rounds and then both players are pressing on a
    // beat rather than reacting to anything.
    const game = createGame();
    const rng = new Rng(7);
    const waits = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      nextRound(game, rng);
      expect(game.timer).toBeGreaterThanOrEqual(MIN_WAIT);
      expect(game.timer).toBeLessThanOrEqual(MAX_WAIT);
      waits.add(game.timer.toFixed(4));
    }
    expect(waits.size).toBeGreaterThan(50);
  });
});

describe('a blade', () => {
  it('is recorded, not resolved', () => {
    // Resolving on arrival would hand the point to whichever seat the loop read first.
    const { game } = withSubject(1, 'melon');
    expect(cut(game, 'p1', 0.3)).toBe(true);
    expect(bladeAt(game, 'p1')).toBe(0.3);
    expect(game.p1Points).toBe(0);
    expect(game.phase).toBe('showing');
  });

  it('cannot be swung twice in a round', () => {
    const { game } = withSubject(1, 'melon');
    expect(cut(game, 'p1', 0.3)).toBe(true);
    expect(cut(game, 'p1', 0.1)).toBe(false);
    expect(bladeAt(game, 'p1')).toBe(0.3);
  });

  it('is refused once the round is over', () => {
    const { game, rng } = withSubject(1, 'melon');
    cut(game, 'p1', 0.2);
    cut(game, 'p2', 0.3);
    step(game, STEP, rng);
    expect(game.phase).toBe('revealing');
    expect(cut(game, 'p1', 0.4)).toBe(false);
  });
});

describe('scoring a fruit', () => {
  it('goes to whoever cut first', () => {
    const { game, rng } = withSubject(1, 'melon');
    cut(game, 'p1', 0.4);
    cut(game, 'p2', 0.25);
    step(game, STEP, rng);
    expect(game.p2Points).toBe(1);
    expect(game.p1Points).toBe(0);
    expect(verdictOf(game, 'p1')).toBe('cut');
    expect(verdictOf(game, 'p2')).toBe('cut');
  });

  it('goes to both when they cannot be separated', () => {
    // Two people cannot be told apart by four milliseconds, and pretending otherwise is a
    // lie the game would tell sixty times a match.
    const { game, rng } = withSubject(1, 'orange');
    cut(game, 'p1', 0.3);
    cut(game, 'p2', 0.3 + TIE_TOLERANCE / 2);
    step(game, STEP, rng);
    expect(game.p1Points).toBe(1);
    expect(game.p2Points).toBe(1);
  });

  it('uses the same tolerance the SDK does', () => {
    // The rules module inlines four lines rather than importing the SDK; this is what stops
    // the two drifting apart.
    expect(resolveSimultaneous(0.3, 0.3 + TIE_TOLERANCE / 2)).toBe('draw');
    expect(resolveSimultaneous(0.3, 0.3 + TIE_TOLERANCE * 2)).toBe('p1');
    expect(resolveSimultaneous(0.3 + TIE_TOLERANCE * 2, 0.3)).toBe('p2');
  });

  it('goes to the only player who moved', () => {
    const { game, rng } = withSubject(1, 'pomegranate');
    cut(game, 'p2', 0.5);
    for (let i = 0; i < 200 && game.phase === 'showing'; i += 1) step(game, STEP, rng);
    expect(game.p2Points).toBe(1);
    expect(game.p1Points).toBe(0);
    expect(verdictOf(game, 'p1')).toBe('held');
  });

  it('goes to nobody when neither moves', () => {
    const { game, rng } = withSubject(1, 'melon');
    for (let i = 0; i < 300 && game.phase === 'showing'; i += 1) step(game, STEP, rng);
    expect(game.p1Points).toBe(0);
    expect(game.p2Points).toBe(0);
    expect(game.phase).toBe('revealing');
  });

  it('abandons the round after the subject has been up long enough', () => {
    const { game, rng } = withSubject(1, 'melon');
    let elapsed = 0;
    for (let i = 0; i < 600 && game.phase === 'showing'; i += 1) {
      step(game, STEP, rng);
      elapsed += STEP;
    }
    expect(elapsed).toBeGreaterThanOrEqual(SHOW_SECONDS - STEP * 2);
    expect(elapsed).toBeLessThan(SHOW_SECONDS + 0.1);
  });
});

describe('a mistake', () => {
  it('cutting something that is not fruit scores for the other player', () => {
    for (const subject of ['bomb', 'stone'] as Subject[]) {
      const { game, rng } = withSubject(2, subject);
      cut(game, 'p1', 0.3);
      for (let i = 0; i < 300 && game.phase === 'showing'; i += 1) step(game, STEP, rng);
      expect(verdictOf(game, 'p1')).toBe('wrong');
      expect(game.p2Points).toBe(1);
      expect(game.p1Points).toBe(0);
    }
  });

  it('jumping before the subject appears scores for the other player', () => {
    const { game, rng } = started(3);
    expect(game.phase).toBe('waiting');
    cut(game, 'p1', 0);
    expect(isFalseStart(bladeAt(game, 'p1'))).toBe(true);
    step(game, STEP, rng);
    expect(verdictOf(game, 'p1')).toBe('early');
    expect(game.p2Points).toBe(1);
  });

  it('ends the wait at once rather than making the jumper sit it out', () => {
    // A punishment with no information in it is just a delay.
    const { game, rng } = started(3);
    cut(game, 'p2', 0);
    step(game, STEP, rng);
    expect(game.phase).toBe('revealing');
  });

  it('costs both of them when both err', () => {
    const { game, rng } = withSubject(4, 'bomb');
    cut(game, 'p1', 0.2);
    cut(game, 'p2', 0.4);
    step(game, STEP, rng);
    expect(game.p1Points).toBe(1);
    expect(game.p2Points).toBe(1);
  });

  it('still costs a player who cut a bomb, even if the other jumped early', () => {
    const { game, rng } = started(5);
    game.subject = 'bomb';
    cut(game, 'p1', 0); // early, while still waiting
    step(game, STEP, rng);
    expect(verdictOf(game, 'p1')).toBe('early');
    expect(game.p2Points).toBe(1);
    expect(game.p1Points).toBe(0);
  });
});

describe('the match', () => {
  it('moves on to the next round after the reveal', () => {
    const { game, rng } = withSubject(1, 'melon');
    cut(game, 'p1', 0.2);
    cut(game, 'p2', 0.3);
    step(game, STEP, rng);
    for (let i = 0; i < 200 && game.phase === 'revealing'; i += 1) step(game, STEP, rng);
    expect(game.phase).toBe('waiting');
    expect(game.rounds).toBe(2);
    expect(bladeAt(game, 'p1')).toBe(-1);
    expect(verdictOf(game, 'p1')).toBeNull();
  });

  it('always ends, even if neither player ever moves', () => {
    // Structural: a fixed number of rounds, each with its own clock, so nothing about how
    // it is played can extend it.
    const { game, rng } = started(9);
    let steps = 0;
    const ceiling = Math.round(
      (MAX_ROUNDS * (MAX_WAIT + SHOW_SECONDS + REVEAL_SECONDS) + 5) / STEP,
    );
    for (; steps < ceiling && game.phase !== 'over'; steps += 1) step(game, STEP, rng);
    expect(game.phase).toBe('over');
    expect(winnerOf(game)).toBe('draw');
    expect(game.rounds).toBe(MAX_ROUNDS);
  });

  it('ends once somebody reaches the target', () => {
    const { game, rng } = withSubject(1, 'melon');
    game.p1Points = TARGET_POINTS - 1;
    cut(game, 'p1', 0.2);
    step(game, STEP, rng);
    for (let i = 0; i < 400 && game.phase !== 'over'; i += 1) step(game, STEP, rng);
    expect(pointsOf(game, 'p1')).toBe(TARGET_POINTS);
    expect(winnerOf(game)).toBe('p1');
    expect(game.rounds).toBeLessThan(MAX_ROUNDS);
  });

  it('stops simulating once it is decided', () => {
    const { game, rng } = started(1);
    game.phase = 'over';
    game.winner = 'draw';
    const rounds = game.rounds;
    const timer = game.timer;
    step(game, STEP, rng);
    expect(game.rounds).toBe(rounds);
    expect(game.timer).toBe(timer);
  });

  it('names the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

describe('the bot', () => {
  const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('never reacts faster than a person could', () => {
    // A bot cutting in one frame would not be a hard opponent, it would be a wall. Rule 6
    // is unusually literal here: a good human go/no-go reaction is around 280 ms.
    expect(BOT_PROFILES.hard.reaction).toBeGreaterThanOrEqual(0.25);
    for (const tier of TIERS) {
      expect(BOT_PROFILES[tier].reaction - BOT_PROFILES[tier].jitter).toBeGreaterThan(0.15);
    }
  });

  it('gets faster and more accurate as the tier goes up', () => {
    let previousReaction = Infinity;
    let previousMistakes = Infinity;
    for (const tier of TIERS) {
      expect(BOT_PROFILES[tier].reaction).toBeLessThan(previousReaction);
      expect(BOT_PROFILES[tier].mistakes).toBeLessThan(previousMistakes);
      previousReaction = BOT_PROFILES[tier].reaction;
      previousMistakes = BOT_PROFILES[tier].mistakes;
    }
  });

  it('draws the same number of values from the shared stream whatever it decides', () => {
    /*
     * The two bots share one `Rng`, so a seat whose draw count depends on what it did
     * shifts the other seat's stream — and that is a seat bias, not a coincidence.
     *
     * The first version drew two values normally, three when a false start fired, and
     * skipped the mistake roll on a round it jumped. Over forty matches of `normal` against
     * `normal`, p1 won 30. Nothing in the rules favoured either seat; the coupling did, and
     * it was invisible because every individual draw was uniform.
     */
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const counter = new Rng(seed);
        let draws = 0;
        const counted = {
          float: () => {
            draws += 1;
            return counter.float();
          },
        } as unknown as Rng;
        planRound(createBotState(), tier, counted);
        expect(draws, `${tier} seed ${String(seed)}`).toBe(BOT_DRAWS_PER_ROUND);
      }
    }
  });

  it('commits to its timing before it can see the subject', () => {
    const state = createBotState();
    const rng = new Rng(5);
    planRound(state, 'normal', rng);
    const committed = state.at;
    planRound(state, 'normal', rng);
    expect(state.at).not.toBe(committed);
    // And within its own tier's envelope, every time.
    for (let i = 0; i < 200; i += 1) {
      planRound(state, 'hard', rng);
      expect(state.at).toBeGreaterThan(0);
      expect(state.at).toBeLessThan(BOT_PROFILES.hard.reaction + BOT_PROFILES.hard.jitter + 1e-9);
    }
  });

  it('holds when it should, most of the time', () => {
    // The go/no-go decision is the game. A bot that cut everything would score for its
    // opponent on four rounds in ten.
    for (const tier of TIERS) {
      let cuts = 0;
      let rounds = 0;
      for (let trial = 0; trial < 300; trial += 1) {
        const { game, rng } = withSubject(trial + 40, 'bomb');
        const state = createBotState();
        rounds += 1;
        for (let i = 0; i < 300 && game.phase === 'showing'; i += 1) {
          if (botCuts(game, tier, state, rng)) {
            cut(game, 'p1', game.timer);
            cuts += 1;
          }
          step(game, STEP, rng);
        }
      }
      const rate = cuts / rounds;
      expect(rate, `${tier} cut ${(rate * 100).toFixed(0)}% of bombs`).toBeLessThan(
        BOT_PROFILES[tier].mistakes + 0.12,
      );
    }
  });

  it('is balanced against itself', () => {
    // Both seats watch the same subject on the same step and neither can act before the
    // other; a bias here would mean the resolution had a side to it.
    for (const tier of TIERS) {
      const wins = playSeries(tier, tier, 40);
      const decided = wins.p1 + wins.p2;
      expect(decided, `${tier} decided nothing`).toBeGreaterThan(15);
      const share = wins.p1 / decided;
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeGreaterThan(
        0.35,
      );
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeLessThan(0.65);
    }
  });

  it('beats a weaker tier from either seat', () => {
    for (const [strong, weak] of [
      ['hard', 'easy'],
      ['normal', 'easy'],
      ['hard', 'normal'],
    ] as [BotDifficulty, BotDifficulty][]) {
      const asP1 = playSeries(strong, weak, 30);
      expect(asP1.p1, `${strong} as p1 v ${weak}`).toBeGreaterThan(asP1.p2 * 2);
      const asP2 = playSeries(weak, strong, 30);
      expect(asP2.p2, `${strong} as p2 v ${weak}`).toBeGreaterThan(asP2.p1 * 2);
    }
  });
});

function playSeries(
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  matches: number,
): { p1: number; p2: number; draw: number } {
  const wins = { p1: 0, p2: 0, draw: 0 };
  for (let match = 0; match < matches; match += 1) {
    const game = createGame();
    const rng = new Rng(800 + match);
    resetGame(game, rng);
    const states = { p1: createBotState(), p2: createBotState() };
    const tiers: Record<SeatId, BotDifficulty> = { p1: p1Tier, p2: p2Tier };

    for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        if (botCuts(game, tiers[seat], states[seat], rng)) cut(game, seat, game.timer);
      }
      step(game, STEP, rng);
    }
    if (game.winner === 'p1') wins.p1 += 1;
    else if (game.winner === 'p2') wins.p2 += 1;
    else wins.draw += 1;
  }
  return wins;
}

describe('determinism', () => {
  it('deals the identical match from the same seed', () => {
    const play = (): Game => {
      const game = createGame();
      const rng = new Rng(20260823);
      resetGame(game, rng);
      const script = new Rng(555);
      for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
        if (script.float() < 0.01) cut(game, 'p1', game.timer);
        if (script.float() < 0.01) cut(game, 'p2', game.timer);
        step(game, STEP, rng);
      }
      return game;
    };
    expect(play()).toEqual(play());
  });

  it('deals a different match from a different seed', () => {
    const first = (seed: number): string => {
      const game = createGame();
      resetGame(game, new Rng(seed));
      return `${game.subject}:${game.timer.toFixed(4)}`;
    };
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed += 1) seen.add(first(seed));
    expect(seen.size).toBeGreaterThan(20);
  });

  it('has exactly three fruit among five subjects', () => {
    expect(FRUIT_COUNT).toBe(3);
    expect(SUBJECTS.filter(isFruit)).toHaveLength(FRUIT_COUNT);
  });
});
