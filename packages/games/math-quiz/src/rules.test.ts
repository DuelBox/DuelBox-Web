import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  ANSWER_COUNT,
  BOT_PROFILES,
  QUESTIONS,
  QUESTION_SECONDS,
  REVEAL_SECONDS,
  answer,
  answerOf,
  apply,
  botAnswer,
  createBotState,
  createGame,
  nextQuestion,
  operandCeiling,
  otherOf,
  pointsOf,
  resetGame,
  step,
  truthOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;

function started(seed = 1): { game: Game; rng: Rng } {
  const game = createGame();
  const rng = new Rng(seed);
  resetGame(game, rng);
  return { game, rng };
}

function run(game: Game, rng: Rng, seconds: number): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) step(game, STEP, rng);
}

describe('a question', () => {
  it('offers four distinct answers, one of which is true', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const { game } = started(seed);
      const { left, right, operation, answers, correct } = game.question;
      expect(answers).toHaveLength(ANSWER_COUNT);
      expect(new Set(answers).size).toBe(ANSWER_COUNT);
      expect(answers[correct]).toBe(apply(left, right, operation));
    }
  });

  it('never asks for a negative answer', () => {
    // Subtraction below zero is a different skill, and one half the audience for this has
    // not met yet. Every distractor is non-negative too.
    for (let seed = 1; seed <= 200; seed += 1) {
      const { game, rng } = started(seed);
      for (let q = 0; q < QUESTIONS; q += 1) {
        expect(truthOf(game)).toBeGreaterThanOrEqual(0);
        for (const value of game.question.answers) expect(value).toBeGreaterThanOrEqual(0);
        nextQuestion(game, rng);
      }
    }
  });

  it('keeps the wrong answers near the right one', () => {
    // A distractor thirty away is discarded at a glance, and the game becomes a reading
    // test rather than an arithmetic one.
    for (let seed = 1; seed <= 60; seed += 1) {
      const { game } = started(seed);
      const truth = truthOf(game);
      for (const value of game.question.answers) {
        expect(Math.abs(value - truth)).toBeLessThanOrEqual(9);
      }
    }
  });

  it('puts the true answer in every position across a run', () => {
    // If it were always in the same slot, the whole game would be one key held down.
    const seen = new Set<number>();
    const { game, rng } = started(5);
    for (let q = 0; q < 200; q += 1) {
      seen.add(game.question.correct);
      nextQuestion(game, rng);
    }
    expect(seen.size).toBe(ANSWER_COUNT);
  });

  it('gets harder as the match goes on, for both players equally', () => {
    // Keyed to the question number, never to a score: a ramp that tracked the leader would
    // be a handicap, and one that tracked the trailer would reward being behind.
    expect(operandCeiling(0)).toBeLessThan(operandCeiling(5));
    expect(operandCeiling(5)).toBeLessThan(operandCeiling(14));
  });

  it('computes each operation the way a person would', () => {
    expect(apply(7, 5, '+')).toBe(12);
    expect(apply(7, 5, '-')).toBe(2);
    expect(apply(7, 5, '×')).toBe(35);
  });
});

describe('answering', () => {
  it('records an answer without resolving it', () => {
    // Resolving on arrival would hand the point to whichever seat the loop read first.
    const { game } = started();
    expect(answer(game, 'p1', game.question.correct)).toBe(true);
    expect(answerOf(game, 'p1')).toBe(game.question.correct);
    expect(game.p1Points).toBe(0);
    expect(game.phase).toBe('asking');
  });

  it('cannot be changed once given', () => {
    const { game } = started();
    const first = (game.question.correct + 1) % ANSWER_COUNT;
    expect(answer(game, 'p1', first)).toBe(true);
    expect(answer(game, 'p1', game.question.correct)).toBe(false);
    expect(answerOf(game, 'p1')).toBe(first);
  });

  it('rejects an answer that is not on the screen', () => {
    const { game } = started();
    expect(answer(game, 'p1', -1)).toBe(false);
    expect(answer(game, 'p1', ANSWER_COUNT)).toBe(false);
  });

  it('is refused while the answer is being shown', () => {
    const { game, rng } = started();
    answer(game, 'p1', game.question.correct);
    answer(game, 'p2', game.question.correct);
    step(game, STEP, rng);
    expect(game.phase).toBe('revealing');
    expect(answer(game, 'p1', 0)).toBe(false);
  });
});

describe('scoring', () => {
  it('scores the right answer to whoever gave it', () => {
    const { game, rng } = started();
    answer(game, 'p1', game.question.correct);
    // p2 has not answered, but a right answer ends the question at once.
    step(game, STEP, rng);
    expect(game.p1Points).toBe(1);
    expect(game.p2Points).toBe(0);
    expect(game.phase).toBe('revealing');
  });

  it('scores a wrong answer to the other player', () => {
    const { game, rng } = started();
    const wrong = (game.question.correct + 2) % ANSWER_COUNT;
    answer(game, 'p1', wrong);
    answer(game, 'p2', wrong === 0 ? 1 : 0);
    step(game, STEP, rng);
    // Both were wrong, so each of them handed the other a point.
    expect(game.p1Points).toBe(1);
    expect(game.p2Points).toBe(1);
  });

  it('scores both when both are right on the same step', () => {
    // Two seats, one instant. The alternative is picking a winner by iteration order.
    const { game, rng } = started();
    answer(game, 'p1', game.question.correct);
    answer(game, 'p2', game.question.correct);
    step(game, STEP, rng);
    expect(game.p1Points).toBe(1);
    expect(game.p2Points).toBe(1);
  });

  it('makes guessing expensive', () => {
    // Four answers, so a guess is right one time in four and hands a point over the other
    // three. Enumerated on one fixed question rather than sampled: every choice is tried
    // exactly once, which is what a guess is.
    expect(ANSWER_COUNT).toBe(4);
    let net = 0;
    for (let choice = 0; choice < ANSWER_COUNT; choice += 1) {
      const game = createGame();
      const rng = new Rng(11);
      resetGame(game, rng);
      answer(game, 'p1', choice);
      // p2 sits it out, so the only points on the board came from p1's guess.
      run(game, rng, QUESTION_SECONDS + STEP);
      net += game.p1Points - game.p2Points;
    }
    expect(net).toBe(1 - (ANSWER_COUNT - 1));
  });

  it('scores nobody when neither answers before the clock', () => {
    const { game, rng } = started();
    run(game, rng, QUESTION_SECONDS + STEP);
    expect(game.p1Points).toBe(0);
    expect(game.p2Points).toBe(0);
    expect(game.phase).toBe('revealing');
  });

  it('waits for the second player when the first is wrong', () => {
    // A wrong answer must not end the question, or answering first would be a way to deny
    // the other player their turn at it.
    const { game, rng } = started();
    const wrong = (game.question.correct + 1) % ANSWER_COUNT;
    answer(game, 'p1', wrong);
    step(game, STEP, rng);
    expect(game.phase).toBe('asking');
    answer(game, 'p2', game.question.correct);
    step(game, STEP, rng);
    expect(game.phase).toBe('revealing');
    expect(game.p2Points).toBe(2);
  });
});

describe('the match', () => {
  it('moves on to a fresh question after the reveal', () => {
    const { game, rng } = started();
    const before = `${String(game.question.left)}${game.question.operation}${String(game.question.right)}`;
    answer(game, 'p1', game.question.correct);
    step(game, STEP, rng);
    run(game, rng, REVEAL_SECONDS + STEP);
    expect(game.phase).toBe('asking');
    expect(game.asked).toBe(2);
    expect(answerOf(game, 'p1')).toBe(-1);
    const after = `${String(game.question.left)}${game.question.operation}${String(game.question.right)}`;
    expect(after).not.toBe(before);
  });

  it('always ends, even if nobody ever answers anything', () => {
    // Structural: fifteen questions, each with a clock. Nothing about how the match is
    // played can extend it.
    const { game, rng } = started();
    let steps = 0;
    const ceiling = Math.round((QUESTIONS * (QUESTION_SECONDS + REVEAL_SECONDS) + 2) / STEP);
    for (; steps < ceiling && game.phase !== 'over'; steps += 1) step(game, STEP, rng);
    expect(game.phase).toBe('over');
    expect(winnerOf(game)).toBe('draw');
    expect(game.asked).toBe(QUESTIONS);
  });

  it('is won by whoever has more points at the end', () => {
    const { game, rng } = started();
    for (let q = 0; q < QUESTIONS; q += 1) {
      answer(game, 'p1', game.question.correct);
      step(game, STEP, rng);
      run(game, rng, REVEAL_SECONDS + STEP);
    }
    expect(game.phase).toBe('over');
    expect(pointsOf(game, 'p1')).toBe(QUESTIONS);
    expect(winnerOf(game)).toBe('p1');
  });

  it('stops simulating once it is decided', () => {
    const { game, rng } = started();
    game.phase = 'over';
    game.winner = 'draw';
    const asked = game.asked;
    step(game, STEP, rng);
    expect(game.asked).toBe(asked);
  });
});

describe('the bot', () => {
  const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('only ever picks one of the four answers on the screen', () => {
    for (const tier of TIERS) {
      const { game, rng } = started();
      const state = createBotState();
      for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
        const choice = botAnswer(game, tier, state, rng, STEP);
        if (choice >= 0) {
          expect(choice).toBeGreaterThanOrEqual(0);
          expect(choice).toBeLessThan(ANSWER_COUNT);
          answer(game, 'p1', choice);
        }
        step(game, STEP, rng);
      }
      expect(game.phase).toBe('over');
    }
  });

  it('answers faster and more accurately as the tier goes up', () => {
    let previousTime = Infinity;
    let previousAccuracy = -1;
    for (const tier of TIERS) {
      const { time, accuracy } = soloRun(tier);
      expect(time, `${tier} was not faster`).toBeLessThan(previousTime);
      expect(accuracy, `${tier} was not more accurate`).toBeGreaterThan(previousAccuracy);
      previousTime = time;
      previousAccuracy = accuracy;
    }
  });

  it('takes longer over a bigger sum, at every tier', () => {
    // The ramp has to bite the bot too, or a `hard` bot is unbeatable by question twelve.
    for (const tier of TIERS) {
      expect(BOT_PROFILES[tier].perUnit).toBeGreaterThan(0);
    }
  });

  it('does not change its mind while it is thinking', () => {
    // Re-rolling every step would let a slow tier stumble onto the right answer by
    // repetition — a bot that improves the longer it thinks, which is no tier at all.
    const { game, rng } = started();
    const state = createBotState();
    botAnswer(game, 'easy', state, rng, STEP);
    const committed = state.choice;
    for (let i = 0; i < 30; i += 1) botAnswer(game, 'easy', state, rng, STEP);
    expect(state.choice).toBe(committed);
  });

  it('is balanced against itself', () => {
    // The one game here that cannot be unfair: both seats see the same question on the
    // same step, and neither can act before the other. Verified rather than assumed.
    for (const tier of TIERS) {
      const wins = playSeries(tier, tier, 40);
      const decided = wins.p1 + wins.p2;
      expect(decided, `${tier} decided nothing`).toBeGreaterThan(10);
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

/** How long a tier takes over a question, and how often it is right. */
function soloRun(tier: BotDifficulty): { time: number; accuracy: number } {
  let answered = 0;
  let right = 0;
  let elapsed = 0;
  for (let trial = 0; trial < 120; trial += 1) {
    const game = createGame();
    const rng = new Rng(3000 + trial);
    resetGame(game, rng);
    const state = createBotState();
    let taken = 0;
    for (let i = 0; i < 60 * 20 && game.phase === 'asking'; i += 1) {
      taken += STEP;
      const choice = botAnswer(game, tier, state, rng, STEP);
      if (choice >= 0) {
        answered += 1;
        if (choice === game.question.correct) right += 1;
        answer(game, 'p1', choice);
      }
      step(game, STEP, rng);
    }
    elapsed += taken;
  }
  return { time: elapsed / 120, accuracy: right / answered };
}

function playSeries(
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  matches: number,
): { p1: number; p2: number; draw: number } {
  const wins = { p1: 0, p2: 0, draw: 0 };
  for (let match = 0; match < matches; match += 1) {
    const game = createGame();
    const rng = new Rng(600 + match);
    resetGame(game, rng);
    const states: Record<SeatId, ReturnType<typeof createBotState>> = {
      p1: createBotState(),
      p2: createBotState(),
    };
    const tiers: Record<SeatId, BotDifficulty> = { p1: p1Tier, p2: p2Tier };

    for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        const choice = botAnswer(game, tiers[seat], states[seat], rng, STEP);
        if (choice >= 0) answer(game, seat, choice);
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
  it('asks the identical questions from the same seed', () => {
    const ask = (): string => {
      const game = createGame();
      const rng = new Rng(20260823);
      resetGame(game, rng);
      const seen: string[] = [];
      for (let q = 0; q < QUESTIONS; q += 1) {
        seen.push(
          `${String(game.question.left)}${game.question.operation}${String(game.question.right)}=${String(truthOf(game))}[${game.question.answers.join(',')}]`,
        );
        nextQuestion(game, rng);
      }
      return seen.join('|');
    };
    expect(ask()).toBe(ask());
  });

  it('asks different questions from a different seed', () => {
    const ask = (seed: number): string => {
      const game = createGame();
      resetGame(game, new Rng(seed));
      return `${String(game.question.left)}${game.question.operation}${String(game.question.right)}`;
    };
    const seen = new Set<string>();
    for (let seed = 1; seed <= 25; seed += 1) seen.add(ask(seed));
    expect(seen.size).toBeGreaterThan(10);
  });

  it('replays a fixed script to the identical final state', () => {
    const play = (): Game => {
      const game = createGame();
      const rng = new Rng(4242);
      resetGame(game, rng);
      const script = new Rng(999);
      for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
        if (script.float() < 0.02) {
          answer(game, 'p1', Math.floor(script.float() * ANSWER_COUNT));
        }
        if (script.float() < 0.02) {
          answer(game, 'p2', Math.floor(script.float() * ANSWER_COUNT));
        }
        step(game, STEP, rng);
      }
      return game;
    };
    expect(play()).toEqual(play());
  });

  it('names the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});
