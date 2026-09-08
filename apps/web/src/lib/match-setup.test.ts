import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SeatId } from '@duelbox/engine';
import { initialMatchState, reduce, type MatchState } from '@duelbox/game-sdk';
import { CATALOGUE } from '../data/catalogue.generated';
import {
  BOT_DIFFICULTIES,
  DEFAULT_DIFFICULTY,
  DEFAULT_ROUNDS,
  DEFAULT_SETUP,
  PLAY_MODES,
  ROUND_CHOICES,
  botSeatsFor,
  isBotDifficulty,
  isPlayMode,
  isRoundChoice,
  matchRulesFor,
  offeredModes,
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

/**
 * The modes a game may declare, and the smaller set the shell can actually start (#1749).
 *
 * These are two different lists and the gap between them is where dead buttons come from.
 * `packages/game-sdk`'s vocabulary is `friend | bot | solo`; the shell's `PlayMode` union is
 * `friend | bot`. Six manifests declare `solo` today and nothing in `apps/web` can seat one
 * player alone, so a lobby that drew a button per declared mode would draw six buttons that do
 * nothing when they are pressed.
 *
 * The reader below is the same technique `app/metadata-claims.test.ts` uses on the same file
 * and for a neighbouring reason, and it is written the same way round: given a string rather
 * than given a path, so the parser itself can be handed both a union it should understand and
 * one it should not, and its silence is worth something.
 */
const MATCH_SETUP_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'match-setup.ts'),
  'utf8',
);

/**
 * The string-literal members of a declaration, or a readable failure.
 *
 * Empty is treated as unreadable rather than as an answer, and that is the part worth
 * defending. `export type PlayMode = Mode;` matches the shape and yields nothing, and a
 * reader that returned an empty set there would report "the shell offers no modes at all" —
 * which passes every assertion below about what is *not* offered while having stopped
 * reading. `metadata-claims.test.ts`'s copy of this parser has exactly that hole; ours
 * refuses instead, so a union that stops being literals is a failure with a sentence in it.
 */
function members(source: string, pattern: RegExp, what: string, readers: string): Set<string> {
  const body = pattern.exec(source)?.[1];
  const found = new Set(
    body === undefined ? [] : [...body.matchAll(/'([a-z-]+)'/g)].map((member) => member[1] ?? ''),
  );
  if (found.size === 0) {
    throw new Error(
      `match-setup.ts no longer declares ${what} as string literals. ${readers} read it by` +
        ' parsing this file; point them at whatever replaced it.',
    );
  }
  return found;
}

/** The members of `export type PlayMode = …`, as strings. */
function unionMembers(source: string): Set<string> {
  return members(
    source,
    /export type PlayMode =([^;]+);/,
    '`export type PlayMode = …`',
    'This file and app/metadata-claims.test.ts',
  );
}

/** The members of `export const PLAY_MODES = [ … ]`, as strings. */
function arrayMembers(source: string): Set<string> {
  return members(
    source,
    /export const PLAY_MODES = \[([^\]]*)\]/,
    '`export const PLAY_MODES = [ … ]`',
    'This file and scripts/validate-manifests.mjs',
  );
}

describe('the two spellings of what the shell can start', () => {
  it('agree in both directions, so neither reader can be reading a stale one', () => {
    // `satisfies` on PLAY_MODES already rejects a member the union does not have, and so
    // catches this at compile time in one direction. The direction it cannot see is a member
    // added to the union and forgotten in the array, which would leave `offeredModes` and
    // `isPlayMode` silently dropping a mode the type system says is legal.
    expect([...arrayMembers(MATCH_SETUP_SOURCE)].sort()).toEqual(
      [...unionMembers(MATCH_SETUP_SOURCE)].sort(),
    );
  });

  it('are the two the runtime actually recognises', () => {
    expect([...PLAY_MODES].sort()).toEqual([...unionMembers(MATCH_SETUP_SOURCE)].sort());
    for (const mode of PLAY_MODES) expect(isPlayMode(mode)).toBe(true);
    for (const other of ['solo', 'remote', 'FRIEND', '', null, 3]) {
      expect(isPlayMode(other), `${String(other)} is not a mode the shell can start`).toBe(false);
    }
  });

  it('can be told apart by their readers, or this file is guarding nothing', () => {
    // Both parsers, on strings they should and should not understand — the failure
    // `metadata-claims.test.ts` records having shipped is a self-check that compared two
    // hard-coded lists to each other and could never fail.
    expect(unionMembers("export type PlayMode = 'friend' | 'bot' | 'solo';")).toEqual(
      new Set(['friend', 'bot', 'solo']),
    );
    // The near miss: this matches the shape and parses to nothing, which is the state a
    // reader must not mistake for "the shell offers no modes".
    expect(() => unionMembers('export type PlayMode = Mode;')).toThrow(/no longer declares/);
    expect(() => unionMembers('export const PlayMode = 2;')).toThrow(/no longer declares/);
    expect(arrayMembers("export const PLAY_MODES = ['friend', 'solo'] as const;")).toEqual(
      new Set(['friend', 'solo']),
    );
    expect(() => arrayMembers('export const PLAY_MODES = other;')).toThrow(/no longer declares/);
    expect(() => arrayMembers('export const PLAY_MODES = [...MODES];')).toThrow(
      /no longer declares/,
    );
  });
});

describe('narrowing a game’s declaration to what the lobby can offer', () => {
  it('offers a button for every mode a game declares and the shell can start', () => {
    expect(offeredModes(['friend', 'bot'])).toEqual(['friend', 'bot']);
  });

  it('offers exactly one where a game declares one', () => {
    // The acceptance criterion #1749 states, in the form this build can actually meet it: a
    // game declaring a single startable mode gets a single button, not two.
    expect(offeredModes(['friend'])).toEqual(['friend']);
    expect(offeredModes(['bot'])).toEqual(['bot']);
  });

  it('drops a declared mode the shell has no branch for', () => {
    // The six real manifests: `['friend', 'bot', 'solo']`. Two buttons, never three.
    expect(offeredModes(['friend', 'bot', 'solo'])).toEqual(['friend', 'bot']);
    expect(offeredModes(['friend', 'solo'])).toEqual(['friend']);
  });

  it('keeps the game’s own order, so the caller owns the ordering rule', () => {
    // `PlaySurface` sorts the remembered mode to the front afterwards. If this sorted too,
    // there would be two ordering rules and the one nobody remembered would win.
    expect(offeredModes(['bot', 'friend'])).toEqual(['bot', 'friend']);
  });

  it('answers with nothing rather than guessing when a game declares nothing it can run', () => {
    expect(offeredModes([])).toEqual([]);
    expect(offeredModes(['solo'])).toEqual([]);
    expect(offeredModes(['remote', 'online'])).toEqual([]);
  });
});

describe('every game in the catalogue', () => {
  it('has at least one mode the shell can actually start', () => {
    /*
     * A game whose every declared mode is one the shell cannot run is a game page with a
     * heading, a set of options and no way to begin. It is not hypothetical: `solitaire`'s own
     * manifest comment says `friend` and `bot` are there because "a solo-only manifest would
     * ship a game page with no way to begin", which is a fact about this repository being kept
     * true by a comment. This is the assertion that keeps it true.
     *
     * Read from the catalogue rather than by loading 108 game chunks, because
     * `catalogue-manifest.test.ts` already fails if a row's `modes` disagrees with its
     * manifest's, and the build-time half of this check in `scripts/validate-manifests.mjs`
     * reads the manifests themselves.
     */
    const dead = CATALOGUE.filter((entry) => offeredModes(entry.modes).length === 0).map(
      (entry) => `${entry.id} (declares ${entry.modes.join(', ') || 'nothing'})`,
    );
    expect(
      dead,
      'these games declare no mode the shell can start, so their lobby draws no button:\n' +
        dead.join('\n'),
    ).toEqual([]);
  });
});
