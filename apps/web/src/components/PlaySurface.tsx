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
import { GAME_NAMES } from '@/data/game-names.generated';
import { SEAT_CHARACTERS, seatNamesFor } from '@/lib/seats';
import { readSetup, writeSetup } from '@/lib/last-mode';
import { armAudio } from '@/lib/audio';
import {
  DEFAULT_SETUP,
  botSeatsFor,
  matchRulesFor,
  type BotDifficulty,
  type MatchSetup,
  type PlayMode,
} from '@/lib/match-setup';
import { GameHost } from './GameHost';
import { TracePanel } from './TracePanel';
import { MatchHud } from './MatchHud';
import { MatchOverlay } from './MatchOverlay';
import { MatchOptions } from './MatchOptions';
import { Controls } from './Controls';
import styles from './PlaySurface.module.css';

type Mode = PlayMode;

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

  /**
   * Armed here rather than in `GameHost`, and the difference is the whole point.
   *
   * `GameHost` mounts only *after* Start is pressed, so by the time it could attach a
   * listener the gesture that should have unlocked audio has already happened, and the
   * first match plays in silence — which is the failure #167 describes, reached from the
   * other side. The play page mounts before Start, so the Start tap is itself the
   * unlocking gesture and nobody is ever asked for permission.
   *
   * Idempotent, and `armAudio` also re-arms after iOS suspends the context for a
   * backgrounded tab or a phone call.
   */
  useEffect(() => {
    armAudio();
  }, []);
  // The running head-to-head for this sitting. A pair that plays five in a row wants to
  // know the score across all five, not just the last one.
  const [record, setRecord] = useState({ p1: 0, p2: 0, draws: 0 });
  // A new seed per match keeps a rematch from replaying the previous one exactly.
  const [seed, setSeed] = useState(1);

  /**
   * What this player last chose for this game: mode, bot tier and match length.
   *
   * Loaded in an effect rather than during render, for the reason the trace flag is: the
   * page is statically exported, so the server's HTML knows nothing about this device's
   * storage, and reading it while rendering makes the first paint disagree with it. The
   * defaults render, and the remembered choice replaces them a frame later.
   */
  const [setup, setSetup] = useState<MatchSetup>(DEFAULT_SETUP);
  useEffect(() => {
    setSetup(readSetup(slug));
  }, [slug]);

  /**
   * The seven games built so far settle their own rounds and report a winner, so the
   * shell trusts that outcome rather than second-guessing it from the score. Games that
   * declare a win condition instead get it resolved here; both paths run the same flow.
   *
   * The match length is the player's, from the pre-match screen. It was hardcoded to one
   * round, which made `round-over` unreachable in the entire product (#2485) — and with
   * it the round pips, the "Next round" screen and the opening-seat rotation of #2466,
   * all of which are implemented and were being shipped switched off.
   */
  const rules = useMemo<MatchRules>(() => matchRulesFor(setup.rounds), [setup.rounds]);

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
      writeSetup(slug, { mode: chosen });
      setSetup((previous) => ({ ...previous, mode: chosen }));
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
    // stale one. This was found by hand; `react-hooks/exhaustive-deps` now fails the
    // build on it, so the next one will not be (#2482).
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

  // Both written through as they are chosen rather than when a match starts, so a player
  // who sets a tier and then walks away still finds it set tomorrow.
  const chooseDifficulty = useCallback(
    (difficulty: BotDifficulty) => {
      writeSetup(slug, { difficulty });
      setSetup((previous) => ({ ...previous, difficulty }));
    },
    [slug],
  );

  const chooseRounds = useCallback(
    (rounds: number) => {
      writeSetup(slug, { rounds });
      setSetup((previous) => ({ ...previous, rounds }));
    },
    [slug],
  );

  /**
   * Which seats a bot holds this match, and how hard it tries.
   *
   * Memoised because its identity has to be stable for the life of a match: it sits in
   * the game host's setup-effect dependencies, and when this was written inline it was a
   * fresh object on every render — the first countdown frame tore the game down and
   * rebuilt it, and bot matches hung on the countdown forever. Neither dependency can
   * change while a match is running: the tier is only offered before one starts.
   */
  const botSeats = useMemo(
    () => (mode === null ? undefined : botSeatsFor(mode, setup.difficulty)),
    [mode, setup.difficulty],
  );

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
    const remembered = setup.mode;
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
        {/* Above the buttons, because these settle what the button is about to start —
            and the buttons stay last, nearest the thumb that presses them. The tier is
            offered only where the manifest has a bot to play, which today is every
            playable game: even the solo puzzles declare `friend` and `bot` as well,
            because a solo-only manifest is a game page nobody can start. */}
        <MatchOptions
          showDifficulty={offered.includes('bot')}
          difficulty={setup.difficulty}
          onDifficulty={chooseDifficulty}
          rounds={setup.rounds}
          onRounds={chooseRounds}
        />
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
              {offer === 'friend' ? 'Play together here' : `Play against ${SEAT_CHARACTERS.p2}`}
            </button>
          ))}
        </div>
        <Controls manifest={manifest} />
      </div>
    );
  }

  /**
   * What the two seats are called this match.
   *
   * Derived from the same `botSeats` map the game host is handed, so the scoreboard, the
   * result screen and the simulation cannot disagree about who is a bot. The shell used to
   * write a *partial* override here — seat two only — and leave seat one to whatever
   * fallback each component happened to carry, which is how the HUD came to read
   * "Pip vs Player two" (#2513).
   */
  const seatNames = seatNamesFor(botSeats);

  const hudProps = {
    state: match,
    rounds: rules.rounds ?? 1,
    activeSeat,
    seatNames,
    botSeats,
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
            {...(botSeats ? { botDifficulty: botSeats } : {})}
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
  return { slug: pick, name: GAME_NAMES[pick] ?? pick.replace(/-/g, ' ') };
}
