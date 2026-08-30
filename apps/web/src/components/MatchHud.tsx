'use client';

import { useEffect, useRef, useState } from 'react';
import type { SeatId } from '@duelbox/engine';
import type { MatchState } from '@duelbox/game-sdk';
import type { SeatNames } from '@/lib/seats';
import { SeatGlyph } from './SeatGlyph';
import styles from './MatchHud.module.css';

/**
 * The scoreboard every game shares.
 *
 * One HUD for 107 games is the point: a bespoke scoreboard per game is 107 chances to
 * disagree about where the score sits, what the seats are called, and whether the turn is
 * legible without colour. It reads the match machine's state and nothing else.
 */

export interface MatchHudProps {
  state: MatchState;
  /**
   * Turn the whole board 180 degrees, for the player sitting on the far side of a shared
   * device. The flipped copy is decorative: the upright one carries the announcements.
   */
  flipped?: boolean | undefined;
  /** Rounds in the match. One means the round pips are not shown at all. */
  rounds: number;
  /** Whose turn it is, or null in a real-time game. */
  activeSeat: SeatId | null;
  /**
   * What both seats are called, from `lib/seats.ts`.
   *
   * Required and total. It was an optional map of *overrides*, and every consumer carried
   * its own fallback for the seats the caller had not named — which is how the HUD came to
   * read "Pip vs Player two", one seat named by the shell and the other by a default two
   * files away.
   */
  seatNames: SeatNames;
  /**
   * Which seats a bot holds, so the HUD says "thinking" rather than "turn".
   *
   * Any map keyed by seat: the shell passes the same tier map the game host is given, so
   * the HUD and the simulation cannot disagree about who is a bot.
   */
  botSeats?: Readonly<Partial<Record<SeatId, unknown>>> | undefined;
  onPause?: (() => void) | undefined;
}

export function MatchHud({
  state,
  rounds,
  activeSeat,
  seatNames,
  botSeats,
  onPause,
  flipped = false,
}: MatchHudProps) {
  const canPause = state.phase === 'playing' || state.phase === 'countdown';
  return (
    <div
      className={[styles.hud, flipped ? styles.flipped : ''].join(' ')}
      {...(flipped
        ? { 'aria-hidden': true as const }
        : { role: 'group' as const, 'aria-label': 'Score' })}
    >
      <Seat
        seat="p1"
        state={state}
        activeSeat={activeSeat}
        name={seatNames.p1}
        isBot={botSeats?.p1 !== undefined}
        silent={flipped}
      />

      <div className={styles.middle}>
        {rounds > 1 ? (
          <>
            <span className={styles.label}>
              Round {state.round} of {rounds}
            </span>
            <RoundPips rounds={rounds} state={state} seatNames={seatNames} />
          </>
        ) : (
          <span className={styles.label}>vs</span>
        )}
      </div>

      <Seat
        seat="p2"
        state={state}
        activeSeat={activeSeat}
        name={seatNames.p2}
        isBot={botSeats?.p2 !== undefined}
        silent={flipped}
        right
      />

      {onPause && canPause && !flipped ? (
        <button
          type="button"
          className={styles.pause}
          onClick={onPause}
          aria-label="Pause the match"
        >
          ❚❚
        </button>
      ) : null}
    </div>
  );
}

function Seat({
  seat,
  state,
  activeSeat,
  name,
  isBot = false,
  right = false,
  silent = false,
}: {
  seat: SeatId;
  state: MatchState;
  activeSeat: SeatId | null;
  /** Already resolved by the caller. Nothing here decides what a seat is called. */
  name: string;
  isBot?: boolean | undefined;
  right?: boolean | undefined;
  silent?: boolean | undefined;
}) {
  const isActive = activeSeat === seat;
  const score = seat === 'p1' ? state.tally.p1 : state.tally.p2;
  const bumped = useScoreBump(score);
  return (
    <div
      className={[styles.seat, right ? styles.right : '', isActive ? styles.active : ''].join(' ')}
      data-seat={seat}
      // Announced as a live region so a screen-reader user hears the score change
      // without hunting for it. The flipped copy stays quiet or it is said twice.
      {...(silent ? {} : { 'aria-live': 'polite' as const })}
    >
      <SeatGlyph seat={seat} />
      <span className={styles.name}>{name}</span>
      <span className={styles.score} data-bumped={bumped ? 'true' : 'false'}>
        {score}
      </span>
      {isActive ? <span className={styles.turn}>{isBot ? 'thinking' : 'turn'}</span> : null}
      {silent ? null : (
        <span className="db-visually-hidden">
          {name} has {score} {score === 1 ? 'point' : 'points'}
          {isActive ? (isBot ? ', and they are thinking' : ', and it is their turn') : ''}
        </span>
      )}
    </div>
  );
}

/**
 * True for one animation's length after `score` changes.
 *
 * Driven by a state flag rather than by restarting a CSS animation on a key change: a
 * remount would lose the element's focus and its live-region identity.
 */
function useScoreBump(score: number): boolean {
  const previous = useRef(score);
  const [bumped, setBumped] = useState(false);
  useEffect(() => {
    if (previous.current === score) return;
    previous.current = score;
    setBumped(true);
    const timer = setTimeout(() => {
      setBumped(false);
    }, BUMP_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [score]);
  return bumped;
}

/** Matches the `bump` keyframe duration in the stylesheet. */
const BUMP_MS = 220;

/** One pip per round: filled for the seat that took it, empty for rounds not yet played. */
function RoundPips({
  rounds,
  state,
  seatNames,
}: {
  rounds: number;
  state: MatchState;
  seatNames: SeatNames;
}) {
  const won: (SeatId | null)[] = [];
  for (let i = 0; i < state.roundWins.p1; i += 1) won.push('p1');
  for (let i = 0; i < state.roundWins.p2; i += 1) won.push('p2');
  while (won.length < rounds) won.push(null);

  return (
    <div className={styles.rounds}>
      {won.slice(0, rounds).map((seat, index) => (
        <span
          key={index}
          className={styles.pip}
          {...(seat ? { 'data-won': seat } : {})}
          aria-hidden="true"
        />
      ))}
      <span className="db-visually-hidden">
        Rounds won: {seatNames.p1} {state.roundWins.p1}, {seatNames.p2} {state.roundWins.p2}
      </span>
    </div>
  );
}
