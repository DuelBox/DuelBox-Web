'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import type { SeatId } from '@duelbox/engine';
import type { GameManifest, MatchState } from '@duelbox/game-sdk';
import type { SeatNames } from '@/lib/seats';
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
  /** What both seats are called, from `lib/seats.ts`. Total, so nothing here falls back. */
  seatNames: SeatNames;
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
            {seatNames.p1} {state.roundWins.p1} — {state.roundWins.p2} {seatNames.p2} · first to{' '}
            {Math.ceil(rounds / 2)} takes it
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
              {seatNames.p1} {state.roundWins.p1} — {state.roundWins.p2} {seatNames.p2}
            </p>
          ) : null}
          {record && record.p1 + record.p2 + record.draws > 1 ? (
            <p className={styles.record}>
              Tonight: {seatNames.p1} {record.p1} — {record.p2} {seatNames.p2}
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

/**
 * Everything inside the panel that is a stop on the Tab order.
 *
 * `[tabindex="-1"]` is excluded on purpose: those are programmatic focus targets, and
 * tabbing to one is exactly what a keyboard user did not ask for.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function focusableWithin(root: ParentNode): HTMLElement[] {
  const stops: HTMLElement[] = [];
  for (const node of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    // A control with no boxes is hidden — `display: none`, or an ancestor that is — and a
    // hidden control is not somewhere Tab can land.
    if (node.getClientRects().length === 0) continue;
    stops.push(node);
  }
  return stops;
}

/**
 * A place focus can be *put*, as opposed to a place it can be tabbed to.
 *
 * A text field is neither: focusing one raises the on-screen keyboard over half the phone,
 * and nobody asked for it by quitting a match. Radios, checkboxes and buttons are fine.
 */
function acceptsHandedBackFocus(el: HTMLElement): boolean {
  if (el instanceof HTMLTextAreaElement) return false;
  if (!(el instanceof HTMLInputElement)) return true;
  return ['button', 'checkbox', 'radio', 'reset', 'submit', 'range', 'color', 'file'].includes(
    el.type,
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const modal = role === 'dialog';

  /**
   * The focus trap `aria-modal` has been promising all along.
   *
   * `aria-modal="true"` tells assistive technology that everything outside this panel is
   * inert. With nothing holding focus in, Tab walked out of the pause menu and into the
   * site header — a screen reader announcing links on a page it had just said did not
   * exist, which is worse than never claiming `aria-modal` at all (#2483). And this is
   * the product's only modal, raised mid-match on a device two people are sharing.
   *
   * Only the pause menu is a dialog. The round and match results are `role="status"`:
   * they are announcements, they interrupt nobody, and trapping focus in one would be a
   * bug rather than a fix.
   */
  useEffect(() => {
    if (!modal) return;
    const panel = dialogRef.current;
    // Narrowed into a binding of its own: the handler below closes over it, and the
    // compiler will not carry a `!== null` check across that boundary.
    if (panel === null) return;
    const trapped: HTMLDivElement = panel;

    /**
     * Whatever had focus when the menu opened, and where focus goes when it closes.
     *
     * Usually the HUD's pause button — which the HUD stops rendering the moment the match
     * pauses, so by the time this is needed the node is often already out of the document.
     * That is what `region` is for.
     */
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    /**
     * The region the panel covers, captured now rather than on close: by then the panel is
     * out of the document and can no longer be asked what it was inside.
     */
    const region: ParentNode = trapped.closest('main') ?? document.body;

    /**
     * Every Tab is answered here, not only the one that would have left the panel.
     *
     * Wrapping at the edges alone is the usual shape of a trap, and it leaks on Safari:
     * with macOS full keyboard access off — the default — Tab visits text fields and
     * nothing else, so from the Resume button of a two-button panel it walks to no stop at
     * all and focus lands on `<body>`, outside a panel that has declared the page inert.
     * Moving focus by hand costs one line and behaves the same on every engine, which for
     * a product played on an iPad with a keyboard is the point.
     */
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Tab') return;
      // A panel with nothing focusable in it still may not leak focus to a page it has
      // declared inert.
      event.preventDefault();
      const stops = focusableWithin(trapped);
      if (stops.length === 0) return;
      const active = document.activeElement;
      const here = active instanceof HTMLElement ? stops.indexOf(active) : -1;
      const step = event.shiftKey ? -1 : 1;
      // From outside the panel, forwards lands on the first stop and backwards on the last.
      const next = here === -1 ? (event.shiftKey ? stops.length - 1 : 0) : here + step;
      const wrapped = (next + stops.length) % stops.length;
      stops[wrapped]?.focus({ preventScroll: true });
    }

    // Capture, so the trap decides what Tab means before anything else on the page does.
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      /**
       * Focus restore. Dismissing a dialog used to drop focus on `<body>`, which costs a
       * keyboard user their place entirely — on Quit they landed at the top of the
       * document with the lobby they had just opened somewhere below them.
       *
       * The opener first, if it survived; otherwise the first control of whatever replaced
       * it. On Resume that is the board, which is where focus belongs mid-match and which
       * the host then claims for itself a moment later (`GameHost`, on the phase change).
       * On Quit it is the first control of the lobby underneath. Never `<body>`.
       */
      const back =
        opener !== null && opener.isConnected
          ? opener
          : focusableWithin(region).find(acceptsHandedBackFocus);
      back?.focus({ preventScroll: true });
    };
  }, [modal]);

  return (
    <div
      ref={dialogRef}
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

function Winner({ outcome, seatNames }: { outcome: SeatId | 'draw' | null; seatNames: SeatNames }) {
  if (outcome === null) return null;
  if (outcome === 'draw') return <p className={styles.winner}>A draw</p>;
  return (
    <p className={styles.winner}>
      <SeatGlyph seat={outcome} size={28} />
      {seatNames[outcome]} wins
    </p>
  );
}
