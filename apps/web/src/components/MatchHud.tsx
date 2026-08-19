'use client';

import type { SeatId } from '@duelbox/engine';
import type { MatchState } from '@duelbox/game-sdk';
import { seatColour } from '@/styles/tokens';
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
  /** Rounds in the match. One means the round pips are not shown at all. */
  rounds: number;
  /** Whose turn it is, or null in a real-time game. */
  activeSeat: SeatId | null;
  /** Names the seats. In a bot match seat two is the bot. */
  seatNames?: Partial<Record<SeatId, string>> | undefined;
  onPause?: (() => void) | undefined;
}

export function MatchHud({ state, rounds, activeSeat, seatNames, onPause }: MatchHudProps) {
  const canPause = state.phase === 'playing' || state.phase === 'countdown';
  return (
    <div className={styles.hud} role="group" aria-label="Score">
      <Seat seat="p1" state={state} activeSeat={activeSeat} seatNames={seatNames} />

      <div className={styles.middle}>
        {rounds > 1 ? (
          <>
            <span className={styles.label}>
              Round {state.round} of {rounds}
            </span>
            <RoundPips rounds={rounds} state={state} />
          </>
        ) : (
          <span className={styles.label}>vs</span>
        )}
      </div>

      <Seat seat="p2" state={state} activeSeat={activeSeat} seatNames={seatNames} right />

      {onPause && canPause ? (
        <button type="button" className={styles.pause} onClick={onPause} aria-label="Pause the match">
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
  seatNames,
  right = false,
}: {
  seat: SeatId;
  state: MatchState;
  activeSeat: SeatId | null;
  seatNames?: Partial<Record<SeatId, string>> | undefined;
  right?: boolean | undefined;
}) {
  const name = seatNames?.[seat] ?? seatColour[seat].name;
  const isActive = activeSeat === seat;
  const score = seat === 'p1' ? state.tally.p1 : state.tally.p2;
  return (
    <div
      className={[styles.seat, right ? styles.right : '', isActive ? styles.active : ''].join(' ')}
      data-seat={seat}
      // Announced as a live region so a screen-reader user hears the score change
      // without hunting for it.
      aria-live="polite"
    >
      <SeatGlyph seat={seat} />
      <span className={styles.name}>{name}</span>
      <span className={styles.score}>{score}</span>
      {isActive ? <span className={styles.turn}>turn</span> : null}
      <span className="db-visually-hidden">
        {name} has {score} {score === 1 ? 'point' : 'points'}
        {isActive ? ', and it is their turn' : ''}
      </span>
    </div>
  );
}

/** One pip per round: filled for the seat that took it, empty for rounds not yet played. */
function RoundPips({ rounds, state }: { rounds: number; state: MatchState }) {
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
        Rounds won: {seatColour.p1.name} {state.roundWins.p1}, {seatColour.p2.name}{' '}
        {state.roundWins.p2}
      </span>
    </div>
  );
}
