'use client';

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { SeatId } from '@duelbox/engine';
import {
  initialMatchState,
  reduce,
  type Game,
  type GameManifest,
  type MatchEvent,
  type MatchRules,
} from '@duelbox/game-sdk';
import { PLAYABLE, loadGame } from '@/data/registry';
import { CATALOGUE } from '@/data/catalogue.generated';
import { seatColour } from '@/styles/tokens';
import { readLastMode, writeLastMode } from '@/lib/last-mode';
import { armAudio } from '@/lib/audio';
import { GameHost } from './GameHost';
import { TracePanel } from './TracePanel';
import { MatchHud } from './MatchHud';
import { MatchOverlay } from './MatchOverlay';
import { Controls } from './Controls';
import styles from './PlaySurface.module.css';

type Mode = 'friend' | 'bot';

/**
 * Hoisted so its identity is stable across renders.
 *
 * Written inline it was a fresh object every render, and it sits in the game host's
 * setup-effect dependencies — so the first countdown frame tore the game down and
 * rebuilt it, and bot matches hung on the countdown forever.
 */
const BOT_OPPONENT = { p2: 'normal' } as const;

/**
 * The shared match flow every game runs inside: choose a mode, count in, play, pause,
 * see the result, play again.
 *
 * None of it belongs to a game. Games supply a simulation and an outcome; the countdown,
 * the HUD, the pause menu, the result screen and the rematch all come from here, so the
 * hundred-and-eighth game inherits them for free and the first seven cannot drift apart.
 */
export function PlaySurface({ slug }: { slug: string }) {
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [manifest, setManifest] = useState<GameManifest | null>(null);
  const [create, setCreate] = useState<(() => Game) | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [activeSeat, setActiveSeat] = useState<SeatId | null>(null);
  /**
   * Whether to record an input trace, read once from `?trace=1`.
   *
   * A query parameter rather than a build flag, because the report that matters is the one
   * somebody makes about the deployed site, and a flag they cannot turn on is a flag that
   * never records the bug. Read in an effect rather than during render: this page is
   * statically exported, and reading `location` while rendering makes the server's HTML and
   * the browser's first paint disagree.
   */
  const [recording, setRecording] = useState(false);
  const [getTrace, setGetTrace] = useState<(() => string) | null>(null);
  useEffect(() => {
    setRecording(new URLSearchParams(globalThis.location.search).get('trace') === '1');
  }, []);
  // The running head-to-head for this sitting. A pair that plays five in a row wants to
  // know the score across all five, not just the last one.
  const [record, setRecord] = useState({ p1: 0, p2: 0, draws: 0 });
  // A new seed per match keeps a rematch from replaying the previous one exactly.
  const [seed, setSeed] = useState(1);

  // Armed here rather than in `GameHost`, which mounts only after Start is pressed — by
  // then the press that should have unlocked audio has already happened. Arming on the
  // play page means the Start tap itself is the gesture, so the first match has sound
  // with no extra tap, which is the whole acceptance criterion of #167.
  useEffect(() => {
    armAudio();
  }, []);

  /**
   * The seven games built so far settle their own rounds and report a winner, so the
   * shell trusts that outcome rather than second-guessing it from the score. Games that
   * declare a win condition instead get it resolved here; both paths run the same flow.
   */
  const rules = useMemo<MatchRules>(
    () => ({ win: { kind: 'first-to', target: 1 }, rounds: 1, countdownSeconds: 3 }),
    [],
  );

  const [match, send] = useReducer(
    (state: ReturnType<typeof initialMatchState>, event: MatchEvent) => reduce(state, event, rules),
    undefined,
    initialMatchState,
  );

  useEffect(() => {
    let cancelled = false;
    loadGame(slug)
      .then((loaded) => {
        if (cancelled) return;
        setManifest(loaded.manifest);
        setCreate(() => () => loaded.create());
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Escape pauses and resumes. The host deliberately never swallows it.
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.code !== 'Escape') return;
      if (match.phase === 'playing' || match.phase === 'countdown') send({ kind: 'pause' });
      else if (match.phase === 'paused') send({ kind: 'resume' });
    }
    globalThis.addEventListener('keydown', onKey);
    return () => {
      globalThis.removeEventListener('keydown', onKey);
    };
  }, [match.phase]);

  // Counted once per match, when the machine enters its terminal phase.
  /**
   * Stop the browser's own pull-to-refresh while a match is running.
   *
   * The canvas already declares `overscroll-behavior: contain`, but that only covers a
   * gesture that *starts on the canvas*. A match letterboxes, so on a phone there is page
   * either side of the board — and a swipe down that starts there reaches the document and
   * pulls the page to refresh, throwing away the match. `touch-action` on the canvas
   * cannot help, because the finger never touched the canvas.
   *
   * Scoped to a live match rather than to the whole route, so a player looking at a lobby
   * or a result can still refresh the page the ordinary way.
   */
  useEffect(() => {
    const live =
      match.phase === 'countdown' || match.phase === 'playing' || match.phase === 'paused';
    if (!live) return;
    const root = document.documentElement;
    root.dataset.match = 'live';
    return () => {
      delete root.dataset.match;
    };
  }, [match.phase]);

  useEffect(() => {
    if (match.phase !== 'match-over') return;
    const outcome = match.matchOutcome;
    setRecord((previous) => ({
      p1: previous.p1 + (outcome === 'p1' ? 1 : 0),
      p2: previous.p2 + (outcome === 'p2' ? 1 : 0),
      draws: previous.draws + (outcome === 'draw' ? 1 : 0),
    }));
  }, [match.phase, match.matchOutcome]);

  const handleTick = useCallback((dt: number) => {
    send({ kind: 'tick', seconds: dt });
  }, []);

  const handleScore = useCallback((p1: number, p2: number, winner: SeatId | 'draw' | null) => {
    send({ kind: 'score', tally: { p1, p2 }, outcome: winner });
  }, []);

  const handlePauseRequest = useCallback(() => {
    send({ kind: 'pause' });
  }, []);

  const start = useCallback(
    (chosen: Mode) => {
      // Remembered as a default for next time, never as a decision: reopening this game
      // pre-selects what you last chose, it does not start it.
      writeLastMode(slug, chosen);
      setMode(chosen);
      setActiveSeat(null);
      const next = seed + 1;
      setSeed(next);
      // The seed goes with the event: it is what the match machine flips its opening-seat
      // coin from, and that coin has to be reproducible from the match rather than drawn
      // from entropy the replay cannot recover (#2466).
      send({ kind: 'start', seed: next });
    },
    // `seed` is read, so it belongs here: without it the callback closes over the seed
    // from the render that created it and every match after the first would open on a
    // stale one. React's exhaustive-deps rule would say so, but it is not enabled in this
    // repo yet (#2482).
    [slug, seed],
  );

  const rematch = useCallback(() => {
    setActiveSeat(null);
    const next = seed + 1;
    setSeed(next);
    send({ kind: 'rematch', seed: next });
  }, [seed]);

  const quit = useCallback(() => {
    setMode(null);
    send({ kind: 'quit' });
  }, []);

  const nextGame = useMemo(() => suggestNextGame(slug), [slug]);

  if (loadState === 'error') {
    return (
      <div className={styles.state} role="alert">
        <h2>This game is not playable yet</h2>
        <p>Its rules and controls are settled, but the build has not landed. Try another game.</p>
      </div>
    );
  }

  if (loadState === 'loading' || !manifest || !create) {
    return (
      <div className={styles.state}>
        <p>Loading {slug.replace(/-/g, ' ')}…</p>
      </div>
    );
  }

  if (match.phase === 'idle' || mode === null) {
    const remembered = readLastMode(slug);
    const offered = manifest.modes.filter((m): m is Mode => m === 'friend' || m === 'bot');
    // The remembered mode leads, so the button under the player's thumb is the one they
    // used last. Order, not preselection — nothing starts without a deliberate press.
    const ordered = [...offered].sort((a, b) => {
      if (a === remembered) return -1;
      if (b === remembered) return 1;
      return 0;
    });
    return (
      <div className={styles.state}>
        <h2>{manifest.name}</h2>
        <div className={styles.modes}>
          {ordered.map((offer, index) => (
            <button
              key={offer}
              type="button"
              className={index === 0 ? styles.primary : styles.secondary}
              onClick={() => {
                start(offer);
              }}
            >
              {offer === 'friend' ? 'Play together here' : `Play against ${seatColour.p2.name}`}
            </button>
          ))}
        </div>
        <Controls manifest={manifest} />
      </div>
    );
  }

  const seatNames: Partial<Record<SeatId, string>> =
    mode === 'bot' ? { p2: `${seatColour.p2.name} (bot)` } : { p2: 'Player two' };

  const hudProps = {
    state: match,
    rounds: rules.rounds ?? 1,
    activeSeat,
    seatNames,
    botSeats: mode === 'bot' ? { p2: true } : undefined,
  };

  return (
    <div className={styles.surface}>
      {/* Two people sit on opposite sides of one device, so the scoreboard faces both
          ways. The far copy is turned to face the player at the top of the screen. */}
      <MatchHud {...hudProps} flipped />

      <div className={styles.boardArea}>
        <div className={styles.board}>
          <GameHost
            manifest={manifest}
            createGame={create}
            seed={seed}
            phase={match.phase}
            presentation="shared-screen"
            localSeat="p1"
            openingSeat={match.openingSeat}
            {...(mode === 'bot' ? { botDifficulty: BOT_OPPONENT } : {})}
            onTick={handleTick}
            onScore={handleScore}
            onActiveSeat={setActiveSeat}
            onRequestPause={handlePauseRequest}
            recordTrace={recording}
            // Wrapped, not passed. React treats a function handed to a state setter as an
            // *updater* and calls it with the previous state — so `setGetTrace(get)` invoked
            // the getter and stored the string it returned, and the panel then tried to call
            // a string. The trace stayed empty and nothing threw where anyone would see it.
            onTraceReady={(get) => {
              setGetTrace(() => get);
            }}
          />
          <TracePanel getTrace={recording ? getTrace : null} />
          <MatchOverlay
            state={match}
            manifest={manifest}
            rounds={rules.rounds ?? 1}
            seatNames={seatNames}
            record={record}
            nextGame={nextGame}
            onResume={() => {
              send({ kind: 'resume' });
            }}
            onQuit={quit}
            onNextRound={() => {
              send({ kind: 'next-round' });
            }}
            onRematch={rematch}
          />
        </div>
      </div>

      <MatchHud {...hudProps} onPause={handlePauseRequest} />
    </div>
  );
}

/**
 * Something to play next, so a result screen is never a dead end. Deterministic — the
 * slug picks it — because a suggestion that changes on every render reads as a glitch.
 */
function suggestNextGame(slug: string): { slug: string; name: string } | undefined {
  const others = PLAYABLE.filter((candidate) => candidate !== slug);
  const first = others[0];
  if (first === undefined) return undefined;
  let hash = 0;
  for (let i = 0; i < slug.length; i += 1) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  const pick = others[hash % others.length] ?? first;
  const entry = CATALOGUE.find((game) => game.slug === pick);
  return { slug: pick, name: entry?.name ?? pick.replace(/-/g, ' ') };
}
