import type { MatchPhase, Tally } from '@duelbox/game-sdk';
import { ROUND_CHOICES, type PlayMode } from './match-setup';

/**
 * What a match may change about itself while it is running, and why not when it may not
 * (#2351).
 *
 * The match machine (`packages/game-sdk/src/match.ts`) reads its rules on every event, so a
 * best-of that grows from three to five between rounds keeps every round already played,
 * and the host rebuilds the board for a new round anyway, so the far seat can change hands
 * between rounds without anybody's score moving. What the machine cannot do is change
 * *inside* a round: a new bot or a new board mid-round is a round thrown away, and a
 * best-of shortened below what has been played would end on the next point for a reason
 * nobody chose. So the rule is one sentence — **between rounds, anything that still makes
 * sense; mid-round, nothing** — and this module is that sentence as a function, so the
 * panel that offers the controls and the tests that hold them read the same answer.
 *
 * Every refusal carries its reason, because the issue's acceptance criterion is that an
 * unsupported switch is prevented up front *with a clear reason*, not merely prevented.
 */

export interface ChangeVerdict {
  readonly allowed: boolean;
  /** Why not, in the words the panel shows. Empty when allowed. */
  readonly reason: string;
}

export interface MatchChanges {
  /** Handing the far seat between a person and the bot. */
  readonly seat: ChangeVerdict;
  /** The bot's tier. */
  readonly difficulty: ChangeVerdict;
  /** Match length, and which lengths still make sense. */
  readonly rounds: ChangeVerdict & { readonly choices: readonly number[] };
  /** Carrying the match to another device — not a thing this build can do live. */
  readonly device: ChangeVerdict;
}

export interface MatchSituation {
  readonly phase: MatchPhase;
  readonly mode: PlayMode;
  /** The match is one leg of a tournament, whose terms were settled when it started. */
  readonly leg: boolean;
  readonly round: number;
  readonly roundWins: Tally;
}

const MID_ROUND =
  'The far seat, the bot and the match length change between rounds — finish this round first.';
const LEG =
  'The tournament settled the seats, the bot and the length when it started. ' +
  'Leave the tournament to change them.';
const SOLO_SEAT = 'A solo run has one seat, so there is nobody to hand the other to.';
const SOLO_ROUNDS = 'A solo run is one round.';
const NO_BOT = 'There is no bot in this match to make harder or easier.';
export const DEVICE_REASON =
  'Playing on two devices at once is not built. To carry a tournament to another device, ' +
  'export your data from Settings on this one and import it there.';

/** The rounds a seat needs to take a best-of — the SDK's own rule, restated for the check. */
export function roundsToWin(rounds: number): number {
  return Math.ceil(rounds / 2);
}

/**
 * The lengths a running match can still become.
 *
 * A length must be longer than the rounds already played, or the next point ends the match
 * by exhaustion; and its target must be above what either seat already has, or the next
 * point ends it by decision. Both are the machine's own arithmetic, applied before the
 * choice is offered rather than after it is regretted.
 */
export function roundChoicesFor(round: number, roundWins: Tally): number[] {
  const most = Math.max(roundWins.p1, roundWins.p2);
  return ROUND_CHOICES.filter((n) => n > round && roundsToWin(n) > most);
}

export function describeChanges(situation: MatchSituation): MatchChanges {
  const { phase, mode, leg, round, roundWins } = situation;
  const between = phase === 'round-over';
  const refuse = (reason: string): ChangeVerdict => ({ allowed: false, reason });
  const allow: ChangeVerdict = { allowed: true, reason: '' };

  const device = refuse(DEVICE_REASON);

  if (leg) {
    return {
      seat: refuse(LEG),
      difficulty: refuse(LEG),
      rounds: { ...refuse(LEG), choices: [] },
      device,
    };
  }
  if (mode === 'solo') {
    return {
      seat: refuse(SOLO_SEAT),
      difficulty: refuse(NO_BOT),
      rounds: { ...refuse(SOLO_ROUNDS), choices: [] },
      device,
    };
  }
  if (!between) {
    return {
      seat: refuse(MID_ROUND),
      difficulty: refuse(MID_ROUND),
      rounds: { ...refuse(MID_ROUND), choices: [] },
      device,
    };
  }
  const choices = roundChoicesFor(round, roundWins);
  return {
    seat: allow,
    difficulty: mode === 'bot' ? allow : refuse(NO_BOT),
    rounds:
      choices.length === 0
        ? { ...refuse('Every longer length is already decided by the score so far.'), choices }
        : { ...allow, choices },
    device,
  };
}
