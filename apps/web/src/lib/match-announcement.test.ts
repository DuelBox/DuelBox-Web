import { describe, expect, it } from 'vitest';
import { initialMatchState, type MatchState } from '@duelbox/game-sdk';
import { seatNamesFor } from './seats.js';
import { resultAnnouncement, type AnnouncableState } from './match-announcement.js';

const NAMES = seatNamesFor();

/** A match state in whatever phase a test is about. Built from the machine's own initial. */
function state(patch: Partial<MatchState>): AnnouncableState {
  return { ...initialMatchState(), ...patch };
}

describe('the result announcement', () => {
  it('says nothing in any phase that is not an ending', () => {
    // The whole of "exactly once" lives here: a live region is only announced when its
    // text changes, so every phase a match spends its sixty renders a second in has to
    // produce the same empty string.
    for (const phase of ['idle', 'countdown', 'playing', 'paused'] as const) {
      expect(resultAnnouncement(state({ phase }), 3, NAMES), phase).toBe('');
    }
  });

  it('says nothing when the score moves during play', () => {
    // The reason this reads the phase rather than the tally. A screen-reader player who
    // heard "Match over" every time somebody scored would learn to ignore the region that
    // matters most, and the HUD already announces the score, per seat and politely.
    const before = resultAnnouncement(state({ phase: 'playing' }), 3, NAMES);
    const after = resultAnnouncement(
      state({ phase: 'playing', tally: { p1: 4, p2: 1 }, roundWins: { p1: 1, p2: 0 } }),
      3,
      NAMES,
    );
    expect(after).toBe(before);
  });

  it('names the winner and the rounds when a match of several ends', () => {
    const said = resultAnnouncement(
      state({ phase: 'match-over', matchOutcome: 'p2', roundWins: { p1: 1, p2: 2 } }),
      3,
      NAMES,
    );
    expect(said).toContain('Match over');
    expect(said).toContain(`${NAMES.p2} wins`);
    expect(said).toContain(`${NAMES.p1} 1, ${NAMES.p2} 2`);
  });

  it('calls a single-round match over rather than the match, and leaves the tally out', () => {
    // Mirrors the panel, which shows "Game over" and no round line at this length. The
    // announcement is the panel read aloud; two versions of the truth is the defect.
    const said = resultAnnouncement(
      state({ phase: 'match-over', matchOutcome: 'p1', roundWins: { p1: 1, p2: 0 } }),
      1,
      NAMES,
    );
    expect(said).toBe(`Game over. ${NAMES.p1} wins.`);
  });

  it('announces a draw as a draw rather than as nobody winning', () => {
    const said = resultAnnouncement(state({ phase: 'match-over', matchOutcome: 'draw' }), 1, NAMES);
    expect(said).toBe('Game over. A draw.');
  });

  it('announces a round with its number and the tally it leaves', () => {
    const said = resultAnnouncement(
      state({ phase: 'round-over', round: 2, roundOutcome: 'p1', roundWins: { p1: 2, p2: 0 } }),
      3,
      NAMES,
    );
    expect(said).toBe(`Round 2. ${NAMES.p1} wins. ${NAMES.p1} 2, ${NAMES.p2} 0.`);
  });

  it('says nothing about an ending the machine settled with no outcome', () => {
    // Not reachable today. Announcing a phantom draw if it ever became reachable would be
    // worse than announcing nothing, which is the call `PlaySurface` already makes about
    // writing one to the record.
    expect(resultAnnouncement(state({ phase: 'match-over', matchOutcome: null }), 1, NAMES)).toBe(
      '',
    );
    expect(resultAnnouncement(state({ phase: 'round-over', roundOutcome: null }), 3, NAMES)).toBe(
      '',
    );
  });

  it('carries a chosen name and a bot mark into the announcement', () => {
    // The names come from `seatNamesFor`, so what the pair called themselves (#161) and
    // the mark on a seat a bot is in (#2513) reach the announcement without this module
    // knowing either rule.
    const names = seatNamesFor({ p2: 'hard' }, { p1: 'Ada' });
    const said = resultAnnouncement(state({ phase: 'match-over', matchOutcome: 'p2' }), 1, names);
    expect(said).toBe(`Game over. ${names.p2} wins.`);
    expect(said).toContain('(bot)');
  });
});
