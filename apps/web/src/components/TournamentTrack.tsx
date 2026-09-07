'use client';

import Link from 'next/link';
import type { SeatNames } from '@/lib/seats';
import {
  legsPlayed,
  tournamentOutcome,
  tournamentScore,
  type TournamentState,
} from '@/lib/tournament';
import { SeatGlyph } from './SeatGlyph';
import styles from './TournamentTrack.module.css';

/**
 * The progress track (#158): which games are done, which one is now, which are to come, and
 * the score.
 *
 * The reference app draws seven nodes ending in a trophy with the two players' tokens
 * advancing along it. This draws the same seven nodes and puts the result *in* each one,
 * which is the same information in less space: a node holds the mark of whoever took that
 * game, so the track is the score as well as the position and a phone does not have to find
 * room for two rows.
 *
 * **Colour is never the only signal** (CLAUDE.md rule 7). Every node differs by shape rather
 * than by hue — the seat glyphs are a disc and a rounded square, a drawn game is an equals
 * sign, the game being played now is a caret and a game still to come is a dot — so the
 * track reads in greyscale, on a projector, and to somebody who cannot separate red from
 * blue. Each node also carries its own sentence for a screen reader, because a row of marks
 * is not something that can be read out.
 *
 * It lives on the play route, which is the on-demand budget, so it is deliberately small:
 * no animation, no per-game names, no second row. `docs/tournament.md` records what was left
 * out and why.
 */

export interface TournamentTrackProps {
  state: TournamentState;
  /** What both seats are called, from `lib/seats.ts`. Total, so nothing here falls back. */
  names: SeatNames;
  /**
   * Starts this route's leg. Present only when the tournament is waiting on the game this
   * page is showing — the tournament's own way in, so the lobby's ordinary mode buttons do
   * not have to mean two different things.
   */
  onPlay?: (() => void) | undefined;
  /** Where the tournament is waiting, when it is waiting somewhere other than here. */
  href?: string | undefined;
  onLeave: () => void;
}

export function TournamentTrack({ state, names, onPlay, href, onLeave }: TournamentTrackProps) {
  const played = legsPlayed(state);
  const score = tournamentScore(state);
  const outcome = tournamentOutcome(state);
  // 1-based and named once: the heading, the play button and the link all mean the same
  // game, and a track that counted one thing while its button counted another would be the
  // kind of off-by-one nobody reports because they assume they misread it.
  const upNext = played + 1;

  return (
    <div className={styles.track} role="group" aria-label="Tournament">
      <p className={styles.head}>
        {outcome === null
          ? `Game ${String(upNext)} of ${String(state.games.length)}`
          : outcome === 'draw'
            ? 'Tournament drawn'
            : `${names[outcome]} wins the tournament`}
      </p>

      <ol className={styles.nodes}>
        {state.games.map((game, index) => {
          const result = state.results[index];
          const now = outcome === null && index === played;
          return (
            <li key={game} className={styles.node} data-state={result ?? (now ? 'now' : 'later')}>
              {result === 'p1' || result === 'p2' ? (
                <SeatGlyph seat={result} size={16} />
              ) : (
                <span className={styles.mark} aria-hidden="true">
                  {result === 'draw' ? '=' : now ? '▸' : '·'}
                </span>
              )}
              <span className="db-visually-hidden">
                Game {index + 1}:{' '}
                {result === undefined
                  ? now
                    ? 'playing now'
                    : 'to come'
                  : result === 'draw'
                    ? 'drawn'
                    : `${names[result]} won`}
              </span>
            </li>
          );
        })}
      </ol>

      {/* The score in words as well as in marks, for the same reason the HUD carries one:
          a row of glyphs is the fast read and a sentence is the one that can be checked. */}
      <p className={styles.score}>
        {names.p1} {score.p1} — {score.p2} {names.p2}
        {score.draws > 0 ? `, ${score.draws} drawn` : ''}
      </p>

      <div className={styles.actions}>
        {onPlay === undefined ? null : (
          <button type="button" className={styles.play} onClick={onPlay}>
            Play game {upNext}
          </button>
        )}
        {href === undefined ? null : (
          /* prefetch={false} for the reason the result screen's links carry it: a match
             should need nothing from the network, and warming another game's chunk from a
             page somebody is playing on is exactly what `e2e/offline.spec.ts` forbids. */
          <Link className={styles.play} href={href} prefetch={false}>
            Go to game {upNext}
          </Link>
        )}
        {/* One press, and no arming step. The destructive buttons on /settings/ take two
            because what they erase cannot be rebuilt; this is seven games and one press to
            draw another line-up. What protects it is the label saying what it does. */}
        <button type="button" className={styles.leave} onClick={onLeave}>
          {outcome === null ? 'Leave the tournament' : 'Finish'}
        </button>
      </div>
    </div>
  );
}
