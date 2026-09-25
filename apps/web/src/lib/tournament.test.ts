import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  canSend,
  currentGame,
  initialTournament,
  isCurrentLeg,
  legalEvents,
  legsPlayed,
  legsToWin,
  pickTournamentGames,
  reduce,
  resume,
  TOURNAMENT_LENGTH,
  tournamentOutcome,
  tournamentScore,
  type LegOutcome,
  type TournamentState,
} from './tournament';

/** The engine's own seeded generator, so every draw below is the same on every run. */
function seeded(seed: number): () => number {
  const rng = new Rng(seed);
  return () => rng.float();
}

const LINE_UP = ['chess', 'darts', 'ludo', 'pool', 'sumo', 'memory', 'reversi'] as const;

/** A tournament with `LINE_UP` running against the other seat. */
function started(games: readonly string[] = LINE_UP): TournamentState {
  return reduce(initialTournament(), { kind: 'start', games, opponent: 'friend' });
}

/** `state` with each of `outcomes` reported in order. */
function play(state: TournamentState, ...outcomes: readonly LegOutcome[]): TournamentState {
  return outcomes.reduce((current, outcome) => reduce(current, { kind: 'report', outcome }), state);
}

describe('what a phase accepts', () => {
  it('offers only the events that phase can take', () => {
    expect(legalEvents('idle')).toEqual(['start']);
    expect(legalEvents('playing')).toEqual(['report', 'abandon']);
    // A finished tournament can be replaced without abandoning it first: the pair who have
    // just seen who won should be able to start another from that screen.
    expect(legalEvents('complete')).toEqual(['start', 'abandon']);
  });

  it('agrees with canSend', () => {
    for (const phase of ['idle', 'playing', 'complete'] as const) {
      for (const kind of ['start', 'report', 'abandon'] as const) {
        expect(canSend(phase, kind), `${phase}/${kind}`).toBe(legalEvents(phase).includes(kind));
      }
    }
  });

  it('ignores an event the phase does not accept, by identity', () => {
    // The same object back, so a caller can tell nothing happened without a deep compare —
    // the contract `match.ts` makes and the reason `reduce` checks the table first.
    const idle = initialTournament();
    expect(reduce(idle, { kind: 'report', outcome: 'p1' })).toBe(idle);
    expect(reduce(idle, { kind: 'abandon' })).toBe(idle);

    // And an event the phase *does* accept always builds a new one, so the identity check
    // above is a signal rather than a coincidence of the reducer never copying anything.
    const playing = started();
    expect(reduce(playing, { kind: 'report', outcome: 'p1' })).not.toBe(playing);
  });

  it('refuses to start a second tournament over a running one', () => {
    const playing = play(started(), 'p1');
    const same = reduce(playing, { kind: 'start', games: ['chess'], opponent: 'bot' });
    expect(same).toBe(playing);
  });
});

describe('starting', () => {
  it('runs the line-up it is given, in order, from nothing played', () => {
    const state = started();
    expect(state.phase).toBe('playing');
    expect(state.games).toEqual([...LINE_UP]);
    expect(state.results).toEqual([]);
    expect(state.opponent).toBe('friend');
    expect(currentGame(state)).toBe('chess');
  });

  it('never repeats a game, whatever it is handed', () => {
    // The acceptance criterion of #159, enforced at the one door a line-up comes through
    // rather than trusted of whoever assembled the list.
    const state = started(['chess', 'darts', 'chess', 'ludo', 'darts']);
    expect(state.games).toEqual(['chess', 'darts', 'ludo']);
  });

  it('drops entries that are not slugs at all', () => {
    const state = started(['chess', '', 'darts']);
    expect(state.games).toEqual(['chess', 'darts']);
  });

  it('does nothing at all when there is no line-up to run', () => {
    // A tournament with no games would be one whose current game never arrives, so the
    // press does nothing rather than something unfinishable.
    const idle = initialTournament();
    expect(reduce(idle, { kind: 'start', games: [], opponent: 'friend' })).toBe(idle);
    expect(reduce(idle, { kind: 'start', games: ['', ''], opponent: 'friend' })).toBe(idle);
  });

  it('replaces a finished tournament', () => {
    const finished = play(started(), 'p1', 'p1', 'p1', 'p1');
    expect(finished.phase).toBe('complete');
    const next = reduce(finished, { kind: 'start', games: ['pool', 'darts'], opponent: 'bot' });
    expect(next.phase).toBe('playing');
    expect(next.games).toEqual(['pool', 'darts']);
    expect(next.results).toEqual([]);
    expect(next.opponent).toBe('bot');
  });

  it('keeps the opponent for the whole tournament', () => {
    const state = play(
      reduce(initialTournament(), { kind: 'start', games: LINE_UP, opponent: 'bot' }),
      'p1',
      'p2',
    );
    expect(state.opponent).toBe('bot');
  });
});

describe('reporting a result', () => {
  it('records it and moves on to the next game', () => {
    const one = play(started(), 'p1');
    expect(one.results).toEqual(['p1']);
    expect(legsPlayed(one)).toBe(1);
    expect(currentGame(one)).toBe('darts');
    expect(one.phase).toBe('playing');
  });

  it('counts wins and draws separately', () => {
    const state = play(started(), 'p1', 'draw', 'p2', 'p1');
    expect(tournamentScore(state)).toEqual({ p1: 2, p2: 1, draws: 1 });
  });

  it('keeps the games in the order they were drawn', () => {
    let state = started();
    for (const game of LINE_UP.slice(0, 3)) {
      expect(currentGame(state)).toBe(game);
      state = play(state, 'draw');
    }
    expect(currentGame(state)).toBe('pool');
  });

  it('is only accepted from the game the tournament is waiting on', () => {
    // The guard that makes a result count once. The result screen still offers Rematch, so
    // a leg can be replayed — and a replay is a friendly game, not a second result.
    const state = play(started(), 'p1');
    expect(isCurrentLeg(state, 'darts')).toBe(true);
    expect(isCurrentLeg(state, 'chess')).toBe(false);
  });

  it('says nothing is current once there is nothing left to play', () => {
    const finished = play(started(), 'p1', 'p1', 'p1', 'p1');
    expect(currentGame(finished)).toBeUndefined();
    expect(isCurrentLeg(finished, 'sumo')).toBe(false);
    expect(currentGame(initialTournament())).toBeUndefined();
  });
});

describe('finishing', () => {
  it('ends the moment a majority is reached, without playing the dead rubbers', () => {
    const state = play(started(), 'p1', 'p1', 'p1', 'p1');
    expect(state.phase).toBe('complete');
    expect(tournamentOutcome(state)).toBe('p1');
    // Four of seven played, three not: ending at four is the point.
    expect(legsPlayed(state)).toBe(4);
  });

  it('goes the distance when the games are shared out', () => {
    const state = play(started(), 'p1', 'p2', 'p1', 'p2', 'p1', 'p2');
    expect(state.phase).toBe('playing');
    expect(currentGame(state)).toBe('reversi');
    const done = play(state, 'p1');
    expect(done.phase).toBe('complete');
    expect(tournamentOutcome(done)).toBe('p1');
  });

  it('is a draw when seven games leave the two level', () => {
    // Draws are what make "first to four" reachable but not guaranteed, and this is the
    // fallback that exists because of them. There is no decider.
    const state = play(started(), 'p1', 'p2', 'p1', 'p2', 'draw', 'draw', 'draw');
    expect(state.phase).toBe('complete');
    expect(tournamentScore(state)).toEqual({ p1: 2, p2: 2, draws: 3 });
    expect(tournamentOutcome(state)).toBe('draw');
  });

  it('gives it to whoever leads after every game is played', () => {
    const state = play(started(), 'p1', 'p2', 'p1', 'p2', 'draw', 'draw', 'p2');
    expect(tournamentOutcome(state)).toBe('p2');
  });

  it('has no winner while it is still being played', () => {
    expect(tournamentOutcome(started())).toBeNull();
    expect(tournamentOutcome(play(started(), 'p1', 'p1', 'p1'))).toBeNull();
    expect(tournamentOutcome(initialTournament())).toBeNull();
  });

  it('needs a strict majority, so an even line-up cannot be won by half of it', () => {
    expect(legsToWin(7)).toBe(4);
    expect(legsToWin(6)).toBe(4);
    expect(legsToWin(3)).toBe(2);
    expect(legsToWin(1)).toBe(1);
    // Three of six is level rather than won, which is why this is not the SDK's ceil(n/2).
    const even = play(started(LINE_UP.slice(0, 6)), 'p1', 'p1', 'p1', 'p2', 'p2', 'p2');
    expect(even.phase).toBe('complete');
    expect(tournamentOutcome(even)).toBe('draw');
  });

  it('takes no further results once it is decided', () => {
    const finished = play(started(), 'p1', 'p1', 'p1', 'p1');
    expect(reduce(finished, { kind: 'report', outcome: 'p2' })).toBe(finished);
  });
});

describe('abandoning', () => {
  it('leaves nothing behind, from halfway or from the end', () => {
    for (const state of [play(started(), 'p1'), play(started(), 'p1', 'p1', 'p1', 'p1')]) {
      const gone = reduce(state, { kind: 'abandon' });
      expect(gone).toEqual(initialTournament());
      expect(gone.phase).toBe('idle');
      expect(currentGame(gone)).toBeUndefined();
    }
  });
});

describe('resuming', () => {
  it('is the same state the machine was already in', () => {
    // The property the whole split rests on: the phase is derived, so a tournament read
    // back from storage and one that never left memory cannot disagree.
    let state = started();
    for (const outcome of ['p1', 'draw', 'p2', 'p1'] as const) {
      state = play(state, outcome);
      const { games, results, opponent } = state;
      expect(resume({ games, results, opponent })).toEqual(state);
    }
  });

  it('picks a half-finished tournament up at the right game', () => {
    const state = resume({ games: [...LINE_UP], results: ['p1', 'p2', 'draw'], opponent: 'bot' });
    expect(state.phase).toBe('playing');
    expect(currentGame(state)).toBe('pool');
    expect(tournamentScore(state)).toEqual({ p1: 1, p2: 1, draws: 1 });
    expect(state.opponent).toBe('bot');
  });

  it('knows a stored tournament is already decided', () => {
    const state = resume({
      games: [...LINE_UP],
      results: ['p1', 'p1', 'p1', 'p1'],
      opponent: 'friend',
    });
    expect(state.phase).toBe('complete');
    expect(tournamentOutcome(state)).toBe('p1');
  });

  it('treats an empty line-up as no tournament', () => {
    expect(resume({ games: [], results: [], opponent: 'friend' })).toEqual(initialTournament());
  });

  it('treats more results than games as finished rather than as an error', () => {
    // Not reachable through the machine, and reachable through a hand-edited document. The
    // answer is a decided tournament, never a state whose current game is off the end.
    const state = resume({ games: ['chess'], results: ['p1', 'p2', 'draw'], opponent: 'friend' });
    expect(state.phase).toBe('complete');
    expect(currentGame(state)).toBeUndefined();
  });

  it('runs a tournament of a length this build would not have drawn', () => {
    // Every rule works off the line-up's length rather than the constant, so a document
    // written by a build that chose a different number still resumes and still knows what
    // winning it takes.
    const state = resume({
      games: ['chess', 'darts', 'ludo'],
      results: ['p1', 'p2'],
      opponent: 'friend',
    });
    expect(state.phase).toBe('playing');
    expect(currentGame(state)).toBe('ludo');
    expect(play(state, 'p1').phase).toBe('complete');
  });
});

describe('drawing a line-up', () => {
  const CANDIDATES = [
    'air-hockey',
    'chess',
    'darts',
    'ludo',
    'pool',
    'sumo',
    'memory',
    'reversi',
    'bowling',
    'mancala',
  ] as const;

  it('never repeats a game within itself', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const games = pickTournamentGames(CANDIDATES, [], TOURNAMENT_LENGTH, seeded(seed));
      expect(games).toHaveLength(TOURNAMENT_LENGTH);
      expect(new Set(games).size, `seed ${String(seed)} drew a game twice`).toBe(games.length);
      for (const game of games) expect(CANDIDATES).toContain(game);
    }
  });

  it('draws as many as asked for, and no more', () => {
    expect(pickTournamentGames(CANDIDATES, [], 3, seeded(1))).toHaveLength(3);
    expect(pickTournamentGames(CANDIDATES, [], 0, seeded(1))).toEqual([]);
  });

  it('stops at the catalogue rather than repeating to make up the number', () => {
    // Unreachable with 108 playable games and reachable in a test, which is the point: a
    // short tournament is a shorter tournament, not a broken one.
    const games = pickTournamentGames(['chess', 'darts'], [], TOURNAMENT_LENGTH, seeded(1));
    expect(games.sort()).toEqual(['chess', 'darts']);
  });

  it('ignores duplicates and junk in the catalogue it is given', () => {
    const games = pickTournamentGames(['chess', 'chess', '', 'darts'], [], 5, seeded(1));
    expect(games.sort()).toEqual(['chess', 'darts']);
  });

  it('leaves out the game just played, as the header button does', () => {
    // The weighting is `pickQuickPlay`'s, unchanged: the game played last is not offered
    // unless it is the only one there is. Reusing it rather than writing a second rule is
    // the whole reason this function is four lines.
    for (const seed of [1, 2, 3, 4, 5]) {
      const games = pickTournamentGames(CANDIDATES, ['chess', 'darts'], 5, seeded(seed));
      expect(games, `seed ${String(seed)}`).not.toContain('chess');
    }
  });

  it('offers the game just played when the catalogue holds nothing else', () => {
    expect(pickTournamentGames(['chess'], ['chess'], 3, seeded(1))).toEqual(['chess']);
  });

  it('is the same line-up for the same seed', () => {
    const first = pickTournamentGames(CANDIDATES, [], TOURNAMENT_LENGTH, seeded(9));
    const second = pickTournamentGames(CANDIDATES, [], TOURNAMENT_LENGTH, seeded(9));
    expect(first).toEqual(second);
  });

  it('draws different line-ups from different seeds', () => {
    // A picker that returned the catalogue's own order whatever it was handed would pass
    // every test above.
    const drawn = [1, 2, 3, 4, 5].map((seed) =>
      pickTournamentGames(CANDIDATES, [], TOURNAMENT_LENGTH, seeded(seed)).join(','),
    );
    expect(new Set(drawn).size).toBeGreaterThan(1);
  });

  it('still returns distinct games when the source misbehaves', () => {
    // A source outside the contract yields a line-up rather than a repeat or a hang.
    for (const random of [() => 1, () => Number.NaN, () => -1]) {
      const games = pickTournamentGames(CANDIDATES, [], TOURNAMENT_LENGTH, random);
      expect(new Set(games).size).toBe(games.length);
      expect(games).toHaveLength(TOURNAMENT_LENGTH);
    }
  });
});

describe('the format', () => {
  it('is seven games and first to four', () => {
    // The two numbers `docs/tournament.md` commits to, pinned so that changing either has
    // to be a decision rather than a typo.
    expect(TOURNAMENT_LENGTH).toBe(7);
    expect(legsToWin(TOURNAMENT_LENGTH)).toBe(4);
  });
});

describe('the bot’s tier (#2347)', () => {
  it('is fixed on the record when a tournament against the bot starts', () => {
    const state = reduce(initialTournament(), {
      kind: 'start',
      games: LINE_UP,
      opponent: 'bot',
      difficulty: 'hard',
    });
    expect(state.difficulty).toBe('hard');
  });

  it('holds for every leg, through reports and through a resume', () => {
    const state = play(
      reduce(initialTournament(), {
        kind: 'start',
        games: LINE_UP,
        opponent: 'bot',
        difficulty: 'easy',
      }),
      'p1',
      'p2',
      'draw',
    );
    expect(state.difficulty).toBe('easy');
    // The record is what the store writes and reads back; the tier has to be on it, not on
    // the phase the store deliberately leaves out.
    const { games, results, opponent, difficulty } = state;
    const record = {
      games,
      results,
      opponent,
      ...(difficulty === undefined ? {} : { difficulty }),
    };
    expect(resume(record).difficulty).toBe('easy');
  });

  it('has no tier when the far seat is a person, whatever the event says', () => {
    const state = reduce(initialTournament(), {
      kind: 'start',
      games: LINE_UP,
      opponent: 'friend',
      difficulty: 'hard',
    });
    expect(state.difficulty).toBeUndefined();
    expect(started().difficulty).toBeUndefined();
  });

  it('does not survive into the next tournament unless that one sets it', () => {
    const first = play(
      reduce(initialTournament(), {
        kind: 'start',
        games: ['chess', 'darts'],
        opponent: 'bot',
        difficulty: 'hard',
      }),
      'p1',
      'p1',
    );
    expect(first.phase).toBe('complete');
    const next = reduce(first, { kind: 'start', games: LINE_UP, opponent: 'bot' });
    expect(next.difficulty).toBeUndefined();
    expect(reduce(first, { kind: 'abandon' }).difficulty).toBeUndefined();
  });
});
