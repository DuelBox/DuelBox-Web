/**
 * What a screen reader is told when a round or a match ends.
 *
 * ## Why the result panel is not enough on its own
 *
 * The panel is not an announcement, however it is marked up. It is inserted into the
 * document already carrying its text, and a live region that arrives with its content is
 * the shape assistive technology is least reliable about: the region has to be on the page
 * before the words are, or there is no change for it to report. So the panel is an
 * ordinary named group now, and the announcement is a separate region that has been
 * sitting on the page, empty, since the countdown. This function is the only thing that
 * ever puts words in it.
 *
 * ## Why it reads the phase and not the score
 *
 * That is what makes it fire exactly once. `MatchOverlay` re-renders on every fixed step
 * of the simulation, sixty times a second, and React writes a text node only when the
 * string it is handed actually changes. A match spends its whole life at `''` and changes
 * to a sentence on the one step that settles it. Reading the tally instead would announce
 * every point either seat scored — which is the HUD's job, which it already does, politely
 * and per seat, and which is the wrong urgency for a result.
 *
 * The words mirror the panel: its heading, its winner line, its round tally. A sighted
 * player and a screen-reader player should be told the same thing rather than two versions
 * of it. The one line deliberately left out is the round panel's "first to N takes it",
 * which does not change between rounds and would be read out again after every one.
 *
 * ## Why the catalogue is a parameter
 *
 * The sentence is assembled here, so this is where it has to be translated (#220) — a module
 * that returned English for a component to translate would be handing the component a string
 * no catalogue has a key for. The catalogue is passed in rather than read from a context for
 * the reason `lib/i18n/messages.ts` gives: this stays a pure function the unit suite can call
 * with `{}` and get exactly the English it always returned. Each sentence is one message id
 * with placeholders, never a join of translated fragments, so a language that puts the winner
 * before the round number can.
 */

import type { MatchState, Outcome, Tally } from '@duelbox/game-sdk';
import { t, type Catalogue } from './i18n/messages';
import type { SeatNames } from '@/lib/seats';

/** The part of the match state an announcement is made from. */
export type AnnouncableState = Pick<
  MatchState,
  'phase' | 'round' | 'roundOutcome' | 'matchOutcome' | 'roundWins'
>;

/** An outcome that has been settled. `null` is a match still running, and says nothing. */
type Settled = Exclude<Outcome, null>;

/** "… wins", or "A draw". The seat's own name, never a placeholder — see `lib/seats.ts`. */
function outcomeSentence(messages: Catalogue, outcome: Settled, seatNames: SeatNames): string {
  return outcome === 'draw'
    ? t(messages, 'A draw')
    : t(messages, '{name} wins', { name: seatNames[outcome] });
}

/** The rounds each seat has taken, named and in the order the HUD shows them. */
function tallySentence(messages: Catalogue, roundWins: Tally, seatNames: SeatNames): string {
  return t(messages, '{p1} {wins1}, {p2} {wins2}', {
    p1: seatNames.p1,
    wins1: roundWins.p1,
    p2: seatNames.p2,
    wins2: roundWins.p2,
  });
}

/**
 * The sentence to announce for `state`, or `''` in every phase that is not an ending.
 *
 * `rounds` is the match length the player chose, because a single-round match ends with
 * "Game over" and has no round tally worth reading — exactly as the panel has none.
 */
/**
 * What a finished solo run says out loud (#1750).
 *
 * No winner, because there was nobody to beat: the score, and whether it is the best this
 * device has seen. "Game over" is kept as the heading so the ending is announced with the
 * same first two words a two-seat run uses — the words a listener has learned mean the board
 * has stopped.
 */
export function soloAnnouncement(
  messages: Catalogue,
  state: AnnouncableState,
  run: { readonly score: number; readonly best: number; readonly isNewBest: boolean },
): string {
  if (state.phase !== 'match-over' || state.matchOutcome === null) return '';
  const best = run.isNewBest
    ? t(messages, 'A new best.')
    : t(messages, 'Best {best}.', { best: run.best });
  return t(messages, 'Game over. Score {score}. {best}', { score: run.score, best });
}

export function resultAnnouncement(
  messages: Catalogue,
  state: AnnouncableState,
  rounds: number,
  seatNames: SeatNames,
): string {
  if (state.phase === 'round-over') {
    const outcome = state.roundOutcome;
    if (outcome === null) return '';
    return t(messages, 'Round {round}. {outcome}. {tally}.', {
      round: state.round,
      outcome: outcomeSentence(messages, outcome, seatNames),
      tally: tallySentence(messages, state.roundWins, seatNames),
    });
  }
  if (state.phase === 'match-over') {
    const outcome = state.matchOutcome;
    // A match the machine ends with no outcome at all is not a result to read out.
    // `PlaySurface` declines to record one for the same reason, and neither is reachable
    // today; announcing a phantom draw would be worse than announcing nothing.
    if (outcome === null) return '';
    const said = outcomeSentence(messages, outcome, seatNames);
    // Two whole sentences rather than a heading joined to a tally: the single-round ending
    // has no tally at all, and a locale must be able to punctuate each as its own.
    return rounds > 1
      ? t(messages, 'Match over. {outcome}. {tally}.', {
          outcome: said,
          tally: tallySentence(messages, state.roundWins, seatNames),
        })
      : t(messages, 'Game over. {outcome}.', { outcome: said });
  }
  return '';
}
