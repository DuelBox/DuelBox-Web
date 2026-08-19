'use client';

import Link from 'next/link';
import type { SeatId } from '@duelbox/engine';
import type { GameManifest, MatchState } from '@duelbox/game-sdk';
import { seatColour } from '@/styles/tokens';
import { SeatGlyph } from './SeatGlyph';
import { Controls } from './Controls';
import styles from './MatchOverlay.module.css';

/**
 * Everything that covers the board: the countdown, the pause menu, the round result and
 * the match result.
 *
 * These four screens are the shell's, not a game's. Written per game they drift into 107
 * slightly different pause menus, and a player who learns one game learns nothing about
 * the next.
 */

export interface MatchOverlayProps {
  state: MatchState;
  /** Carries the per-game control copy the pause menu shows on demand. */
  manifest: GameManifest;
  rounds: number;
  seatNames?: Partial<Record<SeatId, string>> | undefined;
  /** Matches won by each seat in this sitting, across rematches. */
  record?: { p1: number; p2: number; draws: number } | undefined;
  /** Somewhere to go after the match, so a result screen is not a dead end. */
  nextGame?: { slug: string; name: string } | undefined;
  onResume: () => void;
  onQuit: () => void;
  onNextRound: () => void;
  onRematch: () => void;
}

export function MatchOverlay({
  state,
  manifest,
  rounds,
  seatNames,
  record,
  nextGame,
  onResume,
  onQuit,
  onNextRound,
  onRematch,
}: MatchOverlayProps) {
  switch (state.phase) {
    case 'countdown':
      return <Countdown remaining={state.countdownRemaining} />;

    case 'paused':
      return (
        <Panel heading="Paused" role="dialog">
          <p className={styles.detail}>The board is exactly where you left it.</p>
          {/* On demand during a match, as the issue asks: a player who has forgotten
              which keys are theirs should not have to quit to find out. */}
          <Controls manifest={manifest} />
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={onResume} autoFocus>
              Resume
            </button>
            <button type="button" className={styles.secondary} onClick={onQuit}>
              Quit match
            </button>
          </div>
        </Panel>
      );

    case 'round-over':
      return (
        <Panel heading={`Round ${state.round}`} role="status">
          <Winner outcome={state.roundOutcome} seatNames={seatNames} />
          <p className={styles.detail}>
            {seatName('p1', seatNames)} {state.roundWins.p1} — {state.roundWins.p2}{' '}
            {seatName('p2', seatNames)} · first to {Math.ceil(rounds / 2)} takes it
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={onNextRound} autoFocus>
              Next round
            </button>
            <button type="button" className={styles.secondary} onClick={onQuit}>
              Quit match
            </button>
          </div>
        </Panel>
      );

    case 'match-over':
      return (
        <Panel heading={rounds > 1 ? 'Match over' : 'Game over'} role="status">
          <Winner outcome={state.matchOutcome} seatNames={seatNames} />
          {rounds > 1 ? (
            <p className={styles.detail}>
              {seatName('p1', seatNames)} {state.roundWins.p1} — {state.roundWins.p2}{' '}
              {seatName('p2', seatNames)}
            </p>
          ) : null}
          {record && record.p1 + record.p2 + record.draws > 1 ? (
            <p className={styles.record}>
              Tonight: {seatName('p1', seatNames)} {record.p1} — {record.p2}{' '}
              {seatName('p2', seatNames)}
              {record.draws > 0 ? `, ${record.draws} drawn` : ''}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={onRematch} autoFocus>
              Rematch
            </button>
            {/* prefetch={false} on both links here: the Next router otherwise warms these
                routes' chunks while a match is running, downloading another game's code
                during play for a link the player may never take. A match should need
                nothing from the network, and `e2e/offline.spec.ts` asserts exactly that —
                which is how this was found. */}
            {nextGame ? (
              <Link className={styles.secondary} href={`/play/${nextGame.slug}`} prefetch={false}>
                Play {nextGame.name}
              </Link>
            ) : null}
          </div>
          <Link className={styles.back} href="/games" prefetch={false}>
            Back to all games
          </Link>
        </Panel>
      );

    default:
      return null;
  }
}

function Countdown({ remaining }: { remaining: number }) {
  // Ceiling, so the first frame of a three-second countdown reads "3" rather than "2".
  const count = Math.ceil(remaining);
  const label = count <= 0 ? 'Go' : String(count);
  return (
    <div className={styles.overlay} role="status" aria-live="assertive" aria-atomic="true">
      <span key={label} className={[styles.count, count <= 0 ? styles.go : ''].join(' ')}>
        {label}
      </span>
    </div>
  );
}

function Panel({
  heading,
  role,
  children,
}: {
  heading: string;
  role: 'dialog' | 'status';
  children: React.ReactNode;
}) {
  return (
    <div
      className={styles.overlay}
      role={role}
      {...(role === 'dialog' ? { 'aria-modal': true } : { 'aria-live': 'polite' as const })}
      aria-label={heading}
    >
      <div className={styles.panel}>
        <h2 className={styles.heading}>{heading}</h2>
        {children}
      </div>
    </div>
  );
}

function Winner({
  outcome,
  seatNames,
}: {
  outcome: SeatId | 'draw' | null;
  seatNames?: Partial<Record<SeatId, string>> | undefined;
}) {
  if (outcome === null) return null;
  if (outcome === 'draw') return <p className={styles.winner}>A draw</p>;
  return (
    <p className={styles.winner}>
      <SeatGlyph seat={outcome} size={28} />
      {seatName(outcome, seatNames)} wins
    </p>
  );
}

function seatName(seat: SeatId, seatNames?: Partial<Record<SeatId, string>>): string {
  return seatNames?.[seat] ?? seatColour[seat].name;
}
