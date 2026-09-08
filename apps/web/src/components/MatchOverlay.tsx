'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { GameManifest, MatchState } from '@duelbox/game-sdk';
import type { Tally } from '@/lib/head-to-head';
import type { SeatNames } from '@/lib/seats';
import { resultAnnouncement, soloAnnouncement } from '@/lib/match-announcement';
import type { RunResult } from '@/lib/best-scores';
import { SeatGlyph } from './SeatGlyph';
import { Controls } from './Controls';
import { countdownViews } from './countdown-views';
import { SoundToggle } from './SoundToggle';
import styles from './MatchOverlay.module.css';

/**
 * Everything that covers the board: the countdown, the pause menu, the round result and
 * the match result.
 *
 * These four screens are the shell's, not a game's. Written per game they drift into 107
 * slightly different pause menus, and a player who learns one game learns nothing about
 * the next.
 *
 * A fifth thing covers nothing and is drawn nowhere: the live region that says the result
 * out loud. It sits beside the panels rather than inside one because it has to exist
 * before there is a result to put in it — see `lib/match-announcement.ts`.
 */

export interface MatchOverlayProps {
  state: MatchState;
  /** Carries the per-game control copy the pause menu shows on demand. */
  manifest: GameManifest;
  rounds: number;
  /** What both seats are called, from `lib/seats.ts`. Total, so nothing here falls back. */
  seatNames: SeatNames;
  /**
   * Matches each seat has won at this game, all of them, from `lib/head-to-head.ts` —
   * *including* the match this panel is announcing.
   *
   * It used to be the tally for one sitting and the line above it said "Tonight", which
   * stopped being true the moment the record outlived the tab (#160). It arrives already
   * carrying the current result rather than a commit later, so the first paint of the
   * result panel is the paint with the final numbers on it.
   *
   * It is also the record against *this* match's opponent. A bot's wins are the bot's, and
   * the store keeps them apart from the two seats' own head-to-head, so the names beside
   * these numbers are the names of whoever actually won them.
   */
  record?: Tally | undefined;
  /** Somewhere to go after the match, so a result screen is not a dead end. */
  nextGame?: { slug: string; name: string } | undefined;
  /** This game's route slug, for the address the share card prints (#164). */
  slug: string;
  /**
   * How the match is presented, so the count-in reads upright for whoever is looking (#142).
   * Shared-screen draws it twice, once turned; single-seat draws it once. Defaults to
   * shared-screen, the archetype default for everything the shell hosts today.
   */
  presentation?: Presentation | undefined;
  /**
   * Why the match paused itself, when it did (#130): a controller came or went. Shown on the
   * pause panel and nowhere else, because the panel is the thing the pause put on screen and
   * a second surface for one sentence is a second thing to focus-trap.
   */
  notice?: string | undefined;
  /** Swaps which controller drives which seat; absent when no controller has been seen. */
  onSwapControllers?: (() => void) | undefined;
  onResume: () => void;
  onQuit: () => void;
  onNextRound: () => void;
  onRematch: () => void;
  /** Restart the match cleanly from the pause menu (#145). */
  onRestart: () => void;
  /**
   * A solo run's result (#1750), once the machine has settled it. Present only in solo mode:
   * the ending is then a score against this device's best rather than a winner, the
   * head-to-head line and the share card are not offered (there was nobody on the other side
   * of either), and the way on is "Go again" rather than "Rematch".
   */
  solo?: RunResult | undefined;
}

export function MatchOverlay(props: MatchOverlayProps) {
  const { state, rounds, seatNames, solo } = props;
  return (
    <>
      {/*
        The result, said out loud, from a region that was already here.

        This is the whole of #177's acceptance criterion — "hear the result" — and the
        panel below cannot deliver it however it is marked up: it is *inserted* carrying
        its text, and a live region that arrives with its content is the shape assistive
        technology is least reliable about. This one has been on the page, empty, since
        the countdown, so the ending is a change to text a screen reader was already
        watching.

        Assertive and atomic, exactly as the countdown below is, and for the same reason:
        both are the thing everyone in the room is waiting on, and half a result read out
        of a partly-changed region is worse than none. It says the panel's own words and
        `lib/match-announcement.ts` explains why it says them exactly once.
      */}
      <p className="db-visually-hidden" role="status" aria-live="assertive" aria-atomic="true">
        {solo === undefined
          ? resultAnnouncement(state, rounds, seatNames)
          : soloAnnouncement(state, solo)}
      </p>
      <Phase {...props} />
    </>
  );
}

function Phase({
  state,
  manifest,
  rounds,
  seatNames,
  record,
  nextGame,
  slug,
  presentation = 'shared-screen',
  notice,
  onSwapControllers,
  onResume,
  onQuit,
  onNextRound,
  onRematch,
  onRestart,
  solo,
}: MatchOverlayProps) {
  switch (state.phase) {
    case 'countdown':
      return <Countdown remaining={state.countdownRemaining} presentation={presentation} />;

    case 'paused':
      return (
        <Panel heading="Paused" role="dialog">
          {/* The controller sentence first, because when it is present it is the reason the
              board stopped, and "exactly where you left it" is then the second thing to know. */}
          {notice === undefined ? null : <p className={styles.notice}>{notice}</p>}
          <p className={styles.detail}>The board is exactly where you left it.</p>
          {/* On demand during a match, as the issue asks: a player who has forgotten
              which keys are theirs should not have to quit to find out. */}
          <Controls manifest={manifest} />
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={onResume} autoFocus>
              Resume
            </button>
            {/* Restart and Settings join Resume and Quit (#145). Restart starts the match
                over cleanly; Settings opens the shell's settings surface. Both are ordinary
                stops in the pause dialog's focus trap, so either seat operates them with a
                keyboard as well as a tap. */}
            <button type="button" className={styles.secondary} onClick={onRestart}>
              Restart
            </button>
            {/* The manual half of "connection order plus manual reassignment" (#130): the
                pair who were handed the wrong pads swap without re-plugging. Only offered
                once a controller has been seen, so a keyboard-and-touch pair never meet a
                button about a thing they do not have. */}
            {onSwapControllers === undefined ? null : (
              <button type="button" className={styles.secondary} onClick={onSwapControllers}>
                Swap controllers
              </button>
            )}
            <Link className={styles.secondary} href="/settings/" prefetch={false}>
              Settings
            </Link>
            {/* The product's only sound control. Here because pause is already where a
                pair stops to change something, and because a control beside the score is
                one either player can hit reaching across a shared device. */}
            <SoundToggle className={styles.secondary} />
            <button type="button" className={styles.secondary} onClick={onQuit}>
              Quit match
            </button>
          </div>
        </Panel>
      );

    case 'round-over':
      return (
        <Panel heading={`Round ${state.round}`} role="group">
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
      if (solo !== undefined) {
        // One person, one number, and the one they are trying to beat. No winner line — the
        // machine settled the run with a seat in `matchOutcome` because that is its only
        // vocabulary, and which seat it named is not a result anybody is shown.
        return (
          <Panel heading="Game over" role="group">
            <p className={styles.winner}>Score {solo.score}</p>
            <p className={styles.detail}>
              {solo.isNewBest
                ? 'A new best on this device.'
                : `Best on this device: ${String(solo.best)}.`}
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={onRematch} autoFocus>
                Go again
              </button>
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
      }
      return (
        <Panel heading={rounds > 1 ? 'Match over' : 'Game over'} role="group">
          <Winner outcome={state.matchOutcome} seatNames={seatNames} />
          {rounds > 1 ? (
            <p className={styles.detail}>
              {seatNames.p1} {state.roundWins.p1} — {state.roundWins.p2} {seatNames.p2}
            </p>
          ) : null}
          {/* From the first finished match rather than the second: the number is worth
              showing as soon as there is one, now that it is a record kept across
              sittings rather than a count of tonight's rematches. The match on screen is
              already in it, so a settled match always has something here and the line
              cannot appear a frame after the buttons it sits above. */}
          {record && record.p1 + record.p2 + record.draws > 0 ? (
            <p className={styles.record}>
              All time in {manifest.name}: {seatNames.p1} {record.p1} — {record.p2} {seatNames.p2}
              {record.draws > 0 ? `, ${record.draws} drawn` : ''}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={onRematch} autoFocus>
              Rematch
            </button>
            {state.matchOutcome !== null ? (
              <ShareResult
                slug={slug}
                game={manifest.name}
                seatNames={seatNames}
                outcome={state.matchOutcome}
                // The score a person would read off the panel: the round tally for a best-of,
                // this round's tally for a single round — the same choice the line above makes.
                score={rounds > 1 ? state.roundWins : state.tally}
              />
            ) : null}
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

function Countdown({ remaining, presentation }: { remaining: number; presentation: Presentation }) {
  // Ceiling, so the first frame of a three-second countdown reads "3" rather than "2".
  const count = Math.ceil(remaining);
  const label = count <= 0 ? 'Go' : String(count);
  // One copy per seat that has to read it: in shared-screen two, the far one turned to face
  // the player at the top of the device with the same rotate-180 the scoreboard uses; in
  // single-seat one, upright (#142). Rotated copies first, so they sit at the top of the
  // column facing the player there.
  const views = [...countdownViews(presentation)].sort(
    (a, b) => Number(b.rotated) - Number(a.rotated),
  );
  return (
    <div className={styles.overlay}>
      <div className={styles.countdown}>
        {views.map((view) => (
          <div
            key={view.seat}
            className={[styles.countSeat, view.rotated ? styles.countFar : ''].join(' ')}
            // The upright copy carries the announcement; the turned copy is decorative and
            // hidden, or a screen reader hears the count twice — the same rule the flipped
            // scoreboard follows.
            {...(view.rotated
              ? { 'aria-hidden': true as const }
              : {
                  role: 'status' as const,
                  'aria-live': 'assertive' as const,
                  'aria-atomic': true as const,
                })}
          >
            <span key={label} className={[styles.count, count <= 0 ? styles.go : ''].join(' ')}>
              {label}
            </span>
          </div>
        ))}
      </div>
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
  role: 'dialog' | 'group';
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
   * Only the pause menu is a dialog. The round and match results are `role="group"`:
   * they are not modal, they interrupt nobody, and trapping focus in one would be a bug
   * rather than a fix.
   *
   * They were `role="status"`, which read as the right answer and was not one. A live
   * region has to be on the page *before* the words are, and these panels are inserted
   * already carrying theirs — so on the one hand a screen reader might say nothing at
   * all, and on the other, an engine that did announce the insertion would read the whole
   * panel: the heading, the winner, the score, the all-time record and three buttons. The
   * result now goes to the region `MatchOverlay` keeps for it, in one sentence, once; this
   * is the panel a player then navigates, and a named group is what it always was.
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
      {...(role === 'dialog' ? { 'aria-modal': true } : {})}
      aria-label={heading}
    >
      <div className={styles.panel}>
        <h2 className={styles.heading}>{heading}</h2>
        {children}
      </div>
    </div>
  );
}

/**
 * The Share button and the line it reports through (#164).
 *
 * The card's code arrives by `import()` on the first press and not before — the
 * `SoundToggle` → `lib/audio` precedent — so a pair who never share never download a canvas
 * renderer. It is the play route either way, but "on demand" is only honest if the demand
 * actually happens.
 *
 * The status line is `aria-live` without `role="status"`, deliberately: the overlay already
 * has the one status region on the page (the announcement above the panels), and
 * `e2e/record.spec.ts` asks for "the" one.
 */
function ShareResult({
  slug,
  game,
  seatNames,
  outcome,
  score,
}: {
  slug: string;
  game: string;
  seatNames: SeatNames;
  outcome: SeatId | 'draw';
  score: Readonly<Record<SeatId, number>>;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const share = () => {
    setBusy(true);
    setStatus(null);
    void import('@/lib/share-card')
      .then(async (card) => {
        const data = { game, slug, names: seatNames, score, outcome };
        const blob = await card.renderShareCard(data);
        const result = await card.shareOrDownload(blob, data);
        setStatus(
          result === 'downloaded'
            ? `Saved as ${card.shareCardFilename(data)}.`
            : result === 'shared'
              ? 'Shared.'
              : null,
        );
      })
      .catch(() => {
        setStatus('The picture could not be made. Try again.');
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <>
      <button type="button" className={styles.secondary} onClick={share} disabled={busy}>
        Share result
      </button>
      <p className={styles.shareStatus} aria-live="polite">
        {status}
      </p>
    </>
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
