import type { SeatId } from '@duelbox/engine';
import type { GameManifest } from '@duelbox/game-sdk';
import { t, type Catalogue } from '../lib/i18n/messages';

/**
 * The pass-and-play hand-off, decided without a DOM (#134).
 *
 * A hidden-information game on one device is impossible without a blackout between turns —
 * the other player's hand is on screen the moment the board hands over. But a blackout on a
 * shared board like Tic Tac Toe would be a full-screen interruption between every move for no
 * reason, so it is opt-in per game, and this is the gate: nothing blacks out unless the
 * manifest asked for it.
 */

/** Whether this game declared that it hides information between turns. */
export function handoffEnabled(manifest: Pick<GameManifest, 'handoff'>): boolean {
  return manifest.handoff === true;
}

/**
 * Whether a change of the active seat should raise the hand-off blackout.
 *
 * Only for an opted-in game, and only on a real change of hands — the first seat of a match
 * (`from` null) is not a hand-off, and a game re-reporting the same active seat is not either.
 */
export function shouldHandOff(
  manifest: Pick<GameManifest, 'handoff'>,
  from: SeatId | null,
  to: SeatId | null,
): boolean {
  return handoffEnabled(manifest) && to !== null && from !== null && from !== to;
}

/**
 * The prompt shown on the blackout.
 *
 * The catalogue is a parameter rather than the overlay writing the sentence itself (#220), so
 * the one place the prompt is spelled is still the one place it is spelled — and it is spelled
 * as a literal the extractor reads by shape. An empty catalogue is English, which is what every
 * lookup falls through to anyway.
 */
export function handoffPrompt(messages: Catalogue, name: string): string {
  return t(messages, 'Pass to {name}', { name });
}
