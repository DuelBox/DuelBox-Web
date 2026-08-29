import { describe, expect, it } from 'vitest';
import type { SeatId } from '@duelbox/engine';
import { initialMatchState, reduce, type MatchState } from '@duelbox/game-sdk';
import {
  BOT_DIFFICULTIES,
  DEFAULT_DIFFICULTY,
  DEFAULT_ROUNDS,
  DEFAULT_SETUP,
  ROUND_CHOICES,
  botSeatsFor,
  isBotDifficulty,
  isRoundChoice,
  matchRulesFor,
} from './match-setup';

/**
 * The pre-match choices, and the two places they have to arrive.
 *
 * Both were built and neither was reachable (#2485): three tiers per game, tuned over many
 * commits and measured into ~100 specs, with the shell hardcoding `normal`; and a best-of
 * machine in the SDK with the shell hardcoding one round. So what these assert is not that
 * the values are legal but that they *land* — the tier in the context a game reads, and the
 * length in a match that can actually reach `round-over`.
 */

describe('the tiers on offer', () => {
  it('offers exactly the three every game implements', () => {
    expect([...BOT_DIFFICULTIES]).toEqual(['easy', 'normal', 'hard']);
  });

  it('starts a player on normal, which is what the shell used to force on everyone', () => {
    expect(DEFAULT_SETUP.difficulty).toBe(DEFAULT_DIFFICULTY);
    expect(DEFAULT_DIFFICULTY).toBe('normal');
  });

  it('recognises only tiers a game would understand', () => {
    for (const tier of BOT_DIFFICULTIES) expect(isBotDifficulty(tier)).toBe(true);
    for (const other of ['telepathy', 'NORMAL', '', null, 2]) {
      expect(isBotDifficulty(other)).toBe(false);
    }
  });
});

/**
 * The path a chosen tier takes: the pre-match screen hands `botSeatsFor` to the game host
 * as `botDifficulty`, and the host reads it per seat into `GameContext.botDifficulty`.
 * That last hop is one line in `GameHost`, repeated here, because a tier that stops
 * anywhere along the way is exactly the defect this issue is about.
 */
function contextDifficulty(
  seats: Partial<Record<SeatId, string>> | undefined,
): (seat: SeatId) => string | null {
  return (seat) => seats?.[seat] ?? null;
}

describe('handing the chosen tier to a game', () => {
  it('seats the bot opposite the player, at the tier they picked', () => {
    for (const tier of BOT_DIFFICULTIES) {
      const read = contextDifficulty(botSeatsFor('bot', tier));
      expect(read('p2'), `a ${tier} bot must reach the game as ${tier}`).toBe(tier);
      // Rule 6's other half: the human seat is nobody's bot.
      expect(read('p1')).toBeNull();
    }
  });

  it('tells a game playing two humans that there is no bot at all', () => {
    expect(botSeatsFor('friend', 'hard')).toBeUndefined();
    const read = contextDifficulty(botSeatsFor('friend', 'hard'));
    expect(read('p1')).toBeNull();
    expect(read('p2')).toBeNull();
  });

  it('never hands two tiers to one match', () => {
    // The object identity is the game host's setup-effect dependency, so it is built once
    // per choice and not per render. What is asserted here is only its shape.
    expect(botSeatsFor('bot', 'easy')).toEqual({ p2: 'easy' });
  });
});

describe('the match lengths on offer', () => {
  it('offers odd lengths only, so a best-of cannot be split down the middle', () => {
    for (const rounds of ROUND_CHOICES) expect(rounds % 2).toBe(1);
  });

  it('recognises only the lengths it offers', () => {
    for (const rounds of ROUND_CHOICES) expect(isRoundChoice(rounds)).toBe(true);
    for (const other of [0, 2, 4, 7, -1, 1.5, '3', null]) expect(isRoundChoice(other)).toBe(false);
  });

  it('falls back to the default rather than building illegal rules', () => {
    // `reduce` throws a RangeError on a non-positive round count, and the value can arrive
    // from storage another tab wrote.
    expect(matchRulesFor(0).rounds).toBe(DEFAULT_ROUNDS);
    expect(matchRulesFor(Number.NaN).rounds).toBe(DEFAULT_ROUNDS);
  });
});

/** Runs a round to a decision, the way the host does: start, count in, then a score. */
function playRound(state: MatchState, rules: ReturnType<typeof matchRulesFor>, winner: SeatId) {
  let next = reduce(state, { kind: 'tick', seconds: 3 }, rules);
  expect(next.phase, 'the countdown hands over to play').toBe('playing');
  next = reduce(
    next,
    { kind: 'score', tally: { p1: winner === 'p1' ? 1 : 0, p2: winner === 'p2' ? 1 : 0 } },
    rules,
  );
  return next;
}

describe('reaching round-over, which no player could', () => {
  it('enters round-over on the default length, rather than ending the match', () => {
    const rules = matchRulesFor(DEFAULT_SETUP.rounds);
    const started = reduce(initialMatchState(), { kind: 'start', seed: 7 }, rules);
    expect(playRound(started, rules, 'p1').phase).toBe('round-over');
  });

  it('is what one round made unreachable', () => {
    // The defect, pinned: with the hardcoded length the machine goes straight to the end
    // and the "Next round" screen, the round pips and the opening-seat rotation are all
    // dead code in the product.
    const rules = matchRulesFor(1);
    const started = reduce(initialMatchState(), { kind: 'start', seed: 7 }, rules);
    expect(playRound(started, rules, 'p1').phase).toBe('match-over');
  });

  it('carries on to a second round, which opens on the other seat (#2466)', () => {
    const rules = matchRulesFor(DEFAULT_SETUP.rounds);
    const started = reduce(initialMatchState(), { kind: 'start', seed: 7 }, rules);
    expect(started.openingSeat, 'round one always opens on seat one').toBe('p1');
    const decided = playRound(started, rules, 'p1');
    const second = reduce(decided, { kind: 'next-round' }, rules);
    expect(second.round).toBe(2);
    expect(second.openingSeat, 'and round two never does').toBe('p2');
  });

  it('still ends the match once someone takes the majority', () => {
    const rules = matchRulesFor(DEFAULT_SETUP.rounds);
    let state = reduce(initialMatchState(), { kind: 'start', seed: 7 }, rules);
    state = playRound(state, rules, 'p2');
    state = reduce(state, { kind: 'next-round' }, rules);
    state = playRound(state, rules, 'p2');
    expect(state.phase).toBe('match-over');
    expect(state.matchOutcome).toBe('p2');
    expect(state.roundWins).toEqual({ p1: 0, p2: 2 });
  });
});
