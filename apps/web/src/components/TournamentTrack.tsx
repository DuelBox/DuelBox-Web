'use client';

import Link from 'next/link';
import { t } from '@/lib/i18n/messages';
import { T } from '@/lib/i18n/T';
import { useMessages } from '@/lib/i18n/use-messages';
import type { SeatNames } from '@/lib/seats';
import type { BotDifficulty } from '@/lib/match-setup';
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
  /**
   * The bot's tier for the whole tournament, when it is against the bot (#2347). Said on
   * the track because the track is the one thing on every leg's screen, and a tier fixed
   * for seven games has to be readable in all seven.
   */
  tier?: BotDifficulty | undefined;
  onLeave: () => void;
}

export function TournamentTrack({
  state,
  names,
  onPlay,
  href,
  tier,
  onLeave,
}: TournamentTrackProps) {
  const messages = useMessages();
  const played = legsPlayed(state);
  const score = tournamentScore(state);
  const outcome = tournamentOutcome(state);
  // 1-based and named once: the heading, the play button and the link all mean the same
  // game, and a track that counted one thing while its button counted another would be the
  // kind of off-by-one nobody reports because they assume they misread it.
  const upNext = played + 1;

  return (
    <div className={styles.track} role="group" aria-label={t(messages, 'Tournament')}>
      {/* Every rendered player name is wrapped in `<bdi>` (#222): a name in another script
          would otherwise reorder the sentence around it rather than only itself. */}
      <p className={styles.head}>
        {outcome === null ? (
          t(messages, 'Game {n} of {total}', { n: upNext, total: state.games.length })
        ) : outcome === 'draw' ? (
          t(messages, 'Tournament drawn')
        ) : (
          <T id="{name} wins the tournament" values={{ name: <bdi>{names[outcome]}</bdi> }} />
        )}
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
                {result === undefined
                  ? now
                    ? t(messages, 'Game {n}: playing now', { n: index + 1 })
                    : t(messages, 'Game {n}: to come', { n: index + 1 })
                  : result === 'draw'
                    ? t(messages, 'Game {n}: drawn', { n: index + 1 })
                    : t(messages, 'Game {n}: {name} won', { n: index + 1, name: names[result] })}
              </span>
            </li>
          );
        })}
      </ol>

      {/* The score in words as well as in marks, for the same reason the HUD carries one:
          a row of glyphs is the fast read and a sentence is the one that can be checked. */}
      <p className={styles.score}>
        <T
          id="{p1} {wins1} — {wins2} {p2}"
          values={{
            p1: <bdi>{names.p1}</bdi>,
            wins1: score.p1,
            wins2: score.p2,
            p2: <bdi>{names.p2}</bdi>,
          }}
        />
        {/* The drawn clause is its own id rather than a second copy of the whole line: the
            score line is shared with the result panel and is worth translating once. */}
        {score.draws > 0 ? t(messages, ', {drawn} drawn', { drawn: score.draws }) : ''}
      </p>
      {tier === undefined ? null : (
        <p className={styles.score}>
          {t(messages, 'Bot skill: {tier} for all {games} games', {
            tier: t(messages, tier),
            games: state.games.length,
          })}
        </p>
      )}

      <div className={styles.actions}>
        {onPlay === undefined ? null : (
          <button type="button" className={styles.play} onClick={onPlay}>
            {t(messages, 'Play game {n}', { n: upNext })}
          </button>
        )}
        {href === undefined ? null : (
          /* prefetch={false} for the reason the result screen's links carry it: a match
             should need nothing from the network, and warming another game's chunk from a
             page somebody is playing on is exactly what `e2e/offline.spec.ts` forbids. */
          <Link className={styles.play} href={href} prefetch={false}>
            {t(messages, 'Go to game {n}', { n: upNext })}
          </Link>
        )}
        {/* One press, and no arming step. The destructive buttons on /settings/ take two
            because what they erase cannot be rebuilt; this is seven games and one press to
            draw another line-up. What protects it is the label saying what it does. */}
        <button type="button" className={styles.leave} onClick={onLeave}>
          {t(messages, outcome === null ? 'Leave the tournament' : 'Finish')}
        </button>
      </div>
    </div>
  );
}
