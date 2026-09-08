import { describe, expect, it } from 'vitest';
import { ROUND_CHOICES } from './match-setup';
import {
  DEVICE_REASON,
  describeChanges,
  roundChoicesFor,
  roundsToWin,
  type MatchSituation,
} from './match-changes';

const between: MatchSituation = {
  phase: 'round-over',
  mode: 'bot',
  leg: false,
  round: 1,
  roundWins: { p1: 1, p2: 0 },
};

describe('between rounds', () => {
  it('lets the far seat change hands, the bot change tier, and the match grow', () => {
    const changes = describeChanges(between);
    expect(changes.seat.allowed).toBe(true);
    expect(changes.difficulty.allowed).toBe(true);
    expect(changes.rounds.allowed).toBe(true);
    expect(changes.rounds.choices).toEqual([3, 5]);
  });

  it('has no tier to change when there is no bot', () => {
    const changes = describeChanges({ ...between, mode: 'friend' });
    expect(changes.seat.allowed).toBe(true);
    expect(changes.difficulty.allowed).toBe(false);
    expect(changes.difficulty.reason).toMatch(/no bot/);
  });

  it('never offers a length the score has already decided', () => {
    // 2–0 after two rounds: best of 3 is won already, best of 5 needs 3 and is still open.
    expect(roundChoicesFor(2, { p1: 2, p2: 0 })).toEqual([5]);
    // 3–0 after three: even best of 5 is decided. Nothing to offer, and it says so.
    const decided = describeChanges({ ...between, round: 3, roundWins: { p1: 3, p2: 0 } });
    expect(decided.rounds.allowed).toBe(false);
    expect(decided.rounds.choices).toEqual([]);
    expect(decided.rounds.reason).toMatch(/already decided/);
  });

  it('never offers a length shorter than what has been played', () => {
    // Round 3 of a best of 5 at 1–1: only a length past round 3 makes sense — 5 itself.
    expect(roundChoicesFor(3, { p1: 1, p2: 1 })).toEqual([5]);
    expect(roundChoicesFor(0, { p1: 0, p2: 0 })).toEqual([...ROUND_CHOICES]);
  });
});

describe('what is refused, and why', () => {
  it('refuses everything mid-round, with the reason that the round is not over', () => {
    for (const phase of ['countdown', 'playing', 'paused'] as const) {
      const changes = describeChanges({ ...between, phase });
      expect(changes.seat.allowed).toBe(false);
      expect(changes.difficulty.allowed).toBe(false);
      expect(changes.rounds.allowed).toBe(false);
      expect(changes.seat.reason).toMatch(/finish this round first/);
    }
  });

  it('refuses everything in a tournament leg, and says the tournament settled it', () => {
    const changes = describeChanges({ ...between, leg: true });
    expect(changes.seat.allowed).toBe(false);
    expect(changes.rounds.allowed).toBe(false);
    expect(changes.difficulty.reason).toMatch(/tournament settled/);
  });

  it('has no far seat to hand over in a solo run', () => {
    const changes = describeChanges({ ...between, mode: 'solo' });
    expect(changes.seat.allowed).toBe(false);
    expect(changes.seat.reason).toMatch(/one seat/);
    expect(changes.rounds.allowed).toBe(false);
  });

  it('never claims a device swap this build cannot do, and points at export instead', () => {
    const changes = describeChanges(between);
    expect(changes.device.allowed).toBe(false);
    expect(changes.device.reason).toBe(DEVICE_REASON);
    expect(DEVICE_REASON).toMatch(/export/i);
  });

  it('says why, every time it says no', () => {
    for (const situation of [
      between,
      { ...between, phase: 'paused' as const },
      { ...between, leg: true },
      { ...between, mode: 'solo' as const },
      { ...between, mode: 'friend' as const },
    ]) {
      const changes = describeChanges(situation);
      for (const verdict of [changes.seat, changes.difficulty, changes.rounds, changes.device]) {
        if (!verdict.allowed) expect(verdict.reason.length).toBeGreaterThan(10);
        else expect(verdict.reason).toBe('');
      }
    }
  });
});

describe('the target of a best-of', () => {
  it('is the SDK’s: a strict majority of the rounds', () => {
    expect(roundsToWin(1)).toBe(1);
    expect(roundsToWin(3)).toBe(2);
    expect(roundsToWin(5)).toBe(3);
  });
});
