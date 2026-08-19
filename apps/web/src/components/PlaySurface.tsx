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
import { GameHost } from './GameHost';
import { MatchHud } from './MatchHud';
import { MatchOverlay } from './MatchOverlay';
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
  // The running head-to-head for this sitting. A pair that plays five in a row wants to
  // know the score across all five, not just the last one.
  const [record, setRecord] = useState({ p1: 0, p2: 0, draws: 0 });
  // A new seed per match keeps a rematch from replaying the previous one exactly.
  const [seed, setSeed] = useState(1);

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

  const start = useCallback((chosen: Mode) => {
    setMode(chosen);
    setActiveSeat(null);
    setSeed((previous) => previous + 1);
    send({ kind: 'start' });
  }, []);

  const rematch = useCallback(() => {
    setActiveSeat(null);
    setSeed((previous) => previous + 1);
    send({ kind: 'rematch' });
  }, []);

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
    return (
      <div className={styles.state}>
        <h2>{manifest.name}</h2>
        <div className={styles.modes}>
          {manifest.modes.includes('friend') ? (
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                start('friend');
              }}
            >
              Play together here
            </button>
          ) : null}
          {manifest.modes.includes('bot') ? (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                start('bot');
              }}
            >
              Play against {seatColour.p2.name}
            </button>
          ) : null}
        </div>
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

      <div
        className={styles.board}
        style={{ aspectRatio: `${manifest.logical.width} / ${manifest.logical.height}` }}
      >
        <GameHost
          manifest={manifest}
          createGame={create}
          seed={seed}
          phase={match.phase}
          presentation="shared-screen"
          localSeat="p1"
          {...(mode === 'bot' ? { botDifficulty: BOT_OPPONENT } : {})}
          onTick={handleTick}
          onScore={handleScore}
          onActiveSeat={setActiveSeat}
          onRequestPause={handlePauseRequest}
        />
        <MatchOverlay
          state={match}
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
